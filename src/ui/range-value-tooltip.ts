interface RangeGeometry {
  rect: DOMRect;
  thumbWidth: number;
  x: number;
}

interface PointerPosition {
  x: number;
  y: number;
}

interface DraggingRange {
  input: HTMLInputElement;
  pointerId: number;
}

export function attachRangeValueTooltip(dialog: HTMLDialogElement, host: HTMLElement): void {
  const tooltip = document.createElement('output');
  tooltip.className = 'settings-range-value';
  tooltip.hidden = true;
  tooltip.setAttribute('aria-hidden', 'true');
  dialog.append(tooltip);
  let hovered: HTMLInputElement | null = null;
  let dragging: DraggingRange | null = null;
  let pointer: PointerPosition | null = null;
  const rangeAt = (target: EventTarget | null): HTMLInputElement | null =>
    target instanceof HTMLInputElement && target.matches('input[type="range"]:enabled') && host.contains(target) ? target : null;
  const geometry = (input: HTMLInputElement): RangeGeometry => {
    const rect = input.getBoundingClientRect();
    const style = getComputedStyle(input);
    const thumbStyle = getComputedStyle(input, '::-webkit-slider-thumb');
    // Native controls do not consistently expose the thumb's own dimensions.
    const measuredWidth = parseFloat(thumbStyle.width);
    const thumbWidth = measuredWidth > 0 && measuredWidth < rect.width / 2 ? measuredWidth : 16;
    const min = input.min === '' ? 0 : Number(input.min);
    const max = input.max === '' ? 100 : Number(input.max);
    const progress = max > min ? Math.max(0, Math.min(1, (input.valueAsNumber - min) / (max - min))) : 0;
    const left = parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
    const right = parseFloat(style.borderRightWidth) + parseFloat(style.paddingRight);
    const travel = Math.max(0, rect.width - left - right - thumbWidth);
    return { rect, thumbWidth, x: rect.left + left + thumbWidth / 2 + travel * (style.direction === 'rtl' ? 1 - progress : progress) };
  };
  const overThumb = (input: HTMLInputElement): boolean => {
    if (!pointer) return false;
    const { rect, thumbWidth, x } = geometry(input);
    return Math.abs(pointer.x - x) <= thumbWidth / 2 && Math.abs(pointer.y - (rect.top + rect.height / 2)) <= Math.max(thumbWidth, 16) / 2;
  };
  const update = (): void => {
    const input = dragging?.input ?? hovered;
    if (!dialog.open || !input?.isConnected || input.disabled || (!dragging && !overThumb(input))) { tooltip.hidden = true; return; }
    const { rect, x } = geometry(input);
    const bounds = dialog.getBoundingClientRect();
    tooltip.textContent = String(input.valueAsNumber);
    tooltip.hidden = false;
    const scaleX = bounds.width / dialog.offsetWidth;
    const scaleY = bounds.height / dialog.offsetHeight;
    const halfWidth = tooltip.offsetWidth / 2;
    const center = Math.max(halfWidth + 4, Math.min(dialog.clientWidth - halfWidth - 4, (x - bounds.left) / scaleX - dialog.clientLeft));
    tooltip.style.left = `${center + dialog.scrollLeft}px`;
    tooltip.style.top = `${(rect.top - bounds.top) / scaleY - dialog.clientTop + dialog.scrollTop - 6}px`;
  };
  const reset = (): void => { dragging = null; hovered = null; pointer = null; tooltip.hidden = true; };
  host.addEventListener('pointermove', event => {
    pointer = { x: event.clientX, y: event.clientY };
    hovered = rangeAt(event.target);
    update();
  });
  host.addEventListener('pointerleave', () => { hovered = null; if (!dragging) tooltip.hidden = true; });
  host.addEventListener('pointerdown', event => {
    const input = rangeAt(event.target);
    if (!input || event.button !== 0) return;
    pointer = { x: event.clientX, y: event.clientY };
    dragging = { input, pointerId: event.pointerId };
    update();
  });
  window.addEventListener('pointermove', event => {
    if (!dragging || event.pointerId !== dragging.pointerId) return;
    pointer = { x: event.clientX, y: event.clientY };
    update();
  });
  window.addEventListener('pointerup', event => {
    if (!dragging || event.pointerId !== dragging.pointerId) return;
    dragging = null;
    pointer = { x: event.clientX, y: event.clientY };
    hovered = rangeAt(document.elementFromPoint(event.clientX, event.clientY));
    update();
  });
  window.addEventListener('pointercancel', reset);
  host.addEventListener('input', event => { if (event.target === dragging?.input || event.target === hovered) update(); });
  host.addEventListener('scroll', () => { if (dragging) update(); else reset(); }, true);
  dialog.addEventListener('close', reset);
  dialog.addEventListener('cancel', reset);
  window.addEventListener('blur', reset);
  window.addEventListener('resize', reset);
  document.addEventListener('rpen-editor-skin-changed', reset);
}
