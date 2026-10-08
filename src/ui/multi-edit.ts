import { captureSelection, commitSelectionEdit } from '../application/batch-edit.ts';
import { previewMultiEdit, previewEventClones, NOTE_BATCH_FIELDS, EVENT_BATCH_FIELDS, EVENT_BATCH_TYPES, BATCH_OPERATIONS } from '../application/multi-edit.ts';
import { beatValue } from '../core/beat.ts';
import { easing, bezier } from '../core/easing.ts';
import { createEasingPicker, EASING_NAMES } from './easing-picker.ts';
import { NOTE_COLORS } from './timeline.ts';
import { MultiEditParameters } from '../application/multi-edit-parameters.ts';
import { runEventTool } from './event-tools.ts';
import type { EditorSession } from '../application/session.ts';
import type { SelectionEditResult } from '../application/batch-edit.ts';
import type { BatchKind, BatchParameters, BatchChannelParameters } from '../application/multi-edit-parameters.ts';
import type { AnyEventType, Chart, ChartEvent, Note } from '../core/types.ts';
import type { MultiEditOptions, CloneOptions, MultiEditResult, BatchChange, DistributionOptions } from '../application/multi-edit.ts';
import type { Timeline } from './timeline.ts';

/** The two object kinds the panel batches; also the `MultiEditParameters` keys. */
export type MultiEditKind = BatchKind;

/** A `<select>`/`<input>` pair, which is what the panel's `control()` helper hands back. */
export type ControlElement = HTMLInputElement | HTMLSelectElement;

/**
 * Narrows a batch change's payload to the note it is in notes mode.
 *
 * A `Note` carries a numeric `positionX` and a numeric `type`; a `ChartEvent` carries neither, so the
 * check separates the two arms of `Note | ChartEvent` exactly. It is a runtime check rather than an
 * assertion because the payload's type follows `MultiEditKind`, which is not part of the value.
 */
function isNote(item: Note | ChartEvent): item is Note {
  return typeof item.positionX === 'number';
}

/** One `[value, label]` option pair, as `BATCH_OPERATIONS` and friends supply them. */
type ControlOption = [string | number, string];

/**
 * Narrows the 事件种类 `<select>`'s value to the union `MultiEditRead` declares.
 *
 * The control is populated from {@link EVENT_BATCH_TYPES}, so its value is always one of those
 * entries' names or the `'all'` wildcard; the list is what states that for the compiler. A value
 * outside the list cannot be produced by the panel, and `'all'` is the fallback the wildcard case
 * already used, so the reader stays total.
 */
function batchEventType(value: string): AnyEventType | 'all' {
  const known: string[] = EVENT_BATCH_TYPES.map(([name]) => name);
  return known.includes(value) ? value as AnyEventType | 'all' : 'all';
}

/**
 * The members {@link drawEventGhost} reads off a batch change's `before`/`after` payload.
 *
 * Those payloads are `Note | ChartEvent` depending on the panel's kind. Both carry `startTime` and
 * `endTime`, and a `ChartEvent` additionally carries the numeric `start`/`end` value pair the ghost
 * curve spans — a note has none, which is why those two are optional and why the drawer's own
 * `typeof` guard is what narrows them before any arithmetic. The easing fields are on both.
 */
interface GhostEvent {
  readonly startTime: unknown;
  readonly endTime: unknown;
  readonly start?: unknown;
  readonly end?: unknown;
  readonly easingType?: number;
  readonly easingLeft?: number;
  readonly easingRight?: number;
  readonly bezier?: unknown;
  readonly bezierPoints?: unknown;
}

/**
 * The `{ lower, easingType, cycle, disturbance }` bag {@link distributionFields} reads and writes.
 *
 * `write` receives whatever the parameter document holds — `load` hands it a whole `BatchParameters`
 * and, per channel, one `BatchChannelParameters` — so the values arrive as `string | number |
 * undefined` and are unvalidated; the reader mirrors the controls and always answers strings.
 */
export interface DistributionFields {
  (): DistributionRead;
  write: (value: DistributionWrite) => void;
}

/** What {@link DistributionFields.write} accepts: a parameter set, a channel set, or an empty object. */
export interface DistributionWrite {
  lower?: string | number;
  upper?: string | number;
  easingType?: string | number;
  cycle?: string | number;
  disturbance?: string | number;
}

/** What one distribution row reads out of its controls; also one per-channel offset set. */
export interface DistributionRead {
  lower: string;
  upper: string;
  easingType: number;
  cycle: string;
  disturbance: string;
}

/**
 * Everything the batch panel reads off its controls.
 *
 * Declared standalone rather than extending `MultiEditOptions`: that interface marks every field
 * optional (stored parameter sets may omit them) and types `channels` as
 * `Record<string, DistributionOptions>`, while this reader always produces every field and hands
 * `previewEventClones` the same per-channel bag. `MultiEditOptions` and `CloneOptions` both admit
 * this shape, which is what lets one `read()` feed either preview entry point.
 */
export interface MultiEditRead {
  mode: string;
  field: string;
  operation: string;
  eventApplicationMode: string;
  noteType: number;
  /**
   * The selected event track, or `'all'`. Typed as the union the viewer understands rather than
   * `string`: the `<select>` is populated from `EVENT_BATCH_TYPES`, so it only ever holds these.
   */
  eventType: AnyEventType | 'all';
  condition: string;  script: string;
  seed: number;
  /**
   * The raw 目标线号序列 text from the control, which `sequence()` splits itself. `CloneOptions`
   * declares `targets?: string[]` because its other callers pass parsed sequences, but both the
   * panel and the tests hand over the raw string, which is what this field carries.
   */
  targets: string;
  increment: string;
  retainSource: boolean;
  division: number;
  /** One per-channel offset set, keyed by event type; `previewEventClones` reads it. */
  channels: Record<string, DistributionOptions>;
  lower: string;
  upper: string;
  easingType: number;
  cycle: string;
  disturbance: string;
}

/** What {@link MultiEditPanel}'s host supplies. */
export interface MultiEditPanelOptions {
  close?: () => void;
  invalidate?: () => void;
  notify?: (message: string, level?: string) => void;
}

function control(root: HTMLElement, title: string, value: string, options?: ControlOption[]): ControlElement {
  const label = document.createElement('label'); label.className = 'field'; label.append(title);
  const input = document.createElement(options ? 'select' : 'input'); input.setAttribute('aria-label', title);
  if (options) for (const [key, text] of options) input.append(new Option(text, String(key)));
  input.value = value; label.append(input); root.append(label); return input;
}

/** Narrows {@link control}'s union for the call sites that know they asked for a text entry. */
function controlInput(root: HTMLElement, title: string, value: string): HTMLInputElement {
  const input = control(root, title, value); return input as HTMLInputElement;
}

/** Narrows {@link control}'s union for the call sites that know they passed an option list. */
function controlSelect(root: HTMLElement, title: string, value: string, options: ControlOption[]): HTMLSelectElement {
  const input = control(root, title, value, options); return input as HTMLSelectElement;
}

function distributionFields(root: HTMLElement, prefix = ''): DistributionFields {
  const lower = controlInput(root, `${prefix}数值下界`, '0'); const upper = controlInput(root, `${prefix}数值上界`, '0');
  const easingType = controlSelect(root, `${prefix}缓动类型`, '1', EASING_NAMES.map((name, index) => [index + 1, `${index + 1} · ${name}`]));
  const cycle = controlInput(root, `${prefix}周期数列`, '1'); const disturbance = controlInput(root, `${prefix}扰动`, '0');
  const picker = createEasingPicker(1, value => { easingType.value = String(value); easingType.dispatchEvent(new Event('input', { bubbles: true })); });
  easingType.addEventListener('input', () => picker.select(Number(easingType.value))); root.append(picker.element);
  const read = ((): DistributionRead => ({ lower: lower.value, upper: upper.value, easingType: Number(easingType.value), cycle: cycle.value, disturbance: disturbance.value })) as DistributionFields;
  read.write = (value: DistributionWrite): void => {
    lower.value = String(value.lower ?? '0'); upper.value = String(value.upper ?? '0'); easingType.value = String(value.easingType ?? 1);
    cycle.value = String(value.cycle ?? '1'); disturbance.value = String(value.disturbance ?? '0'); picker.select(Number(easingType.value));
  };
  return read;
}

function hint(root: HTMLElement, text: string): HTMLParagraphElement { const paragraph = document.createElement('p'); paragraph.className = 'hint'; paragraph.textContent = text; root.append(paragraph); return paragraph; }

export class MultiEditPanel {
  // Declared explicitly: unannotated fields infer too narrowly (`null` for the result, `false` for
  // the flags) and cascade into every reader, which is most of this file's error count.
  root: HTMLElement;
  getSession: () => EditorSession;
  timeline: Timeline;
  close: () => void;
  invalidate: () => void;
  notify: (message: string, level?: string) => void;
  active: boolean;
  previewHovered: boolean;
  parameters: MultiEditParameters;
  /** Set by {@link open}; both `drawTimeline` and `refresh` branch on it. */
  kind: MultiEditKind;
  /** Rerolled by 重新采样扰动, so a preview can be reproduced from `read()`. */
  seed: number;
  /** The pending preview, or `null` when the current parameters do not produce one. */
  result: MultiEditResult | null;
  /** The selection the current `result` was built for; `null` until the first sync. */
  signature: string | null;
  /** The chart the current `result` was built against. */
  chart: Chart | undefined;
  /** Rebuilt by {@link open}; repopulates the two parameter dropdowns. */
  updateHistory: () => void;
  /** Rebuilt by {@link open}; reads the whole form into a parameter set. */
  read: () => MultiEditRead;
  /** Rebuilt by {@link open}; applies a stored parameter set back onto the controls. */
  load: (value: BatchParameters) => void;
  /** Guard so committing does not re-enter {@link sync} through the session's change event. */
  committing: boolean;
  /** The status line under the form. */
  summary: HTMLParagraphElement;
  /** The 在编辑区显示结果虚影 checkbox, read by `drawTimeline`. */
  previewEnabled: HTMLInputElement;
  /** The 应用更改 button, disabled while there is no preview. */
  apply: HTMLButtonElement;

  constructor(root: HTMLElement, getSession: () => EditorSession, timeline: Timeline, { close = () => {}, invalidate = () => {}, notify = () => {} }: MultiEditPanelOptions = {}) {
    // The option names are bound to distinct locals: `invalidate`/`notify` are also class field
    // names, and a destructuring binding would shadow them inside this constructor.
    const invalidatePanel = invalidate; const notifyPanel = notify;
    this.root = root; this.getSession = getSession; this.timeline = timeline;
    this.close = close; this.invalidate = invalidatePanel; this.notify = notifyPanel; this.active = false; this.previewHovered = false;
    // Filled in by `open` before anything can read them; the placeholders keep the declared types.
    this.kind = 'notes'; this.seed = 1; this.result = null; this.signature = null; this.chart = undefined;
    this.updateHistory = () => {}; this.read = () => ({}) as MultiEditRead; this.load = () => {};
    this.committing = false;
    this.summary = document.createElement('p'); this.previewEnabled = document.createElement('input'); this.apply = document.createElement('button');
    root.addEventListener('pointerenter', () => { this.previewHovered = true; this.invalidate(); });
    root.addEventListener('pointerleave', () => { this.previewHovered = false; this.invalidate(); });
    this.parameters = new MultiEditParameters(globalThis.localStorage, message => notifyPanel(message, 'warning'));
  }

  open(kind: MultiEditKind): void {
    if (this.active && this.kind === kind) { this.sync(); return; }
    this.active = true; this.kind = kind; this.seed = 1; this.result = null; this.signature = null;
    const root = this.root; root.replaceChildren();
    const title = document.createElement('div'); title.className = 'panel-title'; title.textContent = kind === 'notes' ? '多音符编辑' : '多事件编辑'; root.append(title);
    const parametersBox = document.createElement('details'); parametersBox.className = 'batch-parameters'; root.append(parametersBox);
    const parametersHeading = document.createElement('summary'); parametersHeading.textContent = '参数历史与收藏'; parametersBox.append(parametersHeading);
    const history = controlSelect(parametersBox, '应用历史', '', []);
    const historyActions = document.createElement('div'); historyActions.className = 'action-grid'; parametersBox.append(historyActions);
    const previous = document.createElement('button'); previous.textContent = '← 上一组';
    const next = document.createElement('button'); next.textContent = '下一组 →'; historyActions.append(previous, next);
    const saved = controlSelect(parametersBox, '已保存参数', '', []);
    const name = controlInput(parametersBox, '参数名称', ''); name.maxLength = 80;
    const savedActions = document.createElement('div'); savedActions.className = 'action-grid'; parametersBox.append(savedActions);
    const save = document.createElement('button'); save.textContent = '保存当前参数';
    const remove = document.createElement('button'); remove.textContent = '删除收藏'; savedActions.append(save, remove);
    hint(parametersBox, '历史保留最近 50 组已应用参数。命名收藏与草稿保存在本机，可跨谱面使用；同名保存会更新。');
    this.updateHistory = (): void => {
      history.replaceChildren(new Option('选择已应用参数', ''), ...this.parameters.history[kind].map((value, index) => new Option(`${index + 1} · ${value.mode === 'script' ? '脚本' : value.mode === 'clone' ? '克隆' : `${value.field} ${value.operation} ${value.lower}…${value.upper}`}`, String(index))));
      saved.replaceChildren(new Option('选择收藏', ''), ...this.parameters.saved[kind].map(entry => new Option(entry.name, entry.name)));
      previous.disabled = next.disabled = !this.parameters.history[kind].length;
    };
    const loadHistory = (index: number): void => {
      const entries = this.parameters.history[kind]; if (!entries.length) return;
      const position = (index + entries.length) % entries.length; history.value = String(position); this.load(entries[position]);
    };
    history.onchange = () => { if (history.value !== '') loadHistory(Number(history.value)); };
    previous.onclick = () => loadHistory(history.value === '' ? this.parameters.history[kind].length - 1 : Number(history.value) - 1);
    next.onclick = () => loadHistory(history.value === '' ? 0 : Number(history.value) + 1);
    saved.onchange = () => { const entry = this.parameters.saved[kind].find(entry => entry.name === saved.value); if (entry) { name.value = entry.name; this.load(entry.value); } };
    save.onclick = () => { try { this.parameters.save(kind, name.value, this.read()); this.updateHistory(); saved.value = name.value.trim(); this.notify('批量参数已保存到本机', 'success'); } catch (error) { this.notify(error instanceof Error ? error.message : String(error), 'warning'); } };
    remove.onclick = () => { if (saved.value) { this.parameters.remove(kind, saved.value); this.updateHistory(); } };
    this.updateHistory();
    hint(root, '在左侧选择物件，调整后先看预览，再应用。虚线为结果，原物件保持不变。');
    const mode = controlSelect(root, '编辑模式', 'form', [['form', '原版批量编辑'], ['script', '脚本编辑'], ...(kind === 'events' ? [['clone', '克隆（批量复制）']] : [])] as ControlOption[]);
    const isMultiEventEdit = kind === 'events' && this.getSession().multiLineActive && this.getSession().multiLineMode === 'events';
    const applicationMode = isMultiEventEdit ? controlSelect(root, '多线应用', 'per-line', [['per-line', '每条线分别应用'], ['global', '总体按时间顺序应用']]) : null;
    const common = document.createElement('div'); root.append(common);
    // The two option lists come from const-typed module tables, so they are narrowed to the
    // `[value, label]` pairs `controlSelect` builds `<option>`s from.
    const noteKinds: ControlOption[] = [[0, '全部'], [1, 'Tap'], [2, 'Hold'], [3, 'Flick'], [4, 'Drag']];
    const eventKinds: ControlOption[] = EVENT_BATCH_TYPES;
    const filter = controlSelect(common, kind === 'notes' ? '音符种类' : '事件种类', kind === 'notes' ? '0' : 'all', kind === 'notes' ? noteKinds : eventKinds);

    const condition = controlInput(common, '筛选条件', ''); condition.placeholder = kind === 'notes' ? '例如 x < 0 && t1 >= 4' : '例如 start != end';
    const form = document.createElement('div'); root.append(form);
    const field = controlSelect(form, '数值种类', kind === 'notes' ? 'x' : 'both', kind === 'notes' ? NOTE_BATCH_FIELDS : EVENT_BATCH_FIELDS);
    const operation = controlSelect(form, '修改方式', 'By', BATCH_OPERATIONS);
    const readDistribution = distributionFields(form);
    if (kind === 'events') {
      const tools = document.createElement('div'); tools.className = 'action-grid'; form.append(tools);
      for (const [action, title] of [['cut', '批量切割'], ['stick', '批量粘合']] as [string, string][]) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = title;
        // `app.ts` hangs `division`, `cutDensity` and `tempo` off the session in `renderSession`,
        // which is exactly the shape `runEventTool` declares; `EventToolSession` is not exported,
        // so the same three members are spelled out here rather than widening the session type.
        const toolSession = this.getSession() as EditorSession & { division: number; cutDensity: number };
        button.onclick = () => runEventTool(toolSession, action, this.notify, this.timeline.origin); tools.append(button);
      }
      hint(form, '粘合：首值接前一事件尾值。切割：按“横线细分 × 设置中的切割密度”采样为线性段，跳过文字、着色器和零长度事件。');
    }
    hint(form, '周期：空格分隔，_ 跳过该项。扰动：一个数为 ±范围，两个数为区间，更多数为随机选值。HitSound 使用 To，下界填项目内文件名。');
    if (kind === 'events') hint(form, '原版普通属性按 1/N…1 分配；Duration、Order、Line 按 0…1 分配。Duration 会首尾相接；Order 只重排内容；Line 保留源事件并复制到目标线。');
    const scriptBox = document.createElement('div'); scriptBox.hidden = true; root.append(scriptBox);
    const script = document.createElement('textarea'); script.rows = 7; script.className = 'batch-script'; script.setAttribute('aria-label', '批量编辑脚本');
    script.value = kind === 'notes' ? 'x = lerp(-500, 500, u);\nsize = 1 + 0.25 * sin(u * pi);' : 'start += 20 * sin(u * pi);\nend += 20 * sin(u * pi);';
    scriptBox.append(script);
    const help = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = '脚本语法与变量'; help.append(summary); scriptBox.append(help);
    hint(help, '每行一个赋值，支持 = += -= *= /=、算术、比较、&& ||、条件 ? 值 : 值、# 注释。不执行 JavaScript，不访问文件或网络，无循环。');
    hint(help, 'i 从 0 开始；N 为数量；u 为 0…1；原版 n：音符从 0、事件从 1。t1/t2 以拍为单位，visibleTime 以秒为单位。表达式按语句顺序计算。');
    hint(help, `可写：${(kind === 'notes' ? NOTE_BATCH_FIELDS : EVENT_BATCH_FIELDS).map(([key]) => key).filter(key => !['hitSound', 'both', 'order'].includes(key)).join(', ')}${kind === 'notes' ? ', type, isFake, above' : ', inst'}。事件按种类分别排序。`);
    hint(help, '函数：sin cos tan abs min max floor ceil round sqrt pow clamp lerp ease；常量 pi。例：t1 += i / 4; t2 += i / 4;');
    const clone = document.createElement('div'); clone.hidden = true; root.append(clone);
    const targets = control(clone, '目标线号序列', String(this.getSession().lineIndex));
    const increment = control(clone, '时间增量（横线数）', '0');
    const retainLabel = document.createElement('label'); retainLabel.className = 'field'; retainLabel.append('保留源事件');
    const retainSource = document.createElement('input'); retainSource.type = 'checkbox'; retainSource.checked = true; retainSource.setAttribute('aria-label', '保留源事件'); retainLabel.append(retainSource); clone.append(retainLabel);
    hint(clone, '线号用空格分隔，可重复。第一个副本时间不变；后续每份递增“横线数 ÷ 当前横线细分”拍。取消保留源事件后，应用时移除选中的源事件；副本和未选中的事件保留，基础事件留在同一层。');
    // Keyed by event type; each value is the reader/writer pair of that channel's offset rows.
    const channels = new Map<string, DistributionFields>();
    for (const [type, name] of EVENT_BATCH_TYPES.slice(1, 5)) {
      const details = document.createElement('details'); const heading = document.createElement('summary'); heading.textContent = `${name} 数值偏移`; details.append(heading); clone.append(details);
      channels.set(type, distributionFields(details, `${name} · `));
    }
    hint(clone, 'X、Y、旋转、透明度分别按目标线顺序分配偏移；速度及特殊事件保持数值。缓动、Bezier、绑定组与未知属性保留。');
    const randomButton = document.createElement('button'); randomButton.type = 'button'; randomButton.textContent = '重新采样扰动'; root.append(randomButton);
    randomButton.onclick = () => { this.seed++; this.parameters.update(kind, this.read()); this.refresh(); };
    this.summary = hint(root, ''); this.summary.setAttribute('role', 'status');
    const previewLabel = document.createElement('label'); previewLabel.className = 'batch-preview-toggle';
    const preview = document.createElement('input'); preview.type = 'checkbox'; preview.checked = true; previewLabel.append(preview, '在编辑区显示结果虚影'); root.append(previewLabel); this.previewEnabled = preview;
    const actions = document.createElement('div'); actions.className = 'action-grid batch-panel-actions'; root.append(actions);
    this.apply = document.createElement('button'); this.apply.type = 'button'; this.apply.className = 'primary'; this.apply.textContent = '应用更改';
    const reset = document.createElement('button'); reset.type = 'button'; reset.textContent = '重置参数';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = '返回谱面工具'; actions.append(this.apply, reset, cancel);
    cancel.onclick = () => this.close();
    this.read = (): MultiEditRead => ({ ...readDistribution(), mode: mode.value, field: field.value, operation: operation.value,
      eventApplicationMode: applicationMode?.value ?? 'per-line',
      noteType: kind === 'notes' ? Number(filter.value) : 0, eventType: kind === 'events' ? batchEventType(filter.value) : 'all',
      condition: condition.value, script: script.value, seed: this.seed, targets: targets.value, increment: increment.value, retainSource: retainSource.checked,
      division: this.timeline.division, channels: Object.fromEntries([...channels].map(([key, read]) => [key, read()])) });
    const updateMode = (): void => {
      form.hidden = mode.value !== 'form'; scriptBox.hidden = mode.value !== 'script'; clone.hidden = mode.value !== 'clone'; common.hidden = mode.value === 'clone';
    };
    this.load = (value: BatchParameters): void => {
      mode.value = value.mode; field.value = value.field; operation.value = value.operation; if (applicationMode) applicationMode.value = value.eventApplicationMode ?? 'per-line'; filter.value = kind === 'notes' ? String(value.noteType) : value.eventType;
      condition.value = value.condition; script.value = value.script; this.seed = value.seed; targets.value = value.targets; increment.value = String(value.increment);
      retainSource.checked = value.retainSource !== false;
      readDistribution.write(value); for (const [key, read] of channels) read.write(value.channels?.[key] ?? {});
      updateMode(); this.parameters.update(kind, this.read()); this.refresh();
    };
    reset.onclick = () => { this.parameters.reset(kind); this.load(this.parameters.read(kind)); };
    root.oninput = event => {
      if (parametersBox.contains(event.target as Node | null)) return;
      updateMode(); this.parameters.update(kind, this.read());
      this.refresh();
    };
    this.apply.onclick = () => {
      this.refresh(); if (!this.result) return;
      const result = this.result; const amount = result.changes.length;
      this.committing = true;
      try {
        // `MultiEditResult` carries every member `commitSelectionEdit` writes except
        // `multiLineSelection`, which the batch previews never touch (they work on one layer at a
        // time); the optional member is therefore absent, which the writer already tolerates.
        const commit: SelectionEditResult = result;
        commitSelectionEdit(this.getSession(), commit, mode.value === 'clone' ? '批量克隆事件' : `多${kind === 'notes' ? '音符' : '事件'}编辑`);
        const position = this.parameters.remember(kind, this.read()); this.updateHistory(); history.value = String(position);
        this.result = null; this.chart = this.getSession().chart; this.signature = this.selectionSignature();
        this.summary.textContent = `已应用 ${amount} 个物件；参数已保留。调整参数可预览下一次修改。`;
        this.notify(`已应用 ${amount} 个物件的批量编辑`, 'success'); this.invalidate();
      }
      catch (error) { this.notify(error instanceof Error ? error.message : String(error), 'error'); }
      finally { this.committing = false; }
    };
    this.load(this.parameters.read(kind));
    this.sync();
    const inspector = root.closest('.inspector'); if (inspector) inspector.scrollTop = 0;
  }

  hide() { this.active = false; this.result = null; this.previewHovered = false; this.invalidate(); }

  sync() {
    if (!this.active || this.committing) return;
    const session = this.getSession();
    const signature = this.selectionSignature();
    if (session.chart === this.chart && signature === this.signature) return;
    this.chart = session.chart; this.signature = signature; this.refresh();
  }

  selectionSignature(): string {
    const session = this.getSession();
    const multiEvents = [...(session.multiEventSelection ?? new Map())].map(([line, values]) => `${line}:${[...values].sort().join(',')}`).sort().join('|');
    return `${session.lineIndex}:${session.eventLayer}:${this.timeline.division}:${[...session.selection]}:${[...session.eventSelection]}:${multiEvents}`;
  }

  refresh(): void {
    this.result = null;
    try {
      const snapshot = captureSelection(this.getSession()); const options = this.read();
      // `CloneOptions` declares `targets?: string[]`, but the clone callers — this panel and
      // `test/multi-edit.test.ts` — pass the raw 目标线号序列 text and `sequence()` splits it
      // itself. The clone options are therefore built from the same read with that one field
      // re-viewed as the string it actually is at runtime.
      const cloneOptions: CloneOptions = { ...options, targets: options.targets as unknown as string[] };
      this.result = options.mode === 'clone' ? previewEventClones(snapshot, cloneOptions) : previewMultiEdit(snapshot, this.kind, options);
      this.summary.textContent = `${this.result.changes.length} 个结果 · ${new Set(this.result.changes.map(change => change.lineIndex)).size} 条判定线 · 应用后可一次撤销`;
      this.summary.classList.remove('batch-error');
    } catch (error) { this.summary.textContent = error instanceof Error ? error.message : String(error); this.summary.classList.add('batch-error'); }
    this.apply.disabled = !this.result;
    this.invalidate();
  }

  drawTimeline(): void {
    if (!this.active || !this.result || !this.previewEnabled.checked || this.previewHovered === false) return;
    const timeline = this.timeline; const session = this.getSession();
    const canvas = this.kind === 'notes' ? timeline.notesCanvas : timeline.eventsCanvas;
    if (!canvas.clientWidth || this.kind === 'events' && timeline.notesOnly) return;
    // `getContext('2d')` only returns null for a context type the canvas cannot provide, and the
    // editor's own timeline canvases are always created as 2D; the original dereferenced it
    // unguarded here.
    const context = canvas.getContext('2d')!; context.save(); context.setLineDash([5, 3]); context.lineWidth = 2;
    context.beginPath(); context.rect(0, this.kind === 'events' ? 23 : 0, canvas.clientWidth, canvas.clientHeight); context.clip();
    // Keyed `<lineIndex>:<type>`; each value is the numeric span the ghost curves are drawn
    // against, grown from the change's own start/end values and the line's chain range.
    const ranges = new Map<string, [number, number]>();
    if (this.kind === 'events') for (const change of this.result.changes) {
      const rangeKey = `${change.lineIndex}:${change.type}`;
      const range = ranges.get(rangeKey) ?? [Infinity, -Infinity];
      // `type` is optional on a batch change; a change without one has no track to look a chain up on,
      // and `indexOf(undefined)` returned -1 there, which is what the guard reproduces.
      const column = change.type === undefined ? -1 : timeline.eventTypes.indexOf(change.type);
      const chain = change.lineIndex === session.lineIndex && column >= 0 ? timeline.chainRanges?.[column]?.get(change.index) : null;
      if (typeof chain?.min === 'number' && typeof chain?.max === 'number') { range[0] = Math.min(range[0], chain.min); range[1] = Math.max(range[1], chain.max); }
      for (const item of [change.before, change.after]) if (typeof item.start === 'number' && typeof item.end === 'number') {
        range[0] = Math.min(range[0], item.start, item.end); range[1] = Math.max(range[1], item.start, item.end);
      }
      ranges.set(rangeKey, range);
    }
    for (const change of this.result.changes) {
      const item = change.after;
      const lineIndex = Number.isInteger(change.lineIndex) ? change.lineIndex : session.lineIndex;
      const multiArea = session.multiLineActive && session.multiLineMode === this.kind;
      const width = canvas.clientWidth;
      const panelWidth = multiArea ? timeline.panelWidth(width, this.kind) : width;
      const panelOffset = multiArea ? timeline.panelIndex(lineIndex, this.kind) * timeline.panelStride(width, this.kind) - timeline.multiLineViewportOffset(width, this.kind) : 0;
      // `change.type` is optional, but every branch that reaches here is events mode, where the
      // producer always sets it; the `paintEvents` comparison below is the only reader and an absent
      // type simply is not `paintEvents`, which is what the untyped property read did.
      const type = change.type;
      const vertical = (beat: number): number => multiArea ? timeline.verticalForLine(beat, lineIndex, canvas.clientHeight) : type === 'paintEvents' ? timeline.eventVertical(beat, type) : timeline.vertical(beat);
      const top = vertical(beatValue(item.endTime)); const bottom = vertical(beatValue(item.startTime));
      if (top > canvas.clientHeight || bottom < 0) continue;
      if (this.kind === 'notes') {
        // The notes branch only ever receives note payloads: `kind` is the discriminator the producer
        // used to build `before`/`after`. The check below is what states that for the compiler; a
        // note always carries a numeric `positionX`, which no `ChartEvent` has, so skipping a
        // payload without one cannot discard a real note.
        if (!isNote(item)) continue;
        context.strokeStyle = NOTE_COLORS[item.type] ?? '#fff';
        const noteWidth = timeline.noteWidth(item);
        const horizontal = timeline.clampNoteHorizontal(timeline.noteHorizontal(item.positionX, lineIndex), noteWidth, canvas.clientWidth, lineIndex);
        if (horizontal != null) context.strokeRect(horizontal - noteWidth / 2 - 3, Math.max(-10, top - 7), noteWidth + 6, Math.min(canvas.clientHeight + 20, Math.max(14, bottom - Math.max(-10, top) + 14)));
      } else {
        const column = type === undefined ? -1 : timeline.eventTypes.indexOf(type); if (column < 0) continue;
        const localBounds = timeline.eventColumnBounds(column, panelWidth);
        const bounds = { x: panelOffset + localBounds.x, width: localBounds.width };
        context.save(); context.beginPath(); context.rect(bounds.x, 23, bounds.width, canvas.clientHeight); context.clip();
        context.strokeStyle = '#a4b0bd'; context.setLineDash([2, 4]); context.lineWidth = 1;
        drawEventGhost(context, change.before, bounds.x, bounds.width, vertical, ranges.get(`${lineIndex}:${change.type}`));
        context.fillStyle = '#67e8c022'; context.fillRect(bounds.x, top, bounds.width, Math.max(2, bottom - top));
        context.strokeStyle = '#8effd0'; context.setLineDash([5, 3]); context.lineWidth = 2.5;
        drawEventGhost(context, item, bounds.x, bounds.width, vertical, ranges.get(`${lineIndex}:${change.type}`));
        context.font = '12px RPE, sans-serif'; context.textAlign = 'center';
        // The value shown is an event's numeric start/end, or its shader name; the formatter renders
        // a finite number to three decimals and anything else as text, as it did untyped.
        const format = (value: unknown): string => typeof value === 'number' && Number.isFinite(value) ? Number(value.toFixed(3)).toString() : Array.isArray(value) ? value.join(',') : String(value ?? '');
        if (bottom - top > 24) {
          const labels: [unknown, number][] = [[item.end ?? item.shader, Math.max(36, top + 13)], [item.start ?? item.shader, Math.min(canvas.clientHeight - 5, bottom - 4)]];
          for (const [value, position] of labels) {
            context.fillStyle = '#203c33'; context.fillRect(bounds.x + 2, position - 11, bounds.width - 4, 14);
            context.fillStyle = '#baffdf'; context.fillText(format(value), bounds.x + bounds.width / 2, position, bounds.width - 8);
          }
        }
        context.restore();
      }
    }
    context.restore();
  }
}

/**
 * Draws one event's ghost curve.
 *
 * `event` is either a `ChartEvent` (events mode) or a `Note` (notes mode); both carry the same
 * start/end times, easing fields and optional Bezier control points this reads, which is the shape
 * `GhostEvent` names.
 */
/**
 * Draws one event's ghost curve.
 *
 * `event` is a `ChartEvent` (events mode) or a `Note` (notes mode); see {@link GhostEvent}. The
 * `range` default is computed from the event's own `start`/`end`, which a note does not carry — the
 * original read them unguarded there, so a note yields the `NaN` pair `Math.min(undefined, …)`
 * produces and the curve below is skipped by the `typeof` guard, exactly as before.
 */
function drawEventGhost(context: CanvasRenderingContext2D, event: GhostEvent, horizontal: number, width: number, vertical: (beat: number) => number, range?: [number, number]): void {
  const start = beatValue(event.startTime); const end = beatValue(event.endTime);
  const top = vertical(end); const bottom = vertical(start);
  context.strokeRect(horizontal, top, width, Math.max(2, bottom - top));
  if (typeof event.start !== 'number' || typeof event.end !== 'number') return;
  // Bound after the guard, so the values are known numbers and the pair matches the original's
  // `Math.min(event.start, event.end)` / `Math.max(…)` default exactly.
  const bounds: [number, number] = range ?? [Math.min(event.start, event.end), Math.max(event.start, event.end)];
  context.beginPath();
  const from = event.start; const to = event.end;
  for (let step = 0; step <= 30; step++) {
    const progress = step / 30;
    const amount = event.bezier ? bezier(progress, event.bezierPoints) : easing(progress, event.easingType ?? 1, event.easingLeft ?? 0, event.easingRight ?? 1);
    const value = from + (to - from) * amount;
    const position = horizontal + 5 + (bounds[0] === bounds[1] ? 0.5 : (value - bounds[0]) / (bounds[1] - bounds[0])) * (width - 10);
    if (!step) context.moveTo(position, vertical(start)); else context.lineTo(position, vertical(start + (end - start) * progress));
  }
  context.stroke();
}
