import { rebaseCustomEventValues } from '../core/event-easing.mjs';
import { assertChart, noteIsAbove } from '../core/chart.mjs';
import { integerNoteAlpha } from '../core/alpha-values.mjs';
import { beatValue, fromNumber } from '../core/beat.mjs';
import { snapPosition, verticalGrid } from '../core/edit-grid.mjs';
import { alignShaderParameters } from '../core/shader-events.mjs';
import { eventListAt, selectedEvents } from './event-commands.mjs';
import { t } from '../i18n.mjs';
import { lineOffsetMapper } from './multi-line-edit.mjs';
import { assembleSelectionEdits } from './selection-edits.mjs';
import { EVENT_VALUE_MEMORY_LIMIT, hasEventValueMemory, rememberEventValueChange } from './event-value-memory.mjs';

export const BATCH_ACTIONS = [
  ['MirrorY', t('batch-edit.s8e30bb2')], ['MirrorMid', t('batch-edit.s89eacaf')],
  ['SideSwitch', t('batch-edit.s5f6d625')], ['SideUp', t('batch-edit.se67c103')], ['SideDown', t('batch-edit.s3f373e0')],
  ['ToReal', t('batch-edit.s9ec2db0')], ['ToFake', t('batch-edit.s6392caf')], ['ToTap', t('batch-edit.sdeddd25')],
  ['ToFlick', t('batch-edit.sb646f8b')], ['ToDrag', t('batch-edit.se106cdc')], ['ToHold', t('batch-edit.sb33fb9b')], ['AttachX', t('batch-edit.s18e7d05')],
];

export function captureSelection(session) {
  const events = session.multiLineActive && session.multiLineMode === 'events'
    ? [...(session.multiEventSelection ?? new Map())].flatMap(([lineIndex, selection]) => [...selection].map(key => {
      const [type, indexText] = String(key).split(':'); const index = Number(indexText);
      return { type, index, lineIndex, event: eventListAt(session, lineIndex, type)?.[index] };
    })).filter(entry => entry.event)
    : selectedEvents(session).map(entry => ({ ...entry, lineIndex: session.lineIndex }));
  const notes = session.multiLineActive && session.multiLineMode === 'notes'
    ? [...(session.multiLineSelection ?? new Map())].flatMap(([lineIndex, selection]) => [...selection].map(index => ({ lineIndex, index, note: session.chart.judgeLineList?.[lineIndex]?.notes?.[index] }))).filter(entry => entry.note)
    : [...session.selection].sort((left, right) => left - right).filter(index => session.notes[index]).map(index => ({ lineIndex: session.lineIndex, index, note: session.notes[index] }));
  return { chart: session.chart, lineIndex: session.lineIndex, eventLayer: session.eventLayer, focus: session.focus,
    shaderAutoAlign: session.shaderAutoAlign, notes, events, largeSelection: session.largeDocument?.logicalSelection,
    lineOrder: session.multiLineActive ? [...session.multiLineIndices] : undefined };
}

export function editCapturedSelection(snapshot, { note = value => value, event = value => value, lineOffset = 0 } = {}) {
  const count = snapshot.chart.judgeLineList.length;
  const target = lineOffsetMapper(count, snapshot.lineOrder, snapshot.lineOrder, lineOffset);
  const changes = snapshot.notes.map(entry => {
    const sourceLineIndex = entry.lineIndex ?? snapshot.lineIndex;
    return { kind: 'notes', index: entry.index, sourceLineIndex, lineIndex: target(sourceLineIndex), before: entry.note, after: integerNoteAlpha(note(entry.note, entry)) };
  });
  for (const entry of snapshot.events) {
    let after = rebaseCustomEventValues(entry.event, event(entry.event, entry.type, entry));
    if (entry.type === 'paintEvents' && snapshot.shaderAutoAlign !== false && beatValue(after.startTime) !== beatValue(entry.event.startTime)) after = alignShaderParameters(after);
    const sourceLineIndex = entry.lineIndex ?? snapshot.lineIndex;
    changes.push({ kind: 'events', type: entry.type, index: entry.index, sourceLineIndex, lineIndex: target(sourceLineIndex), before: entry.event, after });
  }
  const sourceLines = new Set(changes.map(change => change.sourceLineIndex));
  const lineIndex = sourceLines.size > 1 ? snapshot.lineIndex : target(snapshot.lineIndex);
  return { ...assembleSelectionEdits(snapshot, changes, { lineIndex }),
    ...(snapshot.largeSelection && snapshot.notes.length ? { largeNoteEdit: { transform: note, lineOffset, lineOrder: snapshot.lineOrder } } : {}) };
}

export function commitSelectionEdit(session, result, label) {
  if (result.largeNoteEdit && session.largeDocument?.logicalSelection) return session.largeDocument.transformSelected(label, result.largeNoteEdit.transform, { lineOffset: result.largeNoteEdit.lineOffset, lineOrder: result.largeNoteEdit.lineOrder });
  if (result.chart === session.chart) return false;
  assertChart(result.chart);
  const beforeSelection = session.selectionState();
  if (!(session.multiLineActive && ((result.multiEventSelection?.size ?? 0) > 0 || (result.multiLineSelection?.size ?? 0) > 0))) session.lineIndex = result.lineIndex;
  session.eventLayer = result.eventLayer; session.focus = result.focus;
  session.selection = result.multiLineSelection ? new Set(result.multiLineSelection.get(session.lineIndex) ?? []) : result.selection;
  session.eventSelection = result.multiEventSelection ? new Set(result.multiEventSelection.get(session.lineIndex) ?? []) : result.eventSelection;
  if (result.multiLineSelection) session.multiLineSelection = new Map([...result.multiLineSelection].map(([line, values]) => [line, new Set(values)]));
  if (result.multiEventSelection) session.multiEventSelection = new Map([...result.multiEventSelection].map(([line, values]) => [line, new Set(values)]));
  session.commit(label, result.chart, beforeSelection);
  if (hasEventValueMemory(session) && session.chart === result.chart) for (const change of (result.changes ?? []).slice(0, EVENT_VALUE_MEMORY_LIMIT)) {
    if (change.kind === 'events') rememberEventValueChange(session, change.before, change.after, undefined, { type: change.type, index: change.index });
  }
  return true;
}

export function shiftedTime(item, delta, part = 'both') {
  if (!delta) return item;
  const start = beatValue(item.startTime); const end = beatValue(item.endTime);
  return { ...item, startTime: part === 'end' ? item.startTime : fromNumber(part === 'start' ? Math.min(end, start + delta) : start + delta),
    endTime: part === 'start' ? item.endTime : fromNumber(part === 'end' ? Math.max(start, end + delta) : end + delta) };
}

export function nudgeSelection(session, direction, division, gridCount) {
  const snapshot = captureSelection(session);
  if (!snapshot.notes.length && !snapshot.events.length) return false;
  const horizontal = direction === 'ArrowLeft' || direction === 'ArrowRight';
  if (horizontal && !snapshot.notes.length) return true;
  const deltaX = horizontal ? verticalGrid(gridCount).spacing / 2 * (direction === 'ArrowLeft' ? -1 : 1) : 0;
  const deltaBeat = horizontal ? 0 : (direction === 'ArrowDown' ? -1 : 1) / division;
  return commitSelectionEdit(session, editCapturedSelection(snapshot, {
    note: item => ({ ...shiftedTime(item, deltaBeat), positionX: item.positionX + deltaX }),
    event: item => shiftedTime(item, deltaBeat),
  }), t('batch-edit.sba1b1a0'));
}

export function applyBatchAction(session, action, gridCount) {
  const snapshot = captureSelection(session);
  if (!snapshot.notes.length) return false;
  if (!BATCH_ACTIONS.some(([name]) => name === action)) throw new Error(t('batch-edit.s8bd8d07'));
  const positions = snapshot.notes.map(entry => entry.note.positionX);
  const middleSum = positions.reduce((value, position) => Math.min(value, position), Infinity) + positions.reduce((value, position) => Math.max(value, position), -Infinity);
  const types = { ToTap: 1, ToFlick: 3, ToDrag: 4, ToHold: 2 };
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
    const type = types[action];
    return { ...item, type, above: noteIsAbove(item) ? 1 : type === 2 ? 0 : 2,
      endTime: type === 2 ? item.type === 2 ? item.endTime : fromNumber(beatValue(item.startTime) + 0.25) : [...item.startTime] };
  } }), t('batch-edit.s6bc2903', { p0: action }));
}

export function controlLineOffset(delta, events = false) {
  const threshold = events ? 75 : 50;
  return Math.abs(delta) < threshold ? 0 : Math.sign(delta) * (1 + Math.floor((Math.abs(delta) - threshold) / 50));
}

export function selectionScaleAnchor(snapshot, anchorMode = 0) {
  if (snapshot.largeSelection && anchorMode === 0) return (snapshot.largeSelection.minX + snapshot.largeSelection.maxX) / 2;
  const ordered = snapshot.notes.toSorted((left, right) => beatValue(left.note.startTime) - beatValue(right.note.startTime));
  if (!ordered.length) return null;
  if (anchorMode === 1) return ordered[0].note.positionX;
  if (anchorMode === 2) return ordered.at(-1).note.positionX;
  const minimum = ordered.reduce((value, entry) => Math.min(value, entry.note.positionX), Infinity);
  const maximum = ordered.reduce((value, entry) => Math.max(value, entry.note.positionX), -Infinity);
  return (minimum + maximum) / 2;
}

export function controlSelection(snapshot, kind, { deltaBeat = 0, deltaBeatByLine = null, deltaX = 0, dragX = 0, anchorMode = 0, snapX = false, gridCount = 11 } = {}) {
  const beatDelta = entry => deltaBeatByLine?.get(entry.lineIndex) ?? deltaBeat;
  if (kind === 'note-move') {
    const spacing = verticalGrid(gridCount).spacing;
    if (snapX && Number.isFinite(spacing) && spacing > 0) deltaX = Math.round(deltaX / spacing) * spacing;
    return editCapturedSelection(snapshot, { note: (item, entry) => ({ ...shiftedTime(item, beatDelta(entry)), positionX: item.positionX + deltaX }) });
  }
  if (kind === 'note-scale') {
    const anchor = selectionScaleAnchor(snapshot, anchorMode);
    const rate = 1 + dragX / 300 * (anchorMode === 2 ? -1 : 1);
    return editCapturedSelection(snapshot, { note: item => ({ ...item, positionX: anchor + (item.positionX - anchor) * rate }) });
  }
  if (kind === 'note-line') return editCapturedSelection(snapshot, { lineOffset: controlLineOffset(dragX) });
  if (kind === 'event-move') return editCapturedSelection(snapshot, { event: (item, unusedType, entry) => shiftedTime(item, beatDelta(entry)), lineOffset: controlLineOffset(dragX, true) });
  return editCapturedSelection(snapshot, { event: (item, unusedType, entry) => shiftedTime(item, beatDelta(entry), kind === 'event-start' ? 'start' : 'end') });
}
