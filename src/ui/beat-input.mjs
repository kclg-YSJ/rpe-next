import { beatValue, formatBeat, fromNumber, parseBeat } from '../core/beat.mjs';
import { t } from '../i18n.mjs';

export function beatInputControl(input, division, reportError) {
  input.dataset.numericExpression = 'beat';
  const wrapper = document.createElement('span'); wrapper.className = 'beat-input-wrap';
  const buttons = document.createElement('span'); buttons.className = 'beat-nudge';
  const nudge = direction => {
    try {
      const current = beatValue(parseBeat(input.value || '0'));
      input.value = formatBeat(fromNumber(Math.max(0, current + direction / Math.max(1, division() || 4))));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (error) { reportError(error); }
  };
  for (const [direction, symbol] of [[1, '▴'], [-1, '▾']]) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = symbol;
    button.title = direction < 0 ? t('beat-input.sc97bc82') : t('beat-input.sbd85928'); button.dataset.beatNudge = String(direction);
    button.onpointerdown = event => event.preventDefault(); button.onclick = () => nudge(direction); buttons.append(button);
  }
  input.addEventListener('wheel', event => {
    if (!event.deltaY || input.disabled || input.readOnly) return;
    event.preventDefault(); event.stopPropagation(); nudge(event.deltaY < 0 ? 1 : -1);
  }, { passive: false });
  wrapper.append(input, buttons);
  return wrapper;
}
