import { SceneRuntime } from '../core/scene.ts';
import { previewViewport } from '../core/editor-display.ts';
import { fitNoiseSampleView } from '../core/noise-sampling.ts';
import { chartWithEventLists, eventListAt } from '../application/event-commands.ts';
import { prepareCanvas } from './timeline.ts';

const sampledTypes = new Set(['moveXEvents', 'moveYEvents', 'rotateEvents']);
const round = value => Math.round(value * 10000) / 10000;

export class EventSampler {
  constructor(host, getContext, { invalidate = () => {}, pause = () => {}, notify = () => {} } = {}) {
    this.host = host; this.getContext = getContext; this.invalidate = invalidate; this.pause = pause; this.notify = notify;
    this.mode = null; this.valueDraft = null; this.draftChart = null; this.drag = null; this.scene = new SceneRuntime();
    this.canvas = document.createElement('canvas'); this.canvas.className = 'event-sampler'; this.canvas.hidden = true; host.append(this.canvas);
    this.sampleBar = document.createElement('div'); this.sampleBar.className = 'noise-sample-bar event-sample-bar'; this.sampleBar.hidden = true;
    const hint = document.createElement('p'); hint.className = 'hint'; hint.textContent = '拖动绿色控制点 · 可连续取样，完成统一应用 · Esc 全部取消'; this.sampleBar.append(hint);
    for (const [title, apply] of [['完成取样', true], ['取消', false]]) { const button = document.createElement('button'); button.type = 'button'; button.textContent = title; button.onclick = () => this.finish(apply); this.sampleBar.append(button); }
    host.append(this.sampleBar);
    this.canvas.addEventListener('pointerdown', event => this.down(event));
    this.canvas.addEventListener('pointermove', event => this.move(event));
    this.canvas.addEventListener('pointerup', event => this.up(event));
    this.canvas.addEventListener('pointercancel', () => { this.drag = null; });
    window.addEventListener('keydown', event => {
      if ((!this.mode && !this.valueDraft) || event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation(); this.finish(false);
    }, true);
  }

  get context() { return this.getContext(); }
  get session() { return this.context.session; }
  get active() { return Boolean(this.mode || this.valueDraft); }

  syncChrome() {
    this.host.closest('.editor').classList.toggle('event-sampling', this.active);
    this.canvas.hidden = !this.mode;
    this.sampleBar.hidden = !this.mode;
  }

  beginValueDraft() {
    if (this.mode) return false;
    if (!this.valueDraft) this.valueDraft = { chart: this.session.chart };
    this.draftChart = this.valueDraft.chart;
    this.session.liveEventEdit = true;
    this.syncChrome();
    this.invalidate();
    return true;
  }

  updateValueDraft(target, value) {
    if (!this.beginValueDraft()) return false;
    const source = this.valueDraft.chart;
    const temporary = { chart: source, eventLayer: this.session.eventLayer };
    const events = [...eventListAt(temporary, target.lineIndex ?? this.session.lineIndex, target.type)];
    const event = events[target.index];
    if (!event) return false;
    const next = { ...event, [target.field]: structuredClone(value) };
    if (next.inst && (target.field === 'start' || target.field === 'end')) {
      next.start = structuredClone(value); next.end = structuredClone(value);
    }
    events[target.index] = next;
    this.valueDraft.chart = chartWithEventLists(source, target.lineIndex ?? this.session.lineIndex, this.session.eventLayer, new Map([[target.type, events]]));
    this.draftChart = this.valueDraft.chart;
    this.invalidate();
    return true;
  }

  finishValue(apply) {
    if (!this.valueDraft) return;
    const chart = this.valueDraft.chart;
    this.valueDraft = null; this.draftChart = null; this.session.liveEventEdit = false;
    this.syncChrome();
    if (apply && chart && chart !== this.session.chart) this.session.commit('应用事件取样', chart);
    else this.session.notify();
    this.invalidate();
  }

  begin(target) {
    if (!sampledTypes.has(target.type) || !Number.isInteger(target.index)) return false;
    const source = this.valueDraft?.chart ?? this.draftChart ?? this.session.chart;
    this.valueDraft = null;
    const line = source.judgeLineList?.[target.lineIndex ?? this.session.lineIndex];
    const event = eventListAt({ chart: source, eventLayer: this.session.eventLayer }, target.lineIndex ?? this.session.lineIndex, target.type)?.[target.index];
    if (!line || !event || !Number.isFinite(event[target.field])) return false;
    this.pause();
    this.draftChart = source;
    this.mode = { ...target, lineIndex: target.lineIndex ?? this.session.lineIndex };
    const factor = line.bpmfactor ?? 1;
    this.seconds = this.context.tempo.seconds(target.field === 'end' ? event.endTime : event.startTime, factor);
    this.session.liveEventEdit = true;
    this.sampleZoom ??= [this.context.preview, this.context.realtimePreview].map(renderer => ({ renderer, original: renderer.viewDivisor ?? 1, divisor: renderer.viewDivisor ?? 1 }));
    this.drag = null;
    this.syncChrome(); this.fitView();
    this.invalidate();
    return true;
  }

  finish(apply) {
    if (!this.mode) { this.finishValue(apply); return; }
    const chart = this.draftChart;
    for (const { renderer, original } of this.sampleZoom ?? []) renderer.viewDivisor = original;
    this.sampleZoom = null;
    this.mode = null; this.draftChart = null; this.drag = null; this.canvas.hidden = true; this.session.liveEventEdit = false;
    this.syncChrome();
    if (apply && chart) this.session.commit('预览拖动取样', chart);
    else if (!apply) this.session.notify();
    this.invalidate();
  }

  previewState() {
    if (this.mode && this.draftChart) { this.fitView(); return { chart: this.samplingChart(this.draftChart), seconds: this.seconds }; }
    if (this.valueDraft?.chart) return { chart: this.valueDraft.chart, seconds: this.context.seconds?.() ?? 0 };
    return null;
  }

  view() {
    const rectangle = this.canvas.getBoundingClientRect();
    const renderer = this.context.previewVisible ? this.context.preview : this.context.realtimePreview;
    const viewport = previewViewport(rectangle.width, rectangle.height, renderer.aspectRatio ?? 1.5);
    const scale = viewport.scale / (renderer.viewDivisor ?? 1);
    return { rectangle, viewport, scale, screen: point => ({ x: rectangle.width / 2 + point.x * scale, y: rectangle.height / 2 + point.y * scale }), world: point => ({ x: (point.x - rectangle.width / 2) / scale, y: (point.y - rectangle.height / 2) / scale }) };
  }

  fitView() {
    const previous = this.view(); const handle = this.handle(this.draftChart);
    const controlsBottom = this.sampleBar.getBoundingClientRect().bottom - previous.rectangle.top;
    for (const zoom of this.sampleZoom ?? []) {
      if (this.context.sampleAutoFit !== false) zoom.divisor = fitNoiseSampleView({ x: handle.x, y: -handle.y }, previous.rectangle.width, previous.rectangle.height, zoom.renderer.aspectRatio ?? 1.5, zoom.divisor, controlsBottom);
      zoom.renderer.viewDivisor = this.context.sampleAutoFit === false ? zoom.original : zoom.divisor;
    }
    const view = this.view();
    if (this.drag && view.scale !== previous.scale) {
      const position = view.screen(handle);
      this.drag.offset = { x: this.drag.pointer.x - view.rectangle.left - position.x, y: this.drag.pointer.y - view.rectangle.top - position.y };
    }
  }

  eventChart(value) {
    const mode = this.mode; const lineIndex = mode.lineIndex;
    const temporary = { chart: this.draftChart, eventLayer: this.session.eventLayer };
    const events = [...eventListAt(temporary, lineIndex, mode.type)]; const event = { ...events[mode.index], [mode.field]: value };
    if (event.inst) event[mode.field === 'start' ? 'end' : 'start'] = structuredClone(value);
    events[mode.index] = event;
    return chartWithEventLists(this.draftChart, lineIndex, this.session.eventLayer, new Map([[mode.type, events]]));
  }

  samplingChart(chart) {
    if (this.displayCache?.source === chart && this.displayCache.mode === this.mode) return this.displayCache.chart;
    const mode = this.mode;
    const event = eventListAt({ chart, eventLayer: this.session.eventLayer }, mode.lineIndex, mode.type)?.[mode.index];
    const display = { ...event, start: event[mode.field], end: event[mode.field] };
    const result = chartWithEventLists(chart, mode.lineIndex, this.session.eventLayer, new Map([[mode.type, [display]]]));
    this.displayCache = { source: chart, mode, chart: result };
    return result;
  }

  handle(chart) {
    const mode = this.mode; const line = chart.judgeLineList?.[mode.lineIndex];
    this.scene.compile(this.samplingChart(chart), this.context.tempo);
    const state = this.scene.sampler(this.seconds)(mode.lineIndex) ?? { x: 0, y: 0, rotation: 0 };
    const local = mode.type === 'rotateEvents' ? { x: 0, y: -300 } : { x: 0, y: 0 };
    const angle = state.rotation * Math.PI / 180;
    return { x: state.x + local.x * Math.cos(angle) + local.y * Math.sin(angle), y: -state.y + local.x * Math.sin(angle) - local.y * Math.cos(angle), line };
  }

  applyPoint(point) {
    const mode = this.mode; const current = this.handle(this.draftChart); const event = eventListAt({ chart: this.draftChart, eventLayer: this.session.eventLayer }, mode.lineIndex, mode.type)?.[mode.index];
    if (!event) return;
    let value = Number(event[mode.field]);
    if (mode.type !== 'rotateEvents') {
      const probe = this.handle(this.eventChart(value + 1));
      const horizontal = probe.x - current.x; const vertical = probe.y - current.y;
      const length = horizontal * horizontal + vertical * vertical;
      if (length < 1e-8) return;
      value += ((point.x - current.x) * horizontal + (point.y - current.y) * vertical) / length;
    } else {
      for (let iteration = 0; iteration < 10; iteration++) {
        const chart = this.eventChart(value); const now = this.handle(chart); const probe = this.handle(this.eventChart(value + 0.01));
        const dx = (probe.x - now.x) / 0.01; const dy = (probe.y - now.y) / 0.01; const length = dx * dx + dy * dy;
        if (length < 1e-8) break;
        const errorX = point.x - now.x; const errorY = point.y - now.y; value += (errorX * dx + errorY * dy) / length;
        if (Math.hypot(errorX, errorY) < 1e-4) break;
      }
    }
    if (!Number.isFinite(value)) return;
    this.draftChart = this.eventChart(round(value)); this.invalidate();
  }

  down(event) {
    if (!this.mode || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    const view = this.view(); const handle = view.screen(this.handle(this.draftChart)); const point = { x: event.clientX - view.rectangle.left, y: event.clientY - view.rectangle.top };
    if (Math.hypot(point.x - handle.x, point.y - handle.y) > 28) return;
    this.drag = { pointer: { x: event.clientX, y: event.clientY }, offset: { x: point.x - handle.x, y: point.y - handle.y } }; this.canvas.setPointerCapture(event.pointerId);
  }

  move(event) {
    if (!this.drag || !this.mode) return;
    event.preventDefault();
    this.drag.pointer = { x: event.clientX, y: event.clientY };
    const view = this.view(); const point = { x: event.clientX - view.rectangle.left - this.drag.offset.x, y: event.clientY - view.rectangle.top - this.drag.offset.y };
    this.applyPoint(view.world(point)); this.fitView();
  }

  up(event) {
    if (!this.drag) return;
    this.canvas.releasePointerCapture?.(event.pointerId); this.drag = null;
  }

  draw() {
    if (!this.mode) return;
    const { context, width, height } = prepareCanvas(this.canvas); const view = this.view(); const point = view.screen(this.handle(this.draftChart));
    context.save(); context.strokeStyle = '#70efaa'; context.lineWidth = 2; context.beginPath(); context.moveTo(point.x - 16, point.y); context.lineTo(point.x + 16, point.y); context.moveTo(point.x, point.y - 16); context.lineTo(point.x, point.y + 16); context.stroke(); context.fillStyle = '#d2ffe4'; context.font = '13px sans-serif'; context.fillText('拖动绿色控制点 · Esc 取消 · 完成后点击完成取样', 14, height - 18); context.restore();
  }
}
