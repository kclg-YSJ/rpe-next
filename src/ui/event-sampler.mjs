import { SceneRuntime } from '../core/scene.mjs';
import { previewViewport, previewPositionScale } from '../core/editor-display.mjs';
import { fitNoiseSampleView } from '../core/noise-sampling.mjs';
import { beatValue } from '../core/beat.mjs';
import { chartWithEventLists, eventListAt, eventKey, transformedEventLists } from '../application/event-commands.mjs';
import { prepareCanvas } from './timeline.mjs';
import { t } from '../i18n.mjs';

const sampledTypes = new Set(['moveXEvents', 'moveYEvents', 'rotateEvents']);
const round = value => Math.round(value * 10000) / 10000;
const now = () => typeof performance === 'undefined' ? Date.now() : performance.now();

export class EventSampler {
  constructor(host, getContext, { invalidate = () => {}, pause = () => {}, notify = () => {} } = {}) {
    this.host = host; this.getContext = getContext; this.invalidate = invalidate; this.pause = pause; this.notify = notify;
    this.mode = null; this.valueDraft = null; this.draftChart = null; this.drag = null; this.scene = new SceneRuntime();
    this.canvas = document.createElement('canvas'); this.canvas.className = 'event-sampler'; this.canvas.hidden = true; host.append(this.canvas);
    this.sampleBar = document.createElement('div'); this.sampleBar.className = 'noise-sample-bar event-sample-bar'; this.sampleBar.hidden = true;
    const hint = document.createElement('p'); hint.className = 'hint'; hint.textContent = t('event-sampler.s5cb983c'); this.sampleHint = hint; this.sampleBar.append(hint);
    for (const [title, apply] of [[t('event-sampler.s2e0df4a'), true], [t('event-sampler.s4d0b468'), false]]) { const button = document.createElement('button'); button.type = 'button'; button.textContent = title; button.onclick = () => this.finish(apply); this.sampleBar.append(button); }
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
  // While paused the value draft preview loops the edited event's own time range
  // so the property effect is visible wherever the playhead happens to be.
  get looping() { return Boolean(this.valueDraft?.range) && this.context.playing?.() !== true; }

  syncChrome() {
    this.host.closest('.editor').classList.toggle('event-sampling', this.active);
    this.canvas.hidden = !this.mode;
    this.sampleBar.hidden = !this.mode;
  }

  beginValueDraft() {
    if (this.mode) return false;
    if (this.valueDraft && !this.valueDraftCurrent()) { this.finishValue(false); return false; }
    if (!this.valueDraft) this.valueDraft = { chart: this.session.chart, base: this.session.chart, session: this.session, layer: this.session.eventLayer, startedAt: now(), targetKey: null };
    this.draftChart = this.valueDraft.chart;
    this.session.liveEventEdit = true;
    this.syncChrome();
    this.invalidate();
    return true;
  }

  updateValueDraft(target, value) {
    if (!this.beginValueDraft()) return false;
    const source = this.valueDraft.chart;
    const lineIndex = target.lineIndex ?? this.session.lineIndex;
    const draft = this.valueDraft;
    const targetKey = `${lineIndex}:${target.type}:${target.index}`;
    if (draft.targetKey !== targetKey) {
      draft.targetKey = targetKey;
      draft.range = this.valueRange(source, lineIndex, target.type, target.index);
      draft.startedAt = now();
    }
    const temporary = { chart: source, eventLayer: draft.layer, shaderAutoAlign: this.session.shaderAutoAlign };
    const event = eventListAt(temporary, lineIndex, target.type)[target.index];
    if (!event) return false;
    const updates = transformedEventLists(temporary, lineIndex, new Set([eventKey(target.type, target.index)]), current => ({
      ...current, [target.field]: structuredClone(value),
      ...(current.inst && (target.field === 'start' || target.field === 'end') ? { start: structuredClone(value), end: structuredClone(value) } : {}),
    }));
    draft.chart = chartWithEventLists(source, lineIndex, draft.layer, updates);
    this.draftChart = draft.chart;
    this.invalidate();
    return true;
  }

  /** Loop range of the drafted event in seconds, or null when it has no span. */
  valueRange(chart, lineIndex, type, index) {
    const line = chart.judgeLineList?.[lineIndex];
    const event = eventListAt({ chart, eventLayer: this.session.eventLayer }, lineIndex, type)?.[index];
    if (!line || !event) return null;
    try {
      const factor = line.bpmfactor ?? 1;
      const start = this.context.tempo.seconds(event.startTime, factor);
      const end = this.context.tempo.seconds(event.endTime, factor);
      return Number.isFinite(start) && Number.isFinite(end) && end > start ? { start, end } : null;
    } catch { return null; }
  }

  /** Preview time inside the drafted event range; the whole span plays once per loop. */
  loopSeconds() {
    const draft = this.valueDraft;
    if (!draft?.range) return this.context.seconds?.() ?? 0;
    const span = draft.range.end - draft.range.start;
    const period = Math.min(3, Math.max(0.3, span)) * 1000;
    const phase = ((now() - draft.startedAt) % period) / period;
    return draft.range.start + span * phase;
  }

  finishValue(apply, label = t('event-sampler.s542c443')) {
    if (!this.valueDraft) return;
    const draft = this.valueDraft, chart = draft.chart, current = this.valueDraftCurrent();
    draft.session.liveEventEdit = false;
    this.valueDraft = null; this.draftChart = null; this.session.liveEventEdit = false;
    this.syncChrome();
    if (apply && current && chart && chart !== this.session.chart) this.session.commit(label, chart);
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
    if (this.context.pairedMovementSampling !== false && ['moveXEvents', 'moveYEvents'].includes(target.type)) {
      this.mode.paired = this.findPairedMovement(source, this.mode);
    }
    this.sampleHint.textContent = this.mode.paired
      ? t('event-sampler.s266cff8')
      : t('event-sampler.s5cb983c');
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
    if (apply && chart) this.session.commit(t('event-sampler.seaab4c2'), chart);
    else if (!apply) this.session.notify();
    this.invalidate();
  }

  previewState() {
    if (this.mode && this.draftChart) { this.fitView(); return { chart: this.samplingChart(this.draftChart), seconds: this.seconds }; }
    if (this.valueDraft && !this.valueDraftCurrent()) { this.finishValue(false); return null; }
    if (this.valueDraft?.chart) return { chart: this.valueDraft.chart, seconds: this.looping ? this.loopSeconds() : this.context.seconds?.() ?? 0 };
    return null;
  }

  valueDraftCurrent() {
    const draft = this.valueDraft;
    return draft && draft.session === this.session && draft.base === this.session.chart && draft.layer === this.session.eventLayer;
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

  eventChart(value, pairedValue) {
    const mode = this.mode; const lineIndex = mode.lineIndex;
    const temporary = { chart: this.draftChart, eventLayer: this.session.eventLayer };
    const updates = new Map();
    const update = (type, index, nextValue) => {
      const events = [...eventListAt(temporary, lineIndex, type)];
      const event = { ...events[index], [mode.field]: nextValue };
      if (event.inst) event[mode.field === 'start' ? 'end' : 'start'] = structuredClone(nextValue);
      events[index] = event;
      updates.set(type, events);
    };
    update(mode.type, mode.index, value);
    if (mode.paired) update(mode.paired.type, mode.paired.index, pairedValue ?? eventListAt(temporary, lineIndex, mode.paired.type)[mode.paired.index][mode.field]);
    return chartWithEventLists(this.draftChart, lineIndex, this.session.eventLayer, updates);
  }

  findPairedMovement(chart, mode) {
    const companionType = mode.type === 'moveXEvents' ? 'moveYEvents' : 'moveXEvents';
    const source = { chart, eventLayer: this.session.eventLayer };
    const event = eventListAt(source, mode.lineIndex, mode.type)[mode.index];
    if (!event || event.trajectory) return null;
    const sameBeat = (left, right) => {
      beatValue(left); beatValue(right);
      const [leftWhole, leftNumerator, leftDenominator] = left.map(BigInt);
      const [rightWhole, rightNumerator, rightDenominator] = right.map(BigInt);
      return (leftWhole * leftDenominator + leftNumerator) * rightDenominator
        === (rightWhole * rightDenominator + rightNumerator) * leftDenominator;
    };
    const candidates = eventListAt(source, mode.lineIndex, companionType)
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate }) => !candidate.trajectory
        && sameBeat(candidate.startTime, event.startTime)
        && sameBeat(candidate.endTime, event.endTime));
    return candidates.length === 1 ? { type: companionType, index: candidates[0].index } : null;
  }

  samplingChart(chart) {
    if (this.displayCache?.source === chart && this.displayCache.mode === this.mode) return this.displayCache.chart;
    const mode = this.mode;
    const event = eventListAt({ chart, eventLayer: this.session.eventLayer }, mode.lineIndex, mode.type)?.[mode.index];
    const display = { ...event, start: event[mode.field], end: event[mode.field] };
    const updates = new Map([[mode.type, [display]]]);
    if (mode.paired) {
      const paired = eventListAt({ chart, eventLayer: this.session.eventLayer }, mode.lineIndex, mode.paired.type)?.[mode.paired.index];
      if (paired) updates.set(mode.paired.type, [{ ...paired, start: paired[mode.field], end: paired[mode.field] }]);
    }
    const result = chartWithEventLists(chart, mode.lineIndex, this.session.eventLayer, updates);
    this.displayCache = { source: chart, mode, chart: result };
    return result;
  }

  handle(chart) {
    const mode = this.mode; const line = chart.judgeLineList?.[mode.lineIndex];
    this.scene.compile(this.samplingChart(chart), this.context.tempo);
    const renderer = this.context.previewVisible ? this.context.preview : this.context.realtimePreview;
    const state = this.scene.sampler(this.seconds, previewPositionScale(renderer.aspectRatio ?? 1.5))(mode.lineIndex) ?? { x: 0, y: 0, rotation: 0 };
    const local = mode.type === 'rotateEvents' ? { x: 0, y: -300 } : { x: 0, y: 0 };
    const angle = state.rotation * Math.PI / 180;
    return { x: state.x + local.x * Math.cos(angle) + local.y * Math.sin(angle), y: -state.y + local.x * Math.sin(angle) - local.y * Math.cos(angle), line };
  }

  applyPoint(point) {
    const mode = this.mode; const current = this.handle(this.draftChart); const event = eventListAt({ chart: this.draftChart, eventLayer: this.session.eventLayer }, mode.lineIndex, mode.type)?.[mode.index];
    if (!event) return;
    if (mode.paired) {
      const paired = eventListAt({ chart: this.draftChart, eventLayer: this.session.eventLayer }, mode.lineIndex, mode.paired.type)?.[mode.paired.index];
      if (!paired) return;
      let value = Number(event[mode.field]), pairedValue = Number(paired[mode.field]);
      const probe = this.handle(this.eventChart(value + 1, pairedValue));
      const pairedProbe = this.handle(this.eventChart(value, pairedValue + 1));
      const horizontal = probe.x - current.x, vertical = probe.y - current.y;
      const pairedHorizontal = pairedProbe.x - current.x, pairedVertical = pairedProbe.y - current.y;
      const determinant = horizontal * pairedVertical - pairedHorizontal * vertical;
      if (Math.abs(determinant) < 1e-10) return;
      const errorX = point.x - current.x, errorY = point.y - current.y;
      value += (errorX * pairedVertical - errorY * pairedHorizontal) / determinant;
      pairedValue += (horizontal * errorY - vertical * errorX) / determinant;
      if (!Number.isFinite(value) || !Number.isFinite(pairedValue)) return;
      this.draftChart = this.eventChart(round(value), round(pairedValue)); this.invalidate(); return;
    }
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
    context.save(); context.strokeStyle = '#70efaa'; context.lineWidth = 2; context.beginPath(); context.moveTo(point.x - 16, point.y); context.lineTo(point.x + 16, point.y); context.moveTo(point.x, point.y - 16); context.lineTo(point.x, point.y + 16); context.stroke(); context.fillStyle = '#d2ffe4'; context.font = '13px sans-serif'; context.fillText(t('event-sampler.sc21adcc'), 14, height - 18); context.restore();
  }
}
