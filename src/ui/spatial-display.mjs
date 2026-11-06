// Display formatting only. Never round values passed to edit transactions.
export const displayNumber = value => Number.isFinite(value) ? (Math.abs(value) < .05 ? 0 : value).toFixed(1) : '—';
export const displayPosition = point => `(${displayNumber(point.x)}, ${displayNumber(point.y)})`;
export function spatialBoundaryFade(beat, current, past, future) {
  const delta = beat - current, span = delta < 0 ? past : future;
  if (Math.abs(delta) < 1e-8) return 1;
  if (!(span > 0) || Math.abs(delta) >= span) return 0;
  const edge = Math.min(span, Math.max(.25, span * .2));
  const x = Math.min(1, (span - Math.abs(delta)) / edge);
  return x * x * (3 - 2 * x);
}
export function spatialGhostTimes(current, options, maximum = 192) {
  // A dense integration of the whole visible time interval, independent of the beat grid.
  const span = options.past + options.future;
  const step = Math.max(1 / 32, span / maximum);
  const first = Math.ceil((current - options.past) / step), last = Math.floor((current + options.future) / step);
  return Array.from({ length: Math.max(0, last - first + 1) }, (_, index) => ({
    beat: (first + index) * step,
    weight: step,
  }));
}
