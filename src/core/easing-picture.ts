import { easing } from './easing.ts';

/**
 * Renders the SVG curve preview for one RPE easing type.
 *
 * `type` is the raw RPE easing index (1-29) rather than a narrowed union: `easing()` already
 * falls back to the linear curve for out-of-range values, and the picker passes the numeric
 * field straight through.
 */
export function easingPicture(type: number): string {
  const points = Array.from({ length: 129 }, (unused, index) => ({ progress: index / 128, value: easing(index / 128, type) }));
  const minimum = Math.min(0, ...points.map(point => point.value));
  const maximum = Math.max(1, ...points.map(point => point.value));
  const vertical = (value: number): number => 86 - (value - minimum) / (maximum - minimum) * 72;
  const path = points.map((point, index) => `${index ? 'L' : 'M'}${(12 + point.progress * 96).toFixed(2)} ${vertical(point.value).toFixed(2)}`).join(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 100"><rect width="120" height="100" fill="#242424"/><path d="M12 ${vertical(0)}H108M12 ${vertical(1)}H108M12 10V90" fill="none" stroke="#646464"/><path d="${path}" fill="none" stroke="#ffdb79" stroke-width="2.5"/></svg>`;
}
