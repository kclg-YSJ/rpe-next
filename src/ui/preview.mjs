import { SceneRuntime } from '../core/scene.mjs';
import { noteIsAbove } from '../core/chart.mjs';
import { NotePreview } from '../core/note-preview.mjs';
import { prepareCanvas, NOTE_COLORS } from './timeline.mjs';
import { DEFAULT_LINE_WIDTH, DEFAULT_LINE_HEIGHT, HIT_DURATION, hitFrame } from '../core/visual-constants.mjs';
import { previewViewport, previewDefaultFrame, previewPositionScale, previewNotePosition, simultaneousNotes, hitParticles, overflowTextureSize } from '../core/editor-display.mjs';
import { renderPasses } from '../core/game-ui.mjs';
import { drawGameUi } from './game-ui.mjs';
import { recentHits, HitGeometryCache } from '../core/hit-effects.mjs';
import { lineGuides, mergeGuides, pickGuide, sortedGuideMatches, formatLineNumbers } from '../core/preview-guides.mjs';
import { ShaderRuntime } from '../core/shader.mjs';
import { ShaderPipeline } from './shader-pipeline.mjs';
import { PreviewBackground, textureInViewport } from './preview-background.mjs';
import { NoisePreview } from './noise-preview.mjs';
import { noiseRenderingLayers } from '../core/noise-skin.mjs';
import { DEFAULT_EDITOR_PREFERENCES } from '../core/default-settings.mjs';
import { HitEffectBatch } from './hit-effect-batch.mjs';
import { NoteSpriteBatch, holdBatchWithinBudget } from './note-sprite-batch.mjs';

const clamp = value => Math.max(0, Math.min(1, value));

export class Preview {
  constructor(canvas) {
    this.canvas = canvas; this.scene = new SceneRuntime(); this.shaderRuntime = new ShaderRuntime(() => this.invalidate?.()); this.shaderPipeline = new ShaderPipeline(() => this.invalidate?.());
    this.backgroundFrame = new PreviewBackground();
    this.noisePreview = new NoisePreview();
    this.allLines = true; this.visible = false; this.noteSize = 175; this.lineScale = 1.5; this.backgroundAlpha = 0.35; this.backgroundBlur = 10.5; this.effectsSince = Infinity; this.applyShaders = true; this.opacity = 1; this.showHitEffects = true;
    this.noteHitAreas = [];
    this.noteDraft = new NotePreview(); this.simultaneousCounts = new Map();
    this.hitGeometry = new HitGeometryCache();
    this.hitBatch = new HitEffectBatch();
    this.noteBatch = new NoteSpriteBatch();
    this.viewportOverflow = DEFAULT_EDITOR_PREFERENCES.viewportOverflow;
    this.overflowBlur = DEFAULT_EDITOR_PREFERENCES.overflowBlur;
    this.overflowDarken = DEFAULT_EDITOR_PREFERENCES.overflowDarken;
    this.overflowRevision = 0;
    this.invalidateOverflow = () => { this.overflowRevision++; this.invalidate?.(); };
    this.lineTextLayouts = new Map();
    this.guideTextCache = new Map();
    if (typeof document !== 'undefined') document.fonts?.addEventListener('loadingdone', () => { this.lineTextLayouts.clear(); this.guideTextCache.clear(); this.invalidateOverflow(); });
    if (typeof document === 'undefined') { this.overlayCanvas = null; this.shaderCanvas = null; return; }
    this.overlayCanvas = document.createElement('canvas'); this.shaderCanvas = document.createElement('canvas');
    for (const [layer, canvasLayer] of [['shader', this.shaderCanvas], ['overlay', this.overlayCanvas]]) {
      canvasLayer.className = `preview-${layer}-layer`; canvasLayer.setAttribute('aria-hidden', 'true'); canvasLayer.style.position = 'absolute'; canvasLayer.style.inset = '0'; canvasLayer.style.width = '100%'; canvasLayer.style.height = '100%'; canvasLayer.style.pointerEvents = 'none'; canvasLayer.style.visibility = 'hidden'; canvasLayer.style.zIndex = layer === 'shader' ? '1' : '2';
      canvas.parentElement?.insertBefore(canvasLayer, canvas.nextSibling);
    }
  }

  draw(chart, tempo, seconds, selectedLine) {
    if (!this.visible) return;
    const rectangle = this.canvas.getBoundingClientRect();
    if (!(rectangle.width > 0 && rectangle.height > 0)) {
      // A live preview may be temporarily stashed or hidden by a mod. Keep its backing
      // store intact and avoid feeding zero-size surfaces into background/shader passes.
      this.noteHitAreas = []; this.guides = []; this.viewport = null;
      this.noisePreview.guides = []; this.noisePreview.hitEntries = [];
      for (const layer of [this.shaderCanvas, this.overlayCanvas]) if (layer) layer.style.visibility = 'hidden';
      if (this.overflowLayer) this.overflowLayer.hidden = true;
      return;
    }
    // Auxiliary surfaces belong to the preview even when its live canvas is relocated.
    for (const layer of [this.shaderCanvas, this.overlayCanvas]) if (layer && layer.parentElement !== this.canvas.parentElement) this.canvas.after(layer);
    if (this.overflowLayer && this.overflowLayer.parentElement !== this.canvas.parentElement) this.canvas.after(this.overflowLayer);
    this.chart = chart;
    if (this.preparedChart !== chart || this.preparedTempo !== tempo || this.scene.chart !== chart || this.scene.tempo !== tempo) {
      this.scene.compile(chart, tempo); this.simultaneous = simultaneousNotes(chart, tempo, this.simultaneousCounts);
      this.completionTimes = this.scene.lines.flatMap(runtime => runtime.notes.filter(entry => !entry.note.isFake).map(entry => entry.note.type === 2 ? entry.end : entry.start)).sort((left, right) => left - right);
      this.passes = renderPasses(chart.judgeLineList, this.scene.order);
      this.shaderRuntime.compile(chart, tempo);
      this.preparedChart = chart; this.preparedTempo = tempo;
    }
    this.noteDraft.update(this.scene, this.noteOverrides);
    const { context, width, height } = prepareCanvas(this.canvas, rectangle);
    const viewport = previewViewport(width, height, this.aspectRatio ?? 1.5);
    const divisor = this.viewDivisor ?? 1;
    const scale = viewport.scale / divisor;
    const positionScale = previewPositionScale(this.aspectRatio ?? 1.5);
    const states = this.scene.sample(seconds, positionScale);
    const shaderEffects = this.applyShaders ? this.shaderRuntime.active(seconds) : [];
    const skinScene = noiseRenderingLayers(chart).some(layer => this.noisePreview.usesSkin(layer));
    const integratedOverflow = Boolean(this.viewportOverflow && viewport.left > 0.5 && shaderEffects.length && !skinScene &&
      this.drawScene === Preview.prototype.drawScene && this.drawBackground === Preview.prototype.drawBackground && this.drawUi === Preview.prototype.drawUi);
    const overflowFrame = { width, height, viewport, scale, divisor, states, positionScale, shaderEffects };
    this.prepareViewportOverflowFrame(chart, tempo, seconds, selectedLine, overflowFrame);
    this.overflowSceneCaptured = false;
    this.overflowCompleteSceneCaptured = false;
    const captureOverflow = !shaderEffects.length && this.overflowRefreshRequired && this.drawScene === Preview.prototype.drawScene && this.drawBackground === Preview.prototype.drawBackground;
    const captureComplete = captureOverflow && !skinScene && !shaderEffects.length;
    const sceneBounds = captureOverflow ? { left: 0, top: 0, width, height } : viewport;
    context.save(); context.beginPath(); context.rect(sceneBounds.left, sceneBounds.top, sceneBounds.width, sceneBounds.height); context.clip();
    // Screen-sampling skins preserve scene alpha, so supply the same opaque base as shaders.
    if (this.applyShaders || skinScene) { context.fillStyle = '#111'; context.fillRect(sceneBounds.left, sceneBounds.top, sceneBounds.width, sceneBounds.height); }
    this.drawBackground(context, chart, tempo, seconds, selectedLine, { width, height, viewport, scale, divisor });
    this.viewScale=scale;
    this.viewport = viewport; this.selectedLine = selectedLine;
    this.drawScene(context, chart, tempo, seconds, selectedLine, { width, height, viewport, scale, divisor, states, positionScale, ...(captureOverflow ? { renderViewport: sceneBounds } : {}) });
    if (captureOverflow) {
      if (!captureComplete) this.captureOverflowSource(overflowFrame);
      context.restore();
      context.save(); context.beginPath(); context.rect(viewport.left, viewport.top, viewport.width, viewport.height); context.clip();
    }
    const localEffects = shaderEffects.filter(effect => !effect.global);
    const globalEffects = shaderEffects.filter(effect => effect.global);
    const renderShaders = (effects, final = false) => {
      const source = integratedOverflow && final ? this.prepareShaderOverflowSource(chart, tempo, seconds, selectedLine, overflowFrame, localEffects.length > 0) : null;
      const filter = source ? { blur: Math.max(0, this.overflowBlur) * (globalThis.devicePixelRatio || 1), brightness: 1 - clamp(Number(this.overflowDarken) || 0), keepInside: true,
        sourceCanvas: source, sourceRevision: this.overflowSourceRevision, overlayCanvas: this.overflowShaderOverlay, effects: shaderEffects, resolution: [width / viewport.scale, height / viewport.scale] } : undefined;
      return (effects.length > 0 || integratedOverflow && final) && this.shaderPipeline.render(this.canvas, this.shaderCanvas, effects, seconds, effect => this.shaderRuntime.source(effect.shader, effect.sourceName), viewport, undefined, filter);
    };
    // Scene → local effects → game UI → noise layers → global effects.
    if (renderShaders(localEffects)) {
      context.clearRect(viewport.left, viewport.top, viewport.width, viewport.height);
      context.drawImage(this.shaderCanvas, 0, 0, width, height);
    }
    if (this.showGameUI) this.drawUi(context, chart, tempo, seconds, selectedLine, { width, height, viewport, scale, divisor, states });
    this.drawGuides(context, scale, selectedLine);
    if (captureComplete) context.restore();
    this.noisePreview.draw(context, chart, tempo, seconds, width, height, scale, this.selectedNoiseArea, viewport, { positionScale });
    if (captureComplete) {
      this.captureOverflowSource(overflowFrame, true); this.overflowCompleteSceneCaptured = true;
      context.save(); context.beginPath(); context.rect(viewport.left, viewport.top, viewport.width, viewport.height); context.clip();
    }
    this.noisePreview.drawGuides(context, scale, this.selectedNoiseArea, this.lineNumbers);
    context.restore();
    const shaderRendered = renderShaders(globalEffects, true);
    if (integratedOverflow) { this.overflowReady = false; this.overflowCompositor = null; }
    else this.drawViewportOverflow(context, chart, tempo, seconds, selectedLine, overflowFrame);
    const defaultFrame = previewDefaultFrame(viewport, divisor);
    const overflowOverlay = this.overflowReady && !this.overflowCompositor;
    if (shaderRendered && this.overlayCanvas && (overflowOverlay || defaultFrame)) {
      const overlay = prepareCanvas(this.overlayCanvas, rectangle).context;
      if (overflowOverlay) this.compositeViewportOverflow(overlay, overflowFrame);
      this.drawDefaultFrame(overlay, defaultFrame);
    } else if (!shaderRendered) this.drawDefaultFrame(context, defaultFrame);
    if (this.shaderCanvas) this.shaderCanvas.style.visibility = shaderRendered ? 'visible' : 'hidden';
    if (this.overlayCanvas) this.overlayCanvas.style.visibility = shaderRendered && (overflowOverlay || defaultFrame) ? 'visible' : 'hidden';
    this.updateOverflowLayer(overflowFrame);
    if (this.canvas.style) this.canvas.style.opacity = shaderRendered ? '0' : String(clamp(this.opacity));
    for (const layer of [this.shaderCanvas, this.overlayCanvas]) if (layer) layer.style.opacity = String(clamp(this.opacity));
    this.images?.trim?.();
  }

  drawDefaultFrame(context, frame) {
    if (!frame) return;
    context.save(); context.globalAlpha = 1; context.globalCompositeOperation = 'source-over'; context.strokeStyle = '#ffffff'; context.lineWidth = 1; context.setLineDash([]);
    context.strokeRect(frame.left, frame.top, frame.width, frame.height); context.restore();
  }

  drawViewportOverflow(context, chart, tempo, seconds, selectedLine, frame) {
    this.overflowReady = false;
    if (this.viewportOverflow === false || frame.viewport.left <= 0.5) { this.overflowCompositor = null; return; }
    if (typeof document === 'undefined') return;
    if (!this.overflowRefreshRequired && this.overflowCanvas) {
      this.overflowReady = true; this.compositeViewportOverflow(context, frame); return;
    }
    this.overflowCompositor = null;
    const surface = this.prepareOverflowSource(frame);
    const ratio = this.overflowSourceCanvas.width / frame.width;
    const viewport = { left: 0, top: 0, width: frame.width, height: frame.height, scale: frame.viewport.scale };
    const expanded = { ...frame, viewport, divisor: Math.max(frame.divisor, frame.width / frame.scale / 1350), cullNotes: true };
    surface.setTransform(ratio, 0, 0, ratio, 0, 0);
    if (!this.overflowSceneCaptured) {
      surface.clearRect(0, 0, frame.width, frame.height);
      if (this.applyShaders || noiseRenderingLayers(chart).some(layer => this.noisePreview.usesSkin(layer))) { surface.fillStyle = '#111'; surface.fillRect(0, 0, frame.width, frame.height); }
      const guides = this.guides, hits = this.noteHitAreas, centers = this.noteCenters; this.noteCenters = null;
      try {
        this.drawBackground(surface, chart, tempo, seconds, selectedLine, expanded);
        this.drawScene(surface, chart, tempo, seconds, selectedLine, expanded);
      } finally { this.guides = guides; this.noteHitAreas = hits; this.noteCenters = centers; }
    }
    let shaderResult = null;
    const effects = this.applyShaders ? this.shaderRuntime.active(seconds) : [];
    if (!this.overflowCompleteSceneCaptured) {
      this.overflowShaderCanvas ??= document.createElement('canvas');
      this.overflowShaderPipeline ??= new ShaderPipeline(this.invalidateOverflow);
      this.overflowNoisePreview ??= new NoisePreview();
      for (const key of ['seamless', 'forceSimple', 'hiddenLayers', 'simpleLayers', 'getAssets', 'report', 'transformGeometry']) this.overflowNoisePreview[key] = this.noisePreview[key];
      this.overflowNoisePreview.invalidate = this.invalidateOverflow;
      const shaders = (passes, final = false) => {
        const filter = final && effects.length ? { blur: Math.max(0, this.overflowBlur) * ratio, brightness: 1 - clamp(Number(this.overflowDarken) || 0) } : undefined;
        if (!passes.length && !filter) return false;
        if (this.overflowShaderPipeline.render(this.overflowSourceCanvas, this.overflowShaderCanvas, passes, seconds, effect => this.shaderRuntime.source(effect.shader, effect.sourceName), viewport, { width: frame.width, height: frame.height }, filter)) {
          if (final) shaderResult = this.overflowShaderCanvas;
          else { surface.clearRect(0, 0, frame.width, frame.height); surface.drawImage(this.overflowShaderCanvas, 0, 0, frame.width, frame.height); }
          return true;
        }
        return false;
      };
      shaders(effects.filter(effect => !effect.global));
      if (this.showGameUI) this.drawUi(surface, chart, tempo, seconds, selectedLine, frame);
      const margin = Math.max(0, this.overflowBlur) * 3 + Math.max(8, frame.scale * 6);
      this.overflowNoisePreview.draw(surface, chart, tempo, seconds, frame.width, frame.height, frame.scale, this.selectedNoiseArea, viewport, {
        sourceGuides: !this.noisePreview.transformGeometry ? this.noisePreview.guides : undefined, positionScale: frame.positionScale, pixelRatio: ratio,
        excludeInside: { left: frame.viewport.left + margin, right: frame.viewport.left + frame.viewport.width - margin },
      });
      shaders(effects.filter(effect => effect.global), true);
    }
    if (effects.length) {
      this.overflowCompositor = shaderResult ?? this.overflowSourceCanvas;
      this.overflowMemo = this.overflowPendingMemo; this.overflowReady = true;
      this.compositeViewportOverflow(context, frame); return;
    }
    const filtered = this.overflowCanvas.getContext('2d');
    filtered.setTransform(1, 0, 0, 1, 0, 0); filtered.clearRect(0, 0, this.overflowCanvas.width, this.overflowCanvas.height);
    filtered.filter = this.overflowBlur > 0 ? `blur(${this.overflowBlur * ratio}px)` : 'none';
    filtered.drawImage(this.overflowSourceCanvas, 0, 0); filtered.filter = 'none';
    const darken = clamp(Number(this.overflowDarken) || 0);
    if (darken > 0) { filtered.fillStyle = `rgba(0,0,0,${darken})`; filtered.fillRect(0, 0, this.overflowCanvas.width, this.overflowCanvas.height); }
    this.overflowMemo = this.overflowPendingMemo;
    this.overflowReady = true;
    this.compositeViewportOverflow(context, frame);
  }

  compositeViewportOverflow(context, frame) {
    context.save();
    context.beginPath();
    context.rect(0, 0, frame.viewport.left, frame.height);
    context.rect(frame.viewport.left + frame.viewport.width, 0, frame.width - frame.viewport.left - frame.viewport.width, frame.height);
    context.clip();
    context.clearRect(0, 0, frame.width, frame.height);
    if (!this.overflowCompositor) context.drawImage(this.overflowCanvas, 0, 0, frame.width, frame.height);
    context.restore();
  }

  updateOverflowLayer(frame) {
    if (!this.overflowReady || !this.overflowCompositor) { if (this.overflowLayer) this.overflowLayer.hidden = true; return; }
    if (!this.overflowLayer) {
      this.overflowLayer = document.createElement('div'); this.overflowLayer.className = 'preview-overflow-layer'; this.overflowLayer.setAttribute('aria-hidden', 'true');
      Object.assign(this.overflowLayer.style, { position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '2', overflow: 'hidden' });
      this.canvas.after(this.overflowLayer);
    }
    const layer = this.overflowLayer, source = this.overflowCompositor;
    if (source.parentElement !== layer) { layer.replaceChildren(source); Object.assign(source.style, { width: '100%', height: '100%', pointerEvents: 'none', visibility: 'visible' }); }
    source.style.filter = this.overflowShaderPipeline?.filterApplied ? 'none' : `blur(${Math.max(0, Number(this.overflowBlur) || 0)}px) brightness(${1 - clamp(Number(this.overflowDarken) || 0)})`;
    const left = frame.viewport.left, right = left + frame.viewport.width;
    layer.style.clipPath = `path("M0 0H${left}V${frame.height}H0Z M${right} 0H${frame.width}V${frame.height}H${right}Z")`;
    layer.style.opacity = String(clamp(this.opacity)); layer.hidden = false;
  }

  prepareOverflowSource(frame, filterRadius = 8) {
    this.overflowSourceCanvas ??= document.createElement('canvas');
    this.overflowCanvas ??= document.createElement('canvas');
    const size = overflowTextureSize(frame.width, frame.height, globalThis.devicePixelRatio || 1, this.overflowBlur, filterRadius);
    for (const canvas of [this.overflowSourceCanvas, this.overflowCanvas]) if (canvas.width !== size.width || canvas.height !== size.height) { canvas.width = size.width; canvas.height = size.height; }
    return this.overflowSourceCanvas.getContext('2d');
  }

  prepareShaderOverflowSource(chart, tempo, seconds, selectedLine, frame, hasLocalEffects = false) {
    if (!this.overflowRefreshRequired && this.overflowSourceCanvas && this.overflowLocalStage === hasLocalEffects) return this.overflowSourceCanvas;
    this.overflowLocalStage = hasLocalEffects;
    const surface = this.prepareOverflowSource(frame, 4), ratio = this.overflowSourceCanvas.width / frame.width;
    const viewport = { left: 0, top: 0, width: frame.width, height: frame.height, scale: frame.viewport.scale };
    const expanded = { ...frame, viewport, divisor: Math.max(frame.divisor, frame.width / frame.scale / 1350), cullNotes: true };
    surface.setTransform(ratio, 0, 0, ratio, 0, 0); surface.clearRect(0, 0, frame.width, frame.height);
    surface.fillStyle = '#111'; surface.fillRect(0, 0, frame.width, frame.height);
    const guides = this.guides, hits = this.noteHitAreas, centers = this.noteCenters; this.noteCenters = null;
    try { this.drawBackground(surface, chart, tempo, seconds, selectedLine, expanded); this.drawScene(surface, chart, tempo, seconds, selectedLine, expanded); }
    finally { this.guides = guides; this.noteHitAreas = hits; this.noteCenters = centers; }
    let overlay = surface;
    this.overflowShaderOverlay = null;
    if (hasLocalEffects && (this.showGameUI || chart.blockAreaList?.length)) {
      this.overflowStageCanvas ??= document.createElement('canvas');
      const canvas = this.overflowStageCanvas;
      if (canvas.width !== this.overflowSourceCanvas.width || canvas.height !== this.overflowSourceCanvas.height) { canvas.width = this.overflowSourceCanvas.width; canvas.height = this.overflowSourceCanvas.height; }
      overlay = canvas.getContext('2d'); overlay.setTransform(ratio, 0, 0, ratio, 0, 0); overlay.clearRect(0, 0, frame.width, frame.height);
      this.overflowShaderOverlay = canvas;
    }
    if (this.showGameUI) this.drawUi(overlay, chart, tempo, seconds, selectedLine, frame);
    if (chart.blockAreaList?.length) {
      this.overflowNoisePreview ??= new NoisePreview();
      for (const key of ['seamless', 'forceSimple', 'hiddenLayers', 'simpleLayers', 'getAssets', 'report']) this.overflowNoisePreview[key] = this.noisePreview[key];
      this.overflowNoisePreview.draw(overlay, chart, tempo, seconds, frame.width, frame.height, frame.scale, this.selectedNoiseArea, viewport, { sourceGuides: this.noisePreview.guides, pixelRatio: ratio });
    }
    this.overflowSourceRevision = (this.overflowSourceRevision ?? 0) + 1; this.overflowMemo = this.overflowPendingMemo;
    return this.overflowSourceCanvas;
  }

  captureOverflowSource(frame, edgesOnly = false) {
    const source = this.prepareOverflowSource(frame);
    source.setTransform(1, 0, 0, 1, 0, 0); source.clearRect(0, 0, this.overflowSourceCanvas.width, this.overflowSourceCanvas.height);
    const margin = Math.max(0, this.overflowBlur) * 3 + 2;
    const leftEnd = Math.min(frame.width, frame.viewport.left + margin), rightStart = Math.max(0, frame.viewport.left + frame.viewport.width - margin);
    if (edgesOnly && rightStart > leftEnd) {
      const inputScale = this.canvas.width / frame.width, outputScale = this.overflowSourceCanvas.width / frame.width;
      for (const [left, width] of [[0, leftEnd], [rightStart, frame.width - rightStart]]) source.drawImage(this.canvas,
        left * inputScale, 0, width * inputScale, this.canvas.height,
        left * outputScale, 0, width * outputScale, this.overflowSourceCanvas.height);
    } else source.drawImage(this.canvas, 0, 0, this.overflowSourceCanvas.width, this.overflowSourceCanvas.height);
    this.overflowSceneCaptured = true;
  }

  prepareViewportOverflowFrame(chart, tempo, seconds, selectedLine, frame) {
    this.overflowRefreshRequired = false;
    if (!this.viewportOverflow || frame.viewport.left <= 0.5 || typeof document === 'undefined') { this.overflowMemo = null; return; }
    const noise = this.noisePreview, images = this.images;
    if (this.overflowImageChart !== chart || this.overflowImageGeneration !== images?.generation || this.overflowImages !== images || this.overflowImageRecords !== images?.records?.size) {
      this.overflowImageChart = chart; this.overflowImageGeneration = images?.generation; this.overflowImages = images;
      this.overflowImageRecords = images?.records?.size;
      this.overflowAnimated = chart.judgeLineList.some(line => images?.describe?.(line.Texture)?.animated);
    }
    const key = [chart, tempo, selectedLine, frame.width, frame.height, frame.scale, globalThis.devicePixelRatio || 1, this.aspectRatio, this.allLines, this.noteSize, this.lineScale,
      this.skin, this.skin?.resourcePack, this.skin?.resourcePack?.info, this.skin?.images?.size, images, images?.generation, images?.decodedBytes, images?.background,
      this.backgroundAlpha, this.backgroundBlur, this.overflowBlur, this.overflowDarken, this.applyShaders, this.showGameUI, this.duration, this.highlight,
      this.lineTint, this.forceLineOpacity, this.showHitEffects, this.effectsSince, this.noteOpacity, noise.seamless, noise.forceSimple,
      [...(noise.hiddenLayers ?? [])].join('\0'), [...(noise.simpleLayers ?? [])].join('\0'), this.overflowRevision, this.noteOverrides,
      (frame.shaderEffects ?? []).map(effect => [effect.shader, effect.sourceName, effect.startBeat, effect.endBeat, effect.global].join(':')).join('|'), ...this.shaderRuntime.sources.values()];
    const now = performance.now(), memo = this.overflowMemo;
    const cacheable = !this.overflowAnimated && !images?.backgroundAnimated && this.drawScene === Preview.prototype.drawScene && this.drawBackground === Preview.prototype.drawBackground && this.drawUi === Preview.prototype.drawUi;
    const unchanged = cacheable && memo && memo.key.length === key.length && key.every((value, index) => value === memo.key[index]);
    const reuse = unchanged && (seconds === memo.seconds || seconds > memo.seconds && seconds - memo.seconds < 0.1 && now - memo.now < 1000 / 60);
    this.overflowRefreshRequired = !reuse;
    this.overflowPendingMemo = { key, seconds, now };
  }

  drawBackground(context, chart, tempo, seconds, selectedLine, { width, height, scale, center }) {
    let background = this.images?.background;
    if (background && this.images.texture) background = this.images.texture(this.images.backgroundName, Math.max(1350 / background.naturalWidth, 900 / background.naturalHeight) * scale * (devicePixelRatio || 1)) ?? background;
    if (!background) { this.backgroundFrame.clear(); return; }
    context.save();
    if (center) context.translate(-center.x * scale, center.y * scale);
    context.globalAlpha = this.backgroundAlpha;
    // A world capture already has a bounded target; paint directly rather than cache a world-size canvas.
    this.backgroundFrame.draw(context, background, width, height, scale, this.backgroundBlur, devicePixelRatio || 1, Boolean(center) || this.images.backgroundAnimated);
    context.restore();
  }

  drawUi(context, chart, tempo, seconds, selectedLine, { viewport, scale, states }) {
    drawGameUi(context, chart, states, this.completionTimes, seconds, selectedLine, viewport, scale, this.skin, this.duration ?? 600, this.noteDraft.completionDelta(seconds));
  }

  // Independent world pass, allowing optional modules to project it before screen effects and UI.
  drawScene(context, chart, tempo, seconds, selectedLine, { width, height, viewport, scale, divisor, states, center, cullNotes = false, positionScale = previewPositionScale(this.aspectRatio ?? 1.5), renderViewport = viewport }) {
    const originX = width / 2 - (center?.x ?? 0) * scale, originY = height / 2 + (center?.y ?? 0) * scale;
    const order = this.allLines ? this.scene.order : [selectedLine];
    this.guides = lineGuides(this.forceLineOpacity ? states.map(state => ({ ...state, alpha: 255 })) : states, chart.judgeLineList, order, width, height, scale);
    if (center) for (const guide of this.guides) { guide.x -= center.x * scale; guide.y += center.y * scale; }
    const visibleDivisor = Math.max(divisor, renderViewport.width / scale / 1350);
    const visibleNotes = new Map(order.map(index => [index, this.noteDraft.runtime(this.scene, index)?.visibleNotes(seconds, states[index], (1600 * visibleDivisor + Math.hypot((states[index]?.x ?? 0) - (center?.x ?? 0), (states[index]?.y ?? 0) - (center?.y ?? 0))) / positionScale.y) ?? []]));
    const noteAspects = new Map();
    this.noteHitAreas = [];
    this.noteCenters?.clear();
    const noteOpacity = clamp(this.noteOpacity ?? 1);
    let holdCount = 0, noteCount = 0;
    for (const entries of visibleNotes.values()) for (const entry of entries) { if (entry.note.type === 2) holdCount++; else noteCount++; }
    const drawPass = (context, pass) => { for (const index of pass.kind === 'line' ? [pass.index] : order) {
      if (pass.kind === 'line' && ((!this.allLines && index !== selectedLine) || !this.forceLineOpacity && (chart.judgeLineList[index].attachUI || states[index].alpha <= 0) || states[index].scaleX === 0 || states[index].scaleY === 0)) continue;
      const runtime = this.noteDraft.runtime(this.scene, index);
      const state = states[index];
      const collectCenters = index === this.noteCenterLine && this.noteCenters;
      if (!runtime) continue;
      if (pass.kind === 'line' && !runtime.line.extended?.textEvents?.length) {
        const texture = runtime.line.Texture && runtime.line.Texture !== 'line.png'
          ? this.images?.describe?.(runtime.line.Texture) ?? this.images?.images.get(runtime.line.Texture)
          : { naturalWidth: DEFAULT_LINE_WIDTH, naturalHeight: DEFAULT_LINE_HEIGHT * this.lineScale };
        if (!texture || texture.naturalWidth && !textureInViewport(texture, runtime.line, center ? { ...state, x: state.x - center.x, y: state.y - center.y } : state, width, height, scale, renderViewport)) continue;
      }
      context.save();
      context.translate(originX + state.x * scale, originY - state.y * scale);
      const rotation = state.rotation * Math.PI / 180, cosine = Math.cos(rotation), sine = Math.sin(rotation);
      context.rotate(rotation);
      if (pass.kind === 'line') {
        const packColor = this.skin?.resourcePack?.perfectColor;
        const usePackColor = packColor && (!runtime.line.Texture || runtime.line.Texture === 'line.png') && !runtime.line.attachUI && !runtime.line.extended?.textEvents?.length && !runtime.line.extended?.colorEvents?.length;
        this.drawLine(context, runtime.line, { ...state, ...(usePackColor ? {color:packColor.rgb,alpha:state.alpha*packColor.alpha} : {}), ...(this.forceLineOpacity ? { alpha: 255 } : {}), ...(this.lineTint && index === selectedLine ? { color: [0, 200, 0] } : {}) }, scale);
      }
      else for (const entry of visibleNotes.get(index)) {
        const note = entry.note;
        if ((note.type === 2) !== (pass.kind === 'hold')) continue;
        const position = previewNotePosition(runtime.noteState(entry, state, seconds), runtime.line, positionScale);
        if (position.alpha <= 0 || position.size === 0) continue;
        const highlight = this.highlight !== false && this.noteDraft.simultaneous(entry, this.simultaneous, this.simultaneousCounts);
        const textureScale = this.skin?.noteScale?.(highlight) ?? 1;
        const baseNoteWidth = this.noteSize * scale * position.size, baseHeightWidth = this.noteSize * scale * position.sizeY;
        const noteWidth = baseNoteWidth * textureScale, heightWidth = baseHeightWidth * textureScale;
        const horizontal = position.x * scale;
        const worldX = state.x + position.x * cosine + position.y * sine;
        const worldY = -state.y + position.x * sine - position.y * cosine;
        const screenX = originX + worldX * scale;
        const screenY = originY + worldY * scale;
        const tail = note.type === 2 && Number.isFinite(position.tail) ? position.tail : position.y;
        const tailWorldX = state.x + position.x * cosine + tail * sine;
        const tailWorldY = -state.y + position.x * sine - tail * cosine;
        const tailX = originX + tailWorldX * scale, tailY = originY + tailWorldY * scale;
        if (cullNotes) {
          const aspectKey = note.type * 2 + Number(highlight);
          let aspect = noteAspects.get(aspectKey);
          if (aspect === undefined) { const image = this.skin?.noteImage?.(note.type, Boolean(aspectKey % 2)); aspect = image ? (image.naturalHeight ?? image.height) / (image.naturalWidth ?? image.width) : note.type === 2 ? 1 : 0.12; noteAspects.set(aspectKey, aspect); }
          // Enclose head, hold caps and skew conservatively; only discard fully off-capture objects.
          const padding = Math.max(12, Math.abs(noteWidth) + Math.abs(heightWidth) * aspect * (1 + Math.abs(Math.tan(position.skew * Math.PI / 180))));
          if (Math.max(screenX, tailX) + padding < viewport.left || Math.min(screenX, tailX) - padding > viewport.left + viewport.width ||
              Math.max(screenY, tailY) + padding < viewport.top || Math.min(screenY, tailY) - padding > viewport.top + viewport.height) continue;
        }
        const hitArea={ lineIndex: index, noteIndex: entry.index, type:note.type, x1: screenX, y1: screenY, x2: tailX, y2: tailY, radius: Math.max(12, noteWidth * 0.65) };
        if(this.collisionGeometry){
          const outline=this.skin?.noteImage?.(note.type,highlight);
          const aspect=outline?(outline.naturalHeight??outline.height)/(outline.naturalWidth??outline.width):0.12;
          const halfHeight=Math.max(this.skin?.resourcePack?0:2.5,Math.abs(heightWidth)*aspect/2);const cosine=Math.cos(rotation),sine=Math.sin(rotation),skew=Math.tan(position.skew*Math.PI/180);
          Object.assign(hitArea,{collisionWidth:Math.abs(noteWidth),collisionHeight:halfHeight*2,rotation,polygon:note.type===2?null:[[-noteWidth/2,-halfHeight],[noteWidth/2,-halfHeight],[noteWidth/2,halfHeight],[-noteWidth/2,halfHeight]].map(([dx,dy])=>({x:screenX+(dx+dy*skew)*cosine-dy*sine,y:screenY+(dx+dy*skew)*sine+dy*cosine}))});
        }
        this.noteHitAreas.push(hitArea);
        if (collectCenters) collectCenters.set(entry.index, hitArea);
        context.save();
        context.globalAlpha = clamp(position.alpha) * noteOpacity;
        const tint = note.tint ?? note.color;
        context.fillStyle = Array.isArray(tint) ? `rgb(${tint.join(',')})` : NOTE_COLORS[note.type];
        let drawnHold = false;
        if (note.type === 2) drawnHold = this.skin?.hold(context, horizontal, -position.y * scale, -position.tail * scale, baseNoteWidth, highlight, position.showHead, tint, baseHeightWidth, noteIsAbove(note) ? 1 : -1);
        if (note.type === 2 && !drawnHold) {
          context.globalAlpha *= 0.55;
          context.fillRect(horizontal - noteWidth / 2, -position.tail * scale, noteWidth, (position.tail - position.y) * scale);
          context.globalAlpha = clamp(position.alpha) * noteOpacity;
        }
        if (position.showHead && !drawnHold) {
          context.translate(horizontal, -position.y * scale);
          context.transform(1, 0, Math.tan(position.skew * Math.PI / 180), 1, 0, 0);
          if (!this.skin?.head(context, note.type, 0, 0, baseNoteWidth, highlight, tint, 5, baseHeightWidth)) context.fillRect(-noteWidth / 2, -2, noteWidth, 4);
        }
        context.restore();
      }
      context.restore();
    } };
    for (const pass of this.passes) {
      const compatible = !this.noteBatch.failed && this.skin?.noteBatchCompatible;
      const dense = compatible && (pass.kind === 'hold' ? holdCount > 512 && holdBatchWithinBudget(visibleNotes, states, seconds, this.noteSize, scale, width, height, this.skin) : pass.kind === 'note' && noteCount > 512);
      const firstHit = this.noteHitAreas.length;
      let batched = false;
      try {
        const target = dense ? this.noteBatch.begin(context, width, height, this.skin) : null;
        if (target) { drawPass(target, pass); batched = this.noteBatch.end(); }
      } catch { this.noteBatch.failed = true; }
      if (!batched) { this.noteHitAreas.length = firstHit; drawPass(context, pass); }
    }
    if (this.showHitEffects) this.drawHits(context, seconds, order, originX, originY, scale, positionScale, renderViewport, width, height);
  }

  drawHits(context, seconds, order, originX, originY, scale, positionScale, renderViewport, width, height, allowBatch = true) {
    const buckets = order.map(index => {
      const runtime = this.noteDraft.runtime(this.scene, index), lifetime = this.skin?.hitLifetime ?? Math.max(HIT_DURATION, 2 / 3);
      return [index, runtime ? runtime.previewHits ? runtime.previewHits(seconds, this.effectsSince, lifetime) : recentHits(runtime, seconds, this.effectsSince, lifetime) : []];
    });
    const target = allowBatch && this.skin?.hitBatchCompatible && buckets.reduce((total, bucket) => total + bucket[1].length, 0) > 128 ? this.hitBatch.begin(context, width, height, this.skin) ?? context : context;
    try {
      const hitStates = new Map();
      this.hitGeometry.begin(this.scene, positionScale);
      for (const [index, hits] of buckets) {
        const runtime = this.scene.lines[index];
        if (!runtime) continue;
        for (const hit of hits) {
          const { entry, time, seed } = hit;
          const geometry = this.hitGeometry.sample(entry, time, () => {
            if (!hitStates.has(time)) hitStates.set(time, this.scene.sampler(time, positionScale));
            const state = hitStates.get(time)(index), position = previewNotePosition(runtime.noteState(entry, state, time), runtime.line, positionScale), angle = state.rotation * Math.PI / 180;
            return { x: state.x + position.x * Math.cos(angle) + position.y * Math.sin(angle), y: -state.y + position.x * Math.sin(angle) - position.y * Math.cos(angle), angle };
          });
          const horizontal = originX + geometry.x * scale, vertical = originY + geometry.y * scale, angle = geometry.angle;
          const size = this.noteSize * 1.4 * scale;
          const radius = this.skin?.hitRadius?.(size) ?? (this.skin?.drawHit ? Infinity : size * 2);
          if (horizontal + radius < renderViewport.left || horizontal - radius > renderViewport.left + renderViewport.width || vertical + radius < renderViewport.top || vertical - radius > renderViewport.top + renderViewport.height) continue;
          if (this.skin?.drawHit?.(target, { age: seconds-time, x: horizontal, y: vertical, size, rotation: angle, color:entry.note.tintHitEffects, seed:index*65537+seed })) continue;
          const frame = hitFrame(seconds - time);
          const picture = frame === null ? null : this.skin?.tinted(`img-${frame}`, entry.note.tintHitEffects ?? [255, 236, 160]);
          if (picture) target.drawImage(picture, horizontal - size / 2, vertical - size / 2, size, size);
          target.fillStyle = `rgb(${(entry.note.tintHitEffects ?? [255, 236, 160]).join(',')})`;
          for (const particle of hitParticles(seconds - time, index * 65537 + seed, this.noteSize * scale)) {
            target.globalAlpha = particle.alpha;
            target.fillRect(horizontal + particle.x - particle.radius, vertical + particle.y - particle.radius, particle.radius * 2, particle.radius * 2);
          }
          target.globalAlpha = 1;
        }
      }
      this.hitGeometry.end();
      if (target !== context && !this.hitBatch.end()) this.drawHits(context, seconds, order, originX, originY, scale, positionScale, renderViewport, width, height, false);
    } catch (error) {
      if (target === context) throw error;
      this.hitBatch.failed = true; this.drawHits(context, seconds, order, originX, originY, scale, positionScale, renderViewport, width, height, false);
    }
  }

  pick(clientX, clientY) {
    if (!this.visible || !this.pickPreviewLines || !this.viewport) return null;
    const rectangle = this.canvas.getBoundingClientRect();
    const point = { x: clientX - rectangle.left, y: clientY - rectangle.top };
    const view = this.viewport;
    if (point.x < view.left || point.x > view.left + view.width || point.y < view.top || point.y > view.top + view.height) return null;
    return pickGuide(this.guides ?? [], point, this.selectedLine);
  }

  pickLines(clientX, clientY) {
    if (!this.visible || !this.pickPreviewLines || !this.viewport) return [];
    const rectangle = this.canvas.getBoundingClientRect(), point = { x: clientX - rectangle.left, y: clientY - rectangle.top }, view = this.viewport;
    if (point.x < view.left || point.x > view.left + view.width || point.y < view.top || point.y > view.top + view.height) return [];
    return sortedGuideMatches(this.guides ?? [], point);
  }

  pickNoiseArea(clientX, clientY) {
    if (!this.visible || this.pickPreviewNoiseAreas === false || !this.viewport) return null;
    const rectangle = this.canvas.getBoundingClientRect();
    const point = { x: clientX - rectangle.left, y: clientY - rectangle.top };
    const view = this.viewport;
    if (point.x < view.left || point.x > view.left + view.width || point.y < view.top || point.y > view.top + view.height) return null;
    return this.noisePreview.pick(point.x, point.y);
  }

  pickNote(clientX, clientY) {
    return this.pickNoteTarget(clientX, clientY)?.lineIndex ?? null;
  }

  pickNoteTarget(clientX, clientY) {
    if (!this.visible || !this.noteHitAreas?.length) return null;
    const rectangle = this.canvas.getBoundingClientRect();
    const point = { x: clientX - rectangle.left, y: clientY - rectangle.top };
    const distanceToSegment = area => {
      const dx = area.x2 - area.x1; const dy = area.y2 - area.y1;
      const length = dx * dx + dy * dy;
      const amount = length ? Math.max(0, Math.min(1, ((point.x - area.x1) * dx + (point.y - area.y1) * dy) / length)) : 0;
      return Math.hypot(point.x - (area.x1 + amount * dx), point.y - (area.y1 + amount * dy));
    };
    const view = this.viewport;
    if (view && (point.x < view.left || point.x > view.left + view.width || point.y < view.top || point.y > view.top + view.height)) return null;
    const area = this.noteHitAreas.slice().reverse().find(area => distanceToSegment(area) <= area.radius);
    return area ? { lineIndex: area.lineIndex, noteIndex: area.noteIndex } : null;
  }

  drawGuides(context, scale, selectedLine) {
    if (!this.lineNumbers && !this.lineArrows) return;
    if (this.guideChart !== this.chart || this.guideScale !== scale) { this.guideTextCache.clear(); this.guideChart = this.chart; this.guideScale = scale; }
    const matrix = context.getTransform?.(), bounded = matrix && Number.isFinite(matrix.a) && context.canvas?.width > 0 && context.canvas?.height > 0 &&
      !context.shadowBlur && !context.shadowOffsetX && !context.shadowOffsetY && (!context.filter || context.filter === 'none');
    context.save();
    if (this.lineNumbers) { context.font = `${30 * scale}px RPEGame, sans-serif`; context.textAlign = 'center'; context.textBaseline = 'top'; }
    for (const group of mergeGuides(this.guides, scale, this.mergeLineNumbers)) {
      const selected = group.indices.includes(selectedLine);
      if (!this.lineNumbers && !(this.lineArrows && selected)) continue;
      let label;
      if (this.lineNumbers) {
        const key = group.indices.join(','); label = this.guideTextCache.get(key);
        if (!label || bounded && !label.measured) {
          const text = formatLineNumbers(group.indices, this.chart.judgeLineList), metrics = bounded ? context.measureText(text) : null, fontSize = 30 * scale;
          label = { text, measured: Boolean(bounded), left: -Math.max(metrics?.width / 2 || 0, metrics?.actualBoundingBoxLeft || 0) - 2, right: Math.max(metrics?.width / 2 || 0, metrics?.actualBoundingBoxRight || 0) + 2,
            top: 4 * scale - Math.max(fontSize, metrics?.actualBoundingBoxAscent || 0) - 2, bottom: 4 * scale + Math.max(fontSize * 2, metrics?.actualBoundingBoxDescent || 0) + 2 };
          if (this.guideTextCache.size >= 2048) this.guideTextCache.delete(this.guideTextCache.keys().next().value);
          this.guideTextCache.set(key, label);
        }
      }
      const angle = group.rotation * Math.PI / 180;
      if (bounded) {
        const arrow = this.lineArrows && selected ? 50 * scale : 0, left = Math.min(label?.left ?? 0, -arrow), right = Math.max(label?.right ?? 0, arrow), top = Math.min(label?.top ?? 0, -arrow), bottom = Math.max(label?.bottom ?? 0, arrow);
        const cosine = Math.cos(angle), sine = Math.sin(angle), a = matrix.a * cosine + matrix.c * sine, b = matrix.b * cosine + matrix.d * sine,
          c = matrix.c * cosine - matrix.a * sine, d = matrix.d * cosine - matrix.b * sine, x = matrix.a * group.x + matrix.c * group.y + matrix.e, y = matrix.b * group.x + matrix.d * group.y + matrix.f;
        if (x + Math.max(left * a, right * a) + Math.max(top * c, bottom * c) < -1 || x + Math.min(left * a, right * a) + Math.min(top * c, bottom * c) > context.canvas.width + 1 ||
            y + Math.max(left * b, right * b) + Math.max(top * d, bottom * d) < -1 || y + Math.min(left * b, right * b) + Math.min(top * d, bottom * d) > context.canvas.height + 1) continue;
      }
      context.save(); context.translate(group.x, group.y); context.rotate(angle);
      context.fillStyle = selected ? '#00c800' : '#fff';
      if (this.lineNumbers) {
        context.fillText(label.text, 0, 4 * scale);
      }
      if (this.lineArrows && selected) {
        const arrow = this.skin?.images.get('Arrow2');
        if (arrow) {
          context.save(); context.rotate(Math.PI); context.drawImage(arrow, -25 * scale, -25 * scale, 50 * scale, 50 * scale); context.restore();
        } else {
          context.beginPath(); context.moveTo(0, -24 * scale); context.lineTo(-12 * scale, -8 * scale); context.lineTo(12 * scale, -8 * scale); context.closePath(); context.fill();
        }
      }
      context.restore();
    }
    context.restore();
  }

  drawLine(context, line, state, scale) {
    const anchor = line.anchor ?? [0.5, 0.5];
    context.save();
    context.scale(state.scaleX, state.scaleY);
    context.globalAlpha = clamp(state.alpha / 255);
    context.fillStyle = `rgb(${state.color.map(value => Math.round(Math.max(0, Math.min(255, value)))).join(',')})`;
    if (line.extended?.textEvents?.length) {
      context.font = `${52 * scale}px RPE, sans-serif`;
      context.textAlign = 'left'; context.textBaseline = 'alphabetic';
      const layout = this.lineTextLayout(state.text, context);
      context.font = `${52 * scale}px RPE, sans-serif`;
      const left = -layout.width * anchor[0] * scale, top = -layout.height * (1 - anchor[1]) * scale;
      layout.lines.forEach((text, index) => context.fillText(text, left, top + (layout.ascent + index * layout.lineHeight) * scale));
    } else {
      const defaultLine = !line.Texture || line.Texture === 'line.png';
      const descriptor = !defaultLine ? this.images?.describe?.(line.Texture) : null;
      const stateScale = scale * Math.max(Math.abs(state.scaleX), Math.abs(state.scaleY)) * (devicePixelRatio || 1);
      const maxViewportScale = descriptor?.naturalWidth && descriptor?.naturalHeight
        ? Math.min(2700 / descriptor.naturalWidth, 1800 / descriptor.naturalHeight)
        : Infinity;
      const decodeCap = Number.isFinite(maxViewportScale) && maxViewportScale < 1
        ? 2 ** Math.floor(Math.log2(Math.max(1 / 64, maxViewportScale)))
        : 1;
      const viewportScale = Math.min(stateScale, decodeCap);
      const rawTexture = defaultLine ? null : this.images?.texture ? this.images.texture(line.Texture, viewportScale) : this.images?.images.get(line.Texture);
      const source = rawTexture?.source ?? rawTexture;
      const texture = defaultLine ? this.skin?.tinted('line', state.color) : this.skin?.tintedSource(`line:${line.Texture}`, source, state.color);
      if (defaultLine) {
        const height = DEFAULT_LINE_HEIGHT * this.lineScale * scale;
        const left = -DEFAULT_LINE_WIDTH * scale * anchor[0], top = -height * (1 - anchor[1]);
        if (texture) context.drawImage(texture, left, top, DEFAULT_LINE_WIDTH * scale, height);
        else context.fillRect(left, top, DEFAULT_LINE_WIDTH * scale, height);
      } else if (texture && rawTexture) {
        const width = rawTexture.naturalWidth ?? rawTexture.width; const height = rawTexture.naturalHeight ?? rawTexture.height;
        context.drawImage(texture, -width * anchor[0] * scale, -height * (1 - anchor[1]) * scale, width * scale, height * scale);
      }
    }
    context.restore();
  }

  lineTextLayout(value, fallbackContext) {
    const text = String(value ?? '');
    if (!this.lineTextLayouts.has(text)) {
      this.lineTextMeasure ??= typeof document === 'undefined' ? fallbackContext : document.createElement('canvas').getContext('2d');
      const context = this.lineTextMeasure;
      context.font = '52px RPE, sans-serif'; context.textAlign = 'left'; context.textBaseline = 'alphabetic';
      const lines = text.split(/\r?\n/), metrics = lines.map(line => context.measureText(line));
      const ascent = metrics.reduce((maximum, metric) => Math.max(maximum, metric?.fontBoundingBoxAscent ?? metric?.actualBoundingBoxAscent ?? 41.6), 0);
      const descent = metrics.reduce((maximum, metric) => Math.max(maximum, metric?.fontBoundingBoxDescent ?? metric?.actualBoundingBoxDescent ?? 10.4), 0);
      const lineHeight = Math.max(1, ascent + descent);
      if (this.lineTextLayouts.size >= 128) this.lineTextLayouts.delete(this.lineTextLayouts.keys().next().value);
      this.lineTextLayouts.set(text, { lines, width: metrics.reduce((maximum, metric) => Math.max(maximum, metric?.width ?? 0), 0), height: lineHeight * lines.length, lineHeight, ascent });
    }
    return this.lineTextLayouts.get(text);
  }
}
