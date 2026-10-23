import { Timeline, prepareCanvas } from './timeline.mjs';
import { GlobalEventDocument } from '../application/global-events.mjs';
import { placedGlobalEvent, globalEventDensity } from '../core/global-events.mjs';
import { beatValue, fromNumber } from '../core/beat.mjs';
import { eventKey, selectAllEvents, transformEvents, deleteEvents, copyEvents, pasteEvents } from '../application/event-commands.mjs';
import { GlobalEventInspector } from './global-event-inspector.mjs';
import { editorSkinContext, editorCanvasRevision } from './editor-skin-canvas.mjs';
import { t } from '../i18n.mjs';

const node = (tag, className, text) => { const element = document.createElement(tag); if (className) element.className = className; if (text) element.textContent = text; return element; };
class GlobalTimeline extends Timeline {
  get eventTypes() { return this.owner?.document.columns.map(column => column.key) ?? []; }
  get factor() { return 1; }
  viewHeight() { return this.eventsCanvas.clientHeight; }
  eventColumnBounds(channel) {
    const column = this.owner.geometry?.[channel] ?? { left: 0, width: 80 }, channelWidth = column.width;
    const width = channelWidth * Math.max(0.35, Math.min(1, this.eventBarWidth ?? 0.82));
    return { channelWidth, left: column.left, x: column.left + (channelWidth - width) / 2, width };
  }
  eventChannelAt(x) { return this.owner.geometry?.findIndex(column => x >= column.left && x < column.left + column.width) ?? -1; }
  grid(context, width, height, playBeat) {
    context.save(); context.beginPath();
    for (const column of this.owner.geometry ?? []) context.rect(column.left, 0, column.width, height);
    context.clip();
    this.gridReferenceWidth = this.eventsCanvas.parentElement.clientWidth;
    super.grid(context, width, height, playBeat); context.restore();
  }
}

export class GlobalEventsEditor {
  constructor(host, canvas, registry, getContext, options) {
    Object.assign(this, options); this.host = host; this.canvas = canvas; this.registry = registry; this.getContext = getContext; this.active = false;
    this.properties = document.querySelector('#global-event-inspector');
    this.document = new GlobalEventDocument(registry, () => this.context.session, () => {
      if (this.active) {
        const signature = [...this.selection].sort().join('|');
        if (signature !== this.selectionSignature) { this.selectionSignature = signature; this.activate(this.selection.size === 1 ? 'global-event-properties' : 'global-events'); }
        this.render();
      }
      this.invalidate();
    });
    this.timeline = new GlobalTimeline(document.createElement('canvas'), canvas, () => this.document.editor, () => {}, () => this.invalidate(), error => this.report(error), event => this.onContextMenu?.(event));
    this.timeline.owner = this; this.timeline.extended = true; this.timeline.hoverArea = 'events'; this.timeline.tool = 0;
    this.timeline.panEventColumns = delta => { this.canvas.parentElement.scrollLeft -= delta; };
    this.timeline.onWheel = event => this.wheel(event); this.timeline.onDragScroll = seconds => this.context.timeline.onDragScroll?.(seconds);
    this.timeline.createPlacedEvent = (session, key, first, second, easing, line, inst, preview) => {
      const entry = this.document.columns.find(column => column.key === key); if (!entry) throw Error(t('global-events.s140de47'));
      return placedGlobalEvent(entry.type, entry.column, entry.events, first, second, easing, inst, preview);
    };
    this.timeline.formatEventValue = (value, key) => {
      const column = this.document.columns.find(column => column.key === key)?.column;
      if (column?.formatValue) return String(column.formatValue(value));
      return typeof value === 'number' ? String(Math.round(value * 1000) / 1000) : typeof value === 'boolean' ? value ? t('global-events.s30160a2') : t('global-events.s8bf5c10') : typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');
    };
    this.timeline.decorateEvent = (context, rectangle, event, selected) => {
      const entry = this.document.columns.find(column => column.key === rectangle.type);
      if (entry?.column.draw) this.safely(() => entry.column.draw({ context, rectangle, event, selected, tempo: this.context.tempo, seconds: this.context.seconds(), timeline: this.timeline, type: entry.type, column: entry.column }));
    };
    this.inspector = new GlobalEventInspector(this.properties, this);
    canvas.addEventListener('pointerdown', event => {
      if (this.active && event.button === 0 && this.selection.size === 1 && this.timeline.eventInteraction.hit(this.timeline.point(event, canvas))) this.activate('global-event-properties');
    });
    canvas.addEventListener('auxclick', event => event.preventDefault());
    canvas.addEventListener('contextmenu', event => { event.preventDefault(); this.timeline.cancelPlacement(); });
    this.registry.addEventListener('change', () => {
      this.timeline.cancelPlacement(); this.document.cached = null;
      if (this.active) this.render(); this.invalidate();
    });
  }
  get context() { return this.getContext(); }
  get selection() { this.document.snapshot(); return this.document.editor.eventSelection; }
  report(error) { this.notify(error.message ?? String(error), 'error'); }
  safely(action) { try { return action(); } catch (error) { this.report(error); } }
  open() {
    const source = this.context.timeline, stageWidth = this.canvas.closest('.stage').clientWidth;
    if (!this.active && !source.notesOnly && !source.getSession().multiLineActive && source.eventsCanvas.clientWidth) this.referenceChrome = stageWidth - source.eventsCanvas.clientWidth * 2;
    this.active = true; this.context.timeline.origin = this.context.tempo.beat(this.context.seconds());
    this.activate('global-events'); this.sync(); this.render(); this.invalidate();
  }
  close() {
    this.timeline.cancelPlacement(); this.inspector?.dispose(); this.active = false;
    this.context.timeline.origin = this.context.tempo.beat(this.context.seconds(), this.context.session.line?.bpmfactor ?? 1);
    this.syncChrome(); this.activate('chart'); this.invalidate();
  }
  reset() { this.timeline.cancelPlacement(); this.inspector?.dispose(); this.active = false; this.document.cached = null; this.document.editor.eventClipboard = []; this.document.editor.eventSelection.clear(); this.syncChrome(); }
  syncChrome() {
    document.querySelector('.editor').classList.toggle('global-events-mode', this.active);
    const hidden = !this.active || this.context.previewVisible, close = document.querySelector('#close-global-events');
    if (this.canvas.parentElement.hidden !== hidden) this.canvas.parentElement.hidden = hidden;
    if (close.hidden !== !this.active) close.hidden = !this.active;
    if (this.active) {
      for (const selector of ['#mirror', '#batch-run', '#notes-only']) { const button = document.querySelector(selector); if (!button.disabled) button.disabled = true; }
      const label = document.querySelector('#selection-info'), text = t('global-events.sdb21b0d', { p0: this.selection.size });
      if (label.textContent !== text) label.textContent = text;
    }
  }
  sync() {
    const source = this.context.timeline;
    for (const key of ['origin', 'scale', 'division', 'judgementOffset', 'judgementColor', 'barWidth', 'barAlpha', 'eventBarWidth', 'eventOpacity', 'seamlessEvents', 'drawEventCurves', 'eventValueFontSize', 'eventCurveThreshold', 'eventValueThreshold', 'scrollSpeed', 'selectionInterval']) this.timeline[key] = source[key];
    this.timeline.tempo = this.context.tempo;
    const columns = this.document.columns;
    if (this.labelColumns !== columns) {
      this.labelColumns = columns;
      this.timeline.eventLabels = columns.map(({ type, column }) => column.timelineLabel ?? (type.columns.length > 1 ? type.name + ' · ' + column.name : type.name));
    }
    const viewportWidth = this.canvas.parentElement.clientWidth;
    const gap = Number.parseFloat(getComputedStyle(this.canvas.closest('.canvases')).columnGap) || 0;
    const defaultWidth = Math.max(24, (viewportWidth - (this.referenceChrome ?? 48 + gap * 3)) / 10);
    if (this.geometryColumns !== columns || this.defaultWidth !== defaultWidth) {
      this.geometryColumns = columns; this.defaultWidth = defaultWidth;
      let left = 0, previous;
      this.gaps = []; this.geometry = columns.map(entry => {
        if (previous && previous !== entry.type.id) { this.gaps.push({ left, width: 18 }); left += 18; }
        const column = { left, width: entry.column.width ?? entry.type.width ?? defaultWidth }; left += column.width; previous = entry.type.id; return column;
      });
      const minWidth = Math.ceil(left) + 'px'; if (this.canvas.style.minWidth !== minWidth) this.canvas.style.minWidth = minWidth;
    }
    this.syncChrome();
  }
  draw(beat) {
    if (!this.active || this.context.previewVisible) return; this.sync();
    if (this.document.columns.length) {
      this.timeline.drawEvents(beat);
      const context = editorSkinContext(this.canvas.getContext('2d')); context.fillStyle = '#242424';
      for (const gap of this.gaps) context.fillRect(gap.left, 0, gap.width, this.canvas.clientHeight);
      context.strokeStyle = '#334154'; context.lineWidth = 1; context.beginPath();
      for (const x of new Set(this.geometry.flatMap(column => [column.left, column.left + column.width]))) {
        const line = Math.min(this.canvas.clientWidth - 0.5, Math.round(x) + 0.5);
        context.moveTo(line, 0); context.lineTo(line, this.canvas.clientHeight);
      }
      context.stroke();
    }
    else { const { context, width, height } = prepareCanvas(this.canvas); this.timeline.grid(context, width, height, beat); context.fillStyle = '#dddddd'; context.font = '14px RPE,sans-serif'; context.fillText(t('global-events.sa95cbd6'), 20, 45); }
    this.drawDensity();
  }
  autoScroll(elapsed) {
    if (!this.active || this.context.previewVisible || !this.timeline.drag && !this.timeline.eventInteraction.drag) return;
    this.sync(); this.timeline.autoScroll(elapsed);
  }
  copy(cut = false) {
    copyEvents(this.document.editor); this.document.editor.clipboardVisible = true;
    if (cut) deleteEvents(this.document.editor); this.invalidate();
  }
  remove() { deleteEvents(this.document.editor); }
  paste(keepTime = false) { const at = this.timeline.clipboardPointer ? this.timeline.snappedBeat(this.timeline.clipboardPointer.y) : this.context.tempo.beat(this.context.seconds()); pasteEvents(this.document.editor, at, keepTime); }
  action(action, event = {}) {
    if (!this.active || this.context.previewVisible) return false; this.sync();
    const session = this.document.editor;
    if (this.timeline.eventInteraction.pending && /^[0-9]$/.test(event.key) && !event.ctrlKey && !event.altKey) { this.timeline.eventInteraction.place(undefined, undefined, Number(event.key) || 10); return true; }
    if (['AddTap', 'AddEvent'].includes(action)) { if (!event.repeat) this.timeline.eventInteraction.place(undefined, undefined, undefined, action === 'AddTap'); }
    else if (action === 'SelectAll') { selectAllEvents(session, this.timeline.eventTypes); session.notify(); }
    else if (action === 'Copy') this.copy();
    else if (action === 'Shear') this.copy(true);
    else if (['Paste', 'KeepTimePaste', 'PasteMirror', 'KeepTimePasteMirror'].includes(action)) this.paste(action.startsWith('KeepTime'));
    else if (action === 'Delete') this.remove();
    else if (action === 'QuickDelete') {
      if (!this.selection.size) { const hit = this.timeline.eventCursor && this.timeline.eventInteraction.hit(this.timeline.eventCursor); if (hit) session.eventSelection = new Set([eventKey(hit.type, hit.index)]); }
      this.remove();
    }
    else if (['NumberMirror', 'NumberFill'].includes(action)) transformEvents(session, t('global-events.s3f09fbb'), (event, key) => {
      const column = this.document.columns.find(column => column.key === key)?.column;
      if (column?.shortcut) return column.shortcut({ action, event: structuredClone(event) }) ?? event;
      if (typeof event.start !== 'number' || typeof event.end !== 'number') return event;
      return action === 'NumberMirror' ? { ...event, start: -event.start, end: -event.end } : { ...event, end: event.start };
    });
    else if (['PageUp', 'PageDown'].includes(action)) { const delta = (action === 'PageUp' ? 1 : -1) / this.timeline.division; transformEvents(session, t('global-events.sa0942cd'), event => ({ ...event, startTime: fromNumber(beatValue(event.startTime) + delta), endTime: fromNumber(beatValue(event.endTime) + delta) })); }
    else if (['PageLeft', 'PageRight', 'AddDrag', 'AddFlick', 'AddHold', 'ToggleMultiLine', 'SwitchMultiLineMode', 'SwitchUI', 'ClipboardHistory', 'CurveBegin', 'CurveEnd'].includes(action)) { /* These operations have no global-column equivalent. */ }
    else if (action === 'Esc') { this.timeline.cancelPlacement(); session.eventSelection.clear(); session.clipboardVisible = false; session.notify(); }
    else return false;
    this.invalidate(); return true;
  }
  render() {
    if (!this.active) return; this.sync();
    if (!this.host.closest('[data-panel]').hidden) this.renderOverview();
    else if (!this.properties.closest('[data-panel]').hidden) this.inspector.render();
  }
  renderOverview() {
    this.inspector.dispose();
    const scroll = this.host.scrollTop; this.host.replaceChildren();
    const heading = node('div', 'panel-title', t('global-events.s895a20e')); heading.append(node('small', '', t('global-events.s17a8500', { p0: this.document.types.length }))); this.host.append(heading);
    const summary = node('div', 'global-events-types'); this.host.append(summary); this.densityBars = [];
    for (const type of this.document.types) {
      const entries = this.document.columns.filter(entry => entry.type.id === type.id), count = entries.reduce((sum, entry) => sum + entry.events.length, 0);
      const card = node('div', 'global-event-kind'); card.dataset.globalEventType = type.id;
      const title = node('button', 'global-event-kind-title', type.name); title.type = 'button'; title.onclick = () => { const index = this.document.columns.findIndex(entry => entry.type.id === type.id); this.canvas.parentElement.scrollLeft = this.geometry[index]?.left ?? 0; this.canvas.focus({ preventScroll: true }); };
      title.append(node('small', '', t('global-events.s487bf7d', { p0: count, p1: type.columns.length }))); card.append(title);
      if (type.source.kind === 'mod') card.append(node('div', 'hint global-event-source', t('global-events.s862e20d', { p0: type.source.name, p1: type.source.author, p2: type.readonly ? t('global-events.s90ce677') : '' })));
      else if (!type.persistent) card.append(node('div', 'hint global-event-source', t('global-events.s2372654')));
      const density = node('canvas', 'global-event-density'); density.dataset.skinCanvas = 'global-density'; density.setAttribute('aria-label', type.name + t('global-events.s3c63e9d')); density.title = t('global-events.se13c9ff');
      density.onclick = event => { const rect = density.getBoundingClientRect(); this.seek(this.context.tempo.beat(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * this.densityDuration())); };
      card.append(density); summary.append(card); this.densityBars.push({ canvas: density, type: type.id, entries });
    }
    this.host.append(node('p', 'hint', t('global-events.s757a231')));
    this.host.append(this.closeButton());
    const returnToTools = node('button', 'wide-button', t('global-events.sb3669b2')); returnToTools.type = 'button'; returnToTools.onclick = () => this.activate('chart'); this.host.append(returnToTools);
    this.host.scrollTop = scroll; this.drawDensity();
  }
  closeButton() {
    const button = node('button', 'wide-button', t('global-events.s60a080c')); button.type = 'button'; button.dataset.globalEventsClose = 'true'; button.onclick = () => this.close(); return button;
  }
  densityDuration() {
    const context = this.context, duration = Math.max(0, context.duration() - (context.session.chart.META.offset ?? 0) / 1000);
    if (duration) return duration;
    const columns = this.document.columns;
    if (this.densityRange?.columns !== columns || this.densityRange.tempo !== context.tempo) {
      let end = 0; for (const { events } of columns) for (const event of events) end = Math.max(end, context.tempo.seconds(event.endTime));
      this.densityRange = { columns, tempo: context.tempo, duration: Math.max(8, end + 2) };
    }
    return this.densityRange.duration;
  }
  drawDensity() {
    if (this.host.closest('[data-panel]').hidden) return;
    const duration = this.densityDuration(), tempo = this.context.tempo, seconds = this.context.seconds(), ratio = globalThis.devicePixelRatio || 1, skin = editorCanvasRevision();
    // Read sizes together before resizing canvases, avoiding alternating layout reads and writes.
    const frames = (this.densityBars ?? []).map(bar => ({ bar, rectangle: bar.canvas.getBoundingClientRect() }));
    for (const { bar, rectangle: { width, height } } of frames) {
      if (!width || !height) continue;
      const bins = Math.max(1, Math.round(width / 3)), pixelWidth = Math.round(width * ratio), pixelHeight = Math.round(height * ratio);
      const lists = bar.entries.map(entry => entry.events);
      const key = lists.every((list, index) => list === bar.lists?.[index]) && lists.length === bar.lists?.length && bar.duration === duration && bar.bins === bins && bar.tempo === this.context.tempo;
      if (!key) { bar.values = globalEventDensity(lists.flat(), tempo, duration, bins); bar.maximum = bar.values.reduce((value, item) => Math.max(value, item), 1); bar.lists = lists; bar.duration = duration; bar.bins = bins; bar.tempo = tempo; }
      const changed = !key || !bar.frame || bar.width !== width || bar.height !== height || bar.ratio !== ratio || bar.skin !== skin;
      if (changed) {
        bar.frame ??= document.createElement('canvas'); bar.frame.width = pixelWidth; bar.frame.height = pixelHeight;
        const context = editorSkinContext(bar.frame.getContext('2d'), 'global-density'); context.setTransform(ratio, 0, 0, ratio, 0, 0);
        context.fillStyle = '#282828'; context.fillRect(0, 0, width, height);
        for (let index = 0; index < bins; index++) if (bar.values[index]) { const amount = Math.sqrt(bar.values[index] / bar.maximum); context.fillStyle = '#d39b55'; context.globalAlpha = 0.3 + amount * 0.7; const top = height * (1 - amount) * 0.7; context.fillRect(index * width / bins, top, Math.max(1, width / bins - 0.5), height - top); }
        bar.width = width; bar.height = height; bar.ratio = ratio; bar.skin = skin;
      }
      const marker = Math.max(0, Math.min(width - 1, Math.round(seconds / duration * pixelWidth) / ratio));
      const resized = bar.canvas.width !== pixelWidth || bar.canvas.height !== pixelHeight;
      if (!changed && !resized && bar.marker === marker) continue;
      if (resized) { bar.canvas.width = pixelWidth; bar.canvas.height = pixelHeight; }
      const raw = bar.canvas.getContext('2d'); raw.setTransform(1, 0, 0, 1, 0, 0); raw.clearRect(0, 0, pixelWidth, pixelHeight); raw.drawImage(bar.frame, 0, 0);
      const context = editorSkinContext(raw); context.setTransform(ratio, 0, 0, ratio, 0, 0); context.fillStyle = '#ffffff'; context.fillRect(marker, 0, 1, height); bar.marker = marker;
    }
  }
}
