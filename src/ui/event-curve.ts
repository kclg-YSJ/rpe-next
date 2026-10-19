import { easing, bezier } from '../core/easing.ts';
import type { ChartEvent } from '../core/types.ts';
import type { Point } from '../core/editor-display.ts';

/** The curve cache key for one event at one sample count. */
interface CurveShape { key: string; samples: number[] }

/** The rectangle a curve is drawn into, in canvas pixels. */
interface CurveRect { x: number; y: number; width: number; height: number }

/** The options `drawEventCurve` accepts. */
export interface CurveOptions {
  steps?: number;
  padding?: number;
  lineWidth?: number;
  drawConstant?: boolean;
  append?: boolean;
}

/** The value range a chain spans, which is all a curve needs to normalise its samples. */
export interface ValueRange { min: number; max: number }

/** One curve in a batch: the event, its chain's value range, and the vertical span to draw into. */
export interface CurveBatchEntry {
  event: ChartEvent;
  range: ValueRange;
  startY: number;
  endY: number;
}

const shapes = new Map<string, number[]>();
const eventShapes = new WeakMap<ChartEvent, CurveShape>();
function curveShape(event: ChartEvent, steps: number): number[] {
  const points = event.bezierPoints as unknown as Point[] | undefined;
  const key = event.start === event.end || (!event.bezier && (event.easingType ?? 1) === 1) ? 'linear'
    : event.bezier ? `b:${steps}:${Array.isArray(points) ? points.join(',') : ''}` : `e:${steps}:${event.easingType}:${event.easingLeft ?? 0}:${event.easingRight ?? 1}`;
  const previous = eventShapes.get(event);
  if (previous?.key === key) return previous.samples;
  let samples = shapes.get(key);
  if (!samples) {
    samples = key === 'linear' ? [0, 1] : Array.from({ length: steps + 1 }, (_, step) => event.bezier
      ? bezier(step / steps, points) : easing(step / steps, event.easingType, event.easingLeft ?? 0, event.easingRight ?? 1));
    // Arbitrary Bezier controls can create many shapes while dragging; keep the shared cache bounded.
    if (shapes.size >= 256) shapes.delete(shapes.keys().next().value as string);
    shapes.set(key, samples);
  }
  eventShapes.set(event, { key, samples });
  return samples;
}

// All timeline views use the chain's value range, including short event segments.
export function drawEventCurve(context: CanvasRenderingContext2D, event: ChartEvent, range: ValueRange | null | undefined, rectangle: CurveRect, startY: number, endY: number, { steps = 36, padding = 6, lineWidth = 2, drawConstant = false, append = false }: CurveOptions = {}): boolean {
  const start = Number(event.start); const end = Number(event.end);
  if (![start, end, range?.min, range?.max].every(Number.isFinite)) return false;
  const span = (range?.max ?? 0) - (range?.min ?? 0);
  if (span <= 0.01 && !drawConstant) return false;
  if (!append) {
    context.save(); context.beginPath(); context.rect(rectangle.x, rectangle.y, rectangle.width, rectangle.height); context.clip();
    context.lineWidth = lineWidth; context.beginPath();
  }
  const samples = curveShape(event, steps);
  for (let step = 0; step < samples.length; step++) {
    const progress = step / (samples.length - 1);
    const amount = samples[step]!;
    const value = start + (end - start) * amount;
    const normalized = span > 0.01 ? (value - (range?.min ?? 0)) / span : 0.5;
    const x = rectangle.x + padding + normalized * Math.max(1, rectangle.width - 2 * padding);
    const y = startY + (endY - startY) * progress;
    if (step) context.lineTo(x, y); else context.moveTo(x, y);
  }
  if (!append) { context.stroke(); context.restore(); } return true;
}

export function drawEventCurveBatch(context: CanvasRenderingContext2D, entries: CurveBatchEntry[], rectangle: CurveRect, options: CurveOptions = {}): void {
  if (!entries.length) return;
  context.save(); context.beginPath(); context.rect(rectangle.x, rectangle.y, rectangle.width, rectangle.height); context.clip();
  context.lineWidth = options.lineWidth ?? 2; context.beginPath();
  const appendOptions = { ...options, append: true };
  for (const { event, range, startY, endY } of entries) drawEventCurve(context, event, range, rectangle, startY, endY, appendOptions);
  context.stroke(); context.restore();
}
