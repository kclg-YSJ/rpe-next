import { createNoiseArea, createNoiseEvent, noiseCenter, noiseHasAnchor, noiseRuntime, noiseActivationIntervals, NOISE_TRACKS, withNoiseAreas, shiftNoiseArea } from '../core/noise-areas.mjs';
import { samplingTarget, sampleEditingArea, noiseSampleHandle, applyNoiseSample, fitNoiseSampleView } from '../core/noise-sampling.mjs';
import { beatValue, fromNumber, parseBeat, formatBeat } from '../core/beat.mjs';
import { previewViewport, previewPositionScale, previewNoiseGeometry, strokeIntersects } from '../core/editor-display.mjs';
import { prepareCanvas } from './timeline.mjs';
import { createCustomEasingControls } from './custom-easing-controls.mjs';
import { previewCurveEvent } from '../application/animation-curve-preview.mjs';
import { withStandardEasing, rebaseCustomEventValues } from '../core/event-easing.mjs';
import { createEasingPicker, EASING_NAMES } from './easing-picker.mjs';
import { NoiseAreaList } from './noise-list.mjs';
import { NoiseLayerPanel } from './noise-layer-panel.mjs';
import { noiseLayers, noiseLayerId } from '../core/noise-skin.mjs';
import { drawEventCurve, drawEventCurveBatch } from './event-curve.mjs';
import { eventDisplayIndex, selectedEventGroups } from './event-display-index.mjs';
import { evaluateEventNumber } from '../core/numeric-expression.mjs';
import { numericExpressionSource, setNumericExpressionResolver } from './numeric-expression-input.mjs';
import { intervalSelection, extendIntervalSelection } from '../core/selection-interval.mjs';
import { IntervalIndex } from '../core/interval-index.mjs';
import { drawEditorJudgement, editorJudgementWidth } from './editor-judgement.mjs';
import { dragEventEndpoint } from '../core/event-drag.mjs';
import { t } from '../i18n.mjs';
import { selectionCounts } from '../application/selection-count.mjs';
import { displayNumber, displayPosition } from './spatial-display.mjs';
import { SamplingControls } from './sampling-controls.mjs';
import { SamplingTargets } from './sampling-targets.mjs';
import { samplingPreferences } from '../platform/sampling-preferences.mjs';
import { snapSamplePoint, snapSampleAngle, snapConstrainedPoint } from '../core/sampling-grid.mjs';
import { drawSamplingGrid, drawSnapGuides } from './sampling-guides.mjs';
import { copyEventValueMemory, rememberEventValueChange, withEventLock } from '../application/event-value-memory.mjs';
import { captureNoiseEdit, noiseEventTool, applyNoiseEdit, mirrorNoiseEvent, mirrorNoiseArea } from '../application/noise-edit.mjs';
import { NoiseMultiEditPanel } from './noise-multi-edit.mjs';
import { canCutEvent } from '../application/event-tools.mjs';
import { EVENT_WHEEL_STEPS } from '../core/note-editing.mjs';

function button(text, title, run) {
  const control = document.createElement('button'); control.type = 'button'; control.textContent = text; control.title = title; control.onclick = run; return control;
}
function hint(text) { const node = document.createElement('p'); node.className = 'hint'; node.textContent = text; return node; }
const round = value => Math.round(value * 10000) / 10000;
const durationText = value => String(Math.round(Math.max(0, Number(value) || 0) * 1000) / 1000);
const readyFlashValue = value => typeof value === 'boolean' ? (value ? 0.5 : 0) : Number.isFinite(value) ? Math.max(0, value) : 0.5;
const colors = ['#e5ab66', '#82b8df', '#b1b0e4', '#e9a4b0', '#86c3aa', '#d0bd7b'];
const HEADER_HEIGHT = 0;
const AREA_BAR_WIDTH = 60;
const setProperty = (control, property, value) => { if (control[property] !== value) control[property] = value; };

export class NoiseAreaEditor {
  constructor(host, canvas, getContext, options) {
    Object.assign(this, options); this.host = host; this.canvas = canvas; this.getContext = getContext;
    this.properties = document.querySelector('#noise-properties'); this.active = false; this.selected = -1; this.selection = new Set();
    this.properties.addEventListener('pointerdown', event => {
      this.propertyPointer?.release();
      const release = finish => {
        if (finish && finish.type !== 'blur' && finish.pointerId !== event.pointerId) return;
        this.propertyPointer = null;
        window.removeEventListener('pointerup', release, true); window.removeEventListener('pointercancel', release, true); window.removeEventListener('blur', release);
      };
      this.propertyPointer = { target: event.target, release };
      window.addEventListener('pointerup', release, true); window.addEventListener('pointercancel', release, true); window.addEventListener('blur', release);
    }, true);
    this.event = null; this.cursor = null; this.rects = []; this.clipboard = null; this.pending = null; this.draftChart = null; this.easingState = { open: false };
    this.distributions = new WeakMap(); this.hiddenLayers = new Set(); this.simpleLayers = new Set();
    this.areaList = new NoiseAreaList(index => this.select(index));
    this.layerPanel = new NoiseLayerPanel(this);
    this.modeHeader = document.createElement('span'); this.modeHeader.className = 'noise-mode-head'; this.modeHeader.hidden = true;
    this.modePrimary = document.createElement('span'); this.modePrimary.className = 'noise-mode-primary';
    const modeTitle = document.createElement('strong'); modeTitle.textContent = t('noise-area.s0f8a536');
    this.modeCount = document.createElement('small'); this.modeCount.className = 'noise-mode-count'; this.modeOwner = document.createElement('span'); this.modeOwner.className = 'noise-mode-owner';
    this.modePrimary.append(modeTitle, this.modeCount, this.modeOwner);
    const spacer = document.createElement('span'); spacer.className = 'noise-mode-spacer';
    this.modeTracks = NOISE_TRACKS.map(([, label]) => { const item = document.createElement('span'); item.className = 'noise-mode-track'; item.textContent = label; return item; });
    const trailing = document.createElement('span'); trailing.className = 'noise-mode-spacer';
    this.modeHeader.append(this.modePrimary, spacer, ...this.modeTracks, trailing);
    document.querySelector('.timeline-head').append(this.modeHeader);
    this.overlay = document.createElement('canvas'); this.overlay.className = 'noise-sampler'; this.overlay.hidden = true; canvas.closest('.stage').append(this.overlay);
    this.sampleBar = document.createElement('div'); this.sampleBar.className = 'sampling-dock'; this.sampleBar.hidden = true;
    this.sampleBar.classList.add('sampling-dock'); document.querySelector('[data-panel="noise-properties"]').prepend(this.sampleBar);
    this.sampleControls = new SamplingControls(this.sampleBar,{change:()=>this.invalidate(),apply:()=>this.endSample(true),cancel:()=>this.endSample(false)}); this.sampleTargets=new SamplingTargets();
    for (const [name, handler] of [['pointerdown', event => this.down(event)], ['pointermove', event => this.move(event)], ['pointerup', event => this.up(event)], ['pointercancel', () => this.cancelGesture()]]) canvas.addEventListener(name, handler);
    canvas.addEventListener('wheel', event => { event.preventDefault(); event.stopPropagation(); if (!this.sampleMode) { this.wheel(event); this.cursor = this.point(event); this.updateDrag(); } }, { passive: false });
    canvas.addEventListener('contextmenu', event => { event.preventDefault(); if (this.suppressContextMenu || this.drag?.endpoint) { this.suppressContextMenu = false; event.stopImmediatePropagation?.(); return; } this.pending = null; this.onContextMenu?.(event); this.invalidate(); });
    canvas.addEventListener('auxclick', event => event.preventDefault());
    this.overlay.addEventListener('pointerdown', event => this.sampleDown(event));
    this.overlay.addEventListener('pointermove', event => this.sampleMove(event));
    this.overlay.addEventListener('pointerup', event => { this.sampleDrag = null; this.overlay.releasePointerCapture?.(event.pointerId); });
    this.overlay.addEventListener('pointercancel', () => { this.sampleDrag = null; });
    this.canvas.addEventListener('pointerleave', () => { if (!this.drag) { this.cursor = null; this.hover = null; this.canvas.style.cursor = 'default'; this.invalidate(); } });
  }
  get context() { return this.drawingContext ?? this.getContext(); }
  get chart() { return this.drawingChart ?? this.draftChart ?? this.context.session.chart; }
  areas() { return this.chart.blockAreaList ?? []; }
  visibleAreas(start, end) {
    const areas = this.areas();
    if (this.indexedAreas !== areas || this.indexedAreaCount !== areas.length) {
      this.areaIndex = new IntervalIndex(areas, area => beatValue(area.appearTime), area => beatValue(area.disappearTime));
      this.indexedAreas = areas; this.indexedAreaCount = areas.length;
    }
    return this.areaIndex.query(Math.min(start, end) - 1e-8, Math.max(start, end) + 1e-8).sort((first, second) => first.index - second.index);
  }
  area() { return this.areas()[this.selected]; }
  open() { this.active = true; this.context.timeline.origin = this.context.tempo.beat(this.context.seconds()); this.syncChrome(); this.activate('noise'); this.render(); this.invalidate(); }
  close() { this.batch?.hide(); this.flush(); this.cancelGesture(); this.endSample(false); this.active = false; this.context.timeline.origin = this.context.tempo.beat(this.context.seconds(), this.context.session.line?.bpmfactor ?? 1); this.syncChrome(); this.activate('chart'); this.invalidate(); }
  reset() { this.batch?.hide(); this.cancelGesture(); this.endSample(false); this.active = false; this.selected = -1; this.selection.clear(); this.event = null; this.pending = null; this.hiddenLayers.clear(); this.simpleLayers.clear(); this.areaList.reset(); this.syncChrome(); }
  syncChrome() {
    document.querySelector('.editor').classList.toggle('noise-mode', this.active);
    setProperty(this.modeHeader, 'hidden', !this.active);
    setProperty(this.modeCount, 'textContent', t('noise-area.s5d85ca8', { p0: this.areas().length }));
    setProperty(this.modeOwner, 'textContent', this.area() ? `#${this.selected} ${this.area().Name || '未命名噪域'}` : t('noise-area.sd7b34fd'));
    if (this.active && !this.canvas.hidden) {
      const layout = this.layout();
      const columns = `${layout.split}px 30px repeat(${NOISE_TRACKS.length}, ${layout.eventWidth}px) 10px`;
      if (layout.width > 0 && columns !== this.headerColumns) { this.modeHeader.style.gridTemplateColumns = columns; this.headerColumns = columns; }
    }
    setProperty(this.canvas, 'hidden', !this.active || this.context.previewVisible || Boolean(this.sampleMode));
    setProperty(document.querySelector('#noise-tab'), 'hidden', !this.active);
    setProperty(this.overlay, 'hidden', !this.sampleMode); setProperty(this.sampleBar, 'hidden', !this.sampleMode);
    if(this.properties)this.properties.hidden=Boolean(this.sampleMode);
    document.querySelector('.editor').classList.toggle('noise-sampling', Boolean(this.sampleMode));
    setProperty(document.querySelector('#mirror'), 'disabled', this.active);
    setProperty(document.querySelector('#batch-run'), 'disabled', this.active || !this.context.session.selection.size);
    setProperty(document.querySelector('#notes-only'), 'disabled', this.active || this.context.session.multiLineActive);
    const selected = selectionCounts(this.context.session);
    setProperty(document.querySelector('#selection-info'), 'textContent', this.active ? t('noise-area.s9b7b953', { p0: this.selection.size, p1: this.event || [...this.selection].some(key => !key.startsWith('area:')) ? t('noise-area.s02d2cee') : '' }) : this.context.session.focus === 'events' ? t('noise-area.sdd39156', { p0: selected.events }) : t('noise-area.s94b23eb', { p0: selected.notes }));
    if (!this.sampleMode) setProperty(document.querySelector('#realtime-preview'), 'hidden', !this.context.realtimePreview.visible);
  }
  report(error) { this.notify(error.message, 'error'); }
  commitAreas(label, areas) {
    try {
      const chart = withNoiseAreas(this.context.session.chart, areas);
      this.draftChart = null; this.commit(label, chart); this.render(); this.invalidate(); return true;
    } catch (error) { this.report(error); this.draftChart = null; this.invalidate(); return false; }
  }
  replaceArea(area, base = this.context.session.chart) {
    return withNoiseAreas(base, (base.blockAreaList ?? []).map((entry, index) => index === this.selected ? area : entry));
  }
  edit(change, finish = true, valueField) {
    if (!this.area()) return;
    try {
      const source = this.area();
      const previous = this.event ? source[this.event.type]?.[this.event.index] : null;
      const area = change(structuredClone(source));
      if (previous) area[this.event.type][this.event.index] = rebaseCustomEventValues(previous, area[this.event.type][this.event.index]);
      if (previous?.linkgroup > 0 && this.event.type !== 'activeIntervals') {
        const next = area[this.event.type][this.event.index];
        const fields = ['start', 'end', 'easingType', 'easingLeft', 'easingRight', 'bezier', 'bezierPoints', 'customEasing'];
        if (fields.some(field => JSON.stringify(previous[field]) !== JSON.stringify(next[field]))) area[this.event.type] = area[this.event.type].map((entry, index) => {
          if (index === this.event.index || entry.linkgroup !== previous.linkgroup) return entry;
          const linked = { ...entry, ...Object.fromEntries(fields.map(field => [field, structuredClone(next[field])])) };
          if (linked.inst) linked.end = linked.start;
          return linked;
        });
      }
      this.draftChart = this.replaceArea(area);
      const session = this.context.session;
      copyEventValueMemory(session, ({ type, index }) => source[type]?.[index], ({ type, index }) => area[type]?.[index]);
      if (previous) rememberEventValueChange(session, previous, area[this.event.type][this.event.index], valueField, this.event);
      if (finish) this.flush();
      this.invalidate();
    } catch (error) { if (finish) this.report(error); return false; }
    return true;
  }
  flush() {
    if (!this.draftChart || this.sampleMode) return;
    const chart = this.draftChart; this.draftChart = null; this.formCommitting = true;
    try { this.commit(t('noise-area.saf782f6'), chart); } catch (error) { this.report(error); }
    finally { this.formCommitting = false; }
    this.render(); this.invalidate();
  }
  select(index, event = null, extend = false) {
    this.flush(); this.selected = index; this.event = event; this.pending = null;
    const key = event ? event.type + ':' + event.index : 'area:' + index;
    if (extend && [...this.selection].some(entry => entry.startsWith('area:') === Boolean(event))) this.selection.clear();
    if (!extend) this.selection.clear();
    if (extend && this.selection.has(key)) this.selection.delete(key); else this.selection.add(key);
    this.activate('noise-properties'); this.render(); this.invalidate();
  }
  add(start, end, horizontal) {
    const areas = [...this.areas(), { ...createNoiseArea(start, end), layerId: noiseLayers(this.chart)[0].id, editorPositionX: this.editorX(horizontal) }]; const index = areas.length - 1;
    if (this.commitAreas(t('noise-area.sea27c43'), areas)) this.select(index);
  }
  addEvent(type, start, end, hooked = false, easingType) {
    const area = this.area(); if (!area) { this.notify(t('noise-area.s0c2a653'), 'warning'); return; }
    const sample = noiseRuntime(area, this.context.tempo).sample(this.context.tempo.seconds(start));
    const previous = (area[type] ?? []).filter(event => beatValue(event.endTime) <= start).sort((a, b) => beatValue(b.startTime) - beatValue(a.startTime))[0];
    const value = previous?.end ?? sample.values[type]?.value ?? 0;
    const inherited = previous ? Object.fromEntries(['easingType', 'easingLeft', 'easingRight', 'bezier', 'bezierPoints', 'customEasing'].filter(key => previous[key] !== undefined).map(key => [key, structuredClone(previous[key])])) : {};
    let event = type === 'activeIntervals' ? { startTime: fromNumber(start), endTime: fromNumber(end), readyFlash: 0.5 } : { ...createNoiseEvent(value, value, start, end, noiseHasAnchor(type) ? previous?.anchor ?? sample.values[type]?.event?.anchor ?? noiseCenter(area) : undefined), ...inherited, inst: hooked ? 1 : 0 };
    if (type !== 'activeIntervals' && event.customEasing) event = rebaseCustomEventValues(previous, event);
    if (type !== 'activeIntervals' && easingType !== undefined) event = withStandardEasing(event, easingType);
    const events = [...(area[type] ?? []), event]; const areas = this.areas().map((entry, index) => index === this.selected ? { ...entry, [type]: events } : entry);
    if (this.commitAreas(t('noise-area.s074f6c7') + NOISE_TRACKS.find(track => track[0] === type)[1], areas)) this.select(this.selected, { type, index: events.length - 1 });
  }
  remove() {
    const keys = this.selection;
    if (!keys.size) return;
    let areas = this.areas();
    if ([...keys].some(key => key.startsWith('area:'))) { areas = areas.filter((area, index) => !keys.has('area:' + index)); this.selected = -1; }
    else if (this.area()) areas = areas.map((area, index) => index === this.selected ? { ...area, ...Object.fromEntries(NOISE_TRACKS.map(([type]) => [type, (area[type] ?? []).filter((event, eventIndex) => !keys.has(type + ':' + eventIndex))])) } : area);
    this.selection.clear(); this.event = null; this.commitAreas(t('noise-area.s61bcef5'), areas);
    if (this.selected === -1) this.activate('noise');
  }
  copy(cut = false) {
    const entries = []; const area = this.area();
    for (const key of this.selection) {
      const [type, index] = key.split(':'); const source = type === 'area' ? this.areas()[index] : area?.[type]?.[index];
      if (source) entries.push({ type, value: type === 'area' ? { ...structuredClone(source), editorPositionX: this.editorX(this.areaX(source, Number(index))) } : structuredClone(source) });
    }
    if (!entries.length) return;
    this.clipboard = { entries, start: Math.min(...entries.map(entry => beatValue(entry.value[entry.type === 'area' ? 'appearTime' : 'startTime']))) };
    if (cut) this.remove();
    this.notify(cut ? t('noise-area.sff296eb') : t('noise-area.se204bc7'), 'success'); this.invalidate();
  }
  pastedAreas(at, keepTime = false, mirror = false) {
    const areas = [...this.areas()]; const delta = keepTime ? 0 : at - this.clipboard.start;
    const firstArea = this.clipboard.entries.find(entry => entry.type === 'area');
    const deltaX = firstArea && this.cursor?.side === 'areas' ? this.editorX(this.cursor.x) - firstArea.value.editorPositionX : 0;
    for (const entry of this.clipboard.entries) {
      if (entry.type === 'area') {
        const sourceLayer = noiseLayerId(entry.value); const layers = noiseLayers(this.chart);
        areas.push({ ...shiftNoiseArea(mirror ? mirrorNoiseArea(entry.value) : entry.value, delta), layerId: layers.some(layer=>layer.id===sourceLayer) ? sourceLayer : layers[0].id, editorPositionX: Math.max(-675, Math.min(675, entry.value.editorPositionX + deltaX)) });
      }
      else {
        if (!areas[this.selected]) throw new Error(t('noise-area.s1186146'));
        const area = areas[this.selected]; const value = { ...(mirror ? mirrorNoiseEvent(entry.type, entry.value) : structuredClone(entry.value)), startTime: fromNumber(beatValue(entry.value.startTime) + delta), endTime: fromNumber(beatValue(entry.value.endTime) + delta) };
        areas[this.selected] = { ...area, [entry.type]: [...(area[entry.type] ?? []), value] };
      }
    }
    return areas;
  }
  action(action, input) {
    if (!this.active) return false;
    if (input?.repeat && ['SwitchLock', 'StickNext', 'AddTap', 'AddEvent', 'AddHold'].includes(action)) return true;
    if (this.pending && /^[0-9]$/.test(input?.key ?? '') && !input.ctrlKey && !input.altKey) { this.place(false, Number(input.key) || 10); return true; }
    if (action === 'Esc') {
      if (this.sampleMode) this.endSample(false);
      else { this.cancelGesture(); this.selection.clear(); this.event = null; this.pending = null; this.clipboard = null; this.activate('noise'); this.render(); }
    } else if (this.sampleMode) return ['Copy', 'Shear', 'Paste', 'Delete', 'QuickDelete', 'AddTap', 'AddEvent'].includes(action);
    else if (action === 'Copy' || action === 'Shear') this.copy(action === 'Shear');
    else if (['Delete', 'QuickDelete'].includes(action)) this.remove();
    else if (['Paste', 'KeepTimePaste', 'PasteMirror', 'KeepTimePasteMirror'].includes(action)) {
      if (this.clipboard) {
        try { this.commitAreas(t('noise-area.see88999'), this.pastedAreas(this.cursor?.beat ?? this.context.timeline.origin, action.startsWith('KeepTime'), action.endsWith('Mirror'))); } catch (error) { this.report(error); }
      }
    } else if (action === 'SelectAll') {
      this.selection = new Set(this.cursor?.side === 'events' && this.area() ? NOISE_TRACKS.flatMap(([type]) => (this.area()[type] ?? []).map((entry, index) => type + ':' + index)) : this.areas().map((area,index) => 'area:' + index)); this.render();
    } else if (['AddTap', 'AddHold', 'AddEvent'].includes(action)) this.place(action === 'AddTap');
    else if (action === 'NumberMirror') {
      if (this.selection.size === 1 && this.event && ['moveXEvents', 'moveYEvents', 'rotateEvents'].includes(this.event.type)) {
        this.edit(area => {
          const event = area[this.event.type]?.[this.event.index]; if (!event) return area;
          event.start = -event.start; event.end = -event.end;
          return area;
        });
      }
    } else if (action === 'PageUp' || action === 'PageDown') {
      const delta = (action === 'PageUp' ? 1 : -1) / Math.max(1, this.context.timeline.division);
      const selected = [...this.selection].filter(key => !key.startsWith('area:'));
      if (selected.length) this.edit(area => {
        for (const key of selected) {
          const [type, rawIndex] = key.split(':'); const index = Number(rawIndex); const event = area[type]?.[index];
          if (!event) continue;
          event.startTime = fromNumber(beatValue(event.startTime) + delta);
          event.endTime = fromNumber(beatValue(event.endTime) + delta);
        }
        return area;
      });
    } else if (['SwitchLock', 'StickNext'].includes(action)) {
      const snapshot = captureNoiseEdit(this);
      if (snapshot.mode !== 'events' || this.selection.size !== 1 || this.event?.type === 'activeIntervals') return true;
      if (action === 'SwitchLock') {
        const { type, index } = this.event;
        this.edit(area => { area[type][index] = withEventLock(this.context.session, this.area()[type][index], !this.area()[type][index].inst); return area; });
      } else {
        const result = noiseEventTool(snapshot, 'next');
        if (result.chart) applyNoiseEdit(this, result, t('event-tools.s3c9157f'));
      }
    }
    else if (['SwitchUI', 'ToggleMultiLine', 'SwitchMultiLineMode', 'NumberFill', 'AddDrag', 'AddFlick', 'CurveBegin', 'CurveEnd'].includes(action) || action === 'PageLeft' || action === 'PageRight') return true;
    else return false;
    this.invalidate(); return true;
  }
  cutSingleEvent() {
    this.flush();
    if (this.selection.size !== 1 || !this.event || this.event.type === 'activeIntervals') return;
    try {
      const { timeline, tempo, session } = this.context;
      const result = noiseEventTool(captureNoiseEdit(this), 'cut', { division: timeline.division, density: session.cutDensity, beat: timeline.origin, tempo });
      if (applyNoiseEdit(this, result, t('event-tools.s9fda3f9'))) this.notify(t('event-tools.sdf97600', { p0: result.report.changed, p1: result.report.generated }), 'success');
      else this.notify(t('event-tools.s955964e'), 'warning');
    } catch (error) { this.report(error); }
  }
  layout() {
    if (this.drawingLayout) return this.drawingLayout;
    const { width, height } = this.canvas.getBoundingClientRect(); const split = Math.round(width * 0.43);
    return { width, height, split, eventLeft: split + 30, eventWidth: Math.max(1, (width - split - 40) / NOISE_TRACKS.length) };
  }
  eventBounds(type) {
    const { eventLeft, eventWidth } = this.layout(); const column = NOISE_TRACKS.findIndex(track => track[0] === type);
    const width = Math.max(1, eventWidth - Math.max(16, eventWidth * 0.22));
    return { x: eventLeft + (column + 0.5) * eventWidth - width / 2, width };
  }
  editorX(horizontal) { return Math.max(-675, Math.min(675, ((horizontal - AREA_BAR_WIDTH / 2) / Math.max(1, this.layout().split - AREA_BAR_WIDTH) - 0.5) * 1350)); }
  areaX(area, index) { const position = Number.isFinite(area.editorPositionX) ? area.editorPositionX : -540 + index % 6 * 216; return AREA_BAR_WIDTH / 2 + (position / 1350 + 0.5) * Math.max(1, this.layout().split - AREA_BAR_WIDTH); }
  diagnosticBounds(index, type, eventIndex) {
    const area = this.areas()[index], event = type ? area?.[type]?.[eventIndex] : area; if (!event) return null;
    const head = this.y(beatValue(type ? event.startTime : area.appearTime)), tail = this.y(beatValue(type ? event.endTime : area.disappearTime));
    const bounds = type ? this.eventBounds(type) : { x: this.areaX(area, index) - AREA_BAR_WIDTH / 2, width: AREA_BAR_WIDTH };
    return { canvas: this.canvas, ...bounds, y: Math.min(head, tail) - 2, height: Math.max(8, Math.abs(tail - head) + 4) };
  }
  hit(point) { return this.rects.findLast(rect => Boolean(rect.type) === (point.side === 'events') && point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= Math.max(HEADER_HEIGHT, rect.y - 5) && point.y <= rect.y + rect.height + 5); }
  endpointTarget(point = this.cursor) {
    if (point?.side !== 'events' || this.context.timeline.rpeEventDrag !== true || !this.context.timeline.eventEndpointDragHeld || this.selection.size !== 1 || this.pending) return null;
    const [type, index] = [...this.selection][0].split(':'); return type !== 'area' && this.area()?.[type]?.[index] ? { type, index: Number(index) } : null;
  }
  hitKind(rect, point) { return rect.type && this.context.timeline.rpeEventDrag === true ? 'move' : Math.abs(point.y - rect.head) <= 7 ? 'start' : Math.abs(point.y - rect.tail) <= 7 ? 'end' : 'move'; }
  syncHover() { const hit = this.cursor && this.hit(this.cursor); this.hover = hit ? { ...hit, kind: this.hitKind(hit, this.cursor) } : null; this.canvas.style.cursor = this.drag?.endpoint || this.endpointTarget() ? 'ns-resize' : this.drag && ['move', 'start', 'end'].includes(this.drag.kind) ? this.drag.kind === 'move' ? 'grabbing' : 'ns-resize' : this.hover ? this.hover.kind === 'move' ? 'grab' : 'ns-resize' : 'default'; }
  y(beat) { const { timeline, tempo } = this.context; return this.layout().height - timeline.judgementOffset - (tempo.seconds(beat) - tempo.seconds(timeline.origin)) * timeline.scale; }
  beatAt(vertical, snap = true) {
    const { timeline, tempo } = this.context;
    const value = tempo.beat(tempo.seconds(timeline.origin) + (this.layout().height - timeline.judgementOffset - vertical) / timeline.scale);
    return snap ? Math.round(value * timeline.division) / timeline.division : value;
  }
  point(event) {
    const rect = this.canvas.getBoundingClientRect(); const x = event.clientX - rect.left; const y = event.clientY - rect.top; const layout = this.layout();
    const side = x < layout.split ? 'areas' : 'events'; const column = Math.max(0, Math.min(5, Math.floor((x - layout.eventLeft) / layout.eventWidth)));
    return { x, y, side, type: NOISE_TRACKS[column][0], beat: this.beatAt(y), rawBeat: this.beatAt(y, false) };
  }
  place(hooked = false, easingType) {
    if (!this.cursor || this.cursor.y < HEADER_HEIGHT) return;
    if (!this.pending) this.pending = { ...this.cursor, hooked };
    else {
      const start = Math.min(this.pending.beat, this.cursor.beat); const end = Math.max(this.pending.beat, this.cursor.beat);
      if (this.pending.side === 'areas') this.add(start, end, this.pending.x);
      else this.addEvent(this.pending.type, start, end, this.pending.hooked, easingType);
      this.pending = null;
    }
    this.invalidate();
  }
  down(event) {
    if (![0, 1, 2].includes(event.button)) return;
    const point = this.point(event), endpoint = [0, 2].includes(event.button) && this.endpointTarget(point);
    if (point.y < HEADER_HEIGHT || event.button === 2 && !endpoint) return;
    event.preventDefault(); event.stopPropagation(); this.flush(); this.pause(); this.cursor = this.point(event); this.canvas.focus();
    this.suppressContextMenu = false;
    if (endpoint) {
      this.canvas.setPointerCapture(event.pointerId); this.event = endpoint; this.activate('noise-properties');
      this.drag = { kind: event.button === 0 ? 'start' : 'end', endpoint: true, start: this.cursor, hit: endpoint, base: this.context.session.chart, keys: new Set(this.selection), moved: false };
      this.suppressContextMenu = event.button === 2; this.updateDrag(); return;
    }
    if (this.drag?.kind === 'rectangle') { this.up(event, true); return; }
    this.canvas.setPointerCapture(event.pointerId);
    const hit = this.hit(this.cursor);
    if (hit && !event.shiftKey && event.button !== 1) {
      const key = hit.type ? hit.type + ':' + hit.index : 'area:' + hit.index;
      if (!this.selection.has(key) || event.ctrlKey) this.select(hit.type ? this.selected : hit.index, hit.type ? { type: hit.type, index: hit.index } : null, event.ctrlKey);
      else { if (!hit.type) this.selected = hit.index; this.event = hit.type ? { type: hit.type, index: hit.index } : null; this.activate('noise-properties'); this.render(); }
      const kind = this.hitKind(hit, this.cursor);
      this.drag = { kind, start: this.cursor, hit, base: this.context.session.chart, keys: new Set(this.selection), moved: false };
    } else if (event.shiftKey || event.button === 1) {
      this.pending = null; this.drag = { kind: 'rectangle', start: this.cursor, current: this.cursor, baseSelection: new Set(this.selection), moved: false };
    } else {
      if (!event.ctrlKey) this.selection.clear();
      this.event = null; this.pending = null;
      this.drag = { kind: 'stroke', start: this.cursor, current: this.cursor, points: [this.cursor], moved: false };
      this.render();
    }
    this.syncHover(); this.invalidate();
  }
  move(event) {
    this.cursor = this.point(event);
    this.updateDrag();
  }
  updateDrag() {
    this.syncHover();
    if (!this.drag) { this.invalidate(); return; }
    if (this.drag.endpoint && !this.context.timeline.eventEndpointDragHeld) { this.invalidate(); return; }
    const drag = this.drag; const previous = drag.current ?? drag.start; drag.current = this.cursor;
    drag.moved ||= Math.hypot(this.cursor.x - drag.start.x, this.cursor.y - drag.start.y) > 4;
    if (drag.kind === 'stroke' && drag.moved) {
      drag.points.push(this.cursor);
      const candidates = [];
      for (const rect of this.rects) if (Boolean(rect.type) === (drag.start.side === 'events') && strokeIntersects({ x: previous.x, y: this.y(previous.rawBeat) }, this.cursor, { left: rect.x, right: rect.x + rect.width, top: rect.y, bottom: rect.y + rect.height })) {
        const entry = rect.type ? this.area()?.[rect.type]?.[rect.index] : this.areas()[rect.index];
        candidates.push({ key: rect.type ? rect.type + ':' + rect.index : 'area:' + rect.index, group: rect.type ?? '', start: beatValue(rect.type ? entry.startTime : entry.appearTime) });
      }
      if (candidates.length && [...this.selection].some(key => key.startsWith('area:') !== (drag.start.side === 'areas'))) this.selection.clear();
      extendIntervalSelection(drag, candidates, this.selection, this.context.timeline.selectionInterval);
    }
    if (drag.kind === 'rectangle' || drag.kind === 'stroke' || !drag.moved && !drag.endpoint) { this.invalidate(); return; }
    if (drag.endpoint) {
      const original = drag.base.blockAreaList?.[this.selected]?.[drag.hit.type]?.[drag.hit.index];
      if (!original) { this.cancelGesture(); return; }
      const next = dragEventEndpoint(original, drag.kind === 'start' ? 'startTime' : 'endTime', this.cursor.beat);
      if (beatValue(next.startTime) === beatValue(original.startTime) && beatValue(next.endTime) === beatValue(original.endTime)) { this.draftChart = null; this.dragError = null; this.invalidate(); return; }
    }
    const delta = this.cursor.beat - drag.start.beat; const areas = structuredClone(drag.base.blockAreaList ?? []);
    for (const key of drag.keys) {
      const [type, rawIndex] = key.split(':'); const index = Number(rawIndex);
      const entry = type === 'area' ? areas[index] : areas[this.selected]?.[type]?.[index]; if (!entry) continue;
      const startKey = type === 'area' ? 'appearTime' : 'startTime'; const endKey = type === 'area' ? 'disappearTime' : 'endTime';
      if (drag.endpoint) Object.assign(entry, dragEventEndpoint(entry, drag.kind === 'start' ? 'startTime' : 'endTime', this.cursor.beat));
      else if (drag.kind === 'move') {
        if (type === 'area') areas[index] = { ...shiftNoiseArea(entry, delta), editorPositionX: this.editorX(this.areaX(entry, index) + this.cursor.x - drag.start.x) };
        else { entry[startKey] = fromNumber(beatValue(entry[startKey]) + delta); entry[endKey] = fromNumber(beatValue(entry[endKey]) + delta); }
      } else if (key === (drag.hit.type ? drag.hit.type + ':' + drag.hit.index : 'area:' + drag.hit.index)) {
        const name = drag.kind === 'start' ? startKey : endKey;
        entry[name] = fromNumber(drag.kind === 'start' ? Math.min(this.cursor.beat, beatValue(entry[endKey])) : Math.max(this.cursor.beat, beatValue(entry[startKey])));
      }
    }
    try { this.draftChart = withNoiseAreas(drag.base, areas); this.dragError = null; } catch (error) { this.dragError = error; }
    this.invalidate();
  }
  up(event, finish = false) {
    const drag = this.drag; if (!drag) return;
    this.cursor = this.point(event); this.updateDrag();
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
    if (drag.kind === 'rectangle' && !drag.moved && !finish) return;
    this.drag = null;
    if (drag.kind === 'rectangle' || drag.kind === 'stroke') {
      if (drag.kind === 'rectangle') {
      const left = Math.min(drag.start.x, drag.current.x); const right = Math.max(drag.start.x, drag.current.x);
      const start = Math.min(drag.start.rawBeat, drag.current.rawBeat); const end = Math.max(drag.start.rawBeat, drag.current.rawBeat);
      this.selection = new Set([...drag.baseSelection].filter(key => key.startsWith('area:') === (drag.start.side === 'areas')));
      const candidates = [];
      for (const rect of this.selectionRects(drag.start.side)) if (rect.x <= right && rect.x + rect.width >= left && rect.start <= end && rect.end >= start) {
        const key = rect.type ? rect.type + ':' + rect.index : 'area:' + rect.index;
        candidates.push({ key, group: rect.type ?? '', start: rect.start, selected: this.selection.has(key) });
      }
      for (const entry of intervalSelection(candidates, this.context.timeline.selectionInterval)) this.selection.add(entry.key);
      }
      const first = [...this.selection][0]?.split(':');
      if (first) { if (first[0] === 'area') { this.selected = Number(first[1]); this.event = null; } else this.event = { type: first[0], index: Number(first[1]) }; this.activate('noise-properties'); }
      this.render();
    } else if (this.dragError) { this.report(this.dragError); this.draftChart = null; this.dragError = null; }
    else if (this.draftChart) this.flush();
    this.syncHover(); this.invalidate();
  }
  cancelGesture() { this.drag = null; this.pending = null; this.draftChart = null; this.dragError = null; this.invalidate(); }
  autoScroll(elapsed) {
    if (!this.active || !this.drag || !this.cursor || this.sampleMode) return;
    if (this.drag.endpoint && !this.context.timeline.eventEndpointDragHeld) return;
    const { height } = this.layout(); const edge = this.cursor.y < 30 ? 1 : this.cursor.y > height - 20 ? -1 : 0;
    if (edge) { const { tempo, timeline } = this.context; const beat = tempo.beat(tempo.seconds(timeline.origin) + edge * elapsed); this.seek(beat); timeline.origin = beat; this.cursor = { ...this.cursor, beat: this.beatAt(this.cursor.y), rawBeat: this.beatAt(this.cursor.y, false) }; this.updateDrag(); }
  }
  render() {
    this.syncChrome(); if (!this.active || this.formCommitting) return;
    if (!this.area()) { const first = [...this.selection].find(key => key.startsWith('area:') && this.areas()[Number(key.split(':')[1])]); this.selected = first ? Number(first.split(':')[1]) : -1; this.event = null; if (!first) this.selection.clear(); }
    if (this.event && !this.area()?.[this.event.type]?.[this.event.index]) this.event = null;
    if (!this.listTitle) {
      this.host.replaceChildren();
      this.listTitle = document.createElement('div'); this.listTitle.className = 'panel-title'; this.host.append(this.listTitle);
      this.host.append(this.layerPanel.element);
      const actions = document.createElement('div'); actions.className = 'noise-actions';
      actions.append(button(t('noise-area.s173f9e5'), t('noise-area.s3b961ca'), () => this.close())); this.host.append(actions);
      this.host.append(hint(t('noise-area.s7b9bcf4')));
      this.host.append(this.areaList.element);
    }
    this.layerPanel.render();
    const listTitle = t('noise-area.s54cdbff') + this.areas().length;
    if (this.listTitle.textContent !== listTitle) this.listTitle.textContent = listTitle;
    this.areaList.update(this.areas(), this.selected);
    const batchSelection = this.selection.size > 1 ? captureNoiseEdit(this) : null;
    if (batchSelection && (batchSelection.mode === 'areas' || [...this.selection].filter(key => !key.startsWith('activeIntervals:')).length > 0)) {
      this.batch ??= new NoiseMultiEditPanel(this.properties, this);
      this.batch.open(batchSelection); return;
    }
    this.batch?.hide();
    const signature = `${this.selected}/${this.event?.type}/${this.event?.index}`;
    // Committing the old input during pointerdown must not replace the checkbox
    // or button that is about to receive focus and the subsequent click.
    const pointer = this.propertyPointer?.target;
    const focused = pointer?.isConnected && this.properties.contains(pointer) ? pointer : this.properties.contains(document.activeElement) && document.activeElement.matches('input,select') ? document.activeElement : null;
    if (focused && signature === this.formSignature) {
      const snapshot = document.createElement('div'); this.renderProperties(snapshot);
      for (const control of snapshot.querySelectorAll('input,select')) { const existing = [...this.properties.querySelectorAll('input,select')].find(input => input.getAttribute('aria-label') === control.getAttribute('aria-label')); if (existing && existing !== focused) { existing.value = control.value; existing.checked = control.checked; } }
      return;
    }
    this.formSignature = signature;
    const scrollTop = this.host.closest('.inspector').scrollTop;
    this.renderProperties(); this.host.closest('.inspector').scrollTop = scrollTop;
  }
  field(host, labelText, value, apply, { kind = 'number', step = 1, sample, choices, clear = false } = {}) {
    const label = document.createElement('label'); label.className = 'noise-field'; label.append(labelText);
    const controls = document.createElement('span'); controls.className = 'noise-input-controls';
    const input = document.createElement(choices ? 'select' : 'input'); input.setAttribute('aria-label', labelText);
    if (choices) input.replaceChildren(...choices.map(([value, name]) => new Option(name, value)));
    else input.type = kind === 'beat' ? 'text' : kind;
    if (!choices && ['duration', 'beat'].includes(kind)) input.dataset.numericExpression = kind === 'beat' ? 'beat' : 'number';
    if (kind === 'checkbox') input.checked = Boolean(value); else input.value = kind === 'beat' ? formatBeat(value) : kind === 'duration' ? durationText(value) : kind === 'number' && !choices ? round(value) : value;
    input.step = kind === 'number' ? 'any' : String(step);
    const movementExpression = sample?.type === 'moveYEvents' && ['start', 'end'].includes(sample.field);
    const evaluateMovement = source => evaluateEventNumber(source, { type: sample.type, field: sample.field, event: this.area()[sample.type][sample.index], tempo: this.context.tempo });
    if (movementExpression) { setNumericExpressionResolver(input, evaluateMovement); input.title = t('noise-area.s61fd280'); }
    const read = () => kind === 'checkbox' ? input.checked : kind === 'beat' ? parseBeat(input.value) : kind === 'text' ? input.value : movementExpression && String(numericExpressionSource(input)).trim().endsWith('v') ? evaluateMovement(numericExpressionSource(input)) : (input.value.trim() ? Number(input.value) : NaN);
    input.oninput = () => { try { const valid = this.edit(area => apply(area, read()), false, sample?.field); input.setCustomValidity(valid ? '' : t('noise-area.s615582b')); } catch (error) { input.setCustomValidity(error.message); } };
    input.onchange = () => { input.oninput(); if (input.checkValidity()) this.flush(); else this.notify(input.validationMessage, 'error'); };
    if (kind === 'number' || kind === 'duration' || kind === 'beat') {
      input.addEventListener('wheel', event => { event.preventDefault(); event.stopPropagation(); try { const increment = kind === 'beat' ? 1 / this.context.timeline.division : kind === 'duration' ? 0.001 : step; const current = kind === 'beat' ? beatValue(read()) : Number(input.value); const next = current + (event.deltaY < 0 ? increment : -increment); input.value = kind === 'beat' ? formatBeat(fromNumber(next)) : kind === 'duration' ? durationText(next) : round(next); input.onchange(); } catch (error) { this.report(error); } }, { passive: false });
    }
    controls.append(input);
    if (sample) controls.append(button('⌖', t('noise-area.scea01d0') + labelText, () => this.beginSample(sample)));
    if (clear) controls.append(button('×', t('noise-area.sb14037f'), () => { input.value = '0'; input.onchange(); }));
    if (kind === 'beat') { const nudges = document.createElement('span'); nudges.className = 'noise-beat-nudges'; for (const [text, direction] of [['▴', 1], ['▾', -1]]) nudges.append(button(text, t('noise-area.s2b60c30'), () => { try { input.value = formatBeat(fromNumber(beatValue(read()) + direction / this.context.timeline.division)); input.onchange(); } catch (error) { this.report(error); } })); controls.append(nudges); }
    label.append(controls); host.append(label); return input;
  }
  renderProperties(host = this.properties) {
    host.replaceChildren();
    host.append(button(t('noise-area.sfe06303'), t('noise-area.s08b595c'), () => this.activate('noise')));
    const area = this.area(); if (!area) { host.append(hint(t('noise-area.sbbb578e'))); return; }
    const title = document.createElement('h3'); title.textContent = this.event ? NOISE_TRACKS.find(track => track[0] === this.event.type)[1] + t('noise-area.sc76dce1') + this.selected : t('noise-area.s3a2d2c2') + this.selected; host.append(title);
    this.field(host, t('noise-area.sb113df7'), noiseLayerId(area), (item,value) => ({ ...item, layerId:value }), { kind:'text', choices:noiseLayers(this.chart).map(layer=>[layer.id,layer.name]) });
    const modifyEvent = change => item => { const event = item[this.event.type][this.event.index]; change(event); return item; };
    if (this.event) {
      const { type, index } = this.event; const event = area[type][index];
      for (const [field, label] of [['startTime', t('noise-area.s087c451')], ['endTime', t('noise-area.sc4d3fa4')]]) this.field(host, label, event[field], (item, value) => modifyEvent(entry => { entry[field] = value; })(item), { kind: 'beat' });
      if (type === 'activeIntervals') this.field(host, t('noise-area.s207b20f'), readyFlashValue(event.readyFlash), (item, value) => modifyEvent(entry => { entry.readyFlash = Math.max(0, Math.round(value * 1000) / 1000); })(item), { kind: 'duration', clear: true });
      else {
        for (const [field, label] of [['start', t('noise-area.sdc6ff65')], ['end', t('noise-area.sa3dd3ca')]]) this.field(host, label, event[field], (item, value) => modifyEvent(entry => { entry[field] = value; if (entry.inst) entry[field === 'start' ? 'end' : 'start'] = value; })(item), { step: this.context.session.eventWheelSteps?.[type] ?? EVENT_WHEEL_STEPS[type] ?? 1, sample: { type, index, field } });
        if (noiseHasAnchor(type)) for (const axis of ['x', 'y']) this.field(host, t('noise-area.sbbcf4ca') + axis.toUpperCase(), event.anchor[axis], (item, value) => modifyEvent(entry => { entry.anchor[axis] = value; })(item), { sample: { type, index, field: 'anchor' } });
        this.field(host, t('noise-area.s7787450'), event.inst, (item, value) => { item[type][index] = withEventLock(this.context.session, this.area()[type][index], value); return item; }, { kind: 'checkbox' });
        this.field(host, t('noise-area.s7941eab'), event.linkgroup ?? 0, (item, value) => modifyEvent(entry => { entry.linkgroup = Math.max(0, Math.round(value)); })(item));
        if (event.linkgroup > 0) host.append(button(t('noise-area.s6e49702') + event.linkgroup, t('noise-area.sbe454d5'), () => { this.selection = new Set(NOISE_TRACKS.slice(1).flatMap(([track]) => (this.area()[track] ?? []).flatMap((entry, position) => entry.linkgroup === event.linkgroup ? [track + ':' + position] : []))); this.render(); this.invalidate(); }));
        if (!event.customEasing) this.field(host, t('noise-area.s727b7cd'), event.easingType ?? 1, (item, value) => modifyEvent(entry => { Object.assign(entry, withStandardEasing(entry, value)); delete entry.customEasing; })(item), { choices: EASING_NAMES.map((name, position) => [position + 1, (position + 1) + ' · ' + name]) });
        host.append(createEasingPicker(event.customEasing ? 0 : event.easingType ?? 1, value => this.edit(modifyEvent(entry => { Object.assign(entry, withStandardEasing(entry, value)); delete entry.customEasing; })), this.easingState).element);
        const areaIndex = this.selected;
        host.append(createCustomEasingControls(event, change => this.edit(item => { item[type][index] = change(item[type][index]); return item; }), { report: error => this.report(error), previewChart: curve => { const area = { ...this.context.session.chart.blockAreaList[areaIndex] }; area[type] = area[type].map((event, position) => position === index ? previewCurveEvent(event, curve) : event); return { chart: this.replaceArea(area), lineIndex: this.context.session.lineIndex }; }, signature: () => JSON.stringify([this.selected,this.event,this.context.session.chart.blockAreaList?.[areaIndex]?.[type]?.[index]]), timing: { BPMList: this.context.session.chart.BPMList, factor: 1 }, preview: curve => { if (this.selected !== areaIndex || this.event?.type !== type || this.event?.index !== index) return; const area = structuredClone(this.context.session.chart.blockAreaList[areaIndex]); const source = area[type][index]; source.customEasing = source.customEasing ? { ...source.customEasing, curve } : { curve }; this.draftChart = this.replaceArea(area); this.invalidate(); }, cancelPreview: () => { this.draftChart = null; this.invalidate(); }, read: () => this.selected === areaIndex && this.event?.type === type && this.event?.index === index ? this.context.session.chart.blockAreaList?.[areaIndex]?.[type]?.[index] : null }));
        if (!event.customEasing) for (const [field, label] of [['easingLeft', t('noise-area.s2fbff0e')], ['easingRight', t('noise-area.sb38574e')]]) this.field(host, label, event[field] ?? (field === 'easingLeft' ? 0 : 1), (item, value) => modifyEvent(entry => { entry[field] = value; })(item), { step: 0.05 });
        if (!event.customEasing) this.field(host, 'Bezier', event.bezier, (item, value) => modifyEvent(entry => { entry.bezier = value ? 1 : 0; })(item), { kind: 'checkbox' });
        if (!event.customEasing) for (const [position, label] of [t('noise-area.scc6b884'), t('noise-area.s2382dea'), t('noise-area.s8b368a9'), t('noise-area.se34ffb4')].entries()) this.field(host, label, (event.bezierPoints ?? [0, 0, 1, 1])[position], (item, value) => modifyEvent(entry => { entry.bezierPoints ??= [0, 0, 1, 1]; entry.bezierPoints[position] = value; })(item), { step: 0.05 });
      }
      if (type !== 'activeIntervals') {
        const cut = button(t('event-inspector.se2c05eb'), t('event-inspector.s2043de5'), () => this.cutSingleEvent());
        cut.disabled = !canCutEvent(type, event); host.append(cut);
      }
      host.append(button(t('noise-area.s6e88590'), t('noise-area.s9f829d4'), () => this.select(this.selected)));
    } else {
      this.field(host, t('noise-area.s1be7ae4'), area.Name ?? '', (item, value) => ({ ...item, Name: value }), { kind: 'text' });
      for (const [field, label] of [['appearTime', t('noise-area.s1bf3592')], ['disappearTime', t('noise-area.s7266ac6')]]) this.field(host, label, area[field], (item, value) => ({ ...item, [field]: value }), { kind: 'beat' });
      for (const [field, label] of [['bottomLeft', t('noise-area.s3f40468')], ['topRight', t('noise-area.s34f14b0')]]) for (const axis of ['x', 'y']) this.field(host, label + ' ' + axis.toUpperCase(), area[field][axis], (item, value) => ({ ...item, [field]: { ...item[field], [axis]: value } }), { sample: { field } });
      this.field(host, t('noise-area.s8bbb130'), area.isInvert, (item, value) => ({ ...item, isInvert: value }), { kind: 'checkbox' });
      host.append(hint(t('noise-area.s19ab647')));
    }
    host.append(button(t('noise-area.s0241408'), t('noise-area.sfe9d861'), () => this.remove()));
  }
  beginSample(target) {
    this.flush(); this.pause(); const area = this.area(); if (!area) return;
    this.sampleSnap=this.sampleLocalSnap=this.angleSnap=null;
    this.sampleMode = { ...samplingTarget(area, target.type, target.index, target.field), base: this.sampleMode?.base ?? this.context.session.chart };
    const value=target.type?area[target.type][target.index][target.field]:area[target.field];
    this.sampleControls?.configure((typeof value==='number'?[['value',value]]:['x','y'].filter(key=>Number.isFinite(value?.[key])).map(key=>[key,value[key]])).map(([key,value])=>({key,label:key==='value'?t('sampling.value'):key.toUpperCase(),value,change:next=>{const changed=structuredClone(this.area()),entry=target.type?changed[target.type][target.index]:changed;if(key==='value'){entry[target.field]=next;if(entry.inst)entry[target.field==='start'?'end':'start']=next;}else entry[target.field][key]=next;this.draftChart=this.replaceArea(changed);this.invalidate();}})));
    this.sampleSeconds = target.type ? this.context.tempo.seconds(area[target.type][target.index][target.field === 'end' ? 'endTime' : 'startTime']) : this.context.tempo.seconds(this.context.timeline.origin);
    this.sampleZoom ??= [this.context.preview, this.context.realtimePreview].map(renderer => ({ renderer, original: renderer.viewDivisor ?? 1, divisor: renderer.viewDivisor ?? 1 }));
    this.sampleDrag = null; this.render(); this.invalidate();
  }
  endSample(apply) {
    if (!this.sampleMode) return;
    for (const { renderer, original } of this.sampleZoom ?? []) renderer.viewDivisor = original;
    this.sampleZoom = null;
    const chart = this.draftChart, mode = this.sampleMode; if(mode.base!==this.context.session.chart)apply=false; this.sampleMode = null; this.sampleDrag = null; this.draftChart = null; this.syncChrome();
    if (apply && chart) { try {
      this.commit(t('noise-area.seaab4c2'), chart);
      if (mode.type) rememberEventValueChange(this.context.session, mode.base.blockAreaList[this.selected]?.[mode.type]?.[mode.index], this.context.session.chart.blockAreaList[this.selected]?.[mode.type]?.[mode.index], mode.field, mode);
    } catch (error) { this.report(error); } }
    this.render(); this.invalidate();
  }
  fitSampleView() {
    const previousView = this.sampleView();
    const rect = this.overlay.getBoundingClientRect(); const controlsBottom = this.sampleControls ? 0 : this.sampleBar.getBoundingClientRect().bottom - rect.top;
    for (const zoom of this.sampleZoom ?? []) {
      const positionScale = previewPositionScale(zoom.renderer.aspectRatio ?? 1.5);
      const position = noiseSampleHandle(this.area(), this.context.tempo, this.sampleSeconds, this.sampleMode, positionScale);
      if (this.context.sampleAutoFit !== false) zoom.divisor = fitNoiseSampleView(position, rect.width, rect.height, zoom.renderer.aspectRatio ?? 1.5, zoom.divisor, controlsBottom);
      zoom.renderer.viewDivisor = this.context.sampleAutoFit === false ? zoom.original : zoom.divisor;
    }
    const view = this.sampleView();
    if (this.sampleDrag && view.scale !== previousView.scale) {
      const position = view.screen(noiseSampleHandle(this.area(), this.context.tempo, this.sampleSeconds, this.sampleMode, view.positionScale)); const pointer = this.sampleDrag.pointer;
      this.sampleDrag.offset = { x: pointer.x - view.left - position.x, y: pointer.y - view.top - position.y };
    }
  }
  sampleView() {
    const rect = this.overlay.getBoundingClientRect(); const renderer = this.context.previewVisible ? this.context.preview : this.context.realtimePreview;
    const viewport = previewViewport(rect.width, rect.height, renderer.aspectRatio ?? 1.5); const scale = viewport.scale / (renderer.viewDivisor ?? 1);
    const positionScale = previewPositionScale(renderer.aspectRatio ?? 1.5);
    return { ...rect.toJSON(), viewport, scale, positionScale, world: point => ({ x: (point.x - rect.width / 2) / scale, y: (rect.height / 2 - point.y) / scale }), screen: point => ({ x: rect.width / 2 + point.x * scale, y: rect.height / 2 - point.y * scale }) };
  }
  sampleDown(event) {
    if (!this.sampleMode || event.button !== 0) return; event.preventDefault(); event.stopPropagation();
    const view = this.sampleView(); const point = { x: event.clientX - view.left, y: event.clientY - view.top }; const handle = view.screen(noiseSampleHandle(this.area(), this.context.tempo, this.sampleSeconds, this.sampleMode, view.positionScale));
    if (Math.hypot(point.x - handle.x, point.y - handle.y) > 26) return;
    this.overlay.setPointerCapture(event.pointerId); this.sampleDrag = { pointer: { x: event.clientX, y: event.clientY }, origin:view.world(handle), offset: { x: point.x - handle.x, y: point.y - handle.y } }; this.sampleSnap=null;
  }
  sampleMove(event) {
    if (!this.sampleDrag) return;
    this.sampleDrag.pointer = { x: event.clientX, y: event.clientY };
    const view = this.sampleView(); let point = view.world({ x: event.clientX - view.left - this.sampleDrag.offset.x, y: event.clientY - view.top - this.sampleDrag.offset.y });
    try {
      const settings=this.sampleTargets?{...samplingPreferences(),stepX:samplingPreferences().stepX*view.positionScale.x,stepY:samplingPreferences().stepY*view.positionScale.y}:{gridSnap:false,objectSnap:false}, targets=this.sampleTargets?.get(this.sampleMode.base,this.context.tempo,this.sampleSeconds,view.positionScale,{areaIndex:this.selected,renderer:this.context.previewVisible?this.context.preview:this.context.realtimePreview});
      if((!this.sampleMode.type||['moveXEvents','moveYEvents'].includes(this.sampleMode.type)||this.sampleMode.field==='anchor') && settings.coordinates!=='local'){const options={settings,targets,scale:view.scale,previous:this.sampleSnap,origin:this.sampleDrag.origin,free:event.altKey};if(['moveXEvents','moveYEvents'].includes(this.sampleMode.type)&&this.sampleMode.field!=='anchor'){const base=noiseSampleHandle(this.area(),this.context.tempo,this.sampleSeconds,this.sampleMode,view.positionScale),probeArea=structuredClone(this.area()),e=probeArea[this.sampleMode.type][this.sampleMode.index];e[this.sampleMode.field]+=1;const probe=noiseSampleHandle(probeArea,this.context.tempo,this.sampleSeconds,this.sampleMode,view.positionScale);this.sampleSnap=snapConstrainedPoint(point,base,{x:probe.x-base.x,y:probe.y-base.y},options);}else this.sampleSnap=snapSamplePoint(point,options);point=this.sampleSnap;}
      let area = applyNoiseSample(this.area(), this.context.tempo, this.sampleSeconds, this.sampleMode, point, view.positionScale);
      const {type,index,field}=this.sampleMode;
      if(type==='rotateEvents' && field!=='anchor'){const entry=area[type][index],result=snapSampleAngle(entry[field],{settings,targets,previous:this.angleSnap,free:event.altKey});this.angleSnap=result;entry[field]=result.angle;if(entry.inst)entry[field==='start'?'end':'start']=result.angle;}
      else if(['moveXEvents','moveYEvents'].includes(type) && field!=='anchor' && settings.coordinates==='local'){
        const entry=area[type][index],axis=type==='moveYEvents'?'y':'x',probe=structuredClone(area);probe[type][index][field]+=1;
        const a=noiseSampleHandle(area,this.context.tempo,this.sampleSeconds,this.sampleMode,view.positionScale),b=noiseSampleHandle(probe,this.context.tempo,this.sampleSeconds,this.sampleMode,view.positionScale),localScale=view.scale*Math.hypot(b.x-a.x,b.y-a.y);
        const object=snapConstrainedPoint(point,a,{x:b.x-a.x,y:b.y-a.y},{settings:{...settings,gridSnap:false},targets,scale:view.scale,previous:this.sampleSnap,free:event.altKey});
        if(object.guides.length){this.sampleSnap=object;area=applyNoiseSample(area,this.context.tempo,this.sampleSeconds,this.sampleMode,object,view.positionScale);}
        else{this.sampleSnap=null;const snapped=snapSamplePoint({[axis]:entry[field]},{settings:samplingPreferences(),scale:localScale,previous:this.sampleLocalSnap,free:event.altKey});this.sampleLocalSnap=snapped;entry[field]=snapped[axis];if(entry.inst)entry[field==='start'?'end':'start']=entry[field];}
      }
      this.draftChart = this.replaceArea(area); this.fitSampleView(); this.invalidate();
    } catch (error) { this.notify(error.message, 'warning'); this.sampleDrag = null; }
  }
  previewState() {
    if(this.sampleMode && this.sampleMode.base!==this.context.session.chart){this.endSample(false);return {chart:this.chart};}
    if (!this.sampleMode) return { chart: (this.batchVisible?.() !== false && this.batch?.previewChart) || this.chart };
    this.fitSampleView();
    if (this.samplePreviewCache?.source === this.chart && this.samplePreviewCache.mode === this.sampleMode) return this.samplePreviewCache.result;
    const chart = this.chart; const area = this.area(); const target = this.sampleMode;
    const beat = this.context.tempo.beat(this.sampleSeconds);
    const display = structuredClone(area);
    display.appearTime = fromNumber(beat - 2); display.disappearTime = fromNumber(beat + 2);
    if (target.type && ['start', 'end'].includes(target.field)) {
      const event = display[target.type][target.index];
      event.transformStart ??= event.start;
      event.transformEnd ??= event.end;
      event.start = event[target.field]; event.end = event[target.field];
    }
    const result = { chart: { ...chart, blockAreaList: chart.blockAreaList.map((entry, index) => index === this.selected ? display : entry) }, seconds: this.sampleSeconds };
    this.samplePreviewCache = { source: chart, mode: this.sampleMode, result }; return result;
  }
  drawSample() {
    if (!this.sampleMode) return;
    const { context, width, height } = prepareCanvas(this.overlay); const view = this.sampleView(); const area = this.area();
    const rotation=this.sampleMode.type==='rotateEvents'&&this.sampleMode.field!=='anchor'; const rotationAnchor=rotation?area.rotateEvents[this.sampleMode.index].anchor:null;
    drawSamplingGrid(context,view,{rotation,center:rotationAnchor?{x:rotationAnchor.x*view.positionScale.x,y:rotationAnchor.y*view.positionScale.y}:{x:0,y:0},positionScale:view.positionScale});drawSnapGuides(context,view,this.sampleSnap);
    const rawRead=this.sampleMode.type?area[this.sampleMode.type][this.sampleMode.index][this.sampleMode.field]:null;const read=typeof rawRead==='number'?rawRead:null;
    this.sampleControls?.updateValues(read===null?rawRead??area[this.sampleMode.field]:{value:read});
    const position=noiseSampleHandle(area,this.context.tempo,this.sampleSeconds,this.sampleMode,view.positionScale);
    this.sampleControls?.sync(rotation,`${t('spatial.noiseNumber',{number:this.selected})} · ${t('spatial.beatReadout',{beat:displayNumber(this.context.tempo.beat(this.sampleSeconds))})}\n${t('spatial.position')} ${displayPosition(position)}${rotation?'　'+displayNumber(read)+'°':''}`);
    const sample = previewNoiseGeometry(sampleEditingArea(area, this.context.tempo, this.sampleSeconds, this.sampleMode), view.positionScale); const points = sample.points.map(view.screen);
    context.strokeStyle = '#67efa4'; context.lineWidth = 2; context.beginPath(); points.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y)); context.closePath(); context.stroke();
    const anchor = this.sampleMode.type && noiseHasAnchor(this.sampleMode.type) ? area[this.sampleMode.type][this.sampleMode.index].anchor : null;
    if (anchor) { const point = view.screen({ x: anchor.x * view.positionScale.x, y: anchor.y * view.positionScale.y }); context.strokeStyle = '#f0ca67'; context.beginPath(); context.moveTo(point.x - 9, point.y); context.lineTo(point.x + 9, point.y); context.moveTo(point.x, point.y - 9); context.lineTo(point.x, point.y + 9); context.stroke(); context.fillStyle = '#f0ca67'; context.fillText(t('noise-area.sc7d0648'), point.x + 12, point.y); }
    const handle = view.screen(noiseSampleHandle(area, this.context.tempo, this.sampleSeconds, this.sampleMode, view.positionScale)); context.fillStyle = '#5cffa1'; context.beginPath(); context.arc(handle.x, handle.y, 9, 0, Math.PI * 2); context.fill(); context.strokeStyle = '#152a1d'; context.stroke();
    context.fillStyle = '#c8ffdf'; context.font = '14px sans-serif'; context.fillText(t('noise-area.s7872d97') + round(this.context.tempo.beat(this.sampleSeconds)), 18, height - 20);
    if (handle.x < 0 || handle.x > width || handle.y < 0 || handle.y > height) context.fillText(t('noise-area.s3d7275e'), 18, height - 42);
  }
  draw() {
    this.syncChrome(); if (!this.active || this.context.previewVisible || this.sampleMode) return;
    const { context, width, height } = prepareCanvas(this.canvas); const layout = this.layout();
    this.drawingLayout = layout; this.drawingContext = this.context;
    this.drawingChart = this.batchVisible?.() !== false ? this.batch?.previewChart : null;
    try { this.drawTimeline(context, width, height, layout); } finally { this.drawingLayout = null; this.drawingContext = null; this.drawingChart = null; }
  }
  drawTimeline(context, width, height, layout) {
    const { timeline } = this.context;
    const first = Math.floor(this.beatAt(height, false) * timeline.division); const last = Math.ceil(this.beatAt(HEADER_HEIGHT, false) * timeline.division);
    context.font = '12px sans-serif';
    for (let index = first; index <= last && index < first + 8000; index++) {
      const beat = index / timeline.division; const vertical = this.y(beat); const major = index % timeline.division === 0;
      context.strokeStyle = major ? '#8f909577' : '#75777c3d'; context.lineWidth = major ? 2 : 1; context.beginPath(); context.moveTo(0, vertical); context.lineTo(width, vertical); context.stroke();
      if (major) { context.fillStyle = '#d0d0d4'; context.fillText(String(beat), layout.split + 2, vertical - 3); }
    }
    context.lineWidth = 1;
    if (timeline.snapX !== false) for (let index = 0; index <= timeline.gridCount; index++) { const horizontal = 12 + index * (layout.split - 24) / timeline.gridCount; context.strokeStyle = '#71767c35'; context.beginPath(); context.moveTo(horizontal, HEADER_HEIGHT); context.lineTo(horizontal, height); context.stroke(); }
    for (let index = 0; index <= 6; index++) { const horizontal = layout.eventLeft + index * layout.eventWidth; context.strokeStyle = '#7f838755'; context.beginPath(); context.moveTo(horizontal, HEADER_HEIGHT); context.lineTo(horizontal, height); context.stroke(); }
    this.rects = [];
    const drawEntry = (entry, index, type, x, entryWidth, ghost = false, seamless = false, range = null, clipped = false, curveBatches = null) => {
      const start = beatValue(entry[type ? 'startTime' : 'appearTime']); const end = beatValue(entry[type ? 'endTime' : 'disappearTime']);
      const head = this.y(start); const tail = this.y(end); const top = Math.min(head, tail); const bottom = Math.max(head, tail); const entryHeight = Math.max(5, bottom - top);
      const rect = { x, y: top, width: entryWidth, height: entryHeight, index, type, head, tail, start, end };
      if (bottom < HEADER_HEIGHT || top > height || x + entryWidth < (type ? layout.eventLeft : 0) || x > (type ? width : layout.split)) return;
      if (!ghost) this.rects.push(rect);
      const selected = this.selection.has(type ? type + ':' + index : 'area:' + index);
      const color = type ? selected ? '#6de9a4' : colors[NOISE_TRACKS.findIndex(track => track[0] === type)] : entry.isInvert ? selected ? '#d7b2ff' : '#aa8cdb' : selected ? '#6de9a4' : '#c97c7c';
      const hovered = !ghost && this.hover?.index === index && this.hover?.type === type;
      if (seamless && !hovered && type !== 'activeIntervals') {
        if (timeline.drawEventCurves !== false && layout.eventWidth >= (timeline.eventCurveThreshold ?? 24)) {
          if (!curveBatches.has(range)) curveBatches.set(range, []);
          curveBatches.get(range).push({ event: entry, range, startY: head, endY: tail });
        }
        return;
      }
      if (!clipped) { context.save(); context.beginPath(); context.rect(type ? layout.eventLeft : 0, HEADER_HEIGHT, type ? width - layout.eventLeft : layout.split, height - HEADER_HEIGHT); context.clip(); }
      context.globalAlpha = ghost ? 0.4 : 1; context.fillStyle = color + (hovered && this.hover.kind === 'move' ? '75' : '40'); context.strokeStyle = hovered ? '#fff1d2' : color; context.lineWidth = selected || hovered ? 2 : 1; if (ghost) context.setLineDash([4, 3]);
      if (!seamless || hovered) { context.fillRect(x, top, entryWidth, entryHeight); context.strokeRect(x, top, entryWidth, entryHeight); }
      if (!type && !ghost) this.drawDistribution(context, entry, x, entryWidth, top, bottom);
      context.fillStyle = color; if (!seamless || hovered) { context.fillRect(x, head - 2, entryWidth, 4); context.fillRect(x, tail - 2, entryWidth, 4); }
      if (hovered && this.hover.kind !== 'move') { context.fillStyle = '#fff1d2'; context.fillRect(x - 2, (this.hover.kind === 'start' ? head : tail) - 4, entryWidth + 4, 8); }
      context.font = '12px sans-serif'; context.textAlign = 'center';
      if (!type) context.fillText((entry.Name || t('noise-area.s3a2d2c2') + index) + (entry.isInvert ? ' ⊕' : ''), x + entryWidth / 2, Math.max(HEADER_HEIGHT + 16, Math.min(height - 12, top + 18)), Math.max(1, entryWidth - 4));
      else if (type === 'activeIntervals') context.fillText(readyFlashValue(entry.readyFlash) > 0 ? t('noise-area.se62118e', { p0: durationText(readyFlashValue(entry.readyFlash)) }) : t('noise-area.s3c7509f'), x + entryWidth / 2, Math.max(HEADER_HEIGHT + 16, top + 18), Math.max(1, entryWidth - 4));
      else if (timeline.drawEventCurves !== false && layout.eventWidth >= (timeline.eventCurveThreshold ?? 24)) {
        drawEventCurve(context, entry, range, { x, y: Math.max(HEADER_HEIGHT, top), width: entryWidth, height: Math.max(2, Math.min(height, bottom) - Math.max(HEADER_HEIGHT, top)) }, head, tail);
      }
      if (!clipped) context.restore();
    };
    const drawTrack = (events, type, ghost = false) => {
      const bounds = this.eventBounds(type); const seamlessGroups = new Set();
      const curveBatches = new Map();
      const display = eventDisplayIndex(this, events, this.chart); const { ranges } = display;
      const entries = display.index.query(this.beatAt(height, false), this.beatAt(HEADER_HEIGHT, false)).sort((a, b) => a.index - b.index);
      const groups = new Set(entries.map(entry => ranges.get(entry.index)));
      const selectedGroups = ghost ? new Set() : selectedEventGroups(this.selection, type, ranges);
      for (const group of groups) {
        if (timeline.seamlessEvents === false) continue;
        if (group.entries.length < 2 || selectedGroups.has(group) || display.unmergeable.has(group)) continue;
        this.drawEventChain(context, group, type, bounds, height, ghost);
        seamlessGroups.add(group);
      }
      context.save(); context.beginPath(); context.rect(layout.eventLeft, HEADER_HEIGHT, width - layout.eventLeft, height - HEADER_HEIGHT); context.clip();
      for (const { item, index } of entries) drawEntry(item, ghost ? -1 : index, type, bounds.x, bounds.width, ghost, seamlessGroups.has(ranges.get(index)), ranges.get(index), true, curveBatches);
      context.globalAlpha = ghost ? 0.4 : 1; context.strokeStyle = colors[NOISE_TRACKS.findIndex(track => track[0] === type)]; if (ghost) context.setLineDash([4, 3]);
      for (const [group, curves] of curveBatches) {
        const top = Math.max(HEADER_HEIGHT, this.y(beatValue(group.entries.at(-1).event.endTime)));
        const bottom = Math.min(height, this.y(beatValue(group.entries[0].event.startTime)));
        drawEventCurveBatch(context, curves, { x: bounds.x, y: top, width: bounds.width, height: Math.max(2, bottom - top) });
      }
      context.restore();
      if (type !== 'activeIntervals') this.drawEventValues(context, events, type, bounds, height, ghost, groups);
    };
    context.save(); context.beginPath(); context.rect(0, HEADER_HEIGHT, layout.split, height - HEADER_HEIGHT); context.clip();
    for (const { item: area, index } of this.visibleAreas(this.beatAt(height, false), this.beatAt(HEADER_HEIGHT, false))) drawEntry(area, index, null, this.areaX(area,index) - AREA_BAR_WIDTH / 2, AREA_BAR_WIDTH, false, false, null, true);
    context.restore();
    for (const [type] of NOISE_TRACKS) drawTrack(this.area()?.[type] ?? [], type);
    if (this.pending && this.cursor) {
      const start = this.pending; const current = this.cursor; const bounds = this.eventBounds(start.type); context.fillStyle = '#78d99b44'; const top = this.y(Math.max(start.beat, current.beat)); const bottom = this.y(Math.min(start.beat, current.beat)); context.fillRect(start.side === 'areas' ? this.areaX({ editorPositionX: this.editorX(start.x) }, 0) - AREA_BAR_WIDTH / 2 : bounds.x, top, start.side === 'areas' ? AREA_BAR_WIDTH : bounds.width, Math.max(4, bottom - top));
    }
    if (this.clipboard && this.cursor && !this.drag && !this.pending) {
      const delta = this.cursor.beat - this.clipboard.start;
      const ghosts = this.clipboard.entries.some(entry => entry.type === 'area') ? this.pastedAreas(this.cursor.beat).slice(this.areas().length) : [];
      for (const area of ghosts) drawEntry(area, -1, null, this.areaX(area, 0) - AREA_BAR_WIDTH / 2, AREA_BAR_WIDTH, true);
      const eventGhosts = new Map();
      for (const entry of this.clipboard.entries) if (entry.type !== 'area' && this.area()) {
        const value = { ...entry.value, startTime: fromNumber(beatValue(entry.value.startTime) + delta), endTime: fromNumber(beatValue(entry.value.endTime) + delta) };
        if (!eventGhosts.has(entry.type)) eventGhosts.set(entry.type, []); eventGhosts.get(entry.type).push(value);
      }
      for (const [type, events] of eventGhosts) drawTrack(events, type, true);
    }
    if (this.drag?.kind === 'rectangle') { const start = this.drag.start; const current = this.cursor; context.save(); context.lineWidth = 1; context.fillStyle = '#ffcc4430'; context.strokeStyle = '#ffdd77'; const top = this.y(start.rawBeat); const deltaY = this.y(current.rawBeat) - top; context.fillRect(start.x, top, current.x - start.x, deltaY); context.strokeRect(start.x, top, current.x - start.x, deltaY); context.restore(); }
    if (this.drag?.kind === 'stroke' && this.drag.moved) { context.save(); context.lineWidth = 1; context.strokeStyle = '#80ffff'; context.beginPath(); this.drag.points.forEach((point, index) => index ? context.lineTo(point.x, this.y(point.rawBeat)) : context.moveTo(point.x, this.y(point.rawBeat))); context.stroke(); context.restore(); }
    this.drawOwner(context, layout);
    const owner = this.area() ? `#${this.selected} ${this.area().Name || '未命名噪域'}` : t('noise-area.sd7b34fd');
    const description = t('noise-area.se2f1ca6', { p0: this.areas().length, p1: owner });
    if (description !== this.ariaDescription) { this.canvas.setAttribute('aria-description', description); this.ariaDescription = description; }
    drawEditorJudgement(context, [{ left: 0, right: width, y: this.y(timeline.origin) }], timeline.judgementColor ?? '#ffffff', editorJudgementWidth(timeline, timeline.gridReferenceWidth ?? width), timeline.judgementAlpha);
  }
  eventGroups(events) {
    return eventDisplayIndex(this, events, this.draftChart ?? this.context.session?.chart).groups;
  }
  *selectionRects(side) {
    // Build offscreen selection bounds only on mouseup, not on every animation frame.
    if (side === 'areas') {
      for (const [index, area] of this.areas().entries()) yield { x: this.areaX(area, index) - AREA_BAR_WIDTH / 2, width: AREA_BAR_WIDTH, index, type: null, start: beatValue(area.appearTime), end: beatValue(area.disappearTime) };
    } else for (const [type] of NOISE_TRACKS) {
      const bounds = this.eventBounds(type);
      for (const [index, event] of (this.area()?.[type] ?? []).entries()) yield { ...bounds, index, type, start: beatValue(event.startTime), end: beatValue(event.endTime) };
    }
  }
  drawEventChain(context, group, type, bounds, height, ghost = false) {
    const head = this.y(beatValue(group.entries[0].event.startTime)); const tail = this.y(beatValue(group.entries.at(-1).event.endTime));
    const top = Math.max(HEADER_HEIGHT, tail); const bottom = Math.min(height, head);
    if (bottom <= top) return;
    const layout = this.layout(); const color = colors[NOISE_TRACKS.findIndex(track => track[0] === type)];
    context.save(); context.beginPath(); context.rect(layout.eventLeft, HEADER_HEIGHT, layout.width - layout.eventLeft, height - HEADER_HEIGHT); context.clip();
    context.globalAlpha = ghost ? 0.4 : 1; context.fillStyle = color + '40'; context.fillRect(bounds.x, top, bounds.width, bottom - top);
    context.strokeStyle = color; context.lineWidth = 1; if (ghost) context.setLineDash([4, 3]); context.strokeRect(bounds.x, tail, bounds.width, head - tail);
    context.fillStyle = color; context.fillRect(bounds.x, head - 2, bounds.width, 4); context.fillRect(bounds.x, tail - 2, bounds.width, 4); context.restore();
  }
  drawEventValues(context, events, type, bounds, height, ghost = false, visibleGroups = null) {
    if (!events.length || bounds.width < (this.context.timeline.eventValueThreshold ?? 30)) return;
    const groups = visibleGroups ?? this.eventGroups(events);
    const layout = this.layout();
    context.save(); context.beginPath(); context.rect(layout.eventLeft, HEADER_HEIGHT, layout.width - layout.eventLeft, height - HEADER_HEIGHT); context.clip();
    context.globalAlpha = ghost ? 0.4 : 1; context.font = `${this.context.timeline.eventValueFontSize ?? 13}px RPE, sans-serif`; context.textAlign = 'center';
    for (const group of groups) {
      const first = group.entries[0].event; const last = group.entries.at(-1).event;
      const top = this.y(beatValue(last.endTime)); const bottom = this.y(beatValue(first.startTime));
      if (bottom < HEADER_HEIGHT || top > height) continue;
      context.fillStyle = colors[NOISE_TRACKS.findIndex(track => track[0] === type)];
      context.fillText(String(round(group.max)), bounds.x + bounds.width / 2, Math.max(HEADER_HEIGHT + 14, top + 14), bounds.width);
      if (bottom - top > 26) context.fillText(String(round(group.min)), bounds.x + bounds.width / 2, Math.min(height - 5, bottom - 5), bounds.width);
    }
    context.restore();
  }
  drawOwner(context, layout) {
    const area = this.area(); if (!area) return;
    const horizontal = this.areaX(area, this.selected); const top = this.y(beatValue(area.disappearTime)); const bottom = this.y(beatValue(area.appearTime));
    const above = bottom < HEADER_HEIGHT; const below = top > layout.height;
    context.save();
    context.beginPath(); context.rect(0, HEADER_HEIGHT, layout.split, layout.height - HEADER_HEIGHT); context.clip();
    const vertical = above ? HEADER_HEIGHT + 19 : below ? layout.height - 12 : Math.max(HEADER_HEIGHT + 18, Math.min(layout.height - 14, top + 36));
    const label = t('noise-area.s6eabf6d', { p0: above ? '▲ ' : below ? '▼ ' : '→ ', p1: this.selected, p2: area.Name || t('noise-area.s81b3bb2') });
    context.font = '12px sans-serif'; context.textAlign = 'left'; const textWidth = Math.min(layout.split - 12, context.measureText(label).width + 10); const left = Math.max(6, Math.min(layout.split - textWidth - 6, horizontal + AREA_BAR_WIDTH / 2 + 7));
    context.fillStyle = '#242628ed'; context.fillRect(left - 3, vertical - 14, textWidth, 19); context.fillStyle = '#f5f5f5'; context.fillText(label, left, vertical, textWidth - 6); context.restore();
  }
  drawDistribution(context, area, left, width, top, bottom) {
    const { tempo } = this.context;
    let distribution = this.distributions.get(area);
    if (!distribution || distribution.tempo !== tempo) {
      const tracks = NOISE_TRACKS.map(([type]) => {
        const intervals = (area[type] ?? []).map(event => [beatValue(event.startTime), beatValue(event.endTime)]).sort((first, second) => first[0] - second[0]);
        const merged = [];
        for (const interval of intervals) { const previous = merged.at(-1); if (previous && interval[0] <= previous[1]) previous[1] = Math.max(previous[1], interval[1]); else merged.push(interval); }
        return merged;
      });
      const appear = tempo.seconds(area.appearTime);
      const intervals = noiseActivationIntervals(area, tempo);
      const flashes = intervals.flatMap((interval, index) => {
        const start = Math.max(appear, intervals[index - 1]?.end ?? -Infinity, interval.start - interval.readyFlash);
        return interval.readyFlash > 0 && start < interval.start ? [[tempo.beat(start), tempo.beat(interval.start)]] : [];
      });
      distribution = { tracks, flashes, tempo }; this.distributions.set(area, distribution);
    }
    context.save(); context.beginPath(); context.rect(left + 2, top + 2, width - 4, Math.max(0, bottom - top - 4)); context.clip(); context.globalAlpha *= 0.55;
    const spacing = (width - 12) / NOISE_TRACKS.length;
    const flashX = left + 6 + (spacing - 2) / 2;
    context.strokeStyle = colors[0]; context.lineWidth = Math.max(1, Math.min(2, spacing / 3)); context.setLineDash([3, 3]); context.beginPath();
    for (const [start, end] of distribution.flashes) {
      const upper = Math.max(HEADER_HEIGHT, top, this.y(end)); const lower = Math.min(this.layout().height, bottom, this.y(start));
      if (lower > upper) { context.moveTo(flashX, upper); context.lineTo(flashX, lower); }
    }
    context.stroke(); context.setLineDash([]);
    for (const [column, intervals] of distribution.tracks.entries()) {
      context.fillStyle = colors[column];
      for (const [start, end] of intervals) {
        const upper = Math.max(HEADER_HEIGHT, top, this.y(end)); const lower = Math.min(this.layout().height, bottom, this.y(start));
        if (lower >= upper) context.fillRect(left + 6 + column * spacing, upper, Math.max(1, spacing - 2), Math.max(2, lower - upper));
      }
    }
    context.restore();
  }
}
