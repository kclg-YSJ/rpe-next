import { beatValue } from '../core/beat.ts';
import { clipboardStart, projectClipboard } from '../application/clipboard.ts';
import type { ClipboardSession } from '../application/clipboard.ts';
import type { AnyEventType, Beat, ChartEvent, NoteType } from '../core/types.ts';

/** The snapshots the timeline's vertical helpers accept, so they stay `number | Beat`. */
type TimelineBeat = number | Beat;

/** The cursor position in canvas pixels; the same shape the timeline stores for its pointer. */
interface ClipboardPointer {
  x: number;
  y: number;
}

/**
 * One clipboard event paired with its track, used to type the index-pairing loop below.
 *
 * Structurally identical to the `ClipboardEventEntry` `projectClipboard` returns.
 */
interface ProjectedEventEntry {
  type: AnyEventType;
  event: ChartEvent;
}

/**
 * The part of `Timeline` this module draws with.
 *
 * `Timeline` is still untyped, so the members used here are declared structurally instead of
 * reached through the class; the members that are read only by `clipboardBeat` or only by
 * `drawClipboard` are separately optional so either function can be handed a narrower timeline.
 */
interface ClipboardTimeline {
  // Read by both entry points.
  clipboardPointer?: ClipboardPointer | null;
  origin: TimelineBeat;
  snappedBeat(vertical: number): number;

  vertical(beat: TimelineBeat, height?: number): number;

  // Read only by `clipboardBeat`; absent on placeholders that only project a clipboard.
  clipboardMode?: { mirror?: boolean; keepTime?: boolean };
  bulkPreview?: { session?: unknown } | null;
  pendingHold?: unknown;
  eventInteraction: { pending: unknown };
  lineIndexAt?(horizontal: number, width: number, area?: string): number;
  noteHorizontal(positionX: number, lineIndex?: number): number;
  noteWidth(note: { size?: number }): number;
  verticalForLine(beat: TimelineBeat, lineIndex: number, height?: number): number;
  clampNoteHorizontal(horizontal: number, width: number, canvasWidth?: number, lineIndex?: number): number | null;
  eventTypes: readonly AnyEventType[];
  eventVertical(beat: TimelineBeat, type: AnyEventType): number;
  panelWidth(width: number, area?: string): number;
  panelIndex(lineIndex: number, area?: string): number;
  panelStride(width: number, area?: string): number;
  multiLineViewportOffset(width: number, area?: string): number;
  eventColumnBounds(channel: number, width: number): { channelWidth: number; x: number; width: number };
  getSession(): ClipboardSession;
}

/**
 * The 2D context members `drawClipboard` touches.
 *
 * Typed structurally rather than as `CanvasRenderingContext2D` so the same code stays callable with
 * the stub contexts the tests pass in.
 */
interface ClipboardContext {
  globalAlpha: number;
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  save(): void;
  restore(): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
  fillRect(x: number, y: number, width: number, height: number): void;
}

/** The preview tints, keyed by the numeric note type. */
const colors: Record<NoteType, string> = { 1: '#0099ff', 2: '#0099ff', 3: '#ff3333', 4: '#ffff33' };

export function clipboardBeat(timeline: ClipboardTimeline): number {
  return timeline.clipboardPointer ? timeline.snappedBeat(timeline.clipboardPointer.y) : Number(timeline.origin);
}

export function drawClipboard(
  timeline: ClipboardTimeline,
  context: ClipboardContext,
  width: number,
  height: number,
  area: string,
): void {
  const session = timeline.getSession();
  if (session.clipboardVisible === false || timeline.bulkPreview || timeline.pendingHold || timeline.eventInteraction.pending) return;
  const pointer = timeline.clipboardPointer;
  const targetLineIndex = pointer && typeof timeline.lineIndexAt === 'function'
    ? timeline.lineIndexAt(pointer.x, width, area)
    : session.lineIndex;
  const projected = projectClipboard(session, clipboardBeat(timeline), { ...timeline.clipboardMode, targetLineIndex });
  if (!projected.notes.length && !projected.events.length) return;
  context.save();
  context.globalAlpha = 0.175;
  if (area === 'notes') for (const [index, note] of projected.notes.entries()) {
    const lineIndex = projected.noteLines?.[index] ?? session.lineIndex;
    const horizontal = timeline.noteHorizontal(note.positionX, lineIndex); const noteWidth = timeline.noteWidth(note);
    const bottom = timeline.verticalForLine(beatValue(note.startTime), lineIndex, height); const top = timeline.verticalForLine(beatValue(note.endTime), lineIndex, height);
    if (bottom < -10 || top > height + 10 || timeline.clampNoteHorizontal(horizontal, noteWidth, width, lineIndex) === null) continue;
    context.fillStyle = colors[note.type];
    context.fillRect(horizontal - noteWidth / 2, Math.max(-10, note.type === 2 ? top : bottom - 5), noteWidth, note.type === 2 ? Math.min(height + 20, bottom - Math.max(-10, top)) : 10);
  }
  if (area === 'events') for (const [{ type, event }, index] of projected.events.map((entry, index): [ProjectedEventEntry, number] => [entry, index])) {
    const lineIndex = projected.eventLines?.[index] ?? session.lineIndex;
    const channel = timeline.eventTypes.indexOf(type); if (channel < 0) continue;
    const vertical: (beat: TimelineBeat) => number = session.multiLineActive && session.multiLineMode === 'events'
      ? (beat: TimelineBeat) => timeline.verticalForLine(beat, lineIndex, height)
      : (beat: TimelineBeat) => timeline.eventVertical(beat, type);
    const top = Math.max(23, vertical(beatValue(event.endTime)));
    const bottom = Math.min(height, vertical(beatValue(event.startTime)));
    if (bottom < top) continue;
    const panelWidth = timeline.panelWidth(width, 'events');
    const panelOffset = timeline.panelIndex(lineIndex, 'events') * timeline.panelStride(width, 'events') - timeline.multiLineViewportOffset(width, 'events');
    const bounds = timeline.eventColumnBounds(channel, panelWidth);
    context.fillStyle = '#ffa334'; context.fillRect(panelOffset + bounds.x, top, bounds.width, Math.max(2, bottom - top));
  }
  context.globalAlpha = 0.7; context.strokeStyle = '#ff5cab'; context.lineWidth = 1;
  const source = timeline.vertical(clipboardStart(session));
  context.beginPath(); context.moveTo(0, source); context.lineTo(width, source); context.stroke();
  context.restore();
}
