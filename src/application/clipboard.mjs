import { beatValue } from '../core/beat.mjs';
import { alignShaderParameters } from '../core/shader-events.mjs';
import { chartWithEventLists, eventKey, eventList, eventListAt } from './event-commands.mjs';
import { captureSelection, commitSelectionEdit, shiftedTime } from './batch-edit.mjs';
import { t } from '../i18n.mjs';
import { expandXyEntries } from './xy-binding.mjs';
import { lineOffsetMapper, lineOrderPositions } from './multi-line-edit.mjs';

export function copyObjects(session, { xy = false } = {}) {
  if (session.largeDocument?.logicalSelection && session.focus === 'notes') return session.largeDocument.copySelected();
  const snapshot = captureSelection(session);
  if (xy && session.xyBinding === true) snapshot.events = expandXyEntries(session.chart, session.eventLayer, snapshot.events);
  const count = snapshot.notes.reduce((sum,entry)=>sum+(session.largeDocument?session.largeDocument.quantity(entry.note):1),0) + snapshot.events.length;
  if (!count) return 0;
  session.clipboard = structuredClone(snapshot.notes.map(entry => session.largeDocument ? session.largeDocument.copyNote(entry.note) : entry.note));
  session.clipboardNoteLines = snapshot.notes.map(entry => Number.isInteger(entry.lineIndex) ? entry.lineIndex : session.lineIndex);
  session.eventClipboard = structuredClone(snapshot.events.map(({ type, event }) => ({ type, event })));
  session.eventClipboardLines = snapshot.events.map(entry => Number.isInteger(entry.lineIndex) ? entry.lineIndex : session.lineIndex);
  session.clipboardLineOrder = session.multiLineActive ? [...session.multiLineIndices] : [];
  session.clipboardBounds = null;
  session.clipboardVisible = true;
  return count;
}

export function cutObjects(session) {
  if (session.largeDocument?.logicalSelection && session.focus === 'notes') return session.largeDocument.copySelected().then(count => { if (count) { session.largeDocument.transformSelected(t('clipboard.s67ac29d'), null, { remove: true }); return session.largeDocument.flush().then(() => count); } return 0; });
  const count = copyObjects(session, { xy: true });
  if (!count) return 0;
  deleteObjects(session, t('clipboard.s67ac29d'));
  return count;
}

export function deleteObjects(session, label = t('clipboard.s324b30a')) {
  if (session.largeDocument?.logicalSelection && session.focus === 'notes') return session.largeDocument.transformSelected(label, null, { remove: true });
  const snapshot = captureSelection(session);
  if (session.xyBinding === true && snapshot.events.length) snapshot.events = expandXyEntries(session.chart, session.eventLayer, snapshot.events);
  const count = snapshot.notes.length + snapshot.events.length;
  if (!count) return 0;
  const updatesByLine = new Map();
  for (const entry of snapshot.events) {
    const lineIndex = Number.isInteger(entry.lineIndex) ? entry.lineIndex : session.lineIndex;
    if (updatesByLine.get(lineIndex)?.has(entry.type)) continue;
    const selected = new Set(snapshot.events.filter(item => (item.lineIndex ?? session.lineIndex) === lineIndex && item.type === entry.type).map(item => item.index));
    const original = eventListAt(session, lineIndex, entry.type);
    if (!original) continue;
    if (!updatesByLine.has(lineIndex)) updatesByLine.set(lineIndex, new Map());
    updatesByLine.get(lineIndex).set(entry.type, original.filter((event, index) => !selected.has(index)));
  }
  let chart = session.chart;
  for (const [lineIndex, updates] of updatesByLine) chart = chartWithEventLists(chart, lineIndex, session.eventLayer, updates);
  const noteEntries = snapshot.notes;
  if (noteEntries.length) {
    const lines = [...chart.judgeLineList];
    const byLine = new Map();
    for (const entry of noteEntries) {
      const lineIndex = Number.isInteger(entry.lineIndex) ? entry.lineIndex : session.lineIndex;
      if (!byLine.has(lineIndex)) byLine.set(lineIndex, new Set());
      byLine.get(lineIndex).add(entry.index);
    }
    for (const [lineIndex, selected] of byLine) {
      const line = lines[lineIndex]; if (!line) continue;
      const notes = (line.notes ?? []).filter((note, index) => !selected.has(index));
      lines[lineIndex] = { ...line, notes, numOfNotes: notes.length };
    }
    chart = { ...chart, judgeLineList: lines };
  }
  commitSelectionEdit(session, { chart, lineIndex: session.lineIndex, eventLayer: session.eventLayer, focus: session.focus,
    selection: new Set(), eventSelection: new Set(), multiLineSelection: new Map(), multiEventSelection: new Map() }, label);
  return count;
}

export function clipboardStart(session) {
  let earliest = Infinity;
  for (const note of session.clipboard) earliest = Math.min(earliest, beatValue(note.startTime));
  for (const { event } of session.eventClipboard) earliest = Math.min(earliest, beatValue(event.startTime));
  return earliest;
}

export function projectClipboard(session, beat, { mirror = false, keepTime = false, targetLineIndex } = {}) {
  if (session.multiLineActive && session.multiLineIndices?.length === 0) return { notes: [], events: [] };
  const earliest = clipboardStart(session);
  if (!Number.isFinite(earliest)) return { notes: [], events: [] };
  const delta = keepTime ? 0 : beat - earliest;
  const lineCount = session.chart?.judgeLineList?.length ?? 0;
  const noteLines = session.clipboard.map((unused, index) => Number.isInteger(session.clipboardNoteLines?.[index]) ? session.clipboardNoteLines[index] : session.lineIndex);
  const eventLines = session.eventClipboard.map((unused, index) => Number.isInteger(session.eventClipboardLines?.[index]) ? session.eventClipboardLines[index] : session.lineIndex);
  const sourceLines = [...noteLines, ...eventLines];
  const target = Number.isInteger(targetLineIndex) ? targetLineIndex : session.lineIndex;
  const targetOrder = session.multiLineActive ? session.multiLineIndices : null;
  const sourceOrder = session.clipboardLineOrder?.length ? session.clipboardLineOrder : targetOrder;
  const positions = lineOrderPositions(sourceOrder);
  const ordered = targetOrder?.includes(target) && sourceLines.every(line => positions.has(line));
  const sourceAnchor = sourceLines.length ? sourceLines.reduce((first, line) => (ordered ? positions.get(line) < positions.get(first) : line < first) ? line : first) : session.lineIndex;
  const shift = ordered ? targetOrder.indexOf(target) - positions.get(sourceAnchor) : target - sourceAnchor;
  const mapLine = lineOffsetMapper(lineCount, ordered ? sourceOrder : null, ordered ? targetOrder : null, shift);
  const notes = session.clipboard.map(note => ({ ...shiftedTime(note, delta), positionX: note.positionX * (mirror ? -1 : 1) }));
  const events = session.eventClipboard.map(({ type, event }) => {
    let next = shiftedTime(event, delta);
    if (type === 'paintEvents' && delta && session.shaderAutoAlign !== false) next = alignShaderParameters(next);
    if (mirror && type !== 'alphaEvents' && typeof next.start === 'number' && typeof next.end === 'number') next = { ...next, start: -next.start, end: -next.end };
    return { type, event: next };
  });
  return { notes, events, noteLines: noteLines.map(mapLine), eventLines: eventLines.map(mapLine), sourceAnchor, targetLineIndex: target };
}

export function pasteObjects(session, beat, options) {
  if (session.clipboard.some(note => note._rpenLargeClipboard)) {
    if (!session.largeDocument) throw Error('请在原超大谱工程中粘贴此选区');
    return session.largeDocument.pasteSelected(beat, options);
  }
  const projected = structuredClone(projectClipboard(session, beat, options));
  if (!session.largeDocument) for (const note of projected.notes) {
    if (note._rpenLargeCopies > 1) throw Error('普通谱面暂不支持粘贴重合音符组。请在超大谱工程中粘贴，或将处理数量设为 1 后重新复制。');
    delete note._rpenLargeRef; delete note._rpenLargeCopies;
  }
  if (!projected.notes.length && !projected.events.length) return false;
  let chart = session.chart;
  const selection = new Set(); const eventSelection = new Set(); const updates = new Map();
  const multiEventSelection = new Map();
  const eventUpdates = new Map();
  for (const [{ type, event }, lineIndex] of projected.events.map((entry, index) => [entry, projected.eventLines?.[index] ?? session.lineIndex])) {
    if (!eventUpdates.has(lineIndex)) eventUpdates.set(lineIndex, new Map());
    if (!eventUpdates.get(lineIndex).has(type)) eventUpdates.get(lineIndex).set(type, [...eventListAt(session, lineIndex, type)]);
    const events = eventUpdates.get(lineIndex).get(type);
    const key = eventKey(type, events.length); events.push(event);
    if (!multiEventSelection.has(lineIndex)) multiEventSelection.set(lineIndex, new Set());
    multiEventSelection.get(lineIndex).add(key);
    if (lineIndex === session.lineIndex) eventSelection.add(key);
  }
  for (const [lineIndex, lineUpdates] of eventUpdates) chart = chartWithEventLists(chart, lineIndex, session.eventLayer, lineUpdates);
  const multiLineSelection = new Map();
  if (projected.notes.length) {
    const lines = [...chart.judgeLineList];
    const grouped = new Map();
    projected.notes.forEach((note, index) => {
      const lineIndex = projected.noteLines?.[index] ?? session.lineIndex;
      if (!grouped.has(lineIndex)) grouped.set(lineIndex, []);
      grouped.get(lineIndex).push(note);
    });
    for (const [lineIndex, notesToAdd] of grouped) {
      const line = lines[lineIndex]; if (!line) continue;
      const existing = line.notes ?? []; const notes = [...existing, ...notesToAdd];
      const selected = new Set(notesToAdd.map((unused, index) => existing.length + index));
      lines[lineIndex] = { ...line, notes, numOfNotes: notes.length };
      multiLineSelection.set(lineIndex, selected);
      if (lineIndex === session.lineIndex) for (const index of selected) selection.add(index);
    }
    chart = { ...chart, judgeLineList: lines };
  }
  session.clipboardVisible = true;
  return commitSelectionEdit(session, { chart, lineIndex: session.lineIndex, eventLayer: session.eventLayer,
    focus: projected.notes.length ? 'notes' : 'events', selection, eventSelection,
    multiLineSelection, multiEventSelection }, options?.mirror ? t('clipboard.sa64e503') : t('clipboard.s1e020a8'));
}
