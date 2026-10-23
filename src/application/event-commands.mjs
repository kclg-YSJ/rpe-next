import { EVENT_TYPES, assertChart, createEvent } from '../core/chart.mjs';
import { integerAlphaEvent } from '../core/alpha-values.mjs';
import { beatValue, fromNumber } from '../core/beat.mjs';
import { trajectoryHasRotation } from '../core/curve-trajectory.mjs';
import { EventTrack } from '../core/events.mjs';
import { shaderEvents, replaceShaderEvents, alignShaderParameters } from '../core/shader-events.mjs';
import { t } from '../i18n.mjs';

export const eventKey = (type, index) => `${type}:${index}`;
export function eventListAt(session, lineIndex, type, layer = session.eventLayer) {
  if (type === 'paintEvents') return shaderEvents(session.chart, lineIndex);
  const line = session.chart.judgeLineList?.[lineIndex];
  return EVENT_TYPES.includes(type) ? line?.eventLayers?.[layer]?.[type] ?? [] : line?.extended?.[type] ?? [];
}
export function eventList(session, type) {
  return eventListAt(session, session.lineIndex, type);
}
export function selectedEvents(session) {
  return [...session.eventSelection].map(key => {
    const [type, indexText] = key.split(':'); const index = Number(indexText);
    return { type, index, event: eventList(session, type)[index] };
  }).filter(entry => entry.event);
}

export function eventSelections(session) {
  return session.multiLineActive && session.multiLineMode === 'events'
    ? session.multiEventSelection : new Map([[session.lineIndex, session.eventSelection]]);
}

export function selectedEventEntries(session) {
  return [...eventSelections(session)].flatMap(([lineIndex, keys]) => [...keys].map(key => {
    const [type, indexText] = key.split(':'); const index = Number(indexText);
    return { type, index, lineIndex, event: eventListAt(session, lineIndex, type)[index] };
  })).filter(entry => entry.event);
}

export function selectEvent(session, lineIndex, type, index, { toggle = false, replace = false } = {}) {
  const key = eventKey(type, index);
  const selections = eventSelections(session);
  const selected = new Set(selections.get(lineIndex) ?? []);
  if (toggle) { if (selected.has(key)) selected.delete(key); else selected.add(key); }
  else if (replace || !selected.has(key)) { selections.clear(); selected.clear(); selected.add(key); }
  if (selected.size) selections.set(lineIndex, selected); else selections.delete(lineIndex);
  session.eventSelection = new Set(selections.get(session.lineIndex) ?? []);
  session.focus = 'events'; session.selection.clear();
}

export function selectAllEvents(session, types) {
  const selections = eventSelections(session); selections.clear();
  const lines = session.multiLineActive && session.multiLineMode === 'events' ? session.targetLineIndices : [session.lineIndex];
  for (const lineIndex of lines) {
    const keys = types.flatMap(type => eventListAt(session, lineIndex, type).map((event, index) => eventKey(type, index)));
    if (keys.length) selections.set(lineIndex, new Set(keys));
  }
  session.eventSelection = new Set(selections.get(session.lineIndex) ?? []);
  session.multiSelectionIntent = 'events'; session.selection.clear();
}

export function chartWithEventLists(chart, lineIndex, eventLayer, updates) {
  const source = chart.judgeLineList[lineIndex];
  if (!source) throw new Error(t('event-commands.sb9277d1'));
  const line = { ...source, extended: { ...source.extended }, eventLayers: [...(source.eventLayers ?? [])] };
  for (const [type, events] of updates) {
    for (const event of events) if (beatValue(event.endTime) < beatValue(event.startTime)) throw new Error(t('event-commands.s07ec712'));
    if (type === 'paintEvents') continue;
    if (EVENT_TYPES.includes(type)) {
      while (line.eventLayers.length <= eventLayer) line.eventLayers.push({});
      line.eventLayers[eventLayer] = { ...line.eventLayers[eventLayer], [type]: type === 'alphaEvents' ? events.map(integerAlphaEvent) : events };
    }
    else line.extended[type] = events;
  }
  const lines = [...chart.judgeLineList]; lines[lineIndex] = line;
  chart = { ...chart, judgeLineList: lines };
  if (updates.has('paintEvents')) chart = replaceShaderEvents(chart, lineIndex, updates.get('paintEvents'));
  return chart;
}

export function commitEventLists(session, label, updates, selection = session.eventSelection) {
  const beforeSelection = session.selectionState();
  const chart = chartWithEventLists(session.chart, session.lineIndex, session.eventLayer, updates);
  assertChart(chart);
  session.eventSelection = new Set(selection); session.focus = 'events'; session.selection.clear();
  session.commit(label, chart, beforeSelection);
}

export function transformedEventLists(session, lineIndex, selection, transform) {
  const updates = new Map();
  const linked = new Map();
  for (const key of selection) {
    const [type, indexText] = key.split(':'); const index = Number(indexText);
    const event = eventListAt(session, lineIndex, type)[index]; if (!event) continue;
    if (!updates.has(type)) updates.set(type, [...eventListAt(session, lineIndex, type)]);
    let next = transform(event, type);
    if (type === 'paintEvents' && session.shaderAutoAlign !== false && beatValue(next.startTime) !== beatValue(event.startTime)) next = alignShaderParameters(next);
    updates.get(type)[index] = next;
    const link = Number(event.linkgroup ?? 0);
    if (link > 0 && type !== 'paintEvents') linked.set(`${type}:${link}`, next);
  }
  for (const [group, next] of linked) {
    const [type, linkText] = group.split(':'); const link = Number(linkText);
    const events = updates.get(type) ?? [...eventListAt(session, lineIndex, type)];
    for (let index = 0; index < events.length; index++) {
      const event = events[index];
      if (Number(event.linkgroup ?? 0) !== link || selection.has(eventKey(type, index))) continue;
      events[index] = { ...event, start: structuredClone(next.start), end: structuredClone(next.end), easingType: next.easingType,
        easingLeft: next.easingLeft, easingRight: next.easingRight, bezier: next.bezier, bezierPoints: structuredClone(next.bezierPoints) };
    }
    updates.set(type, events);
  }
  return updates;
}

export function transformEvents(session, label, transform) {
  let chart = session.chart;
  for (const [lineIndex, selection] of eventSelections(session)) {
    const updates = transformedEventLists(session, lineIndex, selection, transform);
    if (updates.size) chart = chartWithEventLists(chart, lineIndex, session.eventLayer, updates);
  }
  if (chart === session.chart) return;
  assertChart(chart);
  const beforeSelection = session.selectionState();
  if (session.multiLineActive && session.multiLineMode === 'events') session.eventSelection = new Set(session.multiEventSelection.get(session.lineIndex) ?? []);
  session.focus = 'events'; session.selection.clear();
  session.commit(label, chart, beforeSelection);
}

export function toggleSingleEventLock(session) {
  const entries = selectedEventEntries(session);
  if (entries.length !== 1 || entries[0].type === 'paintEvents') return false;
  const locked = !Boolean(entries[0].event.inst);
  transformEvents(session, t('event-commands.s015e4fc'), event => ({ ...event, inst: locked ? 1 : 0, ...(locked ? { end: structuredClone(event.start) } : {}) }));
  return true;
}

export function insertEvent(session, type, event) {
  insertEventAt(session, session.lineIndex, type, event);
}

export function insertEventAt(session, lineIndex, type, event) {
  const events = eventListAt(session, lineIndex, type);
  const chart = chartWithEventLists(session.chart, lineIndex, session.eventLayer, new Map([[type, [...events, event]]]));
  assertChart(chart);
  const beforeSelection = session.selectionState();
  selectEvent(session, lineIndex, type, events.length, { replace: true });
  session.commit(t('event-commands.s2380a25'), chart, beforeSelection);
}

export function placedEvent(session, type, first, second, easingType, lineIndex = session.lineIndex, inst = false) {
  const start = Math.min(first, second); const end = Math.max(first, second);
  if (end - start < 0.001) return null;
  const events = eventListAt(session, lineIndex, type);
  if (type === 'paintEvents') return { startTime: fromNumber(start), endTime: fromNumber(end), shader: 'chromatic', global: false, order: 0, vars: {} };
  const trajectories = ['moveYEvents', 'rotateEvents'].includes(type) ? eventListAt(session, lineIndex, 'moveXEvents').filter(event => event.trajectory && (type !== 'rotateEvents' || trajectoryHasRotation(event.trajectory.options))) : [];
  if ([...events, ...trajectories].some(event => start < beatValue(event.endTime) && end > beatValue(event.startTime))) throw new Error(t('event-commands.s5c400ae'));
  const previous = events.filter(event => beatValue(event.endTime) <= start).sort((left, right) => beatValue(right.startTime) - beatValue(left.startTime))[0];
  const fallback = type === 'alphaEvents' ? 255 : type.startsWith('scale') ? 1 : type === 'speedEvents' ? 10 : type === 'textEvents' ? '' : type === 'colorEvents' ? [255, 255, 255] : 0;
  const value = structuredClone(previous?.end ?? fallback);
  return { ...createEvent(value, structuredClone(value), start, end), easingType: easingType ?? previous?.easingType ?? 1,
    inst: inst ? 1 : 0, ...(inst ? { end: structuredClone(value) } : {}) };
}

export function deleteEvents(session) {
  let chart = session.chart;
  const entries = selectedEventEntries(session);
  for (const [lineIndex, selection] of eventSelections(session)) {
    const updates = new Map();
    for (const { type } of entries.filter(entry => entry.lineIndex === lineIndex)) {
      if (!updates.has(type)) updates.set(type, eventListAt(session, lineIndex, type).filter((event, index) => !selection.has(eventKey(type, index))));
    }
    if (updates.size) chart = chartWithEventLists(chart, lineIndex, session.eventLayer, updates);
  }
  if (chart === session.chart) return;
  assertChart(chart);
  const beforeSelection = session.selectionState();
  session.eventSelection.clear();
  if (session.multiLineActive && session.multiLineMode === 'events') session.multiEventSelection.clear();
  session.focus = 'events'; session.selection.clear();
  session.commit(t('event-commands.sf10087a'), chart, beforeSelection);
}

export function copyEvents(session) { session.eventClipboard = structuredClone(selectedEvents(session).map(({ type, event }) => ({ type, event }))); }

export function pasteEvents(session, beat, keepTime = false, mirror = false) {
  if (!session.eventClipboard.length) return;
  const earliest = session.eventClipboard.reduce((value, entry) => Math.min(value, beatValue(entry.event.startTime)), Infinity);
  const delta = keepTime ? 0 : beat - earliest;
  const updates = new Map(); const selection = [];
  for (const { type, event } of session.eventClipboard) {
    if (!updates.has(type)) updates.set(type, [...eventList(session, type)]);
    const events = updates.get(type);
    selection.push(eventKey(type, events.length));
    let pasted = { ...structuredClone(event), startTime: fromNumber(beatValue(event.startTime) + delta), endTime: fromNumber(beatValue(event.endTime) + delta) };
    if (type === 'paintEvents' && delta && session.shaderAutoAlign !== false) pasted = alignShaderParameters(pasted);
    if (mirror && ['moveXEvents', 'rotateEvents'].includes(type)) { pasted.start = -pasted.start; pasted.end = -pasted.end; }
    events.push(pasted);
  }
  commitEventLists(session, t('event-commands.s5cfeeb2'), updates, selection);
}

export function splitEvent(event, beat, tempo, factor = 1) {
  const start = tempo.seconds(event.startTime, factor); const end = tempo.seconds(event.endTime, factor); const at = tempo.seconds(beat, factor);
  if (!(at > start && at < end)) throw new Error(t('event-commands.s93fe9d3'));
  if (event.bezier) throw new Error(t('event-commands.sa2fb5ea'));
  if (typeof event.start !== 'number') throw new Error(t('event-commands.s22db670'));
  const progress = (at - start) / (end - start);
  const middle = (event.easingLeft ?? 0) + ((event.easingRight ?? 1) - (event.easingLeft ?? 0)) * progress;
  const value = new EventTrack([event], tempo, factor).value(at);
  if (Math.abs(value - event.start) < 1e-10 && event.start !== event.end || Math.abs(event.end - value) < 1e-10 && event.start !== event.end) throw new Error(t('event-commands.s09d719f'));
  return [{ ...event, endTime: fromNumber(beat), end: value, easingRight: middle }, { ...event, startTime: fromNumber(beat), start: value, easingLeft: middle }];
}

function splitEventOriginal(event, beat, tempo, factor = 1) {
  const start = tempo.seconds(event.startTime, factor); const end = tempo.seconds(event.endTime, factor); const at = tempo.seconds(beat, factor);
  if (!(at > start && at < end)) throw new Error(t('event-commands.s93fe9d3'));
  if (event.bezier || typeof event.start !== 'number') throw new Error(t('event-commands.sbec4067'));
  const value = new EventTrack([event], tempo, factor).value(at);
  return [
    { ...event, endTime: fromNumber(beat), end: value, easingType: 1, easingLeft: 0, easingRight: 1, bezier: 0, bezierPoints: [0, 0, 1, 1] },
    { ...event, startTime: fromNumber(beat), start: value },
  ];
}

export function splitSelectedEvents(session, beat, tempo) {
  const updates = new Map(); const selection = [];
  for (const { type, index, event } of selectedEvents(session)) {
    if (beatValue(event.startTime) >= beat || beatValue(event.endTime) <= beat) continue;
    const [first, second] = splitEventOriginal(event, beat, tempo, session.line.bpmfactor ?? 1);
    if (!updates.has(type)) updates.set(type, [...eventList(session, type)]);
    const events = updates.get(type); events[index] = first; events.push(second);
    events.sort((left, right) => beatValue(left.startTime) - beatValue(right.startTime) || beatValue(left.endTime) - beatValue(right.endTime));
    for (let nextIndex = 0; nextIndex < events.length; nextIndex++) if (events[nextIndex] === first || events[nextIndex] === second) selection.push(eventKey(type, nextIndex));
  }
  if (!updates.size) throw new Error(t('event-commands.sbc12772'));
  commitEventLists(session, t('event-commands.se11f352'), updates, selection);
}
