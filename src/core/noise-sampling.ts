import { noiseRuntime } from './noise-areas.ts';
import type { NoiseArea, NoiseAreaSample, NoiseEvent, NoisePoint, NoiseSampleOverride, NoiseTarget } from './noise-areas.ts';
import { previewViewport } from './editor-display.ts';
import type { Point } from './editor-display.ts';
import type { Beat } from './types.ts';

/** The tempo lookup the sampler needs; only the seconds conversion is used. */
export interface NoiseSampleTempo {
  seconds(beat: number | Beat | [number, number, number]): number;
}

/**
 * Rounds a coordinate to four decimals.
 *
 * The panel writes these values back into event fields that the format stores as text, so a long
 * floating-point tail would show up in the inspector and bloat the saved chart.
 */
const sampleNumber = (value: number): number => Math.round(value * 10000) / 10000;

/**
 * The event `target` names, or `undefined` when the area has no such track.
 *
 * `NoiseArea` declares an index signature so a partially-typed chart still loads, which makes every
 * read through `target.type` `unknown`. The sampler only ever targets the six transform tracks, and
 * those are always event arrays, so this narrows the one place that reads through the index
 * signature instead of casting at each use.
 */
function eventAt(area: NoiseArea, target: NoiseTarget): NoiseEvent | undefined {
  const track = target.type ? area[target.type] : null;
  if (!Array.isArray(track)) return undefined;
  const event: NoiseEvent | undefined = track[target.index];
  return event;
}

/**
 * The corner point a `bottomLeft`/`topRight` field names.
 *
 * The index signature makes the read `unknown`; `NoiseArea` declares both of those fields as
 * `NoisePoint`, and those are the only two field names this sampler passes here.
 */
function cornerOf(area: NoiseArea, field: string): NoisePoint {
  const corner: NoisePoint = area[field] as NoisePoint;
  return corner;
}

/** The same read as {@link eventAt} for callers that already hold the track name. */
function eventIn(area: NoiseArea, type: string, index: number): NoiseEvent | undefined {
  return eventAt(area, { type, index, field: 'start' });
}

/**
 * An event's `start`/`end`/`anchor`-style fields viewed as numbers.
 *
 * `NoiseEvent` narrows `start` and `end` to `number`, but a dynamically-named field still reads
 * through `ChartEvent`'s index signature as `unknown`; every field a target can name is a number.
 */
function eventValues(event: NoiseEvent): Record<string, number> {
  const values: Record<string, number> = event as unknown as Record<string, number>;
  return values;
}

/**
 * The zoom that just fits a point inside the sample view.
 *
 * Used when the panel jumps to an area's handle: the divisor grows until the handle is inside the
 * preview rectangle, with a different vertical budget above and below the centre because the toolbar
 * and the transport bar both eat into the canvas.
 */
export function fitNoiseSampleView(point: Point, width: number, height: number, aspectRatio: number, divisor: number, controlsBottom = 64): number {
  if (!(width > 0 && height > 0)) return divisor;
  const viewport = previewViewport(width, height, aspectRatio);
  const horizontal = Math.max(1, viewport.width / 2 - 24);
  const vertical = Math.max(1, point.y >= 0 ? height / 2 - Math.max(viewport.top + 24, controlsBottom + 20) : Math.min(viewport.height / 2 - 24, height / 2 - 60));
  return Math.max(divisor, Math.abs(point.x) * viewport.scale / horizontal, Math.abs(point.y) * viewport.scale / vertical);
}

/**
 * Samples one editing area at `seconds`, optionally with a candidate value substituted for the field
 * the user is dragging.
 *
 * The override is what makes dragging work: the handle is asked for the position it *would* have at
 * the proposed value, so the panel can invert that relationship to find the value under the cursor.
 */
export function sampleEditingArea(area: NoiseArea, tempo: NoiseSampleTempo, seconds: number, target: NoiseTarget): NoiseAreaSample {
  const event = eventAt(area, target);
  const overrides: NoiseSampleOverride = event && ['start', 'end'].includes(target.field) ? { [target.type]: { value: eventValues(event)[target.field], event } } : {};
  return noiseRuntime(area, tempo).sample(seconds, overrides);
}

/**
 * Where the handle for `target` currently sits, in chart coordinates.
 *
 * An anchor handle is the stored anchor itself. A corner handle is the transformed corner, and any
 * other handle is measured through `reference` — a point chosen by {@link samplingTarget} to move
 * monotonically with the value being dragged, which is what lets the drag be inverted at all.
 */
export function noiseSampleHandle(area: NoiseArea, tempo: NoiseSampleTempo, seconds: number, target: NoiseTarget): Point {
  const event = eventAt(area, target);
  // Only the three anchored tracks are offered an `anchor` handle, so the event carries one; the
  // field is optional on `NoiseEvent` because the unanchored tracks share the type.
  if (target.field === 'anchor') { const anchor = (event as NoiseEvent).anchor as NoisePoint; return { ...anchor }; }
  const sample = sampleEditingArea(area, tempo, seconds, target);
  if (['bottomLeft', 'topRight'].includes(target.field)) return sample.transform(cornerOf(area, target.field));
  if (target.reference) return sample.transform(target.reference);
  return sample.center;
}

/**
 * Picks the point a drag of `field` is measured through.
 *
 * Rotation and scale move a whole area, so no single corner tracks the value linearly. The corner
 * that is *farthest* from the anchor is chosen instead, because its displacement per unit of the
 * value is largest and the inversion is therefore best conditioned.
 */
export function samplingTarget(area: NoiseArea, type: string, index: number, field: string): NoiseTarget {
  const target: NoiseTarget = { type, index, field };
  if (['rotateEvents', 'scaleXEvents', 'scaleYEvents'].includes(type) && field !== 'anchor') {
    // Only the three anchored tracks reach here, and they are always event arrays.
    const anchor = eventIn(area, type, index)?.anchor ?? { x: 0, y: 0 };
    const corners: Point[] = [area.bottomLeft, area.topRight, { x: area.bottomLeft.x, y: area.topRight.y }, { x: area.topRight.x, y: area.bottomLeft.y }];
    const distance = (point: Point): number => type === 'scaleXEvents' ? Math.abs(point.x - anchor.x) : type === 'scaleYEvents' ? Math.abs(point.y - anchor.y) : Math.hypot(point.x - anchor.x, point.y - anchor.y);
    target.reference = { ...corners.sort((left, right) => distance(right) - distance(left))[0] };
  }
  return target;
}

/** Writes `value` into the targeted event, keeping a hooked event's two ends equal. */
function setValue(area: NoiseArea, target: NoiseTarget, value: number): void {
  const event = eventAt(area, target) as NoiseEvent;
  eventValues(event)[target.field] = value;
  if (event.inst) eventValues(event)[target.field === 'start' ? 'end' : 'start'] = value;
}

/** Reads the numeric field `target` names off the event it points at. */
function readValue(area: NoiseArea, target: NoiseTarget): number {
  const event = eventAt(area, target) as NoiseEvent;
  const value: number = eventValues(event)[target.field];
  return value;
}

/**
 * Returns a copy of `area` with the value under `target` moved so its handle lands on `point`.
 *
 * Each field type is inverted differently. An anchor is written straight through. A corner is solved
 * by measuring how each axis moves the handle and inverting that 2x2 Jacobian, which is why a
 * degenerate (zero-scale) transform is refused rather than producing a division by ~0. Rotation is
 * non-linear, so it is solved by eight Newton steps along the handle's own derivative. Everything
 * else is linear in one scalar and is solved directly.
 */
export function applyNoiseSample(area: NoiseArea, tempo: NoiseSampleTempo, seconds: number, target: NoiseTarget, point: Point): NoiseArea {
  const result = structuredClone(area);
  if (target.field === 'anchor') { (eventAt(result, target) as NoiseEvent).anchor = { x: sampleNumber(point.x), y: sampleNumber(point.y) }; return result; }
  const original = noiseSampleHandle(area, tempo, seconds, target);
  const delta = { x: point.x - original.x, y: point.y - original.y };
  if (['bottomLeft', 'topRight'].includes(target.field)) {
    // The Jacobian column for each axis, found by nudging that axis by one and re-measuring.
    const sampleAxis = (axis: 'x' | 'y'): Point => { const changed = structuredClone(area); cornerOf(changed, target.field)[axis] += 1; const handle = noiseSampleHandle(changed, tempo, seconds, target); return { x: handle.x - original.x, y: handle.y - original.y }; };
    const horizontal = sampleAxis('x'); const vertical = sampleAxis('y');
    const determinant = horizontal.x * vertical.y - horizontal.y * vertical.x;
    if (Math.abs(determinant) < 1e-8) throw new Error('当前缩放为零或变换退化，无法反算角点；请改用文本输入或其他时间点');
    cornerOf(result, target.field).x += (delta.x * vertical.y - delta.y * vertical.x) / determinant;
    cornerOf(result, target.field).y += (horizontal.x * delta.y - horizontal.y * delta.x) / determinant;
  } else if (target.type === 'rotateEvents') {
    let value = readValue(area, target);
    for (let iteration = 0; iteration < 8; iteration++) {
      setValue(result, target, value);
      const current = noiseSampleHandle(result, tempo, seconds, target);
      const probe = structuredClone(area); setValue(probe, target, value + 0.01);
      const derivative = noiseSampleHandle(probe, tempo, seconds, target);
      const dx = derivative.x - current.x; const dy = derivative.y - current.y;
      const length = dx * dx + dy * dy;
      if (length < 1e-10) throw new Error('当前变换无法反算旋转值；请改用文本输入或调整锚点');
      const errorX = point.x - current.x; const errorY = point.y - current.y;
      const delta = (errorX * dx + errorY * dy) / length;
      value += delta * 0.01;
      if (Math.hypot(errorX, errorY) < 1e-5) break;
    }
    setValue(result, target, value);
  } else {
    const changed = structuredClone(area); setValue(changed, target, readValue(area, target) + 1);
    const handle = noiseSampleHandle(changed, tempo, seconds, target); const axis = { x: handle.x - original.x, y: handle.y - original.y };
    const length = axis.x * axis.x + axis.y * axis.y;
    if (length < 1e-8) throw new Error('当前变换无法反算该缩放值；请改用文本输入或调整锚点');
    setValue(result, target, readValue(area, target) + (delta.x * axis.x + delta.y * axis.y) / length);
  }
  // Only the values that were actually edited are rounded, so untouched fields keep their exact input.
  if (['bottomLeft', 'topRight'].includes(target.field)) for (const axis of ['x', 'y'] as const) cornerOf(result, target.field)[axis] = sampleNumber(cornerOf(result, target.field)[axis]);
  else setValue(result, target, sampleNumber(readValue(result, target)));
  return result;
}
