import { beatValue, fromNumber } from '../core/beat.mjs';
import { IntervalIndex } from '../core/interval-index.mjs';
import { noteIsAbove, EVENT_TYPES, EXTENDED_TYPES } from '../core/chart.mjs';
import { eventKey, eventList, eventListAt } from '../application/event-commands.mjs';
import { shaderIdentity, shaderEventLanes } from '../core/shader-events.mjs';
import { EventInteraction } from './event-interaction.mjs';
import { drawClipboard } from './clipboard-preview.mjs';
import { TempoMap } from '../core/tempo.mjs';
import { snapPosition, snapTime, verticalGrid, placementRange } from '../core/edit-grid.mjs';
import { SPECIAL_TRACKS, simultaneousNotes, strokeIntersects } from '../core/editor-display.mjs';
import { captureSelection, editCapturedSelection, commitSelectionEdit } from '../application/batch-edit.mjs';
import { lineDisplayLabel } from '../core/line-groups.mjs';
import { trajectoryEventValue } from '../core/curve-trajectory.mjs';
import { editorSkinContext } from './editor-skin-canvas.mjs';
import { drawEditorJudgement, editorJudgementWidth } from './editor-judgement.mjs';
import { drawEventCurve, drawEventCurveBatch } from './event-curve.mjs';
import { eventDisplayIndex, selectedEventGroups } from './event-display-index.mjs';
import { intervalSelection, extendIntervalSelection } from '../core/selection-interval.mjs';
import { t } from '../i18n.mjs';
import { DEFAULT_EDITOR_PREFERENCES } from '../core/default-settings.mjs';

export const NOTE_COLORS = { 1: '#8acbff', 2: '#8acbff', 3: '#f596ac', 4: '#f1ce76' };
const isHookedEvent = event => event?.inst === true || Number(event?.inst) === 1;
const sameNoteGeometry = (left, right) => left && right && left.positionX === right.positionX && beatValue(left.startTime) === beatValue(right.startTime) && beatValue(left.endTime) === beatValue(right.endTime);
// Resolved per frame so the columns follow the active language.
const labels = () => ['X', 'Y', t('timeline.sa69e51e'), t('timeline.sb1a302e'), t('timeline.sf2fdffb')];
const extendedLabels = () => SPECIAL_TRACKS.map(track => track.label);

export function prepareCanvas(canvas, rectangle = canvas.getBoundingClientRect()) {
  const ratio = globalThis.devicePixelRatio || 1;
  const width = Math.round(rectangle.width * ratio);
  const height = Math.round(rectangle.height * ratio);
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  const context = canvas.getContext('2d');
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, rectangle.width, rectangle.height);
  return { context: editorSkinContext(context), width: rectangle.width, height: rectangle.height };
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
    this.selectionInterval = 1;
    this.rpeEventDrag = false;
    this.eventEndpointDragHeld = false;
    for (const canvas of [notesCanvas, eventsCanvas]) {
      canvas.addEventListener('wheel', event => {
        event.preventDefault();
        this.onWheel(event);
        changed();
      }, { passive: false });
      canvas.addEventListener('contextmenu', event => { event.preventDefault(); if (canvas === this.eventsCanvas && this.eventInteraction.consumeContextMenu()) { event.stopImmediatePropagation?.(); return; } this.onContextMenu(event, canvas); });
    }
    notesCanvas.addEventListener('pointermove', event => this.move(event));
    notesCanvas.addEventListener('pointerleave', () => { if (!this.drag) this.cursor = null; this.onNoteHover?.(null); changed(); });
    notesCanvas.addEventListener('pointerdown', event => this.down(event));
    notesCanvas.addEventListener('pointerup', event => this.up(event));
    notesCanvas.addEventListener('pointercancel', () => { const tracing = this.drag?.kind === 'stroke' && this.drag.tracing; this.drag = null; if (tracing) this.getSession().notify(); changed(); });
  }

  point(event, canvas = this.notesCanvas) {
    if (canvas === this.notesCanvas && this.noteView) return this.noteView.point(event);
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
    if (this.noteView?.flow && drag.area !== 'events') return { x: drag.start.x, y: this.vertical(this.tempo.beat(drag.startSeconds, factor), height, drag.side) };
    return { x: drag.startWorldX === undefined ? drag.start.x : drag.startWorldX - scroll, y: drag.startSeconds === undefined ? drag.start.y : this.baseline(height) - (drag.startSeconds - this.tempo.seconds(this.origin, factor)) * this.scale };
  }

  rectangleTimes(drag) {
    const factor = drag.startFactor ?? this.factor;
    const start = drag.startSeconds ?? this.timeAt(drag.start.y);
    const current = drag.currentSeconds ?? (this.noteView?.flow ? this.timeAt(drag.current.y) : this.tempo.seconds(this.origin, factor) + (this.baseline() - drag.current.y) / this.scale);
    return [this.tempo.beat(Math.min(start, current), factor) - 1e-8, this.tempo.beat(Math.max(start, current), factor) + 1e-8];
  }

  updateRectangle(event) {
    const selection = this.rectangleSelection(); if (!selection) return;
    selection.drag.current = this.point(event, selection.canvas);
    selection.drag.currentWorldX = selection.drag.current.x + this.multiLineViewportOffset(selection.canvas.clientWidth, selection.area);
    if (selection.drag.startFactor !== undefined) selection.drag.currentSeconds = this.noteView?.flow && selection.area === 'notes' ? this.timeAt(selection.drag.current.y) : this.tempo.seconds(this.origin, selection.drag.startFactor) + (this.baseline() - selection.drag.current.y) / this.scale;
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
    return { channelWidth, left: channel * channelWidth, x: channel * channelWidth + (channelWidth - barWidth) / 2, width: barWidth };
  }

  get factor() { return this.getSession().line?.bpmfactor ?? 1; }
  baseline(height = this.viewHeight()) { return this.noteView ? this.noteView.baseline + height - this.notesCanvas.clientHeight : height - this.judgementOffset; }
  viewHeight() { return this.getSession().multiLineActive && this.getSession().multiLineMode === 'events' ? this.eventsCanvas.clientHeight : this.notesCanvas.clientHeight; }
  factorForLine(lineIndex) { return this.getSession().chart.judgeLineList?.[lineIndex]?.bpmfactor ?? 1; }
  verticalForLine(beat, lineIndex, height = this.viewHeight(), side = 1) { if (this.noteView?.vertical) return this.vertical(beat, height, side); const factor = this.factorForLine(lineIndex); return this.baseline(height) - (this.tempo.seconds(beat, factor) - this.tempo.seconds(this.origin, factor)) * this.scale; }
  beatRangeForLine(lineIndex, height = this.viewHeight()) {
    if (this.noteView?.beatRange) return this.noteView.beatRange(height);
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
  timeAt(vertical, side) { return this.noteView?.timeAt ? this.noteView.timeAt(vertical, side) : this.tempo.seconds(this.origin, this.factor) + (this.baseline() - vertical) / this.scale; }
  beatAt(vertical) { return this.tempo.beat(this.timeAt(vertical), this.factor); }
  snappedBeat(vertical) { return beatValue(snapTime(this.timeAt(vertical), this.division, this.tempo, this.factor)); }
  vertical(beat, height = this.viewHeight(), side = 1) { return this.noteView?.vertical ? this.noteView.vertical(beat, side) + height - this.notesCanvas.clientHeight : this.baseline(height) - (this.tempo.seconds(beat, this.factor) - this.tempo.seconds(this.origin, this.factor)) * this.scale; }
  noteVertical(note, endpoint = 'startTime', lineIndex = this.getSession().lineIndex, height = this.viewHeight()) {
    return this.noteView?.noteVertical ? this.noteView.noteVertical(note, endpoint) + height - this.notesCanvas.clientHeight : this.verticalForLine(beatValue(note[endpoint]), lineIndex, height);
  }
  clipNoteSide(context, side, width, height) {
    const edge = Math.max(0, Math.min(height, this.baseline(height)));
    context.beginPath(); context.rect(0, side > 0 ? 0 : edge, width, side > 0 ? edge : height - edge); context.clip();
  }
  eventVertical(beat, type) { return this.vertical(beat); }
  eventBeatAt(vertical, type, snap = false) {
    const factor = this.factor;
    return snap ? beatValue(snapTime(this.timeAt(vertical), this.division, this.tempo, factor)) : this.tempo.beat(this.timeAt(vertical), factor);
  }
  get referenceNoteScale() {
    if (this.noteView) return this.noteView.renderScale;
    const width = this.panelWidth(this.notesCanvas.clientWidth, 'notes');
    return this.noteScale * width / 1350 * 175 / 68;
  }
  get renderNoteScale() {
    return this.referenceNoteScale * (this.notesOnly && !this.noteView && !this.getSession().multiLineActive ? this.notesOnlyNoteScale ?? DEFAULT_EDITOR_PREFERENCES.notesOnlyNoteScale : 1);
  }
  horizontal(position) { return this.noteHorizontal(position); }
  noteInset(width = this.panelWidth(this.notesCanvas.clientWidth, 'notes')) { return Math.min(48 * this.referenceNoteScale, Math.max(0, width / 2 - 1)); }
  noteBaseWidth(note) { return 68 * this.renderNoteScale * Math.abs(note.size ?? 1); }
  noteWidth(note, highlight = this.highlight !== false && this.simultaneous?.has(note)) { return this.noteBaseWidth(note) * (this.skin?.noteScale?.(highlight) ?? 1); }
  diagnosticNoteBounds(note, lineIndex = this.getSession().lineIndex) {
    const head = this.noteVertical(note, 'startTime', lineIndex), tail = this.noteVertical(note, 'endTime', lineIndex), width = Math.max(12, this.noteWidth(note));
    const image = this.skin?.noteImage?.(note.type, this.highlight !== false && this.simultaneous?.has(note));
    const height = Math.max(12, image ? 68 * this.renderNoteScale * (image.naturalHeight ?? image.height) / (image.naturalWidth ?? image.width) : 8 * this.renderNoteScale);
    return { canvas: this.notesCanvas, x: this.noteHorizontal(note.positionX, lineIndex) - width / 2, y: Math.min(head, tail) - height / 2, width, height: Math.abs(tail - head) + height };
  }
  diagnosticEventBounds(type, event, lineIndex = this.getSession().lineIndex) {
    const channel = this.eventTypes.indexOf(type); if (channel < 0) return null;
    const width = this.panelWidth(this.eventsCanvas.clientWidth, 'events'), bounds = this.eventColumnBounds(channel, width);
    const y = beat => this.getSession().multiLineActive ? this.verticalForLine(beat, lineIndex, this.eventsCanvas.clientHeight) : this.eventVertical(beat, type);
    const head = y(beatValue(event.startTime)), tail = y(beatValue(event.endTime));
    return { canvas: this.eventsCanvas, x: this.panelHorizontal(bounds.x, lineIndex, this.eventsCanvas.clientWidth, 'events'), y: Math.min(head, tail) - 2, width: bounds.width, height: Math.max(8, Math.abs(tail - head) + 4) };
  }
  snapXPosition(value) {
    if (!this.snapX) return value;
    return snapPosition(value, this.gridCount);
  }
  horizontalScale() { const width = this.panelWidth(this.notesCanvas.clientWidth, 'notes'); return this.noteView?.pixelsPerUnit ?? Math.max(1, width - this.noteInset(width) * 2) / 1350 * 1.15 * (this.noteSpacing ?? 1); }
  noteHorizontal(position, lineIndex = this.getSession().lineIndex) {
    if (this.noteView) return this.noteView.originX + position * this.noteView.pixelsPerUnit;
    const panelWidth = this.panelWidth(this.notesCanvas.clientWidth, 'notes');
    return this.panelHorizontal(panelWidth / 2 + (position - (this.cameraX ?? 0)) * this.horizontalScale(), lineIndex, this.notesCanvas.clientWidth, 'notes');
  }
  positionAt(horizontal) {
    return this.notePositionAt(horizontal);
  }
  notePositionAt(horizontal, lineIndex = this.lineIndexAt(horizontal, this.notesCanvas.clientWidth, 'notes')) {
    if (this.noteView) return this.snapXPosition((horizontal - this.noteView.originX) / this.noteView.pixelsPerUnit);
    const panelWidth = this.panelWidth(this.notesCanvas.clientWidth, 'notes'); const panel = this.panelIndex(lineIndex, 'notes');
    const local = horizontal + this.multiLineViewportOffset(this.notesCanvas.clientWidth, 'notes') - panel * this.panelStride(this.notesCanvas.clientWidth, 'notes');
    const value = (local - panelWidth / 2) / this.horizontalScale() + (this.cameraX ?? 0);
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
    const lines = this.panelCount(area) === 1 ? [{ index: session.targetLineIndices[0], text: session.multiLineMerge && area === 'notes' ? t('timeline.s8137e64', { p0: session.targetLineIndices.map(index => lineDisplayLabel(session.chart, index)).join(' / ') }) : session.targetLineIndices.map(index => lineDisplayLabel(session.chart, index)).join(' · ') }] : session.targetLineIndices.map(index => ({ index, text: lineDisplayLabel(session.chart, index) }));
    for (const [panel, line] of lines.entries()) { const label = document.createElement('span'); label.textContent = line.text; label.style.width = `${panelWidth}px`; label.style.transform = `translateX(${panel * stride - offset}px)`; this.multiLineLabels.append(label); }
  }

  cancelPlacement() { this.pendingHold = null; this.eventInteraction.pending = null; this.drag = null; this.eventInteraction.drag = null; this.changed(); }

  previewNotes() {
    if (this.bulkPreview || !['move', 'startTime', 'endTime'].includes(this.drag?.kind)) { this.noteDragPreview = null; return null; }
    const session = this.getSession(), drag = this.drag;
    const key = [drag, session.chart, session.selection, session.selection.size, session.multiLineSelection, session.multiLineActive, session.lineIndex,
      drag.current.x, drag.current.y, this.origin, this.scale, this.division, this.gridCount, this.snapX, this.noteView?.currentDistance, this.noteView?.pixelsPerDistance];
    const cached = this.noteDragPreview;
    if (cached && key.every((value, index) => value === cached.key[index])) return cached.value;
    const previous = cached?.chart === session.chart ? cached.value : null, lines = new Map();
    let unchanged = Boolean(previous);
    for (const { lineIndex, index, note } of session.selectedNoteEntries()) {
      const moved = this.movedNote(note); if (sameNoteGeometry(moved, note)) continue;
      const old = previous?.get(lineIndex)?.get(index), value = sameNoteGeometry(old, moved) ? old : moved;
      if (value !== old) unchanged = false;
      if (!lines.has(lineIndex)) lines.set(lineIndex, new Map());
      lines.get(lineIndex).set(index, value);
    }
    if (previous?.size !== lines.size || [...lines].some(([index, notes]) => previous?.get(index)?.size !== notes.size)) unchanged = false;
    const value = unchanged ? previous : lines.size ? lines : null;
    this.noteDragPreview = { key, chart: session.chart, value }; return value;
  }

  movedNote(note) {
    if (!['move', 'startTime', 'endTime'].includes(this.drag?.kind)) return note;
    if (Math.hypot(this.drag.current.x - this.drag.start.x, this.drag.current.y - this.drag.start.y) <= 4 && !this.drag.scrolled) return note;
    const lineIndex = Number.isInteger(this.drag.lineIndex) ? this.drag.lineIndex : this.getSession().lineIndex;
    const anchor = this.getSession().chart.judgeLineList?.[lineIndex]?.notes?.[this.drag.anchor];
    if (!anchor || !Number.isFinite(anchor.positionX)) return note;
    const factor = this.factorForLine(lineIndex);
    const key = this.drag.kind === 'endTime' ? 'endTime' : 'startTime';
    const scroll = this.tempo.seconds(this.origin, factor) - (this.drag.originSeconds ?? this.tempo.seconds(this.origin, factor));
    const seconds = this.noteView?.flow && Number.isFinite(this.drag.distanceOffset)
      ? this.tempo.seconds(this.noteView.beatAtDistance(this.noteView.pointerDistance(this.drag.current.y, this.drag.side) + this.drag.distanceOffset), factor)
      : this.tempo.seconds(anchor[key], factor) + (this.drag.start.y - this.drag.current.y) / this.scale + scroll;
    const deltaBeat = beatValue(snapTime(seconds, this.division, this.tempo, factor)) - beatValue(anchor[key]);
    if (this.drag.kind !== 'move') {
      if (note.type !== 2) return note;
      const value = this.drag.kind === 'endTime' ? Math.max(beatValue(note.startTime), beatValue(note.endTime) + deltaBeat) : Math.max(0, Math.min(beatValue(note.endTime), beatValue(note.startTime) + deltaBeat));
      return { ...note, [key]: fromNumber(value) };
    }
    const rawDeltaX = (this.drag.current.x - this.drag.start.x) / this.horizontalScale();
    const deltaX = this.snapXPosition(anchor.positionX + rawDeltaX) - anchor.positionX;
    const boundedBeat = Math.max(-beatValue(note.startTime), deltaBeat);
    return { ...note, positionX: note.positionX + deltaX, startTime: fromNumber(beatValue(note.startTime) + boundedBeat), endTime: fromNumber(beatValue(note.endTime) + boundedBeat) };
  }

  autoScroll(elapsed) {
    const drag = this.drag ?? this.eventInteraction.drag;
    if (!drag || !['move', 'startTime', 'endTime'].includes(drag.kind)) return;
    if (drag.endpoint && !this.eventEndpointDragHeld) return;
    const height = this.viewHeight();
    const overflow = drag.current.y < 0 ? -drag.current.y : drag.current.y > height ? height - drag.current.y : 0;
    if (!overflow) return;
    if (this.noteView?.flow && !((drag.side > 0 && drag.current.y < 0) || (drag.side < 0 && drag.current.y > height))) return;
    drag.scrolled = true;
    const scale = this.noteView?.flow ? Math.max(24, Math.abs(this.noteView.vertical(this.origin + 1) - this.noteView.vertical(this.origin)) / Math.max(.001, this.tempo.seconds(this.origin + 1, this.factor) - this.tempo.seconds(this.origin, this.factor))) : this.scale;
    this.onDragScroll?.((this.noteView?.flow ? 1 : Math.sign(overflow)) * Math.min(900, 120 + Math.abs(overflow) * 4) / scale * Math.min(0.05, elapsed));
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
      if (this.noteView?.flow && this.noteView.sideAt(position.y) !== (noteIsAbove(entry.item) ? 1 : -1)) return false;
      const head = this.noteVertical(entry.item, 'startTime', lineIndex), tail = this.noteVertical(entry.item, 'endTime', lineIndex);
      return this.clampNoteHorizontal(horizontal, this.noteWidth(entry.item), this.notesCanvas.clientWidth, lineIndex) !== null
        && Math.abs(horizontal - position.x) <= this.noteWidth(entry.item) / 2
        && position.y >= Math.min(head, tail) - 9
        && position.y <= Math.max(head, tail) + 9;
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
      if (this.drag.startFactor !== undefined) this.drag.currentSeconds = this.noteView?.flow ? this.timeAt(this.drag.current.y) : this.tempo.seconds(this.origin, this.drag.startFactor) + (this.baseline() - this.drag.current.y) / this.scale;
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
        const candidates = [];
        for (const entry of this.visible(this.cursorLineIndex)) if (strokeIntersects(previous, this.cursor, {
          left: this.noteHorizontal(entry.item.positionX, this.cursorLineIndex) - this.noteWidth(entry.item) / 2, right: this.noteHorizontal(entry.item.positionX, this.cursorLineIndex) + this.noteWidth(entry.item) / 2,
          top: Math.min(this.noteVertical(entry.item), this.noteVertical(entry.item, 'endTime')) - 7, bottom: Math.max(this.noteVertical(entry.item), this.noteVertical(entry.item, 'endTime')) + 7,
        })) candidates.push({ key: entry.index, start: beatValue(entry.item.startTime) });
        extendIntervalSelection(this.drag, candidates, this.getSession().selection, this.selectionInterval);
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
      const side = noteIsAbove(hit.item) ? 1 : -1;
      const hitVertical = beat => this.noteView?.flow ? this.vertical(beat, this.notesCanvas.clientHeight, side) : session.multiLineActive ? this.verticalForLine(beat, hit.lineIndex, this.notesCanvas.clientHeight) : this.vertical(beat);
      const kind = hit.item.type === 2 && Math.abs(position.y - hitVertical(hit.end)) <= 8 ? 'endTime' : hit.item.type === 2 && Math.abs(position.y - hitVertical(hit.start)) <= 8 ? 'startTime' : 'move';
      this.drag = { kind, start: position, current: position, anchor: hit.index, lineIndex: hit.lineIndex, originSeconds: this.tempo.seconds(this.origin, this.factorForLine(hit.lineIndex ?? session.lineIndex)) };
      if (this.noteView?.flow) { this.drag.side = side; this.drag.distanceOffset = this.noteView.distanceAt(hit.item[kind === 'endTime' ? 'endTime' : 'startTime']) - this.noteView.pointerDistance(position.y, side); }
      session.notify();
    } else if (!multiMode) { this.drag = { kind: 'stroke', start: position, current: position, points: [position], remove: event.button === 2 }; session.notify(); }
    if (this.drag?.kind === 'rectangle' && this.noteView?.flow) this.drag.side = this.noteView.sideAt(position.y);
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
    if (drag.startFactor !== undefined) drag.currentSeconds = this.noteView?.flow ? this.timeAt(drag.current.y) : this.tempo.seconds(this.origin, drag.startFactor) + (this.baseline() - drag.current.y) / this.scale;
    const session = this.getSession();
    if (drag.kind === 'rectangle') {
      if (!drag.finished) { this.changed(); return; }
      const left = Math.min(drag.startWorldX ?? drag.start.x, drag.currentWorldX ?? drag.current.x);
      const right = Math.max(drag.startWorldX ?? drag.start.x, drag.currentWorldX ?? drag.current.x);
      const [bottom, top] = this.rectangleTimes(drag);
      if (!drag.append) session.selection.clear();
      const lineIndices = session.multiLineActive && session.multiLineMode === 'notes' ? session.targetLineIndices : [session.lineIndex];
      const candidates = [];
      for (const lineIndex of lineIndices) {
        this.refreshIndex(lineIndex);
        const noteIndex = this.noteIndexes.get(lineIndex)?.index;
        if (!noteIndex) continue;
        const selected = session.multiLineActive && session.multiLineMode === 'notes'
          ? new Set(session.multiLineSelection?.get(lineIndex) ?? []) : session.selection;
        const range = this.noteView?.flow ? this.beatRangeForLine(lineIndex) : [bottom, top];
        for (const entry of noteIndex.query(...range)) {
          const horizontal = this.noteHorizontal(entry.item.positionX, lineIndex) + this.multiLineViewportOffset(this.notesCanvas.clientWidth, 'notes');
          if (this.noteView?.flow) {
            const y1 = this.noteVertical(entry.item), y2 = this.noteVertical(entry.item, 'endTime'), start = this.rectangleStart(drag);
            if (Math.max(y1, y2) < Math.min(start.y, drag.current.y) || Math.min(y1, y2) > Math.max(start.y, drag.current.y)) continue;
          }
          if (horizontal >= left && horizontal <= right) candidates.push({ key: entry.index, start: beatValue(entry.item.startTime), selected: drag.remove ? !selected.has(entry.index) : selected.has(entry.index), selection: selected });
        }
        if (session.multiLineActive && session.multiLineMode === 'notes') session.multiLineSelection?.set(lineIndex, selected);
      }
      for (const entry of intervalSelection(candidates, this.selectionInterval)) drag.remove ? entry.selection.delete(entry.key) : entry.selection.add(entry.key);
      if (session.multiLineActive && session.multiLineMode === 'notes') session.selection = new Set(session.multiLineSelection?.get(session.lineIndex) ?? []);
      session.notify();
    } else if (['move', 'startTime', 'endTime'].includes(drag.kind) && (drag.scrolled || Math.hypot(drag.current.x - drag.start.x, drag.current.y - drag.start.y) > 4)) {
      if (session.multiLineActive && session.multiLineMode === 'notes') {
        const snapshot = captureSelection(session);
        const result = editCapturedSelection(snapshot, { note: item => this.movedNote(item) });
        this.drag = null;
        commitSelectionEdit(session, result, drag.kind === 'move' ? t('timeline.s26c47ee') : t('timeline.se10e84d'));
      } else {
        const replacements = new Map([...session.selection].map(index => [session.notes[index], this.movedNote(session.notes[index])]));
        this.drag = null;
        session.transformSelection(drag.kind === 'move' ? t('timeline.s26c47ee') : t('timeline.se10e84d'), note => replacements.get(note));
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
    const side = this.noteView?.flow ? this.pendingHold?.side ?? this.noteView.sideAt(this.cursor.y) : 1;
    const beat = this.noteView?.flow ? beatValue(snapTime(this.timeAt(this.cursor.y, side), this.division, this.tempo, this.factor)) : this.snappedBeat(this.cursor.y);
    const placedNote = (type, start, x, end) => ({ ...session.createNote(type, start, x, end), ...(this.noteView?.flow ? { above: side > 0 ? 1 : type === 2 ? 0 : 2 } : {}) });
    if (type === 2) {
      const lineIndex = this.cursorLineIndex ?? this.lineIndexAt(this.cursor.x, this.notesCanvas.clientWidth, 'notes');
      const positionX = this.notePositionAt(this.cursor.x, lineIndex);
      if (!Number.isFinite(positionX)) return false;
      if (!this.pendingHold) this.pendingHold = { beat, positionX, lineIndex, side };
      else {
        const range = placementRange(fromNumber(this.pendingHold.beat), fromNumber(beat));
        if (range && Number.isFinite(this.pendingHold.positionX)) session.insertNotesAt(this.pendingHold.lineIndex, [placedNote(2, range.start, this.pendingHold.positionX, range.end)]);
        this.pendingHold = null;
      }
      this.changed();
    } else {
      const lineIndex = this.cursorLineIndex ?? session.lineIndex;
      const positionX = this.notePositionAt(this.cursor.x, lineIndex);
      if (!Number.isFinite(positionX)) return false;
      session.insertNotesAt(lineIndex, [placedNote(type, beat, positionX)]);
    }
    return true;
  }

  grid(context, width, height, playBeat) {
    const range = this.noteView?.flow ? this.noteView.beatRange(height) : null;
    const first = Math.floor((range ? range[0] : this.beatAt(height)) * this.division);
    const last = Math.ceil((range ? range[1] : this.beatAt(0)) * this.division);
    const localBeatHeight = Math.abs(this.vertical(this.origin + 1) - this.vertical(this.origin));
    const stride = Math.max(1, Math.ceil(6 * this.division / Math.max(.001, localBeatHeight)), range ? Math.ceil((last - first) / Math.max(16, height / 6)) : 1);
    context.font = '12px RPE, sans-serif';
    context.lineWidth = Math.max(0.5, (this.barWidth ?? 3) * 2 * (this.gridReferenceWidth ?? width) / 1920);
    for (let tick = first; tick <= last; tick += stride) {
      const beat = tick / this.division;
      const major = tick % this.division === 0;
      context.strokeStyle = `rgba(${major ? '0,255,255' : '255,255,0'},${Math.min(1, (this.barAlpha ?? 1) * (major ? 0.9 : tick % 2 === 0 ? 0.6 : 0.4))})`;
      for (const side of range ? [1, -1] : [1]) {
        if (range && beat < this.origin - 1e-8) continue;
        const vertical = this.vertical(beat, height, side); if (range && (vertical < 0 || vertical > height)) continue;
        context.beginPath(); context.moveTo(0, vertical); context.lineTo(width, vertical); context.stroke();
        if (major) { context.fillStyle = '#dddddd'; context.fillText(String(beat), 5, vertical - 4); }
      }
    }
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
    context.restore(); context.lineWidth = 1;
  }

  judgementSegments(width, height, playBeat, area) {
    const session = this.getSession();
    if (!session.multiLineActive || session.multiLineMode !== area || this.panelCount(area) < 2) return [{ left: 0, right: width, y: this.vertical(playBeat, height) }];
    const panelWidth = this.panelWidth(width, area), stride = this.panelStride(width, area), offset = this.multiLineViewportOffset(width, area);
    const seconds = this.tempo.seconds(playBeat, this.factor);
    return session.targetLineIndices.map((lineIndex, panel) => ({ left: panel * stride - offset, right: panel * stride - offset + panelWidth,
      y: this.verticalForLine(this.tempo.beat(seconds, this.factorForLine(lineIndex)), lineIndex, height) }));
  }

  drawJudgement(context, width, height, playBeat, area) {
    const referenceWidth = this.gridReferenceWidth ?? this.panelWidth(width, area);
    drawEditorJudgement(context, this.judgementSegments(width, height, playBeat, area), this.judgementColor ?? '#ffffff', editorJudgementWidth(this, referenceWidth), this.judgementAlpha);
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
    const { context, width, height } = prepareCanvas(this.notesCanvas, this.noteView ? { width: this.notesCanvas.clientWidth, height: this.notesCanvas.clientHeight } : undefined);
    if (this.noteView?.flow) {
      context.save(); context.globalAlpha = this.noteView.panelOpacity; context.fillStyle = '#20262e'; context.fillRect(0, 0, width, height);
    }
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
    const halfRange = this.panelWidth(width, 'notes') / 2 / this.horizontalScale();
    const startX = this.noteView ? -this.noteView.originX / this.noteView.pixelsPerUnit : cameraX - halfRange;
    const endX = this.noteView ? (width - this.noteView.originX) / this.noteView.pixelsPerUnit : cameraX + halfRange;
    const firstGrid = Math.ceil(startX / grid.spacing - grid.first);
    const lastGrid = Math.floor(endX / grid.spacing - grid.first);
    const lanes = new Set();
    for (let index = firstGrid; index <= lastGrid; index++) lanes.add((index + grid.first) * grid.spacing);
    for (const reference of [-extent, 0, extent]) if (reference >= startX && reference <= endX) lanes.add(reference);
    for (const lineIndex of this.getSession().targetLineIndices.slice(0, this.panelCount('notes'))) {
      for (const lane of lanes) {
        const center = Math.abs(lane) < 1e-7;
        const boundary = Math.abs(Math.abs(lane) - extent) < 1e-7;
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
    if (this.noteView?.flow) context.restore();
    this.drawJudgement(context, width, height, playBeat, 'notes');
    if (this.highlightChart !== session.chart || this.highlightTempo !== this.tempo) {
      this.highlightChart = session.chart; this.highlightTempo = this.tempo; this.simultaneous = simultaneousNotes(session.chart, this.tempo);
    }
    if (this.getSession().multiLineActive && this.getSession().multiLineMode === 'notes') this.drawMultiLineNotes(context, width, height);
    this.drawCurveGhost(context);
    drawClipboard(this, context, width, height, 'notes');

    const entries = new Map(this.visible().map(entry => [entry.index, entry]));
    if (!multiNotes && ['move', 'startTime', 'endTime'].includes(this.drag?.kind)) for (const index of session.selection) entries.set(index, { item: session.notes[index], index });
    const orderedEntries = multiNotes ? [] : [...entries.values()].sort((left, right) => Number(right.item.type === 2) - Number(left.item.type === 2));
    const direct = Boolean(this.noteView?.flow), draft = direct ? this.previewNotes()?.get(session.lineIndex) : null;
    if (direct) {
      for (const entry of orderedEntries) entry.note = draft?.get(entry.index) ?? entry.item;
      this.noteView.connections?.(context, orderedEntries);
    }
    for (const side of direct ? [1, -1] : [0]) {
      if (direct) { context.save(); this.clipNoteSide(context, side, width, height); }
      for (const entry of orderedEntries) {
        const selected = session.selection.has(entry.index);
        const note = direct ? entry.note : selected ? this.movedNote(entry.item) : entry.item;
        if (direct && side !== (noteIsAbove(note) ? 1 : -1)) continue;
        const horizontal = this.noteHorizontal(note.positionX);
        const vertical = this.noteVertical(note);
        const endVertical = this.noteVertical(note, 'endTime');
        const highlight = this.highlight !== false && this.simultaneous.has(entry.item);
        const noteWidth = this.noteWidth(note, highlight), baseWidth = this.noteBaseWidth(note);
        const renderedHorizontal = this.clampNoteHorizontal(horizontal, noteWidth, width);
        if (renderedHorizontal == null) continue;
        context.globalAlpha = note.isFake ? 0.45 : noteIsAbove(note) ? 1 : 0.7;
        context.fillStyle = NOTE_COLORS[note.type];
        const textured = note.type === 2 ? this.skin?.hold(context, renderedHorizontal, vertical, endVertical, baseWidth, highlight, true, note.tint ?? note.color, 68 * this.renderNoteScale, direct ? side : 1) : this.skin?.head(context, note.type, renderedHorizontal, vertical, baseWidth, highlight, note.tint ?? note.color, 5 * this.renderNoteScale, 68 * this.renderNoteScale);
        if (!textured && note.type === 2) {
          context.globalAlpha *= 0.45;
          const top = Math.max(-10, Math.min(vertical, endVertical)), bottom = Math.min(height + 10, Math.max(vertical, endVertical));
          context.fillRect(renderedHorizontal - noteWidth / 2, top, noteWidth, Math.max(0, bottom - top));
          context.globalAlpha = 1;
          context.fillRect(renderedHorizontal - noteWidth / 2, endVertical - 3 * this.renderNoteScale, noteWidth, 6 * this.renderNoteScale);
        }
        if (!textured) context.fillRect(renderedHorizontal - noteWidth / 2, vertical - 4 * this.renderNoteScale, noteWidth, 8 * this.renderNoteScale);
        if (selected) { context.strokeStyle = '#fff'; context.lineWidth = 2; context.strokeRect(renderedHorizontal - noteWidth / 2 - 3, vertical - 4 * this.renderNoteScale - 3, noteWidth + 6, 8 * this.renderNoteScale + 6); context.lineWidth = 1; }
        context.globalAlpha = 1;
      }
      if (direct) context.restore();
    }
    if (this.drag?.kind === 'rectangle' && !this.marqueeOverlay) {
      context.fillStyle = '#81bfff22'; context.strokeStyle = '#81bfff';
      const start = this.rectangleStart(this.drag); const { current } = this.drag;
      context.fillRect(start.x, start.y, current.x - start.x, current.y - start.y);
      context.strokeRect(start.x, start.y, current.x - start.x, current.y - start.y);
    }
    if (this.pendingHold && this.cursor) {
      const lineIndex = this.pendingHold.lineIndex ?? this.getSession().lineIndex;
      const side = this.pendingHold.side ?? 1;
      const tailBeat = direct ? beatValue(snapTime(this.timeAt(this.cursor.y, side), this.division, this.tempo, this.factor)) : this.snappedBeat(this.cursor.y);
      const head = this.verticalForLine(this.pendingHold.beat, lineIndex, height, side); const tail = this.verticalForLine(tailBeat, lineIndex, height, side);
      if (direct) { context.save(); this.clipNoteSide(context, side, width, height); }
      const pendingHorizontal = this.noteHorizontal(this.pendingHold.positionX, lineIndex);
      const noteWidth = this.noteBaseWidth({ size: this.getSession().noteDefaults.size });
      context.globalAlpha = 0.65;
      if (!this.skin?.hold(context, pendingHorizontal, head, tail, noteWidth, false, true, undefined, noteWidth, direct ? side : 1)) context.fillRect(pendingHorizontal - noteWidth / 2, Math.min(head, tail), noteWidth, Math.abs(tail - head));
      context.globalAlpha = 1;
      if (direct) context.restore();
    } else if (this.cursor && this.tool) {
      const lineIndex = this.cursorLineIndex ?? this.lineIndexAt(this.cursor.x, width, 'notes');
      const positionX = this.notePositionAt(this.cursor.x, lineIndex);
      context.fillStyle = NOTE_COLORS[this.tool] + '88';
      const side = direct ? this.noteView.sideAt(this.cursor.y) : 1, vertical = this.verticalForLine(this.snappedBeat(this.cursor.y), lineIndex, height, side);
      if (direct) { context.save(); this.clipNoteSide(context, side, width, height); }
      const noteWidth = this.noteBaseWidth({ size: this.getSession().noteDefaults.size });
      context.fillRect(this.noteHorizontal(positionX, lineIndex) - noteWidth / 2, vertical - 3 * this.renderNoteScale, noteWidth, 6 * this.renderNoteScale);
      if (direct) context.restore();
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
    if (!this.notesOnly && !this.noteView && !(session.multiLineActive && session.multiLineMode === 'notes')) {
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
        const highlight = this.highlight !== false && this.simultaneous?.has(sourceNote);
        const horizontal = this.noteHorizontal(note.positionX, lineIndex); const noteWidth = this.noteWidth(note, highlight), baseWidth = this.noteBaseWidth(note); const rendered = this.clampNoteHorizontal(horizontal, noteWidth, width, lineIndex);
        if (rendered == null) continue;
        const vertical = this.verticalForLine(beat, lineIndex, height); const endVertical = this.verticalForLine(beatValue(note.endTime), lineIndex, height);
        const selected = selectedSet.has(index);
        context.globalAlpha = note.isFake ? 0.45 : noteIsAbove(note) ? 1 : 0.7;
        context.fillStyle = NOTE_COLORS[note.type] ?? '#b8c8ff';
        const textured = note.type === 2 ? this.skin?.hold(context, rendered, vertical, endVertical, baseWidth, highlight, true, note.tint ?? note.color, 68 * this.renderNoteScale) : this.skin?.head(context, note.type, rendered, vertical, baseWidth, highlight, note.tint ?? note.color, 5 * this.renderNoteScale, 68 * this.renderNoteScale);
        if (!textured && note.type === 2) { const alpha = context.globalAlpha; context.globalAlpha = alpha * 0.45; context.fillRect(rendered - noteWidth / 2, Math.min(vertical, endVertical), noteWidth, Math.abs(vertical - endVertical)); context.globalAlpha = alpha; }
        if (!textured) context.fillRect(rendered - noteWidth / 2, vertical - 4 * this.renderNoteScale, noteWidth, 8 * this.renderNoteScale);
        if (selected) { context.strokeStyle = '#fff'; context.lineWidth = 2; context.strokeRect(rendered - noteWidth / 2 - 3, vertical - 4 * this.renderNoteScale - 3, noteWidth + 6, 8 * this.renderNoteScale + 6); context.lineWidth = 1; }
        if (session.multiLineMerge && session.targetLineIndices.length > 1) { context.fillStyle = '#f0d887'; context.font = '14px RPE, sans-serif'; context.textAlign = 'center'; context.fillText(String(lineIndex), rendered, vertical + 18); context.textAlign = 'left'; }
      }
    }
    context.globalAlpha = 1;
    context.restore();
  }

  drawMultiLineEvents(playBeat) {
    const session = this.getSession(); const context = editorSkinContext(this.eventsCanvas.getContext('2d')); const width = this.eventsCanvas.clientWidth; const height = this.eventsCanvas.clientHeight;
    this.eventRects = [];
    const baseValueFontSize = this.eventValueFontSize ?? 13;
    for (const lineIndex of session.targetLineIndices) {
      const panel = this.panelIndex(lineIndex, 'events'); const panelWidth = this.panelWidth(width, 'events'); const offset = panel * this.panelStride(width, 'events') - this.multiLineViewportOffset(width, 'events');
      if (offset + panelWidth < 0 || offset > width) continue;
      const factor = this.factorForLine(lineIndex); const originSeconds = this.tempo.seconds(this.origin, factor);
      const beatAt = y => this.tempo.beat(originSeconds + (height - this.judgementOffset - y) / this.scale, factor);
      const firstBeat = beatAt(height); const lastBeat = beatAt(23);
      const lineSelection = session.multiEventSelection?.get(lineIndex) ?? (lineIndex === session.lineIndex ? session.eventSelection : new Set());
      const layer = this.extended ? { ...(session.chart.judgeLineList?.[lineIndex]?.extended ?? {}), paintEvents: eventListAt(session, lineIndex, 'paintEvents') } : session.chart.judgeLineList?.[lineIndex]?.eventLayers?.[this.layer] ?? {};
      this.eventTypes.forEach((type, channel) => {
        const channelWidth = panelWidth / this.eventTypes.length; const barWidth = channelWidth * Math.max(0.35, Math.min(1, this.eventBarWidth ?? 0.82)); const barX = offset + channel * channelWidth + (channelWidth - barWidth) / 2;
        context.strokeStyle = '#334154'; context.beginPath(); context.moveTo(offset + channel * channelWidth, 0); context.lineTo(offset + channel * channelWidth, height); context.stroke();
        const events = layer[type] ?? [];
        const display = eventDisplayIndex(this, events, session.chart); const { ranges } = display;
        const entries = display.index.query(firstBeat, lastBeat).sort((a, b) => a.index - b.index);
        const visibleGroups = new Set(entries.map(entry => ranges.get(entry.index)));
        const selectedGroups = selectedEventGroups(lineSelection, type, ranges);
        const seamlessGroups = new Set();
        const curveBatches = new Map();
        if (this.seamlessEvents && channelWidth >= 18 && type !== 'paintEvents') for (const group of visibleGroups) {
          if (!group || group.entries.length < 2) continue;
          if (selectedGroups.has(group) || display.unmergeable.has(group)) continue;
          seamlessGroups.add(group);
          const first = group.entries[0].event; const last = group.entries.at(-1).event;
          const top = Math.max(23, this.verticalForLine(beatValue(last.endTime), lineIndex, height));
          const bottom = Math.min(height, this.verticalForLine(beatValue(first.startTime), lineIndex, height));
          if (bottom > top) { context.globalAlpha = this.eventOpacity ?? 0.25; context.fillStyle = '#e58d24'; context.fillRect(barX, top, barWidth, bottom - top); context.globalAlpha = 1; context.strokeStyle = '#ffa334'; context.strokeRect(barX, top, barWidth, bottom - top); }
        }
        for (const { index, item: event, start, end } of entries) {
          const top = this.verticalForLine(end, lineIndex, height); const bottom = this.verticalForLine(start, lineIndex, height);
          if (bottom < 23 || top > height) continue;
          const rectangle = { x: barX, y: Math.max(23, top), width: barWidth, height: Math.max(2, Math.min(height, bottom) - Math.max(23, top)), index, type, lineIndex };
          this.eventRects.push(rectangle);
          const selected = lineSelection.has(eventKey(type, index));
          const hooked = isHookedEvent(event);
          const seamless = seamlessGroups.has(ranges.get(index));
          if (!seamless) {
            context.globalAlpha = this.eventOpacity ?? 0.25;
            context.fillStyle = type === 'paintEvents' ? '#c6a1ff' : selected ? '#ffe091' : hooked ? '#62d8f2' : '#e58d24'; context.fillRect(rectangle.x, rectangle.y, rectangle.width, rectangle.height);
            context.globalAlpha = 1; context.strokeStyle = selected ? '#fff2bd' : type === 'paintEvents' ? '#c6a1ff' : hooked ? '#b8f2ff' : '#ffa334'; context.lineWidth = selected ? 2 : 1; context.strokeRect(rectangle.x, rectangle.y, rectangle.width, rectangle.height);
          }
          if (event.trajectory) this.drawTrajectoryEvent(context, rectangle, event);
          if (this.drawEventCurves !== false && !event.trajectory && type !== 'paintEvents' && channelWidth >= (this.eventCurveThreshold ?? 24) && Number.isFinite(event.start) && Number.isFinite(event.end)) {
            if (seamless) {
              const range = ranges.get(index); if (!curveBatches.has(range)) curveBatches.set(range, []);
              curveBatches.get(range).push({ event, range, startY: bottom, endY: top });
            } else {
              context.strokeStyle = selected ? '#fff4c2' : '#ffe0a3';
              drawEventCurve(context, event, ranges.get(index), rectangle, bottom, top, { steps: 24, padding: 4, lineWidth: 1.5, drawConstant: true });
            }
          }
        }
        context.strokeStyle = '#ffe0a3';
        for (const [group, entries] of curveBatches) {
          const top = Math.max(23, this.verticalForLine(beatValue(group.entries.at(-1).event.endTime), lineIndex, height));
          const bottom = Math.min(height, this.verticalForLine(beatValue(group.entries[0].event.startTime), lineIndex, height));
          drawEventCurveBatch(context, entries, { x: barX, y: top, width: barWidth, height: Math.max(2, bottom - top) }, { steps: 24, padding: 4, lineWidth: 1.5, drawConstant: true });
        }
         const valueThreshold = this.eventValueThreshold ?? 30;
         const valueFontSize = channelWidth >= valueThreshold * 2.4 ? baseValueFontSize : channelWidth >= valueThreshold * 1.7 ? Math.min(baseValueFontSize, 11) : channelWidth >= valueThreshold * 1.2 ? Math.min(baseValueFontSize, 9) : channelWidth >= valueThreshold ? Math.min(baseValueFontSize, 8) : 0;
        if (type !== 'paintEvents' && valueFontSize > 0) {
          context.font = `${valueFontSize}px RPE, sans-serif`; context.textAlign = 'center';
          for (const group of new Set(entries.map(entry => ranges.get(entry.index)))) { if (!group) continue; const first = group.entries[0].event; const last = group.entries.at(-1).event; const top = this.verticalForLine(beatValue(last.endTime), lineIndex, height); const bottom = this.verticalForLine(beatValue(first.startTime), lineIndex, height); const format = value => typeof value === 'number' ? value.toFixed(2) : Array.isArray(value) ? value.join(',') : String(value ?? ''); context.fillStyle = '#f6e5ce'; context.fillText(format(Number.isFinite(group.max) ? group.max : last.end), offset + channel * channelWidth + channelWidth / 2, Math.max(37, top + 13), Math.max(10, channelWidth - 8)); if (bottom - top > 26) context.fillText(format(Number.isFinite(group.min) ? group.min : first.start), offset + channel * channelWidth + channelWidth / 2, Math.min(height - 5, bottom - 5), Math.max(10, channelWidth - 8)); }
          context.textAlign = 'left';
        }
        context.fillStyle = '#303030'; context.fillRect(offset + channel * channelWidth, 0, channelWidth, 23);
        if (channelWidth >= 48) { context.fillStyle = '#f5f5f5'; context.font = '12px RPE, sans-serif'; context.fillText((this.extended ? extendedLabels() : labels())[channel] ?? '', offset + channel * channelWidth + 6, 16); }
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
      context.strokeStyle = '#fff'; context.setLineDash([5, 3]);
      for (const rectangle of this.eventInteraction.previewRectangles(this.eventRects, width)) {
        const lineSelection = session.multiLineActive && session.multiLineMode === 'events' ? (session.multiEventSelection?.get(rectangle.lineIndex) ?? new Set()) : session.eventSelection;
        if (!lineSelection.has(eventKey(rectangle.type, rectangle.index))) continue;
        const event = session.multiLineActive && session.multiLineMode === 'events' ? eventListAt(session, rectangle.lineIndex, rectangle.type)[rectangle.index] : eventList(session, rectangle.type)[rectangle.index]; if (!event) continue;
        const vertical = session.multiLineActive && session.multiLineMode === 'events' ? beat => this.verticalForLine(beat, rectangle.lineIndex, height) : beat => this.eventVertical(beat, rectangle.type);
        const preview = this.eventInteraction.previewEvent(event);
        const top = vertical(beatValue(preview.endTime));
        const bottom = vertical(beatValue(preview.startTime));
        context.strokeRect(rectangle.x, top, rectangle.width, bottom - top);
      }
      context.setLineDash([]);
    }
    context.globalAlpha = 1; context.lineWidth = 1;
    return true;
  }

  drawCurveGhost(context) {
    if (this.quickCurveGhost) {
      context.save(); context.fillStyle = '#f4d34c'; context.globalAlpha = .8;
      for (const note of this.quickCurveGhost) {
        const x = this.noteHorizontal(note.positionX, note.lineIndex), y = this.noteVertical(note, 'startTime', note.lineIndex), width = this.noteBaseWidth(note);
        if (y < -12 || y > this.viewHeight() + 12 || this.clampNoteHorizontal(x, width, this.notesCanvas.clientWidth, note.lineIndex) === null) continue;
        if (this.noteView?.flow) { context.save(); this.clipNoteSide(context, noteIsAbove(note) ? 1 : -1, this.notesCanvas.clientWidth, this.viewHeight()); }
        context.fillRect(x - width / 2, y - 3 * this.renderNoteScale, width, 6 * this.renderNoteScale);
        if (this.noteView?.flow) context.restore();
      }
      context.globalAlpha = 1; context.font = '12px RPE, sans-serif'; context.fillText(this.quickCurveLabel ?? '', 10, 18); context.restore(); return;
    }
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
        context.fillRect(renderedHorizontal - width / 2, vertical - 5 * this.renderNoteScale, width, 10 * this.renderNoteScale); context.strokeRect(renderedHorizontal - width / 2 - 2, vertical - 5 * this.renderNoteScale - 2, width + 4, 10 * this.renderNoteScale + 4);
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
      this.drawJudgement(context, width, height, playBeat, 'events');
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
      this.eventDisplays = this.eventTypes.map(type => eventDisplayIndex(this, layer[type] ?? [], session.chart));
      this.eventIndexes = this.eventDisplays.map(display => display.index);
      this.chainRanges = this.eventDisplays.map(display => display.ranges);
    }
    this.eventRects = [];
    this.eventTypes.forEach((type, channel) => {
      const { channelWidth, left: horizontal = channel * channelWidth, x: barX, width: barWidth } = this.eventColumnBounds(channel, width);
      context.strokeStyle = '#334154'; context.beginPath(); context.moveTo(horizontal, 0); context.lineTo(horizontal, height); context.stroke();
      const entries = this.eventIndexes[channel].query(this.eventBeatAt(height, type), this.eventBeatAt(0, type));
      if (type === 'paintEvents') {
        this.drawShaderEvents(context, entries, channel, width, height);
        context.fillStyle = '#303030'; context.fillRect(horizontal, 0, channelWidth, 23);
        context.fillStyle = '#f5f5f5'; context.font = '12px RPE, sans-serif'; context.fillText(t('timeline.s14f807e'), horizontal + 6, 16);
        return;
      }
      const ranges = this.chainRanges[channel];
      const display = this.eventDisplays[channel]; const selectedGroups = selectedEventGroups(session.eventSelection, type, ranges);
      const seamlessGroups = new Set();
      const curveBatches = new Map();
      if (this.seamlessEvents) for (const group of new Set(entries.map(entry => ranges.get(entry.index)))) {
        if (!group || group.entries.length < 2) continue;
        if (selectedGroups.has(group) || display.unmergeable.has(group)) continue;
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
        if (!seamless) {
          context.globalAlpha = this.eventOpacity ?? 0.25;
          context.fillStyle = selected ? '#ffe091' : hooked ? '#62d8f2' : '#e58d24'; context.fillRect(rectangle.x, rectangle.y, rectangle.width, rectangle.height);
          context.strokeStyle = selected ? '#fff2bd' : hooked ? '#b8f2ff' : '#ffa334'; context.lineWidth = selected ? 2 : 1;
          if (hooked) context.setLineDash([4, 3]);
          context.strokeRect(rectangle.x, rectangle.y, rectangle.width, rectangle.height);
          if (hooked) context.setLineDash([]);
          context.globalAlpha = 1;
        }
        if (entry.item.trajectory) this.drawTrajectoryEvent(context, rectangle, entry.item);
        if (this.decorateEvent) { context.save(); context.beginPath(); context.rect(rectangle.x, rectangle.y, rectangle.width, rectangle.height); context.clip(); try { this.decorateEvent(context, rectangle, entry.item, selected); } finally { context.restore(); } }
        if (this.drawEventCurves !== false && !entry.item.trajectory && channelWidth >= (this.eventCurveThreshold ?? 24)) {
          if (seamless) {
            if (!curveBatches.has(chain)) curveBatches.set(chain, []);
            curveBatches.get(chain).push({ event: entry.item, range: chain, startY: bottom, endY: vertical });
          } else { drawEventCurve(context, entry.item, chain, rectangle, bottom, vertical); context.lineWidth = 1; }
        }
      }
      context.strokeStyle = '#ffa334';
      for (const [group, entries] of curveBatches) {
        const top = Math.max(0, this.vertical(beatValue(group.entries.at(-1).event.endTime)));
        const bottom = Math.min(height, this.vertical(beatValue(group.entries[0].event.startTime)));
        drawEventCurveBatch(context, entries, { x: barX, y: top, width: barWidth, height: Math.max(2, bottom - top) });
      }
      context.lineWidth = 1;
      const visibleGroups = new Set(entries.map(entry => ranges.get(entry.index)));
      const formatValue = value => this.formatEventValue ? this.formatEventValue(value, type) : typeof value === 'number' ? value.toFixed(2) : Array.isArray(value) ? value.join(',') : value;
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
      context.fillStyle = '#f5f5f5'; context.fillText(this.eventLabels?.[channel] ?? (this.extended ? extendedLabels() : labels())[channel], horizontal + 6, 16, Math.max(1, channelWidth - 12));
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
      context.strokeStyle = '#fff'; context.setLineDash([5, 3]);
      for (const rectangle of this.eventInteraction.previewRectangles(this.eventRects, width)) if (this.getSession().eventSelection.has(eventKey(rectangle.type, rectangle.index))) {
        const event = this.eventInteraction.previewEvent(layer[rectangle.type][rectangle.index]);
        const top = this.eventVertical(beatValue(event.endTime), rectangle.type);
        const bottom = this.eventVertical(beatValue(event.startTime), rectangle.type);
        const height = bottom - top;
        context.strokeRect(rectangle.x, top, rectangle.width, height);
      } context.setLineDash([]);
    }
    this.eventInteraction.draw(context, width);
    this.drawJudgement(context, width, height, playBeat, 'events');
  }

  drawTrajectoryEvent(context, rectangle, event) {
    const verticalAt = beat => this.getSession().multiLineActive && this.getSession().multiLineMode === 'events'
      ? this.verticalForLine(beat, rectangle.lineIndex, this.viewHeight()) : this.eventVertical(beat, 'moveXEvents');
    const startY = verticalAt(beatValue(event.startTime)); const endY = verticalAt(beatValue(event.endTime));
    context.save(); context.beginPath(); context.rect(rectangle.x, rectangle.y, rectangle.width, rectangle.height); context.clip();
    context.strokeStyle = '#83edca'; context.globalAlpha = 0.95; context.lineWidth = 2; context.strokeRect(rectangle.x, rectangle.y, rectangle.width, rectangle.height);
    context.fillStyle = '#a0ffdb'; context.font = '12px RPE, sans-serif'; context.textAlign = 'center'; context.fillText(t('timeline.s9cbb5c3'), rectangle.x + rectangle.width / 2, rectangle.y + 30, Math.max(1, rectangle.width - 4));
    if (this.drawEventCurves !== false && rectangle.width > 20 && rectangle.height > 42) {
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
