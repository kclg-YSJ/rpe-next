import { fitDistanceCurve, tagDistanceCurve, describeDistanceEasing } from '../core/distance-curve-fit.mjs';
import { SpeedCurveModel } from '../core/speed-curve.mjs';
import { chartWithEventLists } from './event-commands.mjs';
import { createEvent } from '../core/chart.mjs';
import { beatValue } from '../core/beat.mjs';
import { easing } from '../core/easing.mjs';

const EPS = 1e-7;
const editable = event => { if (event.linkgroup > 0) throw Error('speed-curve.error.linked'); if (!Number.isFinite(event.start) || !Number.isFinite(event.end) || event.trajectory) throw Error('speed-curve.error.unsupported'); };

export function distanceCurveGroups(model, layer) {
  return [...(model.layers[layer]?.recipes.values() ?? [])];
}

// Replaces only the requested intervals. Outside velocities and unknown fields
// stay in native speed events; no runtime-only curve is substituted on playback.
export function replaceDistanceCurves(model, layer, plans, split, { beat = plans[0].start, action = 'edit' } = {}) {
  const original = model.layers[layer]?.source ?? [];
  const low = Math.min(...plans.flatMap(plan => [plan.start, plan.oldStart ?? plan.start]));
  const high = Math.max(...plans.flatMap(plan => [plan.end, plan.oldEnd ?? plan.end]));
  const events = [];
  for (const event of original) {
    const start = beatValue(event.startTime), end = beatValue(event.endTime);
    if (end <= low + EPS && start < low - EPS || start >= high - EPS) { events.push(event); continue; }
    editable(event);
    if (start < low - EPS && end > low + EPS) events.push(split(event, low, model)[0]);
    if (end > high + EPS && start < high - EPS) events.push(split(event, high, model)[1]);
  }
  // Another selected note can put its default judgment node inside a previous
  // recipe. Keep each unchanged remainder grouped after replacing that slice.
  for (const group of distanceCurveGroups(model, layer)) {
    if (group.end <= low || group.start >= high) continue;
    for (const [start, end] of [[group.start, low], [high, group.end]]) {
      if (!(end > start)) continue;
      const parts = events.filter(event => event.rpeNextDistanceCurve?.id === group.id && beatValue(event.startTime) >= start - EPS && beatValue(event.endTime) <= end + EPS).sort((a, b) => beatValue(a.startTime) - beatValue(b.startTime));
      const tagged = tagDistanceCurve(parts, { id: crypto.randomUUID(), start, end, easing: describeDistanceEasing(model, start, end).easing });
      const replacements = new Map(parts.map((part, index) => [part, tagged[index]]));
      for (let index = 0; index < events.length; index++) if (replacements.has(events[index])) events[index] = replacements.get(events[index]);
    }
  }
  const track = model.layers[layer]?.integral, at = time => track?.value(model.tempo.seconds(time, model.factor)) ?? 0;
  if (!events.some(event => beatValue(event.startTime) < low - EPS)) events.push(createEvent(at(low - 1e-8), undefined, low - 1, low));
  if (!events.some(event => Math.abs(beatValue(event.startTime) - high) < EPS)) {
    const next = events.reduce((nearest, event) => { const start = beatValue(event.startTime); return start > high ? Math.min(nearest, start) : nearest; }, Infinity);
    events.push(createEvent(at(high + 1e-8), undefined, high, Number.isFinite(next) ? next : Math.max(high + 1, model.hitBeat)));
  }
  let pieces = 0; const fits = [];
  for (const plan of plans) {
    const fit = fitDistanceCurve(model, layer, { ...plan, id: plan.id ?? crypto.randomUUID() });
    pieces += fit.pieces; events.push(...fit.events); fits.push({ plan, fit });
  }
  const originals = new Set(original);
  for (const event of events) if (!Number.isFinite(event.start) || !Number.isFinite(event.end) || Math.abs(event.start) > 1e7 || Math.abs(event.end) > 1e7 || !originals.has(event) && beatValue(event.endTime) <= beatValue(event.startTime)) throw Error('speed-curve.error.range');
  const chart = chartWithEventLists(model.chart, model.lineIndex, layer, new Map([['speedEvents', events]]));
  const next = new SpeedCurveModel(chart, model.lineIndex, model.note, model, { clampHoldHead: model.clampHoldHead });
  for (const { plan, fit } of fits) {
    const first = plan.startDistance ?? model.distance(plan.start), delta = (plan.endDistance ?? model.distance(plan.end)) - first;
    // Compare real playback math with the requested curve, including controls.
    for (let i = 0; i <= 97; i++) {
      const point = plan.start + (plan.end - plan.start) * i / 97;
      const desired = first + delta * easing(i / 97, plan.easing), actual = next.distance(point);
      if (!Number.isFinite(actual) || Math.abs(desired - actual) > fit.tolerance * 1.15) throw Error('speed-curve.error.fitBudget');
    }
    for (const [point, desired] of [[plan.start, first], [plan.end, first + delta]]) if (Math.abs(next.distance(point) - desired) > Math.max(.01, Math.abs(desired) * 1e-6)) throw Error('speed-curve.error.solve');
  }
  return { chart, model: next, beat, layer, action, pieces, changed: pieces, fitted: pieces > plans.length };
}
