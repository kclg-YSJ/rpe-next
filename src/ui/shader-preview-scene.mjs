import { Preview } from './preview.mjs';
import { LargeChartView } from './large-chart-view.mjs';
import { attachRenderExtensions } from './render-extensions.mjs';
import { largeChartCommand } from '../platform/native.mjs';
import { previewPositionScale } from '../core/editor-display.mjs';
import { SHADER_PREVIEW_DRAFT, shaderPreviewKey, shaderPreviewPasses } from '../core/shader-preview.mjs';

// A private, silent scene clock. It shares immutable chart/skin resources, never
// the editor's renderer, playhead, audio, hit history or large-chart read window.
export class ShaderPreviewScene {
  constructor(invalidate, report) {
    this.invalidate = invalidate; this.report = report; this.targets = new Set(); this.parameters = {};
    this.imageLoads = new WeakSet();
    this.canvas = document.createElement('canvas'); this.output = document.createElement('canvas');
    this.width = 960; this.height = 540;
    this.canvas.getBoundingClientRect = () => { const ratio = globalThis.devicePixelRatio || 1; return { left: 0, top: 0, width: this.width / ratio, height: this.height / ratio }; };
    this.preview = new Preview(this.canvas); this.preview.visible = true;
    this.preview.invalidate = () => { if (!this.disposed) invalidate(); };
    this.preview.shaderRuntime.report = message => report(message);
    this.preview.noisePreview.invalidate = this.preview.invalidate; this.preview.noisePreview.report = message => report(message);
    this.preview.noisePreview.getAssets = () => this.context?.assets;
    const runtime = this.preview.shaderRuntime, active = runtime.active.bind(runtime), source = runtime.source.bind(runtime);
    runtime.source = (name, reference) => name === SHADER_PREVIEW_DRAFT ? this.source : source(name, reference);
    runtime.active = seconds => {
      const matches = effect => this.path ? runtime.path(effect.sourceName) === this.path : this.targets.has(shaderPreviewKey(effect));
      const result = shaderPreviewPasses(active(seconds), matches, this.defaults, this.parameters); this.values = result.values; return result.effects;
    };
    try { this.releaseExtensions = attachRenderExtensions(this.preview, 'preview'); }
    catch (error) { this.preview.dispose(); throw error; }
  }
  configure(source, { path = null, targets, defaults, parameters } = {}) {
    this.source = source; this.path = path; this.targets = targets ?? new Set(); this.defaults = defaults ?? {}; this.parameters = parameters ?? {};
  }
  async readWindow(seconds, document, revision) {
    const key = `${revision}:${seconds}`;
    if (this.pending || this.failed === key) return;
    this.pending = true;
    try {
      const states = this.preview.scene.sample(seconds), scale = previewPositionScale(this.preview.aspectRatio ?? 1.5);
      let maximum = 0; for (const state of states) maximum = Math.max(maximum, Math.hypot(state.x, state.y));
      const radius = Math.min(20000, (2000 * Math.max(1, this.preview.viewDivisor ?? 1) + maximum) / scale.y);
      let span = .5, value;
      for (;;) {
        try { value = await largeChartCommand('window', document.summary.id, { seconds, span, radius, historySpan: .75 }); break; }
        catch (error) { if (!/不同音符组超过/.test(error.message) || span < .025) throw error; span /= 2; }
      }
      if (!this.disposed && !document.disposed && document.revision === revision && this.document === document) { this.largeView.set(value); this.failed = null; }
    } catch (error) { if (!this.disposed) { this.failed = key; this.report(error.message); } }
    finally { this.pending = false; if (!this.disposed) this.invalidate(); }
  }
  draw(context, seconds, { refresh = false } = {}) {
    if (this.disposed || !this.source) return null;
    this.context = context;
    const original = context.preview, preview = this.preview;
    for (const key of ['aspectRatio', 'noteSize', 'lineScale', 'backgroundAlpha', 'backgroundBlur', 'viewDivisor', 'highlight', 'duration', 'showGameUI', 'showHitEffects', 'noteOpacity', 'showTap', 'showHold', 'showDrag', 'showFlick']) if (original[key] !== undefined) preview[key] = original[key];
    preview.skin = context.skin; preview.images = context.images; preview.allLines = original.allLines;
    preview.applyShaders = true; preview.viewportOverflow = false; preview.lineNumbers = false; preview.lineArrows = false; preview.lineTint = false; preview.selectedNoiseArea = -1; preview.effectsSince = -Infinity;
    for (const key of ['seamless', 'forceSimple', 'hiddenLayers', 'simpleLayers']) preview.noisePreview[key] = original.noisePreview[key];
    const aspect = Number.isFinite(preview.aspectRatio) && preview.aspectRatio > 0 ? preview.aspectRatio : 1.5;
    this.width = Math.max(1, Math.round(aspect >= 1 ? 960 : 960 * aspect));
    this.height = Math.max(1, Math.round(aspect >= 1 ? 960 / aspect : 960));
    const document = context.session.largeDocument;
    if (document !== this.document) {
      this.largeView?.dispose(); this.largeView = document ? new LargeChartView(document) : null; this.document = document; preview.largeChartView = this.largeView;
    }
    if (refresh || this.lastSeconds != null && (seconds < this.lastSeconds || seconds - this.lastSeconds > .25)) preview.noisePreview.gpu?.reset();
    this.lastSeconds = seconds;
    if (document) {
      this.largeView.prepare(preview, context.chart, context.tempo);
      if (this.largeRevision !== document.revision || refresh) { this.largeRevision = document.revision; this.largeView.set(null); this.failed = null; }
      if (!this.largeView.contains(seconds)) { void this.readWindow(seconds, document, document.revision); return null; }
    }
    preview.draw(context.chart, context.tempo, seconds, context.session.lineIndex);
    for (const record of context.images.records.values()) if (record.pending && !this.imageLoads.has(record.pending)) {
      this.imageLoads.add(record.pending); record.pending.then(() => { if (!this.disposed) this.invalidate(); });
    }
    if (this.output.width !== this.canvas.width || this.output.height !== this.canvas.height) { this.output.width = this.canvas.width; this.output.height = this.canvas.height; }
    const c = this.output.getContext('2d'); c.clearRect(0, 0, this.output.width, this.output.height); c.drawImage(this.canvas, 0, 0);
    for (const layer of [preview.shaderCanvas, preview.overlayCanvas]) if (layer?.style.visibility === 'visible') c.drawImage(layer, 0, 0);
    return this.output;
  }
  dispose() {
    this.disposed = true;
    try { this.releaseExtensions?.(); }
    finally { this.largeView?.dispose(); this.preview.dispose(); this.canvas.width = this.canvas.height = this.output.width = this.output.height = 1; this.context = null; }
  }
}
