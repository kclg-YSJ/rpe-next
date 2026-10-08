import { beatValue, fromNumber } from '../core/beat.ts';
import { assertChart } from '../core/chart.ts';
import { easing } from '../core/easing.ts';
import { compileExpression, compileBatchScript } from '../core/batch-script.ts';
import { alignShaderParameters } from '../core/shader-events.ts';
import { eventList, eventKey, chartWithEventLists } from './event-commands.ts';
import type { SelectionSnapshot } from './batch-edit.ts';
import type { BatchStatement } from '../core/batch-script.ts';
import type { AnyEventType, Chart, ChartEvent, Color, Note } from '../core/types.ts';

/** Everything the batch distributor needs; the panel's `read()` supplies exactly these fields. */
export interface DistributionOptions {
  lower?: string | number;
  upper?: string | number;
  cycle?: string;
  disturbance?: string;
  easingType?: string | number;
}

/** The batch form's options, as the multi-edit panel reads its controls. */
export interface MultiEditOptions extends DistributionOptions {
  field?: string;
  operation?: string;
  mode?: string;
  script?: string;
  condition?: string;
  seed?: number;
  eventApplicationMode?: string;
  /** `Number(...)`-ed by the caller, so it may arrive as text as well. */
  noteType?: string | number;
  eventType?: AnyEventType | 'all';
  channels?: Record<string, DistributionOptions>;
}

/** The clone panel's options. */
export interface CloneOptions extends DistributionOptions {
  /** The raw 目标线号序列 text, parsed by {@link sequence}. */
  targets?: string[];
  increment?: string | number;
  division?: string | number;
  seed?: number;
  channels?: Record<string, DistributionOptions>;
  retainSource?: boolean;
}

/**
 * One batch change.
 *
 * `index` addresses the item on `lineIndex` for `copy` changes, and the source line's list
 * otherwise; the `after` and `before` payloads are a note or an event depending on `kind`.
 */
export interface BatchChange {
  kind: string;
  type?: AnyEventType;
  index: number;
  before: Note | ChartEvent;
  after: Note | ChartEvent;
  lineIndex: number;
  copy: boolean;
  priority?: number;
}

/** A parsed 周期数列 / 扰动 series; `null` marks a `_` entry that skips its item. */
type Series = Array<number | null>;

/** The `{ lower, easingType, cycle, disturbance }` bag {@link distribution} reads. */
interface DistributionSource {
  lower?: unknown;
  upper?: unknown;
  cycle?: unknown;
  disturbance?: unknown;
  easingType?: unknown;
}

/**
 * The variable bag batch expressions are evaluated against.
 *
 * Everything a script may read is declared, while the open index signature is what lets
 * `writeField` and `scopeFor` copy whole objects (`line`, the item itself) into and out of it: a
 * script can assign those fields, and a plain `Record<string, number>` would reject the copies.
 */
interface EditScope {
  n: number;
  i: number;
  N: number;
  u: number;
  line: number;
  t: number;
  t1: number;
  t2: number;
  duration: number;
  [key: string]: unknown;
}

/** A selected item plus the resolved line it lives on, as {@link captureSelection} produces it. */
interface BatchEntry {
  lineIndex?: number;
  index: number;
  type?: AnyEventType;
  note?: Note;
  event?: ChartEvent;
  before?: Note | ChartEvent;
}

/** The result of a batch preview, ready for `commitSelectionEdit`. */
export interface MultiEditResult {
  chart: Chart;
  lineIndex: number;
  eventLayer: number;
  focus: string;
  selection: Set<number>;
  eventSelection: Set<string>;
  multiEventSelection: Map<number, Set<string>>;
  changes: BatchChange[];
}

/** A line's event tracks, keyed per type, as {@link assemble} accumulates them. */
type EventUpdatesByType = Map<AnyEventType, ChartEvent[]>;

export const NOTE_BATCH_FIELDS: [string, string][] = [
  ['x', 'X · 横坐标'], ['speed', 'Speed · 速度'], ['size', 'Size · 大小'], ['yOffset', 'YOffset · 纵向偏移'],
  ['visibleTime', 'VisibleTime · 可见秒数'], ['alpha', 'Alpha · 透明度'], ['t1', 'Time1 · 开始拍'], ['t2', 'Time2 · 结束拍'],
  ['line', 'Line · 移动到线'], ['hitSound', 'HitSound · 打击音效'], ['judgeArea', 'judgeArea · 判定宽度'],
  ['red', 'Red'], ['green', 'Green'], ['blue', 'Blue'],
];
export const EVENT_BATCH_FIELDS: [string, string][] = [
  ['both', 'Both · 首尾数值'], ['end', 'End · 结束值'], ['start', 'Start · 开始值'], ['easing', 'Easing · 缓动'],
  ['t1', 'StartTime · 开始拍'], ['t2', 'EndTime · 结束拍'], ['line', 'Line · 复制到线'],
  ['linkgroup', 'LinkGroup · 绑定组'], ['duration', 'Duration · 时长并首尾相接'], ['order', 'Order · 重排内容（保留时间槽）'],
];
/**
 * The `[value, label]` pairs the "事件种类" selector is populated from.
 *
 * The first entry is the `'all'` wildcard the panel's own filter accepts; every other entry names a
 * real event track. Annotated as pairs so the literal does not widen to `string[][]`, which the
 * `<option>` builder cannot consume.
 */
export const EVENT_BATCH_TYPES: [string, string][] = [
  ['all', '全部'], ['moveXEvents', 'X'], ['moveYEvents', 'Y'], ['rotateEvents', '旋转'], ['alphaEvents', '透明度'],
  ['speedEvents', '速度'], ['scaleXEvents', '缩放 X'], ['scaleYEvents', '缩放 Y'], ['paintEvents', '着色器'],
  ['colorEvents', '颜色'], ['textEvents', '文字'],
];
export const BATCH_OPERATIONS: [string, string][] = [['By', 'By · 增减'], ['To', 'To · 设为'], ['Times', 'Times · 倍乘'], ['Max', 'Max · 下限'], ['Min', 'Min · 上限'], ['Flip', 'Flip · 绕值翻转']];

export function batchOperation(before: number, value: number, operation: string): number {
  switch (operation) {
    case 'By': return before + value; case 'To': return value; case 'Times': return before * value;
    case 'Max': return Math.max(before, value); case 'Min': return Math.min(before, value); case 'Flip': return value * 2 - before;
    default: throw new Error('未知修改方式');
  }
}

function sequence(text: unknown, fallback: Series, skip = false): Series {
  const parts = String(text ?? '').trim().split(/[\s,，]+/).filter(Boolean);
  return parts.length ? parts.map(part => skip && part === '_' ? null : compileExpression(part)({})) : fallback;
}

function randomSource(seed: unknown): () => number {
  let state = Number(seed) >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}

function distribution(options: DistributionSource, random: () => number): (index: number, progress: number) => number | null {
  const lower = compileExpression(String(options.lower ?? 0))({});
  const upper = compileExpression(String(options.upper ?? 0))({});
  const cycle = sequence(options.cycle, [1], true); const disturbance = sequence(options.disturbance, []);
  const easingType = Number(options.easingType ?? 1);
  if (!Number.isInteger(easingType) || easingType < 1 || easingType > 29) throw new Error('缓动编号须为 1–29');
  return (index: number, progress: number): number | null => {
    const multiplier = cycle[index % cycle.length]; if (multiplier === null) return null;
    let value = lower + (upper - lower) * easing(progress, easingType);
    if (disturbance.length === 1) value += (random() * 2 - 1) * (disturbance[0] as number);
    else if (disturbance.length === 2) value += (disturbance[0] as number) + random() * ((disturbance[1] as number) - (disturbance[0] as number));
    else if (disturbance.length) value += disturbance[Math.floor(random() * disturbance.length)] as number;
    return value * multiplier;
  };
}

function scopeFor(item: Note | ChartEvent, kind: string, line: number, index: number, count: number): EditScope {
  const start = beatValue(item.startTime); const end = beatValue(item.endTime);
  const scope = { n: kind === 'notes' ? index : index + 1, i: index, N: count, u: count > 1 ? index / (count - 1) : 0,
    line, t: start, t1: start, t2: end, 'st.time': start, 'ed.time': end, duration: end - start };
  if (kind === 'notes') {
    // `item` is a Note on this branch; the chart types index both note kinds with the open-ended
    // signature (`tint`, `judgeArea`, `hitSound` and friends come from the RPE document).
    const note = item as Note;
    // `tint`, `judgeArea` and the like come from the RPE document and reach `Note` through its
    // open-ended index signature, so they are read as `unknown` and narrowed here.
    const tintSource = note.tint ?? note.color;
    const tint = Array.isArray(tintSource) ? tintSource as number[] : undefined;
    return { ...scope, x: note.positionX, speed: note.speed ?? 1, size: note.size ?? 1,
      yOffset: note.yOffset ?? 0, visibleTime: note.visibleTime ?? 999999, alpha: note.alpha ?? 255,
      judgeArea: note.judgeArea ?? 1, red: tint?.[0] ?? 255, green: tint?.[1] ?? 255, blue: tint?.[2] ?? 255,
      type: note.type, isFake: note.isFake ?? 0, above: note.above ?? 1,
      v: note.speed ?? 1, w: note.size ?? 1, width: note.size ?? 1, yoffset: note.yOffset ?? 0, vt: note.visibleTime ?? 999999 };
  }
  const event = item as ChartEvent;
  return { ...scope, start: event.start, end: event.end, 'st.x': event.start, 'ed.x': event.end,
    easing: event.easingType ?? 1, linkgroup: event.linkgroup ?? 0, inst: event.inst ?? 0, order: scope.u };
}

function writeField(item: Note | ChartEvent, field: string, value: number): void {
  if (field === 't1' || field === 't2') item[field === 't1' ? 'startTime' : 'endTime'] = fromNumber(value);
  else if (field === 'duration') item.endTime = fromNumber(beatValue(item.startTime) + Math.max(0, value));
  else if (field === 'both') { item.start = value; item.end = value; }
  else if (['red', 'green', 'blue'].includes(field)) {
    const current = item.tint;
    const tint: Color = Array.isArray(current) && current.length === 3 ? [...current] as Color : [255, 255, 255];
    tint[['red', 'green', 'blue'].indexOf(field)] = Math.max(0, Math.min(255, Math.trunc(value))); item.tint = tint;
  } else item[field === 'x' ? 'positionX' : field === 'easing' ? 'easingType' : field] = value;
}

function validateChange(change: BatchChange, lineCount: number, snapshot: SelectionSnapshot): void {
  const { kind, type } = change;
  // The item carried by a change is a Note on the `notes` kind and a ChartEvent otherwise; the cast
  // keeps the two halves of the original mixed-shape body reading exactly the same fields as before.
  const after = change.after as Note & ChartEvent;
  const before = change.before as Note & ChartEvent;
  if (!Number.isInteger(change.lineIndex) || change.lineIndex < 0 || change.lineIndex >= lineCount) throw new Error(`目标线 ${change.lineIndex} 不存在`);
  if (kind === 'notes') {
    if (![1, 2, 3, 4].includes(after.type)) throw new Error('音符类型须为 1 Tap / 2 Hold / 3 Flick / 4 Drag');
    // `above`/`isFake` are `number | boolean` in the chart format, so the containment checks run on
    // the raw values (a boolean is simply not in the list) and the assignment below rewrites `above`.
    const above = after.above ?? 1; const isFake = after.isFake ?? 0;
    if (![0, 1, 2].includes(above as number) || ![0, 1].includes(isFake as number)) throw new Error('above 须为 0/1/2，isFake 须为 0/1');
    after.above = (after.above ?? 1) === 1 ? 1 : after.type === 2 ? 0 : 2;
    if (after.type === 2 && before.type !== 2 && beatValue(after.endTime) === beatValue(after.startTime)) after.endTime = fromNumber(beatValue(after.startTime) + 0.25);
  }
  if (kind === 'notes' && after.type !== 2) {
    if (beatValue(after.startTime) === beatValue(before.startTime) && beatValue(after.endTime) !== beatValue(before.endTime)) after.startTime = [...after.endTime];
    else after.endTime = [...after.startTime];
  }
  if (beatValue(after.endTime) < beatValue(after.startTime)) throw new Error('结束拍不能早于开始拍');
  if (kind === 'events' && after.inst && JSON.stringify(after.start) !== JSON.stringify(after.end)) after.inst = 0;
  if (kind === 'events' && ![0, 1, false, true].includes(after.inst ?? 0)) throw new Error('钩定 inst 须为 0/1');
  if (kind === 'events' && type === 'paintEvents' && snapshot.shaderAutoAlign !== false && beatValue(after.startTime) !== beatValue(before.startTime)) change.after = alignShaderParameters(after);
  // `Object.entries(change.after)` is the original argument, kept verbatim: the shader realignment
  // above writes through `change.after`, and the local `after` may already hold reassigned beats.
  for (const [key, value] of Object.entries(change.after) as [string, unknown][]) if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`${key} 的结果不是有限数字`);
  if (after.easingType !== undefined && (!Number.isInteger(after.easingType) || after.easingType < 1 || after.easingType > 29)) throw new Error('结果中的缓动编号须为 1–29 的整数');
}

function assemble(snapshot: SelectionSnapshot, changes: BatchChange[], kind: string, removeSource = false): MultiEditResult {
  let chart = snapshot.chart;
  const selection = new Set<number>(kind === 'notes' ? snapshot.notes.map(entry => entry.index) : []);
  const eventSelection = new Set<string>(kind === 'events' && !removeSource ? snapshot.events.filter(entry => (entry.lineIndex ?? snapshot.lineIndex) === snapshot.lineIndex).map(entry => eventKey(entry.type, entry.index)) : []);
  const sourceEventLines = new Set<number>(snapshot.events.map(entry => Number.isInteger(entry.lineIndex) ? entry.lineIndex : snapshot.lineIndex));
  const affected = new Set<number>(changes.flatMap(change => [snapshot.lineIndex, change.lineIndex, ...(kind === 'events' ? sourceEventLines : [])]));
  const notesByLine = new Map<number, Note[]>(); const eventsByLine = new Map<number, EventUpdatesByType>();
  const selectedNotes = new Set<number>(snapshot.notes.map(entry => entry.index));
  const noteUpdates = new Map<number, BatchChange>(changes.filter(change => !change.copy).map(change => [change.index, change]));
  for (const lineIndex of affected) {
    const line = chart.judgeLineList[lineIndex];
    if (kind === 'notes') {
      const notes: Note[] = []; if (lineIndex === snapshot.lineIndex) selection.clear();
      (line.notes ?? []).forEach((note, index) => {
        const change = lineIndex === snapshot.lineIndex ? noteUpdates.get(index) : null;
        if (change && change.lineIndex !== lineIndex) return;
        if (lineIndex === snapshot.lineIndex && selectedNotes.has(index)) selection.add(notes.length);
        notes.push((change?.after ?? note) as Note);
      });
      notesByLine.set(lineIndex, notes);
    } else eventsByLine.set(lineIndex, new Map());
  }
  if (removeSource) {
    const selected = new Map<string, { lineIndex: number; type: AnyEventType; indices: Set<number> }>();
    for (const entry of snapshot.events) {
      const lineIndex = Number.isInteger(entry.lineIndex) ? entry.lineIndex : snapshot.lineIndex;
      const key = `${lineIndex}:${entry.type}`;
      if (!selected.has(key)) selected.set(key, { lineIndex, type: entry.type, indices: new Set() });
      selected.get(key)?.indices.add(entry.index);
    }
    for (const { lineIndex, type, indices } of selected.values()) {
      const original = eventList({ chart, lineIndex, eventLayer: snapshot.eventLayer }, type);
      eventsByLine.get(lineIndex)?.set(type, original.filter((event, index) => !indices.has(index)));
    }
  }
  for (const change of changes) {
    if (kind === 'notes') {
      if (change.lineIndex !== snapshot.lineIndex || change.copy) {
        const notes = notesByLine.get(change.lineIndex);
        if (change.lineIndex === snapshot.lineIndex) selection.add(notes?.length ?? 0);
        notes?.push(change.after as Note);
      }
    } else {
      const updates = eventsByLine.get(change.lineIndex);
      const type = change.type as AnyEventType;
      if (!updates?.has(type)) updates?.set(type, [...eventList({ chart, lineIndex: change.lineIndex, eventLayer: snapshot.eventLayer }, type)]);
      const events = updates?.get(type);
      if (change.copy) {
        if (change.lineIndex === snapshot.lineIndex) eventSelection.add(eventKey(type, events?.length ?? 0));
        events?.push(change.after as ChartEvent);
      } else if (events) events[change.index] = change.after as ChartEvent;
    }
  }
  if (notesByLine.size) chart = { ...chart, judgeLineList: chart.judgeLineList.map((line, index) => notesByLine.has(index) ? { ...line, notes: notesByLine.get(index) as Note[], numOfNotes: (notesByLine.get(index) as Note[]).length } : line) };
  for (const [lineIndex, updates] of eventsByLine) if (updates.size) chart = chartWithEventLists(chart, lineIndex, snapshot.eventLayer, updates);
  assertChart(chart);
  const multiEventSelection = new Map<number, Set<string>>();
  if (kind === 'events' && !removeSource) {
    for (const change of changes) {
      if (!change.copy) {
        const lineIndex = Number.isInteger(change.lineIndex) ? change.lineIndex : snapshot.lineIndex;
        if (!multiEventSelection.has(lineIndex)) multiEventSelection.set(lineIndex, new Set());
        multiEventSelection.get(lineIndex)?.add(eventKey(change.type as AnyEventType, change.index));
      }
    }
  }
  return { chart, lineIndex: snapshot.lineIndex, eventLayer: snapshot.eventLayer, focus: kind, selection, eventSelection, multiEventSelection, changes };
}

export function previewMultiEdit(snapshot: SelectionSnapshot, kind: string, options: MultiEditOptions = {}): MultiEditResult {
  const field = options.field ?? (kind === 'notes' ? 'x' : 'both'); const operation = options.operation ?? 'By';
  const scriptMode = options.mode === 'script';
  const fields = (kind === 'notes' ? NOTE_BATCH_FIELDS : EVENT_BATCH_FIELDS).map(([key]) => key).filter(key => !['hitSound', 'both', 'order'].includes(key));
  if (kind === 'notes') fields.push('type', 'isFake', 'above'); else fields.push('inst');
  const script: BatchStatement[] = scriptMode ? compileBatchScript(options.script ?? '', fields) : [];
  if (scriptMode && !script.length) throw new Error('请输入至少一条赋值');
  const condition = options.condition?.trim() ? compileExpression(options.condition) : () => 1;
  const random = randomSource(options.seed ?? 1);
  const modifier = scriptMode || field === 'hitSound' ? null : distribution(options, random);
  const groups = new Map<string, BatchEntry[]>();
  const applicationMode = kind === 'events' && options.eventApplicationMode === 'global' ? 'global' : 'per-line';
  // `snapshot.notes` and `snapshot.events` are separate shapes; reading them as one optional-field
  // view keeps the original single loop, which branches on `kind` for every access anyway.
  for (const entry of (kind === 'notes' ? snapshot.notes : snapshot.events) as BatchEntry[]) {
    if (kind === 'notes' && Number(options.noteType) && (entry.note as Note).type !== Number(options.noteType)) continue;
    if (kind === 'events' && options.eventType && options.eventType !== 'all' && options.eventType !== entry.type) continue;
    const sourceLine = Number.isInteger(entry.lineIndex) ? entry.lineIndex as number : snapshot.lineIndex;
    const key = kind === 'notes' ? 'notes' : applicationMode === 'global' ? String(entry.type) : `${sourceLine}:${entry.type}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)?.push({ ...entry, before: entry.note ?? entry.event });
  }
  const changes: BatchChange[] = [];
  for (const entries of groups.values()) {
    entries.sort((left, right) => beatValue((left.before as Note | ChartEvent).startTime) - beatValue((right.before as Note | ChartEvent).startTime) || left.index - right.index);
    const filtered = entries.filter((entry, index) => condition(scopeFor(entry.before as Note | ChartEvent, kind, Number.isInteger(entry.lineIndex) ? entry.lineIndex as number : snapshot.lineIndex, index, entries.length) as unknown as Record<string, number | string | boolean>));
    let time = filtered.length ? beatValue((filtered[0].before as Note | ChartEvent).startTime) : 0;
    const groupChanges: BatchChange[] = [];
    filtered.forEach((entry, index) => {
      const sourceLine = Number.isInteger(entry.lineIndex) ? entry.lineIndex as number : snapshot.lineIndex;
      const after = structuredClone(entry.before) as Note | ChartEvent; const scope = scopeFor(after, kind, sourceLine, index, filtered.length);
      const change: BatchChange = { kind, type: entry.type, index: entry.index, before: entry.before as Note | ChartEvent, after, lineIndex: sourceLine, copy: false };
      if (scriptMode) {
        for (const statement of script) {
          const value = statement.evaluate(scope as unknown as Record<string, number | string | boolean>); const previous = scope[statement.field];
          const next = statement.operator === '=' ? value : statement.operator === '+=' ? Number(previous) + value : statement.operator === '-=' ? Number(previous) - value : statement.operator === '*=' ? Number(previous) * value : Number(previous) / value;
          if (!Number.isFinite(next)) throw new Error(`${statement.field} 计算结果无效`);
          if (statement.field === 'line') { change.lineIndex = Math.round(next); change.copy = kind === 'events'; }
          else writeField(after, statement.field, next);
          Object.assign(scope, scopeFor(after, kind, change.lineIndex, index, filtered.length));
        }
      } else if (field === 'hitSound') {
        if (operation !== 'To') throw new Error('HitSound 仅支持 To');
        after.hitSound = String(options.lower || options.upper || '');
      } else {
        const endpointDistribution = kind === 'notes' || ['line', 'duration', 'order'].includes(field);
        const progress = endpointDistribution ? scope.u : (index + 1) / filtered.length;
        // `modifier` is null exactly when the branch above (or the hitSound branch) handled the
        // field, so the non-null assertion only records what this `else` already guarantees.
        const value = (modifier as (index: number, progress: number) => number | null)(index, progress); if (value === null) return;
        if (field === 'line') { change.lineIndex = Math.round(batchOperation(sourceLine, value, operation)); change.copy = kind === 'events'; }
        else if (field === 'both') {
          if (typeof after.start !== 'number' || typeof after.end !== 'number') throw new Error('首尾数值编辑适用于数值事件；颜色、文字、着色器可编辑时间或克隆');
          after.start = batchOperation(after.start, value, operation); after.end = batchOperation(after.end, value, operation);
        } else if (field === 'duration' && kind === 'events') {
          const duration = Math.max(0, batchOperation(scope.duration, value, operation));
          after.startTime = fromNumber(time); after.endTime = fromNumber(time + duration); time += duration;
        } else if (field === 'order') change.priority = batchOperation(scope.u, value, operation);
        else {
          const current = scope[field];
          if (typeof current !== 'number') throw new Error('当前物件不支持此数值属性');
          writeField(after, field, batchOperation(current, value, operation));
        }
      }
      groupChanges.push(change);
    });
    if (!scriptMode && field === 'order') {
      const ordered = groupChanges.toSorted((left, right) => (left.priority as number) - (right.priority as number));
      groupChanges.forEach((change, index) => { change.after = { ...structuredClone(ordered[index].before as Note | ChartEvent), startTime: [...change.before.startTime], endTime: [...change.before.endTime] }; });
    }
    for (const change of groupChanges) { validateChange(change, snapshot.chart.judgeLineList.length, snapshot); changes.push(change); }
  }
  if (!changes.length) throw new Error('没有匹配的选中物件');
  return assemble(snapshot, changes, kind);
}

export function previewEventClones(snapshot: SelectionSnapshot, options: CloneOptions = {}): MultiEditResult {
  const targets = sequence(options.targets, []);
  if (!targets.length) throw new Error('请输入目标线号序列');
  if (targets.some(value => !Number.isInteger(value) || (value as number) < 0 || (value as number) >= snapshot.chart.judgeLineList.length)) throw new Error('目标线号必须是已有判定线的整数编号');
  if (!snapshot.events.length) throw new Error('请先选中事件');
  if (targets.length * snapshot.events.length > 100000) throw new Error('单次克隆超过 100000 个事件，请分批执行');
  const increment = compileExpression(String(options.increment ?? 0))({}) / Math.max(1, Number(options.division ?? 4));
  const random = randomSource(options.seed ?? 1); const modifiers = new Map<AnyEventType, (index: number, progress: number) => number | null>();
  for (const type of ['moveXEvents', 'moveYEvents', 'rotateEvents', 'alphaEvents'] as AnyEventType[]) modifiers.set(type, distribution(options.channels?.[type] ?? {}, random));
  const changes: BatchChange[] = [];
  for (const { type, index, event } of snapshot.events) {
    targets.forEach((lineIndex, targetIndex) => {
      const offset = targetIndex * increment; const after = structuredClone(event);
      after.startTime = fromNumber(beatValue(event.startTime) + offset); after.endTime = fromNumber(beatValue(event.endTime) + offset);
      const modifier = modifiers.get(type);
      if (modifier) { const value = modifier(targetIndex, targets.length > 1 ? targetIndex / (targets.length - 1) : 0); if (value !== null) { (after.start as number) += value; (after.end as number) += value; } }
      const change: BatchChange = { kind: 'events', type, index, before: event, after, lineIndex: lineIndex as number, copy: true };
      validateChange(change, snapshot.chart.judgeLineList.length, snapshot); changes.push(change);
    });
  }
  return assemble(snapshot, changes, 'events', options.retainSource === false);
}
