import { beatValue } from '../core/beat.mjs';
import { createEvent } from '../core/chart.mjs';
import { movementVector } from '../core/movement-vector.mjs';
import { chartWithEventLists, eventKey, transformedEventLists } from './event-commands.mjs';
import { xyOtherAxis, xyIntervalOccupied } from './xy-binding.mjs';
import { t } from '../i18n.mjs';

// Resolve only the selected line/layer, and only while the inspector is open.
export function movementEventPair(chart, target) {
  const { lineIndex, layer, type, index } = target, other = xyOtherAxis(type);
  const tracks = chart.judgeLineList[lineIndex]?.eventLayers?.[layer];
  const event = tracks?.[type]?.[index];
  if (!other || !event) throw Error(t('movement-vector.stale'));
  const start = beatValue(event.startTime), end = beatValue(event.endTime);
  const candidates = tracks?.[other] ?? [];
  const matches = [];
  let previous;
  for (const [index, candidate] of candidates.entries()) {
    const a = beatValue(candidate.startTime), b = beatValue(candidate.endTime);
    if (a === start && b === end) matches.push({ index, event: candidate });
    if (b <= start && (!previous || a > beatValue(previous.startTime))) previous = candidate;
  }
  const companion = matches[0];
  const value = previous?.end ?? 0;
  const fallback = { ...createEvent(value, value, start, end), startTime: [...event.startTime], endTime: [...event.endTime], easingType: previous?.easingType ?? 1, inst: 0 };
  const counterpart = companion?.event ?? fallback;
  let error = '';
  if (event.trajectory || counterpart.trajectory) error = t('movement-vector.trajectory');
  else if (matches.length > 1) error = t('movement-vector.ambiguous');
  else if (!companion && xyIntervalOccupied(chart, lineIndex, layer, other, event)) error = t('movement-vector.conflict');
  const x = type === 'moveXEvents' ? event : counterpart, y = type === 'moveYEvents' ? event : counterpart;
  return { event, counterpart, other, otherIndex: companion?.index ?? -1, missing: !companion, error, start: [x.start, y.start], end: [x.end, y.end] };
}

export function editMovementVector(chart, target, vector) {
  const pair = movementEventPair(chart, target);
  if (pair.error) throw Error(pair.error);
  if (![...vector.start, ...vector.end].every(Number.isFinite)) throw Error(t('movement-vector.invalid'));
  const axes = target.type === 'moveXEvents' ? [0, 1] : [1, 0];
  for (const [event, axis] of [[pair.event, axes[0]], [pair.counterpart, axes[1]]]) {
    if (event.inst && Math.abs(vector.start[axis] - vector.end[axis]) > 1e-9) throw Error(t('movement-vector.locked'));
  }
  if (pair.start.every((value, axis) => value === vector.start[axis]) && pair.end.every((value, axis) => value === vector.end[axis])) return chart;
  const temporary = { chart, eventLayer: target.layer };
  const updates = new Map();
  const apply = (type, index, axis) => {
    const changes = transformedEventLists(temporary, target.lineIndex, new Set([eventKey(type, index)]), event => ({ ...event, start: vector.start[axis], end: vector.end[axis] }));
    for (const [type, list] of changes) updates.set(type, list);
  };
  apply(target.type, target.index, axes[0]);
  if (pair.missing) updates.set(pair.other, [...(chart.judgeLineList[target.lineIndex].eventLayers[target.layer][pair.other] ?? []), { ...pair.counterpart, start: vector.start[axes[1]], end: vector.end[axes[1]] }]);
  else apply(pair.other, pair.otherIndex, axes[1]);
  return chartWithEventLists(chart, target.lineIndex, target.layer, updates);
}

export function eventMovementVector(chart, target, previous) {
  const pair = movementEventPair(chart, target);
  return { ...pair, vector: movementVector(pair.start, pair.end, previous) };
}
