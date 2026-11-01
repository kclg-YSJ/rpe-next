import { directPlacementPlane } from '../core/direct-placement.mjs';
import { previewViewport, previewPositionScale, previewNotePosition } from '../core/editor-display.mjs';
import { PlacementFlow, placementFlowView, clipPlacementConnection } from '../core/placement-flow.mjs';
import { t } from '../i18n.mjs';
import { DEFAULT_EDITOR_PREFERENCES } from '../core/default-settings.mjs';

export class DirectPlacement {
  constructor(wrap, timeline, batchControls, getContext, { pause, changed, closed, reportError = console.error }) {
    Object.assign(this, { wrap, timeline, batchControls, getContext, pause, changed, closed, reportError });
    this.opacity = DEFAULT_EDITOR_PREFERENCES.placementOpacity;
    this.host = document.createElement('div'); this.host.className = 'direct-placement'; this.host.hidden = true;
    this.surface = document.createElement('div'); this.surface.className = 'direct-placement-surface'; this.host.append(this.surface); wrap.append(this.host);
    for (const type of ['pointerdown', 'click', 'contextmenu']) this.host.addEventListener(type, event => event.stopPropagation());
    timeline.notesCanvas.addEventListener('pointerdown', event => { if (this.active) this.pointerId = event.pointerId; });
    window.addEventListener('pointermove', event => {
      const batch = batchControls.active;
      if (this.active && batch?.pointerId === event.pointerId && event.target !== batch.button) batchControls.move(event);
      if (this.active && this.pointerId === event.pointerId && timeline.drag && event.target !== timeline.notesCanvas) { event.preventDefault(); timeline.move(event); }
    }, true);
    window.addEventListener('pointerup', event => {
      const batch = batchControls.active;
      if (this.active && batch?.pointerId === event.pointerId && event.target !== batch.button) batchControls.end(event);
      if (this.active && this.pointerId === event.pointerId) { if (event.target !== timeline.notesCanvas) timeline.up(event); this.pointerId = null; }
    }, true);
    window.addEventListener('pointercancel', event => {
      if (this.active && batchControls.active?.pointerId === event.pointerId) batchControls.cancel();
      if (this.active && this.pointerId === event.pointerId) { timeline.cancelPlacement(); this.pointerId = null; }
    });
    window.addEventListener('blur', () => { if (this.active && this.pointerId != null) { timeline.cancelPlacement(); this.pointerId = null; } });
  }
  get active() { return Boolean(this.session); }
  open(index) {
    this.close();
    const { session, preview } = this.getContext(); if (!preview.visible || !session.chart.judgeLineList[index]) return;
    this.pause(); this.batchControls.cancel(); this.timeline.cancelPlacement();
    this.session = session; this.lineIndex = index; this.multiEnabled = session.multiLineEnabled;
    this.previewState = { noteOpacity: preview.noteOpacity, noteCenterLine: preview.noteCenterLine, noteCenters: preview.noteCenters };
    preview.noteOpacity = .3; preview.noteCenterLine = index; preview.noteCenters = new Map();
    session.multiLineEnabled = false; session.focus = 'notes'; session.eventSelection.clear();
    this.anchor = document.createComment('notes-editor'); this.timeline.notesCanvas.before(this.anchor);
    this.canvasStyle = this.timeline.notesCanvas.getAttribute('style'); this.marqueeOverlay = this.timeline.marqueeOverlay; this.timeline.marqueeOverlay = false;
    this.canvasLabel = this.timeline.notesCanvas.getAttribute('aria-label'); this.timeline.notesCanvas.setAttribute('aria-label', t('direct-placement.canvas'));
    this.surface.append(this.timeline.notesCanvas, this.batchControls.groups.get('notes').host);
    this.host.hidden = false; document.querySelector('.editor')?.classList.add('direct-placement-active');
    this.layout(); this.timeline.cursor = this.timeline.clipboardPointer = null; session.notify(); this.changed();
  }
  close() {
    if (!this.active) return;
    Object.assign(this.getContext().preview, this.previewState);
    this.batchControls.cancel(); this.timeline.cancelPlacement(); this.timeline.noteView = null; this.timeline.cursor = this.timeline.clipboardPointer = null;
    this.timeline.marqueeOverlay = this.marqueeOverlay; this.anchor.replaceWith(this.timeline.notesCanvas);
    if (this.canvasStyle === null) this.timeline.notesCanvas.removeAttribute('style'); else this.timeline.notesCanvas.setAttribute('style', this.canvasStyle);
    if (this.canvasLabel === null) this.timeline.notesCanvas.removeAttribute('aria-label'); else this.timeline.notesCanvas.setAttribute('aria-label', this.canvasLabel);
    this.batchControls.stage.append(this.batchControls.groups.get('notes').host); this.batchControls.groups.get('notes').signature = '';
    if (this.multiEnabled && this.session.multiLineMode === 'notes' && this.session.lineIndex === this.lineIndex) this.session.multiLineSelection.set(this.lineIndex, new Set(this.session.selection));
    this.session.multiLineEnabled = this.multiEnabled; const session = this.session; this.session = null;
    this.pointerId = null;
    this.host.hidden = true; document.querySelector('.editor')?.classList.remove('direct-placement-active'); this.closed?.(); session.notify(); this.changed();
  }
  layout() {
    try { return this.updateLayout(); }
    catch (error) { this.fail(error); return false; }
  }
  fail(error) {
    this.close(); this.reportError(error);
  }
  updateLayout() {
    if (!this.active) return false;
    const { session, preview, tempo, seconds } = this.getContext();
    if (session !== this.session || !preview.visible || session.lineIndex !== this.lineIndex || !session.line) { this.close(); return false; }
    const canvas = preview.canvas.getBoundingClientRect(); if (!canvas.width || !canvas.height) return false;
    const viewport = previewViewport(canvas.width, canvas.height, preview.aspectRatio ?? 1.5);
    if (preview.largeChartView) preview.largeChartView.prepare(preview, session.chart, tempo);
    else preview.scene.compile(session.chart, tempo);
    const positionScale = previewPositionScale(preview.aspectRatio ?? 1.5), state = preview.scene.sampler(seconds, positionScale)(this.lineIndex), scale = viewport.scale / (preview.viewDivisor ?? 1);
    const guide = { x: canvas.width / 2 + state.x * scale, y: canvas.height / 2 - state.y * scale, rotation: state.rotation };
    const local = previewNotePosition({ x: 1, y: 1, tail: 1 }, session.line, positionScale), localX = local.x;
    const plane = directPlacementPlane(guide, viewport, scale * localX); if (!plane) return false;
    const signature = [tempo, session.line.bpmfactor ?? 1, ...(session.line.eventLayers ?? []).map(layer => layer?.speedEvents)];
    if (!this.flowSignature || signature.length !== this.flowSignature.length || signature.some((value, index) => value !== this.flowSignature[index])) {
      this.flowSignature = signature; this.flow = new PlacementFlow(preview.scene.lines[this.lineIndex], tempo);
    }
    const flowView = placementFlowView(this.flow, seconds, plane, scale * local.y);
    this.plane = plane;
    this.host.style.clipPath = `inset(${viewport.top}px ${Math.max(0, canvas.width - viewport.left - viewport.width)}px ${Math.max(0, canvas.height - viewport.top - viewport.height)}px ${viewport.left}px)`;
    this.surface.style.width = plane.width + 'px'; this.surface.style.height = plane.height + 'px'; this.surface.style.transform = `matrix(${plane.matrix.join(',')})`;
    this.timeline.notesCanvas.style.width = plane.width + 'px'; this.timeline.notesCanvas.style.height = plane.height + 'px';
    this.timeline.notesCanvas.style.opacity = '1';
    this.timeline.noteView = { ...plane, ...flowView, viewport, panelOpacity: this.opacity,
      renderScale: this.timeline.noteScale * 175 * scale / 68,
      connections: (context, notes) => this.drawConnections(context, notes, preview, plane, viewport),
      point: event => plane.point({ x: event.clientX - canvas.left, y: event.clientY - canvas.top }) };
    this.timeline.origin = tempo.beat(seconds, session.line.bpmfactor ?? 1); return true;
  }
  drawConnections(context, notes, preview, plane, viewport) {
    this.connectionCount = 0; if (!preview.noteCenters?.size) return;
    context.save(); context.strokeStyle = '#65e78d'; context.globalAlpha = .6; context.lineWidth = 1.1; context.setLineDash([4, 5]); context.beginPath();
    for (const { index, note } of notes) {
      const hit = preview.noteCenters.get(index); if (!hit) continue;
      const x = this.timeline.noteHorizontal(note.positionX), head = this.timeline.noteVertical(note), tail = this.timeline.noteVertical(note, 'endTime');
      const start = plane.screen({ x, y: note.type === 2 ? (head + tail) / 2 : head });
      if (start.x < viewport.left - 12 || start.x > viewport.left + viewport.width + 12 || start.y < viewport.top - 12 || start.y > viewport.top + viewport.height + 12) continue;
      const end = { x: (hit.x1 + hit.x2) / 2, y: (hit.y1 + hit.y2) / 2 };
      if (Math.hypot(start.x - end.x, start.y - end.y) < 2) continue;
      const segment = clipPlacementConnection(start, end, viewport); if (!segment) continue;
      const [from, to] = segment.map(plane.point); context.moveTo(from.x, from.y); context.lineTo(to.x, to.y); this.connectionCount++;
    }
    context.stroke(); context.restore();
  }
  draw(prepared = false) {
    try { if ((prepared && this.active) || this.layout()) this.timeline.draw(this.timeline.origin); }
    catch (error) { this.fail(error); }
  }
}
