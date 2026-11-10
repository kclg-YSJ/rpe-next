import { beatValue, fromNumber } from '../core/beat.mjs';
import { eventKey, eventList, eventListAt, selectedEvents, selectedEventEntries, selectEvent, transformEvents, placedEvent, insertEventAt } from '../application/event-commands.mjs';
import { dragEventEndpoint } from '../core/event-drag.mjs';
import { strokeIntersects } from '../core/editor-display.mjs';
import { shaderEventLanes } from '../core/shader-events.mjs';
import { captureSelection, editCapturedSelection, commitSelectionEdit } from '../application/batch-edit.mjs';
import { eventDisplayIndex } from './event-display-index.mjs';
import { intervalSelection, extendIntervalSelection } from '../core/selection-interval.mjs';
import { t } from '../i18n.mjs';
import { expandXyEntries, xyOtherAxis } from '../application/xy-binding.mjs';

export class EventInteraction {
  constructor(timeline, reportError) {
    this.timeline = timeline; this.canvas = timeline.eventsCanvas; this.reportError = reportError; this.drag = null; this.pending = null;
    this.canvas.addEventListener('pointerdown', event => this.down(event));
    this.canvas.addEventListener('pointermove', event => this.move(event));
    this.canvas.addEventListener('pointerup', event => this.up(event));
    this.canvas.addEventListener('pointercancel', event => { if (timeline.endRectanglePan(event)) return; const tracing = this.drag?.kind === 'stroke' && this.drag.tracing; this.drag = null; if (tracing) timeline.getSession().notify(); timeline.changed(); });
    this.canvas.addEventListener('pointerleave', () => { if (!this.drag) this.timeline.eventCursor = null; });
  }

  hit(point) { return this.timeline.eventRects.findLast(rectangle => point.x >= rectangle.x && point.x <= rectangle.x + rectangle.width && point.y >= rectangle.y && point.y <= rectangle.y + rectangle.height); }
  endpointTarget() {
    if (this.timeline.rpeEventDrag !== true || !this.timeline.eventEndpointDragHeld || this.pending) return null;
    const entries = selectedEventEntries(this.timeline.getSession()); return entries.length === 1 && this.timeline.eventTypes.includes(entries[0].type) ? entries[0] : null;
  }
  consumeContextMenu() { const suppress = this.suppressContextMenu || this.drag?.endpoint; this.suppressContextMenu = false; return Boolean(suppress); }
  updateCursor(point = this.timeline.eventCursor) {
    if (!point) return;
    const hit = this.hit(point), edge = this.timeline.rpeEventDrag !== true && hit && (Math.abs(point.y - hit.y) < 6 || Math.abs(point.y - hit.y - hit.height) < 6);
    this.canvas.style.cursor = this.drag?.endpoint || this.endpointTarget() || edge ? 'ns-resize' : hit ? 'move' : this.timeline.panEventColumns ? 'grab' : 'default';
  }
  previewEvent(event) {
    const drag = this.drag; if (!drag) return event;
    if (drag.endpoint) {
      if (event !== drag.event) {
        if (!drag.xyEvents?.has(event)) return event;
        const next = this.previewEvent(drag.event);
        return { ...event, startTime: next.startTime, endTime: next.endTime };
      }
      if (drag.frozen) return drag.frozen;
      const timeline = this.timeline;
      let beat;
      if (timeline.getSession().multiLineActive && timeline.getSession().multiLineMode === 'events') {
        const factor = timeline.factorForLine(drag.lineIndex);
        const seconds = timeline.tempo.seconds(timeline.origin, factor) + (timeline.viewHeight() - timeline.judgementOffset - drag.current.y) / timeline.scale;
        beat = Math.max(0, Math.round(timeline.tempo.beat(seconds, factor) * timeline.division) / timeline.division);
      } else beat = timeline.eventBeatAt(drag.current.y, drag.type, true);
      const next = dragEventEndpoint(event, drag.kind, beat); if (!timeline.eventEndpointDragHeld) drag.frozen = next; return next;
    }
    const delta = this.delta();
    return { ...event, startTime: drag.kind === 'endTime' ? event.startTime : fromNumber(beatValue(event.startTime) + delta), endTime: drag.kind === 'startTime' ? event.endTime : fromNumber(beatValue(event.endTime) + delta) };
  }
  previewRectangles(rectangles, width) {
    const drag = this.drag;
    if (drag?.xySnapshot) {
      const lineIndex = this.timeline.getSession().lineIndex;
      const visible = new Set(rectangles.map(rectangle => `${rectangle.lineIndex ?? lineIndex}:${rectangle.type}:${rectangle.index}`));
      const missing = [];
      for (const entry of drag.xySnapshot.events) {
        if (visible.has(`${entry.lineIndex}:${entry.type}:${entry.index}`)) continue;
        const channel = this.timeline.eventTypes.indexOf(entry.type); if (channel < 0) continue;
        const bounds = this.timeline.eventColumnBounds(channel, this.timeline.panelWidth(width, 'events'));
        const offset = this.timeline.panelIndex(entry.lineIndex, 'events') * this.timeline.panelStride(width, 'events') - this.timeline.multiLineViewportOffset(width, 'events');
        missing.push({ type: entry.type, index: entry.index, lineIndex: entry.lineIndex, x: bounds.x + offset, width: bounds.width });
      }
      if (missing.length) rectangles = [...rectangles, ...missing];
    }
    if (!drag?.endpoint || rectangles.some(rectangle => rectangle.type === drag.type && rectangle.index === drag.index && (rectangle.lineIndex ?? this.timeline.getSession().lineIndex) === drag.lineIndex)) return rectangles;
    const channel = this.timeline.eventTypes.indexOf(drag.type); if (channel < 0) return rectangles;
    const panelWidth = this.timeline.panelWidth(width, 'events'), bounds = this.timeline.eventColumnBounds(channel, panelWidth);
    const offset = this.timeline.panelIndex(drag.lineIndex, 'events') * this.timeline.panelStride(width, 'events') - this.timeline.multiLineViewportOffset(width, 'events');
    return [...rectangles, { type: drag.type, index: drag.index, lineIndex: drag.lineIndex, x: bounds.x + offset, width: bounds.width }];
  }
  delta() {
    if (!this.drag?.anchor) return 0;
    const start = this.drag.anchor;
    const factor = this.timeline.factorForLine(this.drag.lineIndex ?? this.timeline.getSession().lineIndex);
    const scroll = this.timeline.tempo.seconds(this.timeline.origin, factor) - (this.drag.originSeconds ?? this.timeline.tempo.seconds(this.timeline.origin, factor));
    const targetSeconds = this.timeline.tempo.seconds(start, factor) + (this.drag.start.y - this.drag.current.y) / this.timeline.scale + scroll;
    const target = this.timeline.tempo.beat(targetSeconds, factor);
    return Math.round(target * this.timeline.division) / this.timeline.division - beatValue(start);
  }

  createEvent(...args) { return this.timeline.createPlacedEvent ? this.timeline.createPlacedEvent(...args) : placedEvent(...args); }

  bindXyDrag(session) {
    if (session.xyBinding !== true || !this.drag || !['move','startTime','endTime'].includes(this.drag.kind)) return;
    const snapshot = captureSelection(session);
    if (!snapshot.events.some(entry => xyOtherAxis(entry.type))) return;
    const events = expandXyEntries(snapshot.chart, snapshot.eventLayer, snapshot.events);
    const selected = new Map();
    for (const entry of snapshot.events) { if (!selected.has(entry.lineIndex)) selected.set(entry.lineIndex, new Set()); selected.get(entry.lineIndex).add(eventKey(entry.type, entry.index)); }
    const selection = new Map();
    for (const entry of events) { if (!selection.has(entry.lineIndex)) selection.set(entry.lineIndex, new Set()); selection.get(entry.lineIndex).add(eventKey(entry.type, entry.index)); }
    this.drag.xySnapshot = { ...snapshot, notes: [], events }; this.drag.xySelected = selected;
    this.drag.xySelection = selection; this.drag.xyEvents = new Set(events.map(entry => entry.event));
  }

  previewSelected(type, index, lineIndex = this.timeline.getSession().lineIndex) {
    const session = this.timeline.getSession();
    const selection = this.drag?.xySelection?.get(lineIndex) ?? (session.multiLineActive && session.multiLineMode === 'events' ? session.multiEventSelection.get(lineIndex) : session.eventSelection);
    return selection?.has(eventKey(type,index)) ?? false;
  }

  place(type, beat, easingType, inst = false) {
    const session = this.timeline.getSession();
    if (!session.line) return false;
    const point = this.timeline.eventCursor;
    if (beat === undefined && !point) return false;
    const lineIndex = this.timeline.lineIndexAt(point?.x ?? 0, this.canvas.clientWidth, 'events');
    if (lineIndex < 0 || !this.timeline.eventTypes.length) return false;
    const panelWidth = this.timeline.panelWidth(this.canvas.clientWidth, 'events'); const panelOffset = this.timeline.panelIndex(lineIndex, 'events') * this.timeline.panelStride(this.canvas.clientWidth, 'events') - this.timeline.multiLineViewportOffset(this.canvas.clientWidth, 'events');
    const channel = this.timeline.eventChannelAt ? this.timeline.eventChannelAt((point?.x ?? 0) - panelOffset) : Math.max(0, Math.min(this.timeline.eventTypes.length - 1, Math.floor(((point?.x ?? 0) - panelOffset) / (panelWidth / this.timeline.eventTypes.length))));
    if (channel < 0 && !this.pending && !type) return false;
    const eventType = this.pending?.type ?? type ?? this.timeline.eventTypes[channel];
    if (!this.timeline.eventTypes.includes(eventType)) return false;
    const at = beat ?? this.timeline.eventBeatAt(point.y, eventType, true);
    session.focus = 'events'; session.eventLayer = this.timeline.layer; session.selection.clear();
    if (!this.pending) {
      this.pending = { type: eventType, beat: at, lineIndex, inst };
      session.notify();
    } else {
      let event;
      try { event = this.createEvent(session, this.pending.type, this.pending.beat, at, easingType, this.pending.lineIndex, this.pending.inst); }
      catch (error) { this.timeline.notify?.(error.message, 'error'); return false; }
      if (event) insertEventAt(session, this.pending.lineIndex ?? lineIndex, this.pending.type, event);
      this.pending = null;
    }
    this.timeline.changed(); return true;
  }

  down(event) {
    if (![0, 1, 2].includes(event.button)) return;
    event.preventDefault?.();
    if (this.timeline.rectangleSelection()) { if (!this.timeline.finishRectangle(event)) this.timeline.beginRectanglePan(event, this.canvas); return; }
    this.suppressContextMenu = false;
    const endpoint = [0, 2].includes(event.button) && this.endpointTarget();
    if (endpoint) {
      const session = this.timeline.getSession(), point = this.timeline.point(event, this.canvas);
      session.focus = 'events'; session.eventLayer = this.timeline.layer; this.timeline.hoverArea = 'events'; this.timeline.eventCursor = point; this.timeline.clipboardPointer = point;
      this.canvas.focus({ preventScroll: true }); this.canvas.setPointerCapture(event.pointerId);
      this.drag = { kind: event.button === 0 ? 'startTime' : 'endTime', endpoint: true, event: endpoint.event, type: endpoint.type, lineIndex: endpoint.lineIndex, index: endpoint.index, chart: session.chart, start: point, current: point };
      this.bindXyDrag(session);
      this.suppressContextMenu = event.button === 2; this.updateCursor(point); this.timeline.changed(); return;
    }
    if (event.button === 2) return;
    const session = this.timeline.getSession(); const point = this.timeline.point(event, this.canvas); const rectangle = this.hit(point);
    if (event.ctrlKey || event.shiftKey || event.button === 1) session.multiSelectionIntent = 'events';
    else if (rectangle) session.multiSelectionIntent = null;
    this.timeline.eventCursor = point; this.timeline.hoverArea = 'events';
    this.timeline.clipboardPointer = point;
    const panelLineIndex = session.multiLineActive && session.multiLineMode === 'events'
      ? this.timeline.lineIndexAt(point.x, this.canvas.clientWidth, 'events')
      : session.lineIndex;
    if (event.button === 0 && this.timeline.tool && !rectangle && !event.shiftKey && !event.ctrlKey) {
      try { this.place(null); } catch (error) { this.timeline.notify?.(error.message, 'error'); }
      return;
    }
    if (this.pending) {
      try { this.place(); } catch (error) { this.timeline.notify?.(error.message, 'error'); }
      return;
    }
    if (rectangle || event.ctrlKey || event.shiftKey || event.button === 1) { session.focus = 'events'; session.eventLayer = this.timeline.layer; }
    if (rectangle && !event.ctrlKey && !event.shiftKey && event.button !== 1) session.selection.clear();
    this.canvas.focus({ preventScroll: true }); this.canvas.setPointerCapture(event.pointerId);
    const multiMode = session.multiLineActive;
    const multiPanel = multiMode && this.timeline.panelCount('events') > 1;
    const panColumns = typeof this.timeline.panEventColumns === 'function';
    if ((multiPanel || panColumns) && (event.shiftKey || event.button === 1)) {
      const worldX = point.x + this.timeline.multiLineViewportOffset(this.canvas.clientWidth, 'events');
      this.drag = { kind: 'rectangle', area: 'events', start: point, startWorldX: worldX, current: point, currentWorldX: worldX, startFactor: this.timeline.factorForLine(panelLineIndex), startSeconds: this.timeline.timeAt(point.y), append: true, remove: false };
    } else if ((multiPanel || panColumns) && (!rectangle && !this.timeline.tool)) this.drag = { kind: 'multi-pan', start: point, current: point, clientX: event.clientX };
    else if (!multiMode && (event.shiftKey || event.button === 1)) this.drag = { kind: 'rectangle', area: 'events', start: point, startFactor: this.timeline.factorForLine(session.lineIndex), startSeconds: this.timeline.timeAt(point.y), current: point, append: true, remove: false };
    else if (rectangle && event.button === 0) {
      const selecting = event.ctrlKey || !(session.multiLineActive ? session.multiEventSelection?.get(rectangle.lineIndex ?? session.lineIndex) : session.eventSelection)?.has(eventKey(rectangle.type, rectangle.index));
      selectEvent(session, rectangle.lineIndex ?? session.lineIndex, rectangle.type, rectangle.index, { toggle: event.ctrlKey });
      const kind = this.timeline.rpeEventDrag !== true ? Math.abs(point.y - rectangle.y) < 6 ? 'endTime' : Math.abs(point.y - (rectangle.y + rectangle.height)) < 6 ? 'startTime' : 'move' : 'move';
      const selected = eventListAt(session, rectangle.lineIndex ?? session.lineIndex, rectangle.type)?.[rectangle.index];
      this.drag = { kind, selecting, type: rectangle.type, lineIndex: rectangle.lineIndex, start: point, current: point, anchor: selected?.[kind === 'endTime' ? 'endTime' : 'startTime'], originSeconds: this.timeline.tempo.seconds(this.timeline.origin, this.timeline.factorForLine(rectangle.lineIndex ?? session.lineIndex)) };
    } else if (!multiMode) this.drag = { kind: 'stroke', start: point, current: point, points: [point], remove: event.button === 2 };
    this.bindXyDrag(session);
    session.notify();
  }

  move(event) {
    if (this.timeline.rectangleSelection()?.drag.pan) this.timeline.updateRectangle(event);
    const point = this.timeline.point(event, this.canvas);
    this.timeline.eventCursor = point;
    this.timeline.clipboardPointer = point;
    this.timeline.hoverArea = 'events';
    if (this.drag?.endpoint) {
      if (this.timeline.eventEndpointDragHeld) { this.drag.current = point; this.drag.moved ||= Math.hypot(point.x - this.drag.start.x, point.y - this.drag.start.y) > 3; }
      this.updateCursor(point); this.timeline.changed(); return;
    }
    if (this.drag) {
      const previous = this.drag.current; this.drag.current = point; this.drag.currentWorldX = point.x + this.timeline.multiLineViewportOffset(this.canvas.clientWidth, 'events');
      if (this.drag.startFactor !== undefined) this.drag.currentSeconds = this.timeline.tempo.seconds(this.timeline.origin, this.drag.startFactor) + (this.timeline.viewHeight() - (this.timeline.judgementOffset ?? 42) - this.drag.current.y) / this.timeline.scale;
      if (this.drag.kind === 'multi-pan') {
        if (this.timeline.panEventColumns) {
          this.timeline.panEventColumns(event.clientX - this.drag.clientX); this.drag.clientX = event.clientX;
          const point = this.timeline.point(event, this.canvas); this.drag.current = point;
          this.timeline.eventCursor = point; this.timeline.clipboardPointer = point;
          this.canvas.style.cursor = 'grabbing'; this.timeline.changed(); return;
        }
        const current = this.timeline.multiLineViewportOffset(this.canvas.clientWidth, 'events');
        this.timeline.multiLineScroll.events = Math.max(0, current - (point.x - previous.x));
        this.timeline.changed();
        return;
      }
      if (this.drag.kind === 'stroke' && (this.drag.tracing || Math.hypot(point.x - this.drag.start.x, point.y - this.drag.start.y) > 3)) {
        if (!this.drag.tracing) { const session = this.timeline.getSession(); session.focus = 'events'; session.eventLayer = this.timeline.layer; session.selection.clear(); }
        this.drag.tracing = true;
        this.drag.points.push(point); const session = this.timeline.getSession();
        session.multiSelectionIntent = 'events';
        const candidates = [];
        for (const rectangle of this.timeline.eventRects) if ((rectangle.lineIndex === undefined || rectangle.lineIndex === session.lineIndex) && strokeIntersects(previous, point, { left: rectangle.x, right: rectangle.x + rectangle.width, top: rectangle.y, bottom: rectangle.y + rectangle.height })) {
          const event = eventListAt(session, rectangle.lineIndex ?? session.lineIndex, rectangle.type)?.[rectangle.index];
          candidates.push({ key: eventKey(rectangle.type, rectangle.index), group: rectangle.type, start: beatValue(event?.startTime) });
        }
        extendIntervalSelection(this.drag, candidates, session.eventSelection, this.timeline.selectionInterval);
      }
    }
    this.updateCursor(point);
    this.timeline.changed();
  }

  up(event) {
    if (this.timeline.endRectanglePan(event)) return;
    if (!this.drag) return;
    if (this.drag.endpoint) {
      this.move(event); const drag = this.drag, session = this.timeline.getSession(), next = this.previewEvent(drag.event); this.drag = null;
      this.canvas.releasePointerCapture?.(event.pointerId);
      const selected = selectedEventEntries(session);
      if (session.chart === drag.chart && selected.length === 1 && selected[0].event === drag.event && (beatValue(next.startTime) !== beatValue(drag.event.startTime) || beatValue(next.endTime) !== beatValue(drag.event.endTime))) {
        try { transformEvents(session, t('event-interaction.s18a93d4'), current => current === drag.event ? next : current, { xyTiming: Boolean(drag.xySnapshot) }); } catch (error) { this.reportError(error); }
      }
      this.updateCursor(); this.timeline.changed(); return;
    }
    if (this.drag.kind === 'stroke') this.move(event);
    if (this.drag.kind === 'multi-pan') { this.drag = null; this.canvas.style.cursor = this.timeline.panEventColumns ? 'grab' : 'default'; this.timeline.changed(); return; }
    if (this.drag.kind === 'stroke' && !this.drag.remove && !this.drag.tracing && this.timeline.previewPick?.(event)) { this.drag = null; this.timeline.changed(); return; }
    this.drag.current = this.timeline.point(event, this.canvas);
    this.drag.currentWorldX = this.drag.current.x + this.timeline.multiLineViewportOffset(this.canvas.clientWidth, 'events');
    if (this.drag.startFactor !== undefined) this.drag.currentSeconds = this.timeline.tempo.seconds(this.timeline.origin, this.drag.startFactor) + (this.timeline.viewHeight() - (this.timeline.judgementOffset ?? 42) - this.drag.current.y) / this.timeline.scale;
    if (this.drag.kind === 'stroke' && this.drag.remove && !this.drag.tracing) {
      this.drag = { ...this.drag, kind: 'rectangle', area: 'events', startSeconds: this.timeline.timeAt(this.drag.start.y), append: true, remove: false }; this.timeline.changed(); return;
    }
    if (this.drag.kind === 'rectangle' && !this.drag.finished) { this.timeline.changed(); return; }
    const drag = this.drag; const delta = this.delta(); this.drag = null;
    const session = this.timeline.getSession();
    try {
      if (drag.kind === 'rectangle') {
        if (!drag.append) session.eventSelection.clear();
        const [bottom, top] = this.timeline.rectangleTimes(drag);
        const left = Math.min(drag.startWorldX ?? drag.start.x, drag.currentWorldX ?? drag.current.x); const right = Math.max(drag.startWorldX ?? drag.start.x, drag.currentWorldX ?? drag.current.x);
        if (session.multiLineActive && session.multiLineMode === 'events') {
          // Query chart intervals, so horizontal/vertical panning during a marquee retains offscreen objects.
          const panelWidth = this.timeline.panelWidth(this.canvas.clientWidth, 'events');
          const stride = this.timeline.panelStride(this.canvas.clientWidth, 'events');
          for (const lineIndex of session.targetLineIndices) {
            const offset = this.timeline.panelIndex(lineIndex, 'events') * stride;
            const selected = lineIndex === session.lineIndex ? session.eventSelection : (session.multiEventSelection?.get(lineIndex) ?? new Set());
            this.timeline.eventTypes.forEach((type, channel) => {
              const bounds = this.timeline.eventColumnBounds(channel, panelWidth);
              if (offset + bounds.x >= right || offset + bounds.x + bounds.width <= left) return;
              const display = eventDisplayIndex(this.timeline, eventListAt(session, lineIndex, type), session.chart);
              const candidates = display.index.query(bottom, top).map(entry => ({ key: eventKey(type, entry.index), start: beatValue(entry.item.startTime), selected: drag.remove ? !selected.has(eventKey(type, entry.index)) : selected.has(eventKey(type, entry.index)) }));
              for (const entry of intervalSelection(candidates, this.timeline.selectionInterval)) drag.remove ? selected.delete(entry.key) : selected.add(entry.key);
            });
            if (lineIndex === session.lineIndex) session.eventSelection = selected;
            if (session.multiEventSelection) session.multiEventSelection.set(lineIndex, selected);
          }
          session.notify(); this.timeline.changed(); return;
        }
        this.timeline.eventTypes.forEach((type, channel) => {
          const bounds = this.timeline.eventColumnBounds(channel, this.canvas.clientWidth);
          if (bounds.x >= right || bounds.x + bounds.width <= left) return;
          const items = eventList(session, type); const lanes = type === 'paintEvents' ? shaderEventLanes(items) : null;
          const candidates = [];
          items.forEach((item, index) => {
            if (beatValue(item.startTime) > top || beatValue(item.endTime) < bottom) return;
            if (lanes) {
              const lane = lanes.get(index); const width = bounds.width / lane.count;
              const horizontal = bounds.x + lane.lane * width;
              if (horizontal >= right || horizontal + Math.max(2, width - (lane.count > 1 ? 2 : 0)) <= left) return;
            }
            const key = eventKey(type, index); candidates.push({ key, start: beatValue(item.startTime), selected: drag.remove ? !session.eventSelection.has(key) : session.eventSelection.has(key) });
          });
          for (const entry of intervalSelection(candidates, this.timeline.selectionInterval)) drag.remove ? session.eventSelection.delete(entry.key) : session.eventSelection.add(entry.key);
        });
        session.notify();
      } else if (drag.kind === 'stroke') {
        session.notify();
      } else if (delta && Math.abs(drag.current.y - drag.start.y) > 5 && (session.multiLineActive && session.multiLineMode === 'events' ? [...session.multiEventSelection.values()].some(values => values.size) : selectedEvents(session).length)) {
        const change = current => ({ ...current,
          startTime: drag.kind === 'endTime' ? current.startTime : fromNumber(beatValue(current.startTime) + delta),
          endTime: drag.kind === 'startTime' ? current.endTime : fromNumber(beatValue(current.endTime) + delta) });
        if (drag.xySnapshot || session.multiLineActive && session.multiLineMode === 'events') {
          if (drag.xySnapshot && (session.chart !== drag.xySnapshot.chart || session.eventLayer !== drag.xySnapshot.eventLayer)) return;
          const result = editCapturedSelection(drag.xySnapshot ?? captureSelection(session), { event: change });
          if (drag.xySnapshot) { result.eventSelection = new Set(drag.xySelected.get(session.lineIndex) ?? []); result.multiEventSelection = drag.xySelected; }
          commitSelectionEdit(session, result, drag.kind === 'move' ? t('event-interaction.s9728d19') : t('event-interaction.s8c3d905'));
        } else transformEvents(session, drag.kind === 'move' ? t('event-interaction.s9728d19') : t('event-interaction.s8c3d905'), change);
      }
    } catch (error) { this.reportError(error); }
    if (drag.kind === 'stroke' && drag.tracing || drag.selecting && !drag.scrolled && Math.hypot(drag.current.x - drag.start.x, drag.current.y - drag.start.y) <= 4) this.timeline.completeSelection('events', event);
    this.timeline.changed();
  }

  draw(context, width) {
    if (!this.pending) return;
    const session = this.timeline.getSession();
    const channel = this.timeline.eventTypes.indexOf(this.pending.type);
    if (channel < 0) return;
    const end = this.timeline.eventCursor ? this.timeline.eventBeatAt(this.timeline.eventCursor.y, this.pending.type, true) : this.pending.beat;
    let valid = true;
    try { this.createEvent(this.timeline.getSession(), this.pending.type, this.pending.beat, end, undefined, this.pending.lineIndex, this.pending.inst, true); } catch { valid = false; }
    const lineIndex = this.timeline.lineIndexAt(this.timeline.eventCursor?.x ?? 0, width, 'events');
    const vertical = session.multiLineActive && session.multiLineMode === 'events' ? beat => this.timeline.verticalForLine(beat, lineIndex, this.canvas.clientHeight) : beat => this.timeline.eventVertical(beat, this.pending.type);
    const top = Math.min(vertical(this.pending.beat), vertical(end));
    const height = Math.max(2, Math.abs(vertical(this.pending.beat) - vertical(end)));
    const panelWidth = this.timeline.panelWidth(width, 'events');
    const panelOffset = this.timeline.panelIndex(lineIndex, 'events') * this.timeline.panelStride(width, 'events') - this.timeline.multiLineViewportOffset(width, 'events');
    const { x: localBarX, width: barWidth } = this.timeline.eventColumnBounds(channel, panelWidth);
    const barX = panelOffset + localBarX;
    context.fillStyle = valid ? '#ffd76a60' : '#ff404080'; context.strokeStyle = valid ? '#ffe499' : '#ff8080';
    context.fillRect(barX, top, barWidth, height);
    context.strokeRect(barX, top, barWidth, height);
  }
}
