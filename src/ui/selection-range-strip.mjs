export const SELECTION_RANGE_COLOR = '#80ff80';
export const CLIPBOARD_RANGE_COLOR = '#ffb3cc';

export function stripRangeRectangle(width, height, duration, start, end, padding = 1.5) {
  const top = height - Math.max(start, end) / duration * height - padding;
  const bottom = height - Math.min(start, end) / duration * height + padding;
  const y = Math.max(.75, Math.min(height - .75, top));
  return { x: .75, y, width: Math.max(0, width - 1.5), height: Math.max(0, Math.min(height - .75, bottom) - y) };
}

export function drawSelectionRange(context, width, height, duration, range, color = SELECTION_RANGE_COLOR) {
  if (!range || !(width > 2 && height > 0 && duration > 0)) return;
  context.save(); context.globalAlpha = 1; context.strokeStyle = color; context.lineWidth = 1.5;
  for (const bounds of range.ranges ?? [range]) {
    const rectangle = stripRangeRectangle(width, height, duration, bounds.start, bounds.end);
    if (rectangle.height > 0) context.strokeRect(rectangle.x, rectangle.y, rectangle.width, rectangle.height);
  }
  context.restore();
}
