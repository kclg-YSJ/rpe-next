const halfPi = Math.PI / 2;
const back = 1.70158;
const backInOut = back * 1.525;
const elastic = 2 * Math.PI / 3;
const elasticInOut = 2 * Math.PI / 4.5;

/** A single easing curve: normalised progress in, normalised value out. */
type EasingCurve = (progress: number) => number;

function bounceOut(progress: number): number {
  if (progress < 1 / 2.75) return 7.5625 * progress ** 2;
  if (progress < 2 / 2.75) return 7.5625 * (progress - 1.5 / 2.75) ** 2 + 0.75;
  if (progress < 2.5 / 2.75) return 7.5625 * (progress - 2.25 / 2.75) ** 2 + 0.9375;
  return 7.5625 * (progress - 2.625 / 2.75) ** 2 + 0.984375;
}

const curves: EasingCurve[] = [
  progress => progress,
  progress => Math.sin(progress * halfPi),
  progress => 1 - Math.cos(progress * halfPi),
  progress => 1 - (1 - progress) ** 2,
  progress => progress ** 2,
  progress => (1 - Math.cos(Math.PI * progress)) / 2,
  progress => progress < 0.5 ? 2 * progress ** 2 : 1 - (-2 * progress + 2) ** 2 / 2,
  progress => 1 - (1 - progress) ** 3,
  progress => progress ** 3,
  progress => 1 - (1 - progress) ** 4,
  progress => progress ** 4,
  progress => progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2,
  progress => progress < 0.5 ? 8 * progress ** 4 : 1 - (-2 * progress + 2) ** 4 / 2,
  progress => 1 - (1 - progress) ** 5,
  progress => progress ** 5,
  progress => progress === 1 ? 1 : 1 - 2 ** (-10 * progress),
  progress => progress === 0 ? 0 : 2 ** (10 * progress - 10),
  progress => Math.sqrt(1 - (progress - 1) ** 2),
  progress => 1 - Math.sqrt(Math.abs(1 - progress ** 2)),
  progress => 1 + (back + 1) * (progress - 1) ** 3 + back * (progress - 1) ** 2,
  progress => (back + 1) * progress ** 3 - back * progress ** 2,
  progress => progress < 0.5 ? (1 - Math.sqrt(1 - (2 * progress) ** 2)) / 2 : (Math.sqrt(1 - (-2 * progress + 2) ** 2) + 1) / 2,
  progress => progress < 0.5 ? (2 * progress) ** 2 * ((backInOut + 1) * 2 * progress - backInOut) / 2 : ((2 * progress - 2) ** 2 * ((backInOut + 1) * (2 * progress - 2) + backInOut) + 2) / 2,
  progress => progress === 0 || progress === 1 ? progress : 2 ** (-10 * progress) * Math.sin((progress * 10 - 0.75) * elastic) + 1,
  progress => progress === 0 || progress === 1 ? progress : -(2 ** (10 * progress - 10)) * Math.sin((progress * 10 - 10.75) * elastic),
  bounceOut,
  progress => 1 - bounceOut(1 - progress),
  progress => progress < 0.5 ? (1 - bounceOut(1 - 2 * progress)) / 2 : (1 + bounceOut(2 * progress - 1)) / 2,
  progress => progress === 0 || progress === 1 ? progress : progress < 0.5 ? -(2 ** (20 * progress - 10) * Math.sin((20 * progress - 11.125) * elasticInOut)) / 2 : 2 ** (-20 * progress + 10) * Math.sin((20 * progress - 11.125) * elasticInOut) / 2 + 1,
];

/**
 * Evaluates easing curve `type` (1-based, matching `easingType` in the chart format) and remaps the
 * result so that `left` maps to 0 and `right` to 1.
 *
 * An unknown `type` falls back to the linear curve, and a degenerate range (where the curve gives
 * the same value at both ends) passes `progress` through untouched.
 */
export function easing(progress: number, type = 1, left = 0, right = 1): number {
  const curve = curves[type - 1] ?? curves[0];
  const base = curve(left);
  const range = curve(right) - base;
  if (Math.abs(range) < 1e-12) return progress;
  return (curve(left + (right - left) * progress) - base) / range;
}

/**
 * Evaluates a cubic Bezier easing defined by `[firstX, firstY, secondX, secondY]`.
 *
 * The x component is inverted numerically (40 bisection steps) because the curve is parametric:
 * `progress` is an x coordinate, not the parameter. Anything that is not four finite numbers is
 * rejected and `progress` is returned unchanged.
 */
export function bezier(progress: number, points: unknown): number {
  if (!Array.isArray(points) || points.length !== 4 || !points.every(Number.isFinite)) return progress;
  const [firstX, firstY, secondX, secondY] = points as number[];
  const component = (parameter: number, first: number, second: number): number => 3 * parameter * (1 - parameter) ** 2 * first + 3 * parameter ** 2 * (1 - parameter) * second + parameter ** 3;
  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < 40; iteration++) {
    const middle = (low + high) / 2;
    if (component(middle, firstX, secondX) < progress) low = middle;
    else high = middle;
  }
  return component((low + high) / 2, firstY, secondY);
}
