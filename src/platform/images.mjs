import { assetBytes, resourceReferences, mediaType } from './files.mjs';
import { t } from '../i18n.mjs';

export function animatedImage(name, bytes) {
  if (/\.(gif|webp|avif|apng)$/i.test(name)) return true;
  if (!/\.png$/i.test(name) || bytes.length < 8) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const type = view.getUint32(offset + 4);
    if (type === 0x6163544c) return true;
    if (type === 0x49444154 || type === 0x49454e44) return false;
    offset += view.getUint32(offset) + 12;
  }
  return false;
}

export class ProjectImages {
  constructor(invalidate, report = () => {}) {
    this.invalidate = invalidate; this.report = report; this.images = new Map(); this.records = new Map();
    this.generation = 0; this.background = null; this.queue = []; this.activeLoads = 0; this.decodedBytes = 0; this.budget = 384 * 1024 ** 2;
  }

  async load(chart, assets, chartName, info) {
    this.clear();
    const references = resourceReferences(chart, assets, chartName, info);
    this.backgroundName = references.background;
    const names = new Set([references.background, ...(chart.judgeLineList ?? []).map(line => line.Texture)].filter(Boolean));
    for (const name of names) {
      const bytes = assetBytes(assets, name, chartName);
      if (!bytes) { if (name !== 'line.png') this.report(t('images.sa9a32ca', { p0: name })); continue; }
      const dimensions = pngDimensions(bytes);
      this.records.set(name, { name, bytes, ...dimensions, animated: animatedImage(name, bytes), lastUsed: 0, requestedScale: 0, generation: this.generation });
    }
    const background = this.records.get(this.backgroundName);
    if (background) {
      const display = Math.max(globalThis.innerWidth || 1920, globalThis.innerHeight || 1080) * (globalThis.devicePixelRatio || 1);
      this.texture(this.backgroundName, Math.min(1, display / Math.max(background.naturalWidth || display, background.naturalHeight || display)));
      await background.pending;
    }
    this.invalidate();
  }

  describe(name) { return this.records.get(name); }

  texture(name, scale = 1) {
    const record = this.records.get(name);
    if (!record || record.failed) return null;
    record.lastUsed = performance.now();
    const desired = textureScale(scale);
    record.requestedScale = Math.max(record.requestedScale, desired);
    if (!record.pending && (!record.image || record.scale < desired)) {
      record.pending = new Promise(resolve => { record.complete = resolve; });
      this.queue.push(record); this.pump();
    }
    return record.image ?? null;
  }

  pump() {
    while (this.activeLoads < 2 && this.queue.length) {
      const record = this.queue.shift();
      if (record.generation !== this.generation) { record.complete(); continue; }
      this.activeLoads++;
      this.decode(record).finally(() => { this.activeLoads--; record.pending = null; record.complete(); this.pump(); });
    }
  }

  async decode(record) {
    const scale = record.requestedScale;
    let source;
    try {
      const blob = new Blob([record.bytes], { type: mediaType(record.name) });
      if (record.animated || typeof createImageBitmap !== 'function') {
        const url = URL.createObjectURL(blob);
        try { source = new Image(); source.src = url; await source.decode(); }
        finally { URL.revokeObjectURL(url); }
        record.naturalWidth = source.naturalWidth; record.naturalHeight = source.naturalHeight;
      } else {
        const options = record.naturalWidth ? { resizeWidth: Math.max(1, Math.ceil(record.naturalWidth * scale)), resizeHeight: Math.max(1, Math.ceil(record.naturalHeight * scale)), resizeQuality: 'high' } : {};
        source = await createImageBitmap(blob, options);
        if (!record.naturalWidth) { record.naturalWidth = source.width; record.naturalHeight = source.height; }
      }
      if (record.generation !== this.generation) { source.close?.(); return; }
      this.release(record);
      record.scale = record.animated ? 1 : source.width / record.naturalWidth;
      record.image = { source, naturalWidth: record.naturalWidth, naturalHeight: record.naturalHeight };
      record.cost = (source.width || source.naturalWidth) * (source.height || source.naturalHeight) * 4;
      this.decodedBytes += record.cost; this.images.set(record.name, record.image);
      if (record.name === this.backgroundName) { this.background = record.image; this.backgroundAnimated = record.animated; }
      this.trim(); this.invalidate();
    } catch {
      source?.close?.();
      if (record.generation === this.generation) { record.failed = true; this.report(t('images.s2ebd935', { p0: record.name })); }
    }
  }

  release(record) {
    if (!record.image) return;
    record.image.source.close?.(); this.decodedBytes -= record.cost;
    this.images.delete(record.name); record.image = null; record.scale = 0; record.requestedScale = 0;
  }

  trim() {
    if (this.decodedBytes <= this.budget) return;
    const cutoff = performance.now() - 1000;
    const candidates = [...this.records.values()].filter(record => record.image && record.name !== this.backgroundName && record.lastUsed < cutoff).sort((left, right) => left.lastUsed - right.lastUsed);
    for (const record of candidates) { if (this.decodedBytes <= this.budget) break; this.release(record); }
  }

  clear() {
    this.generation++;
    for (const record of this.records.values()) this.release(record);
    for (const record of this.queue) record.complete();
    this.queue = []; this.records.clear(); this.images.clear(); this.background = null; this.backgroundAnimated = false;
  }
}

export function textureScale(scale) {
  if (!Number.isFinite(scale) || scale >= 1) return 1;
  return 2 ** Math.ceil(Math.log2(Math.max(1 / 64, scale)));
}

export function pngDimensions(bytes) {
  if (bytes.length < 24) return {};
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0) !== 0x89504e47 || view.getUint32(4) !== 0x0d0a1a0a) return {};
  return { naturalWidth: view.getUint32(16), naturalHeight: view.getUint32(20) };
}
