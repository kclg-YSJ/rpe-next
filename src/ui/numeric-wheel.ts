/**
 * Wires wheel-based stepping onto a numeric input.
 *
 * `update` replaces the default value arithmetic entirely when supplied; callers use that to step a
 * value that is not the input's own (see the curve-density field in `app.ts`).
 */
export function numericWheel(input: HTMLInputElement, step = 1, update?: (direction: number) => void): void {
  input.addEventListener('wheel', event => {
    if (!event.deltaY || input.disabled || input.readOnly) return;
    event.preventDefault(); event.stopPropagation();
    const direction = -Math.sign(event.deltaY);
    if (update) { update(direction); return; }
    const value = Number(input.value);
    if (!Number.isFinite(value)) return;
    const minimum = input.min === '' ? -Infinity : Number(input.min);
    const maximum = input.max === '' ? Infinity : Number(input.max);
    input.value = String(Number(Math.max(minimum, Math.min(maximum, value + direction * step)).toFixed(10)));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, { passive: false });
}
