import { HitEffectBatch } from './hit-effect-batch.mjs';

const WHITE = [1, 1, 1];

export function holdBatchWithinBudget(visible, states, seconds, noteSize, scale, width, height, skin) {
  const pack = skin.resourcePack ?? skin, highlighted = skin.noteScale?.(true) ?? 1;
  const normalWidth = noteSize * scale, maxWidth = Math.abs(normalWidth) * Math.max(1, highlighted);
  let tailRatio, headRatio;
  if (pack.info?.holdAtlas) {
    const ratio = (name, atlas, part) => { const image = pack.images.get(name); return atlas[part] / (image?.naturalWidth ?? image?.width ?? 1); };
    tailRatio = Math.max(ratio('hold.png', pack.info.holdAtlas, 0), ratio('hold_mh.png', pack.info.holdAtlasMH, 0));
    headRatio = Math.max(ratio('hold.png', pack.info.holdAtlas, 1), ratio('hold_mh.png', pack.info.holdAtlasMH, 1));
  } else {
    const body = skin.images?.get('Hold3') ?? skin.images?.get('Hold'), highBody = skin.images?.get('HoldHL') ?? body;
    const heads = Math.max(skin.images?.get('HoldHead')?.naturalHeight ?? 0, skin.images?.get('HoldHeadHL')?.naturalHeight ?? 0), tail = skin.images?.get('HoldEnd')?.naturalHeight ?? 0;
    const bodyWidth = Math.max(1, Math.min(body?.naturalWidth ?? 1, highBody?.naturalWidth ?? 1));
    tailRatio = tail / bodyWidth; headRatio = heads / bodyWidth;
  }
  const budget = width * height * 64, diagonal = Math.hypot(width, height); let area = 0;
  for (const [index, entries] of visible) for (const entry of entries) {
    if (entry.note.type !== 2) continue;
    const length = Math.abs((entry.endFloor - (entry.start <= seconds ? states[index].floor : entry.startFloor)) * (entry.note.speed ?? 1) * scale);
    const capRatio = tailRatio + (entry.start > seconds || pack.info?.holdKeepHead && length > 0 ? headRatio : 0);
    area += Math.abs(entry.note.size ?? 1) * maxWidth * (Math.min(length, diagonal) + maxWidth * capRatio);
    if (area > budget) return false;
  }
  return true;
}
const FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray pictures;
uniform vec2 extents[128];
in vec3 uv;
in vec4 tint;
out vec4 outputColor;
void main() {
  vec4 pixel = vec4(1.0);
  if (uv.z >= 0.0) {
    vec2 halfPixel = 0.5 / vec2(textureSize(pictures, 0).xy);
    pixel = texture(pictures, vec3(clamp(uv.xy, halfPixel, extents[int(uv.z)] - halfPixel), uv.z));
  }
  outputColor = pixel * vec4(tint.rgb * tint.a, tint.a);
}`;

// Reuse the bounded texture/vertex buffers and ordered premultiplied blending.
// Unlike hit effects, Hold sprites need atlas crops, reflections and edge AA.
export class NoteSpriteBatch extends HitEffectBatch {
  constructor() {
    super({ antialias: true, fragment: FRAGMENT });
    this.vertices = new Float32Array(54 * 8192);
    this.saved = new Float64Array(8 * 16); this.styles = []; this.depth = 0;
  }
  begin(context, width, height, skin) {
    if (typeof CanvasRenderingContext2D === 'undefined' || !(context instanceof CanvasRenderingContext2D) || context.imageSmoothingEnabled === false || context.imageSmoothingQuality === 'high') return null;
    if (!super.begin(context, width, height, skin)) return null;
    if (!this.gl.getContextAttributes().antialias) { this.failed = true; return null; }
    const matrix = context.getTransform(), rx = context.canvas.width / width, ry = context.canvas.height / height;
    this.matrix = [matrix.a / rx, matrix.b / ry, matrix.c / rx, matrix.d / ry, matrix.e / rx, matrix.f / ry];
    this.depth = 0; this.drawCalls = 0; return this;
  }
  save() {
    const offset = this.depth * 8;
    if (offset + 8 > this.saved.length) { const saved = new Float64Array(this.saved.length * 2); saved.set(this.saved); this.saved = saved; }
    this.saved.set(this.matrix, offset); this.saved[offset + 6] = this.globalAlpha;
    this.styles[this.depth++] = this.fillStyle;
  }
  restore() {
    const offset = --this.depth * 8;
    for (let i = 0; i < 6; i++) this.matrix[i] = this.saved[offset + i];
    this.globalAlpha = this.saved[offset + 6]; this.fillStyle = this.styles[this.depth];
  }
  scale(x, y) { this.matrix[0] *= x; this.matrix[1] *= x; this.matrix[2] *= y; this.matrix[3] *= y; }
  transform(a, b, c, d, e, f) {
    const [aa, bb, cc, dd, ee, ff] = this.matrix;
    this.matrix[0] = aa * a + cc * b; this.matrix[1] = bb * a + dd * b;
    this.matrix[2] = aa * c + cc * d; this.matrix[3] = bb * c + dd * d;
    this.matrix[4] = aa * e + cc * f + ee; this.matrix[5] = bb * e + dd * f + ff;
  }
  allocate(width, height) {
    const maximum = this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE);
    if (width > maximum || height > maximum || Math.max(256, width) * Math.max(256, height) * 4 > 64 * 1024 ** 2) throw Error('Sprite texture exceeds batch budget');
    super.allocate(width, height);
  }
  image(picture) {
    const image = super.image(picture);
    if (!image.boundsReady) {
      const gl = this.gl;
      gl.uniform2f(gl.getUniformLocation(this.program, `extents[${image.layer}]`), image.width, image.height);
      if (gl.getError() !== gl.NO_ERROR) throw Error('Sprite texture upload failed');
      image.boundsReady = true;
    }
    return image;
  }
  quad(left, top, width, height, image, color, crop) {
    const m = this.matrix;
    const x = m[0] * left + m[2] * top + m[4], y = m[1] * left + m[3] * top + m[5];
    const ax = m[0] * width, ay = m[1] * width, bx = m[2] * height, by = m[3] * height;
    if (x + Math.max(0, ax) + Math.max(0, bx) < -1 || x + Math.min(0, ax) + Math.min(0, bx) > this.width + 1 ||
        y + Math.max(0, ay) + Math.max(0, by) < -1 || y + Math.min(0, ay) + Math.min(0, by) > this.height + 1) return;
    if (this.used + 54 > this.vertices.length) this.flush();
    const alpha = this.globalAlpha, layer = image?.layer ?? -1;
    const u = crop ? crop[0] / this.textureWidth : 0, v = crop ? crop[1] / this.textureHeight : 0;
    const du = crop ? crop[2] / this.textureWidth : image?.width ?? 0, dv = crop ? crop[3] / this.textureHeight : image?.height ?? 0;
    const append = (horizontal, vertical) => {
      const offset = this.used;
      this.vertices[offset] = x + horizontal * ax + vertical * bx; this.vertices[offset + 1] = y + horizontal * ay + vertical * by;
      this.vertices[offset + 2] = u + horizontal * du; this.vertices[offset + 3] = v + vertical * dv; this.vertices[offset + 4] = layer;
      this.vertices[offset + 5] = color[0]; this.vertices[offset + 6] = color[1]; this.vertices[offset + 7] = color[2]; this.vertices[offset + 8] = alpha; this.used += 9;
    };
    append(0, 0); append(1, 0); append(0, 1); append(0, 1); append(1, 0); append(1, 1);
  }
  drawImage(picture, first, second, third, fourth, left, top, width, height) {
    const image = this.image(picture);
    const crop = arguments.length === 9 ? [first, second, third, fourth] : null;
    if (!crop) { left = first; top = second; width = third ?? picture.naturalWidth ?? picture.width; height = fourth ?? picture.naturalHeight ?? picture.height; }
    // Canvas negative destination dimensions grow backwards without flipping UVs.
    if (width < 0) { left += width; width = -width; }
    if (height < 0) { top += height; height = -height; }
    if (crop) {
      if (crop[2] < 0) { crop[0] += crop[2]; crop[2] = -crop[2]; }
      if (crop[3] < 0) { crop[1] += crop[3]; crop[3] = -crop[3]; }
    }
    this.quad(left, top, width, height, image, WHITE, crop);
  }
  fillRect(left, top, width, height) {
    if (this.lastFillStyle !== this.fillStyle) {
      this.lastFillStyle = this.fillStyle;
      const value = this.fillStyle;
      this.fillColor = /^#[0-9a-f]{6}$/i.test(value) ? [1, 3, 5].map(start => parseInt(value.slice(start, start + 2), 16) / 255) : value.match(/-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi).slice(0, 3).map(v => Math.max(0, Math.min(255, Number(v))) / 255);
    }
    this.quad(left, top, width, height, null, this.fillColor);
  }
  flush() { if (this.used) this.drawCalls++; super.flush(); }
  end() {
    this.flush(); if (this.gl.isContextLost()) { this.failed = true; return false; }
    this.target.save(); this.target.setTransform(1, 0, 0, 1, 0, 0); this.target.globalAlpha = 1;
    this.target.drawImage(this.canvas, 0, 0); this.target.restore(); return true;
  }
}
