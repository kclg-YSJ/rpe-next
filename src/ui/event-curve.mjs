import { easing, bezier } from '../core/easing.mjs';
import { eventEasing, eventEndpoints } from '../core/event-easing.mjs';

const shapes = new Map();
const eventShapes = new WeakMap();
function curveShape(event, steps) {
  if (event.customEasing) { let found = eventShapes.get(event); if (found?.steps === steps && found.custom === event.customEasing && found.curve === event.customEasing.curve) return found.samples; const samples = Array.from({ length: steps + 1 }, (_, i) => eventEasing(event, i / steps)); eventShapes.set(event, { samples, steps, custom: event.customEasing, curve: event.customEasing.curve }); return samples; }
  const points = event.bezierPoints;
  const key = event.start === event.end || (!event.bezier && (event.easingType ?? 1) === 1) ? 'linear'
    : event.bezier ? `b:${steps}:${Array.isArray(points) ? points.join(',') : ''}` : `e:${steps}:${event.easingType}:${event.easingLeft ?? 0}:${event.easingRight ?? 1}`;
  const previous = eventShapes.get(event);
  if (previous?.key === key) return previous.samples;
  let samples = shapes.get(key);
  if (!samples) {
    samples = key === 'linear' ? [0, 1] : Array.from({ length: steps + 1 }, (_, step) => event.bezier
      ? bezier(step / steps, points) : easing(step / steps, event.easingType, event.easingLeft ?? 0, event.easingRight ?? 1));
    // Arbitrary Bezier controls can create many shapes while dragging; keep the shared cache bounded.
    if (shapes.size >= 256) shapes.delete(shapes.keys().next().value);
    shapes.set(key, samples);
  }
  eventShapes.set(event, { key, samples });
  return samples;
}

// All timeline views use the chain's value range, including short event segments.
export function drawEventCurve(context, event, range, rectangle, startY, endY, { steps = 36, padding = 6, lineWidth = 2, drawConstant = false, append = false } = {}) {
  if (![event.start, event.end, range?.min, range?.max].every(Number.isFinite)) return false;
  const span = range.max - range.min;
  if (span <= 0.01 && !drawConstant) return false;
  if (!append) {
    context.save(); context.beginPath(); context.rect(rectangle.x, rectangle.y, rectangle.width, rectangle.height); context.clip();
    context.lineWidth = lineWidth; context.beginPath();
  }
  const samples = curveShape(event, steps);
  const endpoints = event.customEasing ? eventEndpoints(event) : null, a = endpoints?.[0] ?? event.start, b = endpoints?.[1] ?? event.end;
  for (let step = 0; step < samples.length; step++) {
    const progress = step / (samples.length - 1);
    const amount = samples[step];
    const value = a + (b - a) * amount;
    const normalized = span > 0.01 ? (value - range.min) / span : 0.5;
    const x = rectangle.x + padding + normalized * Math.max(1, rectangle.width - 2 * padding);
    const y = startY + (endY - startY) * progress;
    if (step) context.lineTo(x, y); else context.moveTo(x, y);
  }
  if (!append) { context.stroke(); context.restore(); } return true;
}

export function drawEventCurveBatch(context, entries, rectangle, options = {}) {
  if (!entries.length) return;
  context.save(); context.beginPath(); context.rect(rectangle.x, rectangle.y, rectangle.width, rectangle.height); context.clip();
  context.lineWidth = options.lineWidth ?? 2; context.beginPath();
  const appendOptions = { ...options, append: true };
  for (const { event, range, startY, endY } of entries) drawEventCurve(context, event, range, rectangle, startY, endY, appendOptions);
  context.stroke(); context.restore();
}
