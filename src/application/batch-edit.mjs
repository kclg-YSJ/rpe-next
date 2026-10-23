import { assertChart, noteIsAbove } from '../core/chart.mjs';
import { integerNoteAlpha } from '../core/alpha-values.mjs';
import { beatValue, fromNumber } from '../core/beat.mjs';
import { snapPosition, verticalGrid } from '../core/edit-grid.mjs';
import { alignShaderParameters } from '../core/shader-events.mjs';
import { chartWithEventLists, eventList, eventListAt, eventKey, selectedEvents, transformEvents } from './event-commands.mjs';
import { t } from '../i18n.mjs';

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
    shaderAutoAlign: session.shaderAutoAlign, notes, events };
}

function eventSession(chart, lineIndex, eventLayer) {
  return { chart, lineIndex, eventLayer, line: chart.judgeLineList[lineIndex] };
}

export function editCapturedSelection(snapshot, { note = value => value, event = value => value, lineOffset = 0 } = {}) {
  const sourceIndex = snapshot.lineIndex;
  const count = snapshot.chart.judgeLineList.length;
  const targetIndex = ((sourceIndex + lineOffset) % count + count) % count;
  let chart = snapshot.chart;
  const selection = new Set(); const eventSelection = new Set();
  const multiLineSelection = new Map();
  if (snapshot.notes.length) {
    const lines = [...chart.judgeLineList];
    const grouped = new Map();
    for (const entry of snapshot.notes) {
      const entrySource = Number.isInteger(entry.lineIndex) ? entry.lineIndex : sourceIndex;
      if (!grouped.has(entrySource)) grouped.set(entrySource, []);
      grouped.get(entrySource).push(entry);
    }
    for (const [entrySource, entries] of grouped) {
      const entryTarget = ((entrySource + lineOffset) % count + count) % count;
      const source = lines[entrySource]; const target = lines[entryTarget];
      if (!source || !target) continue;
      const updates = new Map(entries.map(entry => [entry.index, integerNoteAlpha(note(entry.note, entry))]));
      let nextNotes;
      const selectedIndices = new Set();
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
  const entriesByLine = new Map();
  for (const entry of snapshot.events) {
    const lineIndex = Number.isInteger(entry.lineIndex) ? entry.lineIndex : sourceIndex;
    if (!entriesByLine.has(lineIndex)) entriesByLine.set(lineIndex, []);
    entriesByLine.get(lineIndex).push(entry);
  }
  const sourceUpdatesByLine = new Map(); const targetUpdatesByLine = new Map(); const multiEventSelection = new Map();
  for (const [entrySource, entries] of entriesByLine) {
    const entryTarget = ((entrySource + lineOffset) % count + count) % count;
    const types = new Set(entries.map(entry => entry.type));
    for (const type of types) {
      const selected = new Map(entries.filter(entry => entry.type === type).map(entry => {
        let next = event(entry.event, type, entry);
        if (type === 'paintEvents' && snapshot.shaderAutoAlign !== false && beatValue(next.startTime) !== beatValue(entry.event.startTime)) next = alignShaderParameters(next);
        return [entry.index, next];
      }));
      const original = eventList(eventSession(chart, entrySource, snapshot.eventLayer), type);
      if (entrySource === entryTarget) {
        if (!sourceUpdatesByLine.has(entrySource)) sourceUpdatesByLine.set(entrySource, new Map());
        sourceUpdatesByLine.get(entrySource).set(type, original.map((item, index) => selected.get(index) ?? item));
        if (!multiEventSelection.has(entrySource)) multiEventSelection.set(entrySource, new Set());
        for (const index of selected.keys()) { const key = eventKey(type, index); multiEventSelection.get(entrySource).add(key); if (entrySource === sourceIndex) eventSelection.add(key); }
      } else {
        if (!sourceUpdatesByLine.has(entrySource)) sourceUpdatesByLine.set(entrySource, new Map());
        sourceUpdatesByLine.get(entrySource).set(type, original.filter((item, index) => !selected.has(index)));
        const target = [...eventList(eventSession(chart, entryTarget, snapshot.eventLayer), type)];
        if (!targetUpdatesByLine.has(entryTarget)) targetUpdatesByLine.set(entryTarget, new Map());
        const targetSelection = multiEventSelection.get(entryTarget) ?? new Set();
        for (const next of selected.values()) { const key = eventKey(type, target.length); targetSelection.add(key); if (entryTarget === sourceIndex || entriesByLine.size === 1) eventSelection.add(key); target.push(next); }
        targetUpdatesByLine.get(entryTarget).set(type, target); multiEventSelection.set(entryTarget, targetSelection);
      }
    }
  }
  for (const [lineIndex, updates] of sourceUpdatesByLine) if (updates.size) chart = chartWithEventLists(chart, lineIndex, snapshot.eventLayer, updates);
  for (const [lineIndex, updates] of targetUpdatesByLine) if (updates.size) chart = chartWithEventLists(chart, lineIndex, snapshot.eventLayer, updates);
  return { chart, lineIndex: entriesByLine.size > 1 ? sourceIndex : targetIndex, eventLayer: snapshot.eventLayer, focus: snapshot.focus, selection, eventSelection, multiEventSelection, multiLineSelection };
}

export function commitSelectionEdit(session, result, label) {
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
    const anchor = selectionScaleAnchor(snapshot, anchorMode);
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
