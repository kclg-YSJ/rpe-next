import type { Beat } from './types.ts';

/**
 * Converts a beat triple to a single number.
 *
 * Accepts `unknown` because the value comes straight out of parsed JSON: every caller is either
 * validating an untrusted document or has already been checked by {@link assertChart}.
 */
export function beatValue(beat: unknown, path = 'beat'): number {
  if (!Array.isArray(beat) || beat.length !== 3 || !beat.every(Number.isSafeInteger) || beat[2] <= 0) {
    throw new Error(`${path}: 拍数必须为 [整数, 分子, 正分母]`);
  }
  return (beat[0] as number) + (beat[1] as number) / (beat[2] as number);
}

/**
 * Converts a number back to an exact beat triple.
 *
 * The default denominator is 19200 because that is the grid RPE itself snaps to; reducing by the
 * greatest common divisor keeps the stored form canonical, which matters because the reducer is
 * part of the on-disk representation compared by the round-trip tests.
 */
export function fromNumber(value: number, denominator = 19200): Beat {
  if (!Number.isFinite(value) || !Number.isSafeInteger(denominator) || denominator <= 0) throw new Error('非法拍数');
  const total = Math.round(value * denominator);
  if (!Number.isSafeInteger(total)) throw new Error('拍数超出安全精度范围');
  const whole = Math.floor(total / denominator);
  const numerator = total - whole * denominator;
  let divisor = denominator;
  let remainder = numerator;
  while (remainder) [divisor, remainder] = [remainder, divisor % remainder];
  return [whole, numerator / divisor, denominator / divisor];
}

/** Parses either a plain number or `whole:numerator/denominator` text. */
export function parseBeat(text: string | number): Beat {
  if (typeof text === 'number') return fromNumber(text);
  const match = String(text).trim().match(/^(-?\d+)\s*:\s*(-?\d+)\s*\/\s*(\d+)$/);
  if (match) {
    const beat = match.slice(1).map(Number) as Beat;
    beatValue(beat);
    return beat;
  }
  if (String(text).trim() === '') throw new Error('拍数不能为空');
  return fromNumber(Number(text));
}

export function formatBeat(beat: Beat): string { return `${beat[0]}:${beat[1]}/${beat[2]}`; }

/** Snaps a beat value onto a division grid, keeping the denominator exact. */
export function snapBeat(value: number, division: number): Beat { return fromNumber(value, division); }

/**
 * Binary search for the first index whose key exceeds `target`.
 *
 * Returns the insertion point, so `upperBound(values, x) - 1` is the last entry at or before `x`.
 */
export function upperBound<T>(values: readonly T[], target: number, key: (value: T) => number = value => value as unknown as number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (key(values[middle]) <= target) low = middle + 1;
    else high = middle;
  }
  return low;
}
