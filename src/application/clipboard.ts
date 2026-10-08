import { beatValue } from '../core/beat.ts';
import { alignShaderParameters } from '../core/shader-events.ts';
import { chartWithEventLists, eventKey, eventListAt } from './event-commands.ts';
import { captureSelection, commitSelectionEdit, shiftedTime } from './batch-edit.ts';
import type { BatchEditSession } from './batch-edit.ts';
import type { AnyEventType, ChartEvent, Note } from '../core/types.ts';

/**
 * The session members clipboard commands touch beyond {@link BatchEditSession}.
 *
 * The clipboard entries mirror the shape of {@link EventEditSession.eventClipboard}; the map
 * members are the multi-line selection state that {@link commitSelectionEdit} rewrites.
 * The optional members are flags that live on the editor session but are not part of the batch-edit
 * surface, so callers that only carry the batch state still satisfy this type.
 */
export interface ClipboardSession extends BatchEditSession {
  clipboard: Note[];
  clipboardNoteLines: number[];
  eventClipboardLines?: number[];
  clipboardVisible?: boolean;
  multiLineSelection?: Map<number, Set<number>>;
  multiEventSelection: Map<number, Set<string>>;
}

/** A clipboard event paired with the track it belongs to. */
export interface ClipboardEventEntry {
  type: AnyEventType;
  event: ChartEvent;
}

/** Optional flags shared by the paste flow. */
export interface ClipboardOptions {
  mirror?: boolean;
  keepTime?: boolean;
  targetLineIndex?: number;
}

/** What {@link projectClipboard} produces: the offset copies plus their destination lines. */
export interface ClipboardProjection {
  notes: Note[];
  events: ClipboardEventEntry[];
  noteLines?: number[];
  eventLines?: number[];
  sourceAnchor?: number;
  targetLineIndex?: number;
}

export function copyObjects(session: ClipboardSession): number {
  const snapshot = captureSelection(session);
  const count = snapshot.notes.length + snapshot.events.length;
  if (!count) return 0;
  session.clipboard = structuredClone(snapshot.notes.map(entry => entry.note));
  session.clipboardNoteLines = snapshot.notes.map(entry => Number.isInteger(entry.lineIndex) ? entry.lineIndex : session.lineIndex);
  session.eventClipboard = structuredClone(snapshot.events.map(({ type, event }) => ({ type, event })));
  session.eventClipboardLines = snapshot.events.map(entry => Number.isInteger(entry.lineIndex) ? entry.lineIndex : session.lineIndex);
  session.clipboardVisible = true;
  return count;
}

export function cutObjects(session: ClipboardSession): number {
  const count = copyObjects(session);
  if (!count) return 0;
  deleteObjects(session, '剪切选中项');
  return count;
}

export function deleteObjects(session: ClipboardSession, label = '删除选中项'): number {
  const snapshot = captureSelection(session);
  const count = snapshot.notes.length + snapshot.events.length;
  if (!count) return 0;
  // The key is a string while new entries are stored under the numeric line index, so this guard
  // never fires; it is kept verbatim because the migration only adds types.
  const updatesByLine = new Map<number | string, Map<AnyEventType, ChartEvent[]>>();
  for (const entry of snapshot.events) {
    const lineIndex = Number.isInteger(entry.lineIndex) ? entry.lineIndex : session.lineIndex;
    const key = `${lineIndex}:${entry.type}`;
    if (updatesByLine.has(key)) continue;
    const selected = new Set(snapshot.events.filter(item => (item.lineIndex ?? session.lineIndex) === lineIndex && item.type === entry.type).map(item => item.index));
    const original = eventListAt(session, lineIndex, entry.type);
    if (!original) continue;
    if (!updatesByLine.has(lineIndex)) updatesByLine.set(lineIndex, new Map<AnyEventType, ChartEvent[]>());
    updatesByLine.get(lineIndex)!.set(entry.type, original.filter((event, index) => !selected.has(index)));
  }
  let chart = session.chart;
  // Only numeric line indices are ever stored above, so the string-keyed guard never adds a key.
  for (const [lineIndex, updates] of updatesByLine) if (typeof lineIndex === 'number') chart = chartWithEventLists(chart, lineIndex, session.eventLayer, updates);
  const noteEntries = snapshot.notes;
  if (noteEntries.length) {
    const lines = [...chart.judgeLineList];
    const byLine = new Map<number, Set<number>>();
    for (const entry of noteEntries) {
      const lineIndex = Number.isInteger(entry.lineIndex) ? entry.lineIndex : session.lineIndex;
      if (!byLine.has(lineIndex)) byLine.set(lineIndex, new Set<number>());
      byLine.get(lineIndex)!.add(entry.index);
    }
    for (const [lineIndex, selected] of byLine) {
      const line = lines[lineIndex]; if (!line) continue;
      const notes = (line.notes ?? []).filter((note: Note, index: number) => !selected.has(index));
      lines[lineIndex] = { ...line, notes, numOfNotes: notes.length };
    }
    chart = { ...chart, judgeLineList: lines };
  }
  commitSelectionEdit(session, { chart, lineIndex: session.lineIndex, eventLayer: session.eventLayer, focus: session.focus,
    selection: new Set(), eventSelection: new Set(), multiLineSelection: new Map(), multiEventSelection: new Map() }, label);
  return count;
}

export function clipboardStart(session: ClipboardSession): number {
  let earliest = Infinity;
  for (const note of session.clipboard) earliest = Math.min(earliest, beatValue(note.startTime));
  for (const { event } of session.eventClipboard) earliest = Math.min(earliest, beatValue(event.startTime));
  return earliest;
}

export function projectClipboard(session: ClipboardSession, beat: number, { mirror = false, keepTime = false, targetLineIndex }: ClipboardOptions = {}): ClipboardProjection {
  const earliest = clipboardStart(session);
  if (!Number.isFinite(earliest)) return { notes: [], events: [] };
  const delta = keepTime ? 0 : beat - earliest;
  const lineCount = session.chart?.judgeLineList?.length ?? 0;
  const noteSourceLines = session.clipboardNoteLines ?? [];
  const eventSourceLines = session.eventClipboardLines ?? [];
  const noteLines = session.clipboard.map((unused: Note, index: number) => Number.isInteger(noteSourceLines[index]) ? noteSourceLines[index] : session.lineIndex);
  const eventLines = session.eventClipboard.map((unused: ClipboardEventEntry, index: number) => Number.isInteger(eventSourceLines[index]) ? eventSourceLines[index] : session.lineIndex);
  const sourceLines = [...noteLines, ...eventLines];
  const sourceAnchor = sourceLines.length ? Math.min(...sourceLines) : session.lineIndex;
  const target = Number.isInteger(targetLineIndex) ? (targetLineIndex as number) : session.lineIndex;
  const mapLine = (source: number): number => {
    const mapped = target + source - sourceAnchor;
    if (!lineCount) return mapped;
    return ((mapped % lineCount) + lineCount) % lineCount;
  };
  const notes = session.clipboard.map((note: Note) => ({ ...shiftedTime(note, delta), positionX: note.positionX * (mirror ? -1 : 1) }));
  const events = session.eventClipboard.map(({ type, event }: ClipboardEventEntry) => {
    let next = shiftedTime(event, delta);
    if (type === 'paintEvents' && delta && session.shaderAutoAlign !== false) next = alignShaderParameters(next);
    if (mirror && type !== 'alphaEvents' && typeof next.start === 'number' && typeof next.end === 'number') next = { ...next, start: -next.start, end: -next.end };
    return { type, event: next };
  });
  return { notes, events, noteLines: noteLines.map(mapLine), eventLines: eventLines.map(mapLine), sourceAnchor, targetLineIndex: target };
}

export function pasteObjects(session: ClipboardSession, beat: number, options?: ClipboardOptions): boolean {
  const projected = structuredClone(projectClipboard(session, beat, options));
  if (!projected.notes.length && !projected.events.length) return false;
  let chart = session.chart;
  const selection = new Set<number>(); const eventSelection = new Set<string>();
  const multiEventSelection = new Map<number, Set<string>>();
  const eventUpdates = new Map<number, Map<AnyEventType, ChartEvent[]>>();
  for (const [{ type, event }, lineIndex] of projected.events.map((entry: ClipboardEventEntry, index: number): [ClipboardEventEntry, number] => [entry, projected.eventLines?.[index] ?? session.lineIndex])) {
    if (!eventUpdates.has(lineIndex)) eventUpdates.set(lineIndex, new Map<AnyEventType, ChartEvent[]>());
    if (!eventUpdates.get(lineIndex)!.has(type)) eventUpdates.get(lineIndex)!.set(type, [...eventListAt(session, lineIndex, type)]);
    const events = eventUpdates.get(lineIndex)!.get(type)!;
    const key = eventKey(type, events.length); events.push(event);
    if (!multiEventSelection.has(lineIndex)) multiEventSelection.set(lineIndex, new Set<string>());
    multiEventSelection.get(lineIndex)!.add(key);
    if (lineIndex === session.lineIndex) eventSelection.add(key);
  }
  for (const [lineIndex, lineUpdates] of eventUpdates) chart = chartWithEventLists(chart, lineIndex, session.eventLayer, lineUpdates);
  const multiLineSelection = new Map<number, Set<number>>();
  if (projected.notes.length) {
    const lines = [...chart.judgeLineList];
    const grouped = new Map<number, Note[]>();
    projected.notes.forEach((note: Note, index: number) => {
      const lineIndex = projected.noteLines?.[index] ?? session.lineIndex;
      if (!grouped.has(lineIndex)) grouped.set(lineIndex, []);
      grouped.get(lineIndex)!.push(note);
    });
    for (const [lineIndex, notesToAdd] of grouped) {
      const line = lines[lineIndex]; if (!line) continue;
      const existing = line.notes ?? []; const notes = [...existing, ...notesToAdd];
      const selected = new Set(notesToAdd.map((unused: Note, index: number) => existing.length + index));
      lines[lineIndex] = { ...line, notes, numOfNotes: notes.length };
      multiLineSelection.set(lineIndex, selected);
      if (lineIndex === session.lineIndex) for (const index of selected) selection.add(index);
    }
    chart = { ...chart, judgeLineList: lines };
  }
  session.clipboardVisible = true;
  return commitSelectionEdit(session, { chart, lineIndex: session.lineIndex, eventLayer: session.eventLayer,
    focus: projected.notes.length ? 'notes' : 'events', selection, eventSelection,
    multiLineSelection, multiEventSelection }, options?.mirror ? '镜像粘贴' : '粘贴选中项');
}
