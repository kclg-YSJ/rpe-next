import { easing, bezier } from './easing.mjs';
import { assertAnimationCurve, compileAnimationCurve } from './animation-curve.mjs';
import { t } from '../i18n.mjs';

export function assertEventEasing(event) {
  const c = event.customEasing; if (!c) return;
  assertAnimationCurve(c.curve);
  if (c.domain && (!Array.isArray(c.domain) || c.domain.length !== 2 || !c.domain.every(Number.isFinite) || c.domain[0] < 0 || c.domain[1] > 1 || c.domain[0] >= c.domain[1])) throw Error(t('animation-curve.invalidDomain'));
  const valid = v => typeof v === 'string' || typeof v === 'number' && Number.isFinite(v) || typeof v === 'boolean' || Array.isArray(v) && v.every(n => typeof n === 'number' && Number.isFinite(n));
  if (('sourceStart' in c) !== ('sourceEnd' in c) || 'sourceStart' in c && (!valid(c.sourceStart) || !valid(c.sourceEnd) || typeof c.sourceStart !== typeof c.sourceEnd || Array.isArray(c.sourceStart) !== Array.isArray(c.sourceEnd) || Array.isArray(c.sourceStart) && c.sourceStart.length !== c.sourceEnd.length)) throw Error(t('animation-curve.invalidSource'));
  if ('sourceStart' in c && (typeof c.sourceStart !== typeof event.start || Array.isArray(c.sourceStart) !== Array.isArray(event.start) || Array.isArray(c.sourceStart) && (c.sourceStart.length !== event.start.length || c.sourceEnd.length !== event.end?.length))) throw Error(t('animation-curve.invalidSource'));
}
export function eventEasing(event, progress) {
  const c = event.customEasing;
  if (c) { const [a, b] = c.domain ?? [0, 1]; return compileAnimationCurve(c.curve).value(a + (b - a) * Math.max(0, Math.min(1, progress))); }
  return event.bezier ? bezier(progress, event.bezierPoints) : easing(progress, event.easingType, event.easingLeft ?? 0, event.easingRight ?? 1);
}
export const eventEndpoints = event => event.customEasing && 'sourceStart' in event.customEasing ? [event.customEasing.sourceStart, event.customEasing.sourceEnd] : [event.start, event.end];
export function eventNumericValue(event, progress) {
  const [a, b] = eventEndpoints(event), t = eventEasing(event, progress);
  return Array.isArray(a) ? a.map((v, i) => v + (b[i] - v) * t) : a + (b - a) * t;
}
export function customEventIntegral(event, from, to) {
  const c = event.customEasing, [a, b] = c.domain ?? [0, 1], [start, end] = eventEndpoints(event);
  return start * (to - from) + (end - start) * compileAnimationCurve(c.curve).integral(a + (b - a) * from, a + (b - a) * to) / (b - a);
}
export function cropCustomEvent(event, from, to, startTime, endTime) {
  const c = event.customEasing, [a, b] = c.domain ?? [0, 1], [sourceStart, sourceEnd] = eventEndpoints(event);
  return { ...event, startTime, endTime, start: eventNumericValue(event, from), end: eventNumericValue(event, to), customEasing: { ...c, sourceStart, sourceEnd, domain: [a + (b - a) * from, a + (b - a) * to] } };
}
export function withStandardEasing(event, type) { const { customEasing, ...rest } = event; return { ...rest, easingType: type, bezier: 0 }; }
export function withCustomEasing(event, curve) { return { ...event, bezier: 0, easingLeft: 0, easingRight: 1, customEasing: { curve: structuredClone(curve) } }; }
export function eventValueRange(event) {
  if (typeof event.start !== 'number' || typeof event.end !== 'number') return null;
  const c = event.customEasing;
  if (!c) return { min: Math.min(event.start, event.end), max: Math.max(event.start, event.end) };
  const [a, b] = eventEndpoints(event), range = compileAnimationCurve(c.curve).range(...(c.domain ?? [0, 1]));
  const first = a + (b - a) * range.min, last = a + (b - a) * range.max;
  return { min: Math.min(first, last), max: Math.max(first, last) };
}

// Endpoint property edits on a cropped event change the source affine mapping,
// retaining its shape and source domain. Degenerate ranges remain explicit.
export function rebaseCustomEventValues(before, next) {
  const c = before.customEasing;
  if (!c || !('sourceStart' in c) || !next.customEasing || JSON.stringify(c) !== JSON.stringify(next.customEasing) || JSON.stringify([before.start, before.end]) === JSON.stringify([next.start, next.end])) return next;
  const p = eventEasing(before, 0), q = eventEasing(before, 1), source = eventEndpoints(before);
  const scalar = (a, b, s0, s1) => {
    if (Math.abs(q - p) < 1e-10) {
      if (Math.abs(a - b) > 1e-8) throw Error(t('animation-curve.equalCrop'));
      const shift = a - (s0 + (s1 - s0) * p); return [s0 + shift, s1 + shift];
    }
    const delta = (b - a) / (q - p), start = a - delta * p; return [start, start + delta];
  };
  let values;
  if (typeof next.start === 'number') values = scalar(next.start, next.end, ...source);
  else if (Array.isArray(next.start)) { const pairs = next.start.map((v, i) => scalar(v, next.end[i], source[0][i], source[1][i])); values = [pairs.map(v => v[0]), pairs.map(v => v[1])]; }
  else throw Error(t('animation-curve.equalCrop'));
  if (!values.flat().every(Number.isFinite)) throw Error(t('animation-curve.invalidNumber'));
  return { ...next, customEasing: { ...next.customEasing, sourceStart: values[0], sourceEnd: values[1] } };
}
