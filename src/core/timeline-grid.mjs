import { upperBound } from './beat.mjs';

// Keep the grid phase tied to chart beats, never the moving viewport edge.
// Each visible BPM segment gets its own stable density, so a fast segment
// neither floods the canvas nor removes the slower segment's subdivisions.
export function* timelineGrid(tempo, first, last, division, pixelsPerSecond, factor = 1, { spacing = 6, labelSpacing = 24, labelsOnly = false, maxRows = Infinity } = {}) {
  if (![first, last, division, pixelsPerSecond, factor].every(Number.isFinite) || division < 1 || pixelsPerSecond <= 0 || factor <= 0) return;
  if (first > last) [first, last] = [last, first];
  division = Math.max(1, Math.round(division));
  const points = tempo.points;
  const coarseStride = needed => needed <= division ? (() => {
    for (let stride = Math.max(1, Math.ceil(needed)); stride < division; stride++) if (division % stride === 0) return stride;
    return division;
  })() : division * 2 ** Math.ceil(Math.log2(needed / division));
  const budgetStride = Number.isFinite(maxRows) ? (last - first) * division / Math.max(1, maxRows) : 1;
  let index = Math.max(0, upperBound(points, first, point => point.beat) - 1);
  for (; index < points.length; index++) {
    const point = points[index], low = Math.max(first, index ? point.beat : first), high = Math.min(last, points[index + 1]?.beat ?? last);
    if (low > last) break;
    const beatPixels = point.secondsPerBeat * factor * pixelsPerSecond;
    const stride = coarseStride(Math.max(1, spacing * division / beatPixels, budgetStride));
    const labelStride = division * 2 ** Math.ceil(Math.log2(Math.max(1, labelSpacing / beatPixels, stride / division)));
    const step = labelsOnly ? labelStride : stride;
    for (let tick = Math.ceil((low * division - 1e-8) / step) * step; tick / division <= high + 1e-9; tick += step) {
      if (points[index + 1] && tick / division >= points[index + 1].beat - 1e-9) break;
      yield { tick, beat: tick / division, major: tick % division === 0, label: tick % labelStride === 0 };
    }
    if (high >= last) break;
  }
}
