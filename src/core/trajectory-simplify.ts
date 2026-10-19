import { easing } from './easing.ts';
import type { TrajectorySplit } from './types.ts';

/** One straight run of the fitted curve, as an inclusive index range and the easing that matches it. */
export interface TrajectoryPiece {
  first: number;
  last: number;
  easingType: number;
}

export const DEFAULT_TRAJECTORY_SPLIT: Readonly<TrajectorySplit> = Object.freeze({ simplify: true, tolerance: 1 });

export function trajectorySplitSettings(value: Partial<TrajectorySplit> = {}): TrajectorySplit {
  const settings = { ...DEFAULT_TRAJECTORY_SPLIT, ...value };
  if (typeof settings.simplify !== 'boolean' || !Number.isFinite(settings.tolerance) || settings.tolerance <= 0 || settings.tolerance > 10000) throw new Error('拆分容忍度须大于 0 且不超过 10000');
  return settings;
}

export function simplifyTrajectorySamples(values: number[], tolerance: number): TrajectoryPiece[] {
  if (values.length < 2 || !values.every(Number.isFinite) || !Number.isFinite(tolerance) || tolerance <= 0) throw new Error('轨迹拟合输入无效');
  const pieces: TrajectoryPiece[] = []; const pending: [number, number][] = [[0, values.length - 1]];
  const fits = (first: number, last: number, type: number): boolean => {
    const count = last - first; const initial = values[first]!; const change = values[last]! - initial;
    const at = (progress: number): number => initial + change * easing(progress, type);
    for (let index = first + 1; index < last; index++) if (Math.abs(at((index - first) / count) - values[index]!) > tolerance) return false;
    if (type === 1) return true;
    const bounded = (left: number, right: number, start: number, end: number, depth: number): boolean => {
      const firstValue = at(left); const lastValue = at(right);
      if (Math.max(Math.abs(firstValue - end), Math.abs(lastValue - start), Math.abs(firstValue - start), Math.abs(lastValue - end)) <= tolerance) return true;
      const middle = (left + right) / 2; const value = (start + end) / 2;
      if (depth === 0 || Math.abs(at(middle) - value) > tolerance) return false;
      return bounded(left, middle, start, value, depth - 1) && bounded(middle, right, value, end, depth - 1);
    };
    for (let index = first; index < last; index++) if (!bounded((index - first) / count, (index + 1 - first) / count, values[index]!, values[index + 1]!, 12)) return false;
    return true;
  };
  while (pending.length) {
    // The loop condition proves the stack is non-empty, so the pop always answers a pair; the
    // original destructured it unguarded and `!` records that rather than inventing a fallback.
    const [first, last] = pending.pop()!; let type = 1;
    for (; type <= 19; type++) if (fits(first, last, type)) break;
    if (type <= 19) pieces.push({ first, last, easingType: type });
    else { const middle = Math.floor((first + last) / 2); pending.push([middle, last], [first, middle]); }
  }
  return pieces;
}
