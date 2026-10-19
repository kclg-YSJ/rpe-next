import { beatValue, fromNumber } from '../core/beat.ts';
import { eventKey, eventList, eventListAt, selectedEvents, selectEvent, transformEvents, placedEvent, insertEventAt } from '../application/event-commands.ts';
import { strokeIntersects } from '../core/editor-display.ts';
import { shaderEventLanes } from '../core/shader-events.ts';
import { captureSelection, editCapturedSelection, commitSelectionEdit } from '../application/batch-edit.ts';
import { eventDisplayIndex } from './event-display-index.ts';
import type { AnyEventType, Beat, Chart, ChartEvent } from '../core/types.ts';
import type { EventEditSession, EventListSource } from '../application/event-commands.ts';
import type { BatchEditSession } from '../application/batch-edit.ts';
import type { TempoMap } from '../core/tempo.ts';
import type { TimelineSession, CanvasPoint, RectangleDrag } from './timeline.ts';

/**
 * The editing session the event commands read.
 *
 * `EditorSession` satisfies these interfaces; the intersection names the members the handlers below
 * reach for, so the command helpers can be called without a cast at every site.
 */
type EventSession = TimelineSession & EventListSource & EventEditSession & BatchEditSession & {
  /** Set by the pointer gesture, not part of the command interfaces. */
  multiSelectionIntent: 'notes' | 'events' | null;
  /** Event edits report their failures through the session, like the timeline does. */
  notify(): void;
};

/** A beat or a plain beat number; both are accepted by the timeline's vertical helpers. */
type BeatLike = number | Beat;

/** One pointer event on the event grid; only the members read below are declared. */
export interface PointerLike {
  button: number;
  pointerId: number;
  ctrlKey: boolean;
  shiftKey: boolean;
  clientX: number;
  clientY: number;
  preventDefault?: () => void;
}

/** One drawn event rectangle, as pushed by `Timeline` into its `eventRects` list. */
interface EventRectangle {
  type: AnyEventType;
  index: number;
  lineIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A half-finished event placement (the first click of a two-click placement). */
interface PendingEvent {
  type: AnyEventType;
  beat: number;
  lineIndex: number;
  inst: boolean;
}

/** Which end of an event a drag moves, or the whole event. */
type EventDragKind = 'move' | 'startTime' | 'endTime';

/**
 * One in-flight gesture on the event grid.
 *
 * Every member is optional beyond the two points, because the handlers below test `kind` before
 * reaching for the members only one gesture produces; `Timeline` reads the same object back through
 * its own structural `RectangleDrag` / `TimelineDrag` shapes, and both of those accept the object
 * this module builds.
 */
interface EventDrag {
  kind: string;
  start: CanvasPoint;
  current: CanvasPoint;
  /** Which line the drag started on. */
  lineIndex?: number;
  /** The event beat an event-move drag anchors to. */
  anchor?: BeatLike;
  originSeconds?: number;
  finished?: boolean;
  area?: 'notes' | 'events';
  startWorldX?: number;
  currentWorldX?: number;
  startSeconds?: number;
  currentSeconds?: number;
  startFactor?: number;
  append?: boolean;
  remove?: boolean;
  tracing?: boolean;
  points?: CanvasPoint[];
  type?: AnyEventType;
  /** Client X of the previous multi-pan move, so column panning can use the raw delta. */
  clientX?: number;
}

/**
 * The timeline surface this module drives.
 *
 * `Timeline` is being annotated in parallel; the members below are the ones `EventInteraction`
 * reads, and the optional ones are assigned by `app.ts` after construction. `tempo` is reused from
 * the timeline rather than redeclared so the two stay in step.
 */
interface EventTimeline {
  eventDisplayChart?: Chart;
  createPlacedEvent?: (...args: Parameters<typeof placedEvent>) => ReturnType<typeof placedEvent>;
  eventChannelAt?: (horizontal: number) => number;
  panEventColumns?: (deltaX: number) => void;
  eventsCanvas: HTMLCanvasElement;
  tempo: TempoMap;
  origin: number;
  scale: number;
  division: number;
  tool: number;
  layer: number;
  eventTypes: readonly AnyEventType[];
  eventRects: EventRectangle[];
  eventCursor: CanvasPoint | null;
  hoverArea?: string;
  clipboardPointer?: unknown;
  multiLineScroll: number | { notes: number; events: number };
  notify?: (message: string, severity?: string) => void;
  previewPick?: (event: unknown) => boolean;
  getSession(): TimelineSession;
  changed(): void;
  point(event: PointerLike, canvas?: HTMLCanvasElement): CanvasPoint;
  timeAt(vertical: number): number;
  viewHeight(): number;
  /**
   * Pixels between the pane's bottom and the judgement line, read as `?? 42` because a timeline that
   * has not been configured yet leaves it unset; 42 was the hard-coded value this replaced.
   */
  judgementOffset?: number;
  factorForLine(lineIndex: number): number;
  verticalForLine(beat: BeatLike, lineIndex: number, height?: number): number;
  eventVertical(beat: BeatLike, type: AnyEventType): number;
  eventBeatAt(vertical: number, type: AnyEventType, snap?: boolean): number;
  lineIndexAt(horizontal: number, width: number, area?: string): number;
  panelCount(area?: string): number;
  panelIndex(lineIndex: number, area?: string): number;
  panelWidth(width: number, area?: string): number;
  panelStride(width: number, area?: string): number;
  multiLineViewportOffset(width: number, area?: string): number;
  eventColumnBounds(channel: number, width: number): { channelWidth: number; x: number; width: number };
  finishRectangle(event: PointerLike): boolean;
  rectangleTimes(drag: RectangleDrag): [number, number];
}

export class EventInteraction {
  eventDisplayChart?: Chart;
  // Every field is declared explicitly: an unannotated field would be inferred too narrowly (a
  // `null` literal, or a union without the members written further down), which cascades into the
  // timeline and app.
  timeline: EventTimeline;
  canvas: HTMLCanvasElement;
  reportError: (error: unknown) => void;
  drag: EventDrag | null;
  pending: PendingEvent | null;

  constructor(timeline: EventTimeline, reportError: (error: unknown) => void) {
    this.timeline = timeline; this.canvas = timeline.eventsCanvas; this.reportError = reportError; this.drag = null; this.pending = null;
    this.canvas.addEventListener('pointerdown', event => this.down(event));
    this.canvas.addEventListener('pointermove', event => this.move(event));
    this.canvas.addEventListener('pointerup', event => this.up(event));
    this.canvas.addEventListener('pointercancel', () => { const tracing = this.drag?.kind === 'stroke' && this.drag.tracing; this.drag = null; if (tracing) timeline.getSession().notify(); timeline.changed(); });
    this.canvas.addEventListener('pointerleave', () => { if (!this.drag) this.timeline.eventCursor = null; });
  }

  hit(point: CanvasPoint): EventRectangle | undefined {
    // `findLast` is an ES2023 addition while `tsconfig.json` pins `lib` to ES2022 (the runtime is
    // ES2023, the same reason `batch-edit.ts` declares `toSorted`). Walking backwards by hand keeps
    // the behaviour — the last matching rectangle wins — without widening `lib`.
    for (let index = this.timeline.eventRects.length - 1; index >= 0; index--) {
      const rectangle = this.timeline.eventRects[index];
      if (point.x >= rectangle.x && point.x <= rectangle.x + rectangle.width && point.y >= rectangle.y && point.y <= rectangle.y + rectangle.height) return rectangle;
    }
    return undefined;
  }

  delta(): number {
    const anchor = this.drag?.anchor;
    if (!anchor) return 0;
    const drag = this.drag!; const start: BeatLike = anchor;
    const factor = this.timeline.factorForLine(drag.lineIndex ?? this.timeline.getSession().lineIndex);
    const scroll = this.timeline.tempo.seconds(this.timeline.origin, factor) - (drag.originSeconds ?? this.timeline.tempo.seconds(this.timeline.origin, factor));
    const targetSeconds = this.timeline.tempo.seconds(start, factor) + (drag.start.y - drag.current.y) / this.timeline.scale + scroll;
    const target = this.timeline.tempo.beat(targetSeconds, factor);
    return Math.round(target * this.timeline.division) / this.timeline.division - beatValue(start);
  }

  createEvent(...args: Parameters<typeof placedEvent>): ReturnType<typeof placedEvent> { return this.timeline.createPlacedEvent ? this.timeline.createPlacedEvent(...args) : placedEvent(...args); }

  place(type: AnyEventType | null = null, beat?: number, easingType?: number | null, inst = false): boolean {
    const session = this.timeline.getSession() as EventSession;
    if (!session.line) return false;
    const point = this.timeline.eventCursor;
    if (beat === undefined && !point) return false;
    const lineIndex = this.timeline.lineIndexAt(point?.x ?? 0, this.canvas.clientWidth, 'events');
    const panelWidth = this.timeline.panelWidth(this.canvas.clientWidth, 'events'); const panelOffset = this.timeline.panelIndex(lineIndex, 'events') * this.timeline.panelStride(this.canvas.clientWidth, 'events') - this.timeline.multiLineViewportOffset(this.canvas.clientWidth, 'events');
    const channel = this.timeline.eventChannelAt ? this.timeline.eventChannelAt((point?.x ?? 0) - panelOffset) : Math.max(0, Math.min(this.timeline.eventTypes.length - 1, Math.floor(((point?.x ?? 0) - panelOffset) / (panelWidth / this.timeline.eventTypes.length))));
    if (channel < 0 && !this.pending && !type) return false;
    const eventType: AnyEventType = this.pending?.type ?? type ?? this.timeline.eventTypes[channel];
    const at = beat ?? this.timeline.eventBeatAt(point!.y, eventType, true);
    session.focus = 'events'; session.eventLayer = this.timeline.layer; session.selection.clear();
    if (!this.pending) {
      this.pending = { type: eventType, beat: at, lineIndex, inst };
      session.notify();
    } else {
      const pending = this.pending;
      let event: ChartEvent | null;
      // `placedEvent` throws the validation errors this handler reports; `error` is `unknown` under
      // `strict`, so the message is read through a local narrowing rather than asserted.
      try { event = this.createEvent(session, pending.type, pending.beat, at, easingType, pending.lineIndex, pending.inst); }
      catch (error) { this.timeline.notify?.(errorMessage(error), 'error'); return false; }
      if (event) insertEventAt(session, pending.lineIndex ?? lineIndex, pending.type, event);
      this.pending = null;
    }
    this.timeline.changed(); return true;
  }

  down(event: PointerLike): void {
    if (![0, 1, 2].includes(event.button)) return;
    event.preventDefault?.();
    if (event.button === 2) return;
    if (this.timeline.finishRectangle(event)) return;
    const session = this.timeline.getSession() as EventSession; const point = this.timeline.point(event, this.canvas); const rectangle = this.hit(point);
    if (event.ctrlKey || event.shiftKey || event.button === 1) session.multiSelectionIntent = 'events';
    else session.multiSelectionIntent = null;
    this.timeline.eventCursor = point; this.timeline.hoverArea = 'events';
    this.timeline.clipboardPointer = point;
    const panelLineIndex = session.multiLineActive && session.multiLineMode === 'events'
      ? this.timeline.lineIndexAt(point.x, this.canvas.clientWidth, 'events')
      : session.lineIndex;
    if (event.button === 0 && this.timeline.tool && !rectangle && !event.shiftKey && !event.ctrlKey) {
      try { this.place(null); } catch (error) { this.timeline.notify?.(errorMessage(error), 'error'); }
      return;
    }
    if (this.pending) {
      try { this.place(); } catch (error) { this.timeline.notify?.(errorMessage(error), 'error'); }
      return;
    }
    session.focus = 'events'; session.eventLayer = this.timeline.layer;
    if (!event.ctrlKey && !event.shiftKey && event.button !== 1) { session.selection.clear(); if (!rectangle) session.eventSelection.clear(); }
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
      // Selection across multiple lines is owned by `event-commands`, so the single-line and
      // multi-line cases cannot drift apart.
      selectEvent(session, rectangle.lineIndex ?? session.lineIndex, rectangle.type, rectangle.index, { toggle: event.ctrlKey });
      const kind: EventDragKind = Math.abs(point.y - rectangle.y) < 6 ? 'endTime' : Math.abs(point.y - (rectangle.y + rectangle.height)) < 6 ? 'startTime' : 'move';
      const selected = eventListAt(session, rectangle.lineIndex ?? session.lineIndex, rectangle.type)?.[rectangle.index];
      const anchor = selected?.[kind === 'endTime' ? 'endTime' : 'startTime'];
      this.drag = { kind, type: rectangle.type, lineIndex: rectangle.lineIndex, start: point, current: point, anchor: typeof anchor === 'number' || Array.isArray(anchor) ? anchor : undefined, originSeconds: this.timeline.tempo.seconds(this.timeline.origin, this.timeline.factorForLine(rectangle.lineIndex ?? session.lineIndex)) };
    } else if (!multiMode) this.drag = { kind: 'stroke', start: point, current: point, points: [point], remove: event.button === 2 };
    session.notify();
  }

  move(event: PointerLike): void {
    const point = this.timeline.point(event, this.canvas);
    this.timeline.eventCursor = point;
    this.timeline.clipboardPointer = point;
    this.timeline.hoverArea = 'events';
    if (this.drag) {
      const drag = this.drag; const previous = drag.current; drag.current = point; drag.currentWorldX = point.x + this.timeline.multiLineViewportOffset(this.canvas.clientWidth, 'events');
      if (drag.startFactor !== undefined) drag.currentSeconds = this.timeline.tempo.seconds(this.timeline.origin, drag.startFactor) + (this.timeline.viewHeight() - (this.timeline.judgementOffset ?? 42) - drag.current.y) / this.timeline.scale;
      if (drag.kind === 'multi-pan') {
        if (this.timeline.panEventColumns) {
          this.timeline.panEventColumns(event.clientX - (drag.clientX ?? event.clientX)); drag.clientX = event.clientX;
          const next = this.timeline.point(event, this.canvas); drag.current = next;
          this.timeline.eventCursor = next; this.timeline.clipboardPointer = next;
          this.canvas.style.cursor = 'grabbing'; this.timeline.changed(); return;
        }
        const current = this.timeline.multiLineViewportOffset(this.canvas.clientWidth, 'events');
        // `multiLineScroll` holds one shared offset or one per area (`notes` / `events`); both forms
        // carry the `events` key this branch writes.
        const scroll = this.timeline.multiLineScroll;
        if (typeof scroll !== 'number') scroll.events = Math.max(0, current - (point.x - previous.x));
        this.timeline.changed();
        return;
      }
      if (drag.kind === 'stroke' && (drag.tracing || Math.hypot(point.x - drag.start.x, point.y - drag.start.y) > 3)) {
        drag.tracing = true;
        const traced: CanvasPoint[] = drag.points ?? []; drag.points = traced; traced.push(point);
        const session = this.timeline.getSession() as EventSession;
        session.multiSelectionIntent = 'events';
        // A rectangle without a `lineIndex` belongs to no single line, so it stays eligible in every
        // panel; only a rectangle that names another line is skipped.
        for (const rectangle of this.timeline.eventRects) if ((rectangle.lineIndex === undefined || rectangle.lineIndex === session.lineIndex) && strokeIntersects(previous, point, { left: rectangle.x, right: rectangle.x + rectangle.width, top: rectangle.y, bottom: rectangle.y + rectangle.height })) {
          const key = eventKey(rectangle.type, rectangle.index); drag.remove ? session.eventSelection.delete(key) : session.eventSelection.add(key);
        }
      }
    }
    const hit = this.hit(point);
    this.canvas.style.cursor = hit && (Math.abs(point.y - hit.y) < 6 || Math.abs(point.y - hit.y - hit.height) < 6) ? 'ns-resize' : hit ? 'move' : this.timeline.panEventColumns ? 'grab' : 'default';
    this.timeline.changed();
  }

  up(event: PointerLike): void {
    if (!this.drag) return;
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
    const session = this.timeline.getSession() as EventSession;
    try {
      if (drag.kind === 'rectangle') {
        if (!drag.append) session.eventSelection.clear();
        const startX = drag.startWorldX ?? drag.start.x; const currentX = drag.currentWorldX ?? drag.current.x;
        const left = Math.min(startX, currentX); const right = Math.max(startX, currentX);
        // `rectangleTimes` reads the world-space ends the drag carries; the local drag object is
        // structurally that shape, so it is handed over through the narrower view.
        const [bottom, top] = this.timeline.rectangleTimes(drag as RectangleDrag);
        if (session.multiLineActive && session.multiLineMode === 'events') {
          // Query chart intervals, so horizontal/vertical panning during a marquee retains offscreen objects.
          const panelWidth = this.timeline.panelWidth(this.canvas.clientWidth, 'events');
          const stride = this.timeline.panelStride(this.canvas.clientWidth, 'events');
          for (const lineIndex of session.targetLineIndices) {
            const offset = this.timeline.panelIndex(lineIndex, 'events') * stride;
            const selected: Set<string> = lineIndex === session.lineIndex ? session.eventSelection : (session.multiEventSelection.get(lineIndex) ?? new Set<string>());
            this.timeline.eventTypes.forEach((type, channel) => {
              const bounds = this.timeline.eventColumnBounds(channel, panelWidth);
              if (offset + bounds.x >= right || offset + bounds.x + bounds.width <= left) return;
              const display = eventDisplayIndex(this.timeline, eventListAt(session, lineIndex, type), session.chart);
              for (const entry of display.index.query(bottom, top)) {
                const key = eventKey(type, entry.index); drag.remove ? selected.delete(key) : selected.add(key);
              }
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
          items.forEach((item, index) => {
            if (beatValue(item.startTime) > top || beatValue(item.endTime) < bottom) return;
            if (lanes) {
              // `shaderEventLanes` lays out every entry it was handed, so a placement always exists
              // for an index taken from `items`; the fallback keeps the arithmetic total.
              const lane = lanes.get(index) ?? { lane: 0, count: 1 }; const width = bounds.width / lane.count;
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
        const change = (current: ChartEvent): ChartEvent => ({ ...current,
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

  draw(context: CanvasRenderingContext2D, width: number): void {
    if (!this.pending) return;
    const pending = this.pending;
    const session = this.timeline.getSession() as EventSession;
    const channel = this.timeline.eventTypes.indexOf(pending.type);
    if (channel < 0) return;
    const end: number = this.timeline.eventCursor ? this.timeline.eventBeatAt(this.timeline.eventCursor.y, pending.type, true) : pending.beat;
    let valid = true;
    try { this.createEvent(session, pending.type, pending.beat, end, undefined, pending.lineIndex, pending.inst); } catch { valid = false; }
    const lineIndex = this.timeline.lineIndexAt(this.timeline.eventCursor?.x ?? 0, width, 'events');
    const vertical = session.multiLineActive && session.multiLineMode === 'events' ? (beat: BeatLike) => this.timeline.verticalForLine(beat, lineIndex, this.canvas.clientHeight) : (beat: BeatLike) => this.timeline.eventVertical(beat, pending.type);
    const top = Math.min(vertical(pending.beat), vertical(end));
    const height = Math.max(2, Math.abs(vertical(pending.beat) - vertical(end)));
    const panelWidth = this.timeline.panelWidth(width, 'events');
    const panelOffset = this.timeline.panelIndex(lineIndex, 'events') * this.timeline.panelStride(width, 'events') - this.timeline.multiLineViewportOffset(width, 'events');
    const { x: localBarX, width: barWidth } = this.timeline.eventColumnBounds(channel, panelWidth);
    const barX = panelOffset + localBarX;
    context.fillStyle = valid ? '#ffd76a60' : '#ff404080'; context.strokeStyle = valid ? '#ffe499' : '#ff8080';
    context.fillRect(barX, top, barWidth, height);
    context.strokeRect(barX, top, barWidth, height);
  }
}

/** A caught value's message, matching the `error.message` reads the handlers used before. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
