import { PerformanceFrameWindow } from '../core/performance-monitor.mjs';
import { t } from '../i18n.mjs';
import { localPreferences } from '../platform/local-preferences.mjs';

const WINDOW_MS = 60000;
const number = (value, digits = 1) => Number.isFinite(value) ? value.toFixed(digits) : '—';
const node = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  if (tag === 'button') element.type = 'button';
  return element;
};
const defaultNotes = () => ({ tap: 0, hold: 0, flick: 0, drag: 0, other: 0 });
const NOTE_SERIES = [
  { key: 'tap', label: 'Tap', color: '#8acbff' },
  { key: 'hold', label: 'Hold', color: '#f1ce76' },
  { key: 'flick', label: 'Flick', color: '#f596ac' },
  { key: 'drag', label: 'Drag', color: '#9fe0a0' },
];
const EFFECT_SERIES = [
  { key: 'particles', labelKey: 'perf.particles', color: '#c084fc' },
  { key: 'hits', labelKey: 'perf.hitEffects', color: '#ff9f43' },
];
const seriesLabel = series => series.labelKey ? t(series.labelKey) : series.label;
const sceneValue = (scene, key) => {
  if (!scene) return 0;
  if (key === 'particles') return Number(scene.particles) || 0;
  if (key === 'hits') return Number(scene.hits) || 0;
  return Number(scene.notes?.[key]) || 0;
};
const sampleValue = (sample, key) => {
  if (key === 'fps') return sample.fps;
  if (key === 'particles') return sample.particles;
  if (key === 'hits') return sample.hits;
  if (key === 'visible') return sample.visible;
  if (key === 'anchors') return sample.anchors;
  if (key === 'events') return sample.events;
  return sample.notes?.[key] ?? 0;
};
const intervalStats = intervals => {
  if (!intervals.length) return { p95: null, longest: null, long: 0 };
  const values = intervals.map(item => item.ms).sort((left, right) => left - right);
  return {
    p95: values[Math.min(values.length - 1, Math.floor(values.length * .95))],
    longest: values.at(-1),
    long: values.filter(value => value > 1000 / 30).length,
  };
};
const sceneMax = value => {
  if (!Number.isFinite(value) || value <= 0) return 10;
  if (value <= 10) return 10;
  if (value <= 100) return Math.ceil(value / 10) * 10;
  if (value <= 1000) return Math.ceil(value / 100) * 100;
  return Math.ceil(value / 1000) * 1000;
};

const css = `
:host{position:fixed;inset:12px auto auto 12px;margin:0;padding:0;border:0;background:transparent;color:var(--rpen-text,#f0f0f0);z-index:2147483647;font:12px/1.45 var(--rpen-font-family,RPE,'Microsoft YaHei',sans-serif);font-variant-numeric:tabular-nums;max-width:calc(100vw - 24px);max-height:calc(100dvh - 24px);color-scheme:dark}
*{box-sizing:border-box}
.window{width:min(760px,calc(100vw - 24px));border:1px solid var(--rpen-border,#666);border-radius:var(--rpen-radius-panel,4px);background:var(--rpen-elevated,#202020);box-shadow:var(--rpen-panel-shadow,0 10px 30px #0007);overflow:hidden}
header{display:flex;align-items:center;gap:8px;height:32px;padding:0 8px 0 10px;border-bottom:1px solid var(--rpen-border,#666);background:var(--rpen-surface-alt,#282828);cursor:move;user-select:none;touch-action:none}
header .icon{width:10px;height:10px;border-radius:1px;background:var(--rpen-accent,var(--accent,#ffdc70));box-shadow:0 0 0 1px #0004}
header .title{font-size:12px;font-weight:600;color:var(--rpen-text,#f0f0f0)}
header .status{margin-left:auto;font-size:10px;color:var(--rpen-muted,var(--muted,#aaa));white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
header .close{flex:none;padding:0 4px;border:0;border-radius:0;background:none;color:var(--rpen-muted,var(--muted,#aaa));font-size:18px;line-height:20px}
header .close:hover{background:none;color:var(--rpen-text,#f0f0f0)}
.body{padding:10px 12px 12px;max-height:calc(100dvh - 80px);overflow:auto}
.columns{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}
.column{min-width:0;display:flex;flex-direction:column}
@media (max-width:700px){.columns{grid-template-columns:1fr}}
.fps-line{display:flex;align-items:baseline;gap:7px;margin:0 0 7px}
.fps{font-size:38px;line-height:1;font-weight:650;letter-spacing:-.05em;color:var(--rpen-text,#f0f0f0)}
.fps-unit{font-size:10px;color:var(--rpen-muted,var(--muted,#aaa));letter-spacing:.06em}
.frame-note{margin-left:auto;font-size:10px;color:var(--rpen-muted,var(--muted,#aaa))}
canvas.graph{display:block;width:100%;height:120px;border:1px solid var(--rpen-border,#666);border-radius:2px;background:var(--rpen-elevated,#202020)}
.stats{display:grid;grid-template-columns:1fr 1fr;gap:6px 14px;margin:9px 0 0}
.stat small{display:block;color:var(--rpen-muted,var(--muted,#aaa));font-size:10px}
.stat strong{font-size:13px;font-weight:600;color:var(--rpen-text,#f0f0f0);white-space:nowrap}
.scene-head{display:flex;align-items:center;justify-content:space-between;margin-top:10px;padding-top:9px;border-top:1px solid var(--rpen-border,#666);color:var(--rpen-muted,var(--muted,#aaa));font-size:10px}
.column > .scene-head:first-child{margin-top:0;padding-top:0;border-top:0}
.legend{display:flex;flex-wrap:wrap;gap:3px 10px;margin:6px 0 5px;font-size:10px;color:var(--rpen-muted,var(--muted,#aaa))}
.legend .item{display:inline-flex;align-items:center;gap:4px;white-space:nowrap}
.legend .dot{width:7px;height:7px;border-radius:50%;flex:none}
.legend b{color:var(--rpen-text,#f0f0f0);font-weight:500;margin-left:1px}
canvas.scene-graph{height:96px}
canvas.effect-graph{height:82px}
.complexity{margin-top:8px;color:var(--rpen-muted,var(--muted,#aaa));font-size:10px;display:flex;flex-wrap:wrap;gap:3px 10px}
.complexity b{color:var(--rpen-text,#f0f0f0);font-weight:500}
.load-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:7px;margin-top:5px}
.load-card{min-width:0}
.load-head{display:flex;justify-content:space-between;gap:4px;margin-bottom:3px;font-size:10px;color:var(--rpen-muted,var(--muted,#aaa))}
.load-head b{color:var(--rpen-text,#f0f0f0);font-weight:500;white-space:nowrap}
canvas.load-graph{height:64px}
.event-summary{margin-top:5px;color:var(--rpen-muted,var(--muted,#aaa));font-size:10px;line-height:1.5}
[hidden]{display:none!important}
`;

export class PerformanceMonitor {
  constructor({ state, onChange, now = () => performance.now() }) {
    Object.assign(this, { state, onChange, now });
    this.enabled = false; this.playing = false; this.lastFrame = null;
    this.samples = []; this.intervals = []; this.latestScene = null;
    this.frameWindow = new PerformanceFrameWindow();
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
    const loadHead = node('div', 'scene-head');
    loadHead.append(node('span', '', t('perf.lineLoad')), node('span', '', t('perf.last60s')));
    const loadGrid = node('div', 'load-grid');
    const loadCard = label => {
      const card = node('div', 'load-card'); const head = node('div', 'load-head');
      const value = node('b', '', '—'); head.append(node('span', '', label), value);
      const canvas = node('canvas', 'graph load-graph'); card.append(head, canvas); loadGrid.append(card);
      return { value, canvas };
    };
    const anchorLoad = loadCard(t('perf.anchors')); this.anchorValue = anchorLoad.value; this.anchorCanvas = anchorLoad.canvas;
    const eventLoad = loadCard(t('perf.events')); this.eventValue = eventLoad.value; this.eventCanvas = eventLoad.canvas;
    this.eventSummary = node('div', 'event-summary');
    const createLegend = seriesList => {
      const legend = node('div', 'legend'); const values = new Map();
      for (const series of seriesList) {
        const item = node('span', 'item'); const dot = node('span', 'dot'); dot.style.background = series.color;
        const value = node('b', '', '0'); const label = node('span', '', seriesLabel(series));
        item.append(dot, label, value); legend.append(item); values.set(series.key, value);
      }
      return { legend, values };
    };
    const sceneHead = node('div', 'scene-head');
    sceneHead.append(node('span', '', t('perf.drawnObjects')), node('span', '', t('perf.last60s')));
    const noteLegend = createLegend(NOTE_SERIES); this.noteLegendValues = noteLegend.values;
    this.sceneCanvas = node('canvas', 'graph scene-graph');
    const effectHead = node('div', 'scene-head');
    effectHead.append(node('span', '', t('perf.effectObjects')), node('span', '', t('perf.last60s')));
    const effectLegend = createLegend(EFFECT_SERIES); this.effectLegendValues = effectLegend.values;
    this.effectsCanvas = node('canvas', 'graph effect-graph');
    this.complexity = node('div', 'complexity');
    const columns = node('div', 'columns'), left = node('div', 'column'), right = node('div', 'column');
    left.append(fpsLine, this.canvas, stats, sceneHead, noteLegend.legend, this.sceneCanvas, this.complexity);
    right.append(loadHead, loadGrid, this.eventSummary, effectHead, effectLegend.legend, this.effectsCanvas);
    columns.append(left, right); body.append(columns);
    panel.append(body); shadow.append(style, panel);
    this.root = shadow; this.statusText = status;
    close.onclick = () => this.setEnabled(false);
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
      const width = this.host.offsetWidth || 760, height = this.host.offsetHeight || 260;
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
    this.clampPosition();
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
    this.enabled = enabled;
    this.onChange?.(enabled);
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
    this.samples = []; this.intervals = []; this.latestScene = null; this.playing = false;
    this.frameWindow = new PerformanceFrameWindow(); this.lastFrame = null;
    this.visibility = () => { if (!document.hidden) this.frameWindow = new PerformanceFrameWindow(); };
    document.addEventListener('visibilitychange', this.visibility);
    this.topLayer = event => { if (event.target instanceof HTMLDialogElement && this.enabled) this.bringToFront(event.target); };
    document.addEventListener('toggle', this.topLayer, true);
    this.resize = () => this.clampPosition();
    window.addEventListener('resize', this.resize);
    this.displayTimer = setInterval(() => this.refresh(), 250);
    this.refresh();
  }
  frame(now, renderMs, stats = null) {
    if (stats) this.latestScene = stats;
    const gap = this.lastFrame === null ? 0 : now - this.lastFrame;
    const limit = this.playing ? 1000 : 250;
    if (this.lastFrame !== null && gap > limit) {
      this.frameWindow = new PerformanceFrameWindow();
      this.intervals = [];
    }
    this.frameWindow.frame(now, renderMs);
    if (gap > 0 && gap <= limit) this.intervals.push({ time: now, ms: gap });
    this.lastFrame = now;
  }
  prune(now) {
    const cutoff = now - WINDOW_MS;
    if (this.samples.length && this.samples[0].time < cutoff) this.samples = this.samples.filter(sample => sample.time >= cutoff);
    if (this.intervals.length && this.intervals[0].time < cutoff) this.intervals = this.intervals.filter(item => item.time >= cutoff);
    if (this.samples.length > 300) this.samples.splice(0, this.samples.length - 300);
    if (this.intervals.length > 20000) this.intervals.splice(0, this.intervals.length - 20000);
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
    const now = this.now();
    const { fps, render } = this.frameWindow.sample();
    const scene = this.latestScene ?? { notes: defaultNotes(), visible: 0, hits: 0, particles: 0 };
    if (fps !== null) {
      this.samples.push({ time: now, fps, notes: { ...defaultNotes(), ...(scene.notes ?? {}) }, visible: scene.visible ?? 0, hits: scene.hits ?? 0, particles: scene.particles ?? 0,
        anchors: this.latestScene?.lines?.length ?? 0, events: state.activeEventTotal ?? 0 });
    }
    this.prune(now);
    const { p95, longest, long } = intervalStats(this.intervals);
    this.fpsText.textContent = fps === null ? '—' : number(fps, 0);
    this.frameNote.textContent = `${t('perf.frameTime')} ${fps ? `${number(1000 / fps, 1)} ms` : '— ms'}`;
    this.drawText.textContent = `${number(render, 1)} ms`;
    this.p95Text.textContent = `${number(p95, 1)} ms`;
    this.longestText.textContent = `${number(longest, 1)} ms`;
    this.longText.textContent = String(long);
    const cap = state.fpsLimit ? ` · ${t('perf.statusCapped', { fps: state.fpsLimit })}` : '';
    this.statusText.textContent = `${this.status(state)}${cap}`;
    for (const [seriesList, values] of [[NOTE_SERIES, this.noteLegendValues], [EFFECT_SERIES, this.effectLegendValues]]) {
      for (const series of seriesList) {
        const target = values.get(series.key);
        if (target) target.textContent = String(Math.round(sceneValue(scene, series.key)));
      }
    }
    const chart = [
      `${t('perf.lines')} ${number(state.lines, 0)}`,
      `${t('perf.notes')} ${number(state.notes, 0)}`,
      `${t('perf.currentLine')} ${number(state.lineNotes, 0)}`,
    ];
    if (state.largeChart) chart.push(t('perf.largeChart'));
    this.complexity.replaceChildren(...chart.map((text, index) => index < 2 ? node('b', '', text) : node('span', '', text)));
    this.drawFpsGraph(now);
    this.drawNoteGraph(now);
    this.drawEffectGraph(now);
    this.drawLoadGraphs(now);
    this.updateSummary(state);
  }
  updateSummary(state) {
    const anchors = this.latestScene?.lines?.length ?? 0;
    this.anchorValue.textContent = state.lines ? `${anchors} / ${state.lines}` : String(anchors);
    this.eventValue.textContent = String(state.activeEventTotal ?? 0);
    const counts = Object.entries(state.activeEventCounts ?? {}).sort((left, right) => right[1] - left[1]);
    this.eventSummary.textContent = counts.length
      ? counts.map(([type, count]) => `${t(type)} ${count}`).join(' · ')
      : t('perf.noEvents');
  }
  theme() {
    const style = getComputedStyle(this.host);
    const read = (...names) => names.map(name => style.getPropertyValue(name).trim()).find(Boolean);
    return {
      accent: read('--rpen-accent', '--accent') || '#ffdc70',
      border: read('--rpen-border', '--line') || '#515151',
      text: read('--rpen-text') || '#f0f0f0',
      muted: read('--rpen-muted', '--muted') || '#aaaaaa',
      surface: read('--rpen-surface-alt', '--rpen-elevated') || '#202020',
    };
  }
  prepare(canvas, height) {
    const width = Math.max(240, Math.round(canvas.clientWidth || 358));
    const ratio = Math.min(2, globalThis.devicePixelRatio || 1);
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    }
    const context = canvas.getContext('2d');
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    const theme = this.theme();
    context.fillStyle = theme.surface; context.fillRect(0, 0, width, height);
    context.strokeStyle = theme.border; context.globalAlpha = .38; context.lineWidth = 1;
    for (let index = 1; index < 6; index++) {
      const x = Math.round(width * index / 6) + .5;
      context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke();
    }
    for (let index = 1; index < 4; index++) {
      const y = Math.round(height * index / 4) + .5;
      context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke();
    }
    context.globalAlpha = 1;
    context.strokeStyle = theme.border; context.strokeRect(.5, .5, width - 1, height - 1);
    return { context, width, height, theme };
  }
  drawSeries(canvas, now, series, maximum, { fill = false, reference = false, rightLabel = '', height: pixelHeight } = {}) {
    const { context, width, height, theme } = this.prepare(canvas, pixelHeight ?? (fill ? 120 : 96));
    // Fixed 60-second window: old points fall off the left edge instead of
    // being stretched across the full width when the editor pauses.
    const start = now - WINDOW_MS;
    const xOf = time => 2 + (width - 4) * (time - start) / WINDOW_MS;
    const yOf = value => 1 + (height - 2) * (1 - Math.max(0, value) / maximum);
    if (reference && maximum > 60) {
      context.setLineDash([3, 3]); context.strokeStyle = theme.border; context.globalAlpha = .65;
      const y = yOf(60); context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke();
      context.setLineDash([]); context.globalAlpha = 1;
    }
    for (const item of series) {
      let segment = [];
      const flush = () => {
        if (!segment.length) return;
        if (fill && segment.length > 1) {
          context.beginPath();
          segment.forEach(([x, y], index) => index ? context.lineTo(x, y) : context.moveTo(x, y));
          context.lineTo(segment.at(-1)[0], height - 1); context.lineTo(segment[0][0], height - 1); context.closePath();
          context.fillStyle = item.color; context.globalAlpha = .09; context.fill(); context.globalAlpha = 1;
        }
        context.beginPath();
        segment.forEach(([x, y], index) => index ? context.lineTo(x, y) : context.moveTo(x, y));
        context.strokeStyle = item.color; context.lineWidth = 1.5; context.lineJoin = 'round'; context.lineCap = 'round'; context.stroke();
        if (segment.length === 1) { context.fillStyle = item.color; context.beginPath(); context.arc(segment[0][0], segment[0][1], 1.8, 0, Math.PI * 2); context.fill(); }
        segment = [];
      };
      for (const sample of this.samples) {
        if (sample.time < now - WINDOW_MS || sample.time > now) continue;
        const value = sampleValue(sample, item.key);
        if (!Number.isFinite(value)) continue;
        if (segment.length && sample.time - segment.at(-1)[2] > 2500) flush();
        segment.push([xOf(sample.time), yOf(value), sample.time]);
      }
      flush();
    }
    context.fillStyle = theme.muted; context.font = '9px system-ui';
    context.textAlign = 'left'; context.fillText(String(maximum), 4, 11);
    if (rightLabel) { context.textAlign = 'right'; context.fillText(rightLabel, width - 4, 11); }
  }
  drawFpsGraph(now) {
    const values = this.samples.map(sample => sample.fps);
    const peak = values.length ? Math.max(...values) : 0;
    const maximum = Math.max(60, Math.ceil(peak / 60) * 60);
    const current = this.samples.at(-1);
    this.drawSeries(this.canvas, now, [{ key: 'fps', color: this.theme().accent }], maximum, { fill: true, reference: true, rightLabel: current ? String(Math.round(current.fps)) : '' });
  }
  drawNoteGraph(now) {
    let peak = 0;
    for (const sample of this.samples) for (const series of NOTE_SERIES) peak = Math.max(peak, sampleValue(sample, series.key));
    this.drawSeries(this.sceneCanvas, now, NOTE_SERIES.map(series => ({ key: series.key, color: series.color })), sceneMax(peak), { rightLabel: `${t('perf.visibleNotes')} ${Math.round(this.latestScene?.visible ?? 0)}` });
  }
  drawEffectGraph(now) {
    let peak = 0;
    for (const sample of this.samples) for (const series of EFFECT_SERIES) peak = Math.max(peak, sampleValue(sample, series.key));
    this.drawSeries(this.effectsCanvas, now, EFFECT_SERIES.map(series => ({ key: series.key, color: series.color })), sceneMax(peak), { height: 82 });
  }
  drawLoadGraphs(now) {
    let anchorPeak = 0, eventPeak = 0;
    for (const sample of this.samples) {
      anchorPeak = Math.max(anchorPeak, sample.anchors ?? 0);
      eventPeak = Math.max(eventPeak, sample.events ?? 0);
    }
    this.drawSeries(this.anchorCanvas, now, [{ key: 'anchors', color: '#8acbff' }], sceneMax(anchorPeak), { height: 64, fill: true });
    const eventMax = Math.max(10, Math.ceil(eventPeak / 10) * 10);
    this.drawSeries(this.eventCanvas, now, [{ key: 'events', color: '#f596ac' }], eventMax, { height: 64, fill: true });
  }
}
