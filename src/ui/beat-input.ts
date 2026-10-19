import { beatValue, formatBeat, fromNumber, parseBeat } from '../core/beat.ts';

/**
 * Wraps a beat field with the stepper buttons and wheel handling the editor uses everywhere.
 *
 * The nudge amount is one division of the current grid, read through a callback so a change to the
 * grid takes effect without rebuilding the control. Every nudge dispatches `change` rather than
 * `input`, because the surrounding panels commit on `change` and a wheel gesture can fire often.
 */
export function beatInputControl(input: HTMLInputElement, division: () => number, reportError: (error: unknown) => void): HTMLSpanElement {
  input.dataset.numericExpression = 'beat';
  const wrapper = document.createElement('span'); wrapper.className = 'beat-input-wrap';
  const buttons = document.createElement('span'); buttons.className = 'beat-nudge';
  const nudge = (direction: number): void => {
    try {
      const current = beatValue(parseBeat(input.value || '0'));
      input.value = formatBeat(fromNumber(Math.max(0, current + direction / Math.max(1, division() || 4))));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (error) { reportError(error); }
  };
  for (const [direction, symbol] of [[1, '▴'], [-1, '▾']] as [number, string][]) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = symbol;
    button.title = direction < 0 ? '减少一格' : '增加一格'; button.dataset.beatNudge = String(direction);
    // Keep focus in the field, so a click does not blur it out from under the wheel handler.
    button.onpointerdown = event => event.preventDefault(); button.onclick = () => nudge(direction); buttons.append(button);
  }
  input.addEventListener('wheel', event => {
    if (!event.deltaY || input.disabled || input.readOnly) return;
    event.preventDefault(); event.stopPropagation(); nudge(event.deltaY < 0 ? 1 : -1);
  }, { passive: false });
  wrapper.append(input, buttons);
  return wrapper;
}
