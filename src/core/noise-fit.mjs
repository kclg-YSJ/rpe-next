import { easing } from './easing.mjs';
import { t } from '../i18n.mjs';

export const NOISE_REVEALS = [
  ['left', t('noise-fit.s88453e8')], ['right', t('noise-fit.sef48c67')], ['top', t('noise-fit.s0d03ac2')], ['bottom', t('noise-fit.s2e11e22')],
  ['diagonal', t('noise-fit.s27ab79e')], ['reverse-diagonal', t('noise-fit.s1aef8b2')], ['rows', t('noise-fit.seea8766')], ['snake', t('noise-fit.s83c5d7c')],
  ['columns', t('noise-fit.scbd6480')], ['center', t('noise-fit.s0e32acf')], ['outside', t('noise-fit.sadfe53c')], ['horizontal', t('noise-fit.s1e8ddc4')],
  ['vertical', t('noise-fit.s5af4125')], ['clockwise', t('noise-fit.s771e0be')], ['counterclockwise', t('noise-fit.s982ce95')],
  ['spiral', t('noise-fit.s6fdd0de')], ['reverse-spiral', t('noise-fit.sfcbaac3')], ['random', t('noise-fit.s5720e5f')],
];

export function noiseAppearanceOffsets(count, easingType = 1) {
  if (!Number.isInteger(count) || count < 1 || count > 20000) throw new Error(t('noise-fit.s2b3094f'));
  if (!Number.isInteger(easingType) || easingType < 1 || easingType > 29) throw new Error(t('noise-fit.s112d35f'));
  const offsets = new Float64Array(count);
  if (count === 1) return offsets;
  offsets[count - 1] = 1;
  if (easingType === 1) {
    for (let index = 1; index < count - 1; index++) offsets[index] = index / (count - 1);
    return offsets;
  }
  // Easing maps elapsed time to the fraction already revealed. Find the first
  // time each ordered rectangle's threshold is reached. Sampling brackets the
  // first crossing even for bounce/back/elastic curves; revealed blocks never
  // retreat. Keep the explicitly requested first and last birth times exact.
  const samples = 4096; let next = 1;
  for (let sample = 1; sample <= samples && next < count - 1; sample++) {
    const end = sample / samples;
    const reached = Math.max(0, Math.min(1, easing(end, easingType)));
    while (next < count - 1 && next / (count - 1) <= reached) {
      const target = next / (count - 1); let low = (sample - 1) / samples; let high = end;
      for (let iteration = 0; iteration < 32; iteration++) {
        const middle = (low + high) / 2;
        if (easing(middle, easingType) < target) low = middle; else high = middle;
      }
      offsets[next++] = (low + high) / 2;
    }
  }
  return offsets;
}

export function binaryNoiseMask(pixels, width, height, { threshold = 128, polarity = 'dark', invert = false } = {}) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 1024 * 1024 || pixels.length !== width * height * 4) throw new Error(t('noise-fit.sdf4bb04'));
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 255 || !['dark', 'light', 'alpha'].includes(polarity)) throw new Error(t('noise-fit.s80af088'));
  const mask = new Uint8Array(width * height);
  for (let index = 0; index < mask.length; index++) {
    const offset = index * 4; const alpha = pixels[offset + 3];
    if (alpha < 8) continue;
    const luminance = pixels[offset] * 0.2126 + pixels[offset + 1] * 0.7152 + pixels[offset + 2] * 0.0722;
    const foreground = polarity === 'alpha' ? alpha >= threshold : polarity === 'dark' ? luminance <= threshold : luminance >= threshold;
    mask[index] = Number(invert ? !foreground : foreground);
  }
  return mask;
}

function cover(mask, width, height, maxSpan, transpose) {
  const rectangles = []; let previous = new Map();
  const across = transpose ? height : width; const down = transpose ? width : height;
  const at = (column, row) => mask[transpose ? column * width + row : row * width + column];
  for (let row = 0; row < down; row++) {
    const next = new Map(); let column = 0;
    while (column < across) {
      if (!at(column, row)) { column++; continue; }
      const start = column;
      while (column < across && column - start < maxSpan && at(column, row)) column++;
      const key = `${start}:${column}`; const preceding = previous.get(key);
      if (preceding && preceding.height < maxSpan) { preceding.height++; next.set(key, preceding); }
      else {
        const rectangle = { x: start, y: row, width: column - start, height: 1 };
        rectangles.push(rectangle); next.set(key, rectangle);
      }
    }
    previous = next;
  }
  return transpose ? rectangles.map(rectangle => ({ x: rectangle.y, y: rectangle.x, width: rectangle.height, height: rectangle.width })) : rectangles;
}

export function fitNoiseRectangles(mask, width, height, { maxSpan = 16, merge = true, trim = true } = {}) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 512 || height > 512 || mask.length !== width * height) throw new Error(t('noise-fit.s0953a67'));
  if (!Number.isInteger(maxSpan) || maxSpan < 1 || maxSpan > 512) throw new Error(t('noise-fit.s976ee4c'));
  let left = width; let right = -1; let top = height; let bottom = -1; let pixels = 0;
  for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) if (mask[row * width + column]) {
    pixels++; left = Math.min(left, column); right = Math.max(right, column); top = Math.min(top, row); bottom = Math.max(bottom, row);
  }
  if (!pixels) throw new Error(t('noise-fit.sdbeda5c'));
  const bounds = trim ? { x: left, y: top, width: right - left + 1, height: bottom - top + 1 } : { x: 0, y: 0, width, height };
  const horizontal = cover(mask, width, height, merge ? maxSpan : 1, false);
  const vertical = merge ? cover(mask, width, height, maxSpan, true) : horizontal;
  const rectangles = (vertical.length < horizontal.length ? vertical : horizontal).map(rectangle => ({ ...rectangle, x: rectangle.x - bounds.x, y: rectangle.y - bounds.y }));
  return { rectangles, width: bounds.width, height: bounds.height, bounds, pixels, sourceWidth: width, sourceHeight: height };
}

function randomValue(index, seed) {
  let value = (index + 1) ^ seed; value = Math.imul(value ^ value >>> 16, 0x21f0aaad); value = Math.imul(value ^ value >>> 15, 0x735a2d97);
  return ((value ^ value >>> 15) >>> 0) / 4294967296;
}

export function orderedNoiseRectangles(fit, reveal = 'left', seed = 1) {
  if (!NOISE_REVEALS.some(([key]) => key === reveal)) throw new Error(t('noise-fit.scd607ed'));
  const radius = Math.hypot(fit.width, fit.height) / 2;
  return fit.rectangles.map((rectangle, index) => {
    const x = rectangle.x + rectangle.width / 2; const y = rectangle.y + rectangle.height / 2;
    const distance = Math.hypot(x - fit.width / 2, y - fit.height / 2) / Math.max(1, radius);
    const angle = (Math.atan2(y - fit.height / 2, x - fit.width / 2) + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2) / (Math.PI * 2);
    const scores = {
      left: x, right: -x, top: y, bottom: -y, diagonal: x / fit.width + y / fit.height, 'reverse-diagonal': -x / fit.width + y / fit.height,
      rows: rectangle.y * (fit.width + 1) + x, snake: rectangle.y * (fit.width + 1) + (rectangle.y % 2 ? fit.width - x : x),
      columns: rectangle.x * (fit.height + 1) + y, center: distance, outside: -distance,
      horizontal: Math.abs(x - fit.width / 2), vertical: Math.abs(y - fit.height / 2), clockwise: angle, counterclockwise: -angle,
      spiral: distance * 3 + angle, 'reverse-spiral': -(distance * 3 + angle), random: randomValue(index, seed),
    };
    return { rectangle, index, score: scores[reveal] };
  }).sort((first, second) => first.score - second.score || first.index - second.index).map(entry => entry.rectangle);
}
