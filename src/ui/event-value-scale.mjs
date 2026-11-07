import { captureSelection } from '../application/batch-edit.mjs';
import { canScaleEventValue, eventScaleColumns, eventScaleKey, eventScaleAxisSnap, eventScaleRuler } from '../core/event-value-scale.mjs';
import { editorSkinContext } from './editor-skin-canvas.mjs';
import { beatValue } from '../core/beat.mjs';
import { evaluateNumericExpression } from '../core/numeric-expression.mjs';
import { numericExpressionSource } from './numeric-expression-input.mjs';
import { t } from '../i18n.mjs';

export class EventValueScale {
  constructor(controls) {
    this.controls = controls; this.timeline = controls.timeline; this.owner = controls.getSession();
    this.layer = this.owner.eventLayer; this.extended = this.timeline.extended;
    this.columns = new Map(); this.refresh();
    this.labels = [];
    if (!this.columns.size) throw Error(t('event-scale.unsupported'));
    const skipped = this.snapshot.events.filter(entry => !canScaleEventValue(entry)).length;
    if (skipped) this.timeline.notify?.(t('event-scale.skipped', { count: skipped }), 'warning');
    this.panel = document.createElement('div'); this.panel.className = 'event-value-scale-mode';
    const title = document.createElement('span'); title.textContent = t('event-scale.title');
    const exit = document.createElement('button'); exit.type = 'button'; exit.textContent = '×'; exit.title = t('event-scale.exit'); exit.setAttribute('aria-label', exit.title);
    exit.onclick = () => { controls.exitValueScale(); exit.blur(); };
    this.panel.append(title, exit); controls.stage.append(this.panel);
    this.ball = controls.groups.get('events').host.querySelector('[data-kind="event-end"]');
    this.ballTitle = this.ball.title; this.ball.title = t('event-scale.drag'); this.ball.setAttribute('aria-label', this.ball.title);
    const canvas = this.timeline.eventsCanvas;
    this.onDown = event => this.down(event); this.onMove = event => this.move(event); this.onUp = event => this.up(event); this.onCancel = () => this.cancelAxis();
    canvas.addEventListener('pointerdown', this.onDown, true);
    for (const [name, fn] of [['pointermove', this.onMove], ['pointerup', this.onUp], ['pointercancel', this.onCancel]]) window.addEventListener(name, fn, true);
    window.addEventListener('blur', this.onCancel);
    this.onInputKey = event => {
      if (!this.axisInput || event.target !== this.axisInput.input || !['Escape', 'Enter'].includes(event.key) || event.isComposing) return;
      event.preventDefault(); event.stopImmediatePropagation();
      this.finishAxisInput(event.key === 'Enter');
    };
    window.addEventListener('keydown', this.onInputKey, true);
    this.timeline.eventValueScale = this; this.timeline.changed();
    this.onSelectionChange = () => { this.selectionDirty = true; };
    this.owner.addEventListener('change', this.onSelectionChange);
  }
  refresh() {
    this.snapshot = captureSelection(this.owner); this.snapshot.notes = [];
    this.columns = eventScaleColumns(this.snapshot.events, this.columns);
    this.chart = this.owner.chart; this.signature = this.controls.signature('events', this.owner);
  }
  sync() {
    const options = this.controls.valueScaleOptions();
    if (!options.enabled || options.available === false || this.controls.getSession() !== this.owner || this.owner.eventLayer !== this.layer || this.timeline.extended !== this.extended) { this.controls.exitValueScale(); return; }
    if (this.selectionDirty || this.owner.chart !== this.chart) {
      this.selectionDirty = false;
      if (this.owner.chart !== this.chart || this.controls.signature('events', this.owner) !== this.signature) {
        this.cancelAxis(); this.finishAxisInput(false); this.refresh(); this.timeline.changed();
        if (!this.columns.size) { this.controls.exitValueScale(); return; }
      }
    }
    const visible = this.controls.enabled() && !this.timeline.notesOnly && !this.timeline.noteView;
    this.panel.hidden = !visible;
    if (!visible) { this.cancelAxis(); this.finishAxisInput(true); }
    const canvas = this.timeline.eventsCanvas.getBoundingClientRect(), stage = this.controls.stage.getBoundingClientRect();
    this.panel.style.left = '8px'; this.panel.style.top = `${Math.max(4, canvas.top - stage.top + 27)}px`;
    this.updateRuler();
  }
  range(type, lineIndex) { return this.columns.get(eventScaleKey(lineIndex, type))?.range; }
  geometry(column, width) {
    const timeline = this.timeline, channel = timeline.eventTypes.indexOf(column.type); if (channel < 0) return null;
    const panel = timeline.panelIndex(column.lineIndex, 'events'); if (panel < 0) return null;
    if (!this.owner.multiLineActive && column.lineIndex !== this.owner.lineIndex) return null;
    const bounds = timeline.eventColumnBounds(channel, timeline.panelWidth(width, 'events'));
    const offset = panel * timeline.panelStride(width, 'events') - timeline.multiLineViewportOffset(width, 'events');
    const padding = this.owner.multiLineActive ? 4 : 6, left = bounds.x + offset + padding, span = Math.max(1, bounds.width - padding * 2);
    const units = (column.range.max - column.range.min) / span;
    return { left, span, units, horizontal: value => left + (value - column.range.min) / units, value: x => column.range.min + (x - left) * units };
  }
  draw(context, width, height) {
    this.labels.length = 0;
    if (this.panel.hidden) return;
    context.save(); context.beginPath(); context.rect(0, 23, width, height - 23); context.clip();
    for (const column of this.columns.values()) {
      const geometry = this.geometry(column, width); if (!geometry || geometry.left > width || geometry.left + geometry.span < 0) continue;
      const x = geometry.horizontal(column.axis);
      context.strokeStyle = '#fff3a3'; context.lineWidth = 2; context.setLineDash([8, 5]);
      context.beginPath(); context.moveTo(x, 23); context.lineTo(x, height); context.stroke();
      context.setLineDash([]); context.font = '12px RPE, sans-serif'; context.textAlign = 'left';
      const text = t('event-scale.axis') + (Math.abs(column.axis) < .005 ? 0 : column.axis).toFixed(2), labelWidth = context.measureText(text).width + 10;
      const left = Math.max(1, Math.min(width - labelWidth - 1, x + 6));
      const label = { column, x: left, y: height - 53, width: labelWidth, height: 22 };
      while (this.labels.some(other => label.x < other.x + other.width + 3 && label.x + label.width + 3 > other.x && Math.abs(label.y - other.y) < 23)) label.y -= 24;
      this.labels.push(label);
      if (this.axisInput?.column !== column) {
        context.fillStyle = '#202020e8'; context.fillRect(left, label.y, labelWidth, 22); context.fillStyle = '#fff3a3'; context.fillText(text, left + 5, label.y + 16);
      } else this.positionAxisInput(label);
    }
    this.drawSnap(context, width, height);
    context.restore();
  }
  drawSnap(context, width, height) {
    const drag = this.axisDrag, snap = drag?.snap;
    if (!snap?.kind) return;
    const x = drag.geometry.horizontal(snap.value);
    context.setLineDash([]); context.strokeStyle = '#8fffe1'; context.fillStyle = '#8fffe1'; context.lineWidth = 2;
    for (const target of snap.targets.slice(0, 16)) {
      const event = target.event, beat = target.kind === 'middle' ? (beatValue(event.startTime) + beatValue(event.endTime)) / 2 : beatValue(event[target.kind === 'start' ? 'startTime' : 'endTime']);
      const y = this.owner.multiLineActive && this.owner.multiLineMode === 'events' ? this.timeline.verticalForLine(beat, drag.column.lineIndex, height) : this.timeline.eventVertical(beat, drag.column.type);
      if (y < 23 || y > height) continue;
      context.beginPath(); context.arc(x, y, 5, 0, Math.PI * 2); context.stroke();
      context.beginPath(); context.moveTo(x - 8, y); context.lineTo(x + 8, y); context.stroke();
    }
  }
  updateRuler() {
    const active = this.controls.active;
    if (active?.kind !== 'event-value-scale' || this.panel.hidden) { this.hideRuler(); return; }
    const canvas = this.timeline.eventsCanvas.getBoundingClientRect(), stage = this.controls.stage.getBoundingClientRect();
    const offsetX = canvas.left - stage.left, offsetY = canvas.top - stage.top;
    const layout = eventScaleRuler(active, { left: -offsetX, right: stage.width - offsetX, top: -offsetY, bottom: stage.height - offsetY });
    if (layout.right <= layout.left) { this.hideRuler(); return; }
    const ratio = globalThis.devicePixelRatio || 1, signature = [layout.left, layout.right, layout.top, layout.origin, layout.marker, layout.pixels, offsetX, offsetY, ratio].join(':');
    if (this.rulerCanvas && !this.rulerCanvas.hidden && this.rulerSignature === signature) return;
    this.rulerSignature = signature;
    if (!this.rulerCanvas) {
      this.rulerCanvas = document.createElement('canvas'); this.rulerCanvas.className = 'event-scale-ruler';
      this.rulerCanvas.setAttribute('aria-hidden', 'true'); this.controls.stage.append(this.rulerCanvas);
    }
    const surface = this.rulerCanvas, width = layout.right - layout.left;
    surface.hidden = false; surface.style.left = `${offsetX + layout.left}px`; surface.style.top = `${offsetY + layout.top - 6}px`;
    surface.style.width = `${width}px`; surface.style.height = '46px';
    const pixelWidth = Math.ceil(width * ratio), pixelHeight = Math.ceil(46 * ratio);
    if (surface.width !== pixelWidth || surface.height !== pixelHeight) { surface.width = pixelWidth; surface.height = pixelHeight; }
    const raw = surface.getContext('2d'); raw.setTransform(ratio, 0, 0, ratio, 0, 0); raw.clearRect(0, 0, pixelWidth / ratio, pixelHeight / ratio);
    raw.translate(-layout.left, 6);
    this.drawRuler(editorSkinContext(raw, 'events'), layout);
  }
  hideRuler() { if (this.rulerCanvas) this.rulerCanvas.hidden = true; this.rulerSignature = ''; }
  drawRuler(context, { left, right, origin, marker, pixels }) {
    context.fillStyle = '#202020e8'; context.fillRect(left, 0, right - left, 40);
    context.strokeStyle = '#b8eaff'; context.fillStyle = '#d6f2ff'; context.font = '11px RPE, sans-serif'; context.textAlign = 'center'; context.lineWidth = 1;
    context.beginPath(); context.moveTo(left, 1); context.lineTo(right, 1); context.stroke();
    // Major ticks are 0.5, medium ticks 0.1, and minor ticks 0.05 when readable.
    const minor = pixels * .05 >= 4 ? .05 : .1;
    const first = Math.ceil((1 + (left - origin) / pixels) / minor), last = Math.floor((1 + (right - origin) / pixels) / minor);
    for (let i = first; i <= last; i++) {
      const value = i * minor, x = origin + (value - 1) * pixels;
      const major = Math.abs(value * 2 - Math.round(value * 2)) < 1e-7, medium = Math.abs(value * 10 - Math.round(value * 10)) < 1e-7;
      context.beginPath(); context.moveTo(x, 1); context.lineTo(x, major ? 16 : medium ? 11 : 6); context.stroke();
      if (major && x > left + 11 && x < right - 11) context.fillText(value.toFixed(1), x, 32);
    }
    context.strokeStyle = '#fff3a3'; context.lineWidth = 2; context.beginPath(); context.moveTo(marker, -4); context.lineTo(marker, 17); context.stroke();
    context.textAlign = 'left';
  }
  positionAxisInput(label) {
    const edit = this.axisInput; if (!edit) return;
    const canvas = this.timeline.eventsCanvas.getBoundingClientRect(), stage = this.controls.stage.getBoundingClientRect();
    edit.wrap.style.left = `${canvas.left - stage.left + label.x}px`; edit.wrap.style.top = `${canvas.top - stage.top + label.y - 2}px`;
  }
  openAxisInput(label) {
    this.finishAxisInput(true); this.cancelAxis();
    const wrap = document.createElement('label'); wrap.className = 'event-scale-axis-input';
    const title = document.createElement('span'); title.textContent = t('event-scale.axis');
    const input = document.createElement('input'); input.type = 'number'; input.step = 'any'; input.value = String(label.column.axis); input.setAttribute('aria-label', t('event-scale.axis'));
    wrap.append(title, input); this.controls.stage.append(wrap);
    const edit = this.axisInput = { wrap, input, column: label.column, original: label.column.axis, range: { ...label.column.range } };
    const update = () => {
      try {
        const value = evaluateNumericExpression(numericExpressionSource(input));
        if (!Number.isFinite(value)) return;
        edit.column.axis = value;
        const span = Math.max(edit.range.max - edit.range.min, 1);
        edit.column.range = { min: Math.min(edit.range.min, value - span * .1), max: Math.max(edit.range.max, value + span * .1) };
        this.timeline.changed();
      } catch { /* Preserve unfinished input without writing it. */ }
    };
    input.oninput = event => { if (!event.isComposing) update(); }; input.onchange = update;
    input.onblur = () => this.finishAxisInput(true);
    this.positionAxisInput(label); input.focus({ preventScroll: true }); input.select(); this.timeline.changed();
  }
  finishAxisInput(apply) {
    const edit = this.axisInput; if (!edit) return;
    this.axisInput = null;
    if (!apply) { edit.column.axis = edit.original; edit.column.range = edit.range; }
    edit.input.onblur = null; edit.wrap.remove(); this.timeline.changed();
  }
  down(event) {
    if (event.button !== 0 || this.controls.active || this.panel.hidden) return;
    const point = this.timeline.point(event, this.timeline.eventsCanvas), width = this.timeline.eventsCanvas.clientWidth;
    if (point.y < 23) return;
    const label = this.labels.findLast(label => point.x >= label.x && point.x <= label.x + label.width && point.y >= label.y && point.y <= label.y + label.height);
    if (label) { event.preventDefault(); event.stopImmediatePropagation(); this.openAxisInput(label); return; }
    this.finishAxisInput(true);
    let best, distance = 7;
    for (const column of this.columns.values()) {
      const geometry = this.geometry(column, width); if (!geometry || point.x < geometry.left - 7 || point.x > geometry.left + geometry.span + 7) continue;
      const delta = Math.abs(point.x - geometry.horizontal(column.axis));
      if (delta <= distance) { best = { column, geometry }; distance = delta; }
    }
    if (!best) return;
    event.preventDefault(); event.stopImmediatePropagation();
    this.axisDrag = { ...best, original: best.column.axis, pointerId: event.pointerId, point };
    this.timeline.eventsCanvas.setPointerCapture(event.pointerId);
  }
  move(event) {
    const drag = this.axisDrag; if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const point = this.timeline.point(event, this.timeline.eventsCanvas), { geometry, column } = drag;
    const x = Math.max(geometry.left, Math.min(geometry.left + geometry.span, point.x));
    drag.point = point; drag.snap = eventScaleAxisSnap(geometry.value(x), column, geometry.units);
    column.axis = drag.snap.value; this.timeline.changed();
  }
  up(event) {
    if (!this.axisDrag || event.pointerId !== this.axisDrag.pointerId) return;
    event.preventDefault(); event.stopImmediatePropagation(); this.move(event);
    const drag = this.axisDrag; this.axisDrag = null;
    if (this.timeline.eventsCanvas.hasPointerCapture(drag.pointerId)) this.timeline.eventsCanvas.releasePointerCapture(drag.pointerId);
  }
  cancelAxis() {
    if (!this.axisDrag) return;
    const drag = this.axisDrag; this.axisDrag = null; drag.column.axis = drag.original;
    if (this.timeline.eventsCanvas.hasPointerCapture(drag.pointerId)) this.timeline.eventsCanvas.releasePointerCapture(drag.pointerId);
    this.timeline.changed();
  }
  dispose() {
    this.cancelAxis(); this.finishAxisInput(true); this.panel.remove();
    if (this.rulerCanvas) { this.rulerCanvas.width = this.rulerCanvas.height = 1; this.rulerCanvas.remove(); this.rulerCanvas = null; }
    this.ball.title = this.ballTitle; this.ball.setAttribute('aria-label', this.ballTitle);
    this.owner.removeEventListener('change', this.onSelectionChange);
    this.timeline.eventsCanvas.removeEventListener('pointerdown', this.onDown, true);
    for (const [name, fn] of [['pointermove', this.onMove], ['pointerup', this.onUp], ['pointercancel', this.onCancel]]) window.removeEventListener(name, fn, true);
    window.removeEventListener('blur', this.onCancel);
    window.removeEventListener('keydown', this.onInputKey, true);
    if (this.timeline.eventValueScale === this) this.timeline.eventValueScale = null;
    this.timeline.eventsCanvas.style.cursor = ''; this.columns.clear(); this.timeline.changed();
  }
}
