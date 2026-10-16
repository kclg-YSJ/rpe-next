import { easing } from './easing.ts';

export const NOISE_REVEALS = [
  ['left', '从左到右'], ['right', '从右到左'], ['top', '从上到下'], ['bottom', '从下到上'],
  ['diagonal', '左上到右下'], ['reverse-diagonal', '右上到左下'], ['rows', '逐行扫描'], ['snake', '逐行往返'],
  ['columns', '逐列扫描'], ['center', '中心向外'], ['outside', '外围向内'], ['horizontal', '中间向两侧'],
  ['vertical', '中间向上下'], ['clockwise', '顺时针扫过'], ['counterclockwise', '逆时针扫过'],
  ['spiral', '螺旋展开'], ['reverse-spiral', '螺旋收拢'], ['random', '随机浮现'],
];

export function noiseAppearanceOffsets(count, easingType = 1) {
  if (!Number.isInteger(count) || count < 1 || count > 20000) throw new Error('噪域数量须在 1–20000 之间');
  if (!Number.isInteger(easingType) || easingType < 1 || easingType > 29) throw new Error('缓动编号须在 1–29 内');
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
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 1024 * 1024 || pixels.length !== width * height * 4) throw new Error('图案像素尺寸无效');
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 255 || !['dark', 'light', 'alpha'].includes(polarity)) throw new Error('二值化参数无效');
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
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 512 || height > 512 || mask.length !== width * height) throw new Error('拟合精度须在 1–512 像素之间');
  if (!Number.isInteger(maxSpan) || maxSpan < 1 || maxSpan > 512) throw new Error('矩形最大边长须在 1–512 格之间');
  let left = width; let right = -1; let top = height; let bottom = -1; let pixels = 0;
  for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) if (mask[row * width + column]) {
    pixels++; left = Math.min(left, column); right = Math.max(right, column); top = Math.min(top, row); bottom = Math.max(bottom, row);
  }
  if (!pixels) throw new Error('二值化后没有可拟合的内容，请调整文字、前景或阈值');
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
  if (!NOISE_REVEALS.some(([key]) => key === reveal)) throw new Error('请选择有效的浮现方式');
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
