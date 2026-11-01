import { beatValue } from '../core/beat.mjs';
import { clipboardStart, projectClipboard } from '../application/clipboard.mjs';

const colors = { 1: '#0099ff', 2: '#0099ff', 3: '#ff3333', 4: '#ffff33' };

export function clipboardBeat(timeline) {
  return timeline.clipboardPointer ? timeline.snappedBeat(timeline.clipboardPointer.y) : timeline.origin;
}

export function drawClipboard(timeline, context, width, height, area) {
  const session = timeline.getSession();
  if (session.multiLineActive && !session.multiLineIndices.length) return;
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
    const head = timeline.noteVertical(note, 'startTime', lineIndex, height), tail = timeline.noteVertical(note, 'endTime', lineIndex, height);
    const bottom = Math.max(head, tail), top = Math.min(head, tail);
    if (bottom < -10 || top > height + 10 || timeline.clampNoteHorizontal(horizontal, noteWidth, width, lineIndex) === null) continue;
    context.fillStyle = colors[note.type];
    if (timeline.noteView?.flow) { context.save(); timeline.clipNoteSide(context, Number(note.above ?? 1) === 1 ? 1 : -1, width, height); }
    const noteHeight = 10 * timeline.renderNoteScale;
    context.fillRect(horizontal - noteWidth / 2, Math.max(-10, note.type === 2 ? top : head - noteHeight / 2), noteWidth, note.type === 2 ? Math.min(height + 20, bottom - Math.max(-10, top)) : noteHeight);
    if (timeline.noteView?.flow) context.restore();
  }
  if (area === 'events') for (const [{ type, event }, index] of projected.events.map((entry, index) => [entry, index])) {
    const lineIndex = projected.eventLines?.[index] ?? session.lineIndex;
    const channel = timeline.eventTypes.indexOf(type); if (channel < 0) continue;
    const vertical = session.multiLineActive && session.multiLineMode === 'events'
      ? beat => timeline.verticalForLine(beat, lineIndex, height)
      : beat => timeline.eventVertical(beat, type);
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
