export const EVENT_SCALE_TRAVEL = 195;
export const eventScaleKey = (lineIndex, type) => `${lineIndex}:${type}`;
export const canScaleEventValue = entry => !entry.event.trajectory && typeof entry.event.start === 'number' && Number.isFinite(entry.event.start) && typeof entry.event.end === 'number' && Number.isFinite(entry.event.end);

export function eventScaleColumns(entries, previous = new Map()) {
  const columns = new Map();
  for (const entry of entries) {
    if (!canScaleEventValue(entry)) continue;
    const key = eventScaleKey(entry.lineIndex, entry.type);
    let column = columns.get(key);
    if (!column) { column = { key, lineIndex: entry.lineIndex, type: entry.type, values: [], targets: new Map(), minimum: Infinity, maximum: -Infinity }; columns.set(key, column); }
    const { start, end } = entry.event;
    column.minimum = Math.min(column.minimum, start, end); column.maximum = Math.max(column.maximum, start, end);
    for (const [kind, value] of [['start', start], ['end', end], ['middle', start / 2 + end / 2]]) {
      column.values.push(value);
      if (!column.targets.has(value)) column.targets.set(value, []);
      column.targets.get(value).push({ kind, index: entry.index, event: entry.event });
    }
  }
  for (const column of columns.values()) {
    const middle = column.minimum / 2 + column.maximum / 2;
    column.values.push(middle); column.values.sort((a, b) => a - b);
    column.values = column.values.filter((value, index, list) => !index || value !== list[index - 1]);
    column.axis = previous.get(column.key)?.axis ?? middle;
    const low = Math.min(column.minimum, column.axis), high = Math.max(column.maximum, column.axis);
    const margin = Math.max((high - low) * .2, (high === low ? Math.max(1, Math.abs(low) * .1) : .01));
    column.range = { min: low - margin, max: high + margin };
  }
  return columns;
}

export function eventScaleAxisSnap(value, column, unitsPerPixel, radius = 7) {
  const threshold = Math.abs(unitsPerPixel) * radius;
  let nearest = Math.round(value / 10) * 10, distance = Math.abs(value - nearest);
  // The sorted selected endpoints/midpoints are indexed only on selection changes.
  let low = 0, high = column.values.length;
  while (low < high) { const mid = (low + high) >>> 1; if (column.values[mid] < value) low = mid + 1; else high = mid; }
  for (const index of [low - 1, low]) {
    const candidate = column.values[index], delta = Math.abs(value - candidate);
    if (delta <= distance) { nearest = candidate; distance = delta; }
  }
  const zeroThreshold = Math.abs(unitsPerPixel) * Math.max(18, radius * 2);
  // Zero has a larger attraction radius, but a near-exact endpoint remains
  // selectable even when a narrow column places it close to zero on screen.
  const exactTarget = column.targets?.has(nearest) && distance <= Math.abs(unitsPerPixel) * 3;
  if (Math.abs(value) <= zeroThreshold && !exactTarget) return { value: 0, kind: 'zero', targets: column.targets?.get(0) ?? [] };
  if (distance > threshold) return { value, kind: null, targets: [] };
  const targets = column.targets?.get(nearest) ?? [];
  return { value: nearest, kind: targets.length ? 'event' : 'grid', targets };
}

export const snapEventScaleAxis = (value, column, unitsPerPixel, radius = 7) => eventScaleAxisSnap(value, column, unitsPerPixel, radius).value;

export function eventScaleRate(delta, unit = 1, snap = true, step = .05) {
  const rate = 1 + delta / (EVENT_SCALE_TRAVEL * unit);
  let result = snap && Number.isFinite(step) && step > 0 ? Math.round(rate / step) * step : rate;
  // Every new grab starts unchanged, including snap steps that do not divide 1.
  if (snap && Math.abs(rate - 1) <= Math.abs(rate - result)) result = 1;
  return Math.abs(result) < 1e-12 ? 0 : Number(result.toFixed(10));
}

// The ruler's coordinates belong to the drag origin, never to the snapped rate.
// Its window can grow to include the pointer without moving any existing tick.
export function eventScaleRuler(active, bounds) {
  const origin = active.scaleOrigin, point = active.point;
  const frame = active.rulerFrame ??= { left: origin.x - 150 - EVENT_SCALE_TRAVEL * active.unit, right: origin.x + 150, top: origin.y + 36 };
  frame.left = Math.min(frame.left, point.x - 24);
  frame.right = Math.max(frame.right, point.x + 24);
  // Normal pointer tremor has 16px of clearance; once pushed down, stay there
  // until release instead of following every upward/downward pixel.
  frame.top = Math.max(frame.top, point.y + 20);
  return {
    left: Math.max(bounds.left + 1, frame.left), right: Math.min(bounds.right - 1, frame.right),
    top: Math.max(bounds.top + 6, Math.min(bounds.bottom - 40, frame.top)),
    origin: origin.x, marker: point.x, pixels: EVENT_SCALE_TRAVEL * active.unit,
  };
}

// A short direction probe must be followed by sustained horizontal movement.
// Once vertical, a gesture can never turn into value scaling mid-drag.
export function eventScaleGesture(probe, dx, dy) {
  if (probe.direction === 'vertical' || probe.direction === 'scale') return probe.direction;
  const x = Math.abs(dx), y = Math.abs(dy);
  if (!probe.direction && Math.max(x, y) >= 6) {
    probe.direction = x > y * 1.4 ? 'horizontal' : 'vertical';
    probe.sign = Math.sign(dx); probe.first = x;
  }
  if (probe.direction === 'horizontal') {
    if (y > Math.max(12, x * .75) || Math.sign(dx) !== probe.sign) probe.direction = 'vertical';
    else if (x >= Math.max(28, probe.first + 16)) probe.direction = 'scale';
  }
  return probe.direction;
}
