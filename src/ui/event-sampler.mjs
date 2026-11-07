import { TransformScene } from '../core/transform-scene.mjs';
import { snapSamplePoint, snapSampleAngle, snapConstrainedPoint, unwrapAngle, sampleInBasis, sampleFromBasis } from '../core/sampling-grid.mjs';
import { samplingPreferences } from '../platform/sampling-preferences.mjs';
import { displayNumber, displayPosition } from './spatial-display.mjs';
import { SamplingControls } from './sampling-controls.mjs';
import { SamplingTargets } from './sampling-targets.mjs';
import { drawSamplingGrid, drawSnapGuides } from './sampling-guides.mjs';
import { previewViewport, previewPositionScale } from '../core/editor-display.mjs';
import { fitNoiseSampleView } from '../core/noise-sampling.mjs';
import { beatValue } from '../core/beat.mjs';
import { chartWithEventLists, eventListAt, eventKey, transformedEventLists, rememberEventValueTargets } from '../application/event-commands.mjs';
import { prepareCanvas } from './timeline.mjs';
import { t } from '../i18n.mjs';

const sampledTypes = new Set(['moveXEvents', 'moveYEvents', 'rotateEvents']);
const round = value => Math.round(value * 10000) / 10000;
const now = () => typeof performance === 'undefined' ? Date.now() : performance.now();

export class EventSampler {
  constructor(host, getContext, { invalidate = () => {}, pause = () => {}, notify = () => {} } = {}) {
    this.host = host; this.getContext = getContext; this.invalidate = invalidate; this.pause = pause; this.notify = notify;
    this.mode = null; this.valueDraft = null; this.draftChart = null; this.drag = null; this.scene = new TransformScene(); this.snapTargets = new SamplingTargets();
    this.canvas = document.createElement('canvas'); this.canvas.className = 'event-sampler'; this.canvas.hidden = true; host.append(this.canvas);
    this.sampleBar = document.createElement('div'); this.sampleBar.className = 'sampling-dock'; this.sampleBar.hidden = true;
    const hint = document.createElement('p'); hint.className = 'hint'; hint.textContent = t('event-sampler.s5cb983c'); this.sampleHint = hint; this.sampleBar.append(hint);
    for (const [title, apply] of [[t('event-sampler.s2e0df4a'), true], [t('event-sampler.s4d0b468'), false]]) { const button = document.createElement('button'); button.type = 'button'; button.textContent = title; button.onclick = () => this.finish(apply); this.sampleBar.append(button); }
    const dock = document.querySelector('[data-panel="events"]');
    if(dock) dock.insertBefore(this.sampleBar,dock.querySelector('form')); else host.append(this.sampleBar);
    this.sampleBar.replaceChildren(); this.sampleBar.classList.add('sampling-dock');
    this.controls = new SamplingControls(this.sampleBar, { change: () => this.invalidate(), apply: () => this.finish(true), cancel: () => this.finish(false) });
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
    this.sampleBar.hidden = !this.mode;if(this.mode)this.sampleBar.parentElement?.scrollTo?.({top:0});
    const form=this.sampleBar.parentElement?.querySelector('#event-properties');if(form)form.hidden=Boolean(this.mode);
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
    draft.target = { ...target, lineIndex };
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
    if (apply && current && chart && chart !== this.session.chart) {
      this.session.commit(label, chart);
      if (draft.target) rememberEventValueTargets(this.session, draft.base, [draft.target], draft.layer);
    }
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
    this.mode = { ...target, initialValue:event[target.field], lineIndex: target.lineIndex ?? this.session.lineIndex, layer: this.session.eventLayer, base: this.session.chart, owner: this.session };
    if (this.context.pairedMovementSampling !== false && ['moveXEvents', 'moveYEvents'].includes(target.type)) {
      this.mode.paired = this.findPairedMovement(source, this.mode);
    }
    const entries=[{key:'value',label:t('sampling.value'),value:event[target.field],change:value=>{this.draftChart=this.eventChart(value);this.invalidate();}}];
    if(this.mode.paired){const paired=eventListAt({chart:source,eventLayer:this.mode.layer},this.mode.lineIndex,this.mode.paired.type)[this.mode.paired.index];entries[0].label=`${target.type==='moveXEvents'?'X':'Y'} · ${t('sampling.value')}`;entries.push({key:'paired',label:`${target.type==='moveXEvents'?'Y':'X'} · ${t('sampling.value')}`,value:paired[target.field],change:value=>{const current=eventListAt({chart:this.draftChart,eventLayer:this.mode.layer},this.mode.lineIndex,this.mode.type)[this.mode.index][this.mode.field];this.draftChart=this.eventChart(current,value);this.invalidate();}});}
    this.controls?.configure(entries);
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
    if (this.mode.base !== this.session.chart || this.mode.owner !== this.session || this.mode.layer !== this.session.eventLayer) apply = false;
    const chart = this.draftChart, mode = this.mode;
    for (const { renderer, original } of this.sampleZoom ?? []) renderer.viewDivisor = original;
    this.sampleZoom = null;
    this.mode = null; this.draftChart = null; this.drag = null; this.canvas.hidden = true; this.session.liveEventEdit = false;
    this.syncChrome();
    if (apply && chart && chart !== this.session.chart) {
      this.session.commit(t('event-sampler.seaab4c2'), chart);
      rememberEventValueTargets(this.session, mode.base, [mode, ...(mode.paired ? [{ ...mode, ...mode.paired }] : [])], mode.layer);
    }
    else if (!apply) this.session.notify();
    this.invalidate();
  }

  previewState() {
    if (this.mode && (this.mode.owner !== this.session || this.mode.base !== this.session.chart || this.mode.layer !== this.session.eventLayer)) { this.finish(false); return null; }
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
    const controlsBottom = this.controls ? 0 : this.sampleBar.getBoundingClientRect().bottom - previous.rectangle.top;
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
    let chart = this.draftChart;
    for (const [type, events] of updates) {
      const index = type === mode.type ? mode.index : mode.paired.index;
      const linked = transformedEventLists({ chart, eventLayer: this.session.eventLayer }, lineIndex, new Set([eventKey(type,index)]), () => events[index]);
      chart = chartWithEventLists(chart, lineIndex, this.session.eventLayer, linked);
    }
    return chart;
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

  applyPoint(point, snap = false, free = false) {
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
      if (Math.abs(determinant) < 1e-10) throw Error(t('spatial.singular'));
      const errorX = point.x - current.x, errorY = point.y - current.y;
      value += (errorX * pairedVertical - errorY * pairedHorizontal) / determinant;
      pairedValue += (horizontal * errorY - vertical * errorX) / determinant;
      if (!Number.isFinite(value) || !Number.isFinite(pairedValue)) return;
      if (snap && !free && samplingPreferences().coordinates === 'local') { const settings=samplingPreferences(); const snapped=snapSamplePoint(mode.type==='moveXEvents'?{x:value,y:pairedValue}:{x:pairedValue,y:value},{settings}); value=mode.type==='moveXEvents'?snapped.x:snapped.y; pairedValue=mode.type==='moveXEvents'?snapped.y:snapped.x; }
      this.draftChart = this.eventChart(round(value), round(pairedValue)); this.invalidate(); return;
    }
    let value = Number(event[mode.field]);
    if (mode.type !== 'rotateEvents') {
      const probe = this.handle(this.eventChart(value + 1));
      const horizontal = probe.x - current.x; const vertical = probe.y - current.y;
      const length = horizontal * horizontal + vertical * vertical;
      if (length < 1e-8) throw Error(t('spatial.singular'));
      value += ((point.x - current.x) * horizontal + (point.y - current.y) * vertical) / length;
    } else {
      this.scene.compile(this.samplingChart(this.draftChart),this.context.tempo);
      const renderer=this.context.previewVisible?this.context.preview:this.context.realtimePreview,state=this.scene.sampler(this.seconds,previewPositionScale(renderer.aspectRatio??1.5))(mode.lineIndex);
      const dx=point.x-state.x,dy=point.y+state.y;if(Math.hypot(dx,dy)<1e-8)throw Error(t('spatial.singular'));
      value+=unwrapAngle(Math.atan2(-dx,dy)*180/Math.PI,state.rotation)-state.rotation;
    }
    if (snap && mode.type === 'rotateEvents') { const settings=samplingPreferences(); const renderer=this.context.previewVisible?this.context.preview:this.context.realtimePreview; const scale=previewPositionScale(renderer.aspectRatio??1.5); const targets=this.snapTargets.get(mode.base,this.context.tempo,this.seconds,scale,{lineIndex:mode.lineIndex}); const state=this.scene.sampler(this.seconds,scale)(mode.lineIndex); const effective=state.rotation+(value-event[mode.field]); const result=snapSampleAngle(effective,{settings,targets,previous:this.angleSnap,free,origin:this.drag?.angle??effective});value+=result.angle-effective;this.angleSnap=result; }

    if (!Number.isFinite(value)) return;
    this.draftChart = this.eventChart(round(value)); this.invalidate();
  }

  down(event) {
    if (!this.mode || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    const view = this.view(); const handle = view.screen(this.handle(this.draftChart)); const point = { x: event.clientX - view.rectangle.left, y: event.clientY - view.rectangle.top };
    if (Math.hypot(point.x - handle.x, point.y - handle.y) > 28) return;
    this.snapResult=this.localSnap=this.angleSnap=null;
    const renderer=this.context.previewVisible?this.context.preview:this.context.realtimePreview;this.scene.compile(this.samplingChart(this.draftChart),this.context.tempo);const angle=this.scene.sampler(this.seconds,previewPositionScale(renderer.aspectRatio??1.5))(this.mode.lineIndex).rotation;
    this.drag = { angle, pointer: { x: event.clientX, y: event.clientY }, origin: {x:handle.x,y:-handle.y}, offset: { x: point.x - handle.x, y: point.y - handle.y } }; this.canvas.setPointerCapture(event.pointerId);
  }

  move(event) {
    if (!this.drag || !this.mode) return;
    event.preventDefault();
    this.drag.pointer = { x: event.clientX, y: event.clientY };
    const view = this.view(); const point = { x: event.clientX - view.rectangle.left - this.drag.offset.x, y: event.clientY - view.rectangle.top - this.drag.offset.y };
    let world=view.world(point);
    if (this.snapTargets && this.mode.type!=='rotateEvents' && samplingPreferences().coordinates!=='local') {
      const renderer=this.context.previewVisible?this.context.preview:this.context.realtimePreview, scale=previewPositionScale(renderer.aspectRatio??1.5);
      const settings={...samplingPreferences(),stepX:samplingPreferences().stepX*scale.x,stepY:samplingPreferences().stepY*scale.y}, targets=this.snapTargets.get(this.mode.base,this.context.tempo,this.seconds,scale,{lineIndex:this.mode.lineIndex,renderer});
      const options={settings,targets,scale:view.scale,previous:this.snapResult,origin:this.drag.origin,free:event.altKey};if(this.mode.paired)this.snapResult=snapSamplePoint({x:world.x,y:-world.y},options);else{const mode=this.mode,value=eventListAt({chart:this.draftChart,eventLayer:mode.layer},mode.lineIndex,mode.type)[mode.index][mode.field],base=this.handle(this.draftChart),probe=this.handle(this.eventChart(value+1));this.snapResult=snapConstrainedPoint({x:world.x,y:-world.y},{x:base.x,y:-base.y},{x:probe.x-base.x,y:base.y-probe.y},options);} world={x:this.snapResult.x,y:-this.snapResult.y};
    }
    let localSnap=false;
    if(this.snapTargets&&this.mode.type!=='rotateEvents'&&samplingPreferences().coordinates==='local'){
      const basis=this.localGrid(),point=sampleInBasis({x:world.x,y:-world.y},basis);if(point){const mode=this.mode,renderer=this.context.previewVisible?this.context.preview:this.context.realtimePreview,scale=previewPositionScale(renderer.aspectRatio??1.5),targets=this.snapTargets.get(mode.base,this.context.tempo,this.seconds,scale,{lineIndex:mode.lineIndex,renderer}).map(target=>({...target,...sampleInBasis(target,basis)})),options={settings:samplingPreferences(),targets,scale:{x:view.scale*Math.hypot(basis.x.x,basis.x.y),y:view.scale*Math.hypot(basis.y.x,basis.y.y)},previous:this.localSnap,free:event.altKey};let result;
      if(mode.paired)result=snapSamplePoint(point,options);else{const current=sampleInBasis({x:this.handle(this.draftChart).x,y:-this.handle(this.draftChart).y},basis);result=snapConstrainedPoint(point,current,mode.type==='moveXEvents'?{x:1,y:0}:{x:0,y:1},options);}this.localSnap=result;const p=sampleFromBasis(result,basis);this.snapResult={...p,guides:result.guides,basis};world={x:p.x,y:-p.y};localSnap=true;}
    }
    try{this.applyPoint(world,Boolean(this.controls)&&!localSnap,event.altKey);this.sampleError=null;this.fitView();}catch(error){if(this.sampleError!==error.message)this.notify?.(error.message,'warning');this.sampleError=error.message;}
  }

  up(event) {
    if (!this.drag) return;
    this.canvas.releasePointerCapture?.(event.pointerId); this.drag = null;
  }

  localGrid() {
    const mode=this.mode;if(!mode||mode.type==='rotateEvents')return;
    const value=eventListAt({chart:this.draftChart,eventLayer:mode.layer},mode.lineIndex,mode.type)[mode.index][mode.field];
    const pair=mode.paired?eventListAt({chart:this.draftChart,eventLayer:mode.layer},mode.lineIndex,mode.paired.type)[mode.paired.index][mode.field]:0;
    const current=this.handle(this.draftChart),probe=this.handle(this.eventChart(value+1,pair));
    const axis={x:probe.x-current.x,y:current.y-probe.y};
    const paired=mode.paired?this.handle(this.eventChart(value,pair+1)):null;
    const other=paired?{x:paired.x-current.x,y:current.y-paired.y}:mode.type==='moveXEvents'?{x:-axis.y,y:axis.x}:{x:axis.y,y:-axis.x};
    const basis={origin:{x:current.x-value*axis.x-pair*other.x,y:-current.y-value*axis.y-pair*other.y},x:mode.type==='moveXEvents'?axis:other,y:mode.type==='moveYEvents'?axis:other};
    return basis;
  }

  draw() {
    if (!this.mode) return;
    const { context, width, height } = prepareCanvas(this.canvas); const view = this.view(); const point = view.screen(this.handle(this.draftChart));
    const worldView={...view,screen:p=>view.screen({x:p.x,y:-p.y})};
    const renderer=this.context.previewVisible?this.context.preview:this.context.realtimePreview;
    const state=this.scene.sampler(this.seconds,previewPositionScale(renderer.aspectRatio??1.5))(this.mode.lineIndex);
    const settings=samplingPreferences(),basis=settings.coordinates==='local'?this.localGrid():settings.coordinates==='delta'&&this.drag?{origin:this.drag.origin,x:{x:previewPositionScale(renderer.aspectRatio??1.5).x,y:0},y:{x:0,y:previewPositionScale(renderer.aspectRatio??1.5).y}}:undefined;
    drawSamplingGrid(context,worldView,{rotation:this.mode.type==='rotateEvents',center:state,angle:state.rotation*Math.PI/180,positionScale:previewPositionScale(renderer.aspectRatio??1.5),basis});
    drawSnapGuides(context,worldView,this.snapResult);
    const source=eventListAt({chart:this.draftChart,eventLayer:this.session.eventLayer},this.mode.lineIndex,this.mode.type)[this.mode.index];
    this.controls?.updateValues({value:source[this.mode.field],paired:this.mode.paired?eventListAt({chart:this.draftChart,eventLayer:this.mode.layer},this.mode.lineIndex,this.mode.paired.type)[this.mode.paired.index][this.mode.field]:NaN});
    this.controls?.sync(this.mode.type==='rotateEvents',`${t('spatial.lineNumber',{number:this.mode.lineIndex})} · ${t('spatial.eventLayer',{number:this.mode.layer})} · ${this.mode.field==='end'?t('sampling.end'):t('sampling.start')}\n${t('spatial.position')} ${displayPosition(state)}　${displayNumber(state.rotation)}°`);
    context.save(); context.strokeStyle = '#70efaa'; context.lineWidth = 2; context.beginPath(); context.moveTo(point.x - 16, point.y); context.lineTo(point.x + 16, point.y); context.moveTo(point.x, point.y - 16); context.lineTo(point.x, point.y + 16); context.stroke(); context.restore();
  }
}
