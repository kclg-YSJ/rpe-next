import { assertChart, noteIsAbove } from '../core/chart.ts';
import { beatValue, fromNumber } from '../core/beat.ts';
import { snapPosition, verticalGrid } from '../core/edit-grid.ts';
import { alignShaderParameters } from '../core/shader-events.ts';
import { chartWithEventLists, eventList, eventListAt, eventKey, selectedEvents, transformEvents } from './event-commands.ts';
import type { EventEditSession, EventListSource } from './event-commands.ts';
import type { AnyEventType, Beat, Chart, ChartEvent, EventValue, Note, NoteType } from '../core/types.ts';

/**
 * The ES2023 copying-sort entry point, declared locally.
 *
 * `tsconfig.json` pins `lib` to ES2022, which does not carry `Array.prototype.toSorted`, but the
 * runtime (Node >= 22, and every browser this editor targets) is ES2023. Declaring the method here
 * keeps the call site on the native implementation instead of widening `lib` or swapping in a
 * `slice().sort()` that would allocate differently.
 */
declare global {
  interface Array<T> {
    toSorted(compareFn?: (a: T, b: T) => number): T[];
  }
}

/** The 12 batch actions, as `[id, Chinese label]` pairs shown by the batch controls. */
export const BATCH_ACTIONS: [string, string][] = [
  ['MirrorY', '绕 X=0 镜像'], ['MirrorMid', '绕选中音符的横向中心镜像'],
  ['SideSwitch', '切换上下侧'], ['SideUp', '全部移至上侧'], ['SideDown', '全部移至下侧'],
  ['ToReal', '变为真音符'], ['ToFake', '变为假音符'], ['ToTap', '转为 Tap'],
  ['ToFlick', '转为 Flick'], ['ToDrag', '转为 Drag'], ['ToHold', '转为 Hold（新增长度 1/4 拍）'], ['AttachX', '吸附至最近竖线'],
];

/** `ToTap`/`ToFlick`/`ToDrag`/`ToHold` keyed by batch action id. */
const NOTE_TYPE_BY_ACTION: Record<string, NoteType> = { ToTap: 1, ToFlick: 3, ToDrag: 4, ToHold: 2 };

/** One selected note, with the line it lives on already resolved from the multi-line map. */
export interface NoteEntry {
  lineIndex: number;
  index: number;
  note: Note;
}

/** One selected event, with the line it lives on already resolved from the multi-line map. */
export interface EventEntry {
  lineIndex: number;
  index: number;
  type: AnyEventType;
  event: ChartEvent;
}

/** Which part of an item's beat range a shift moves. */
export type TimePart = 'both' | 'start' | 'end';

/** The kind of object a control ball is dragging. */
export type ControlKind = 'note-move' | 'note-scale' | 'note-line' | 'event-move' | 'event-start' | 'event-end';

/**
 * A frozen copy of everything an edit needs.
 *
 * Control balls, batch actions and clipboard operations all preview against a snapshot and only
 * commit the finished chart, which is what keeps a drag from writing a history entry per frame.
 */
export interface SelectionSnapshot {
  chart: Chart;
  lineIndex: number;
  eventLayer: number;
  focus: string;
  shaderAutoAlign?: boolean;
  notes: NoteEntry[];
  events: EventEntry[];
}

/** Per-item hooks for {@link editCapturedSelection}; both default to the identity. */
export interface SelectionEdit {
  note?: (note: Note, entry: NoteEntry) => Note;
  event?: (event: ChartEvent, type: AnyEventType, entry: EventEntry) => ChartEvent;
  lineOffset?: number;
}

/** What {@link editCapturedSelection} produces and {@link commitSelectionEdit} applies. */
export interface SelectionEditResult {
  chart: Chart;
  lineIndex: number;
  eventLayer: number;
  focus: string;
  selection: Set<number>;
  eventSelection: Set<string>;
  multiEventSelection: Map<number, Set<string>>;
  /**
   * The per-line note selections a multi-line edit produced.
   *
   * Optional because not every producer has one: `editCapturedSelection` always fills it in, while a
   * `MultiEditResult` batches one layer at a time and carries no per-line selection at all.
   * `commitSelectionEdit` already reads it as optional (it only assigns the session's map when the
   * member is present), so the batch panel can hand its result straight over.
   */
  multiLineSelection?: Map<number, Set<number>>;
}

/** Per-line note deltas of a control drag. */
export interface ControlOptions {
  deltaBeat?: number;
  deltaBeatByLine?: Map<number, number> | null;
  deltaX?: number;
  dragX?: number;
  anchorMode?: number;
  snapX?: boolean;
  gridCount?: number;
}

/**
 * The subset of {@link EditorSession} the batch helpers read and write.
 *
 * Extends {@link EventEditSession} so a snapshot holder can be handed straight to the event
 * commands; the extra members are the multi-line notes side and the writable `chart`/`selection`
 * that {@link commitSelectionEdit} assigns.
 */
export interface BatchEditSession extends EventEditSession {
  multiLineActive: boolean;
  multiLineMode: string;
  selection: Set<number>;
  multiLineSelection?: Map<number, Set<number>>;
  notes: Note[];
}

export function captureSelection(session: BatchEditSession): SelectionSnapshot {
  const events: EventEntry[] = session.multiLineActive && session.multiLineMode === 'events'
    ? [...(session.multiEventSelection ?? new Map<number, Set<string>>())].flatMap(([lineIndex, selection]) => [...selection].map(key => {
      const [type, indexText] = String(key).split(':'); const index = Number(indexText);
      return { type: type as AnyEventType, index, lineIndex, event: eventListAt(session, lineIndex, type as AnyEventType)?.[index] as ChartEvent };
    })).filter(entry => entry.event)
    : selectedEvents(session).map(entry => ({ ...entry, lineIndex: session.lineIndex }));
  const notes: NoteEntry[] = session.multiLineActive && session.multiLineMode === 'notes'
    ? [...(session.multiLineSelection ?? new Map<number, Set<number>>())].flatMap(([lineIndex, selection]) => [...selection].map(index => ({ lineIndex, index, note: session.chart.judgeLineList?.[lineIndex]?.notes?.[index] as Note }))).filter(entry => entry.note)
    : [...session.selection].sort((left, right) => left - right).filter(index => session.notes[index]).map(index => ({ lineIndex: session.lineIndex, index, note: session.notes[index] }));
  return { chart: session.chart, lineIndex: session.lineIndex, eventLayer: session.eventLayer, focus: session.focus,
    shaderAutoAlign: session.shaderAutoAlign, notes, events };
}

/** A read-only event-list source for one line, used by the per-line preview passes. */
function eventSession(chart: Chart, lineIndex: number, eventLayer: number): EventListSource {
  return { chart, lineIndex, eventLayer };
}

export function editCapturedSelection(snapshot: SelectionSnapshot, { note = (value: Note) => value, event = (value: ChartEvent) => value, lineOffset = 0 }: SelectionEdit = {}): SelectionEditResult {
  const sourceIndex = snapshot.lineIndex;
  const count = snapshot.chart.judgeLineList.length;
  const targetIndex = ((sourceIndex + lineOffset) % count + count) % count;
  let chart = snapshot.chart;
  const selection = new Set<number>(); const eventSelection = new Set<string>();
  const multiLineSelection = new Map<number, Set<number>>();
  if (snapshot.notes.length) {
    const lines = [...chart.judgeLineList];
    const grouped = new Map<number, NoteEntry[]>();
    for (const entry of snapshot.notes) {
      const entrySource = Number.isInteger(entry.lineIndex) ? entry.lineIndex : sourceIndex;
      if (!grouped.has(entrySource)) grouped.set(entrySource, []);
      grouped.get(entrySource)!.push(entry);
    }
    for (const [entrySource, entries] of grouped) {
      const entryTarget = ((entrySource + lineOffset) % count + count) % count;
      const source = lines[entrySource]; const target = lines[entryTarget];
      if (!source || !target) continue;
      const updates = new Map<number, Note>(entries.map(entry => [entry.index, note(entry.note, entry)]));
      let nextNotes: Note[];
      const selectedIndices = new Set<number>();
      if (entrySource === entryTarget) {
        nextNotes = (source.notes ?? []).map((item, index) => updates.get(index) ?? item);
        for (const index of updates.keys()) selectedIndices.add(index);
      } else {
        const remaining = (source.notes ?? []).filter((item, index) => !updates.has(index));
        lines[entrySource] = { ...source, notes: remaining, numOfNotes: remaining.length };
        nextNotes = [...(target.notes ?? []), ...updates.values()];
        for (let index = nextNotes.length - updates.size; index < nextNotes.length; index++) selectedIndices.add(index);
      }
      lines[entryTarget] = { ...target, notes: nextNotes, numOfNotes: nextNotes.length };
      multiLineSelection.set(entryTarget, selectedIndices);
      if (entryTarget === sourceIndex || (grouped.size === 1 && entryTarget === targetIndex)) for (const index of selectedIndices) selection.add(index);
    }
    chart = { ...chart, judgeLineList: lines };
  }
  const entriesByLine = new Map<number, EventEntry[]>();
  for (const entry of snapshot.events) {
    const lineIndex = Number.isInteger(entry.lineIndex) ? entry.lineIndex : sourceIndex;
    if (!entriesByLine.has(lineIndex)) entriesByLine.set(lineIndex, []);
    entriesByLine.get(lineIndex)!.push(entry);
  }
  const sourceUpdatesByLine = new Map<number, Map<AnyEventType, ChartEvent[]>>(); const targetUpdatesByLine = new Map<number, Map<AnyEventType, ChartEvent[]>>();
  const multiEventSelection = new Map<number, Set<string>>();
  for (const [entrySource, entries] of entriesByLine) {
    const entryTarget = ((entrySource + lineOffset) % count + count) % count;
    const types = new Set(entries.map(entry => entry.type));
    for (const type of types) {
      const selected = new Map<number, ChartEvent>(entries.filter(entry => entry.type === type).map(entry => {
        let next = event(entry.event, type, entry);
        if (type === 'paintEvents' && snapshot.shaderAutoAlign !== false && beatValue(next.startTime) !== beatValue(entry.event.startTime)) next = alignShaderParameters(next);
        return [entry.index, next];
      }));
      const original = eventList(eventSession(chart, entrySource, snapshot.eventLayer), type);
      if (entrySource === entryTarget) {
        if (!sourceUpdatesByLine.has(entrySource)) sourceUpdatesByLine.set(entrySource, new Map<AnyEventType, ChartEvent[]>());
        sourceUpdatesByLine.get(entrySource)!.set(type, original.map((item, index) => selected.get(index) ?? item));
        if (!multiEventSelection.has(entrySource)) multiEventSelection.set(entrySource, new Set<string>());
        for (const index of selected.keys()) { const key = eventKey(type, index); multiEventSelection.get(entrySource)!.add(key); if (entrySource === sourceIndex) eventSelection.add(key); }
      } else {
        if (!sourceUpdatesByLine.has(entrySource)) sourceUpdatesByLine.set(entrySource, new Map<AnyEventType, ChartEvent[]>());
        sourceUpdatesByLine.get(entrySource)!.set(type, original.filter((item, index) => !selected.has(index)));
        const target = [...eventList(eventSession(chart, entryTarget, snapshot.eventLayer), type)];
        if (!targetUpdatesByLine.has(entryTarget)) targetUpdatesByLine.set(entryTarget, new Map<AnyEventType, ChartEvent[]>());
        const targetSelection = multiEventSelection.get(entryTarget) ?? new Set<string>();
        for (const next of selected.values()) { const key = eventKey(type, target.length); targetSelection.add(key); if (entryTarget === sourceIndex || entriesByLine.size === 1) eventSelection.add(key); target.push(next); }
        targetUpdatesByLine.get(entryTarget)!.set(type, target); multiEventSelection.set(entryTarget, targetSelection);
      }
    }
  }
  for (const [lineIndex, updates] of sourceUpdatesByLine) if (updates.size) chart = chartWithEventLists(chart, lineIndex, snapshot.eventLayer, updates);
  for (const [lineIndex, updates] of targetUpdatesByLine) if (updates.size) chart = chartWithEventLists(chart, lineIndex, snapshot.eventLayer, updates);
  return { chart, lineIndex: entriesByLine.size > 1 ? sourceIndex : targetIndex, eventLayer: snapshot.eventLayer, focus: snapshot.focus, selection, eventSelection, multiEventSelection, multiLineSelection };
}

/** Writes a previewed edit back into the session as one undoable command. */
export function commitSelectionEdit(session: BatchEditSession, result: SelectionEditResult, label: string): boolean {
  if (result.chart === session.chart) return false;
  assertChart(result.chart);
  const beforeSelection = session.selectionState();
  if (!(session.multiLineActive && ((result.multiEventSelection?.size ?? 0) > 0 || (result.multiLineSelection?.size ?? 0) > 0))) session.lineIndex = result.lineIndex;
  session.eventLayer = result.eventLayer; session.focus = result.focus;
  session.selection = result.selection; session.eventSelection = result.eventSelection;
  if (result.multiLineSelection) session.multiLineSelection = new Map([...result.multiLineSelection].map(([line, values]) => [line, new Set(values)]));
  if (result.multiEventSelection) session.multiEventSelection = new Map([...result.multiEventSelection].map(([line, values]) => [line, new Set(values)]));
  session.commit(label, result.chart, beforeSelection);
  return true;
}

/** Shifts a beat range; `part` selects whether the head, the tail or both move. */
export function shiftedTime<T extends { startTime: Beat; endTime: Beat }>(item: T, delta: number, part: TimePart = 'both'): T {
  if (!delta) return item;
  const start = beatValue(item.startTime); const end = beatValue(item.endTime);
  return { ...item, startTime: part === 'end' ? item.startTime : fromNumber(part === 'start' ? Math.min(end, start + delta) : start + delta),
    endTime: part === 'start' ? item.endTime : fromNumber(part === 'end' ? Math.max(start, end + delta) : end + delta) };
}

/** Arrow-key nudge: horizontal moves notes only, vertical moves notes and events together. */
export function nudgeSelection(session: BatchEditSession, direction: string, division: number, gridCount: number): boolean {
  const snapshot = captureSelection(session);
  if (!snapshot.notes.length && !snapshot.events.length) return false;
  const horizontal = direction === 'ArrowLeft' || direction === 'ArrowRight';
  if (horizontal && !snapshot.notes.length) return true;
  const deltaX = horizontal ? verticalGrid(gridCount).spacing / 2 * (direction === 'ArrowLeft' ? -1 : 1) : 0;
  const deltaBeat = horizontal ? 0 : (direction === 'ArrowDown' ? -1 : 1) / division;
  return commitSelectionEdit(session, editCapturedSelection(snapshot, {
    note: item => ({ ...shiftedTime(item, deltaBeat), positionX: item.positionX + deltaX }),
    event: item => shiftedTime(item, deltaBeat),
  }), '方向键移动选中项');
}

export function applyBatchAction(session: BatchEditSession, action: string, gridCount: number): boolean {
  const snapshot = captureSelection(session);
  if (!snapshot.notes.length) return false;
  if (!BATCH_ACTIONS.some(([name]) => name === action)) throw new Error('未知批量操作');
  const positions = snapshot.notes.map(entry => entry.note.positionX);
  const middleSum = positions.reduce((value, position) => Math.min(value, position), Infinity) + positions.reduce((value, position) => Math.max(value, position), -Infinity);
  snapshot.events = [];
  return commitSelectionEdit(session, editCapturedSelection(snapshot, { note: item => {
    if (action === 'MirrorY') return { ...item, positionX: -item.positionX };
    if (action === 'MirrorMid') return { ...item, positionX: middleSum - item.positionX };
    if (action === 'AttachX') return { ...item, positionX: snapPosition(item.positionX, gridCount) };
    if (['SideSwitch', 'SideUp', 'SideDown'].includes(action)) {
      const above = action === 'SideUp' || (action === 'SideSwitch' && !noteIsAbove(item));
      return { ...item, above: above ? 1 : item.type === 2 ? 0 : 2 };
    }
    if (action === 'ToReal' || action === 'ToFake') return { ...item, isFake: action === 'ToFake' ? 1 : 0 };
    const type = NOTE_TYPE_BY_ACTION[action];
    return { ...item, type, above: noteIsAbove(item) ? 1 : type === 2 ? 0 : 2,
      endTime: type === 2 ? item.type === 2 ? item.endTime : fromNumber(beatValue(item.startTime) + 0.25) : [...item.startTime] as Beat };
  } }), `批量 ${action}`);
}

/** Converts a horizontal drag distance into a whole number of judge lines. */
export function controlLineOffset(delta: number, events = false): number {
  const threshold = events ? 75 : 50;
  return Math.abs(delta) < threshold ? 0 : Math.sign(delta) * (1 + Math.floor((Math.abs(delta) - threshold) / 50));
}

/** The X coordinate the scale ball keeps fixed, per anchor mode (0 centre, 1 first, 2 last note). */
export function selectionScaleAnchor(snapshot: SelectionSnapshot, anchorMode = 0): number | null {
  const ordered = snapshot.notes.toSorted((left, right) => beatValue(left.note.startTime) - beatValue(right.note.startTime));
  if (!ordered.length) return null;
  if (anchorMode === 1) return ordered[0].note.positionX;
  if (anchorMode === 2) return ordered.at(-1)!.note.positionX;
  const minimum = ordered.reduce((value, entry) => Math.min(value, entry.note.positionX), Infinity);
  const maximum = ordered.reduce((value, entry) => Math.max(value, entry.note.positionX), -Infinity);
  return (minimum + maximum) / 2;
}

export function controlSelection(snapshot: SelectionSnapshot, kind: ControlKind, { deltaBeat = 0, deltaBeatByLine = null, deltaX = 0, dragX = 0, anchorMode = 0, snapX = false, gridCount = 11 }: ControlOptions = {}): SelectionEditResult {
  const beatDelta = (entry: NoteEntry | EventEntry) => deltaBeatByLine?.get(entry.lineIndex) ?? deltaBeat;
  if (kind === 'note-move') {
    const minimum = snapshot.notes.reduce((value, entry) => Math.min(value, entry.note.positionX), Infinity);
    const maximum = snapshot.notes.reduce((value, entry) => Math.max(value, entry.note.positionX), -Infinity);
    const spacing = verticalGrid(gridCount).spacing;
    if (snapX && Number.isFinite(spacing) && spacing > 0) deltaX = Math.round(deltaX / spacing) * spacing;
    let lower = -675 - minimum; let upper = 675 - maximum;
    if (snapX && Number.isFinite(spacing) && spacing > 0) {
      lower = Math.ceil(lower / spacing) * spacing;
      upper = Math.floor(upper / spacing) * spacing;
    }
    deltaX = Math.max(lower, Math.min(upper, deltaX));
    return editCapturedSelection(snapshot, { note: (item, entry) => ({ ...shiftedTime(item, beatDelta(entry)), positionX: item.positionX + deltaX }) });
  }
  if (kind === 'note-scale') {
    const ordered = snapshot.notes.toSorted((left, right) => beatValue(left.note.startTime) - beatValue(right.note.startTime));
    const minimum = ordered.reduce((value, entry) => Math.min(value, entry.note.positionX), Infinity);
    const maximum = ordered.reduce((value, entry) => Math.max(value, entry.note.positionX), -Infinity);
    const anchor = selectionScaleAnchor(snapshot, anchorMode) ?? 0;
    let rate = 1 + dragX / 300 * (anchorMode === 2 ? -1 : 1);
    if (minimum >= -675 && maximum <= 675) {
      let lower = -Infinity; let upper = Infinity;
      for (const position of [minimum, maximum]) {
        const offset = position - anchor; if (!offset) continue;
        const bounds = [(-675 - anchor) / offset, (675 - anchor) / offset];
        lower = Math.max(lower, Math.min(...bounds)); upper = Math.min(upper, Math.max(...bounds));
      }
      rate = Math.max(lower, Math.min(upper, rate));
    }
    return editCapturedSelection(snapshot, { note: item => ({ ...item, positionX: anchor + (item.positionX - anchor) * rate }) });
  }
  if (kind === 'note-line') return editCapturedSelection(snapshot, { lineOffset: controlLineOffset(dragX) });
  if (kind === 'event-move') return editCapturedSelection(snapshot, { event: (item, unusedType, entry) => shiftedTime(item, beatDelta(entry)), lineOffset: controlLineOffset(dragX, true) });
  return editCapturedSelection(snapshot, { event: (item, unusedType, entry) => shiftedTime(item, beatDelta(entry), kind === 'event-start' ? 'start' : 'end') });
}
