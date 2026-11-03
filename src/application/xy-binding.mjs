import { beatValue } from '../core/beat.mjs';
import { EVENT_TYPES } from '../core/chart.mjs';
import { shaderEvents } from '../core/shader-events.mjs';

export const xyOtherAxis = type => type === 'moveXEvents' ? 'moveYEvents' : type === 'moveYEvents' ? 'moveXEvents' : null;
const intervalKey = event => `${beatValue(event.startTime)}:${beatValue(event.endTime)}`;
const identity = entry => `${entry.lineIndex}:${entry.type}:${entry.index}`;

// Called only by enabled edit operations. No chart annotations, background
// indexes, per-frame scans or assumptions about the X/Y array order.
export function expandXyEntries(chart, layer, entries) {
  const result = [...entries], seen = new Set(entries.map(identity)), tracks = new Map();
  for (const entry of entries) {
    const type = xyOtherAxis(entry.type); if (!type) continue;
    const trackKey = `${entry.lineIndex}:${type}`;
    if (!tracks.has(trackKey)) {
      const grouped = new Map(), events = chart.judgeLineList[entry.lineIndex]?.eventLayers?.[layer]?.[type] ?? [];
      for (const [index, event] of events.entries()) {
        const key = intervalKey(event);
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push({ lineIndex: entry.lineIndex, type, index, event });
      }
      tracks.set(trackKey, grouped);
    }
    for (const counterpart of tracks.get(trackKey).get(intervalKey(entry.event)) ?? []) {
      const id = identity(counterpart); if (!seen.has(id)) { seen.add(id); result.push(counterpart); }
    }
  }
  return result;
}

export function xyIntervalOccupied(chart, lineIndex, layer, type, event) {
  const start = beatValue(event.startTime), end = beatValue(event.endTime);
  const tracks = chart.judgeLineList[lineIndex]?.eventLayers?.[layer];
  // An intact trajectory supplies both movement axes, including its implicit Y.
  if (type === 'moveYEvents' && (event.trajectory || (tracks?.moveXEvents ?? []).some(other => other.trajectory && start < beatValue(other.endTime) && end > beatValue(other.startTime)))) return true;
  return (tracks?.[type] ?? []).some(other => {
    const a = beatValue(other.startTime), b = beatValue(other.endTime);
    return a === start && b === end || a < end && b > start || a === b && a >= start && a < end;
  });
}

export function xyTimingUpdates(chart, lineIndex, layer, selection, updates) {
  const entries = [], nextByInterval = new Map();
  for (const key of selection) {
    const [type, indexText] = key.split(':'), index = Number(indexText); if (!xyOtherAxis(type)) continue;
    const event = chart.judgeLineList[lineIndex]?.eventLayers?.[layer]?.[type]?.[index], next = updates.get(type)?.[index];
    if (event && next && (beatValue(event.startTime) !== beatValue(next.startTime) || beatValue(event.endTime) !== beatValue(next.endTime))) {
      entries.push({ lineIndex, type, index, event }); nextByInterval.set(intervalKey(event), next);
    }
  }
  for (const pair of expandXyEntries(chart, layer, entries).slice(entries.length)) {
    if (selection.has(`${pair.type}:${pair.index}`)) continue;
    const next = nextByInterval.get(intervalKey(pair.event));
    if (!updates.has(pair.type)) updates.set(pair.type, [...(chart.judgeLineList[lineIndex].eventLayers[layer][pair.type] ?? [])]);
    updates.get(pair.type)[pair.index] = { ...pair.event, startTime: [...next.startTime], endTime: [...next.endTime] };
  }
  return updates;
}

// Batch handles can move objects between lines and renumber their indices.
// Keep the user's original selection while the companions follow the edit.
export function retainXySelection(result, entries) {
  const selected = new Set(entries.map(identity)), selections = new Map(), indices = new Map();
  for (const change of result.changes) {
    if (change.kind !== 'events' || !selected.has(identity({ ...change, lineIndex: change.sourceLineIndex }))) continue;
    const line = result.chart.judgeLineList[change.lineIndex];
    const events = change.type === 'paintEvents' ? shaderEvents(result.chart, change.lineIndex)
      : EVENT_TYPES.includes(change.type) ? line?.eventLayers?.[result.eventLayer]?.[change.type] : line?.extended?.[change.type];
    if (!indices.has(events)) indices.set(events, new Map((events ?? []).map((event, index) => [event, index])));
    const index = indices.get(events).get(change.after) ?? -1;
    if (index < 0) continue;
    if (!selections.has(change.lineIndex)) selections.set(change.lineIndex, new Set());
    selections.get(change.lineIndex).add(`${change.type}:${index}`);
  }
  result.multiEventSelection = selections;
  result.eventSelection = new Set(selections.get(result.lineIndex) ?? []);
  return result;
}
