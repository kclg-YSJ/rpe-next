import { evaluateNumericExpression } from './numeric-expression.mjs';
import { t } from '../i18n.mjs';

export function beatValue(beat, path = 'beat') {
  if (!Array.isArray(beat) || beat.length !== 3 || !beat.every(Number.isSafeInteger) || beat[2] <= 0) {
    throw new Error(t('beat.s67be2d4', { p0: path }));
  }
  return beat[0] + beat[1] / beat[2];
}

export function fromNumber(value, denominator = 19200) {
  if (!Number.isFinite(value) || !Number.isSafeInteger(denominator) || denominator <= 0) throw new Error(t('beat.s9241a25'));
  const total = Math.round(value * denominator);
  if (!Number.isSafeInteger(total)) throw new Error(t('beat.s990d689'));
  const whole = Math.floor(total / denominator);
  const numerator = total - whole * denominator;
  let divisor = denominator;
  let remainder = numerator;
  while (remainder) [divisor, remainder] = [remainder, divisor % remainder];
  return [whole, numerator / divisor, denominator / divisor];
}

export function parseBeat(text) {
  if (typeof text === 'number') return fromNumber(text);
  const match = String(text).trim().match(/^(-?\d+)\s*:\s*(-?\d+)\s*\/\s*(\d+)$/);
  if (match) {
    const beat = match.slice(1).map(Number);
    beatValue(beat);
    return beat;
  }
  if (String(text).trim() === '') throw new Error(t('beat.scbdcea6'));
  return fromNumber(evaluateNumericExpression(text));
}

export function formatBeat(beat) { return `${beat[0]}:${beat[1]}/${beat[2]}`; }
export function snapBeat(value, division) { return fromNumber(value, division); }

export function upperBound(values, target, key = value => value) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (key(values[middle]) <= target) low = middle + 1;
    else high = middle;
  }
  return low;
}
