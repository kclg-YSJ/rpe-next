import { captureSelection, controlSelection, commitSelectionEdit, selectionScaleAnchor } from '../application/batch-edit.mjs';
import { beatValue } from '../core/beat.mjs';
import { snapTime } from '../core/edit-grid.mjs';
import { usesNativeTextShortcut } from './keyboard.mjs';
import { t } from '../i18n.mjs';
import { expandXyEntries, retainXySelection } from '../application/xy-binding.mjs';
import { canScaleEventValue, eventScaleGesture, eventScaleRate } from '../core/event-value-scale.mjs';
import { scaleEventValues } from '../application/event-value-scale.mjs';
import { EventValueScale } from './event-value-scale.mjs';

const configurations = {
  notes: [['note-move', t('batch-controls.s630b77a'), '#ff0088'], ['note-scale', t('batch-controls.sf072b96'), '#00aabb'], ['note-line', t('batch-controls.s27b1657'), '#b400ff']],
  events: [['event-move', t('batch-controls.se72ad4e'), '#ef4545'], ['event-end', t('batch-controls.s339d424'), '#00aabb'], ['event-start', t('batch-controls.se1eb4de'), '#8a2be2']],
};

export class BatchControls {
  constructor(stage, timeline, getSession, enabled, reportError, valueScaleOptions = () => ({ enabled: false })) {
    this.stage = stage; this.timeline = timeline; this.getSession = getSession; this.enabled = enabled; this.reportError = reportError;
    this.valueScaleOptions = valueScaleOptions;
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
    timeline.onSelectionComplete = (area, point) => this.placeSelection(area, point);
    window.addEventListener('keydown', event => {
      if (this.valueScale && event.key === 'Escape' && !usesNativeTextShortcut(event)) { event.preventDefault(); event.stopImmediatePropagation(); this.exitValueScale(); return; }
      if (!this.active || usesNativeTextShortcut(event)) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); this.cancel(); return; }
      if (['1', '2'].includes(event.key) && this.active.kind === 'note-scale') { event.preventDefault(); this.anchorMode = Number(event.key); this.update(); }
    }, true);
    window.addEventListener('keyup', event => { if (Number(event.key) === this.anchorMode) { this.anchorMode = 0; this.update(); } });
    window.addEventListener('blur', () => this.cancel());
  }

  enterValueScale() {
    if (this.valueScale) return true;
    const options = this.valueScaleOptions?.();
    if (!options?.enabled || options.available === false || !this.enabled()) return false;
    try { this.valueScale = new EventValueScale(this); this.valueBallOffset = { x: 0, y: 0 }; return true; }
    catch (error) { this.reportError(error); return false; }
  }

  exitValueScale() {
    if (!this.valueScale) return;
    if (this.active?.kind === 'event-value-scale') this.cancel();
    const mode = this.valueScale; this.valueScale = null; mode.dispose(); this.valueBallOffset = null;
    const button = this.groups.get('events').host.querySelector('[data-kind="event-end"]');
    for (const animation of button.getAnimations()) animation.cancel();
    button.style.transform = ''; this.groups.get('events').signature = ''; this.timeline.changed();
  }

  captureEventDrag(active) {
    if (active.area !== 'events' || !active.scaleProbe && active.kind !== 'event-value-scale' || typeof window === 'undefined') return;
    // Some compositor/layout changes drop pointer capture while a moving button
    // is still held. Keep that same gesture alive outside the button too.
    const move = event => { if (this.active === active && event.target !== active.button) this.move(event); };
    const up = event => { if (this.active === active && event.target !== active.button) this.end(event); };
    const cancel = () => this.cancel();
    window.addEventListener('pointermove', move, true); window.addEventListener('pointerup', up, true); window.addEventListener('pointercancel', cancel, true);
    active.releaseCapture = () => { window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', up, true); window.removeEventListener('pointercancel', cancel, true); };
  }

  signature(area, session) {
    const map = area === 'notes' ? session.multiLineSelection : session.multiEventSelection;
    const multi = [...(map ?? new Map())].map(([line, values]) => `${line}:${[...values].sort().join(',')}`).sort().join('|');
    return `${session.lineIndex}:${session.eventLayer}:${[...(area === 'notes' ? session.selection : session.eventSelection)].join(',')}:${multi}`;
  }

  placeSelection(area, point) {
    const group = this.groups.get(area);
    if (!group) return;
    const session = this.getSession();
    group.placement = { session, signature: this.signature(area, session), point: { ...point } };
    group.signature = '';
    group.hint.textContent = '';
    for (const button of group.host.querySelectorAll('.batch-ball')) {
      for (const animation of button.getAnimations()) animation.cancel();
      button.style.transform = '';
    }
    if (area === 'events') this.valueBallOffset = { x: 0, y: 0 };
    this.timeline.changed();
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

  snappedPointerBeat(point, canvas, lineIndex, side, fallback = 1) {
    const timeline = this.timeline, factor = timeline.factorForLine?.(lineIndex) ?? fallback;
    const baseline = timeline.baseline?.(canvas.clientHeight) ?? canvas.clientHeight - (timeline.judgementOffset ?? 42);
    const seconds = timeline.noteView?.flow ? timeline.timeAt(point.y, side) : timeline.tempo.seconds(timeline.origin, factor) + (baseline - point.y) / timeline.scale;
    return beatValue(snapTime(seconds, timeline.division, timeline.tempo, factor));
  }

  sync() {
    const session = this.getSession();
    if (this.active && (session !== this.active.session || session.chart !== this.active.snapshot.chart || this.signature(this.active.area, session) !== this.active.signature || !this.enabled())) this.cancel();
    this.valueScale?.sync();
    const scaleEnabled = this.valueScaleOptions?.().enabled === true;
    const stage = this.stage.getBoundingClientRect();
    for (const [area, group] of this.groups) {
      const multiSelection = !session.multiLineActive ? 0 : area === 'notes'
        ? [...(session.multiLineSelection?.values() ?? [])].reduce((sum, values) => sum + values.size, 0)
        : [...(session.multiEventSelection?.values() ?? [])].reduce((sum, values) => sum + values.size, 0);
      const selection = area === 'notes' ? multiSelection + session.selection.size : multiSelection + session.eventSelection.size;
      const multiMode = session.multiLineActive && ((area === 'notes' && session.multiLineMode === 'notes') || (area === 'events' && session.multiLineMode === 'events'));
      const multiIntent = session.multiSelectionIntent === area;
      const canShow = this.timeline.noteView && area === 'events' ? false : area === 'events' && scaleEnabled && session.focus === 'events' ? (multiMode ? multiSelection > 0 : selection > 0) : multiMode ? multiSelection > 0 && multiIntent : selection >= 2 || (selection > 0 && multiIntent);
      group.host.hidden = !this.enabled() || !canShow || this.timeline.rectangleSelection?.()?.area === area || (area === 'notes' ? this.timeline.drag : this.timeline.eventInteraction?.drag)?.kind === 'stroke';
      if (this.active || group.host.hidden) continue;
      const canvas = area === 'notes' ? this.timeline.notesCanvas : this.timeline.eventsCanvas;
      const rectangle = area === 'notes' && this.timeline.noteView ? { left: stage.left, top: stage.top, width: canvas.clientWidth, height: canvas.clientHeight } : canvas.getBoundingClientRect();
      if (!rectangle.width) { group.host.hidden = true; continue; }
      const selected = this.signature(area, session);
      const signature = `${selected}:${rectangle.width}:${rectangle.height}`;
      if (signature === group.signature) continue;
      group.signature = signature;
      if (group.placement && (group.placement.session !== session || group.placement.signature !== selected)) group.placement = null;
      const point = group.placement?.point ?? (area === 'notes' ? this.timeline.cursor : this.timeline.eventCursor);
      const requested = (point?.x ?? rectangle.width / 2) + 50;
      let horizontal = Math.max(8, Math.min(rectangle.width - 26, requested));
      let vertical = Math.max(25, Math.min(rectangle.height - 97, (point?.y ?? rectangle.height / 2) - 30));
      const view = area === 'notes' ? this.timeline.noteView : null;
      if (view?.viewport) {
        // A rotated canvas's bounding box includes clipped corners. Keep the
        // three controls inside the actual preview viewport instead.
        const corners = [[0, 0], [26, 0], [0, 90], [26, 90]].map(([x, y]) => view.screen({ x: horizontal + x, y: vertical + y }));
        const { left, top, width, height } = view.viewport;
        const dx = Math.max(left + 8 - Math.min(...corners.map(point => point.x)), Math.min(0, left + width - 8 - Math.max(...corners.map(point => point.x))));
        const dy = Math.max(top + 8 - Math.min(...corners.map(point => point.y)), Math.min(0, top + height - 8 - Math.max(...corners.map(point => point.y))));
        horizontal += dx * Math.cos(view.angle) + dy * Math.sin(view.angle);
        vertical += -dx * Math.sin(view.angle) + dy * Math.cos(view.angle);
      }
      group.host.style.left = `${rectangle.left - stage.left + horizontal}px`;
      group.host.style.top = `${rectangle.top - stage.top + vertical}px`;
      if (area === 'events' && this.valueScale) {
        const offset = this.valueBallOffset ?? { x: 0, y: 0 };
        offset.x = Math.max(8 - horizontal, Math.min(rectangle.width - horizontal - 26, offset.x));
        offset.y = Math.max(25 - vertical - 34, Math.min(rectangle.height - vertical - 60, offset.y));
        this.valueBallOffset = offset;
        group.host.querySelector('[data-kind="event-end"]').style.transform = `translate(${offset.x}px, ${offset.y}px)`;
      }
    }
  }

  begin(event, area, kind, button) {
    if (event.button !== 0 || this.active || !this.enabled()) return;
    event.preventDefault(); event.stopPropagation();
    this.valueScale?.sync();
    const session = this.getSession(); const snapshot = captureSelection(session);
    const selectedEntries = area === 'notes' ? snapshot.notes : snapshot.events;
    const multiMode = session.multiLineActive && ((area === 'notes' && session.multiLineMode === 'notes') || (area === 'events' && session.multiLineMode === 'events'));
    const multiIntent = session.multiSelectionIntent === area;
    const scaleEnabled = area === 'events' && this.valueScaleOptions?.().enabled === true;
    if (selectedEntries.length < (scaleEnabled ? 1 : multiMode ? (multiIntent ? 1 : Number.POSITIVE_INFINITY) : (multiIntent ? 1 : 2))) return;
    if (area === 'notes') snapshot.events = []; else snapshot.notes = [];
    let xySelected;
    if (area === 'events' && session.xyBinding === true && !(kind === 'event-end' && this.valueScale)) {
      xySelected = snapshot.events;
      snapshot.events = expandXyEntries(snapshot.chart, snapshot.eventLayer, snapshot.events);
    }
    this.timeline.cancelPlacement();
    const valueScaling = kind === 'event-end' && this.valueScale;
    let displayedOffset = this.valueBallOffset ?? { x: 0, y: 0 };
    if (valueScaling && typeof getComputedStyle === 'function' && typeof DOMMatrixReadOnly !== 'undefined') {
      const transform = new DOMMatrixReadOnly(getComputedStyle(button).transform);
      displayedOffset = { x: transform.m41, y: transform.m42 };
    }
    for (const animation of button.getAnimations()) animation.cancel();
    if (valueScaling) button.style.transform = `translate(${displayedOffset.x}px, ${displayedOffset.y}px)`;
    if (!valueScaling) button.style.transform = '';
    const canvas = area === 'notes' ? this.timeline.notesCanvas : this.timeline.eventsCanvas;
    const rawPoint = this.timeline.point(event, canvas);
    const bounds = this.selectionBounds(area, snapshot, canvas);
    const firstEntry = (area === 'notes' ? snapshot.notes : snapshot.events)[0];
    const activeLineIndex = Number.isInteger(firstEntry?.lineIndex) ? firstEntry.lineIndex : session.lineIndex;
    const point = this.clampPoint(rawPoint, bounds, canvas);
    this.active = { session, snapshot, xySelected, kind, button, area, lineIndex: activeLineIndex, bounds, signature: this.signature(area, session), pointerId: event.pointerId, start: point, point, canvas,
      unit: Math.max(0.35, canvas.clientHeight / 1080), factor: session.chart.judgeLineList?.[activeLineIndex]?.bpmfactor ?? 1,
      side: this.timeline.noteView?.sideAt?.(point.y),
      startX: typeof this.timeline.notePositionAt === 'function' ? this.timeline.notePositionAt(point.x, activeLineIndex) : point.x };
    if (valueScaling) Object.assign(this.active, { kind: 'event-value-scale', scaleOrigin: point, ballOffset: displayedOffset });
    else if (kind === 'event-end' && scaleEnabled && (xySelected ?? snapshot.events).some(canScaleEventValue)) this.active.scaleProbe = {};
    this.active.startBeatsByLine = new Map([...new Set((area === 'notes' ? snapshot.notes : snapshot.events).map(entry => entry.lineIndex))].map(lineIndex => [lineIndex, this.snappedPointerBeat(point, canvas, lineIndex, this.active.side, this.active.factor)]));
    this.timeline.scaleAxis = kind === 'note-scale' ? selectionScaleAnchor(snapshot, this.anchorMode) : null;
    this.timeline.scaleAxisLine = kind === 'note-scale' ? activeLineIndex : null;
    button.setPointerCapture(event.pointerId); this.captureEventDrag(this.active); this.update();
  }

  move(event) {
    if (!this.active || event.pointerId !== this.active.pointerId) return;
    event.preventDefault();
    const point = this.timeline.point(event, this.active.canvas);
    this.active.point = this.active.kind === 'event-value-scale' ? point : this.clampPoint(point, this.active.bounds, this.active.canvas);
    const active = this.active;
    if (active.scaleProbe) {
      const direction = eventScaleGesture(active.scaleProbe, active.point.x - active.start.x, active.point.y - active.start.y);
      if (direction === 'scale') {
        if (this.enterValueScale()) {
          Object.assign(active, { kind: 'event-value-scale', snapshot: this.valueScale.snapshot, xySelected: null, scaleOrigin: { ...active.point }, ballOffset: { x: 0, y: 0 } });
          active.scaleProbe = null;
        } else active.scaleProbe.direction = 'vertical';
      }
    }
    try { this.update(); } catch (error) { this.cancel(); this.reportError(error); }
  }

  update() {
    const active = this.active; if (!active) return;
    const { point, start, kind, snapshot } = active;
    this.timeline.scaleAxis = kind === 'note-scale' ? selectionScaleAnchor(snapshot, this.anchorMode) : null;
    this.timeline.scaleAxisLine = kind === 'note-scale' ? active.lineIndex : null;
    const deltaX = point.x - start.x; const deltaY = point.y - start.y;
    active.button.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
    if (active.scaleProbe && active.scaleProbe.direction !== 'vertical') { this.timeline.bulkPreview = null; this.groups.get(active.area).hint.textContent = ''; this.timeline.changed(); return; }
    if (kind === 'event-value-scale') {
      const options = this.valueScaleOptions(), rate = eventScaleRate(point.x - active.scaleOrigin.x, active.unit, options.snap !== false, options.step ?? .05);
      active.button.style.transform = `translate(${deltaX + (active.ballOffset?.x ?? 0)}px, ${deltaY + (active.ballOffset?.y ?? 0)}px)`;
      const hint = this.groups.get(active.area).hint;
      hint.style.transform = `translate(${deltaX + (active.ballOffset?.x ?? 0)}px, ${deltaY + (active.ballOffset?.y ?? 0) + 34}px)`;
      this.valueScale.updateRuler();
      if (active.rate === rate) { this.timeline.changed(); return; }
      active.rate = rate;
      const result = scaleEventValues(snapshot, this.valueScale.columns, rate);
      this.previewResult(active, result);
      hint.textContent = `× ${Number(rate.toFixed(4))}`;
      this.timeline.changed(); return;
    }
    const deltaEntries = active.area === 'notes' ? snapshot.notes : snapshot.events;
    const deltaBeatByLine = new Map([...new Set(deltaEntries.map(entry => entry.lineIndex))].map(lineIndex => {
      const origin = active.startBeatsByLine?.get(lineIndex) ?? this.snappedPointerBeat(start, active.canvas, lineIndex, active.side, active.factor);
      return [lineIndex, this.snappedPointerBeat(point, active.canvas, lineIndex, active.side, active.factor) - origin];
    }));
    const deltaBeat = deltaBeatByLine.get(active.lineIndex ?? snapshot.lineIndex) ?? 0;
    const panelWidth = active.area === 'notes'
      ? (typeof this.timeline.panelWidth === 'function' ? this.timeline.panelWidth(active.canvas.clientWidth, 'notes') : active.canvas.clientWidth)
      : 0;
    const inset = active.area === 'notes'
      ? (typeof this.timeline.noteInset === 'function' ? this.timeline.noteInset(panelWidth) : 0)
      : 0;
    const contentWidth = Math.max(1, panelWidth - inset * 2);
    const logicalDeltaX = active.area === 'notes' ? deltaX / (this.timeline.horizontalScale?.() ?? contentWidth / 1350) : 0;
    const result = controlSelection(snapshot, kind, { deltaBeat, deltaBeatByLine, deltaX: logicalDeltaX, dragX: deltaX / active.unit, anchorMode: this.anchorMode, snapX: this.timeline.snapX, gridCount: this.timeline.gridCount });
    if (active.xySelected) retainXySelection(result, active.xySelected);
    this.previewResult(active, result);
    this.groups.get(active.area).hint.textContent = result.lineIndex !== snapshot.lineIndex ? t('batch-controls.s8c1e4c0', { p0: snapshot.lineIndex, p1: result.lineIndex }) : kind === 'note-scale' ? t('batch-controls.s7c422ba') : t('batch-controls.s4a02020', { p0: deltaBeat.toFixed(3) });
    this.timeline.changed();
  }

  previewResult(active, result) {
    active.result = result;
    const view = Object.create(active.session);
    Object.defineProperty(view, 'chart', { value: result.chart });
    Object.assign(view, { lineIndex: result.lineIndex, selection: result.selection, eventSelection: result.eventSelection, multiLineSelection: result.multiLineSelection, multiEventSelection: result.multiEventSelection });
    this.timeline.bulkPreview = { ...result, session: view };
  }

  end(event) {
    const active = this.active; if (!active || event.pointerId !== active.pointerId) return;
    this.move(event);
    if (this.active !== active) return;
    this.timeline.bulkPreview = null; this.timeline.scaleAxis = null; this.timeline.scaleAxisLine = null;
    try {
      if (active.result && (active.kind === 'event-value-scale' ? active.result.valueScaleChanged : Math.hypot(active.point.x - active.start.x, active.point.y - active.start.y) > 3)) {
        if (this.getSession() !== active.session || active.session.chart !== active.snapshot.chart || this.signature(active.area, active.session) !== active.signature) throw new Error(t('batch-controls.s48a33a3'));
        const result = active.result;
        this.active = null;
        commitSelectionEdit(active.session, result, active.kind === 'event-value-scale' ? t('event-scale.title') : t('batch-controls.sba17db7', { p0: active.button.title.split('；')[0] }));
      }
    } catch (error) { this.reportError(error); }
    this.active = null; this.returnBall(active); this.timeline.changed();
  }

  returnBall(active) {
    active.releaseCapture?.();
    if (active.button.hasPointerCapture(active.pointerId)) active.button.releasePointerCapture(active.pointerId);
    const group = this.groups.get(active.area);
    const rectangle = active.canvas.getBoundingClientRect();
    group.signature = `${this.signature(active.area, this.getSession())}:${rectangle.width}:${rectangle.height}`;
    group.hint.textContent = '';
    group.hint.style && (group.hint.style.transform = '');
    let deltaX = active.point.x - active.start.x; let deltaY = active.point.y - active.start.y;
    if (active.kind === 'event-value-scale' && this.valueScale) {
      this.valueScale.hideRuler();
      deltaX += active.ballOffset?.x ?? 0; deltaY += active.ballOffset?.y ?? 0;
      this.valueBallOffset = { x: 0, y: 0 };
    }
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
