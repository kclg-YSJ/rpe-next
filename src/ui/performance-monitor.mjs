import { PerformanceSeries, PerformanceRun, PerformanceFrameWindow } from '../core/performance-monitor.mjs';
import { t } from '../i18n.mjs';
import { localPreferences } from '../platform/local-preferences.mjs';

const number = (value, digits = 1) => Number.isFinite(value) ? value.toFixed(digits) : '—';
const node = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  if (tag === 'button') element.type = 'button';
  return element;
};
const css = `
:host{position:fixed;inset:12px auto auto 12px;margin:0;padding:0;border:0;background:transparent;color:#0f172a;z-index:2147483647;font:12px/1.45 "Segoe UI",system-ui,sans-serif;font-variant-numeric:tabular-nums;max-width:calc(100vw - 24px);max-height:calc(100dvh - 24px);color-scheme:light}
*{box-sizing:border-box}
.window{width:360px;max-width:calc(100vw - 24px);border:1px solid #cbd5e1;border-radius:10px;background:#fff;box-shadow:0 14px 44px #0f172a38,0 2px 8px #0f172a1a;overflow:hidden}
header{display:flex;align-items:center;gap:8px;height:38px;padding:0 10px;border-bottom:1px solid #e2e8f0;background:#f8fafc;cursor:move;user-select:none;touch-action:none}
header .icon{width:14px;height:14px;border-radius:3px;background:linear-gradient(135deg,#8b5cf6,#6d28d9);box-shadow:inset 0 0 0 1px #ffffff40}
header .title{font-weight:600;font-size:13px;color:#0f172a}
header .status{margin-left:auto;font-size:11px;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
header .close{flex:none;padding:0 3px;border:0;background:none;color:#64748b;font-size:19px;line-height:22px;cursor:pointer}
header .close:hover{color:#0f172a}
.body{padding:12px 14px 13px;max-height:calc(100dvh - 90px);overflow:auto}
.fps-line{display:flex;align-items:baseline;gap:7px;margin:2px 0 8px}
.fps{font-size:42px;line-height:1;font-weight:650;letter-spacing:-.05em;color:#111827}
.fps-unit{font-size:11px;color:#64748b;letter-spacing:.06em}
.frame-note{margin-left:auto;font-size:11px;color:#64748b}
canvas.graph{display:block;width:100%;height:142px;border:1px solid #e2e8f0;border-radius:6px;background:#fff}
.stats{display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;margin:11px 0 2px}
.stat small{display:block;color:#64748b;font-size:10px}
.stat strong{font-size:14px;font-weight:600;color:#111827;white-space:nowrap}
.complexity{margin-top:9px;padding-top:9px;border-top:1px solid #eef2f7;color:#64748b;font-size:11px;display:flex;flex-wrap:wrap;gap:4px 12px}
.complexity b{color:#334155;font-weight:600}
.actions{display:flex;gap:8px;margin-top:11px}
button{font:inherit;cursor:pointer;border:1px solid #cbd5e1;border-radius:6px;background:#fff;color:#0f172a;padding:7px 10px}
button:hover{background:#f8fafc}
button:disabled{opacity:.45;cursor:default}
.run{flex:1;background:#6d28d9;border-color:#6d28d9;color:#fff}
.run:hover{background:#5b21b6}
.run[data-running=true]{background:#dc2626;border-color:#dc2626}
.progress{min-height:14px;margin-top:6px;text-align:right;font-size:10px;color:#64748b}
.result{border-top:1px solid #e2e8f0;margin-top:11px;padding-top:10px}
.result h2{font-size:12px;font-weight:600;margin:0 0 7px;display:flex;justify-content:space-between;gap:8px;color:#0f172a}
.result h2 small{font-size:10px;font-weight:400;color:#64748b}
.result .stats{margin:9px 0}
.result canvas.graph{height:92px;margin-top:7px}
.result .meta-line{margin-top:8px;color:#64748b;font-size:10px}
.error{color:#b91c1c;font-size:11px;margin-top:7px}
[hidden]{display:none!important}
`;

const seriesValues = series => { const values = []; for (let index = 0; index < series.length; index++) values.push(series.at(index)); return values; };
const percentile = (series, fraction) => {
  const values = seriesValues(series).sort((left, right) => left - right);
  if (!values.length) return null;
  return values[Math.min(values.length - 1, Math.floor(values.length * fraction))];
};
const maximum = series => { let value = null; for (let index = 0; index < series.length; index++) { const current = series.at(index); if (value === null || current > value) value = current; } return value; };
const longFrames = series => { let count = 0; for (let index = 0; index < series.length; index++) if (series.at(index) > 1000 / 30) count++; return count; };

export class PerformanceMonitor {
  constructor({ state, startPlayback, stopPlayback, notify, now = () => performance.now() }) {
    Object.assign(this, { state, startPlayback, stopPlayback, notify, now });
    this.enabled = false; this.run = null; this.result = null; this.started = false; this.starting = false;
    this.startToken = 0; this.generation = 0; this.playing = false; this.series = new PerformanceSeries(240); this.intervals = new PerformanceSeries(600);
    this.frameWindow = new PerformanceFrameWindow(); this.lastFrame = null;
  }
  mount() {
    if (this.host) return;
    this.host = document.createElement('div');
    this.host.id = 'performance-monitor';
    this.host.setAttribute('popover', 'manual');
    const shadow = this.host.attachShadow({ mode: 'open' });
    const style = node('style'); style.textContent = css;
    const panel = node('section', 'window'); panel.setAttribute('aria-label', t('perf.title'));
    const header = node('header'); header.title = t('perf.dragHint');
    const title = node('span', 'title', t('perf.title'));
    const status = node('span', 'status');
    const close = node('button', 'close', '×'); close.title = t('perf.close'); close.setAttribute('aria-label', t('perf.close'));
    header.append(node('span', 'icon'), title, status, close);
    panel.append(header);
    const body = node('div', 'body');
    const fpsLine = node('div', 'fps-line');
    this.fpsText = node('strong', 'fps', '—'); this.frameNote = node('span', 'frame-note', `${t('perf.frameTime')} — ms`);
    fpsLine.append(this.fpsText, node('span', 'fps-unit', 'FPS'), this.frameNote);
    this.canvas = node('canvas', 'graph');
    const stats = node('div', 'stats');
    const stat = label => { const cell = node('div', 'stat'); const value = node('strong', '', '—'); cell.append(node('small', '', label), value); stats.append(cell); return value; };
    this.drawText = stat(t('perf.draw'));
    this.p95Text = stat(t('perf.p95'));
    this.longestText = stat(t('perf.longestFrame'));
    this.longText = stat(t('perf.longFrames'));
    this.complexity = node('div', 'complexity');
    const actions = node('div', 'actions');
    this.runButton = node('button', 'run', t('perf.start'));
    this.overviewButton = node('button', 'overview', t('perf.overview')); this.overviewButton.hidden = true;
    actions.append(this.runButton, this.overviewButton);
    this.progress = node('div', 'progress');
    this.errorText = node('div', 'error'); this.errorText.hidden = true;
    this.resultSection = node('section', 'result'); this.resultSection.hidden = true;
    body.append(fpsLine, this.canvas, stats, this.complexity, actions, this.progress, this.errorText, this.resultSection);
    panel.append(body); shadow.append(style, panel);
    this.root = shadow; this.statusText = status;
    close.onclick = () => this.setEnabled(false);
    this.runButton.onclick = () => this.run || this.starting ? this.finish('interrupted') : this.start();
    this.overviewButton.onclick = () => { this.resultSection.hidden = !this.resultSection.hidden; };
    let drag = null;
    header.addEventListener('pointerdown', event => {
      if (event.target.closest('button')) return;
      const rect = this.host.getBoundingClientRect();
      drag = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      header.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    header.addEventListener('pointermove', event => {
      if (!drag) return;
      const width = this.host.offsetWidth || 360, height = this.host.offsetHeight || 240;
      const left = Math.max(0, Math.min(Math.max(0, innerWidth - width), event.clientX - drag.x));
      const top = Math.max(0, Math.min(Math.max(0, innerHeight - 32), event.clientY - drag.y));
      this.host.style.left = `${left}px`; this.host.style.top = `${top}px`;
    });
    const endDrag = () => { if (!drag) return; drag = null; this.savePosition(); };
    header.addEventListener('pointerup', endDrag);
    header.addEventListener('pointercancel', endDrag);
    header.addEventListener('lostpointercapture', endDrag);
    header.addEventListener('dblclick', () => { this.host.style.left = '12px'; this.host.style.top = '12px'; this.savePosition(); });
    document.body.append(this.host);
    try {
      const point = JSON.parse(localPreferences.getItem('rpe-next-performance-position') ?? 'null');
      if (Number.isFinite(point?.x) && Number.isFinite(point?.y)) { this.host.style.left = `${point.x}px`; this.host.style.top = `${point.y}px`; }
    } catch { /* ignore malformed position */ }
  }
  savePosition() {
    if (!this.host) return;
    const rect = this.host.getBoundingClientRect();
    try { localPreferences.setItem('rpe-next-performance-position', JSON.stringify({ x: rect.left, y: rect.top })); } catch { /* storage may be unavailable */ }
  }
  bringToFront(dialog) {
    const parent = dialog?.open ? dialog : [...document.querySelectorAll('dialog[open]')].at(-1) ?? document.body;
    if (this.host.matches(':popover-open')) this.host.hidePopover();
    if (this.host.parentElement !== parent) parent.append(this.host);
    this.host.showPopover();
  }
  clampPosition() {
    if (!this.host) return;
    const rect = this.host.getBoundingClientRect();
    const left = Math.max(0, Math.min(Math.max(0, innerWidth - rect.width), rect.left));
    const top = Math.max(0, Math.min(Math.max(0, innerHeight - rect.height), rect.top));
    if (left !== rect.left) this.host.style.left = `${left}px`;
    if (top !== rect.top) this.host.style.top = `${top}px`;
  }
  toggle() { this.setEnabled(!this.enabled); }
  setEnabled(enabled) {
    if (enabled === this.enabled) return;
    if (!enabled && (this.run || this.starting)) this.finish('interrupted');
    this.enabled = enabled;
    this.generation++;
    if (!enabled) {
      clearInterval(this.displayTimer); this.displayTimer = null;
      document.removeEventListener('visibilitychange', this.visibility);
      document.removeEventListener('toggle', this.topLayer, true);
      window.removeEventListener('resize', this.resize);
      this.savePosition();
      if (this.host?.matches(':popover-open')) this.host.hidePopover();
      this.host?.setAttribute('hidden', '');
      this.lastFrame = null;
      return;
    }
    this.mount();
    this.host.hidden = false;
    this.bringToFront();
    this.series.clear(); this.intervals.clear();
    this.frameWindow = new PerformanceFrameWindow(); this.lastFrame = null;
    this.visibility = () => {
      if (document.hidden) { if (this.run || this.starting) this.finish('interrupted'); }
      else this.frameWindow = new PerformanceFrameWindow();
    };
    document.addEventListener('visibilitychange', this.visibility);
    this.topLayer = event => { if (event.target instanceof HTMLDialogElement && this.enabled) this.bringToFront(event.target); };
    document.addEventListener('toggle', this.topLayer, true);
    this.resize = () => this.clampPosition();
    window.addEventListener('resize', this.resize);
    this.displayTimer = setInterval(() => this.refresh(), 250);
    this.refresh();
  }
  frame(now, renderMs) {
    const gap = this.lastFrame === null ? 0 : now - this.lastFrame;
    const limit = this.playing ? 1000 : 250;
    // Editing redraws on demand, and loading a chart can leave a long gap.
    // Start a fresh window instead of reporting that idle time as a slow frame.
    if (this.lastFrame !== null && gap > limit) {
      this.frameWindow = new PerformanceFrameWindow();
      this.intervals.clear();
    }
    this.frameWindow.frame(now, renderMs);
    if (gap > 0 && gap <= limit) this.intervals.push(gap);
    this.lastFrame = now;
    this.run?.frame(now, renderMs);
  }
  status(state) {
    if (document.hidden) return t('perf.statusHidden');
    if (state.playing) return t('perf.statusPlaying');
    return state.editing ? t('perf.statusEditing') : t('perf.statusIdle');
  }
  refresh() {
    if (!this.enabled || document.hidden) return;
    const state = this.state?.() ?? {};
    this.playing = Boolean(state.playing);
    const { fps, render } = this.frameWindow.sample();
    const p95 = percentile(this.intervals, .95), longest = maximum(this.intervals), long = longFrames(this.intervals);
    this.fpsText.textContent = fps === null ? '—' : number(fps, 0);
    this.frameNote.textContent = `${t('perf.frameTime')} ${fps ? `${number(1000 / fps, 1)} ms` : '— ms'}`;
    this.drawText.textContent = `${number(render, 1)} ms`;
    this.p95Text.textContent = `${number(p95, 1)} ms`;
    this.longestText.textContent = `${number(longest, 1)} ms`;
    this.longText.textContent = String(long);
    const cap = state.fpsLimit ? ` · ${t('perf.statusCapped', { fps: state.fpsLimit })}` : '';
    this.statusText.textContent = `${this.status(state)}${cap}`;
    const chart = [
      `${t('perf.lines')} ${number(state.lines, 0)}`,
      `${t('perf.notes')} ${number(state.notes, 0)}`,
      `${t('perf.currentLine')} ${number(state.lineNotes, 0)}`,
    ];
    if (state.largeChart) chart.push(t('perf.largeChart'));
    this.complexity.replaceChildren(...chart.map((text, index) => index < 2 ? node('b', '', text) : node('span', '', text)));
    if (fps !== null) this.series.push(fps);
    this.drawGraph(this.canvas, this.series);
    this.runButton.disabled = !this.run && !this.starting && !state.canRun;
    if (this.run && this.started && (!state.playing || !state.preview || state.project !== this.run.metadata.project)) {
      this.finish(state.time >= this.run.metadata.duration - .05 ? 'complete' : 'interrupted');
    }
    if (this.run) {
      if (fps !== null) this.run.point(state.time, fps);
      this.progress.textContent = `${number(state.time)} / ${number(this.run.metadata.duration)} s`;
    } else {
      this.progress.textContent = '';
    }
  }
  drawGraph(canvas, values, result = false) {
    const width = Math.max(240, Math.round(canvas.clientWidth || 328));
    const height = result ? 92 : 142;
    const ratio = Math.min(2, globalThis.devicePixelRatio || 1);
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
    }
    const context = canvas.getContext('2d');
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#fff'; context.fillRect(0, 0, width, height);
    context.strokeStyle = '#e5e7eb'; context.lineWidth = 1;
    for (let index = 1; index < 6; index++) {
      const x = Math.round(width * index / 6) + .5;
      context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke();
    }
    for (let index = 1; index < 4; index++) {
      const y = Math.round(height * index / 4) + .5;
      context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke();
    }
    context.strokeStyle = '#d1d5db'; context.strokeRect(.5, .5, width - 1, height - 1);
    const count = values instanceof PerformanceSeries ? values.length : values.length;
    const at = index => values instanceof PerformanceSeries ? values.at(index) : values[index].fps;
    if (!count) {
      context.fillStyle = '#94a3b8'; context.font = '9px system-ui'; context.textAlign = 'left';
      context.fillText('60', 4, 11);
      return;
    }
    let peak = 0;
    for (let index = 0; index < count; index++) peak = Math.max(peak, at(index));
    const scale = Math.max(60, Math.ceil(peak / 60) * 60);
    if (scale > 60) {
      const y = 1 + (height - 2) * (1 - 60 / scale);
      context.setLineDash([3, 3]); context.strokeStyle = '#cbd5e1';
      context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke();
      context.setLineDash([]);
    }
    const points = [];
    for (let index = 0; index < count; index++) {
      const x = count === 1 ? width - 2 : 2 + (width - 4) * index / (count - 1);
      const y = 1 + (height - 2) * (1 - at(index) / scale);
      points.push([x, y]);
    }
    context.beginPath();
    points.forEach(([x, y], index) => index ? context.lineTo(x, y) : context.moveTo(x, y));
    context.lineTo(points.at(-1)[0], height - 1); context.lineTo(points[0][0], height - 1); context.closePath();
    context.fillStyle = 'rgba(109,40,217,.07)'; context.fill();
    context.beginPath();
    points.forEach(([x, y], index) => index ? context.lineTo(x, y) : context.moveTo(x, y));
    context.strokeStyle = '#6d28d9'; context.lineWidth = 1.6; context.lineJoin = 'round'; context.lineCap = 'round'; context.stroke();
    context.fillStyle = '#94a3b8'; context.font = '9px system-ui';
    context.textAlign = 'left'; context.fillText(String(scale), 4, 11);
    context.textAlign = 'right'; context.fillText(String(Math.round(at(count - 1))), width - 4, 11);
  }
  async start() {
    const state = this.state?.() ?? {};
    if (!this.enabled || !state.canRun || this.run || this.starting) return;
    this.starting = true;
    const token = this.startToken = (this.startToken ?? 0) + 1;
    this.startState = state;
    this.errorText.hidden = true; this.resultSection.hidden = true;
    this.runButton.textContent = t('perf.stop'); this.runButton.dataset.running = 'true';
    try {
      await this.startPlayback(() => {
        if (!this.enabled || token !== this.startToken) return false;
        this.run = new PerformanceRun(this.now(), {
          project: state.project, name: state.name, duration: state.duration, rate: state.rate,
          lines: state.lines, notes: state.notes, largeChart: Boolean(state.largeChart),
        });
        return true;
      });
      if (token === this.startToken && this.run) { this.started = true; this.starting = false; }
    } catch (error) {
      if (token === this.startToken) {
        this.errorText.textContent = error.message; this.errorText.hidden = false;
        this.finish('interrupted');
      }
    } finally {
      if (token === this.startToken) { this.starting = false; if (!this.run) this.updateButton(); }
    }
  }
  finish(reason = 'interrupted') {
    if (!this.run && !this.starting) return;
    this.startToken++;
    this.starting = this.started = false;
    const state = this.state?.() ?? {};
    const run = this.run ?? new PerformanceRun(this.now(), { name: this.startState?.name, duration: this.startState?.duration });
    this.run = null;
    this.result = run.finish(this.now(), reason, state.time);
    this.renderResult();
    this.notify?.(t(reason === 'complete' ? 'perf.complete' : 'perf.interrupted'));
    this.stopPlayback();
    this.updateButton();
  }
  updateButton() {
    if (!this.runButton) return;
    this.runButton.textContent = t('perf.start');
    this.runButton.dataset.running = 'false';
  }
  renderResult() {
    const result = this.result;
    if (!result || !this.root) return;
    const root = this.resultSection;
    root.replaceChildren(); root.hidden = false;
    const title = node('h2');
    title.append(t(result.reason === 'complete' ? 'perf.complete' : 'perf.interrupted'));
    title.append(node('small', '', `${number(result.elapsed / 1000)} s · ${result.frames.toLocaleString()} ${t('perf.frames')}`));
    const canvas = node('canvas', 'graph');
    root.append(title, canvas);
    requestAnimationFrame(() => this.drawGraph(canvas, result.points, true));
    const grid = node('div', 'stats');
    const add = (label, value) => {
      const cell = node('div', 'stat');
      cell.append(node('small', '', label), node('strong', '', value));
      grid.append(cell);
    };
    add(t('perf.averageFps'), number(result.averageFps));
    add(t('perf.lowFps'), number(result.lowFps));
    add(t('perf.averageRender'), `${number(result.renderAverage)} ms`);
    add(t('perf.p95'), `${number(result.frameP95)} ms`);
    add(t('perf.longestFrame'), `${number(result.frameMax)} ms`);
    add(t('perf.longFrames'), String(result.longFrames));
    root.append(grid);
    const meta = node('div', 'meta-line');
    meta.textContent = `${t('perf.lines')} ${number(result.metadata.lines, 0)} · ${t('perf.notes')} ${number(result.metadata.notes, 0)}${result.metadata.largeChart ? ` · ${t('perf.largeChart')}` : ''}`;
    root.append(meta);
    this.overviewButton.hidden = false;
    this.clampPosition();
  }
}
