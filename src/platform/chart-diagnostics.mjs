import { diagnosticPatch } from './diagnostic-patch.mjs';
import { diagnosticKey } from '../core/chart-diagnostics.mjs';
import { currentLocale } from '../i18n.mjs';
import { resourceReferences } from './files.mjs';
import { chartShaderFiles } from '../core/shader-assets.mjs';
import { shaderUniformSchema } from '../core/shader-uniforms.mjs';

export class ChartDiagnostics extends EventTarget {
  constructor(getContext, workerFactory = () => new Worker(new URL('./chart-diagnostic-worker.mjs', import.meta.url), { type: 'module' })) {
    super(); this.getContext = getContext; this.workerFactory = workerFactory; this.basic = []; this.deep = []; this.target = 'next'; this.serial = 0;
  }
  get issues() { return this.merged ??= [...new Map([...this.basic, ...this.deep].map(issue => [diagnosticKey(issue), issue])).values()]; }
  changed() { this.merged = null; this.dispatchEvent(new Event('change')); }
  update() {
    const context = this.getContext(), key = [context.chart, context.assets, context.assetRevision, context.duration, context.chartName, context.registry?.revision, context.modRevision, context.ratio, this.target, currentLocale().locale];
    if (this.key && key.every((value, i) => value === this.key[i])) return false;
    const first = !this.key; this.key = key; this.context = context; this.token = ++this.serial; this.cancelDeep(false); this.deep = []; this.error = ''; this.pending = true;
    if (!first) this.basic = []; clearTimeout(this.timer); this.timer = setTimeout(() => this.flush(), 180); this.changed(); return true;
  }
  options(deep = false) {
    const c = this.context;
    const media = c.media ?? resourceReferences(c.chart, c.assets, c.chartName ?? '');
    const options = { locale: currentLocale().locale, duration: c.duration, chartName: c.chartName, assetPaths: [...c.assets.keys()], media,
      globalTypes: c.registry ? [...c.registry.types.values()].map(type => ({ id: type.id, source: type.source, columns: type.columns.map(column => Object.fromEntries(['id', 'name', 'valueType', 'min', 'max', 'overlap'].filter(key => column[key] !== undefined).map(key => [key, column[key]]))) })) : undefined,
      activeMods: c.activeMods, ratio: c.ratio, target: this.target };
    const shaders = new Set(chartShaderFiles(c.chart, c.assets, c.chartName));
    options.shaderUniforms = Object.fromEntries([...shaders].filter(path => c.assets.get(path)?.byteLength <= 256 * 1024).map(path => [path, shaderUniformSchema(c.assets.get(path))]));
    if (deep) {
      options.assetTexts = Object.fromEntries([...c.assets].filter(([path]) => shaders.has(path) || /(?:config\.json|\.(?:glsl|vert|frag|fs|fsh))$/i.test(path)).map(([path, bytes]) => [path, new TextDecoder().decode(bytes)]));
      options.customGlobalChecks = c.registry ? [...c.registry.types.values()].flatMap(type => type.columns.filter(column => typeof column.validate === 'function').map(column => ({ type: type.id, column: column.id, source: String(column.validate) }))) : [];
    }
    return options;
  }
  flush() {
    clearTimeout(this.timer); if (!this.context || this.sentToken === this.token || this.workerBusy) return;
    try {
      if (!this.worker) {
        this.worker = this.workerFactory();
        this.worker.onmessage = ({ data }) => { this.workerBusy = false; if (data.token !== this.token) { if (this.pending) this.flush(); return; } this.pending = false; this.error = data.error ?? ''; if (data.result) this.basic = data.result; this.changed(); };
        this.worker.onerror = event => { event.preventDefault?.(); this.error = event.message; this.pending = false; this.workerBusy = false; this.worker.terminate(); this.worker = null; this.sent = null; this.changed(); };
      }
      const chart = this.context.chart, patch = diagnosticPatch(this.sent, chart); this.worker.postMessage({ token: this.token, patch, options: this.options() }); this.sent = chart; this.sentToken = this.token; this.workerBusy = true;
    } catch (error) { this.error = error.message; this.pending = false; this.changed(); }
  }
  async waitBasic() {
    this.update(); if (!this.pending) return this.basic;
    return new Promise(resolve => { const done = () => { if (!this.pending) { this.removeEventListener('change', done); resolve(this.basic); } }; this.addEventListener('change', done); this.flush(); done(); });
  }
  async startDeep() {
    this.update(); if (this.running) { this.cancelDeep(); return; }
    this.running = true; this.deep = []; this.progress = null; this.error = ''; const token = this.token; this.changed();
    await new Promise(resolve => setTimeout(resolve, 0)); if (token !== this.token || !this.running) return;
    try {
      this.deepWorker = this.workerFactory();
      this.deepWorker.onmessage = ({ data }) => {
        if (data.token !== this.token || !this.running) return;
        if (data.progress) { this.progress = data.progress; this.dispatchEvent(new Event('progress')); return; }
        this.running = false; this.error = data.error ?? ''; if (data.result) { this.deep = data.result; this.deepComplete = true; }
        this.deepWorker.terminate(); this.deepWorker = null; this.changed();
      };
      this.deepWorker.onerror = event => { event.preventDefault?.(); this.running = false; this.error = event.message; this.deepWorker.terminate(); this.deepWorker = null; this.changed(); };
      this.deepWorker.postMessage({ token, chart: this.context.chart, deep: true, options: this.options(true) });
    } catch (error) { this.running = false; this.error = error.message; this.changed(); }
  }
  cancelDeep(emit = true) { this.deepWorker?.terminate(); this.deepWorker = null; this.running = false; this.deepComplete = false; this.progress = null; if (emit) this.changed(); }
  reset() { clearTimeout(this.timer); this.worker?.terminate(); this.worker = null; this.workerBusy = false; this.cancelDeep(false); this.sent = null; this.key = null; this.context = null; this.token = ++this.serial; this.basic = []; this.deep = []; this.pending = false; this.error = ''; this.changed(); }
}
