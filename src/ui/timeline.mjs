import { beatValue, fromNumber } from '../core/beat.mjs';
import { IntervalIndex } from '../core/interval-index.mjs';
import { createNote, noteIsAbove, EVENT_TYPES, EXTENDED_TYPES } from '../core/chart.mjs';
import { easing, bezier } from '../core/easing.mjs';
import { eventKey, eventList, eventListAt } from '../application/event-commands.mjs';
import { shaderIdentity, shaderEventLanes } from '../core/shader-events.mjs';
import { EventInteraction } from './event-interaction.mjs';
import { drawClipboard } from './clipboard-preview.mjs';
import { TempoMap } from '../core/tempo.mjs';
import { snapPosition, snapTime, verticalGrid, placementRange } from '../core/edit-grid.mjs';
import { SPECIAL_TRACKS, eventChains, simultaneousNotes, strokeIntersects } from '../core/editor-display.mjs';
import { captureSelection, editCapturedSelection, commitSelectionEdit } from '../application/batch-edit.mjs';
import { lineDisplayLabel } from '../core/line-groups.mjs';
import { trajectoryEventValue } from '../core/curve-trajectory.mjs';

export const NOTE_COLORS = { 1: '#8acbff', 2: '#8acbff', 3: '#f596ac', 4: '#f1ce76' };
const isHookedEvent = event => event?.inst === true || Number(event?.inst) === 1;
const labels = ['X', 'Y', '旋转', '透明', '速度'];
const extendedLabels = SPECIAL_TRACKS.map(track => track.label);

export function prepareCanvas(canvas) {
  const rectangle = canvas.getBoundingClientRect();
  const ratio = globalThis.devicePixelRatio || 1;
  const width = Math.round(rectangle.width * ratio);
  const height = Math.round(rectangle.height * ratio);
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  const context = canvas.getContext('2d');
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, rectangle.width, rectangle.height);
  return { context, width: rectangle.width, height: rectangle.height };
}

export class Timeline {
  constructor(notesCanvas, eventsCanvas, getSession, onEvent, changed, reportError = console.error, onContextMenu = () => {}) {
    this.notesCanvas = notesCanvas;
    this.eventsCanvas = eventsCanvas;
    this.getSession = () => this.bulkPreview?.session ?? getSession();
    this.onEvent = onEvent;
    this.changed = changed;
    this.onContextMenu = onContextMenu;
    this.origin = 0;
    this.scale = 500;
    this.division = 4;
    this.snapX = true;
    this.tool = 0;
    this.layer = 0;
    this.extended = false;
    this.cursor = null;
    this.drag = null;
    this.pendingHold = null;
    this.tempo = new TempoMap(getSession().chart.BPMList);
    this.onWheel = () => {};
    this.onNoteHover = () => {};
    this.curvePick = null;
    this.eventRects = [];
    this.eventInteraction = new EventInteraction(this, reportError);
    this.noteScale = 1;
    this.originalPanelWidth = 0;
    this.multiLineWidth = 0;
    this.multiLineEventWidth = 0;
    this.multiLineWidthExplicit = false;
    this.multiLineEventWidthExplicit = false;
    this.multiLineScroll = { notes: 0, events: 0 };
    this.multiLineLabels = null;
    this.multiLineScrollElement = null;
    this.scrollSpeed = 1;
    this.judgementOffset = 42;
    this.gridCount = 11;
    for (const canvas of [notesCanvas, eventsCanvas]) {
      canvas.addEventListener('wheel', event => {
        event.preventDefault();
        this.onWheel(event);
        changed();
      }, { passive: false });
      canvas.addEventListener('contextmenu', event => { event.preventDefault(); this.onContextMenu(event, canvas); });
    }
    notesCanvas.addEventListener('pointermove', event => this.move(event));
    notesCanvas.addEventListener('pointerleave', () => { if (!this.drag) this.cursor = null; this.onNoteHover?.(null); changed(); });
    notesCanvas.addEventListener('pointerdown', event => this.down(event));
    notesCanvas.addEventListener('pointerup', event => this.up(event));
    notesCanvas.addEventListener('pointercancel', () => { const tracing = this.drag?.kind === 'stroke' && this.drag.tracing; this.drag = null; if (tracing) this.getSession().notify(); changed(); });
  }

  point(event, canvas = this.notesCanvas) {
    const rectangle = canvas.getBoundingClientRect();
    return { x: event.clientX - rectangle.left, y: event.clientY - rectangle.top };
  }

  rectangleSelection() {
    if (this.drag?.kind === 'rectangle') return { drag: this.drag, canvas: this.notesCanvas, area: 'notes' };
    if (this.eventInteraction.drag?.kind === 'rectangle') return { drag: this.eventInteraction.drag, canvas: this.eventsCanvas, area: 'events' };
    return null;
  }

  rectangleStart(drag) {
    const scroll = drag.startWorldX === undefined ? 0 : this.multiLineViewportOffset((drag.area === 'events' ? this.eventsCanvas : this.notesCanvas).clientWidth, drag.area ?? 'notes');
    const height = (drag.area === 'events' ? this.eventsCanvas : this.notesCanvas).clientHeight;
    const factor = drag.startFactor ?? this.factor;
    return { x: drag.startWorldX === undefined ? drag.start.x : drag.startWorldX - scroll, y: drag.startSeconds === undefined ? drag.start.y : height - this.judgementOffset - (drag.startSeconds - this.tempo.seconds(this.origin, factor)) * this.scale };
  }

  rectangleTimes(drag) {
    const factor = drag.startFactor ?? this.factor;
    const start = drag.startSeconds ?? this.timeAt(drag.start.y);
    const current = drag.currentSeconds ?? (this.tempo.seconds(this.origin, factor) + (this.viewHeight() - this.judgementOffset - drag.current.y) / this.scale);
    return [this.tempo.beat(Math.min(start, current), factor) - 1e-8, this.tempo.beat(Math.max(start, current), factor) + 1e-8];
  }

  updateRectangle(event) {
    const selection = this.rectangleSelection(); if (!selection) return;
    selection.drag.current = this.point(event, selection.canvas);
    selection.drag.currentWorldX = selection.drag.current.x + this.multiLineViewportOffset(selection.canvas.clientWidth, selection.area);
    if (selection.drag.startFactor !== undefined) selection.drag.currentSeconds = this.tempo.seconds(this.origin, selection.drag.startFactor) + (this.viewHeight() - this.judgementOffset - selection.drag.current.y) / this.scale;
    this.changed();
  }

  finishRectangle(event) {
    const selection = this.rectangleSelection();
    if (!selection || ![0, 1, 2].includes(event.button)) return false;
    selection.drag.finished = true;
    if (selection.area === 'notes') this.up(event); else this.eventInteraction.up(event);
    return true;
  }

  get eventTypes() { return this.extended ? SPECIAL_TRACKS.map(track => track.key) : EVENT_TYPES; }

  eventColumnBounds(channel, width) {
    const channelWidth = width / this.eventTypes.length;
    const barWidth = channelWidth * Math.max(0.35, Math.min(1, this.eventBarWidth ?? 0.82));
    return { channelWidth, x: channel * channelWidth + (channelWidth - barWidth) / 2, width: barWidth };
  }

  get factor() { return this.getSession().line?.bpmfactor ?? 1; }
  viewHeight() { return this.getSession().multiLineActive && this.getSession().multiLineMode === 'events' ? this.eventsCanvas.clientHeight : this.notesCanvas.clientHeight; }
  factorForLine(lineIndex) { return this.getSession().chart.judgeLineList?.[lineIndex]?.bpmfactor ?? 1; }
  verticalForLine(beat, lineIndex, height = this.viewHeight()) { const factor = this.factorForLine(lineIndex); return height - this.judgementOffset - (this.tempo.seconds(beat, factor) - this.tempo.seconds(this.origin, factor)) * this.scale; }
  beatRangeForLine(lineIndex, height = this.viewHeight()) {
    const factor = this.factorForLine(lineIndex);
    const bottom = this.tempo.beat(this.timeAt(height), factor);
    const top = this.tempo.beat(this.timeAt(0), factor);
    return [Math.min(bottom, top) - 0.2, Math.max(bottom, top) + 0.2];
  }
  panelCount(area = 'notes') {
    const session = this.getSession();
    if (!session.multiLineActive) return 1;
    if (area === 'notes' && session.multiLineMode === 'notes' && session.multiLineMerge) return 1;
    return Math.max(1, session.multiLineIndices.length);
  }
  panelIndex(lineIndex, area = 'notes') {
    const session = this.getSession(); const index = session.targetLineIndices.indexOf(lineIndex);
    return this.panelCount(area) === 1 ? 0 : Math.max(0, index);
  }
  panelWidth(width, area = 'notes') {
    if (!this.getSession().multiLineActive || this.panelCount(area) === 1) return width;
    const configured = area === 'events'
      ? (this.multiLineEventWidthExplicit ? this.multiLineEventWidth : (this.multiLineWidthExplicit ? 0 : this.multiLineWidth))
      : this.multiLineWidth;
    return Math.max(30, Number(configured) || width);
  }
  panelGap(width, area = 'notes') {
    if (!this.getSession().multiLineActive || this.panelCount(area) <= 1) return 0;
    return Math.max(12, this.panelWidth(width, area) * 0.04);
  }
  panelStride(width, area = 'notes') { return this.panelWidth(width, area) + this.panelGap(width, area); }
  multiLineViewportOffset(width, area = 'notes') {
    const count = this.panelCount(area); const panelWidth = this.panelWidth(width, area); const gap = this.panelGap(width, area);
    const maximum = Math.max(0, count * panelWidth + Math.max(0, count - 1) * gap - width);
    const current = typeof this.multiLineScroll === 'number' ? this.multiLineScroll : this.multiLineScroll?.[area];
    const value = Math.max(0, Math.min(maximum, Number(current) || 0));
    if (typeof this.multiLineScroll === 'number') this.multiLineScroll = { notes: value, events: value };
    else this.multiLineScroll[area] = value;
    return value;
  }
  lineIndexAt(horizontal, width, area = 'notes') {
    const session = this.getSession(); if (!session.multiLineActive || this.panelCount(area) === 1) return session.lineIndex;
    const offset = this.multiLineViewportOffset(width, area);
    const stride = this.panelStride(width, area); const panelWidth = this.panelWidth(width, area);
    const slot = Math.max(0, Math.min(this.panelCount(area) - 1, Math.floor((horizontal + offset) / stride)));
    const local = (horizontal + offset) - slot * stride;
    if (local > panelWidth && slot < this.panelCount(area) - 1) return session.targetLineIndices[slot] ?? session.lineIndex;
    return session.targetLineIndices[slot] ?? session.lineIndex;
  }
  panelHorizontal(horizontal, lineIndex, width, area = 'notes') {
    return this.panelIndex(lineIndex, area) * this.panelStride(width, area) - this.multiLineViewportOffset(width, area) + horizontal;
  }
  timeAt(vertical) { return this.tempo.seconds(this.origin, this.factor) + (this.viewHeight() - this.judgementOffset - vertical) / this.scale; }
  beatAt(vertical) { return this.tempo.beat(this.timeAt(vertical), this.factor); }
  snappedBeat(vertical) { return beatValue(snapTime(this.timeAt(vertical), this.division, this.tempo, this.factor)); }
  vertical(beat, height = this.viewHeight()) { return height - this.judgementOffset - (this.tempo.seconds(beat, this.factor) - this.tempo.seconds(this.origin, this.factor)) * this.scale; }
  eventVertical(beat, type) { return this.vertical(beat); }
  eventBeatAt(vertical, type, snap = false) {
    const factor = this.factor;
    return snap ? beatValue(snapTime(this.timeAt(vertical), this.division, this.tempo, factor)) : this.tempo.beat(this.timeAt(vertical), factor);
  }
  get renderNoteScale() {
    const session = this.getSession();
    const width = this.panelWidth(this.notesCanvas.clientWidth, 'notes');
    const gap = this.columnGap ?? 24;
    const baseWidth = this.originalPanelWidth || this.notesCanvas.clientWidth || width;
    const notesViewOnly = this.notesOnly;
    return this.noteScale * (width / Math.max(1, baseWidth)) * (notesViewOnly ? width / Math.max(1, (width - gap) / 2) : 1);
  }
  horizontal(position) { return this.noteHorizontal(position); }
  noteInset(width = this.panelWidth(this.notesCanvas.clientWidth, 'notes')) { return Math.min(48 * this.renderNoteScale, Math.max(0, width / 2 - 1)); }
  noteWidth(note) { return 68 * this.renderNoteScale * Math.min(3, Math.max(0.2, note.size ?? 1)); }
  snapXPosition(value) {
    if (!this.snapX) return value;
    const snapped = snapPosition(value, this.gridCount);
    return [-675, 675, snapped].reduce((closest, candidate) => Math.abs(candidate - value) < Math.abs(closest - value) ? candidate : closest, snapped);
  }
  noteHorizontal(position, lineIndex = this.getSession().lineIndex) {
    const panelWidth = this.panelWidth(this.notesCanvas.clientWidth, 'notes'); const inset = this.noteInset(panelWidth); const width = Math.max(1, panelWidth - inset * 2);
    return this.panelHorizontal(inset + (position - (this.cameraX ?? 0) + 675) / 1350 * width, lineIndex, this.notesCanvas.clientWidth, 'notes');
  }
  positionAt(horizontal) {
    return this.notePositionAt(horizontal);
  }
  notePositionAt(horizontal, lineIndex = this.lineIndexAt(horizontal, this.notesCanvas.clientWidth, 'notes')) {
    const panelWidth = this.panelWidth(this.notesCanvas.clientWidth, 'notes'); const panel = this.panelIndex(lineIndex, 'notes'); const inset = this.noteInset(panelWidth); const width = Math.max(1, panelWidth - inset * 2);
    const local = horizontal + this.multiLineViewportOffset(this.notesCanvas.clientWidth, 'notes') - panel * this.panelStride(this.notesCanvas.clientWidth, 'notes');
    const value = (local - inset) / width * 1350 - 675 + (this.cameraX ?? 0);
    return this.snapXPosition(value);
  }
  clampNoteHorizontal(horizontal, width, canvasWidth = this.notesCanvas.clientWidth, lineIndex = this.getSession().lineIndex) {
    const panelWidth = this.panelWidth(canvasWidth, 'notes'); const panel = this.panelIndex(lineIndex, 'notes'); const offset = this.multiLineViewportOffset(canvasWidth, 'notes'); const left = panel * this.panelStride(canvasWidth, 'notes') - offset; const right = left + panelWidth;
    if (horizontal + width / 2 < left || horizontal - width / 2 > right) return null;
    return horizontal;
  }

  syncMultiLineChrome(area, width) {
    const session = this.getSession(); const showLabels = session.multiLineActive && session.multiLineMode === area; const active = showLabels && this.panelCount(area) > 1;
    const editor = this.notesCanvas.closest?.('.editor');
    editor?.classList.toggle('multi-scroll-visible', active);
    if (this.multiLineScrollElement) {
      const total = this.panelCount(area) * this.panelWidth(width, area) + Math.max(0, this.panelCount(area) - 1) * this.panelGap(width, area);
      const maximum = Math.max(0, total - width);
      this.multiLineScrollElement.hidden = !active;
      this.multiLineScrollElement.max = String(maximum);
      const scroll = typeof this.multiLineScroll === 'number' ? this.multiLineScroll : this.multiLineScroll?.[area] ?? 0;
      this.multiLineScrollElement.value = String(Math.min(maximum, Math.max(0, scroll)));
    }
    if (!this.multiLineLabels) return;
    this.multiLineLabels.hidden = !showLabels;
    this.multiLineLabels.replaceChildren();
    if (!showLabels) return;
    const panelWidth = this.panelWidth(width, area); const stride = this.panelStride(width, area); const offset = this.multiLineViewportOffset(width, area);
    const lines = this.panelCount(area) === 1 ? [{ index: session.targetLineIndices[0], text: session.multiLineMerge && area === 'notes' ? `多线合并 · ${session.targetLineIndices.map(index => lineDisplayLabel(session.chart, index)).join(' / ')}` : session.targetLineIndices.map(index => lineDisplayLabel(session.chart, index)).join(' · ') }] : session.targetLineIndices.map(index => ({ index, text: lineDisplayLabel(session.chart, index) }));
    for (const [panel, line] of lines.entries()) { const label = document.createElement('span'); label.textContent = line.text; label.style.width = `${panelWidth}px`; label.style.transform = `translateX(${panel * stride - offset}px)`; this.multiLineLabels.append(label); }
  }

  cancelPlacement() { this.pendingHold = null; this.eventInteraction.pending = null; this.drag = null; this.eventInteraction.drag = null; this.changed(); }

  movedNote(note) {
    if (!['move', 'startTime', 'endTime'].includes(this.drag?.kind)) return note;
    if (Math.hypot(this.drag.current.x - this.drag.start.x, this.drag.current.y - this.drag.start.y) <= 4 && !this.drag.scrolled) return note;
    const lineIndex = Number.isInteger(this.drag.lineIndex) ? this.drag.lineIndex : this.getSession().lineIndex;
    const anchor = this.getSession().chart.judgeLineList?.[lineIndex]?.notes?.[this.drag.anchor];
    if (!anchor || !Number.isFinite(anchor.positionX)) return note;
    const factor = this.factorForLine(lineIndex);
    const key = this.drag.kind === 'endTime' ? 'endTime' : 'startTime';
    const scroll = this.tempo.seconds(this.origin, factor) - (this.drag.originSeconds ?? this.tempo.seconds(this.origin, factor));
    const seconds = this.tempo.seconds(anchor[key], factor) + (this.drag.start.y - this.drag.current.y) / this.scale + scroll;
    const deltaBeat = beatValue(snapTime(seconds, this.division, this.tempo, factor)) - beatValue(anchor[key]);
    if (this.drag.kind !== 'move') {
      if (note.type !== 2) return note;
      const value = this.drag.kind === 'endTime' ? Math.max(beatValue(note.startTime), beatValue(note.endTime) + deltaBeat) : Math.max(0, Math.min(beatValue(note.endTime), beatValue(note.startTime) + deltaBeat));
      return { ...note, [key]: fromNumber(value) };
    }
    const panelWidth = this.panelWidth(this.notesCanvas.clientWidth, 'notes');
    const rawDeltaX = (this.drag.current.x - this.drag.start.x) / Math.max(1, panelWidth - this.noteInset(panelWidth) * 2) * 1350;
    const deltaX = this.snapXPosition(anchor.positionX + rawDeltaX) - anchor.positionX;
    const boundedBeat = Math.max(-beatValue(note.startTime), deltaBeat);
    return { ...note, positionX: Math.max(-675, Math.min(675, note.positionX + deltaX)), startTime: fromNumber(beatValue(note.startTime) + boundedBeat), endTime: fromNumber(beatValue(note.endTime) + boundedBeat) };
  }

  autoScroll(elapsed) {
    const drag = this.drag ?? this.eventInteraction.drag;
    if (!drag || !['move', 'startTime', 'endTime'].includes(drag.kind)) return;
    const height = this.viewHeight();
    const overflow = drag.current.y < 0 ? -drag.current.y : drag.current.y > height ? height - drag.current.y : 0;
    if (!overflow) return;
    drag.scrolled = true;
    this.onDragScroll?.(Math.sign(overflow) * Math.min(900, 120 + Math.abs(overflow) * 4) / this.scale * Math.min(0.05, elapsed));
    this.changed();
  }

  refreshIndex(lineIndex = this.getSession().lineIndex) {
    if (!this.noteIndexes) this.noteIndexes = new Map();
    const notes = this.getSession().chart.judgeLineList?.[lineIndex]?.notes ?? [];
    if (this.noteIndexes.get(lineIndex)?.notes === notes) return;
    this.noteIndexes.set(lineIndex, { notes, index: new IntervalIndex(notes, note => beatValue(note.startTime), note => Math.max(beatValue(note.startTime), beatValue(note.endTime))) });
  }

  visible(lineIndex = this.getSession().lineIndex) {
    this.refreshIndex(lineIndex);
    const [bottom, top] = this.beatRangeForLine(lineIndex);
    return this.noteIndexes.get(lineIndex).index.query(bottom, top).map(entry => ({ ...entry, lineIndex }));
  }

  hit(position) {
    const session = this.getSession();
    const lineIndices = session.multiLineActive && session.multiLineMode === 'notes' && this.panelCount('notes') === 1
      ? session.targetLineIndices
      : [this.lineIndexAt(position.x, this.notesCanvas.clientWidth, 'notes')];
    const entries = lineIndices.flatMap(lineIndex => this.visible(lineIndex));
    return entries.sort((left, right) => Number(right.item.type === 2) - Number(left.item.type === 2)).findLast(entry => {
      const lineIndex = entry.lineIndex;
      const horizontal = this.noteHorizontal(entry.item.positionX, lineIndex);
      return this.clampNoteHorizontal(horizontal, this.noteWidth(entry.item), this.notesCanvas.clientWidth, lineIndex) !== null
        && Math.abs(horizontal - position.x) <= this.noteWidth(entry.item) / 2
        && position.y >= this.verticalForLine(entry.end, lineIndex) - 9
        && position.y <= this.verticalForLine(entry.start, lineIndex) + 9;
    });
  }

  move(event) {
    this.cursor = this.point(event);
    this.cursorLineIndex = this.lineIndexAt(this.cursor.x, this.notesCanvas.clientWidth, 'notes');
    this.clipboardPointer = this.cursor;
    this.hoverArea = 'notes';
    if (this.drag) {
      const previous = this.drag.current;
      this.drag.current = this.cursor;
      this.drag.currentWorldX = this.cursor.x + this.multiLineViewportOffset(this.notesCanvas.clientWidth, 'notes');
      if (this.drag.startFactor !== undefined) this.drag.currentSeconds = this.tempo.seconds(this.origin, this.drag.startFactor) + (this.viewHeight() - this.judgementOffset - this.drag.current.y) / this.scale;
      if (this.drag.kind === 'multi-pan') {
        const current = this.multiLineViewportOffset(this.notesCanvas.clientWidth, 'notes');
        this.multiLineScroll.notes = Math.max(0, current - (this.cursor.x - previous.x));
        this.changed();
        return;
      }
      if (this.drag.kind === 'stroke' && (this.drag.tracing || Math.hypot(this.cursor.x - this.drag.start.x, this.cursor.y - this.drag.start.y) > 3)) {
        this.drag.tracing = true;
        this.getSession().multiSelectionIntent = 'notes';
        this.drag.points.push(this.cursor);
        for (const entry of this.visible(this.cursorLineIndex)) if (strokeIntersects(previous, this.cursor, {
          left: this.noteHorizontal(entry.item.positionX, this.cursorLineIndex) - this.noteWidth(entry.item) / 2, right: this.noteHorizontal(entry.item.positionX, this.cursorLineIndex) + this.noteWidth(entry.item) / 2,
          top: this.vertical(entry.end) - 7, bottom: this.vertical(entry.start) + 7,
        })) this.drag.remove ? this.getSession().selection.delete(entry.index) : this.getSession().selection.add(entry.index);
      }
    }
    const hover = !this.drag ? this.hit(this.cursor) : null;
    this.onNoteHover?.(hover);
    this.changed();
    if (!this.drag && this.notesCanvas.style) {
      const hit = this.hit(this.cursor);
      this.notesCanvas.style.cursor = hit?.item.type === 2 && (Math.abs(this.cursor.y - this.vertical(hit.end)) < 8 || Math.abs(this.cursor.y - this.vertical(hit.start)) < 8) ? 'ns-resize' : hit ? 'move' : 'default';
    }
  }

  down(event) {
    if (![0, 1, 2].includes(event.button)) return;
    event.preventDefault?.();
    if (event.button === 2) return;
    if (this.finishRectangle(event)) return;
    this.notesCanvas.focus();
    this.notesCanvas.setPointerCapture(event.pointerId);
    const position = this.point(event);
    this.cursor = position;
    this.cursorLineIndex = this.lineIndexAt(position.x, this.notesCanvas.clientWidth, 'notes');
    this.clipboardPointer = position;
    this.hoverArea = 'notes';
    const hit = this.hit(position);
    const session = this.getSession();
    if (event.ctrlKey || event.shiftKey || event.button === 1) session.multiSelectionIntent = 'notes';
    else session.multiSelectionIntent = null;
    if (event.button === 0 && hit && this.curvePick?.(hit.item, hit.index)) return;
    if (!session.multiLineActive && hit?.lineIndex !== undefined && hit.lineIndex !== session.lineIndex) session.selectLine(hit.lineIndex);
    session.focus = 'notes';
    if (!event.ctrlKey && !event.shiftKey && event.button !== 1) session.eventSelection.clear();
    const multiMode = session.multiLineActive;
    const multiPanel = multiMode && this.panelCount('notes') > 1;
    const panBlank = multiPanel && !hit && !this.tool && !this.pendingHold;
    if (event.button === 0 && (this.pendingHold || this.tool && !event.shiftKey && !event.ctrlKey) && !panBlank) { this.addAtCursor(this.pendingHold ? 2 : this.tool); return; }
    if (multiMode && (event.shiftKey || event.button === 1)) {
      const worldX = position.x + this.multiLineViewportOffset(this.notesCanvas.clientWidth, 'notes');
      this.drag = { kind: 'rectangle', area: 'notes', start: position, startWorldX: worldX, startFactor: this.factorForLine(this.cursorLineIndex ?? session.lineIndex), startSeconds: this.timeAt(position.y), current: position, currentWorldX: worldX, append: true, remove: false };
    } else if (multiPanel && panBlank) {
      this.drag = { kind: 'multi-pan', start: position, current: position };
    } else if (!multiMode && (event.shiftKey || event.button === 1)) {
      this.drag = { kind: 'rectangle', area: 'notes', start: position, startFactor: this.factorForLine(this.cursorLineIndex ?? session.lineIndex), startSeconds: this.timeAt(position.y), current: position, append: true, remove: false };
    } else if (hit && event.button === 0) {
      const lineSelection = session.multiLineActive ? new Set(session.multiLineSelection?.get(hit.lineIndex) ?? []) : session.selection;
      const wasSelected = lineSelection.has(hit.index);
      if (event.ctrlKey) {
        if (lineSelection.has(hit.index)) lineSelection.delete(hit.index);
        else lineSelection.add(hit.index);
      } else if (!lineSelection.has(hit.index)) lineSelection.clear(), lineSelection.add(hit.index);
      // A plain click on an unselected object starts a new selection. In
      // multi-line mode clear selections belonging to other panels as well;
      // otherwise clicking a single Hold can accidentally turn into a
      // multi-selection drag.
      if (session.multiLineActive && !event.ctrlKey && !wasSelected) {
        session.multiLineSelection?.clear();
        lineSelection.clear(); lineSelection.add(hit.index);
      }
      session.selection = lineSelection;
      if (session.multiLineActive && session.multiLineSelection) session.multiLineSelection.set(hit.lineIndex, lineSelection);
      const hitVertical = beat => session.multiLineActive ? this.verticalForLine(beat, hit.lineIndex, this.notesCanvas.clientHeight) : this.vertical(beat);
      const kind = hit.item.type === 2 && Math.abs(position.y - hitVertical(hit.end)) <= 8 ? 'endTime' : hit.item.type === 2 && Math.abs(position.y - hitVertical(hit.start)) <= 8 ? 'startTime' : 'move';
      this.drag = { kind, start: position, current: position, anchor: hit.index, lineIndex: hit.lineIndex, originSeconds: this.tempo.seconds(this.origin, this.factorForLine(hit.lineIndex ?? session.lineIndex)) };
      session.notify();
    } else if (!multiMode) { this.drag = { kind: 'stroke', start: position, current: position, points: [position], remove: event.button === 2 }; session.notify(); }
    this.changed();
  }

  up(event) {
    if (!this.drag) return;
    if (this.drag.kind === 'stroke') this.move(event);
    if (this.drag.kind === 'multi-pan') { this.drag = null; this.changed(); return; }
    if (this.drag.kind === 'stroke' && !this.drag.remove && !this.drag.tracing && this.previewPick?.(event)) { this.drag = null; this.changed(); return; }
    if (this.drag.kind === 'stroke' && this.drag.remove && !this.drag.tracing) {
      this.drag = { ...this.drag, kind: 'rectangle', startSeconds: this.timeAt(this.drag.start.y), append: true, remove: false }; this.changed(); return;
    }
    const drag = this.drag;
    drag.current = this.point(event);
    drag.currentWorldX = drag.current.x + this.multiLineViewportOffset(this.notesCanvas.clientWidth, 'notes');
    if (drag.startFactor !== undefined) drag.currentSeconds = this.tempo.seconds(this.origin, drag.startFactor) + (this.viewHeight() - this.judgementOffset - drag.current.y) / this.scale;
    const session = this.getSession();
    if (drag.kind === 'rectangle') {
      if (!drag.finished) { this.changed(); return; }
      const left = Math.min(drag.startWorldX ?? drag.start.x, drag.currentWorldX ?? drag.current.x);
      const right = Math.max(drag.startWorldX ?? drag.start.x, drag.currentWorldX ?? drag.current.x);
      const [bottom, top] = this.rectangleTimes(drag);
      if (!drag.append) session.selection.clear();
      const lineIndices = session.multiLineActive && session.multiLineMode === 'notes' ? session.targetLineIndices : [session.lineIndex];
      for (const lineIndex of lineIndices) {
        this.refreshIndex(lineIndex);
        const noteIndex = this.noteIndexes.get(lineIndex)?.index;
        if (!noteIndex) continue;
        const selected = session.multiLineActive && session.multiLineMode === 'notes'
          ? new Set(session.multiLineSelection?.get(lineIndex) ?? []) : session.selection;
        for (const entry of noteIndex.query(bottom, top)) {
          const horizontal = this.noteHorizontal(entry.item.positionX, lineIndex) + this.multiLineViewportOffset(this.notesCanvas.clientWidth, 'notes');
          if (horizontal >= left && horizontal <= right) drag.remove ? selected.delete(entry.index) : selected.add(entry.index);
        }
        if (session.multiLineActive && session.multiLineMode === 'notes') session.multiLineSelection?.set(lineIndex, selected);
      }
      if (session.multiLineActive && session.multiLineMode === 'notes') session.selection = new Set(session.multiLineSelection?.get(session.lineIndex) ?? []);
      session.notify();
    } else if (['move', 'startTime', 'endTime'].includes(drag.kind) && (drag.scrolled || Math.hypot(drag.current.x - drag.start.x, drag.current.y - drag.start.y) > 4)) {
      if (session.multiLineActive && session.multiLineMode === 'notes') {
        const snapshot = captureSelection(session);
        const result = editCapturedSelection(snapshot, { note: item => this.movedNote(item) });
        this.drag = null;
        commitSelectionEdit(session, result, drag.kind === 'move' ? '移动音符' : '调整 Hold 长度');
      } else {
        const replacements = new Map([...session.selection].map(index => [session.notes[index], this.movedNote(session.notes[index])]));
        this.drag = null;
        session.transformSelection(drag.kind === 'move' ? '移动音符' : '调整 Hold 长度', note => replacements.get(note));
      }
    }
    this.drag = null;
    if (drag.kind === 'stroke' && drag.tracing) session.notify();
    this.changed();
  }

  addAtCursor(type) {
    if (!this.cursor) return false;
    const session = this.getSession();
    session.focus = 'notes'; session.eventSelection.clear();
    const beat = this.snappedBeat(this.cursor.y);
    if (type === 2) {
      const lineIndex = this.cursorLineIndex ?? this.lineIndexAt(this.cursor.x, this.notesCanvas.clientWidth, 'notes');
      const positionX = this.notePositionAt(this.cursor.x, lineIndex);
      if (!Number.isFinite(positionX)) return false;
      if (!this.pendingHold) this.pendingHold = { beat, positionX, lineIndex };
      else {
        const range = placementRange(fromNumber(this.pendingHold.beat), fromNumber(beat));
        if (range && Number.isFinite(this.pendingHold.positionX)) session.insertNotesAt(this.pendingHold.lineIndex, [createNote(2, range.start, this.pendingHold.positionX, range.end)]);
        this.pendingHold = null;
      }
      this.changed();
    } else {
      const lineIndex = this.cursorLineIndex ?? session.lineIndex;
      const positionX = this.notePositionAt(this.cursor.x, lineIndex);
      if (!Number.isFinite(positionX)) return false;
      session.insertNotesAt(lineIndex, [createNote(type, beat, positionX)]);
    }
    return true;
  }

  grid(context, width, height, playBeat) {
    const first = Math.floor(this.beatAt(height) * this.division);
    const last = Math.ceil(this.beatAt(0) * this.division);
    const localBeatHeight = Math.abs(this.vertical(this.origin + 1) - this.vertical(this.origin));
    const stride = Math.max(1, Math.ceil(6 * this.division / localBeatHeight));
    context.font = '12px RPE, sans-serif';
    context.lineWidth = Math.max(0.5, (this.barWidth ?? 3) * 2 * width / 1920);
    for (let tick = first; tick <= last; tick += stride) {
      const beat = tick / this.division;
      const vertical = this.vertical(beat, height);
      const major = tick % this.division === 0;
      context.strokeStyle = `rgba(${major ? '0,255,255' : '255,255,0'},${Math.min(1, (this.barAlpha ?? 1) * (major ? 0.9 : tick % 2 === 0 ? 0.6 : 0.4))})`;
      context.beginPath(); context.moveTo(0, vertical); context.lineTo(width, vertical); context.stroke();
      if (tick % this.division === 0) { context.fillStyle = '#dddddd'; context.fillText(String(beat), 5, vertical - 4); }
    }
    context.strokeStyle = '#ffd76a';
    context.beginPath(); context.moveTo(0, this.vertical(playBeat, height)); context.lineTo(width, this.vertical(playBeat, height)); context.stroke();
    context.lineWidth = 1;
  }

  gridForLine(context, left, width, height, playBeat, lineIndex, showBeatLabels = true) {
    const factor = this.factorForLine(lineIndex);
    const originSeconds = this.tempo.seconds(this.origin, factor);
    const secondsAt = vertical => originSeconds + (height - this.judgementOffset - vertical) / this.scale;
    const beatAt = vertical => this.tempo.beat(secondsAt(vertical), factor);
    const first = Math.floor(beatAt(height) * this.division);
    const last = Math.ceil(beatAt(0) * this.division);
    const localBeatHeight = Math.abs(this.verticalForLine(this.origin + 1, lineIndex, height) - this.verticalForLine(this.origin, lineIndex, height));
    const stride = Math.max(1, Math.ceil(6 * this.division / Math.max(1, localBeatHeight)));
    context.save();
    context.beginPath(); context.rect(left, 0, width, height); context.clip();
    context.font = '12px RPE, sans-serif';
    context.lineWidth = Math.max(0.5, (this.barWidth ?? 3) * 2 * width / 1920);
    for (let tick = first; tick <= last; tick += stride) {
      const beat = tick / this.division;
      const vertical = this.verticalForLine(beat, lineIndex, height);
      const major = tick % this.division === 0;
      context.strokeStyle = `rgba(${major ? '0,255,255' : '255,255,0'},${Math.min(1, (this.barAlpha ?? 1) * (major ? 0.9 : tick % 2 === 0 ? 0.6 : 0.4))})`;
      context.beginPath(); context.moveTo(left, vertical); context.lineTo(left + width, vertical); context.stroke();
      if (major && showBeatLabels) { context.fillStyle = '#dddddd'; context.fillText(String(beat), left + 5, vertical - 4); }
    }
    const playSeconds = this.tempo.seconds(playBeat, this.factor);
    const playLineBeat = this.tempo.beat(playSeconds, factor);
    context.strokeStyle = '#ffd76a';
    context.beginPath(); context.moveTo(left, this.verticalForLine(playLineBeat, lineIndex, height)); context.lineTo(left + width, this.verticalForLine(playLineBeat, lineIndex, height)); context.stroke();
    context.restore(); context.lineWidth = 1;
  }

  drawMultiLineGrid(context, width, height, playBeat, area = 'events') {
    const panelWidth = this.panelWidth(width, area);
    const stride = this.panelStride(width, area);
    const offset = this.multiLineViewportOffset(width, area);
    const multiple = this.panelCount(area) > 1;
    for (const [panel, lineIndex] of this.getSession().targetLineIndices.entries()) {
      this.gridForLine(context, panel * stride - offset, panelWidth, height, playBeat, lineIndex, !multiple);
    }
  }

  drawMultiLineBeatLabels(context, width, height, area) {
    if (this.panelCount(area) < 2) return;
    const panelWidth = this.panelWidth(width, area); const stride = this.panelStride(width, area);
    const offset = this.multiLineViewportOffset(width, area); const gap = this.panelGap(width, area);
    for (const [panel, lineIndex] of this.getSession().targetLineIndices.entries()) {
      if (panel >= this.panelCount(area) - 1) continue;
      const factor = this.factorForLine(lineIndex); const originSeconds = this.tempo.seconds(this.origin, factor);
      const secondsAt = vertical => originSeconds + (height - this.judgementOffset - vertical) / this.scale;
      const beatAt = vertical => this.tempo.beat(secondsAt(vertical), factor);
      const first = Math.floor(beatAt(height) * this.division); const last = Math.ceil(beatAt(0) * this.division);
      const localBeatHeight = Math.abs(this.verticalForLine(this.origin + 1, lineIndex, height) - this.verticalForLine(this.origin, lineIndex, height));
      const tickStride = Math.max(1, Math.ceil(6 * this.division / Math.max(1, localBeatHeight)));
      const labelStride = Math.max(this.division, Math.ceil(tickStride / this.division) * this.division);
      const labelFirst = Math.ceil(first / this.division) * this.division;
      const x = panel * stride - offset + panelWidth + gap / 2;
      context.save(); context.font = `${gap < 20 ? 10 : 12}px RPE, sans-serif`; context.textAlign = 'center'; context.fillStyle = '#dddddd';
      for (let tick = labelFirst; tick <= last; tick += labelStride) {
        const beat = tick / this.division; const vertical = this.verticalForLine(beat, lineIndex, height);
        if (vertical >= 0 && vertical <= height) context.fillText(String(beat), x, vertical - 4);
      }
      context.restore();
    }
  }

  draw(playBeat) {
    const session = this.getSession();
    this.syncMultiLineChrome('notes', this.notesCanvas.clientWidth);
    const { context, width, height } = prepareCanvas(this.notesCanvas);
    if (!session.multiLineActive || !this.multiLineWidth) this.originalPanelWidth = width;
    const multiNotes = session.multiLineActive && session.multiLineMode === 'notes';
    if (session.multiLineActive && this.panelCount('notes') > 1) {
      const panelWidth = this.panelWidth(width, 'notes'); const gap = this.panelGap(width, 'notes'); const offset = this.multiLineViewportOffset(width, 'notes');
      context.fillStyle = '#242424';
      for (let panel = 0; panel < this.panelCount('notes') - 1; panel++) context.fillRect(panel * (panelWidth + gap) + panelWidth - offset, 0, gap, height);
    }
    if (multiNotes && this.panelCount('notes') > 1) this.drawMultiLineGrid(context, width, height, playBeat, 'notes'); else this.grid(context, width, height, playBeat);
    context.strokeStyle = '#555555';
    const grid = verticalGrid(this.gridCount);
    const extent = 675;
    const cameraX = this.cameraX ?? 0;
    const firstGrid = Math.ceil((cameraX - extent) / grid.spacing - grid.first);
    const lastGrid = Math.floor((cameraX + extent) / grid.spacing - grid.first);
    const lanes = new Set();
    for (let index = firstGrid; index <= lastGrid; index++) lanes.add((index + grid.first) * grid.spacing);
    lanes.add(cameraX - extent); lanes.add(cameraX + extent); lanes.add(cameraX);
    for (const lineIndex of this.getSession().targetLineIndices.slice(0, this.panelCount('notes'))) {
      for (const lane of lanes) {
        const center = Math.abs(lane - cameraX) < 1e-7;
        const boundary = Math.abs(Math.abs(lane - cameraX) - extent) < 1e-7;
        context.strokeStyle = center ? '#9ba5b0' : boundary ? '#737d88' : '#555555'; context.lineWidth = center ? 2 : boundary ? 1.5 : 1;
        context.beginPath(); context.moveTo(this.noteHorizontal(lane, lineIndex), 0); context.lineTo(this.noteHorizontal(lane, lineIndex), height); context.stroke();
      }
    }
    if (this.panelCount('notes') > 1) {
      const panelWidth = this.panelWidth(width, 'notes'); const offset = this.multiLineViewportOffset(width, 'notes');
      context.strokeStyle = '#333b45'; context.lineWidth = 2;
      for (let panel = 0; panel < this.panelCount('notes') - 1; panel++) { const separator = panel * this.panelStride(width, 'notes') + panelWidth - offset; context.beginPath(); context.moveTo(separator, 0); context.lineTo(separator, height); context.stroke(); }
    }
    context.lineWidth = 1;
    if (this.highlightChart !== session.chart || this.highlightTempo !== this.tempo) {
      this.highlightChart = session.chart; this.highlightTempo = this.tempo; this.simultaneous = simultaneousNotes(session.chart, this.tempo);
    }
    if (this.getSession().multiLineActive && this.getSession().multiLineMode === 'notes') this.drawMultiLineNotes(context, width, height);
    this.drawCurveGhost(context);
    drawClipboard(this, context, width, height, 'notes');

    const entries = new Map(this.visible().map(entry => [entry.index, entry]));
    if (!multiNotes && ['move', 'startTime', 'endTime'].includes(this.drag?.kind)) for (const index of session.selection) entries.set(index, { item: session.notes[index], index });
    for (const entry of multiNotes ? [] : [...entries.values()].sort((left, right) => Number(right.item.type === 2) - Number(left.item.type === 2))) {
      const selected = session.selection.has(entry.index);
      const note = selected ? this.movedNote(entry.item) : entry.item;
      const horizontal = this.noteHorizontal(note.positionX);
      const vertical = this.vertical(beatValue(note.startTime));
      const endVertical = this.vertical(beatValue(note.endTime));
      const noteWidth = 68 * this.renderNoteScale * Math.min(3, Math.max(0.2, note.size ?? 1));
      const renderedHorizontal = this.clampNoteHorizontal(horizontal, noteWidth, width);
      if (renderedHorizontal == null) continue;
      context.globalAlpha = note.isFake ? 0.45 : noteIsAbove(note) ? 1 : 0.7;
      context.fillStyle = NOTE_COLORS[note.type];
      const highlight = this.highlight !== false && this.simultaneous.has(entry.item);
      const textured = note.type === 2 ? this.skin?.hold(context, renderedHorizontal, vertical, endVertical, noteWidth, highlight, true, note.tint ?? note.color) : this.skin?.head(context, note.type, renderedHorizontal, vertical, noteWidth, highlight, note.tint ?? note.color);
      if (!textured && note.type === 2) {
        context.globalAlpha *= 0.45;
        const top = Math.max(-10, endVertical);
        context.fillRect(renderedHorizontal - noteWidth / 2, top, noteWidth, Math.min(height + 20, vertical - top));
        context.globalAlpha = 1;
        context.fillRect(renderedHorizontal - noteWidth / 2, endVertical - 3, noteWidth, 6);
      }
      if (!textured) context.fillRect(renderedHorizontal - noteWidth / 2, vertical - 4, noteWidth, 8);
      if (selected) { context.strokeStyle = '#fff'; context.lineWidth = 2; context.strokeRect(renderedHorizontal - noteWidth / 2 - 3, vertical - 7, noteWidth + 6, 14); context.lineWidth = 1; }
      context.globalAlpha = 1;
    }
    if (this.drag?.kind === 'rectangle' && !this.marqueeOverlay) {
      context.fillStyle = '#81bfff22'; context.strokeStyle = '#81bfff';
      const start = this.rectangleStart(this.drag); const { current } = this.drag;
      context.fillRect(start.x, start.y, current.x - start.x, current.y - start.y);
      context.strokeRect(start.x, start.y, current.x - start.x, current.y - start.y);
    }
    if (this.pendingHold && this.cursor) {
      const lineIndex = this.pendingHold.lineIndex ?? this.getSession().lineIndex;
      const head = this.verticalForLine(this.pendingHold.beat, lineIndex, height); const tail = this.verticalForLine(this.snappedBeat(this.cursor.y), lineIndex, height);
      const pendingHorizontal = this.noteHorizontal(this.pendingHold.positionX, lineIndex);
      context.globalAlpha = 0.65;
          if (!this.skin?.hold(context, pendingHorizontal, head, tail, 68 * this.renderNoteScale)) context.fillRect(pendingHorizontal - 20, Math.min(head, tail), 40, Math.abs(tail - head));
      context.globalAlpha = 1;
    } else if (this.cursor && this.tool) {
      const lineIndex = this.cursorLineIndex ?? this.lineIndexAt(this.cursor.x, width, 'notes');
      const positionX = this.notePositionAt(this.cursor.x, lineIndex);
      context.fillStyle = NOTE_COLORS[this.tool] + '88';
      const vertical = this.verticalForLine(this.snappedBeat(this.cursor.y), lineIndex, height);
      context.fillRect(this.noteHorizontal(positionX, lineIndex) - 24, vertical - 3, 48, 6);
    }
    context.globalAlpha = 1;
    if (this.drag?.kind === 'stroke') {
      context.strokeStyle = this.drag.remove ? '#ff8080' : '#80ffff'; context.beginPath();
      this.drag.points.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y)); context.stroke();
    }
    if (Number.isFinite(this.scaleAxis)) {
      context.save(); context.strokeStyle = '#fff3a3'; context.lineWidth = 2; context.setLineDash([8, 5]);
      const lines = session.multiLineActive && session.multiLineMode === 'notes'
        ? session.targetLineIndices
        : [this.scaleAxisLine ?? session.lineIndex];
      for (const lineIndex of lines) {
        const horizontal = this.noteHorizontal(this.scaleAxis, lineIndex);
        context.beginPath(); context.moveTo(horizontal, 0); context.lineTo(horizontal, height); context.stroke();
      }
      context.restore();
    }
    if (multiNotes) this.drawMultiLineBeatLabels(context, width, height, 'notes');
    if (!this.notesOnly && !(session.multiLineActive && session.multiLineMode === 'notes')) {
      this.drawEvents(playBeat);
    }
  }

  drawMultiLineNotes(context, width, height) {
    const session = this.getSession();
    context.save();
    for (const lineIndex of session.targetLineIndices) {
      const line = session.chart.judgeLineList?.[lineIndex];
      const [bottomBeat, topBeat] = this.beatRangeForLine(lineIndex, height);
      for (const [index, sourceNote] of (line?.notes ?? []).entries()) {
        const selectedSet = session.multiLineActive && session.multiLineMode === 'notes'
          ? (session.multiLineSelection?.get(lineIndex) ?? new Set()) : session.selection;
        const note = selectedSet.has(index) && this.drag?.lineIndex === lineIndex && !this.bulkPreview ? this.movedNote(sourceNote) : sourceNote;
        const beat = beatValue(note.startTime); const endBeat = beatValue(note.endTime);
        if (Math.max(beat, endBeat) < bottomBeat || Math.min(beat, endBeat) > topBeat) continue;
        const horizontal = this.noteHorizontal(note.positionX, lineIndex); const noteWidth = this.noteWidth(note); const rendered = this.clampNoteHorizontal(horizontal, noteWidth, width, lineIndex);
        if (rendered == null) continue;
        const vertical = this.verticalForLine(beat, lineIndex, height); const endVertical = this.verticalForLine(beatValue(note.endTime), lineIndex, height);
        const selected = selectedSet.has(index);
        const highlight = this.highlight !== false && this.simultaneous?.has(sourceNote);
        context.globalAlpha = note.isFake ? 0.45 : noteIsAbove(note) ? 1 : 0.7;
        context.fillStyle = NOTE_COLORS[note.type] ?? '#b8c8ff';
        const textured = note.type === 2 ? this.skin?.hold(context, rendered, vertical, endVertical, noteWidth, highlight, true, note.tint ?? note.color) : this.skin?.head(context, note.type, rendered, vertical, noteWidth, highlight, note.tint ?? note.color);
        if (!textured && note.type === 2) { const alpha = context.globalAlpha; context.globalAlpha = alpha * 0.45; context.fillRect(rendered - noteWidth / 2, Math.min(vertical, endVertical), noteWidth, Math.abs(vertical - endVertical)); context.globalAlpha = alpha; }
        if (!textured) context.fillRect(rendered - noteWidth / 2, vertical - 4, noteWidth, 8);
        if (selected) { context.strokeStyle = '#fff'; context.lineWidth = 2; context.strokeRect(rendered - noteWidth / 2 - 3, vertical - 7, noteWidth + 6, 14); context.lineWidth = 1; }
        if (session.multiLineMerge && session.targetLineIndices.length > 1) { context.fillStyle = '#f0d887'; context.font = '14px RPE, sans-serif'; context.textAlign = 'center'; context.fillText(String(lineIndex), rendered, vertical + 18); context.textAlign = 'left'; }
      }
    }
    context.globalAlpha = 1;
    context.restore();
  }

  drawMultiLineEvents(playBeat) {
    const session = this.getSession(); const context = this.eventsCanvas.getContext('2d'); const width = this.eventsCanvas.clientWidth; const height = this.eventsCanvas.clientHeight;
    this.eventRects = [];
    const baseValueFontSize = this.eventValueFontSize ?? 13;
    for (const lineIndex of session.targetLineIndices) {
      const panel = this.panelIndex(lineIndex, 'events'); const panelWidth = this.panelWidth(width, 'events'); const offset = panel * this.panelStride(width, 'events') - this.multiLineViewportOffset(width, 'events');
      const layer = this.extended ? { ...(session.chart.judgeLineList?.[lineIndex]?.extended ?? {}), paintEvents: eventListAt(session, lineIndex, 'paintEvents') } : session.chart.judgeLineList?.[lineIndex]?.eventLayers?.[this.layer] ?? {};
      this.eventTypes.forEach((type, channel) => {
        const channelWidth = panelWidth / this.eventTypes.length; const barWidth = channelWidth * Math.max(0.35, Math.min(1, this.eventBarWidth ?? 0.82)); const barX = offset + channel * channelWidth + (channelWidth - barWidth) / 2;
        context.strokeStyle = '#334154'; context.beginPath(); context.moveTo(offset + channel * channelWidth, 0); context.lineTo(offset + channel * channelWidth, height); context.stroke();
        const events = layer[type] ?? [];
        const groups = eventChains(events);
        const ranges = new Map(groups.flatMap(group => group.entries.map(entry => [entry.index, group])));
        const entries = events.map((event, index) => ({ event, index })).filter(({ event }) => {
          const start = beatValue(event.startTime); const end = beatValue(event.endTime); const top = this.verticalForLine(end, lineIndex, height); const bottom = this.verticalForLine(start, lineIndex, height);
          return bottom >= 23 && top <= height;
        });
        const seamlessGroups = new Set();
        if (this.seamlessEvents && channelWidth >= 18 && type !== 'paintEvents') for (const group of new Set(entries.map(entry => ranges.get(entry.index)))) {
          if (!group || group.entries.length < 2) continue;
          const lineSelection = session.multiEventSelection?.get(lineIndex) ?? (lineIndex === session.lineIndex ? session.eventSelection : new Set());
          const hasSelected = group.entries.some(entry => lineSelection.has(eventKey(type, entry.index)));
          const bound = group.entries.some(entry => Number(entry.event.linkgroup ?? 0) > 0);
          const hooked = group.entries.some(entry => isHookedEvent(entry.event));
          if (hasSelected || bound || hooked) continue;
          seamlessGroups.add(group);
          const first = group.entries[0].event; const last = group.entries.at(-1).event;
          const top = Math.max(23, this.verticalForLine(beatValue(last.endTime), lineIndex, height));
          const bottom = Math.min(height, this.verticalForLine(beatValue(first.startTime), lineIndex, height));
          if (bottom > top) { context.globalAlpha = this.eventOpacity ?? 0.25; context.fillStyle = '#e58d24'; context.fillRect(barX, top, barWidth, bottom - top); context.globalAlpha = 1; context.strokeStyle = '#ffa334'; context.strokeRect(barX, top, barWidth, bottom - top); }
        }
        for (const { index, event } of entries) {
          const start = beatValue(event.startTime); const end = beatValue(event.endTime); const top = this.verticalForLine(end, lineIndex, height); const bottom = this.verticalForLine(start, lineIndex, height);
          if (bottom < 23 || top > height) continue;
          const rectangle = { x: barX, y: Math.max(23, top), width: barWidth, height: Math.max(2, Math.min(height, bottom) - Math.max(23, top)), index, type, lineIndex };
          this.eventRects.push(rectangle);
          const lineSelection = session.multiEventSelection?.get(lineIndex) ?? (lineIndex === session.lineIndex ? session.eventSelection : new Set());
          const selected = lineSelection.has(eventKey(type, index));
          const hooked = isHookedEvent(event);
          const seamless = seamlessGroups.has(ranges.get(index));
          context.globalAlpha = this.eventOpacity ?? 0.25;
          context.fillStyle = type === 'paintEvents' ? '#c6a1ff' : selected ? '#ffe091' : hooked ? '#62d8f2' : '#e58d24'; if (!seamless) context.fillRect(rectangle.x, rectangle.y, rectangle.width, rectangle.height);
          context.globalAlpha = 1; context.strokeStyle = selected ? '#fff2bd' : type === 'paintEvents' ? '#c6a1ff' : hooked ? '#b8f2ff' : '#ffa334'; context.lineWidth = selected ? 2 : 1; if (!seamless) context.strokeRect(rectangle.x, rectangle.y, rectangle.width, rectangle.height);
          if (event.trajectory) this.drawTrajectoryEvent(context, rectangle, event);
          if (!event.trajectory && type !== 'paintEvents' && channelWidth >= (this.eventCurveThreshold ?? 24) && Number.isFinite(event.start) && Number.isFinite(event.end)) {
            const group = ranges.get(index); context.save(); context.beginPath(); context.rect(rectangle.x, rectangle.y, rectangle.width, rectangle.height); context.clip(); context.lineWidth = 1.5; context.strokeStyle = selected ? '#fff4c2' : '#ffe0a3'; context.beginPath();
            for (let step = 0; step <= 24; step++) { const progress = step / 24; const amount = event.bezier ? bezier(progress, event.bezierPoints) : easing(progress, event.easingType, event.easingLeft ?? 0, event.easingRight ?? 1); const value = event.start + (event.end - event.start) * amount; const normalized = group.max - group.min > 0.01 ? (value - group.min) / (group.max - group.min) : 0.5; const x = rectangle.x + 4 + normalized * Math.max(1, rectangle.width - 8); const y = bottom - progress * (bottom - top); if (!step) context.moveTo(x, y); else context.lineTo(x, y); }
            context.stroke(); context.restore();
          }
        }
         const valueThreshold = this.eventValueThreshold ?? 30;
         const valueFontSize = channelWidth >= valueThreshold * 2.4 ? baseValueFontSize : channelWidth >= valueThreshold * 1.7 ? Math.min(baseValueFontSize, 11) : channelWidth >= valueThreshold * 1.2 ? Math.min(baseValueFontSize, 9) : channelWidth >= valueThreshold ? Math.min(baseValueFontSize, 8) : 0;
        if (type !== 'paintEvents' && valueFontSize > 0) {
          context.font = `${valueFontSize}px RPE, sans-serif`; context.textAlign = 'center';
          for (const group of new Set(entries.map(entry => ranges.get(entry.index)))) { if (!group) continue; const first = group.entries[0].event; const last = group.entries.at(-1).event; const top = this.verticalForLine(beatValue(last.endTime), lineIndex, height); const bottom = this.verticalForLine(beatValue(first.startTime), lineIndex, height); const format = value => typeof value === 'number' ? value.toFixed(2) : Array.isArray(value) ? value.join(',') : String(value ?? ''); context.fillStyle = '#f6e5ce'; context.fillText(format(Number.isFinite(group.max) ? group.max : last.end), offset + channel * channelWidth + channelWidth / 2, Math.max(37, top + 13), Math.max(10, channelWidth - 8)); if (bottom - top > 26) context.fillText(format(Number.isFinite(group.min) ? group.min : first.start), offset + channel * channelWidth + channelWidth / 2, Math.min(height - 5, bottom - 5), Math.max(10, channelWidth - 8)); }
          context.textAlign = 'left';
        }
        context.fillStyle = '#303030'; context.fillRect(offset + channel * channelWidth, 0, channelWidth, 23);
        if (channelWidth >= 48) { context.fillStyle = '#f5f5f5'; context.font = '12px RPE, sans-serif'; context.fillText((this.extended ? extendedLabels : labels)[channel] ?? '', offset + channel * channelWidth + 6, 16); }
      });
      if (this.panelCount('events') > 1) { context.strokeStyle = '#333b45'; context.lineWidth = 2; context.beginPath(); context.moveTo(offset + panelWidth, 0); context.lineTo(offset + panelWidth, height); context.stroke(); }
    }
    const drag = this.eventInteraction.drag;
    if (drag?.kind === 'rectangle') {
      if (!this.marqueeOverlay) {
        context.fillStyle = '#ffcc4430'; context.strokeStyle = '#ffdd77';
        const start = this.rectangleStart(drag);
        context.fillRect(start.x, start.y, drag.current.x - start.x, drag.current.y - start.y);
        context.strokeRect(start.x, start.y, drag.current.x - start.x, drag.current.y - start.y);
      }
    } else if (drag?.kind === 'stroke') {
      context.strokeStyle = '#80ffff'; context.beginPath();
      drag.points.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y)); context.stroke();
    } else if (drag) {
      const deltaBeat = this.eventInteraction.delta();
      context.strokeStyle = '#fff'; context.setLineDash([5, 3]);
      for (const rectangle of this.eventRects) {
        const lineSelection = session.multiLineActive && session.multiLineMode === 'events' ? (session.multiEventSelection?.get(rectangle.lineIndex) ?? new Set()) : session.eventSelection;
        if (!lineSelection.has(eventKey(rectangle.type, rectangle.index))) continue;
        const event = session.multiLineActive && session.multiLineMode === 'events' ? eventListAt(session, rectangle.lineIndex, rectangle.type)[rectangle.index] : eventList(session, rectangle.type)[rectangle.index]; if (!event) continue;
        const vertical = session.multiLineActive && session.multiLineMode === 'events' ? beat => this.verticalForLine(beat, rectangle.lineIndex, height) : beat => this.eventVertical(beat, rectangle.type);
        const top = vertical(beatValue(event.endTime) + (drag.kind === 'startTime' ? 0 : deltaBeat));
        const bottom = vertical(beatValue(event.startTime) + (drag.kind === 'endTime' ? 0 : deltaBeat));
        context.strokeRect(rectangle.x, top, rectangle.width, bottom - top);
      }
      context.setLineDash([]);
    }
    context.globalAlpha = 1; context.lineWidth = 1;
    return true;
  }

  drawCurveGhost(context) {
    let ghost = [];
    try { ghost = this.curveGhost?.() ?? []; } catch { ghost = []; }
    if (ghost.length) {
      context.save(); context.globalAlpha = 0.95; context.strokeStyle = '#fff1a8'; context.fillStyle = NOTE_COLORS[ghost[0].type] ?? '#fff'; context.lineWidth = 2.5; context.setLineDash([6, 3]);
      context.beginPath();
      ghost.forEach((note, index) => {
        const horizontal = this.noteHorizontal(note.positionX); const vertical = this.vertical(beatValue(note.startTime));
        if (index === 0) context.moveTo(horizontal, vertical); else context.lineTo(horizontal, vertical);
      });
      context.stroke();
      context.setLineDash([]);
      for (const note of ghost) {
        if (note.anchor) continue;
        const horizontal = this.noteHorizontal(note.positionX); const vertical = this.vertical(beatValue(note.startTime));
        const width = 52 * this.renderNoteScale;
        const renderedHorizontal = this.clampNoteHorizontal(horizontal, width);
        if (renderedHorizontal == null) continue;
        context.fillRect(renderedHorizontal - width / 2, vertical - 5, width, 10); context.strokeRect(renderedHorizontal - width / 2 - 2, vertical - 7, width + 4, 14);
      }
      context.restore();
    }
  }

  drawEvents(playBeat) {
    this.syncMultiLineChrome('events', this.eventsCanvas.clientWidth);
    const { context, width, height } = prepareCanvas(this.eventsCanvas);
    const multiEvents = this.getSession().multiLineActive && this.getSession().multiLineMode === 'events';
    if (multiEvents) {
      if (this.panelCount('events') > 1) {
        const panelWidth = this.panelWidth(width, 'events'); const gap = this.panelGap(width, 'events'); const offset = this.multiLineViewportOffset(width, 'events');
        context.fillStyle = '#242424';
        for (let panel = 0; panel < this.panelCount('events') - 1; panel++) context.fillRect(panel * (panelWidth + gap) + panelWidth - offset, 0, gap, height);
      }
      this.drawMultiLineGrid(context, width, height, playBeat);
      this.drawMultiLineEvents(playBeat);
      drawClipboard(this, context, width, height, 'events');
      this.eventInteraction.draw(context, width);
      this.drawMultiLineBeatLabels(context, width, height, 'events');
      return;
    }
    this.grid(context, width, height, playBeat);
    drawClipboard(this, context, width, height, 'events');
    const session = this.getSession();
    const layer = (this.extended ? { ...session.line?.extended, paintEvents: eventList(session, 'paintEvents') } : session.line?.eventLayers?.[this.layer]) ?? {};
    const indexKey = `${session.lineIndex}:${this.extended}:${this.layer}`;
    if (this.indexedLayer !== session.chart || this.eventIndexKey !== indexKey) {
      this.indexedLayer = session.chart; this.eventIndexKey = indexKey;
      this.shaderLanes = shaderEventLanes(layer.paintEvents ?? []);
      this.eventIndexes = this.eventTypes.map(type => new IntervalIndex(layer[type] ?? [], event => beatValue(event.startTime), event => beatValue(event.endTime)));
      this.chains = this.eventTypes.map(type => eventChains(layer[type] ?? []));
      this.chainRanges = this.chains.map(groups => new Map(groups.flatMap(group => group.entries.map(entry => [entry.index, group]))));
    }
    this.eventRects = [];
    this.eventTypes.forEach((type, channel) => {
      const { channelWidth, x: barX, width: barWidth } = this.eventColumnBounds(channel, width);
      const horizontal = channel * channelWidth;
      context.strokeStyle = '#334154'; context.beginPath(); context.moveTo(horizontal, 0); context.lineTo(horizontal, height); context.stroke();
      const entries = this.eventIndexes[channel].query(this.eventBeatAt(height, type), this.eventBeatAt(0, type));
      if (type === 'paintEvents') {
        this.drawShaderEvents(context, entries, channel, width, height);
        context.fillStyle = '#303030'; context.fillRect(horizontal, 0, channelWidth, 23);
        context.fillStyle = '#f5f5f5'; context.font = '12px RPE, sans-serif'; context.fillText('着色器', horizontal + 6, 16);
        return;
      }
      const ranges = this.chainRanges[channel];
      const seamlessGroups = new Set();
      if (this.seamlessEvents) for (const group of new Set(entries.map(entry => ranges.get(entry.index)))) {
        if (!group || group.entries.length < 2) continue;
        const linkedSelection = group.entries.some(candidate => {
          const selected = this.getSession().eventSelection.has(eventKey(type, candidate.index));
          const bound = Number(candidate.event.linkgroup ?? 0) > 0;
          return selected || bound || isHookedEvent(candidate.event);
        });
        if (linkedSelection) continue;
        seamlessGroups.add(group);
        const first = group.entries[0].event; const last = group.entries.at(-1).event;
        const chainTop = Math.max(0, this.vertical(beatValue(last.endTime)));
        const chainBottom = Math.min(height, this.vertical(beatValue(first.startTime)));
        if (chainBottom <= chainTop) continue;
        context.globalAlpha = this.eventOpacity ?? 0.25;
        context.fillStyle = '#e58d24'; context.fillRect(barX, chainTop, barWidth, chainBottom - chainTop);
        context.globalAlpha = 1; context.strokeStyle = '#ffa334'; context.lineWidth = 1;
        context.strokeRect(barX, chainTop, barWidth, chainBottom - chainTop);
      }
      for (const entry of entries) {
        const vertical = this.vertical(entry.end);
        const bottom = this.vertical(entry.start);
        const rectangle = { x: barX, y: Math.max(0, vertical), width: barWidth, height: Math.max(2, Math.min(height, bottom) - Math.max(0, vertical)), index: entry.index, type };
        this.eventRects.push(rectangle);
        const selected = this.getSession().eventSelection.has(eventKey(type, entry.index));
        const hooked = isHookedEvent(entry.item);
        const chain = ranges.get(entry.index);
        const seamless = seamlessGroups.has(chain);
        context.globalAlpha = this.eventOpacity ?? 0.25;
        context.fillStyle = selected ? '#ffe091' : hooked ? '#62d8f2' : '#e58d24';
        if (!seamless) context.fillRect(rectangle.x, rectangle.y, rectangle.width, rectangle.height);
        context.strokeStyle = selected ? '#fff2bd' : hooked ? '#b8f2ff' : '#ffa334'; context.lineWidth = selected ? 2 : 1;
        if (hooked) context.setLineDash([4, 3]);
        if (!seamless) context.strokeRect(rectangle.x, rectangle.y, rectangle.width, rectangle.height);
        context.setLineDash([]);
        context.globalAlpha = 1;
        if (entry.item.trajectory) this.drawTrajectoryEvent(context, rectangle, entry.item);
        if (!entry.item.trajectory && channelWidth >= (this.eventCurveThreshold ?? 24)) {
          context.lineWidth = 2;
          context.save(); context.beginPath(); context.rect(rectangle.x, rectangle.y, rectangle.width, rectangle.height); context.clip();
          const group = ranges.get(entry.index);
          context.beginPath();
          for (let step = 0; step <= 36; step++) {
            const progress = step / 36; const event = entry.item;
            const amount = event.bezier ? bezier(progress, event.bezierPoints) : easing(progress, event.easingType, event.easingLeft ?? 0, event.easingRight ?? 1);
            const value = event.start + (event.end - event.start) * amount;
            const normalized = group.max - group.min > 0.01 ? (value - group.min) / (group.max - group.min) : 0.5;
            const horizontalValue = rectangle.x + 6 + normalized * (rectangle.width - 12); const verticalValue = bottom - progress * (bottom - vertical);
            if (step === 0) context.moveTo(horizontalValue, verticalValue); else context.lineTo(horizontalValue, verticalValue);
          } if (Number.isFinite(entry.item.start) && Number.isFinite(entry.item.end) && group.max - group.min > 0.01) context.stroke(); context.restore(); context.lineWidth = 1;
        }
      }
      const visibleGroups = new Set(entries.map(entry => ranges.get(entry.index)));
      const formatValue = value => typeof value === 'number' ? value.toFixed(2) : Array.isArray(value) ? value.join(',') : value;
       const valueThreshold = this.eventValueThreshold ?? 30;
       if (channelWidth >= valueThreshold) {
         context.font = `${this.eventValueFontSize ?? 13}px RPE, sans-serif`;
         for (const group of visibleGroups) {
           const first = group.entries[0].event; const last = group.entries.at(-1).event;
           const top = this.vertical(beatValue(last.endTime)); const bottom = this.vertical(beatValue(first.startTime));
           context.fillStyle = top < 23 ? '#80ffa0' : '#f6e5ce';
           context.textAlign = 'center';
           context.fillText(formatValue(Number.isFinite(group.max) ? group.max : last.end), horizontal + channelWidth / 2, Math.max(36, top + 13), channelWidth - 12);
           context.fillStyle = bottom > height ? '#ffe080' : '#f6e5ce';
           if (bottom - top > 26) context.fillText(formatValue(Number.isFinite(group.min) ? group.min : first.start), horizontal + channelWidth / 2, Math.min(height - 5, bottom - 5), channelWidth - 12);
           context.textAlign = 'left';
         }
       }
      context.fillStyle = '#303030'; context.fillRect(horizontal, 0, channelWidth, 23);
      context.fillStyle = '#f5f5f5'; context.fillText((this.extended ? extendedLabels : labels)[channel], horizontal + 6, 16);
    });
    const drag = this.eventInteraction.drag;
    if (drag?.kind === 'rectangle') {
      if (!this.marqueeOverlay) {
      context.fillStyle = '#ffcc4430'; context.strokeStyle = '#ffdd77';
      const start = this.rectangleStart(drag);
      context.fillRect(start.x, start.y, drag.current.x - start.x, drag.current.y - start.y);
      context.strokeRect(start.x, start.y, drag.current.x - start.x, drag.current.y - start.y);
      }
    } else if (drag?.kind === 'stroke') {
      context.strokeStyle = '#80ffff'; context.beginPath();
      drag.points.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y)); context.stroke();
    } else if (drag) {
      const deltaBeat = this.eventInteraction.delta();
      context.strokeStyle = '#fff'; context.setLineDash([5, 3]);
      for (const rectangle of this.eventRects) if (this.getSession().eventSelection.has(eventKey(rectangle.type, rectangle.index))) {
        const event = layer[rectangle.type][rectangle.index];
        const top = this.eventVertical(beatValue(event.endTime) + (drag.kind === 'startTime' ? 0 : deltaBeat), rectangle.type);
        const bottom = this.eventVertical(beatValue(event.startTime) + (drag.kind === 'endTime' ? 0 : deltaBeat), rectangle.type);
        const height = bottom - top;
        context.strokeRect(rectangle.x, top, rectangle.width, height);
      } context.setLineDash([]);
    }
    this.eventInteraction.draw(context, width);
  }

  drawTrajectoryEvent(context, rectangle, event) {
    const verticalAt = beat => this.getSession().multiLineActive && this.getSession().multiLineMode === 'events'
      ? this.verticalForLine(beat, rectangle.lineIndex, this.viewHeight()) : this.eventVertical(beat, 'moveXEvents');
    const startY = verticalAt(beatValue(event.startTime)); const endY = verticalAt(beatValue(event.endTime));
    context.save(); context.beginPath(); context.rect(rectangle.x, rectangle.y, rectangle.width, rectangle.height); context.clip();
    context.strokeStyle = '#83edca'; context.globalAlpha = 0.95; context.lineWidth = 2; context.strokeRect(rectangle.x, rectangle.y, rectangle.width, rectangle.height);
    context.fillStyle = '#a0ffdb'; context.font = '12px RPE, sans-serif'; context.textAlign = 'center'; context.fillText('轨迹 X / Y', rectangle.x + rectangle.width / 2, rectangle.y + 30, Math.max(1, rectangle.width - 4));
    if (rectangle.width > 20 && rectangle.height > 42) {
      for (const [axis, color] of [['x', '#86efbf'], ['y', '#baacff']]) {
        const samples = Array.from({ length: 65 }, (unused, index) => trajectoryEventValue(event, index / 64, axis));
        const minimum = Math.min(...samples); const maximum = Math.max(...samples); context.strokeStyle = color; context.beginPath();
        samples.forEach((value, index) => { const horizontal = rectangle.x + 5 + (value - minimum) / (maximum - minimum || 1) * (rectangle.width - 10); const vertical = startY + index / 64 * (endY - startY); if (index) context.lineTo(horizontal, vertical); else context.moveTo(horizontal, vertical); }); context.stroke();
      }
    }
    context.restore();
  }

  drawShaderEvents(context, entries, channel, width, height) {
    const bounds = this.eventColumnBounds(channel, width);
    for (const entry of entries) {
      const placement = this.shaderLanes.get(entry.index);
      const laneWidth = bounds.width / placement.count;
      const name = shaderIdentity(entry.item);
      const top = Math.max(23, this.eventVertical(entry.end, 'paintEvents'));
      const bottom = Math.min(height, this.eventVertical(entry.start, 'paintEvents'));
      if (bottom < top) continue;
      const rectangle = { x: bounds.x + placement.lane * laneWidth, y: top, width: Math.max(2, laneWidth - (placement.count > 1 ? 2 : 0)), height: Math.max(2, bottom - top), index: entry.index, type: 'paintEvents' };
      this.eventRects.push(rectangle);
      const selected = this.getSession().eventSelection.has(eventKey('paintEvents', entry.index));
      context.save();
      context.globalAlpha = this.eventOpacity ?? 0.25; context.fillStyle = selected ? '#98ffbd' : '#c6a1ff';
      context.fillRect(rectangle.x, top, rectangle.width, rectangle.height);
      context.globalAlpha = 1; context.strokeStyle = selected ? '#98ffbd' : '#c6a1ff'; context.lineWidth = selected ? 2 : 1;
      context.strokeRect(rectangle.x, top, rectangle.width, rectangle.height);
      context.beginPath(); context.rect(rectangle.x, top, rectangle.width, rectangle.height); context.clip();
      context.fillStyle = '#efe5ff'; context.font = `${this.eventValueFontSize ?? 13}px RPE, sans-serif`; context.textAlign = 'center';
      context.fillText(name, rectangle.x + rectangle.width / 2, top + 16, rectangle.width - 4);
      if (rectangle.height > 40) context.fillText(`#${entry.item.order ?? 0}${entry.item.global ? ' · UI' : ''}`, rectangle.x + rectangle.width / 2, top + 33, rectangle.width - 4);
      context.restore();
    }
  }
}
