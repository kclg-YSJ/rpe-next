import { assetUrl } from '../core/asset-url.mjs';
import { noisePhases, noiseRectAt } from '../core/noise-domain.mjs';

const clamp = value => Math.max(0, Math.min(1, value));
const fract = value => value - Math.floor(value);
const fallbackNoise = (x, y) => fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453123);

// Independent Canvas implementation of the official multi-camera BlockArea
// pipeline. Phira-Pro's verified mask model was used as a behavioural oracle;
// no GPL source or shader text is included here.
export class NoiseDomainRenderer {
  constructor() {
    this.selected = -1; this.canvases = new Map(); this.textures = new Map(); this.maskCache = null;
    if (typeof Image !== 'undefined') for (const name of ['BlockNoise1', 'PointNoise', 'FD_Noise', 'Block']) this.loadTexture(name);
  }

  loadTexture(name) {
    const image = new Image(); const record = { image, pixels: null, width: 0, height: 0 }; this.textures.set(name, record);
    image.src = assetUrl(`rpe/Texture/NoiseDomain/${name}.png`);
    image.onload = () => {
      const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(image, 0, 0);
      const data = context.getImageData(0, 0, canvas.width, canvas.height);
      record.pixels = data.data; record.width = canvas.width; record.height = canvas.height;
    };
  }

  canvas(name, width, height) {
    if (!this.canvases.has(name)) this.canvases.set(name, document.createElement('canvas'));
    const canvas = this.canvases.get(name); if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    return canvas;
  }

  sample(name, u, v, mirror = true) {
    const texture = this.textures.get(name);
    if (!texture?.pixels) return fallbackNoise(u * 257, v * 263);
    const wrap = value => {
      if (!mirror) return fract(value + 1000);
      const period = ((value % 2) + 2) % 2; return period <= 1 ? period : 2 - period;
    };
    const x = Math.min(texture.width - 1, Math.floor(wrap(u) * texture.width));
    const y = Math.min(texture.height - 1, Math.floor(wrap(v) * texture.height));
    return texture.pixels[(y * texture.width + x) * 4] / 255;
  }

  draw(context, areas, seconds, viewport) {
    if (typeof document === 'undefined' || !Array.isArray(areas)) return;
    const visible = areas.map((area, index) => ({ area, index, phase: noisePhases(area, seconds), rect: noiseRectAt(area, seconds, viewport.width / viewport.height) })).filter(entry => entry.phase.visible);
    if (!visible.length) return;
    const ratio = globalThis.devicePixelRatio || 1; const canvas = context.canvas;
    const source = this.canvas('scene', canvas.width, canvas.height); const sourceContext = source.getContext('2d');
    sourceContext.setTransform(1, 0, 0, 1, 0, 0); sourceContext.clearRect(0, 0, source.width, source.height); sourceContext.drawImage(canvas, 0, 0);

    // Native masks are Screen/8. The compose grid is refined to twice that
    // resolution while retaining the official point-sampled pixel boundary.
    const maskWidth = Math.max(1, Math.floor(viewport.width * ratio / 8)) * 2;
    const maskHeight = Math.max(1, Math.floor(viewport.height * ratio / 8)) * 2;
    const cacheKey = maskCacheKey(visible, maskWidth, maskHeight, seconds);
    if (this.maskCache?.key !== cacheKey) {
      const channels = this.rasterChannels(visible, maskWidth, maskHeight, seconds);
      this.maskCache = {
        key: cacheKey,
        active: composeActiveMasks(channels.activeNormal, channels.activeSubtract),
        disabled: composeDisabledMasks(channels.disabledNormal, channels.disabledSubtract, channels.disabledSubtractOpacity),
      };
      this.maskCache.ready = composeReadyMask(this.maskCache.disabled, channels.readyNormal, channels.readySubtract, channels.readySubtractOpacity);
    }
    const { active, disabled, ready } = this.maskCache;
    const warped = this.displaceMask(active, maskWidth, maskHeight, seconds);

    if (hasMask(disabled)) this.drawDisabled(context, disabled, ready, maskWidth, maskHeight, viewport, ratio, seconds);
    if (hasMask(warped)) this.drawActive(context, source, warped, maskWidth, maskHeight, viewport, ratio, seconds);
    this.drawSelection(context, visible, viewport, ratio);
    context.globalAlpha = 1; context.globalCompositeOperation = 'source-over'; context.filter = 'none';
  }

  rasterChannels(entries, width, height, seconds) {
    const size = width * height;
    const channels = {
      activeNormal: new Float32Array(size), activeSubtract: new Uint8Array(size),
      disabledNormal: new Float32Array(size), disabledSubtract: new Uint8Array(size), disabledSubtractOpacity: new Float32Array(size),
      readyNormal: new Float32Array(size), readySubtract: new Uint8Array(size), readySubtractOpacity: new Float32Array(size),
    };
    for (const entry of entries) {
      const coverage = this.rasterRect(entry.rect, width, height);
      const activeAtAppearance = entry.area.enableTime <= entry.area.appearTime && entry.area.appearTime < entry.area.disableTime;
      const opacity = entry.phase.active || activeAtAppearance ? 1 : clamp((seconds - entry.area.appearTime) / 0.5);
      const targets = entry.phase.active
        ? [['activeNormal', 'activeSubtract', null]]
        : [['disabledNormal', 'disabledSubtract', 'disabledSubtractOpacity'], ...(entry.phase.ready ? [['readyNormal', 'readySubtract', 'readySubtractOpacity']] : [])];
      for (const [normalKey, subtractKey, opacityKey] of targets) for (let index = 0; index < size; index++) {
        if (!coverage[index]) continue;
        if (entry.area.isSubtract) {
          channels[subtractKey][index] = Math.min(255, channels[subtractKey][index] + 1);
          if (opacityKey) channels[opacityKey][index] = clamp(channels[opacityKey][index] + 0.1 * opacity);
        } else channels[normalKey][index] = clamp(channels[normalKey][index] + opacity);
      }
    }
    return channels;
  }

  rasterRect(rect, width, height) {
    const canvas = this.canvas('mask-raster', width, height); const context = canvas.getContext('2d', { willReadFrequently: true });
    context.setTransform(1, 0, 0, 1, 0, 0); context.clearRect(0, 0, width, height); context.fillStyle = '#fff';
    context.save(); context.translate(rect.center.x * width, (1 - rect.center.y) * height); context.rotate(-rect.rotation * Math.PI / 180);
    context.fillRect(-rect.width * width / 2, -rect.height * height / 2, rect.width * width, rect.height * height); context.restore();
    const pixels = context.getImageData(0, 0, width, height).data; const result = new Uint8Array(width * height);
    for (let index = 0; index < result.length; index++) result[index] = pixels[index * 4 + 3] >= 128 ? 1 : 0;
    return result;
  }

  displaceMask(mask, width, height, seconds) {
    const result = new Uint8ClampedArray(mask.length); const direction = Math.SQRT1_2; const delta = direction * seconds / 20 * 2.59;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const u = (x + .5) / width; const v = (y + .5) / height;
      const a = this.sample('BlockNoise1', u * 2.13 + delta, v * 1.02 + delta) - .5;
      const b = this.sample('BlockNoise1', u * 2.13 - delta, v * 1.02 + delta) - .5;
      const sampleX = Math.floor(clamp(u + direction * (a - b) * .1) * width);
      const sampleY = Math.floor(clamp(v + direction * (a + b) * .1) * height);
      result[y * width + x] = mask[Math.min(height - 1, sampleY) * width + Math.min(width - 1, sampleX)];
    }
    return result;
  }

  maskCanvas(name, mask, width, height, color = [255, 255, 255]) {
    const canvas = this.canvas(name, width, height); const context = canvas.getContext('2d'); const image = context.createImageData(width, height);
    for (let index = 0; index < mask.length; index++) {
      image.data[index * 4] = color[0]; image.data[index * 4 + 1] = color[1]; image.data[index * 4 + 2] = color[2]; image.data[index * 4 + 3] = mask[index];
    }
    context.putImageData(image, 0, 0); return canvas;
  }

  drawDisabled(context, mask, ready, width, height, viewport, ratio, seconds) {
    const layer = this.canvas('layer-disabled', context.canvas.width, context.canvas.height); const layerContext = layer.getContext('2d');
    layerContext.setTransform(ratio, 0, 0, ratio, 0, 0); layerContext.clearRect(0, 0, layer.width / ratio, layer.height / ratio);
    layerContext.fillStyle = 'rgba(127,35,35,.40)'; layerContext.fillRect(viewport.left, viewport.top, viewport.width, viewport.height);
    this.drawTexture(layerContext, 'PointNoise', viewport, seconds, .11, 0.3, 2.29);
    this.drawTexture(layerContext, 'FD_Noise', viewport, seconds, .08, 0.03, 1.15);
    layerContext.globalCompositeOperation = 'destination-in'; layerContext.imageSmoothingEnabled = false;
    layerContext.drawImage(this.maskCanvas('mask-image-disabled', mask, width, height), viewport.left, viewport.top, viewport.width, viewport.height);
    layerContext.globalCompositeOperation = 'source-over'; context.drawImage(layer, 0, 0, layer.width / ratio, layer.height / ratio);

    if (!hasMask(ready)) return;
    const shine = this.canvas('layer-ready-shine', context.canvas.width, context.canvas.height); const shineContext = shine.getContext('2d');
    shineContext.setTransform(ratio, 0, 0, ratio, 0, 0); shineContext.clearRect(0, 0, shine.width / ratio, shine.height / ratio);
    const pulse = Math.sin(seconds * 37.9) * .5 + 1;
    shineContext.fillStyle = `rgba(255,255,255,${clamp(pulse * .12)})`; shineContext.fillRect(viewport.left, viewport.top, viewport.width, viewport.height);
    shineContext.globalCompositeOperation = 'destination-in'; shineContext.imageSmoothingEnabled = false;
    shineContext.drawImage(this.maskCanvas('mask-image-ready', ready, width, height), viewport.left, viewport.top, viewport.width, viewport.height);
    shineContext.globalCompositeOperation = 'source-over'; context.drawImage(shine, 0, 0, shine.width / ratio, shine.height / ratio);
  }

  drawActive(context, source, mask, width, height, viewport, ratio, seconds) {
    const layer = this.canvas('layer-active', context.canvas.width, context.canvas.height); const layerContext = layer.getContext('2d');
    layerContext.setTransform(ratio, 0, 0, ratio, 0, 0); layerContext.clearRect(0, 0, layer.width / ratio, layer.height / ratio);
    const pixelScale = 6; const lowWidth = Math.max(1, Math.ceil(viewport.width * ratio / pixelScale)); const lowHeight = Math.max(1, Math.ceil(viewport.height * ratio / pixelScale));
    const lowSource = this.canvas('scene-pixelated', lowWidth, lowHeight); const lowContext = lowSource.getContext('2d', { willReadFrequently: true });
    lowContext.setTransform(1, 0, 0, 1, 0, 0); lowContext.clearRect(0, 0, lowWidth, lowHeight); lowContext.imageSmoothingEnabled = true;
    lowContext.drawImage(source, viewport.left * ratio, viewport.top * ratio, viewport.width * ratio, viewport.height * ratio, 0, 0, lowWidth, lowHeight);
    const input = lowContext.getImageData(0, 0, lowWidth, lowHeight); const output = lowContext.createImageData(lowWidth, lowHeight);
    const direction = Math.SQRT1_2; const time = seconds / 20 * 1.5;
    for (let y = 0; y < lowHeight; y++) for (let x = 0; x < lowWidth; x++) {
      const u = (x + .5) / lowWidth; const v = (y + .5) / lowHeight;
      const a = this.sample('BlockNoise1', u * .8 + direction * time, v * .3 + direction * time) - .5;
      const b = this.sample('BlockNoise1', u * .8 - direction * time, v * .3 + direction * time) - .5;
      const sx = Math.min(lowWidth - 1, Math.floor(clamp(u + direction * (a - b) * .15) * lowWidth));
      const sy = Math.min(lowHeight - 1, Math.floor(clamp(v + direction * (a + b) * .15) * lowHeight));
      const sourceIndex = (sy * lowWidth + sx) * 4; const targetIndex = (y * lowWidth + x) * 4;
      output.data[targetIndex] = input.data[sourceIndex]; output.data[targetIndex + 1] = input.data[sourceIndex + 1];
      output.data[targetIndex + 2] = input.data[sourceIndex + 2]; output.data[targetIndex + 3] = input.data[sourceIndex + 3];
    }
    const displaced = this.canvas('scene-displaced', lowWidth, lowHeight); displaced.getContext('2d').putImageData(output, 0, 0);
    layerContext.imageSmoothingEnabled = false; layerContext.drawImage(displaced, viewport.left, viewport.top, viewport.width, viewport.height);
    layerContext.fillStyle = 'rgba(182,60,60,.445)'; layerContext.fillRect(viewport.left, viewport.top, viewport.width, viewport.height);
    this.drawTexture(layerContext, 'PointNoise', viewport, seconds, .24, 1.5, 2.39);
    this.drawTexture(layerContext, 'FD_Noise', viewport, seconds, .13, 0.03, 1.0);
    layerContext.globalCompositeOperation = 'destination-in'; layerContext.imageSmoothingEnabled = false;
    layerContext.drawImage(this.maskCanvas('mask-image-active', mask, width, height), viewport.left, viewport.top, viewport.width, viewport.height);
    layerContext.globalCompositeOperation = 'source-over'; context.drawImage(layer, 0, 0, layer.width / ratio, layer.height / ratio);

    const { edge, glow } = ringMasks(mask, width, height);
    context.save(); context.imageSmoothingEnabled = false; context.globalCompositeOperation = 'lighter';
    context.globalAlpha = .8; context.drawImage(this.maskCanvas('mask-image-glow', glow, width, height, [255, 46, 46]), viewport.left, viewport.top, viewport.width, viewport.height);
    context.globalAlpha = .8; context.drawImage(this.maskCanvas('mask-image-edge', edge, width, height, [255, 84, 84]), viewport.left, viewport.top, viewport.width, viewport.height);
    context.restore();
  }

  drawTexture(context, name, viewport, seconds, alpha, speed, scale) {
    const image = this.textures.get(name)?.image; if (!image?.complete || !image.naturalWidth) return;
    const pattern = context.createPattern(image, 'repeat'); if (!pattern) return;
    context.save(); context.beginPath(); context.rect(viewport.left, viewport.top, viewport.width, viewport.height); context.clip(); context.globalCompositeOperation = 'lighter'; context.globalAlpha = alpha;
    context.translate(viewport.left + seconds * speed * 19, viewport.top + seconds * speed * 13); context.scale(1 / scale, 1 / scale);
    const pad = Math.max(viewport.width, viewport.height) * scale;
    context.fillStyle = pattern; context.fillRect(-pad, -pad, viewport.width * scale + pad * 2, viewport.height * scale + pad * 2); context.restore();
  }

  drawSelection(context, visible, viewport, ratio) {
    const entry = visible.find(value => value.index === this.selected); if (!entry) return; const rect = entry.rect;
    context.save(); context.translate(viewport.left + rect.center.x * viewport.width, viewport.top + (1 - rect.center.y) * viewport.height); context.rotate(-rect.rotation * Math.PI / 180);
    context.strokeStyle = '#ffd45c'; context.lineWidth = Math.max(1, ratio); context.strokeRect(-rect.width * viewport.width / 2 - 3, -rect.height * viewport.height / 2 - 3, rect.width * viewport.width + 6, rect.height * viewport.height + 6); context.restore();
  }
}

export function officialSubtractEnabled(count) {
  const accumulated = Math.min(1, Math.max(0, count) * 0.1);
  return accumulated >= 0.09 && accumulated < 0.12;
}

export function composeActiveMasks(normal, subtract) {
  const result = new Uint8ClampedArray(normal.length);
  for (let index = 0; index < result.length; index++) result[index] = Math.round(Math.abs(normal[index] - Number(officialSubtractEnabled(subtract[index]))) * 255);
  return result;
}

function disabledSubtract(count, opacity) {
  const enabled = Number(officialSubtractEnabled(count));
  const t = clamp((opacity - 0.2) * -10); const red = clamp(enabled + t * t * (3 - 2 * t));
  return { red, green: clamp(opacity * red * 10) };
}

export function composeDisabledMasks(normal, subtract, subtractOpacity) {
  const result = new Uint8ClampedArray(normal.length);
  for (let index = 0; index < result.length; index++) {
    const inverse = disabledSubtract(subtract[index], subtractOpacity[index]);
    result[index] = Math.round(Math.abs(inverse.red * inverse.green - normal[index]) * 255);
  }
  return result;
}

export function composeReadyMask(disabled, normal, subtract, subtractOpacity) {
  const result = new Uint8ClampedArray(normal.length);
  for (let index = 0; index < result.length; index++) {
    const inverse = disabledSubtract(subtract[index], subtractOpacity[index]);
    result[index] = Math.round(disabled[index] / 255 * Math.abs(normal[index] - inverse.green) * 255);
  }
  return result;
}

function hasMask(mask) { return mask.some(value => value > 0); }

function maskCacheKey(entries, width, height, seconds) {
  const parts = [`${width}x${height}`];
  for (const entry of entries) {
    const activeAtAppearance = entry.area.enableTime <= entry.area.appearTime && entry.area.appearTime < entry.area.disableTime;
    const opacity = entry.phase.active || activeAtAppearance ? 1 : clamp((seconds - entry.area.appearTime) / 0.5);
    parts.push([entry.index, Number(entry.area.isSubtract), Number(entry.phase.active), Number(entry.phase.ready), opacity,
      entry.rect.center.x, entry.rect.center.y, entry.rect.width, entry.rect.height, entry.rect.rotation].join(','));
  }
  return parts.join('|');
}

function ringMasks(mask, width, height) {
  const edge = new Uint8ClampedArray(mask.length); const glow = new Uint8ClampedArray(mask.length);
  let previous = Uint8ClampedArray.from(mask); const sum = Array.from({ length: 6 }, (_, index) => (index + 1) ** 2.65).reduce((a, b) => a + b, 0);
  for (let pass = 0; pass < 6; pass++) {
    const dilated = dilate(previous, width, height); const weight = (6 - pass) ** 2.65 / sum;
    for (let index = 0; index < mask.length; index++) {
      const delta = Math.max(0, dilated[index] - previous[index]);
      if (pass === 0) edge[index] = delta;
      if (delta) glow[index] = Math.min(255, glow[index] + Math.round(weight * delta));
    }
    previous = dilated;
  }
  return { edge, glow };
}

function dilate(source, width, height) {
  const horizontal = new Uint8ClampedArray(source.length); const result = new Uint8ClampedArray(source.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = y * width + x; horizontal[index] = Math.max(source[index], source[y * width + Math.max(0, x - 1)], source[y * width + Math.min(width - 1, x + 1)]);
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = y * width + x; result[index] = Math.max(horizontal[index], horizontal[Math.max(0, y - 1) * width + x], horizontal[Math.min(height - 1, y + 1) * width + x]);
  }
  return result;
}
