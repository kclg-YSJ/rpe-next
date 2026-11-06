import { noiseRuntime, NOISE_AREA_COLORS } from '../core/noise-areas.mjs';
import { IntervalIndex } from '../core/interval-index.mjs';
import { NoiseEdgeFilter } from './noise-edge-filter.mjs';
import { noiseRenderingLayers, noiseLayerId } from '../core/noise-skin.mjs';
import { NoiseSkinRenderer } from './noise-skin-renderer.mjs';
import { previewNoiseGeometry } from '../core/editor-display.mjs';
import { ResourceCache } from '../core/resource-cache.mjs';
import { t } from '../i18n.mjs';

const rank = { disabled: 0, ready: 1, active: 2 };
const guideFonts = new WeakMap();
function guideFontState() {
  const fonts = typeof document === 'undefined' ? null : document.fonts;
  if (!fonts) return null;
  if (!guideFonts.has(fonts)) { const state = { revision: 0 }; fonts.addEventListener('loadingdone', () => state.revision++); guideFonts.set(fonts, state); }
  return guideFonts.get(fonts);
}
function polygon(points, width, height, scale) {
  const path = new Path2D();
  const winding = points.reduce((sum, point, index) => { const next = points[(index + 1) % points.length]; return sum + point.x * next.y - next.x * point.y; }, 0);
  const ordered = winding < 0 ? [...points].reverse() : points;
  ordered.forEach((point, index) => { const horizontal = width / 2 + point.x * scale; const vertical = height / 2 - point.y * scale; if (index) path.lineTo(horizontal, vertical); else path.moveTo(horizontal, vertical); });
  path.closePath(); return path;
}

export class NoisePreview {
  constructor() {
    this.layers = new Map(); this.edgeFilter = new NoiseEdgeFilter();
    this.guideSprites = new ResourceCache({ maxEntries: 1024, maxBytes: 48 * 1024 ** 2 });
    this.guideFonts = guideFontState(); this.guideFontRevision = this.guideFonts?.revision;
  }
  usesSkin(layer) { return Boolean(layer.skin) && !this.forceSimple && !this.hiddenLayers?.has(layer.id) && !this.simpleLayers?.has(layer.id); }
  layer(name, width, height, ratio) {
    let canvas = this.layers.get(name);
    if (!canvas) { canvas = document.createElement('canvas'); this.layers.set(name, canvas); }
    const pixelsWidth = Math.max(1, Math.round(width * ratio)); const pixelsHeight = Math.max(1, Math.round(height * ratio));
    if (canvas.width !== pixelsWidth || canvas.height !== pixelsHeight) { canvas.width = pixelsWidth; canvas.height = pixelsHeight; }
    const context = canvas.getContext('2d'); context.setTransform(ratio, 0, 0, ratio, 0, 0); context.globalAlpha = 1; context.globalCompositeOperation = 'source-over'; context.clearRect(0, 0, width, height);
    return { canvas, context };
  }
  draw(target, chart, tempo, seconds, width, height, scale, selected = -1, viewport = { left: 0, top: 0, width, height }, options = {}) {
    this.guides = []; this.hitEntries = []; this.width = width; this.height = height;
    if (!width || !height) return;
    const areas = chart.blockAreaList ?? [];
    const definitions = noiseRenderingLayers(chart, !areas.length && options.sourceGuides?.length ? options.sourceGuides.map(entry => entry.area) : areas).filter(layer => !this.hiddenLayers?.has(layer.id));
    this.gpu?.prune(new Set(definitions.filter(layer => this.usesSkin(layer)).map(layer => layer.id)));
    if (!definitions.length) return;
    if (this.source !== areas || this.tempo !== tempo) {
      this.source = areas; this.tempo = tempo;
      this.lifetimes = new IntervalIndex(this.source, area => tempo.seconds(area.appearTime), area => tempo.seconds(area.disappearTime));
    }
    this.guides = options.sourceGuides ?? this.lifetimes.query(seconds, seconds).filter(entry => seconds < entry.end && !this.hiddenLayers?.has(noiseLayerId(entry.item))).map(entry => ({ area: entry.item, index: entry.index, ...noiseRuntime(entry.item, tempo).sample(seconds) }));
    if (!options.sourceGuides && options.positionScale) this.guides = this.guides.map(entry => previewNoiseGeometry(entry, options.positionScale));
    if (!options.sourceGuides && this.transformGeometry) this.guides = this.guides.map(entry => this.transformGeometry(entry, { width, height, scale, viewport, seconds })).filter(Boolean);
    const margin = Math.max(2, scale * 5);
    const skinBounds = new Map(); let assets;
    for (const layer of definitions) if (this.usesSkin(layer)) {
      this.gpu ??= new NoiseSkinRenderer(() => this.invalidate?.(), message => this.report?.(message));
      assets ??= this.getAssets?.() ?? new Map();
      const ratio = target.canvas.width / width;
      const prepared = this.gpu.prepare?.(layer, assets, Math.max(1,Math.round(viewport.width*ratio)), Math.max(1,Math.round(viewport.height*ratio)));
      const padding = prepared?.padding ?? [32,32];
      skinBounds.set(layer.id, { skin: prepared?.skin, bounds: [viewport.left-padding[0]/ratio, viewport.top-padding[1]/ratio, viewport.left+viewport.width+padding[0]/ratio, viewport.top+viewport.height+padding[1]/ratio] });
    }
    let entries = this.guides.filter(entry => {
      if (entry.scaleX === 0 || entry.scaleY === 0) return false;
      const bounds = skinBounds.get(noiseLayerId(entry.area))?.bounds ?? [-margin,-margin,width+margin,height+margin];
      return !entry.points.every(point => width/2+point.x*scale < bounds[0]) && !entry.points.every(point => width/2+point.x*scale > bounds[2]) &&
        !entry.points.every(point => height/2-point.y*scale < bounds[1]) && !entry.points.every(point => height/2-point.y*scale > bounds[3]);
    });
    const interior = options.excludeInside;
    if (interior && interior.right > interior.left && !definitions.some(layer => this.usesSkin(layer))) entries = entries.filter(entry => !entry.points.every(point => {
      const horizontal = width / 2 + point.x * scale;
      return horizontal > interior.left && horizontal < interior.right;
    }));
    for (const entry of entries) entry.path = polygon(entry.points, width, height, scale);
    const ratio = options.pixelRatio ?? (globalThis.devicePixelRatio || 1);
    entries.sort((left, right) => rank[left.state] - rank[right.state] || left.index - right.index);
    this.hitEntries = definitions.flatMap(layer => entries.filter(entry => noiseLayerId(entry.area) === layer.id));
    for (const definition of definitions) {
      const items = entries.filter(entry => noiseLayerId(entry.area) === definition.id);
      if (this.usesSkin(definition)) {
        const musicSeconds = seconds + Number(chart.META?.offset ?? 0) / 1000;
        if (this.gpu.render(target, definition, assets, items, musicSeconds, viewport, scale, width, height, skinBounds.get(definition.id)?.skin)) continue;
      }
      if (!items.length) continue;
      const composite = this.layer('composite', width, height, ratio);
      // Ready belongs to the disabled coverage set as well as its own overlay.
      for (const group of [items.filter(entry => entry.state !== 'active'), items.filter(entry => entry.state === 'active')]) {
        if (!group.length) continue;
        const layer = this.drawLayer(group, width, height, scale, ratio);
        composite.context.globalCompositeOperation = 'destination-out'; composite.context.drawImage(layer.coverage, 0, 0, width, height);
        composite.context.globalCompositeOperation = 'source-over'; composite.context.drawImage(layer.material, 0, 0, width, height);
      }
      target.save(); target.drawImage(composite.canvas, 0, 0, width, height); target.restore();
    }
  }
  drawLayer(entries, width, height, scale, ratio) {
    const normal = this.layer('normal', width, height, ratio);
    const seamless = this.seamless !== false;
    const hasInversion = entries.some(entry => entry.area.isInvert);
    const normalPath = new Path2D();
    const invertedUnion = hasInversion ? this.layer('inverted-union', width, height, ratio) : null;
    const invertedOverlap = hasInversion ? this.layer('inverted-overlap', width, height, ratio) : null;
    for (const entry of entries) {
      if (entry.area.isInvert) {
        invertedOverlap.context.save(); invertedOverlap.context.clip(entry.path);
        invertedOverlap.context.drawImage(invertedUnion.canvas, 0, 0, width, height); invertedOverlap.context.restore();
        invertedUnion.context.fillStyle = '#fff'; invertedUnion.context.fill(entry.path);
      }
      else normalPath.addPath(entry.path);
    }
    normal.context.fillStyle = '#fff'; normal.context.fill(normalPath);
    const coverage = hasInversion ? this.layer('coverage', width, height, ratio) : normal;
    if (hasInversion) {
      coverage.context.drawImage(normal.canvas, 0, 0, width, height);
      coverage.context.globalCompositeOperation = 'xor'; coverage.context.fillStyle = '#fff';
      invertedUnion.context.globalCompositeOperation = 'destination-out'; invertedUnion.context.drawImage(invertedOverlap.canvas, 0, 0, width, height);
      coverage.context.drawImage(invertedUnion.canvas, 0, 0, width, height);
    }
    const material = this.layer('material', width, height, ratio);
    const edges = seamless && entries.some(entry => entry.activationMix > 0) ? this.layer('edges', width, height, ratio) : null;
    const uniform = seamless && entries.every(entry => entry.state === entries[0].state) && entries[0].state !== 'ready';
    const inverted = !uniform && hasInversion ? this.layer('inverted', width, height, ratio) : null;
    const outlines = uniform && edges ? new Path2D() : null;
    for (const entry of entries) {
      if (!uniform) {
        const context = entry.area.isInvert ? inverted.context : material.context;
        const color = NOISE_AREA_COLORS.appearance.slice(0, 3).map((value, index) => Math.round(value + (NOISE_AREA_COLORS.active[index] - value) * entry.activationMix));
        context.save(); context.clip(entry.path); context.clearRect(0, 0, width, height);
        context.fillStyle = `rgba(${color.slice(0, 3).join(',')},${entry.alpha})`; context.fillRect(0, 0, width, height);
        if (!seamless && entry.activationMix > 0) { context.strokeStyle = `rgba(${NOISE_AREA_COLORS.edge.slice(0, 3).join(',')},${entry.activationMix})`; context.lineWidth = Math.max(2, scale * 5); context.stroke(entry.path); }
        context.restore();
      }
      if (outlines) outlines.addPath(entry.path);
      else if (edges && entry.activationMix > 0) {
        edges.context.strokeStyle = `rgba(${NOISE_AREA_COLORS.edge.slice(0, 3).join(',')},${entry.activationMix})`;
        edges.context.lineWidth = Math.max(2, scale * 5); edges.context.stroke(entry.path);
      }
    }
    if (outlines) { edges.context.strokeStyle = `rgb(${NOISE_AREA_COLORS.edge.slice(0, 3).join(',')})`; edges.context.lineWidth = Math.max(2, scale * 5); edges.context.stroke(outlines); }
    if (inverted) {
      inverted.context.globalCompositeOperation = 'destination-out'; inverted.context.drawImage(normal.canvas, 0, 0, width, height);
      material.context.drawImage(inverted.canvas, 0, 0, width, height);
    }
    if (uniform) {
      const color = entries[0].state === 'active' ? NOISE_AREA_COLORS.active : NOISE_AREA_COLORS.appearance;
      material.context.fillStyle = `rgba(${color.slice(0, 3).join(',')},${color[3]})`; material.context.fillRect(0, 0, width, height);
    }
    material.context.globalCompositeOperation = 'destination-in'; material.context.drawImage(coverage.canvas, 0, 0, width, height);
    if (edges) {
      const radius = Math.max(1, scale * 2.5);
      const edgeQuality = entries.length > 48 ? 0.5 : 1;
      const filtered = this.edgeFilter.render(coverage.canvas, edges.canvas, radius / width, radius / height, NOISE_AREA_COLORS.edge, edgeQuality);
      if (filtered) {
        material.context.globalCompositeOperation = 'source-over'; material.context.drawImage(filtered, 0, 0, width, height);
        return { material: material.canvas, coverage: coverage.canvas };
      }
      const interior = this.layer('interior', width, height, ratio);
      interior.context.drawImage(coverage.canvas, 0, 0, width, height);
      interior.context.globalCompositeOperation = 'destination-in';
      for (let direction = 0; direction < 8; direction++) {
        const angle = direction * Math.PI / 4;
        interior.context.drawImage(coverage.canvas, Math.cos(angle) * radius, Math.sin(angle) * radius, width, height);
      }
      edges.context.globalCompositeOperation = 'destination-out'; edges.context.drawImage(interior.canvas, 0, 0, width, height);
      edges.context.globalCompositeOperation = 'destination-in'; edges.context.drawImage(coverage.canvas, 0, 0, width, height);
      material.context.globalCompositeOperation = 'source-over'; material.context.drawImage(edges.canvas, 0, 0, width, height);
    }
    return { material: material.canvas, coverage: coverage.canvas };
  }
  pick(horizontal, vertical) {
    this.pickCanvas ??= document.createElement('canvas');
    const context = this.pickCanvas.getContext('2d');
    if (!context || !this.hitEntries?.length) return null;
    context.save(); context.setTransform(1, 0, 0, 1, 0, 0);
    try {
      for (let index = this.hitEntries.length - 1; index >= 0; index--) {
        const entry = this.hitEntries[index];
        if (context.isPointInPath(entry.path, horizontal, vertical)) return entry.index;
      }
      return null;
    } finally { context.restore(); }
  }
  guideSprite(text, font, color) {
    if (this.guideFontRevision !== this.guideFonts?.revision) { this.guideSprites.clear(); this.guideFontRevision = this.guideFonts?.revision; }
    const ratio = Math.max(2, globalThis.devicePixelRatio || 1);
    const key = JSON.stringify([text, font, color, ratio]); const cached = this.guideSprites.get(key);
    if (cached) return cached;
    this.guideMeasure ??= document.createElement('canvas').getContext('2d');
    const measure = this.guideMeasure; measure.font = font; measure.textAlign = 'center'; measure.textBaseline = 'bottom';
    const metrics = text ? measure.measureText(text) : null;
    const left = Math.floor(Math.min(-9, -(metrics?.actualBoundingBoxLeft ?? (metrics?.width ?? 0) / 2)) - 2);
    const right = Math.ceil(Math.max(9, metrics?.actualBoundingBoxRight ?? (metrics?.width ?? 0) / 2) + 2);
    const top = Math.floor(Math.min(-9, -10 - (metrics?.actualBoundingBoxAscent ?? parseFloat(font))) - 2);
    const bottom = Math.ceil(Math.max(9, -10 + (metrics?.actualBoundingBoxDescent ?? 0)) + 2);
    const width = Math.ceil((right - left) * ratio), height = Math.ceil((bottom - top) * ratio);
    if (width > 4096 || height > 4096 || width * height * 4 > this.guideSprites.maxBytes / 4) return null;
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d'); context.setTransform(ratio, 0, 0, ratio, -left * ratio, -top * ratio);
    context.strokeStyle = context.fillStyle = color; context.lineWidth = 1.5;
    context.beginPath(); context.arc(0, 0, 3.5, 0, Math.PI * 2); context.moveTo(-8, 0); context.lineTo(8, 0); context.moveTo(0, -8); context.lineTo(0, 8); context.stroke();
    if (text) { context.font = font; context.textAlign = 'center'; context.textBaseline = 'bottom'; context.fillText(text, 0, -10); }
    return this.guideSprites.set(key, { canvas, left, top, width: canvas.width / ratio, height: canvas.height / ratio }, canvas.width * canvas.height * 4);
  }
  drawGuides(context, scale, selected, showNames) {
    for (const entry of this.guides ?? []) {
      const focused = entry.index === selected;
      if (!showNames && !focused) continue;
      context.save();
      const horizontal = this.width / 2 + entry.center.x * scale; const vertical = this.height / 2 - entry.center.y * scale;
      context.translate(horizontal, vertical); context.rotate(entry.rotation);
      if (typeof document !== 'undefined') {
        const sprite = this.guideSprite(showNames ? entry.area.Name || t('noise-preview.s64fec24', { p0: entry.index }) : '', `${Math.max(11, 30 * scale)}px RPEGame, sans-serif`, focused ? '#ffe39a' : '#ffc9b5');
        if (sprite) { context.imageSmoothingEnabled = true; context.drawImage(sprite.canvas, sprite.left, sprite.top, sprite.width, sprite.height); context.restore(); continue; }
      }
      context.strokeStyle = focused ? '#ffe39a' : '#ffc9b5'; context.fillStyle = context.strokeStyle; context.lineWidth = 1.5;
      context.beginPath(); context.arc(0, 0, 3.5, 0, Math.PI * 2); context.moveTo(-8, 0); context.lineTo(8, 0); context.moveTo(0, -8); context.lineTo(0, 8); context.stroke();
      if (showNames) { context.font = `${Math.max(11, 30 * scale)}px RPEGame, sans-serif`; context.textAlign = 'center'; context.textBaseline = 'bottom'; context.fillText(entry.area.Name || t('noise-preview.s64fec24', { p0: entry.index }), 0, -10); }
      context.restore();
    }
  }
}
