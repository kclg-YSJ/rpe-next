import { captureSelection, controlSelection, commitSelectionEdit, selectionScaleAnchor } from '../application/batch-edit.mjs';
import { beatValue } from '../core/beat.mjs';
import { snapTime } from '../core/edit-grid.mjs';
import { usesNativeTextShortcut } from './keyboard.mjs';
import { t } from '../i18n.mjs';

const configurations = {
  notes: [['note-move', t('batch-controls.s630b77a'), '#ff0088'], ['note-scale', t('batch-controls.sf072b96'), '#00aabb'], ['note-line', t('batch-controls.s27b1657'), '#b400ff']],
  events: [['event-move', t('batch-controls.se72ad4e'), '#ef4545'], ['event-end', t('batch-controls.s339d424'), '#00aabb'], ['event-start', t('batch-controls.se1eb4de'), '#8a2be2']],
};

export class BatchControls {
  constructor(stage, timeline, getSession, enabled, reportError) {
    this.stage = stage; this.timeline = timeline; this.getSession = getSession; this.enabled = enabled; this.reportError = reportError;
    this.groups = new Map(); this.active = null; this.anchorMode = 0;
    for (const [area, entries] of Object.entries(configurations)) {
      const host = document.createElement('div'); host.className = 'batch-controls'; host.hidden = true;
      for (const [kind, title, color] of entries) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'batch-ball'; button.title = title; button.setAttribute('aria-label', title);
        button.dataset.kind = kind; button.style.setProperty('--ball-color', color);
        button.addEventListener('pointerdown', event => this.begin(event, area, kind, button));
        button.addEventListener('pointermove', event => this.move(event));
        button.addEventListener('pointerup', event => this.end(event));
        button.addEventListener('pointercancel', () => this.cancel());
        host.append(button);
      }
      const hint = document.createElement('output'); hint.className = 'batch-hint'; host.append(hint);
      stage.append(host); this.groups.set(area, { host, hint, signature: '' });
    }
    window.addEventListener('keydown', event => {
      if (!this.active || usesNativeTextShortcut(event)) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); this.cancel(); return; }
      if (['1', '2'].includes(event.key) && this.active.kind === 'note-scale') { event.preventDefault(); this.anchorMode = Number(event.key); this.update(); }
    }, true);
    window.addEventListener('keyup', event => { if (Number(event.key) === this.anchorMode) { this.anchorMode = 0; this.update(); } });
    window.addEventListener('blur', () => this.cancel());
  }

  signature(area, session) {
    const map = area === 'notes' ? session.multiLineSelection : session.multiEventSelection;
    const multi = [...(map ?? new Map())].map(([line, values]) => `${line}:${[...values].sort().join(',')}`).sort().join('|');
    return `${session.lineIndex}:${session.eventLayer}:${[...(area === 'notes' ? session.selection : session.eventSelection)].join(',')}:${multi}`;
  }

  panelBounds(area, lineIndex, canvas) {
    const width = canvas.clientWidth; const panelWidth = this.timeline.panelWidth(width, area);
    const left = this.timeline.panelIndex(lineIndex, area) * this.timeline.panelStride(width, area) - this.timeline.multiLineViewportOffset(width, area);
    return { left, right: left + panelWidth, width: panelWidth };
  }

  selectionBounds(area, snapshot, canvas) {
    const entries = area === 'notes' ? snapshot.notes : snapshot.events;
    const indices = [...new Set(entries.map(entry => Number.isInteger(entry.lineIndex) ? entry.lineIndex : snapshot.lineIndex))];
    if (!indices.length) return this.panelBounds(area, snapshot.lineIndex, canvas);
    const bounds = indices.map(index => this.panelBounds(area, index, canvas));
    return { left: Math.min(...bounds.map(value => value.left)), right: Math.max(...bounds.map(value => value.right)), width: Math.max(...bounds.map(value => value.right)) - Math.min(...bounds.map(value => value.left)) };
  }

  clampPoint(point, bounds, canvas) {
    return { x: Math.max(-canvas.clientWidth, Math.min(canvas.clientWidth * 2, point.x)), y: Math.max(-canvas.clientHeight, Math.min(canvas.clientHeight * 2, point.y)) };
  }

  sync() {
    const session = this.getSession();
    if (this.active && (session !== this.active.session || session.chart !== this.active.snapshot.chart || this.signature(this.active.area, session) !== this.active.signature || !this.enabled())) this.cancel();
    const stage = this.stage.getBoundingClientRect();
    for (const [area, group] of this.groups) {
      const multiSelection = area === 'notes'
        ? [...(session.multiLineSelection?.values() ?? [])].reduce((sum, values) => sum + values.size, 0)
        : [...(session.multiEventSelection?.values() ?? [])].reduce((sum, values) => sum + values.size, 0);
      const selection = area === 'notes' ? multiSelection + session.selection.size : multiSelection + session.eventSelection.size;
      const multiMode = session.multiLineActive && ((area === 'notes' && session.multiLineMode === 'notes') || (area === 'events' && session.multiLineMode === 'events'));
      const multiIntent = session.multiSelectionIntent === area;
      const canShow = multiMode ? multiSelection > 0 && multiIntent : selection >= 2 || (selection > 0 && multiIntent);
      group.host.hidden = !this.enabled() || !canShow;
      if (this.active || group.host.hidden) continue;
      const canvas = area === 'notes' ? this.timeline.notesCanvas : this.timeline.eventsCanvas;
      const rectangle = canvas.getBoundingClientRect();
      if (!rectangle.width) { group.host.hidden = true; continue; }
      const signature = `${this.signature(area, session)}:${rectangle.width}:${rectangle.height}`;
      if (signature === group.signature) continue;
      group.signature = signature;
      const point = area === 'notes' ? this.timeline.cursor : this.timeline.eventCursor;
      const bounds = this.selectionBounds(area, captureSelection(session), canvas);
      const requested = Math.max(bounds.left + 20, Math.min(bounds.right - 26, (point?.x ?? (bounds.left + bounds.width / 2)) + 50));
      const horizontal = Math.max(8, Math.min(rectangle.width - 26, requested));
      const vertical = Math.max(25, Math.min(rectangle.height - 97, (point?.y ?? rectangle.height / 2) - 30));
      group.host.style.left = `${rectangle.left - stage.left + horizontal}px`;
      group.host.style.top = `${rectangle.top - stage.top + vertical}px`;
    }
  }

  begin(event, area, kind, button) {
    if (event.button !== 0 || this.active || !this.enabled()) return;
    event.preventDefault(); event.stopPropagation();
    const session = this.getSession(); const snapshot = captureSelection(session);
    const selectedEntries = area === 'notes' ? snapshot.notes : snapshot.events;
    const multiMode = session.multiLineActive && ((area === 'notes' && session.multiLineMode === 'notes') || (area === 'events' && session.multiLineMode === 'events'));
    const multiIntent = session.multiSelectionIntent === area;
    if (selectedEntries.length < (multiMode ? (multiIntent ? 1 : Number.POSITIVE_INFINITY) : (multiIntent ? 1 : 2))) return;
    if (area === 'notes') snapshot.events = []; else snapshot.notes = [];
    this.timeline.cancelPlacement();
    for (const animation of button.getAnimations()) animation.cancel();
    button.style.transform = '';
    const canvas = area === 'notes' ? this.timeline.notesCanvas : this.timeline.eventsCanvas;
    const rawPoint = this.timeline.point(event, canvas);
    const bounds = this.selectionBounds(area, snapshot, canvas);
    const firstEntry = (area === 'notes' ? snapshot.notes : snapshot.events)[0];
    const activeLineIndex = Number.isInteger(firstEntry?.lineIndex) ? firstEntry.lineIndex : session.lineIndex;
    const point = this.clampPoint(rawPoint, bounds, canvas);
    this.active = { session, snapshot, kind, button, area, lineIndex: activeLineIndex, bounds, signature: this.signature(area, session), pointerId: event.pointerId, start: point, point, canvas,
      unit: Math.max(0.35, canvas.clientHeight / 1080), factor: session.chart.judgeLineList?.[activeLineIndex]?.bpmfactor ?? 1,
      startBeat: this.timeline.tempo.beat(this.timeline.tempo.seconds(this.timeline.origin, session.chart.judgeLineList?.[activeLineIndex]?.bpmfactor ?? 1) + (canvas.clientHeight - (this.timeline.judgementOffset ?? 42) - point.y) / this.timeline.scale, session.chart.judgeLineList?.[activeLineIndex]?.bpmfactor ?? 1), startX: typeof this.timeline.notePositionAt === 'function' ? this.timeline.notePositionAt(point.x, activeLineIndex) : point.x };
    this.timeline.scaleAxis = kind === 'note-scale' ? selectionScaleAnchor(snapshot, this.anchorMode) : null;
    this.timeline.scaleAxisLine = kind === 'note-scale' ? activeLineIndex : null;
    button.setPointerCapture(event.pointerId); this.timeline.changed();
  }

  move(event) {
    if (!this.active || event.pointerId !== this.active.pointerId) return;
    event.preventDefault(); this.active.point = this.clampPoint(this.timeline.point(event, this.active.canvas), this.active.bounds, this.active.canvas); this.update();
  }

  update() {
    const active = this.active; if (!active) return;
    const { point, start, kind, snapshot, factor } = active;
    this.timeline.scaleAxis = kind === 'note-scale' ? selectionScaleAnchor(snapshot, this.anchorMode) : null;
    this.timeline.scaleAxisLine = kind === 'note-scale' ? active.lineIndex : null;
    const deltaX = point.x - start.x; const deltaY = point.y - start.y;
    active.button.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
    const seconds = this.timeline.tempo.seconds(this.timeline.origin, factor) + (active.canvas.clientHeight - (this.timeline.judgementOffset ?? 42) - point.y) / this.timeline.scale;
    const deltaBeat = beatValue(snapTime(seconds, this.timeline.division, this.timeline.tempo, factor)) - active.startBeat;
    const deltaEntries = active.area === 'notes' ? snapshot.notes : snapshot.events;
    const deltaBeatByLine = new Map([...new Set(deltaEntries.map(entry => entry.lineIndex))].map(lineIndex => {
      const lineFactor = typeof this.timeline.factorForLine === 'function'
        ? this.timeline.factorForLine(lineIndex)
        : active.factor;
      const startSeconds = this.timeline.tempo.seconds(this.timeline.origin, lineFactor) + (active.canvas.clientHeight - (this.timeline.judgementOffset ?? 42) - start.y) / this.timeline.scale;
      const currentSeconds = this.timeline.tempo.seconds(this.timeline.origin, lineFactor) + (active.canvas.clientHeight - (this.timeline.judgementOffset ?? 42) - point.y) / this.timeline.scale;
      return [lineIndex, beatValue(snapTime(currentSeconds, this.timeline.division, this.timeline.tempo, lineFactor)) - beatValue(snapTime(startSeconds, this.timeline.division, this.timeline.tempo, lineFactor))];
    }));
    const panelWidth = active.area === 'notes'
      ? (typeof this.timeline.panelWidth === 'function' ? this.timeline.panelWidth(active.canvas.clientWidth, 'notes') : active.canvas.clientWidth)
      : 0;
    const inset = active.area === 'notes'
      ? (typeof this.timeline.noteInset === 'function' ? this.timeline.noteInset(panelWidth) : 0)
      : 0;
    const contentWidth = Math.max(1, panelWidth - inset * 2);
    const logicalDeltaX = active.area === 'notes' ? deltaX / contentWidth * 1350 : 0;
    const result = controlSelection(snapshot, kind, { deltaBeat, deltaBeatByLine, deltaX: logicalDeltaX, dragX: deltaX / active.unit, anchorMode: this.anchorMode, snapX: this.timeline.snapX, gridCount: this.timeline.gridCount });
    active.result = result;
    const view = Object.create(active.session);
    Object.defineProperty(view, 'chart', { value: result.chart });
    Object.assign(view, { lineIndex: result.lineIndex, selection: result.selection, eventSelection: result.eventSelection, multiLineSelection: result.multiLineSelection, multiEventSelection: result.multiEventSelection });
    this.timeline.bulkPreview = { ...result, session: view };
    this.groups.get(active.area).hint.textContent = result.lineIndex !== snapshot.lineIndex ? t('batch-controls.s8c1e4c0', { p0: snapshot.lineIndex, p1: result.lineIndex }) : kind === 'note-scale' ? t('batch-controls.s7c422ba') : t('batch-controls.s4a02020', { p0: deltaBeat.toFixed(3) });
    this.timeline.changed();
  }

  end(event) {
    const active = this.active; if (!active || event.pointerId !== active.pointerId) return;
    this.move(event);
    this.timeline.bulkPreview = null; this.timeline.scaleAxis = null; this.timeline.scaleAxisLine = null;
    try {
      if (Math.hypot(active.point.x - active.start.x, active.point.y - active.start.y) > 3) {
        if (this.getSession() !== active.session || active.session.chart !== active.snapshot.chart || this.signature(active.area, active.session) !== active.signature) throw new Error(t('batch-controls.s48a33a3'));
        const result = active.result;
        this.active = null;
        commitSelectionEdit(active.session, result, t('batch-controls.sba17db7', { p0: active.button.title.split('；')[0] }));
      }
    } catch (error) { this.reportError(error); }
    this.active = null; this.returnBall(active); this.timeline.changed();
  }

  returnBall(active) {
    if (active.button.hasPointerCapture(active.pointerId)) active.button.releasePointerCapture(active.pointerId);
    const group = this.groups.get(active.area);
    const rectangle = active.canvas.getBoundingClientRect();
    group.signature = `${this.signature(active.area, this.getSession())}:${rectangle.width}:${rectangle.height}`;
    group.hint.textContent = '';
    const deltaX = active.point.x - active.start.x; const deltaY = active.point.y - active.start.y;
    active.button.style.transform = '';
    const frames = Array.from({ length: 61 }, (unused, index) => {
      const remaining = 1 - (index / 60) ** (1 / 3);
      return { transform: `translate(${deltaX * remaining}px, ${deltaY * remaining}px)`, offset: index / 60 };
    });
    active.button.animate(frames, { duration: 2000 });
  }

  cancel() {
    const active = this.active; if (!active) return;
    this.active = null; this.timeline.bulkPreview = null; this.timeline.scaleAxis = null; this.timeline.scaleAxisLine = null; this.returnBall(active); this.timeline.changed();
  }
}
