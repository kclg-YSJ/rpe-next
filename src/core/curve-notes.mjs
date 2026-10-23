import { beatValue, fromNumber } from './beat.mjs';
import { createNote } from './chart.mjs';
import { easing } from './easing.mjs';
import { t } from '../i18n.mjs';

export function generateCurveNotes({ startTime, endTime, startX, endX, type = 4, division = 4, density = 1, easingType = 1 }) {
  const start = beatValue(startTime); const end = beatValue(endTime);
  if (start < 0 || end < start) throw new Error(t('curve-notes.s0deb132'));
  if (![startX, endX, density, division].every(Number.isFinite) || density <= 0 || density > 1000 || division < 1 || division > 100) throw new Error(t('curve-notes.sa70194c'));
  if (![1, 3, 4].includes(type) || !Number.isInteger(easingType) || easingType < 1 || easingType > 29) throw new Error(t('curve-notes.s2f66df0'));
  const denominator = Math.max(1, Math.trunc(division * density));
  const count = start === end ? Math.ceil(density) : Math.max(0, Math.ceil((end - start) * denominator - 1e-9) - 1);
  if (count > 20000) throw new Error(t('curve-notes.s6727835', { p0: count }));
  return Array.from({ length: count }, (unused, index) => {
    const amount = start === end ? (index + 1) / (density + 1) : (index + 1) / denominator / (end - start);
    const position = startX + (endX - startX) * (start === end ? amount : easing(amount, easingType));
    const beat = start === end ? [...startTime] : fromNumber(start + (index + 1) / denominator, denominator * startTime[2]);
    return { ...createNote(type, 0, position), startTime: beat, endTime: [...beat] };
  });
}
