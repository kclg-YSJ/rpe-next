import { beatValue, fromNumber } from '../core/beat.mjs';
import { eventKey, eventList, eventListAt, selectedEvents, transformEvents, placedEvent, insertEventAt } from '../application/event-commands.mjs';
import { strokeIntersects } from '../core/editor-display.mjs';
import { shaderEventLanes } from '../core/shader-events.mjs';
import { captureSelection, editCapturedSelection, commitSelectionEdit } from '../application/batch-edit.mjs';

export class EventInteraction {
  constructor(timeline, reportError) {
    this.timeline = timeline; this.canvas = timeline.eventsCanvas; this.reportError = reportError; this.drag = null; this.pending = null;
    this.canvas.addEventListener('pointerdown', event => this.down(event));
    this.canvas.addEventListener('pointermove', event => this.move(event));
    this.canvas.addEventListener('pointerup', event => this.up(event));
    this.canvas.addEventListener('pointercancel', () => { const tracing = this.drag?.kind === 'stroke' && this.drag.tracing; this.drag = null; if (tracing) timeline.getSession().notify(); timeline.changed(); });
    this.canvas.addEventListener('pointerleave', () => { if (!this.drag) this.timeline.eventCursor = null; });
  }

  hit(point) { return this.timeline.eventRects.findLast(rectangle => point.x >= rectangle.x && point.x <= rectangle.x + rectangle.width && point.y >= rectangle.y && point.y <= rectangle.y + rectangle.height); }
  delta() {
    if (!this.drag?.anchor) return 0;
    const start = this.drag.anchor;
    const factor = this.timeline.factorForLine(this.drag.lineIndex ?? this.timeline.getSession().lineIndex);
    const scroll = this.timeline.tempo.seconds(this.timeline.origin, factor) - (this.drag.originSeconds ?? this.timeline.tempo.seconds(this.timeline.origin, factor));
    const targetSeconds = this.timeline.tempo.seconds(start, factor) + (this.drag.start.y - this.drag.current.y) / this.timeline.scale + scroll;
    const target = this.timeline.tempo.beat(targetSeconds, factor);
    return Math.round(target * this.timeline.division) / this.timeline.division - beatValue(start);
  }

  place(type, beat, easingType, inst = false) {
    const session = this.timeline.getSession();
    if (!session.line) return false;
    const point = this.timeline.eventCursor;
    if (beat === undefined && !point) return false;
    const lineIndex = this.timeline.lineIndexAt(point?.x ?? 0, this.canvas.clientWidth, 'events');
    const panelWidth = this.timeline.panelWidth(this.canvas.clientWidth, 'events'); const panelOffset = this.timeline.panelIndex(lineIndex, 'events') * this.timeline.panelStride(this.canvas.clientWidth, 'events') - this.timeline.multiLineViewportOffset(this.canvas.clientWidth, 'events');
    const channel = Math.max(0, Math.min(this.timeline.eventTypes.length - 1, Math.floor(((point?.x ?? 0) - panelOffset) / (panelWidth / this.timeline.eventTypes.length))));
    const eventType = this.pending?.type ?? type ?? this.timeline.eventTypes[channel];
    const at = beat ?? this.timeline.eventBeatAt(point.y, eventType, true);
    session.focus = 'events'; session.eventLayer = this.timeline.layer; session.selection.clear();
    if (!this.pending) {
      this.pending = { type: eventType, beat: at, lineIndex, inst };
      session.notify();
    } else {
      let event;
      try { event = placedEvent(session, this.pending.type, this.pending.beat, at, easingType, this.pending.lineIndex, this.pending.inst); }
      catch (error) { this.timeline.notify?.(error.message, 'error'); return false; }
      if (event) insertEventAt(session, this.pending.lineIndex ?? lineIndex, this.pending.type, event);
      this.pending = null;
    }
    this.timeline.changed(); return true;
  }

  down(event) {
    if (![0, 1, 2].includes(event.button)) return;
    event.preventDefault?.();
    if (event.button === 2) return;
    if (this.timeline.finishRectangle(event)) return;
    const session = this.timeline.getSession(); const point = this.timeline.point(event, this.canvas); const rectangle = this.hit(point);
    if (event.ctrlKey || event.shiftKey || event.button === 1) session.multiSelectionIntent = 'events';
    else session.multiSelectionIntent = null;
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
    session.focus = 'events'; session.eventLayer = this.timeline.layer;
    if (!event.ctrlKey && !event.shiftKey && event.button !== 1) { session.selection.clear(); if (!rectangle) session.eventSelection.clear(); }
    this.canvas.focus(); this.canvas.setPointerCapture(event.pointerId);
    const multiMode = session.multiLineActive;
    const multiPanel = multiMode && this.timeline.panelCount('events') > 1;
    if (multiPanel && (event.shiftKey || event.button === 1)) {
      const worldX = point.x + this.timeline.multiLineViewportOffset(this.canvas.clientWidth, 'events');
      this.drag = { kind: 'rectangle', area: 'events', start: point, startWorldX: worldX, current: point, currentWorldX: worldX, startFactor: this.timeline.factorForLine(panelLineIndex), startSeconds: this.timeline.timeAt(point.y), append: true, remove: false };
    } else if (multiPanel && (!rectangle && !this.timeline.tool)) this.drag = { kind: 'multi-pan', start: point, current: point };
    else if (!multiMode && (event.shiftKey || event.button === 1)) this.drag = { kind: 'rectangle', area: 'events', start: point, startFactor: this.timeline.factorForLine(session.lineIndex), startSeconds: this.timeline.timeAt(point.y), current: point, append: true, remove: false };
    else if (rectangle && event.button === 0) {
      const key = eventKey(rectangle.type, rectangle.index);
      let selectedSet = session.eventSelection;
      if (session.multiLineActive && session.multiLineMode === 'events' && session.multiEventSelection) {
        const selected = new Set(session.multiEventSelection.get(rectangle.lineIndex) ?? []);
        if (event.ctrlKey) { if (selected.has(key)) selected.delete(key); else selected.add(key); }
        else if (!selected.has(key)) { selected.clear(); selected.add(key); }
        session.multiEventSelection.set(rectangle.lineIndex, selected);
        selectedSet = selected;
        if (rectangle.lineIndex === session.lineIndex) session.eventSelection = new Set(selected);
      } else {
        if (event.ctrlKey) { if (session.eventSelection.has(key)) session.eventSelection.delete(key); else session.eventSelection.add(key); }
        else if (!session.eventSelection.has(key)) session.eventSelection = new Set([key]);
      }
      const kind = Math.abs(point.y - rectangle.y) < 6 ? 'endTime' : Math.abs(point.y - (rectangle.y + rectangle.height)) < 6 ? 'startTime' : 'move';
      const selected = eventListAt(session, rectangle.lineIndex ?? session.lineIndex, rectangle.type)?.[rectangle.index];
      this.drag = { kind, type: rectangle.type, lineIndex: rectangle.lineIndex, start: point, current: point, anchor: selected?.[kind === 'endTime' ? 'endTime' : 'startTime'], originSeconds: this.timeline.tempo.seconds(this.timeline.origin, this.timeline.factorForLine(rectangle.lineIndex ?? session.lineIndex)) };
    } else if (!multiMode) this.drag = { kind: 'stroke', start: point, current: point, points: [point], remove: event.button === 2 };
    session.notify();
  }

  move(event) {
    const point = this.timeline.point(event, this.canvas);
    this.timeline.eventCursor = point;
    this.timeline.clipboardPointer = point;
    this.timeline.hoverArea = 'events';
    if (this.drag) {
      const previous = this.drag.current; this.drag.current = point; this.drag.currentWorldX = point.x + this.timeline.multiLineViewportOffset(this.canvas.clientWidth, 'events');
      if (this.drag.startFactor !== undefined) this.drag.currentSeconds = this.timeline.tempo.seconds(this.timeline.origin, this.drag.startFactor) + (this.timeline.viewHeight() - (this.timeline.judgementOffset ?? 42) - this.drag.current.y) / this.timeline.scale;
      if (this.drag.kind === 'multi-pan') {
        const current = this.timeline.multiLineViewportOffset(this.canvas.clientWidth, 'events');
        this.timeline.multiLineScroll.events = Math.max(0, current - (point.x - previous.x));
        this.timeline.changed();
        return;
      }
      if (this.drag.kind === 'stroke' && (this.drag.tracing || Math.hypot(point.x - this.drag.start.x, point.y - this.drag.start.y) > 3)) {
        this.drag.tracing = true;
        this.drag.points.push(point); const session = this.timeline.getSession();
        session.multiSelectionIntent = 'events';
        for (const rectangle of this.timeline.eventRects) if ((rectangle.lineIndex === undefined || rectangle.lineIndex === session.lineIndex) && strokeIntersects(previous, point, { left: rectangle.x, right: rectangle.x + rectangle.width, top: rectangle.y, bottom: rectangle.y + rectangle.height })) {
          const key = eventKey(rectangle.type, rectangle.index); this.drag.remove ? session.eventSelection.delete(key) : session.eventSelection.add(key);
        }
      }
    }
    const hit = this.hit(point);
    this.canvas.style.cursor = hit && (Math.abs(point.y - hit.y) < 6 || Math.abs(point.y - hit.y - hit.height) < 6) ? 'ns-resize' : hit ? 'move' : 'default';
    this.timeline.changed();
  }

  up(event) {
    if (!this.drag) return;
    if (this.drag.kind === 'stroke') this.move(event);
    if (this.drag.kind === 'multi-pan') { this.drag = null; this.timeline.changed(); return; }
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
          for (const rectangle of this.timeline.eventRects) {
            const scroll = this.timeline.multiLineViewportOffset(this.canvas.clientWidth, 'events');
            if (rectangle.x + scroll >= right || rectangle.x + rectangle.width + scroll <= left) continue;
            const item = eventListAt(session, rectangle.lineIndex, rectangle.type)[rectangle.index];
            const selected = rectangle.lineIndex === session.lineIndex ? session.eventSelection : (session.multiEventSelection?.get(rectangle.lineIndex) ?? new Set());
            if (!item || beatValue(item.startTime) > top || beatValue(item.endTime) < bottom) continue;
            const key = eventKey(rectangle.type, rectangle.index); drag.remove ? selected.delete(key) : selected.add(key);
            if (rectangle.lineIndex === session.lineIndex) session.eventSelection = selected;
            if (session.multiEventSelection) session.multiEventSelection.set(rectangle.lineIndex, selected);
          }
          session.notify(); this.timeline.changed(); return;
        }
        this.timeline.eventTypes.forEach((type, channel) => {
          const bounds = this.timeline.eventColumnBounds(channel, this.canvas.clientWidth);
          if (bounds.x >= right || bounds.x + bounds.width <= left) return;
          const items = eventList(session, type); const lanes = type === 'paintEvents' ? shaderEventLanes(items) : null;
          items.forEach((item, index) => {
            if (beatValue(item.startTime) > top || beatValue(item.endTime) < bottom) return;
            if (lanes) {
              const lane = lanes.get(index); const width = bounds.width / lane.count;
              const horizontal = bounds.x + lane.lane * width;
              if (horizontal >= right || horizontal + Math.max(2, width - (lane.count > 1 ? 2 : 0)) <= left) return;
            }
            const key = eventKey(type, index); drag.remove ? session.eventSelection.delete(key) : session.eventSelection.add(key);
          });
        });
        session.notify();
      } else if (drag.kind === 'stroke') {
        session.notify();
      } else if (delta && Math.abs(drag.current.y - drag.start.y) > 5 && (session.multiLineActive && session.multiLineMode === 'events' ? [...session.multiEventSelection.values()].some(values => values.size) : selectedEvents(session).length)) {
        const change = current => ({ ...current,
          startTime: drag.kind === 'endTime' ? current.startTime : fromNumber(beatValue(current.startTime) + delta),
          endTime: drag.kind === 'startTime' ? current.endTime : fromNumber(beatValue(current.endTime) + delta) });
        if (session.multiLineActive && session.multiLineMode === 'events') {
          const result = editCapturedSelection(captureSelection(session), { event: change });
          commitSelectionEdit(session, result, drag.kind === 'move' ? '移动事件' : '调整事件时长');
        } else transformEvents(session, drag.kind === 'move' ? '移动事件' : '调整事件时长', change);
      }
    } catch (error) { this.reportError(error); }
    this.timeline.changed();
  }

  draw(context, width) {
    if (!this.pending) return;
    const session = this.timeline.getSession();
    const channel = this.timeline.eventTypes.indexOf(this.pending.type);
    if (channel < 0) return;
    const end = this.timeline.eventCursor ? this.timeline.eventBeatAt(this.timeline.eventCursor.y, this.pending.type, true) : this.pending.beat;
    let valid = true;
    try { placedEvent(this.timeline.getSession(), this.pending.type, this.pending.beat, end, undefined, this.pending.lineIndex); } catch { valid = false; }
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
