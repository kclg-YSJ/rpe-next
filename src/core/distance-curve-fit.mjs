import { easing } from './easing.mjs';
import { SpeedIntegral } from './events.mjs';
import { fromNumber, beatValue } from './beat.mjs';

export const DISTANCE_CURVE_VERSION = 1;
const nativeShape = event => JSON.stringify([event.startTime, event.endTime, event.start, event.end, event.easingType ?? 1, event.easingLeft ?? 0, event.easingRight ?? 1, event.bezier ?? 0, event.bezierPoints ?? null, event.inst ?? 0, event.trajectory ?? null, event.customEasing ?? null]);
export const distanceCurveMeta = event => {
  const value = event?.rpeNextDistanceCurve;
  return value?.version === DISTANCE_CURVE_VERSION && typeof value.id === 'string' && Number.isFinite(value.start) && Number.isFinite(value.end) && value.end > value.start && Number.isInteger(value.easing) && value.easing >= 1 && value.easing <= 29 && value.native === nativeShape(event) ? value : null;
};
export function tagDistanceCurve(events, meta) {
  return events.map((event, index) => {
    const next = { ...event }; delete next.rpeNextSpeedCurveNode; delete next.rpeNextSpeedCurveEndNode;
    return { ...next, rpeNextDistanceCurve: { ...meta, version: DISTANCE_CURVE_VERSION, count: events.length, native: nativeShape(next) },
      ...(index === 0 ? { rpeNextSpeedCurveNode: true } : {}), ...(index === events.length - 1 ? { rpeNextSpeedCurveEndNode: true } : {}) };
  });
}
export function validDistanceCurveGroups(events) {
  const groups = new Map();
  for (const event of events) {
    const id = event.rpeNextDistanceCurve?.id;
    if (id) { if (!groups.has(id)) groups.set(id, []); groups.get(id).push(event); }
  }
  if (!groups.size) return groups;
  const positions = new Map([...events].sort((a, b) => beatValue(a.startTime) - beatValue(b.startTime)).map((event, index) => [event, index]));
  for (const [id, parts] of groups) {
    parts.sort((a, b) => beatValue(a.startTime) - beatValue(b.startTime));
    const meta = distanceCurveMeta(parts[0]);
    if (!meta || meta.count !== parts.length || positions.get(parts.at(-1)) - positions.get(parts[0]) + 1 !== parts.length || Math.abs(beatValue(parts[0].startTime) - meta.start) > 1e-7 || Math.abs(beatValue(parts.at(-1).endTime) - meta.end) > 1e-7 || parts.some((event, i) => {
      const own = distanceCurveMeta(event);
      return !own || own.start !== meta.start || own.end !== meta.end || own.easing !== meta.easing || own.count !== meta.count || i && Math.abs(beatValue(parts[i - 1].endTime) - beatValue(event.startTime)) > 1e-7;
    })) groups.delete(id); else groups.set(id, meta);
  }
  return groups;
}
const quantize = beat => beatValue(fromNumber(beat, 1920000));

// Fit the selected layer's accumulated distance. The target is expressed in
// chart beats, so BPM changes and other speed layers are subtracted explicitly.
export function fitDistanceCurve(model, layer, { start, end, easing: kind, startDistance = model.distance(start), endDistance = model.distance(end), id }) {
  if (!Number.isInteger(kind) || kind < 1 || kind > 29) throw Error('speed-curve.error.easing');
  start = quantize(start); end = quantize(end);
  if (!(end > start)) throw Error('speed-curve.error.cross');
  const factor = model.factor, tempo = model.tempo, a = tempo.seconds(start, factor), b = tempo.seconds(end, factor);
  const delta = endDistance - startDistance, tolerance = Math.max(.2, Math.abs(delta) * .0015);
  const rawStart = model.inverse(startDistance, start);
  const otherFloor = beat => { const seconds = tempo.seconds(beat, factor); return model.layers.reduce((sum, track, index) => index === layer ? sum : sum + track.integral.distance(seconds), 0); };
  const otherStart = otherFloor(start), cache = new Map();
  const target = beat => {
    if (!cache.has(beat)) {
      const u = Math.max(0, Math.min(1, (beat - start) / (end - start)));
      const distance = startDistance + delta * easing(u, kind);
      cache.set(beat, rawStart - model.inverse(distance, beat) - otherFloor(beat) + otherStart);
    }
    return cache.get(beat);
  };
  const make = (left, right, v0, v1, easingType = 1) => {
    const template = { ...model.at((left + right) / 2, layer)?.event };
    for (const key of ['rpeNextDistanceCurve', 'rpeNextSpeedCurveNode', 'rpeNextSpeedCurveEndNode', 'trajectory', 'bezierPoints']) delete template[key];
    return { ...template, customEasing: undefined, startTime: fromNumber(left, 1920000), endTime: fromNumber(right, 1920000), start: v0, end: v1, easingType, easingLeft: 0, easingRight: 1, bezier: 0, inst: 0, linkgroup: 0 };
  };
  const errorFor = (event, left, right, checks = 9) => {
    const integral = new SpeedIntegral([event], tempo, factor), seconds = tempo.seconds(left, factor), offset = target(left), zero = integral.distance(seconds);
    let error = 0;
    for (let i = 1; i <= checks; i++) {
      const beat = left + (right - left) * i / checks;
      const estimate = integral.distance(tempo.seconds(beat, factor)) - zero + offset;
      const actual = model.project(rawStart - estimate - otherFloor(beat) + otherStart);
      const desired = startDistance + delta * easing((beat - start) / (end - start), kind);
      error = Math.max(error, Math.abs(actual - desired));
    }
    return error;
  };
  // Common distance easing derivatives are native speed easings. Try these
  // first; quadratic distance (ID 5), for example, is one linear speed event.
  const maps = { 1: [1, 1, 1], 2: [Math.PI / 2, 0, 3], 3: [0, Math.PI / 2, 2], 4: [2, 0, 1], 5: [0, 2, 1], 8: [3, 0, 4], 9: [0, 3, 5], 10: [4, 0, 8], 11: [0, 4, 9], 14: [5, 0, 10], 15: [0, 5, 11] };
  const simpleControl = model.note.type === 2 || model.control.points.length <= 1 || model.control.points.every(point => point.y === 1);
  const noBpmBreak = !tempo.points.some(point => point.beat > start && point.beat < end);
  const othersConstant = model.layers.every((track, index) => index === layer || !track.entries.some(entry => entry.end > a && entry.start < b && entry.event.start !== entry.event.end) && !track.entries.slice(1).some(entry => entry.start > a && entry.start < b));
  let pieces;
  if (maps[kind] && simpleControl && noBpmBreak && othersConstant && Math.abs(model.noteSpeed) > 1e-12 && !(model.clampHoldHead && model.note.type === 2 && start >= model.hitBeat)) {
    const [first, last, speedEasing] = maps[kind];
    const other = model.layers.reduce((sum, track, index) => index === layer ? sum : sum + track.integral.value((a + b) / 2), 0);
    // Normalize against the player's actual quadrature, including its finite
    // error on quartic speed curves, so large distances keep exact endpoints.
    const basis = new SpeedIntegral([make(start, end, first, last, speedEasing)], tempo, factor);
    const rate = (target(end) + (b - a) * other * 120) / (basis.distance(b) - basis.distance(a));
    const event = make(start, end, rate * first - other, rate * last - other, speedEasing);
    if (errorFor(event, start, end, 41) <= tolerance) pieces = [event];
  }
  if (!pieces) {
    pieces = [];
    const fit = (left, right, depth = 0) => {
      const seconds = tempo.seconds(right, factor) - tempo.seconds(left, factor), area = (target(right) - target(left)) / 120;
      // A linear speed has quadratic accumulated distance. Interpolate the
      // midpoint and endpoints instead of differentiating singular endpoints.
      const middleSeconds = (tempo.seconds(left, factor) + tempo.seconds(right, factor)) / 2;
      const midpoint = (target(tempo.beat(middleSeconds, factor)) - target(left)) / 120;
      const first = (4 * midpoint - area) / seconds, last = (3 * area - 4 * midpoint) / seconds;
      const event = make(left, right, first, last);
      if (errorFor(event, left, right, 33) <= tolerance * .9) {
        if (pieces.length >= 64) throw Error('speed-curve.error.fitBudget');
        pieces.push(event); return;
      }
      const middle = quantize((left + right) / 2);
      if (pieces.length >= 63 || depth >= 24 || middle <= left || middle >= right) throw Error('speed-curve.error.fitBudget');
      fit(left, middle, depth + 1); fit(middle, right, depth + 1);
      if (pieces.length > 64) throw Error('speed-curve.error.fitBudget');
    };
    const cuts = [start, ...tempo.points.map(point => quantize(point.beat)).filter(beat => beat > start && beat < end), end].sort((a, b) => a - b);
    for (let i = 0; i < cuts.length - 1; i++) fit(cuts[i], cuts[i + 1]);
  }
  return { events: tagDistanceCurve(pieces, { id, start, end, easing: kind }), tolerance, pieces: pieces.length, target };
}

export function describeDistanceEasing(model, start, end, suggested) {
  const first = model.distance(start), delta = model.distance(end) - first;
  const samples = Array.from({ length: 17 }, (_, i) => model.distance(start + (end - start) * i / 16));
  const flat = samples.every(value => Math.abs(value - first) < 1e-5);
  if (flat || Math.abs(delta) < 1e-8) return { easing: 1, approximate: !flat };
  const normalized = samples.map(value => (value - first) / delta);
  const error = kind => normalized.reduce((sum, value, i) => sum + (value - easing(i / 16, kind)) ** 2, 0) / 17;
  if (suggested && error(suggested) <= .000025) return { easing: suggested, approximate: false };
  let kind = 1, best = error(1);
  for (let candidate = 2; candidate <= 29; candidate++) { const next = error(candidate); if (next < best) { best = next; kind = candidate; } }
  return { easing: kind, approximate: best > .000025 };
}
