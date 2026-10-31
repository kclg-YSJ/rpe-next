import { PerformanceSeries, PerformanceRun, PerformanceFrameWindow } from '../core/performance-monitor.mjs';
import { t } from '../i18n.mjs';
import { localPreferences } from '../platform/local-preferences.mjs';

const number = (value, digits = 1) => Number.isFinite(value) ? value.toFixed(digits) : '—';
const memory = value => !Number.isFinite(value) ? '—' : value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(2)} GB` : `${(value / 1024 ** 2).toFixed(0)} MB`;
const percent = value => Number.isFinite(value) ? `${number(value)}%` : '—';
const css = `
:host{position:fixed;inset:12px auto auto 12px;margin:0;padding:0;border:0;background:transparent;color:#edf3fa;z-index:2147483647;font:12px/1.4 system-ui,sans-serif;font-variant-numeric:tabular-nums;max-width:calc(100vw - 24px);max-height:calc(100dvh - 24px);overflow:visible;color-scheme:dark}
*{box-sizing:border-box}.panel{width:286px;max-width:calc(100vw - 24px);padding:13px 14px;border:1px solid #7c96b43d;border-radius:10px;background:#101722e8;box-shadow:0 7px 26px #0005;overflow:auto;max-height:calc(100dvh - 24px)}
header{display:flex;align-items:center;justify-content:space-between;gap:10px;cursor:move;user-select:none}header span{font-size:11px;color:#aebcd0;letter-spacing:.07em}button{font:inherit;cursor:pointer;border:1px solid #7795b94d;border-radius:5px;background:#8baac318;color:#e8f1ff;padding:6px 9px}button:hover{background:#7193b438}button:disabled{opacity:.4;cursor:default}.close{padding:0;border:0;background:none;font-size:19px;line-height:20px;color:#a6b9cf}h1{font-size:35px;font-weight:650;margin:4px 0 0;line-height:1.2;letter-spacing:-.05em}h1 small{font-size:11px;letter-spacing:.05em;margin-left:7px;color:#8fa6bf}canvas{display:block;width:100%;height:58px;margin:7px 0}.meta{display:flex;justify-content:space-between;font-size:10px;color:#9dafc4;margin-top:-3px}.metrics{display:grid;grid-template-columns:1fr 1fr;gap:10px 18px;margin:13px 0}.metric small{display:block;color:#8fa4bd;font-size:10px}.metric strong{font-size:14px;font-weight:500;white-space:nowrap}meter{display:block;height:3px;width:100%;margin-top:4px;appearance:none;background:#768ca321;border:0;border-radius:2px}meter::-webkit-meter-bar{background:#768ca321;border:0;height:3px}meter::-webkit-meter-optimum-value{background:#68cead}.actions{display:flex;gap:7px;margin-top:10px}.actions .run{flex:1;background:#397a6855;border-color:#67cba47a}.actions .run[data-running=true]{background:#a94f4155;border-color:#da8a727a}.progress{color:#94abc5;font-size:10px;margin-top:6px;text-align:right;min-height:14px}.result{border-top:1px solid #8aa2bb30;margin-top:11px;padding-top:10px}.result h2{font-size:12px;font-weight:500;margin:0 0 6px;display:flex;justify-content:space-between;gap:7px}.result h2 small{font-size:10px;color:#8fa4bd}.result .metrics{gap:8px 14px;margin:8px 0}.result .metric strong{font-size:13px}.result canvas{height:64px}.error{color:#ffbdac;font-size:11px;margin-top:7px}[hidden]{display:none!important}
`;

export class PerformanceMonitor {
  constructor({ state, startPlayback, stopPlayback, notify, hardware = globalThis.rpenPerformance, now = () => performance.now() }) {
    Object.assign(this, { state, startPlayback, stopPlayback, notify, hardware, now });
    this.enabled = false; this.generation = 0; this.series = new PerformanceSeries(); this.hardwareValue = {};
    this.frameWindow = new PerformanceFrameWindow();
    this.run = null; this.result = null; this.started = false;
  }
  mount() {
    if (this.host) return;
    this.host = document.createElement('div'); this.host.id = 'performance-monitor'; this.host.setAttribute('popover', 'manual');
    const shadow = this.host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>${css}</style><section class="panel" aria-label="${t('perf.title')}"><header><span>${t('perf.title')}</span><button class="close" title="${t('perf.close')}">×</button></header><h1><b>—</b><small>FPS</small></h1><canvas class="graph"></canvas><div class="meta"><span class="frame-time">— ms</span><span class="render-time">— ms</span></div><div class="metrics live"></div><div class="actions"><button class="run">${t('perf.start')}</button><button class="overview" hidden>${t('perf.overview')}</button></div><div class="progress"></div><div class="error" hidden></div><section class="result" hidden></section></section>`;
    this.root = shadow; this.fpsText = shadow.querySelector('h1 b'); this.canvas = shadow.querySelector('canvas');
    this.runButton = shadow.querySelector('.run'); this.errorText = shadow.querySelector('.error');
    this.liveRows = new Map();
    for (const [key, label] of [['appCpu', t('perf.appCpu')], ['systemCpu', t('perf.systemCpu')], ['appMemory', t('perf.appMemory')], ['systemMemory', t('perf.systemMemory')], ['gpu', 'GPU'], ['gpuMemory', t('perf.gpuMemory')], ['heap', 'JS Heap'], ['render', t('perf.render')]]) {
      const row = document.createElement('div'); row.className = 'metric';
      const name = document.createElement('small'); name.textContent = label; const value = document.createElement('strong'); value.textContent = '—'; row.append(name, value);
      let bar;
      if (['appCpu', 'systemCpu', 'gpu', 'systemMemory'].includes(key)) { bar = document.createElement('meter'); bar.min = 0; bar.max = 100; bar.value = 0; row.append(bar); }
      shadow.querySelector('.live').append(row); this.liveRows.set(key, { value, bar, name });
    }
    shadow.querySelector('.close').onclick = () => this.setEnabled(false);
    this.runButton.onclick = () => this.run || this.starting ? this.finish('interrupted') : this.start();
    shadow.querySelector('.overview').onclick = () => { const result = shadow.querySelector('.result'); result.hidden = !result.hidden; };
    let drag;
    const header = shadow.querySelector('header');
    header.onpointerdown = event => { if (event.target.closest('button')) return; const rect = this.host.getBoundingClientRect(); drag = { x: event.clientX - rect.left, y: event.clientY - rect.top }; header.setPointerCapture(event.pointerId); };
    header.onpointermove = event => { if (!drag) return; const x = Math.max(0, Math.min(innerWidth - this.host.offsetWidth, event.clientX - drag.x)), y = Math.max(0, Math.min(innerHeight - 40, event.clientY - drag.y)); this.host.style.left = x + 'px'; this.host.style.top = y + 'px'; };
    header.onpointerup = header.onlostpointercapture = () => { if (drag) this.savePosition(); drag = null; };
    document.body.append(this.host);
    try { const point = JSON.parse(localPreferences.getItem('rpe-next-performance-position') ?? 'null'); if (Number.isFinite(point?.x) && Number.isFinite(point?.y)) { this.host.style.left = point.x + 'px'; this.host.style.top = point.y + 'px'; } } catch {}
  }
  savePosition() { if (!this.host) return; const point = this.host.getBoundingClientRect(); try { localPreferences.setItem('rpe-next-performance-position', JSON.stringify({ x: point.left, y: point.top })); } catch {} }
  bringToFront(dialog) {
    const parent = dialog?.open ? dialog : [...document.querySelectorAll('dialog[open]')].at(-1) ?? document.body;
    if (this.host.matches(':popover-open')) this.host.hidePopover();
    if (this.host.parentElement !== parent) parent.append(this.host);
    this.host.showPopover();
  }
  clampPosition() {
    if (!this.host) return;
    const rect = this.host.getBoundingClientRect(), left = Math.max(0, Math.min(Math.max(0, innerWidth - rect.width), rect.left)), top = Math.max(0, Math.min(Math.max(0, innerHeight - rect.height), rect.top));
    if (left !== rect.left) this.host.style.left = left + 'px'; if (top !== rect.top) this.host.style.top = top + 'px';
  }
  toggle() { this.setEnabled(!this.enabled); }
  setEnabled(enabled) {
    if (enabled === this.enabled) return;
    if (!enabled && (this.run || this.starting)) this.finish('interrupted');
    this.enabled = enabled; const generation = ++this.generation;
    if (!enabled) {
      clearInterval(this.displayTimer); clearInterval(this.hardwareTimer); this.displayTimer = this.hardwareTimer = null;
      document.removeEventListener('visibilitychange', this.visibility);
      document.removeEventListener('toggle', this.topLayer, true);
      window.removeEventListener('resize', this.resize); this.savePosition();
      this.hardware?.call('stop').catch(() => {});
      if (this.host?.matches(':popover-open')) this.host.hidePopover(); this.host?.setAttribute('hidden', '');
      this.lastFrame = null; return;
    }
    this.mount(); this.host.hidden = false; this.bringToFront(); this.series.clear();
    this.clampPosition(); this.resize = () => this.clampPosition(); window.addEventListener('resize', this.resize);
    this.lastFrame = null;
    this.frameWindow = new PerformanceFrameWindow();
    this.visibility = () => { if (document.hidden) { if (this.run || this.starting) this.finish('interrupted'); this.hardware?.call('stop').catch(() => {}); } else { this.frameWindow = new PerformanceFrameWindow(); this.readHardware(generation, true); } };
    document.addEventListener('visibilitychange', this.visibility);
    this.topLayer = event => { if (event.target instanceof HTMLDialogElement && this.enabled) this.bringToFront(event.target); };
    document.addEventListener('toggle', this.topLayer, true);
    this.displayTimer = setInterval(() => this.refresh(), 250);
    this.hardwareTimer = setInterval(() => { if (!document.hidden) this.readHardware(generation); }, 1000);
    this.readHardware(generation, true); this.refresh();
  }
  async readHardware(generation, first = false) {
    if (!this.enabled || this.reading) return;
    this.reading = true;
    try {
      let values = this.hardware ? await this.hardware.call(first ? 'start' : 'sample') : {};
      if (generation !== this.generation || !this.enabled) return;
      values = { ...values };
      if (performance.memory) values.heap = performance.memory.usedJSHeapSize;
      this.hardwareValue = values; this.run?.hardware(this.now(), values);
      this.liveRows.get('gpu').name.textContent = values.gpuVendor ? `${values.gpuVendor} GPU` : 'GPU';
      if (this.run && values.gpuVendor) this.run.metadata.gpuVendor = values.gpuVendor;
    } catch { if (generation === this.generation) this.hardwareValue = {}; }
    finally { this.reading = false; }
  }
  frame(now, renderMs) {
    this.frameWindow.frame(now, renderMs);
    this.run?.frame(now, renderMs); this.lastFrame = now;
  }
  refresh() {
    if (!this.enabled || document.hidden) return;
    const { fps, render, peak } = this.frameWindow.sample();
    this.fpsText.textContent = number(fps, 0);
    this.root.querySelector('.frame-time').textContent = `${fps ? number(1000 / fps) : '—'} ms`;
    this.root.querySelector('.render-time').textContent = `${t('perf.peak')} ${number(peak)} ms`;
    this.series.push(fps ?? 0); this.drawGraph(this.canvas, this.series);
    for (const [key, row] of this.liveRows) {
      const value = this.hardwareValue[key];
      row.value.textContent = key === 'render' ? `${number(render)} ms` : ['appCpu', 'systemCpu', 'gpu'].includes(key) ? percent(value) : memory(value);
      if (row.bar) { row.bar.value = key === 'systemMemory' ? this.hardwareValue.systemMemoryTotal ? value / this.hardwareValue.systemMemoryTotal * 100 : 0 : value ?? 0; }
    }
    const state = this.state(); this.runButton.disabled = !this.run && !this.starting && !state.canRun;
    if (this.run && this.started && (!state.playing || !state.preview || state.project !== this.run.metadata.project)) this.finish(state.time >= this.run.metadata.duration - .05 ? 'complete' : 'interrupted');
    if (this.run) {
      if (fps !== null) this.run.point(state.time, fps);
      this.root.querySelector('.progress').textContent = `${number(state.time)} / ${number(this.run.metadata.duration)} s`;
    }
  }
  drawGraph(canvas, values, result = false) {
    const width = 258, height = result ? 64 : 58, ratio = Math.min(2, globalThis.devicePixelRatio || 1);
    if (canvas.width !== width * ratio || canvas.height !== height * ratio) { canvas.width = width * ratio; canvas.height = height * ratio; }
    const ctx = canvas.getContext('2d'); ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, width, height);
    const count = values.length; if (!count) return;
    const at = index => values instanceof PerformanceSeries ? values.at(index) : values[index].fps;
    let maximum = 60; for (let i = 0; i < count; i++) maximum = Math.max(maximum, at(i)); maximum *= 1.08;
    ctx.strokeStyle = '#8caac125'; ctx.lineWidth = 1;
    for (const fps of [30, 60, 120]) if (fps < maximum) { const y = height - 2 - fps / maximum * (height - 4); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
    const left = values instanceof PerformanceSeries ? Math.max(0, width - count * width / values.values.length) : 0, step = (width - left) / Math.max(1, count - 1);
    ctx.beginPath(); for (let i = 0; i < count; i++) { const x = left + i * step, y = height - 2 - at(i) / maximum * (height - 4); if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
    ctx.strokeStyle = '#6edbb4'; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.fillStyle = '#8da6bd'; ctx.font = '9px system-ui'; ctx.fillText(String(Math.round(maximum / 1.08)), 2, 10);
  }
  async start() {
    const state = this.state(); if (!this.enabled || !state.canRun || this.run || this.starting) return;
    this.starting = true; const token = this.startToken = (this.startToken ?? 0) + 1;
    this.startState = state;
    this.errorText.hidden = true; this.root.querySelector('.result').hidden = true; this.runButton.textContent = t('perf.stop'); this.runButton.dataset.running = 'true';
    try {
      await this.startPlayback(() => {
        if (!this.enabled || token !== this.startToken) return false;
        this.run = new PerformanceRun(this.now(), { project: state.project, name: state.name, duration: state.duration, rate: state.rate, gpuVendor: this.hardwareValue.gpuVendor });
        this.run.hardware(this.now(), this.hardwareValue); return true;
      });
      if (token === this.startToken && this.run) { this.started = true; this.starting = false; }
    } catch (error) { if (token === this.startToken) { this.errorText.textContent = error.message; this.errorText.hidden = false; this.finish('interrupted'); } }
    finally { if (token === this.startToken) { this.starting = false; if (!this.run) this.updateButton(); } }
  }
  finish(reason = 'interrupted') {
    if (!this.run && !this.starting) return;
    ++this.startToken; this.starting = this.started = false;
    const state = this.state(), run = this.run ?? new PerformanceRun(this.now(), { name: this.startState?.name, duration: this.startState?.duration }); this.run = null;
    if (run) { this.result = run.finish(this.now(), reason, state.time); this.renderResult(); this.notify?.(t(reason === 'complete' ? 'perf.complete' : 'perf.interrupted')); }
    this.stopPlayback(); this.updateButton();
  }
  updateButton() { if (this.runButton) { this.runButton.textContent = t('perf.start'); this.runButton.dataset.running = 'false'; } }
  renderResult() {
    const result = this.result, root = this.root.querySelector('.result'); root.replaceChildren(); root.hidden = false;
    const title = document.createElement('h2'); title.append(t(result.reason === 'complete' ? 'perf.complete' : 'perf.interrupted'));
    const duration = document.createElement('small'); duration.textContent = `${number(result.elapsed / 1000)} s · ${result.frames.toLocaleString()} ${t('perf.frames')}`; title.append(duration); root.append(title);
    const canvas = document.createElement('canvas'); root.append(canvas); this.drawGraph(canvas, result.points, true);
    const grid = document.createElement('div'); grid.className = 'metrics'; root.append(grid);
    const add = (label, value) => { const cell = document.createElement('div'); cell.className = 'metric'; const name = document.createElement('small'); name.textContent = label; const data = document.createElement('strong'); data.textContent = value; cell.append(name, data); grid.append(cell); };
    add(t('perf.averageFps'), number(result.averageFps)); add('1% Low', number(result.lowFps)); add(t('perf.averageRender'), `${number(result.renderAverage)} ms`); add('P95', `${number(result.frameP95)} ms`);
    for (const [key, label] of [['appCpu', t('perf.averageCpu')], ['systemCpu', t('perf.averageSystemCpu')], ['appMemory', t('perf.averageMemory')], ['systemMemory', t('perf.averageSystemMemory')], ['gpu', t('perf.averageGpu')], ['gpuMemory', t('perf.averageGpuMemory')]]) {
      const value = result.metrics[key].average; if (value === null) continue;
      add(key === 'gpu' && result.gpuVendor ? `${result.gpuVendor} · ${label}` : label, ['appCpu', 'systemCpu', 'gpu'].includes(key) ? percent(value) : memory(value));
    }
    this.root.querySelector('.overview').hidden = false;
    this.clampPosition();
  }
}
