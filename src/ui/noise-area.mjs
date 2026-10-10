import { createNoiseArea, createNoiseEvent, noiseCenter, noiseHasAnchor, noiseRuntime, NOISE_TRACKS, withNoiseAreas, shiftNoiseArea } from '../core/noise-areas.mjs';
import { samplingTarget, sampleEditingArea, noiseSampleHandle, applyNoiseSample, fitNoiseSampleView } from '../core/noise-sampling.mjs';
import { beatValue, fromNumber, parseBeat, formatBeat } from '../core/beat.mjs';
import { previewViewport, strokeIntersects } from '../core/editor-display.mjs';
import { prepareCanvas } from './timeline.mjs';
import { createEasingPicker, EASING_NAMES } from './easing-picker.mjs';
import { NoiseAreaList } from './noise-list.mjs';

function button(text, title, run) {
  const control = document.createElement('button'); control.type = 'button'; control.textContent = text; control.title = title; control.onclick = run; return control;
}
function hint(text) { const node = document.createElement('p'); node.className = 'hint'; node.textContent = text; return node; }
const round = value => Math.round(value * 10000) / 10000;
const durationText = value => String(Math.round(Math.max(0, Number(value) || 0) * 1000) / 1000);
const readyFlashValue = value => typeof value === 'boolean' ? (value ? 0.5 : 0) : Number.isFinite(value) ? Math.max(0, value) : 0.5;
const colors = ['#e5ab66', '#82b8df', '#b1b0e4', '#e9a4b0', '#86c3aa', '#d0bd7b'];
const HEADER_HEIGHT = 54;
const AREA_BAR_WIDTH = 60;

export class NoiseAreaEditor {
  constructor(host, canvas, getContext, options) {
    Object.assign(this, options); this.host = host; this.canvas = canvas; this.getContext = getContext;
    this.properties = document.querySelector('#noise-properties'); this.active = false; this.selected = -1; this.selection = new Set();
    this.event = null; this.cursor = null; this.rects = []; this.clipboard = null; this.pending = null; this.draftChart = null; this.easingState = { open: false };
    this.distributions = new WeakMap();
    this.areaList = new NoiseAreaList(index => this.select(index));
    this.overlay = document.createElement('canvas'); this.overlay.className = 'noise-sampler'; this.overlay.hidden = true; canvas.closest('.stage').append(this.overlay);
    this.sampleBar = document.createElement('div'); this.sampleBar.className = 'noise-sample-bar'; this.sampleBar.hidden = true;
    this.sampleBar.append(hint('拖动绿色控制点 · 可连续取样，完成统一应用 · Esc 全部取消'), button('完成取样', '保留全部取样结果并返回时间轴', () => this.endSample(true)), button('取消', '放弃全部取样修改', () => this.endSample(false))); canvas.closest('.stage').append(this.sampleBar);
    for (const [name, handler] of [['pointerdown', event => this.down(event)], ['pointermove', event => this.move(event)], ['pointerup', event => this.up(event)], ['pointercancel', () => this.cancelGesture()]]) canvas.addEventListener(name, handler);
    canvas.addEventListener('wheel', event => { event.preventDefault(); event.stopPropagation(); if (!this.sampleMode) { this.wheel(event); this.cursor = this.point(event); this.updateDrag(); } }, { passive: false });
    canvas.addEventListener('contextmenu', event => { event.preventDefault(); this.pending = null; this.invalidate(); });
    canvas.addEventListener('auxclick', event => event.preventDefault());
    this.overlay.addEventListener('pointerdown', event => this.sampleDown(event));
    this.overlay.addEventListener('pointermove', event => this.sampleMove(event));
    this.overlay.addEventListener('pointerup', event => { this.sampleDrag = null; this.overlay.releasePointerCapture?.(event.pointerId); });
    this.overlay.addEventListener('pointercancel', () => { this.sampleDrag = null; });
    this.canvas.addEventListener('pointerleave', () => { if (!this.drag) { this.cursor = null; this.hover = null; this.canvas.style.cursor = 'default'; this.invalidate(); } });
  }
  get context() { return this.getContext(); }
  get chart() { return this.draftChart ?? this.context.session.chart; }
  areas() { return this.chart.blockAreaList ?? []; }
  area() { return this.areas()[this.selected]; }
  open() { this.active = true; this.context.timeline.origin = this.context.tempo.beat(this.context.seconds()); this.syncChrome(); this.activate('noise'); this.render(); this.invalidate(); }
  close() { this.flush(); this.cancelGesture(); this.endSample(false); this.active = false; this.context.timeline.origin = this.context.tempo.beat(this.context.seconds(), this.context.session.line?.bpmfactor ?? 1); this.syncChrome(); this.activate('chart'); this.invalidate(); }
  reset() { this.cancelGesture(); this.endSample(false); this.active = false; this.selected = -1; this.selection.clear(); this.event = null; this.pending = null; this.areaList.reset(); this.syncChrome(); }
  syncChrome() {
    document.querySelector('.editor').classList.toggle('noise-mode', this.active);
    this.canvas.hidden = !this.active || this.context.previewVisible || Boolean(this.sampleMode);
    document.querySelector('#noise-tab').hidden = !this.active;
    this.overlay.hidden = !this.sampleMode; this.sampleBar.hidden = !this.sampleMode;
    document.querySelector('.editor').classList.toggle('noise-sampling', Boolean(this.sampleMode));
    document.querySelector('#mirror').disabled = this.active;
    document.querySelector('#batch-run').disabled = this.active || !this.context.session.selection.size;
    document.querySelector('#notes-only').disabled = this.active || this.context.session.multiLineActive;
    document.querySelector('#selection-info').textContent = this.active ? `${this.selection.size} 个噪域${this.event || [...this.selection].some(key => !key.startsWith('area:')) ? '内部事件' : ''}已选` : this.context.session.focus === 'events' ? `${this.context.session.eventSelection.size} 个事件已选` : `${this.context.session.selection.size} 个音符已选`;
    if (!this.sampleMode) document.querySelector('#realtime-preview').hidden = !this.context.realtimePreview.visible;
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
  edit(change, finish = true) {
    if (!this.area()) return;
    try {
      const previous = this.event ? this.area()[this.event.type]?.[this.event.index] : null;
      const area = change(structuredClone(this.area()));
      if (previous?.linkgroup > 0 && this.event.type !== 'activeIntervals') {
        const next = area[this.event.type][this.event.index];
        const fields = ['start', 'end', 'easingType', 'easingLeft', 'easingRight', 'bezier', 'bezierPoints'];
        if (fields.some(field => JSON.stringify(previous[field]) !== JSON.stringify(next[field]))) area[this.event.type] = area[this.event.type].map((entry, index) => {
          if (index === this.event.index || entry.linkgroup !== previous.linkgroup) return entry;
          const linked = { ...entry, ...Object.fromEntries(fields.filter(field => next[field] !== undefined).map(field => [field, structuredClone(next[field])])) };
          if (linked.inst) linked.end = linked.start;
          return linked;
        });
      }
      this.draftChart = this.replaceArea(area);
      if (finish) this.flush();
      this.invalidate();
    } catch (error) { if (finish) this.report(error); return false; }
    return true;
  }
  flush() {
    if (!this.draftChart || this.sampleMode) return;
    const chart = this.draftChart; this.draftChart = null; this.formCommitting = true;
    try { this.commit('编辑噪域属性', chart); } catch (error) { this.report(error); }
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
    const areas = [...this.areas(), { ...createNoiseArea(start, end), editorPositionX: this.editorX(horizontal) }]; const index = areas.length - 1;
    if (this.commitAreas('添加噪域', areas)) this.select(index);
  }
  addEvent(type, start, end, hooked = false) {
    const area = this.area(); if (!area) { this.notify('先在左侧选择一个噪域', 'warning'); return; }
    const sample = noiseRuntime(area, this.context.tempo).sample(this.context.tempo.seconds(start));
    const value = sample.values[type]?.value ?? 0;
    const event = type === 'activeIntervals' ? { startTime: fromNumber(start), endTime: fromNumber(end), readyFlash: 0.5 } : { ...createNoiseEvent(value, value, start, end, noiseHasAnchor(type) ? sample.values[type]?.event?.anchor ?? noiseCenter(area) : undefined), inst: hooked ? 1 : 0 };
    const events = [...(area[type] ?? []), event]; const areas = this.areas().map((entry, index) => index === this.selected ? { ...entry, [type]: events } : entry);
    if (this.commitAreas('放置噪域' + NOISE_TRACKS.find(track => track[0] === type)[1], areas)) this.select(this.selected, { type, index: events.length - 1 });
  }
  remove() {
    const keys = this.selection;
    if (!keys.size) return;
    let areas = this.areas();
    if ([...keys].some(key => key.startsWith('area:'))) { areas = areas.filter((area, index) => !keys.has('area:' + index)); this.selected = -1; }
    else if (this.area()) areas = areas.map((area, index) => index === this.selected ? { ...area, ...Object.fromEntries(NOISE_TRACKS.map(([type]) => [type, (area[type] ?? []).filter((event, eventIndex) => !keys.has(type + ':' + eventIndex))])) } : area);
    this.selection.clear(); this.event = null; this.commitAreas('删除噪域对象', areas);
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
    this.notify(cut ? '已剪切噪域对象' : '已复制噪域对象', 'success'); this.invalidate();
  }
  pastedAreas(at, keepTime = false) {
    const areas = [...this.areas()]; const delta = keepTime ? 0 : at - this.clipboard.start;
    const firstArea = this.clipboard.entries.find(entry => entry.type === 'area');
    const deltaX = firstArea && this.cursor?.side === 'areas' ? this.editorX(this.cursor.x) - firstArea.value.editorPositionX : 0;
    for (const entry of this.clipboard.entries) {
      if (entry.type === 'area') areas.push({ ...shiftNoiseArea(entry.value, delta), editorPositionX: Math.max(-675, Math.min(675, entry.value.editorPositionX + deltaX)) });
      else {
        if (!areas[this.selected]) throw new Error('请先选择接收事件的噪域');
        const area = areas[this.selected]; const value = { ...structuredClone(entry.value), startTime: fromNumber(beatValue(entry.value.startTime) + delta), endTime: fromNumber(beatValue(entry.value.endTime) + delta) };
        areas[this.selected] = { ...area, [entry.type]: [...(area[entry.type] ?? []), value] };
      }
    }
    return areas;
  }
  action(action) {
    if (!this.active) return false;
    if (action === 'Esc') {
      if (this.sampleMode) this.endSample(false);
      else { this.cancelGesture(); this.selection.clear(); this.event = null; this.pending = null; this.clipboard = null; this.activate('noise'); this.render(); }
    } else if (this.sampleMode) return ['Copy', 'Shear', 'Paste', 'Delete', 'QuickDelete', 'AddTap', 'AddEvent'].includes(action);
    else if (action === 'Copy' || action === 'Shear') this.copy(action === 'Shear');
    else if (['Delete', 'QuickDelete'].includes(action)) this.remove();
    else if (['Paste', 'KeepTimePaste', 'PasteMirror', 'KeepTimePasteMirror'].includes(action)) {
      if (this.clipboard) {
        try { this.commitAreas('粘贴噪域对象', this.pastedAreas(this.cursor?.beat ?? this.context.timeline.origin, action.startsWith('KeepTime'))); } catch (error) { this.report(error); }
      }
    } else if (action === 'SelectAll') {
      this.selection = new Set(this.cursor?.side === 'events' && this.area() ? NOISE_TRACKS.flatMap(([type]) => (this.area()[type] ?? []).map((entry, index) => type + ':' + index)) : this.areas().map((area, index) => 'area:' + index)); this.render();
    } else if (['AddTap', 'AddHold', 'AddEvent'].includes(action)) this.place(action === 'AddTap');
    else if (['SwitchUI', 'ToggleMultiLine', 'SwitchMultiLineMode', 'NumberMirror', 'NumberFill', 'AddDrag', 'AddFlick', 'CurveBegin', 'CurveEnd'].includes(action) || action?.startsWith('Page')) return true;
    else return false;
    this.invalidate(); return true;
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
  hit(point) { return this.rects.findLast(rect => Boolean(rect.type) === (point.side === 'events') && point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= Math.max(HEADER_HEIGHT, rect.y - 5) && point.y <= rect.y + rect.height + 5); }
  hitKind(rect, point) { return Math.abs(point.y - rect.head) <= 7 ? 'start' : Math.abs(point.y - rect.tail) <= 7 ? 'end' : 'move'; }
  syncHover() { const hit = this.cursor && this.hit(this.cursor); this.hover = hit ? { ...hit, kind: this.hitKind(hit, this.cursor) } : null; this.canvas.style.cursor = this.drag && ['move', 'start', 'end'].includes(this.drag.kind) ? this.drag.kind === 'move' ? 'grabbing' : 'ns-resize' : this.hover ? this.hover.kind === 'move' ? 'grab' : 'ns-resize' : 'default'; }
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
  place(hooked = false) {
    if (!this.cursor || this.cursor.y < HEADER_HEIGHT) return;
    if (!this.pending) this.pending = { ...this.cursor, hooked };
    else {
      const start = Math.min(this.pending.beat, this.cursor.beat); const end = Math.max(this.pending.beat, this.cursor.beat);
      if (this.pending.side === 'areas') this.add(start, end, this.pending.x);
      else this.addEvent(this.pending.type, start, end, this.pending.hooked);
      this.pending = null;
    }
    this.invalidate();
  }
  down(event) {
    if (event.button !== 0 && event.button !== 1) return;
    if (this.point(event).y < HEADER_HEIGHT) return;
    event.preventDefault(); event.stopPropagation(); this.flush(); this.pause(); this.cursor = this.point(event); this.canvas.focus();
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
    const drag = this.drag; const previous = drag.current ?? drag.start; drag.current = this.cursor;
    drag.moved ||= Math.hypot(this.cursor.x - drag.start.x, this.cursor.y - drag.start.y) > 4;
    if (drag.kind === 'stroke' && drag.moved) {
      drag.points.push(this.cursor);
      for (const rect of this.rects) if (Boolean(rect.type) === (drag.start.side === 'events') && strokeIntersects({ x: previous.x, y: this.y(previous.rawBeat) }, this.cursor, { left: rect.x, right: rect.x + rect.width, top: rect.y, bottom: rect.y + rect.height })) {
        if ([...this.selection].some(key => key.startsWith('area:') !== !rect.type)) this.selection.clear();
        this.selection.add(rect.type ? rect.type + ':' + rect.index : 'area:' + rect.index);
      }
    }
    if (drag.kind === 'rectangle' || drag.kind === 'stroke' || !drag.moved) { this.invalidate(); return; }
    const delta = this.cursor.beat - drag.start.beat; const areas = structuredClone(drag.base.blockAreaList ?? []);
    for (const key of drag.keys) {
      const [type, rawIndex] = key.split(':'); const index = Number(rawIndex);
      const entry = type === 'area' ? areas[index] : areas[this.selected]?.[type]?.[index]; if (!entry) continue;
      const startKey = type === 'area' ? 'appearTime' : 'startTime'; const endKey = type === 'area' ? 'disappearTime' : 'endTime';
      if (drag.kind === 'move') {
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
      for (const rect of this.allRects ?? []) if ((Boolean(rect.type) === (drag.start.side === 'events')) && rect.x <= right && rect.x + rect.width >= left && rect.start <= end && rect.end >= start) this.selection.add(rect.type ? rect.type + ':' + rect.index : 'area:' + rect.index);
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
      const actions = document.createElement('div'); actions.className = 'noise-actions';
      actions.append(button('关闭编辑', '返回音符与事件编辑区', () => this.close())); this.host.append(actions);
      this.host.append(hint('Q / R 两次定位放置。拖动首尾调整时间，拖动身体整体移动；左侧窄条可自由横向排布。Shift / 中键框选，空白处按住左键划线多选；Ctrl+C/X/V 复制、剪切、粘贴。'));
      this.host.append(this.areaList.element);
    }
    const listTitle = '噪域 · ' + this.areas().length;
    if (this.listTitle.textContent !== listTitle) this.listTitle.textContent = listTitle;
    this.areaList.update(this.areas(), this.selected);
    const signature = `${this.selected}/${this.event?.type}/${this.event?.index}`;
    const focused = this.properties.contains(document.activeElement) && document.activeElement.matches('input,select') ? document.activeElement : null;
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
    if (kind === 'checkbox') input.checked = Boolean(value); else input.value = kind === 'beat' ? formatBeat(value) : kind === 'duration' ? durationText(value) : kind === 'number' && !choices ? round(value) : value;
    input.step = kind === 'number' ? 'any' : String(step);
    const read = () => kind === 'checkbox' ? input.checked : kind === 'beat' ? parseBeat(input.value) : kind === 'text' ? input.value : (input.value.trim() ? Number(input.value) : NaN);
    input.oninput = () => { try { const valid = this.edit(area => apply(area, read()), false); input.setCustomValidity(valid ? '' : '数值无效或事件重叠'); } catch (error) { input.setCustomValidity(error.message); } };
    input.onchange = () => { input.oninput(); if (input.checkValidity()) this.flush(); else this.notify(input.validationMessage, 'error'); };
    if (kind === 'number' || kind === 'duration' || kind === 'beat') {
      input.addEventListener('wheel', event => { event.preventDefault(); event.stopPropagation(); try { const increment = kind === 'beat' ? 1 / this.context.timeline.division : kind === 'duration' ? 0.001 : step; const current = kind === 'beat' ? beatValue(read()) : Number(input.value); const next = current + (event.deltaY < 0 ? increment : -increment); input.value = kind === 'beat' ? formatBeat(fromNumber(next)) : kind === 'duration' ? durationText(next) : round(next); input.onchange(); } catch (error) { this.report(error); } }, { passive: false });
    }
    controls.append(input);
    if (sample) controls.append(button('⌖', '在预览中拖动取样：' + labelText, () => this.beginSample(sample)));
    if (clear) controls.append(button('×', '关闭预备闪烁', () => { input.value = '0'; input.onchange(); }));
    if (kind === 'beat') { const nudges = document.createElement('span'); nudges.className = 'noise-beat-nudges'; for (const [text, direction] of [['▴', 1], ['▾', -1]]) nudges.append(button(text, '调整一横线', () => { try { input.value = formatBeat(fromNumber(beatValue(read()) + direction / this.context.timeline.division)); input.onchange(); } catch (error) { this.report(error); } })); controls.append(nudges); }
    label.append(controls); host.append(label); return input;
  }
  renderProperties(host = this.properties) {
    host.replaceChildren();
    host.append(button('← 噪域列表', '返回噪域管理', () => this.activate('noise')));
    const area = this.area(); if (!area) { host.append(hint('请在左侧选择噪域。')); return; }
    const title = document.createElement('h3'); title.textContent = this.event ? NOISE_TRACKS.find(track => track[0] === this.event.type)[1] + ' · 噪域 ' + this.selected : '噪域 ' + this.selected; host.append(title);
    const modifyEvent = change => item => { const event = item[this.event.type][this.event.index]; change(event); return item; };
    if (this.event) {
      const { type, index } = this.event; const event = area[type][index];
      for (const [field, label] of [['startTime', '开始拍'], ['endTime', '结束拍']]) this.field(host, label, event[field], (item, value) => modifyEvent(entry => { entry[field] = value; })(item), { kind: 'beat' });
      if (type === 'activeIntervals') this.field(host, '预备闪烁时长（秒）', readyFlashValue(event.readyFlash), (item, value) => modifyEvent(entry => { entry.readyFlash = Math.max(0, Math.round(value * 1000) / 1000); })(item), { kind: 'duration', clear: true });
      else {
        for (const [field, label] of [['start', '首值'], ['end', '尾值']]) this.field(host, label, event[field], (item, value) => modifyEvent(entry => { entry[field] = value; if (entry.inst) entry[field === 'start' ? 'end' : 'start'] = value; })(item), { step: type.startsWith('scale') ? 0.1 : 1, sample: { type, index, field } });
        if (noiseHasAnchor(type)) for (const axis of ['x', 'y']) this.field(host, '锚点 ' + axis.toUpperCase(), event.anchor[axis], (item, value) => modifyEvent(entry => { entry.anchor[axis] = value; })(item), { sample: { type, index, field: 'anchor' } });
        this.field(host, '钩定（首尾同步）', event.inst, (item, value) => modifyEvent(entry => { entry.inst = value ? 1 : 0; if (value) entry.end = entry.start; })(item), { kind: 'checkbox' });
        this.field(host, '绑定组', event.linkgroup ?? 0, (item, value) => modifyEvent(entry => { entry.linkgroup = Math.max(0, Math.round(value)); })(item));
        if (event.linkgroup > 0) host.append(button('选中绑定组 ' + event.linkgroup, '选中本噪域中同组的变换事件', () => { this.selection = new Set(NOISE_TRACKS.slice(1).flatMap(([track]) => (this.area()[track] ?? []).flatMap((entry, position) => entry.linkgroup === event.linkgroup ? [track + ':' + position] : []))); this.render(); this.invalidate(); }));
        this.field(host, '缓动', event.easingType ?? 1, (item, value) => modifyEvent(entry => { entry.easingType = value; })(item), { choices: EASING_NAMES.map((name, position) => [position + 1, (position + 1) + ' · ' + name]) });
        host.append(createEasingPicker(event.easingType ?? 1, value => this.edit(modifyEvent(entry => { entry.easingType = value; })), this.easingState).element);
        for (const [field, label] of [['easingLeft', '缓动左边界'], ['easingRight', '缓动右边界']]) this.field(host, label, event[field] ?? (field === 'easingLeft' ? 0 : 1), (item, value) => modifyEvent(entry => { entry[field] = value; })(item), { step: 0.05 });
        this.field(host, 'Bezier', event.bezier, (item, value) => modifyEvent(entry => { entry.bezier = value ? 1 : 0; })(item), { kind: 'checkbox' });
        for (const [position, label] of ['控制点 1 X', '控制点 1 Y', '控制点 2 X', '控制点 2 Y'].entries()) this.field(host, label, (event.bezierPoints ?? [0, 0, 1, 1])[position], (item, value) => modifyEvent(entry => { entry.bezierPoints ??= [0, 0, 1, 1]; entry.bezierPoints[position] = value; })(item), { step: 0.05 });
      }
      host.append(button('噪域基础属性', '查看初始矩形与生命周期', () => this.select(this.selected)));
    } else {
      this.field(host, '名称', area.Name ?? '', (item, value) => ({ ...item, Name: value }), { kind: 'text' });
      for (const [field, label] of [['appearTime', '出现拍'], ['disappearTime', '消失拍']]) this.field(host, label, area[field], (item, value) => ({ ...item, [field]: value }), { kind: 'beat' });
      for (const [field, label] of [['bottomLeft', '左下'], ['topRight', '右上']]) for (const axis of ['x', 'y']) this.field(host, label + ' ' + axis.toUpperCase(), area[field][axis], (item, value) => ({ ...item, [field]: { ...item[field], [axis]: value } }), { sample: { field } });
      this.field(host, '反转覆盖', area.isInvert, (item, value) => ({ ...item, isInvert: value }), { kind: 'checkbox' });
      host.append(hint('调整生命周期首尾不会缩放或裁剪内部事件。整体移动会平移所有内部时间；所有内部时间仍为全谱绝对拍数。'));
    }
    host.append(button('删除选中对象', '删除，可撤销', () => this.remove()));
  }
  beginSample(target) {
    this.flush(); this.pause(); const area = this.area(); if (!area) return;
    this.sampleMode = { ...samplingTarget(area, target.type, target.index, target.field), base: this.sampleMode?.base ?? this.context.session.chart };
    this.sampleSeconds = target.type ? this.context.tempo.seconds(area[target.type][target.index][target.field === 'end' ? 'endTime' : 'startTime']) : this.context.tempo.seconds(this.context.timeline.origin);
    this.sampleZoom ??= [this.context.preview, this.context.realtimePreview].map(renderer => ({ renderer, original: renderer.viewDivisor ?? 1, divisor: renderer.viewDivisor ?? 1 }));
    this.sampleDrag = null; this.render(); this.invalidate();
  }
  endSample(apply) {
    if (!this.sampleMode) return;
    for (const { renderer, original } of this.sampleZoom ?? []) renderer.viewDivisor = original;
    this.sampleZoom = null;
    const chart = this.draftChart; this.sampleMode = null; this.sampleDrag = null; this.draftChart = null; this.syncChrome();
    if (apply && chart) { try { this.commit('预览拖动取样', chart); } catch (error) { this.report(error); } }
    this.render(); this.invalidate();
  }
  fitSampleView() {
    const previousView = this.sampleView();
    const rect = this.overlay.getBoundingClientRect(); const controlsBottom = this.sampleBar.getBoundingClientRect().bottom - rect.top;
    const handle = noiseSampleHandle(this.area(), this.context.tempo, this.sampleSeconds, this.sampleMode);
    for (const zoom of this.sampleZoom ?? []) {
      if (this.context.sampleAutoFit !== false) zoom.divisor = fitNoiseSampleView(handle, rect.width, rect.height, zoom.renderer.aspectRatio ?? 1.5, zoom.divisor, controlsBottom);
      zoom.renderer.viewDivisor = this.context.sampleAutoFit === false ? zoom.original : zoom.divisor;
    }
    const view = this.sampleView();
    if (this.sampleDrag && view.scale !== previousView.scale) {
      const position = view.screen(handle); const pointer = this.sampleDrag.pointer;
      this.sampleDrag.offset = { x: pointer.x - view.left - position.x, y: pointer.y - view.top - position.y };
    }
  }
  sampleView() {
    const rect = this.overlay.getBoundingClientRect(); const renderer = this.context.previewVisible ? this.context.preview : this.context.realtimePreview;
    const viewport = previewViewport(rect.width, rect.height, renderer.aspectRatio ?? 1.5); const scale = viewport.scale / (renderer.viewDivisor ?? 1);
    return { ...rect.toJSON(), viewport, scale, world: point => ({ x: (point.x - rect.width / 2) / scale, y: (rect.height / 2 - point.y) / scale }), screen: point => ({ x: rect.width / 2 + point.x * scale, y: rect.height / 2 - point.y * scale }) };
  }
  sampleDown(event) {
    if (!this.sampleMode || event.button !== 0) return; event.preventDefault(); event.stopPropagation();
    const view = this.sampleView(); const point = { x: event.clientX - view.left, y: event.clientY - view.top }; const handle = view.screen(noiseSampleHandle(this.area(), this.context.tempo, this.sampleSeconds, this.sampleMode));
    if (Math.hypot(point.x - handle.x, point.y - handle.y) > 26) return;
    this.overlay.setPointerCapture(event.pointerId); this.sampleDrag = { pointer: { x: event.clientX, y: event.clientY }, offset: { x: point.x - handle.x, y: point.y - handle.y } };
  }
  sampleMove(event) {
    if (!this.sampleDrag) return;
    this.sampleDrag.pointer = { x: event.clientX, y: event.clientY };
    const view = this.sampleView(); const point = view.world({ x: event.clientX - view.left - this.sampleDrag.offset.x, y: event.clientY - view.top - this.sampleDrag.offset.y });
    try { const area = applyNoiseSample(this.area(), this.context.tempo, this.sampleSeconds, this.sampleMode, point); this.draftChart = this.replaceArea(area); this.fitSampleView(); this.invalidate(); } catch (error) { this.notify(error.message, 'warning'); this.sampleDrag = null; }
  }
  previewState() {
    if (!this.sampleMode) return { chart: this.chart };
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
    const sample = sampleEditingArea(area, this.context.tempo, this.sampleSeconds, this.sampleMode); const points = sample.points.map(view.screen);
    context.strokeStyle = '#67efa4'; context.lineWidth = 2; context.beginPath(); points.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y)); context.closePath(); context.stroke();
    const anchor = this.sampleMode.type && noiseHasAnchor(this.sampleMode.type) ? area[this.sampleMode.type][this.sampleMode.index].anchor : null;
    if (anchor) { const point = view.screen(anchor); context.strokeStyle = '#f0ca67'; context.beginPath(); context.moveTo(point.x - 9, point.y); context.lineTo(point.x + 9, point.y); context.moveTo(point.x, point.y - 9); context.lineTo(point.x, point.y + 9); context.stroke(); context.fillStyle = '#f0ca67'; context.fillText('锚点', point.x + 12, point.y); }
    const handle = view.screen(noiseSampleHandle(area, this.context.tempo, this.sampleSeconds, this.sampleMode)); context.fillStyle = '#5cffa1'; context.beginPath(); context.arc(handle.x, handle.y, 9, 0, Math.PI * 2); context.fill(); context.strokeStyle = '#152a1d'; context.stroke();
    context.fillStyle = '#c8ffdf'; context.font = '14px sans-serif'; context.fillText('拖动绿色控制点 · 当前取样拍 ' + round(this.context.tempo.beat(this.sampleSeconds)), 18, height - 20);
    if (handle.x < 0 || handle.x > width || handle.y < 0 || handle.y > height) context.fillText('控制点在视野外：增大工具栏“缩放”以扩大可见范围', 18, height - 42);
  }
  draw() {
    this.syncChrome(); if (!this.active || this.context.previewVisible || this.sampleMode) return;
    const { context, width, height } = prepareCanvas(this.canvas); const layout = this.layout();
    this.drawingLayout = layout;
    try { this.drawTimeline(context, width, height, layout); } finally { this.drawingLayout = null; }
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
    for (let index = 0; index <= timeline.gridCount; index++) { const horizontal = 12 + index * (layout.split - 24) / timeline.gridCount; context.strokeStyle = '#71767c35'; context.beginPath(); context.moveTo(horizontal, HEADER_HEIGHT); context.lineTo(horizontal, height); context.stroke(); }
    for (let index = 0; index <= 6; index++) { const horizontal = layout.eventLeft + index * layout.eventWidth; context.strokeStyle = '#7f838755'; context.beginPath(); context.moveTo(horizontal, HEADER_HEIGHT); context.lineTo(horizontal, height); context.stroke(); }
    this.rects = []; this.allRects = [];
    const drawEntry = (entry, index, type, x, entryWidth, ghost = false) => {
      const start = beatValue(entry[type ? 'startTime' : 'appearTime']); const end = beatValue(entry[type ? 'endTime' : 'disappearTime']);
      const head = this.y(start); const tail = this.y(end); const top = Math.min(head, tail); const bottom = Math.max(head, tail); const entryHeight = Math.max(5, bottom - top);
      const rect = { x, y: top, width: entryWidth, height: entryHeight, index, type, head, tail, start, end };
      if (!ghost) this.allRects.push(rect);
      if (bottom < HEADER_HEIGHT || top > height || x + entryWidth < (type ? layout.eventLeft : 0) || x > (type ? width : layout.split)) return;
      if (!ghost) this.rects.push(rect);
      const selected = this.selection.has(type ? type + ':' + index : 'area:' + index); const color = selected ? '#6de9a4' : type ? colors[NOISE_TRACKS.findIndex(track => track[0] === type)] : '#c97c7c';
      const hovered = !ghost && this.hover?.index === index && this.hover?.type === type;
      context.save(); context.beginPath(); context.rect(type ? layout.eventLeft : 0, HEADER_HEIGHT, type ? width - layout.eventLeft : layout.split, height - HEADER_HEIGHT); context.clip();
      context.globalAlpha = ghost ? 0.4 : 1; context.fillStyle = color + (hovered && this.hover.kind === 'move' ? '75' : '40'); context.fillRect(x, top, entryWidth, entryHeight); context.strokeStyle = hovered ? '#fff1d2' : color; context.lineWidth = selected || hovered ? 2 : 1; if (ghost) context.setLineDash([4, 3]); context.strokeRect(x, top, entryWidth, entryHeight);
      if (!type && !ghost) this.drawDistribution(context, entry, x, entryWidth, top, bottom);
      context.fillStyle = color; context.fillRect(x, head - 2, entryWidth, 4); context.fillRect(x, tail - 2, entryWidth, 4);
      if (hovered && this.hover.kind !== 'move') { context.fillStyle = '#fff1d2'; context.fillRect(x - 2, (this.hover.kind === 'start' ? head : tail) - 4, entryWidth + 4, 8); }
      context.font = '12px sans-serif'; context.textAlign = 'center';
      if (!type) context.fillText((entry.Name || '噪域 ' + index) + (entry.isInvert ? ' ⊕' : ''), x + entryWidth / 2, Math.max(HEADER_HEIGHT + 16, Math.min(height - 12, top + 18)), Math.max(1, entryWidth - 4));
      else if (type === 'activeIntervals') context.fillText(readyFlashValue(entry.readyFlash) > 0 ? `预闪 ${durationText(readyFlashValue(entry.readyFlash))}s` : '无预闪', x + entryWidth / 2, Math.max(HEADER_HEIGHT + 16, top + 18), Math.max(1, entryWidth - 4));
      else {
        context.fillText(String(round(entry.end)), x + entryWidth / 2, tail + 14, entryWidth); context.fillText(String(round(entry.start)), x + entryWidth / 2, head - 5, entryWidth);
        if (entryHeight > 30) {
          const track = noiseRuntime(this.area(), this.context.tempo).tracks[type]; const startSeconds = this.context.tempo.seconds(entry.startTime); const endSeconds = this.context.tempo.seconds(entry.endTime);
          context.beginPath();
          for (let step = 0; step <= 24; step++) { const progress = step / 24; const value = track.sample({ event: entry, start: startSeconds, end: endSeconds }, startSeconds + (endSeconds - startSeconds) * progress); const fraction = entry.start === entry.end ? 0.5 : (value - entry.start) / (entry.end - entry.start); const horizontal = x + entryWidth * (0.12 + Math.max(0, Math.min(1, fraction)) * 0.76); const vertical = head + (tail - head) * progress; if (step) context.lineTo(horizontal, vertical); else context.moveTo(horizontal, vertical); } context.stroke();
        }
      }
      context.restore();
    };
    this.areas().forEach((area, index) => drawEntry(area, index, null, this.areaX(area, index) - AREA_BAR_WIDTH / 2, AREA_BAR_WIDTH));
    for (const [type] of NOISE_TRACKS) { const bounds = this.eventBounds(type); (this.area()?.[type] ?? []).forEach((entry, index) => drawEntry(entry, index, type, bounds.x, bounds.width)); }
    if (this.pending && this.cursor) {
      const start = this.pending; const current = this.cursor; const bounds = this.eventBounds(start.type); context.fillStyle = '#78d99b44'; const top = this.y(Math.max(start.beat, current.beat)); const bottom = this.y(Math.min(start.beat, current.beat)); context.fillRect(start.side === 'areas' ? this.areaX({ editorPositionX: this.editorX(start.x) }, 0) - AREA_BAR_WIDTH / 2 : bounds.x, top, start.side === 'areas' ? AREA_BAR_WIDTH : bounds.width, Math.max(4, bottom - top));
    }
    if (this.clipboard && this.cursor && !this.drag && !this.pending) {
      const delta = this.cursor.beat - this.clipboard.start;
      const ghosts = this.clipboard.entries.some(entry => entry.type === 'area') ? this.pastedAreas(this.cursor.beat).slice(this.areas().length) : [];
      for (const area of ghosts) drawEntry(area, -1, null, this.areaX(area, 0) - AREA_BAR_WIDTH / 2, AREA_BAR_WIDTH, true);
      for (const entry of this.clipboard.entries) if (entry.type !== 'area' && this.area()) { const value = { ...entry.value, startTime: fromNumber(beatValue(entry.value.startTime) + delta), endTime: fromNumber(beatValue(entry.value.endTime) + delta) }; const bounds = this.eventBounds(entry.type); drawEntry(value, -1, entry.type, bounds.x, bounds.width, true); }
    }
    if (this.drag?.kind === 'rectangle') { const start = this.drag.start; const current = this.cursor; context.save(); context.lineWidth = 1; context.fillStyle = '#ffcc4430'; context.strokeStyle = '#ffdd77'; const top = this.y(start.rawBeat); const deltaY = this.y(current.rawBeat) - top; context.fillRect(start.x, top, current.x - start.x, deltaY); context.strokeRect(start.x, top, current.x - start.x, deltaY); context.restore(); }
    if (this.drag?.kind === 'stroke' && this.drag.moved) { context.save(); context.lineWidth = 1; context.strokeStyle = '#80ffff'; context.beginPath(); this.drag.points.forEach((point, index) => index ? context.lineTo(point.x, this.y(point.rawBeat)) : context.moveTo(point.x, this.y(point.rawBeat))); context.stroke(); context.restore(); }
    this.drawOwner(context, layout);
    context.fillStyle = '#303030'; context.fillRect(0, 0, width, HEADER_HEIGHT); context.fillStyle = '#f5f5f5'; context.font = '12px RPE, sans-serif'; context.textAlign = 'left'; context.fillText('噪域数量: ' + this.areas().length, 12, 19);
    const owner = this.area() ? `#${this.selected} ${this.area().Name || '未命名噪域'}` : '未指定噪域';
    this.canvas.setAttribute('aria-description', `噪域数量: ${this.areas().length}；当前右侧内部事件：${owner}`);
    context.fillText(owner, layout.eventLeft + 4, 19, width - layout.eventLeft - 8);
    context.textAlign = 'center'; for (const [column, [, label]] of NOISE_TRACKS.entries()) context.fillText(label, layout.eventLeft + (column + 0.5) * layout.eventWidth, 43, Math.max(1, layout.eventWidth - 3));
    context.strokeStyle = '#eee'; context.lineWidth = 2; context.beginPath(); context.moveTo(0, this.y(timeline.origin)); context.lineTo(width, this.y(timeline.origin)); context.stroke();
  }
  drawOwner(context, layout) {
    const area = this.area(); if (!area) return;
    const horizontal = this.areaX(area, this.selected); const top = this.y(beatValue(area.disappearTime)); const bottom = this.y(beatValue(area.appearTime));
    const above = bottom < HEADER_HEIGHT; const below = top > layout.height;
    context.save();
    context.beginPath(); context.rect(0, HEADER_HEIGHT, layout.split, layout.height - HEADER_HEIGHT); context.clip();
    const vertical = above ? HEADER_HEIGHT + 19 : below ? layout.height - 12 : Math.max(HEADER_HEIGHT + 18, Math.min(layout.height - 14, top + 36));
    const label = `${above ? '▲ ' : below ? '▼ ' : '→ '}#${this.selected} ${area.Name || '噪域'}`;
    context.font = '12px sans-serif'; context.textAlign = 'left'; const textWidth = Math.min(layout.split - 12, context.measureText(label).width + 10); const left = Math.max(6, Math.min(layout.split - textWidth - 6, horizontal + AREA_BAR_WIDTH / 2 + 7));
    context.fillStyle = '#242628ed'; context.fillRect(left - 3, vertical - 14, textWidth, 19); context.fillStyle = '#f5f5f5'; context.fillText(label, left, vertical, textWidth - 6); context.restore();
  }
  drawDistribution(context, area, left, width, top, bottom) {
    let distribution = this.distributions.get(area);
    if (!distribution) {
      distribution = NOISE_TRACKS.map(([type]) => {
        const intervals = (area[type] ?? []).map(event => [beatValue(event.startTime), beatValue(event.endTime)]).sort((first, second) => first[0] - second[0]);
        const merged = [];
        for (const interval of intervals) { const previous = merged.at(-1); if (previous && interval[0] <= previous[1]) previous[1] = Math.max(previous[1], interval[1]); else merged.push(interval); }
        return merged;
      });
      this.distributions.set(area, distribution);
    }
    context.save(); context.beginPath(); context.rect(left + 2, top + 2, width - 4, Math.max(0, bottom - top - 4)); context.clip(); context.globalAlpha *= 0.55;
    const spacing = (width - 12) / NOISE_TRACKS.length;
    for (const [column, intervals] of distribution.entries()) {
      context.fillStyle = colors[column];
      for (const [start, end] of intervals) {
        const upper = Math.max(HEADER_HEIGHT, top, this.y(end)); const lower = Math.min(this.layout().height, bottom, this.y(start));
        if (lower >= upper) context.fillRect(left + 6 + column * spacing, upper, Math.max(1, spacing - 2), Math.max(2, lower - upper));
      }
    }
    context.restore();
  }
}
