import { beatValue, fromNumber } from './beat.ts';
import type { TempoMap } from './tempo.ts';
import type { Beat } from './types.ts';

/** Horizontal lane grid: the world-space spacing between grid lines and the first/last lane. */
export interface VerticalGrid {
  spacing: number;
  first: number;
  last: number;
}

export function verticalGrid(count = 11): VerticalGrid {
  const spacing = 1350 / (count - 1);
  const half = (Math.floor(count + 0.01) - 1) / 2;
  return { spacing, first: -half, last: half };
}

export function snapPosition(value: number, count: number, enabled = true): number {
  if (!enabled) return value;
  const { spacing, first } = verticalGrid(count);
  return (Math.round(value / spacing - first) + first) * spacing;
}

/**
 * Snaps a wall-clock position onto the nearest `division`-th of a beat.
 *
 * Both candidate divisions are converted back to seconds before comparing, so the result follows
 * the tempo map rather than assuming a constant beat length.
 */
export function snapTime(seconds: number, division: number, tempo: TempoMap, factor = 1): Beat {
  const beat = Math.max(0, tempo.beat(seconds, factor));
  const lower = Math.floor(beat * division) / division;
  const upper = lower + 1 / division;
  return fromNumber(Math.abs(tempo.seconds(lower, factor) - seconds) <= Math.abs(tempo.seconds(upper, factor) - seconds) ? lower : upper);
}

/** The beat span between two positions, or `null` when they are too close to form a Hold. */
export function placementRange(first: unknown, second: unknown): { start: number; end: number } | null {
  const start = Math.min(beatValue(first), beatValue(second));
  const end = Math.max(beatValue(first), beatValue(second));
  return end - start < 0.001 ? null : { start, end };
}

/** Seconds to scroll (signed) for one wheel event, including the burst-acceleration ramp. */
export function wheelSeconds(delta: number, duration: number, speed: number, rate: number, accelerated = false, burstSeconds = 0, alt = false): number {
  const acceleration = accelerated ? 1 + 4 * (Math.min(4, Math.max(0, burstSeconds)) / 4) ** 3 : 1;
  return -Math.sign(delta) * duration / 1000000 * speed * rate * (alt ? 500 : 100) * acceleration;
}
