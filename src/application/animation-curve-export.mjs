import { fromNumber, beatValue } from '../core/beat.mjs';
import { eventNumericValue, customEventIntegral, eventEndpoints } from '../core/event-easing.mjs';
import { EventTrack } from '../core/events.mjs';
import { t } from '../i18n.mjs';
import { compileAnimationCurve } from '../core/animation-curve.mjs';

// Adaptive linear baking runs on event seconds, including nonuniform BPM maps.
export function bakeAnimationCurve(event, tempo, factor = 1, { tolerance = .001, distanceTolerance = .1, maxSegments = 8192, speed = false } = {}) {
  if (!event.customEasing) return [event];
  if (!(tolerance > 0) || !Number.isFinite(tolerance) || !(distanceTolerance > 0) || !Number.isFinite(distanceTolerance) || !Number.isInteger(maxSegments) || maxSegments < 1 || maxSegments > 8192) throw Error(t('animation-curve.invalidBake'));
  const start = tempo.seconds(event.startTime, factor), finish = tempo.seconds(event.endTime, factor), duration = finish - start;
  const base = { ...event, easingType: 1, easingLeft: 0, easingRight: 1, bezier: 0, bezierPoints: [0, 0, 1, 1], linkgroup: 0 };
  delete base.customEasing;
  if (duration <= 0) { const value = new EventTrack([event], tempo, factor).value(start); return [{ ...base, start: value, end: value }]; }
  const [sourceA, sourceB] = eventEndpoints(event), numeric = typeof sourceA === 'number' && typeof sourceB === 'number', array = Array.isArray(sourceA) && Array.isArray(sourceB);
  if (numeric && sourceA === sourceB || array && sourceA.every((v, i) => v === sourceB[i])) return [{ ...base, start: structuredClone(sourceA), end: structuredClone(sourceB) }];
  const textTrack = numeric || array ? null : new EventTrack([event], tempo, factor);
  const sample = p => numeric || array ? eventNumericValue(event, p) : textTrack.value(start + duration * p);
  const vector = value => Array.isArray(value) ? value : [value];
  const scale = numeric || array ? Math.max(1e-8, ...vector(sourceA).map((v, i) => Math.abs(vector(sourceB)[i] - v))) : 1;
  const limit = scale * tolerance, output = [], c = event.customEasing, [left, right] = c.domain ?? [0, 1];
  const cuts = [0, ...c.curve.nodes.map(n => (n.x - left) / (right - left)).filter(p => p > 0 && p < 1), 1];
  const compiled = compileAnimationCurve(c.curve);
  // Keeps cumulative absolute distance drift under budget, not just final cancellation.
  const split = (a, b, depth = 0) => {
    const bound = compiled.chordError(left + (right - left) * a, left + (right - left) * b);
    const va = sample(a), vb = sample(bound.hold ? (a + b) / 2 : b);
    let error = numeric || array ? bound.error * scale : 0;
    for (const u of [.125, .25, .375, .5, .625, .75, .875]) {
      const actual = sample(a + (b - a) * u);
      if (numeric || array) vector(actual).forEach((v, i) => { error = Math.max(error, Math.abs(v - (vector(va)[i] + (vector(vb)[i] - vector(va)[i]) * u))); });
      else if (JSON.stringify(actual) !== JSON.stringify(va)) error = 1;
    }
    const drift = speed && numeric ? Math.max(Math.abs((b - a) * (va + vb) / 2 - customEventIntegral(event, a, b)), error * (b - a)) * duration * 120 : 0;
    if ((error > limit && (numeric || array || b - a > 1e-5)) || drift > distanceTolerance * (b - a)) {
      if (depth >= 24 || output.length >= maxSegments - 1) throw Error(t('animation-curve.bakeBudget'));
      const middle = (a + b) / 2; split(a, middle, depth + 1); split(middle, b, depth + 1); return;
    }
    if (output.length >= maxSegments) throw Error(t('animation-curve.bakeBudget'));
    const at = p => p === 0 ? event.startTime : p === 1 ? event.endTime : fromNumber(tempo.beat(start + duration * p, factor), Math.min(1e9, Math.floor(Number.MAX_SAFE_INTEGER / Math.max(1, Math.abs(tempo.beat(finish, factor))))));
    const startTime = at(a), endTime = at(b);
    if (beatValue(endTime) <= beatValue(startTime)) throw Error(t('animation-curve.bakeResolution'));
    output.push({ ...base, startTime, endTime, start: va, end: numeric || array ? vb : va });
  };
  for (let i = 0; i < cuts.length - 1; i++) split(cuts[i], cuts[i + 1]);
  const final = sample(1), last = output.at(-1);
  // RPE accepts instant boundary events. They express the terminal jump of Hold
  // and discrete text/boolean tracks without consuming neighboring time.
  if (JSON.stringify(last.end) !== JSON.stringify(final) && (numeric || array ? Math.max(...vector(final).map((v, i) => Math.abs(v - vector(last.end)[i]))) > limit : true)) {
    if (output.length >= maxSegments) throw Error(t('animation-curve.bakeBudget'));
    output.push({ ...base, startTime: event.endTime, endTime: event.endTime, start: final, end: final });
  }
  else last.end = final;
  return output;
}

export function bakeChartAnimationCurves(chart, tempo, settings = {}) {
  let count = 0;
  const track = (events, factor, speed = false) => events.flatMap(event => { const next = bakeAnimationCurve(event, tempo, factor, { ...settings, speed }); count += next.length; if (count > 1000000) throw Error(t('animation-curve.bakeBudget')); return next; });
  const shader = (effects, factor) => effects?.map(effect => effect?.vars ? { ...effect, vars: Object.fromEntries(Object.entries(effect.vars).map(([key, value]) => [key, Array.isArray(value) && value[0]?.startTime ? track(value, factor) : value])) } : effect);
  const layer = (value, factor) => value && Object.fromEntries(Object.entries(value).map(([key, events]) => [key, Array.isArray(events) ? key === 'paintEvents' ? shader(events, factor) : track(events, factor, key === 'speedEvents') : events]));
  return { ...chart, judgeLineList: chart.judgeLineList?.map(line => ({ ...line, eventLayers: line.eventLayers?.map(l => layer(l, line.bpmfactor ?? 1)), extended: layer(line.extended, line.bpmfactor ?? 1) })),
    ...(chart.effects ? { effects: shader(chart.effects, 1) } : {}), ...(chart.shaderEvents ? { shaderEvents: shader(chart.shaderEvents, 1) } : {}),
    ...(chart.META?.effects ? { META: { ...chart.META, effects: shader(chart.META.effects, 1) } } : {}) };
}
