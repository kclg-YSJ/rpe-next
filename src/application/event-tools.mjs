import { eventNumericValue } from '../core/event-easing.mjs';
import { beatValue, fromNumber } from '../core/beat.mjs';
import { easing, bezier } from '../core/easing.mjs';
import { EVENT_TYPES } from '../core/chart.mjs';
import { snapTime } from '../core/edit-grid.mjs';
import { eventListAt, eventKey, eventSelections, selectedEventEntries, chartWithEventLists, commitEventListEdits } from './event-commands.mjs';
import { assertChart } from '../core/chart.mjs';
import { t } from '../i18n.mjs';

const cutTypes = new Set([...EVENT_TYPES, 'scaleXEvents', 'scaleYEvents', 'colorEvents']);
export function canCutEvent(type, event) {
  return !event.trajectory && cutTypes.has(type) && beatValue(event.endTime) > beatValue(event.startTime);
}

export function cutEventParts(type, event, { division = 4, density = 4, beat, tempo, factor = 1 } = {}) {
  if (!canCutEvent(type, event)) return null;
  if (!Number.isFinite(density) || density <= 0 || !Number.isFinite(division) || division < 1) throw new Error(t('event-tools.sfcffc1a'));
  const subdivisions = Math.max(1, Math.trunc(division * density));
  const start = beatValue(event.startTime); const end = beatValue(event.endTime);
  const snapped = tempo ? beatValue(snapTime(tempo.seconds(beat ?? start, factor), division, tempo, factor)) : Math.round((beat ?? start) * division) / division;
  const anchor = snapped > start && snapped < end ? snapped : start;
  const count = Math.ceil((end - start) * subdivisions) + 1;
  if (count > 100000) throw new Error(t('event-tools.sdb5f35f'));
  const cuts = [start];
  const first = Math.floor((start - anchor) * subdivisions) + 1;
  for (let index = first; index <= Math.ceil((end - anchor) * subdivisions); index++) {
    const point = anchor + index / subdivisions;
    if (point >= end - 1e-9) break;
    if (point > start + 1e-9) cuts.push(point);
  }
  cuts.push(end);
  const sample = position => {
    const progress = event.customEasing && tempo ? (tempo.seconds(position, factor) - tempo.seconds(event.startTime, factor)) / (tempo.seconds(event.endTime, factor) - tempo.seconds(event.startTime, factor)) : (position - start) / (end - start);
    const amount = event.bezier ? bezier(progress, event.bezierPoints) : easing(progress, event.easingType, event.easingLeft ?? 0, event.easingRight ?? 1);
    if (Array.isArray(event.start)) return event.customEasing ? eventNumericValue(event, progress).map(Math.trunc) : event.start.map((value, index) => Math.trunc(value + (event.end[index] - value) * amount));
    const value = event.customEasing ? eventNumericValue(event, progress) : event.start + (event.end - event.start) * amount;
    return type === 'alphaEvents' ? Math.trunc(value) : value;
  };
  return cuts.slice(0, -1).map((point, index) => ({ ...structuredClone(event), customEasing: undefined, startTime: fromNumber(point), endTime: fromNumber(cuts[index + 1]),
    start: sample(point), end: sample(cuts[index + 1]), easingType: 1, easingLeft: 0, easingRight: 1, bezier: 0, bezierPoints: [0, 0, 1, 1], linkgroup: 0, inst: 0 }));
}

export function cutSelectedEvents(session, options = {}) {
  const edits = new Map(); let changed = 0; let generated = 0; let skipped = 0;
  const seconds = options.tempo && Number.isFinite(options.beat) ? options.tempo.seconds(options.beat, options.factor ?? session.line?.bpmfactor ?? 1) : null;
  for (const [lineIndex, keys] of eventSelections(session)) {
    const updates = new Map(), selection = new Set(), factor = session.chart.judgeLineList[lineIndex]?.bpmfactor ?? 1;
    const localOptions = { ...options, factor, beat: seconds === null ? options.beat : options.tempo.beat(seconds, factor) };
    for (const type of new Set([...keys].map(key => String(key).split(':')[0]))) {
      const events = []; let columnChanged = false;
      eventListAt(session, lineIndex, type).forEach((event, index) => {
        const selected = keys.has(eventKey(type, index));
        const parts = selected ? cutEventParts(type, event, localOptions) : null;
        if (selected && !parts) skipped++;
        if (parts) { columnChanged = true; changed++; generated += parts.length; }
        if (generated > 100000) throw new Error(t('event-tools.sdb5f35f'));
        for (const item of parts ?? [event]) events.push({ item, selected });
      });
      if (!columnChanged) {
        for (const key of keys) if (String(key).split(':')[0] === type) selection.add(key);
        continue;
      }
      events.sort((left, right) => beatValue(left.item.startTime) - beatValue(right.item.startTime));
      events.forEach((entry, index) => { if (entry.selected) selection.add(eventKey(type, index)); });
      updates.set(type, events.map(entry => entry.item));
    }
    if (updates.size) edits.set(lineIndex, { updates, selection });
  }
  if (changed) commitEventListEdits(session, t('event-tools.s9fda3f9'), edits);
  return { changed, generated, skipped };
}

export function stickSelectedEvents(session) {
  const edits = new Map(); let changed = 0; let skipped = 0;
  for (const [lineIndex, keys] of eventSelections(session)) {
    const updates = new Map();
    for (const type of new Set([...keys].map(key => String(key).split(':')[0]))) {
      const events = [...eventListAt(session, lineIndex, type)];
      if (type === 'paintEvents') { skipped += events.filter((event, index) => keys.has(eventKey(type, index))).length; continue; }
      const order = events.map((event, index) => ({ event, index })).sort((left, right) => beatValue(left.event.startTime) - beatValue(right.event.startTime) || left.index - right.index);
      let columnChanged = false;
      order.forEach((entry, position) => {
        if (!keys.has(eventKey(type, entry.index))) return;
        if (!position) { skipped++; return; }
        const previous = events[order[position - 1].index];
        const start = structuredClone(previous.end);
        events[entry.index] = { ...entry.event, start, ...(entry.event.inst ? { end: structuredClone(start) } : {}) }; columnChanged = true; changed++;
      });
      if (columnChanged) updates.set(type, events);
    }
    if (updates.size) edits.set(lineIndex, { updates, selection: keys });
  }
  if (changed) commitEventListEdits(session, t('event-tools.s411a288'), edits);
  return { changed, skipped };
}

export function stickSelectedEventToNext(session) {
  const [selected] = selectedEventEntries(session);
  if (!selected || selectedEventEntries(session).length !== 1 || selected.type === 'paintEvents') return false;
  const events = eventListAt(session, selected.lineIndex, selected.type);
  const order = events.map((event, index) => ({ event, index }))
    .sort((left, right) => beatValue(left.event.startTime) - beatValue(right.event.startTime) || left.index - right.index);
  const position = order.findIndex(entry => entry.index === selected.index);
  const next = order[position + 1]?.event;
  if (!next) return false;
  const end = structuredClone(next.start);
  const updated = [...events];
  updated[selected.index] = { ...selected.event, ...(selected.event.inst ? { start: end } : {}), end };
  const chart = chartWithEventLists(session.chart, selected.lineIndex, session.eventLayer, new Map([[selected.type, updated]]));
  assertChart(chart);
  const beforeSelection = session.selectionState();
  session.commit(t('event-tools.s3c9157f'), chart, beforeSelection);
  return true;
}
