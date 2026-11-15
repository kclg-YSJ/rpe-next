import { beatValue, fromNumber } from './beat.mjs';
import { assertEventEasing, eventNumericValue, rebaseCustomEventValues } from './event-easing.mjs';
import { snapPosition, verticalGrid } from './edit-grid.mjs';
import { t } from '../i18n.mjs';

export const GUIDE_LINES_KEY = 'rpeNextGuideLines';
export const GUIDE_EPSILON = 1e-5;
const indexes = new WeakMap();

export function assertGuideLine(guide) {
  if (!guide || typeof guide !== 'object' || typeof guide.id !== 'string' || !guide.id || guide.id.length > 128
    || !Number.isFinite(guide.start) || !Number.isFinite(guide.end)
    || beatValue(guide.startTime) < 0 || beatValue(guide.endTime) <= beatValue(guide.startTime)
    || guide.keepSnapped !== undefined && typeof guide.keepSnapped !== 'boolean'
    || !Number.isInteger(guide.easingType ?? 1) || (guide.easingType ?? 1) < 1 || (guide.easingType ?? 1) > 29
    || ['easingLeft', 'easingRight'].some(key => guide[key] !== undefined && !Number.isFinite(guide[key]))
    || guide.bezier !== undefined && ![0, 1, false, true].includes(guide.bezier)
    || guide.bezier && (!Array.isArray(guide.bezierPoints) || guide.bezierPoints.length !== 4 || !guide.bezierPoints.every(Number.isFinite))) throw Error(t('guide-lines.invalid'));
  assertEventEasing(guide);
  if (![0, .25, .5, .75, 1].every(progress => Number.isFinite(eventNumericValue(guide, progress)))) throw Error(t('guide-lines.invalid'));
  return guide;
}

export function assertGuideLines(chart) {
  const guides = chart[GUIDE_LINES_KEY]; if (guides === undefined) return;
  if (!Array.isArray(guides) || guides.length > 4096) throw Error(t('guide-lines.invalid'));
  const ids = new Set();
  for (const guide of guides) { assertGuideLine(guide); if (ids.has(guide.id)) throw Error(t('guide-lines.invalid')); ids.add(guide.id); }
}

export function guidePosition(guide, beat) {
  const first = beatValue(guide.startTime), last = beatValue(guide.endTime);
  if (beat < first - 1e-8 || beat > last + 1e-8 || last <= first) return null;
  return eventNumericValue(guide, Math.max(0, Math.min(1, (beat - first) / (last - first))));
}

// Immutable arrays are indexed once. A prefix maximum keeps long overlapping
// curves visible while queries can skip all curves outside the time interval.
export function guideLinesInRange(guides, first, last = first) {
  if (!guides?.length || !Number.isFinite(first) || !Number.isFinite(last)) return [];
  let index = indexes.get(guides);
  if (!index) {
    const entries = guides.map(guide => ({ guide, first: beatValue(guide.startTime), last: beatValue(guide.endTime) })).sort((a, b) => a.first - b.first);
    let maximum = -Infinity;
    for (const entry of entries) entry.maximum = maximum = Math.max(maximum, entry.last);
    indexes.set(guides, index = entries);
  }
  let low = 0, high = index.length;
  while (low < high) { const mid = (low + high) >>> 1; if (index[mid].first <= last + 1e-8) low = mid + 1; else high = mid; }
  const result = [];
  for (let i = low - 1; i >= 0 && index[i].maximum >= first - 1e-8; i--) if (index[i].last >= first - 1e-8) result.push(index[i].guide);
  return result;
}

export function guidePlacementRange(x, gridCount) {
  const { spacing, first } = verticalGrid(gridCount), index = x / spacing - first, integer = Math.round(index);
  const onGrid = Math.abs(index - integer) < 1e-8;
  const left = (onGrid ? integer - 1 : Math.floor(index)) + first;
  const right = (onGrid ? integer + 1 : Math.ceil(index)) + first;
  return [(left - .5) * spacing, (right + .5) * spacing];
}

export function snapGuidePosition(value, beat, guides, gridCount, enabled = true, excludeId = null, placement = false) {
  if (!enabled) return value;
  let nearest = snapPosition(value, gridCount), distance = Math.abs(nearest - value);
  let preferred = null, preferredDistance = Infinity;
  for (const guide of guideLinesInRange(guides, beat)) {
    if (guide.id === excludeId) continue;
    const x = guidePosition(guide, beat), delta = Math.abs(x - value);
    if (placement && Number.isFinite(x)) {
      const [left, right] = guidePlacementRange(x, gridCount);
      if (value >= left - 1e-8 && value <= right + 1e-8 && delta < preferredDistance) { preferred = x; preferredDistance = delta; }
    }
    if (Number.isFinite(x) && delta < distance) { nearest = x; distance = delta; }
  }
  return preferred ?? nearest;
}

export function projectGuideLine(source, beat, { mirror = false, keepTime = false, id = source.id } = {}) {
  const first = beatValue(source.startTime), duration = beatValue(source.endTime) - first, start = keepTime ? first : Math.max(0, beat);
  const sign = mirror ? -1 : 1, next = { ...source, id, startTime: fromNumber(start), endTime: fromNumber(start + duration), start: source.start * sign, end: source.end * sign };
  if (mirror && source.customEasing && 'sourceStart' in source.customEasing) next.customEasing = { ...source.customEasing, sourceStart: source.customEasing.sourceStart * sign, sourceEnd: source.customEasing.sourceEnd * sign };
  return assertGuideLine(next);
}

export function nudgeGuidePosition(x, delta, beat, guides) {
  let target = x + delta;
  for (const guide of guideLinesInRange(guides, beat)) {
    const point = guidePosition(guide, beat);
    if ((point - x) * Math.sign(delta) > GUIDE_EPSILON && (target - point) * Math.sign(delta) >= 0) target = point;
  }
  return target;
}

export function changeGuideLine(before, patch) {
  const next = rebaseCustomEventValues(before, { ...before, ...patch });
  return assertGuideLine(next);
}

export function followGuideNote(note, before, after) {
  if (before.keepSnapped === false) return note;
  const beat = beatValue(note.startTime), x = guidePosition(before, beat);
  if (x === null || Math.abs(note.positionX - x) > GUIDE_EPSILON) return note;
  const first = beatValue(before.startTime), last = beatValue(before.endTime), progress = Math.max(0, Math.min(1, (beat - first) / (last - first)));
  const start = beatValue(after.startTime), finish = beatValue(after.endTime), nextBeat = start + (finish - start) * progress;
  const positionX = eventNumericValue(after, progress), delta = nextBeat - beat;
  if (Math.abs(delta) < 1e-10 && Math.abs(positionX - note.positionX) < 1e-10) return note;
  return { ...note, positionX, startTime: Math.abs(delta) < 1e-10 ? note.startTime : fromNumber(nextBeat),
    endTime: Math.abs(delta) < 1e-10 ? note.endTime : fromNumber(beatValue(note.endTime) + delta) };
}

export function replaceGuideLine(chart, id, next) {
  const guides = chart[GUIDE_LINES_KEY] ?? [], index = guides.findIndex(guide => guide.id === id);
  if (next) assertGuideLine(next);
  if (next && next.id !== id) throw Error(t('guide-lines.invalid'));
  const list = index < 0 ? next ? [...guides, next] : guides : next ? guides.map((guide, i) => i === index ? next : guide) : guides.filter((guide, i) => i !== index);
  if (list === guides) return chart;
  const result = { ...chart, [GUIDE_LINES_KEY]: list }; assertGuideLines(result); return result;
}
