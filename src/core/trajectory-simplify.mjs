import { easing } from './easing.mjs';
import { t } from '../i18n.mjs';

export const DEFAULT_TRAJECTORY_SPLIT = Object.freeze({ simplify: true, tolerance: 1 });

export function trajectorySplitSettings(value = {}) {
  const settings = { ...DEFAULT_TRAJECTORY_SPLIT, ...value };
  if (typeof settings.simplify !== 'boolean' || !Number.isFinite(settings.tolerance) || settings.tolerance <= 0 || settings.tolerance > 10000) throw new Error(t('trajectory-simplify.sf285167'));
  return settings;
}

export function simplifyTrajectorySamples(values, tolerance) {
  if (values.length < 2 || !values.every(Number.isFinite) || !Number.isFinite(tolerance) || tolerance <= 0) throw new Error(t('trajectory-simplify.s16bd8d9'));
  const pieces = []; const pending = [[0, values.length - 1]];
  const fits = (first, last, type) => {
    const count = last - first; const initial = values[first]; const change = values[last] - initial;
    const at = progress => initial + change * easing(progress, type);
    for (let index = first + 1; index < last; index++) if (Math.abs(at((index - first) / count) - values[index]) > tolerance) return false;
    if (type === 1) return true;
    const bounded = (left, right, start, end, depth) => {
      const firstValue = at(left); const lastValue = at(right);
      if (Math.max(Math.abs(firstValue - end), Math.abs(lastValue - start), Math.abs(firstValue - start), Math.abs(lastValue - end)) <= tolerance) return true;
      const middle = (left + right) / 2; const value = (start + end) / 2;
      if (depth === 0 || Math.abs(at(middle) - value) > tolerance) return false;
      return bounded(left, middle, start, value, depth - 1) && bounded(middle, right, value, end, depth - 1);
    };
    for (let index = first; index < last; index++) if (!bounded((index - first) / count, (index + 1 - first) / count, values[index], values[index + 1], 12)) return false;
    return true;
  };
  while (pending.length) {
    const [first, last] = pending.pop(); let type = 1;
    for (; type <= 19; type++) if (fits(first, last, type)) break;
    if (type <= 19) pieces.push({ first, last, easingType: type });
    else { const middle = Math.floor((first + last) / 2); pending.push([middle, last], [first, middle]); }
  }
  return pieces;
}
