import { SpeedCurveModel } from '../core/speed-curve.mjs';
import { editSpeedCurveNode, addSpeedCurveNode, deleteSpeedCurveNode } from '../application/speed-curve.mjs';
import { beatValue } from '../core/beat.mjs';
import { isTextEntry } from './keyboard.mjs';
import { shortcutAction } from '../core/preferences.mjs';
import { t } from '../i18n.mjs';
import { readSpeedCurvePreferences, writeSpeedCurvePreferences } from '../platform/speed-curve-preferences.mjs';

const svg = paths => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const icons = {
  curve: '<path d="M3 18C8 18 6 5 12 5s4 13 9 13"/><path d="M3 3v18h18"/>',
  edit: '<path d="m5 16-1 4 4-1L20 7l-3-3Z"/><path d="m14 7 3 3"/>',
  add: '<path d="M12 5v14M5 12h14"/>', delete: '<path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13M10 10v7M14 10v7"/>',
  snap: '<path d="M5 4v9a7 7 0 0 0 14 0V4h-5v9a2 2 0 0 1-4 0V4ZM5 8h5m4 0h5"/>',
  fit: '<path d="M4 9V4h5m6 0h5v5M4 15v5h5m6 0h5v-5"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>',
};
const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
const fmt = value => Number.isFinite(value) ? String(Number(value.toFixed(3))) : '—';
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export function singleSpeedCurveNote(session) {
  if (session.focus !== 'notes' || session.largeDocument?.logicalSelection && session.largeDocument.selectedCount !== 1) return null;
  const entries = session.selectedNoteEntries(); return entries.length === 1 ? entries[0] : null;
}

export class SpeedCurvePanel {
  constructor(getContext, { invalidate = () => {}, pause = () => {} } = {}) {
    this.getContext = getContext; this.invalidate = invalidate; this.pause = pause; this.active = false;
    // Build DOM, observers, curves and input handlers only on the first open.
  }
  get context() { return this.getContext(); }
  button(icon, key, callback, text = false) {
    const button = el('button', 'speed-curve-button'); button.type = 'button'; button.title = t(key); button.setAttribute('aria-label', t(key));
    button.innerHTML = svg(icons[icon]); if (text) button.append(el('span', '', t(key))); button.onclick = callback; return button;
  }
  build() {
    const root = this.root = el('section', 'speed-curve-panel'); root.id = 'speed-curve-panel'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', t('speed-curve.title')); root.hidden = true;
    const header = this.header = el('div', 'speed-curve-header');
    const mark = el('span', 'speed-curve-mark'); mark.innerHTML = svg(icons.curve); this.title = el('strong', '', t('speed-curve.title')); this.owner = el('span', 'speed-curve-owner');
    header.append(mark, this.title, this.owner, this.button('close', 'speed-curve.close', () => this.close())); root.append(header);
    const toolbar = el('div', 'speed-curve-toolbar'); this.modeButtons = new Map();
    for (const mode of ['edit', 'add', 'delete']) { const button = this.button(mode, 'speed-curve.' + mode, () => this.setMode(mode), true); button.dataset.speedCurveMode = mode; toolbar.append(button); this.modeButtons.set(mode, button); }
    const spacer = el('span', 'speed-curve-spacer'); this.layer = el('select'); this.layer.setAttribute('aria-label', t('speed-curve.layer'));
    this.layer.onchange = () => { this.finish(false); this.activeLayer = Number(this.layer.value); this.selected = null; this.syncFields(); this.schedule(); this.saveView(); };
    this.snap = this.button('snap', 'speed-curve.snap', () => { this.snapY = !this.snapY; this.snap.setAttribute('aria-pressed', String(this.snapY)); this.snap.classList.toggle('active', this.snapY); this.saveView(); });
    const snapLabel = el('label', 'speed-curve-snap-step', t('speed-curve.snapStep')); this.snapInput = el('input'); this.snapInput.type = 'number'; this.snapInput.step = 'any'; this.snapInput.min = .001; this.snapInput.max = 1000000; this.snapInput.setAttribute('aria-label', t('speed-curve.snapStep')); this.snapInput.dataset.speedCurveSnapStep = '';
    this.snapInput.oninput = () => { const value = Number(this.snapInput.value); if (this.snapInput.value.trim() && value >= .001 && value <= 1000000) { this.snapStep = value; this.saveView(); } };
    this.snapInput.onchange = () => { const value = Number(this.snapInput.value); if (!this.snapInput.value.trim() || !(value >= .001 && value <= 1000000)) this.message('speed-curve.error.snapStep', true); };
    this.snapInput.onblur = () => { this.snapInput.value = this.snapStep; };
    this.snapInput.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); this.snapInput.onchange(); this.snapInput.blur(); } };
    snapLabel.append(this.snapInput);
    toolbar.append(spacer, this.layer, this.snap, snapLabel, this.button('fit', 'speed-curve.fit', () => this.fit())); root.append(toolbar);
    this.fields = el('div', 'speed-curve-fields'); this.inputs = {};
    for (const [key, unit] of [['beat', 'speed-curve.time'], ['distance', 'speed-curve.distance'], ['easing', 'speed-curve.easing']]) {
      const label = el('label'); label.append(el('span', '', t(unit))); const input = el('input'); input.type = 'number'; input.step = key === 'easing' ? 1 : 'any'; input.setAttribute('aria-label', t(unit)); input.dataset.speedCurveField = key;
      if (key === 'easing') { input.min = 1; input.max = 29; }
      input.onfocus = () => { if (this.selected) this.begin(); };
      input.oninput = () => this.input(key);
      input.onchange = () => { this.input(key); this.finish(!this.editError); };
      input.onblur = () => { if (this.transaction) this.finish(!this.editError); this.syncFields(); };
      input.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); this.input(key); this.finish(!this.editError); input.blur(); } };
      label.append(input); this.inputs[key] = input; this.fields.append(label);
    }
    this.speedLabel = el('output', 'speed-curve-speed'); this.fields.append(this.speedLabel); root.append(this.fields);
    const body = el('div', 'speed-curve-body'); const plot = this.plot = el('div', 'speed-curve-plot'); this.canvas = el('canvas'); this.canvas.tabIndex = 0; this.canvas.setAttribute('aria-label', t('speed-curve.graph')); this.labels = el('div', 'speed-curve-labels'); plot.append(this.canvas, this.labels);
    this.zoom = el('input', 'speed-curve-y-zoom'); this.zoom.type = 'range'; this.zoom.min = 2.3; this.zoom.max = 5; this.zoom.step = .01; this.zoom.value = Math.log10(1600); this.zoom.setAttribute('aria-label', t('speed-curve.zoomY'));
    this.zoom.oninput = () => { this.limit = 10 ** Number(this.zoom.value); this.schedule(); this.saveView(); };
    const zoomControl = el('div', 'speed-curve-y-control'); zoomControl.append(this.zoom); body.append(plot, zoomControl); root.append(body);
    const range = el('div', 'speed-curve-range'); this.rangeStart = el('output'); this.pan = el('input'); this.pan.type = 'range'; this.pan.step = 'any'; this.pan.setAttribute('aria-label', t('speed-curve.range'));
    this.pan.oninput = () => { this.start = Number(this.pan.value); this.schedule(); this.saveView(); };
    const spanLabel = el('label', '', t('speed-curve.span')); this.spanInput = el('input'); this.spanInput.type = 'number'; this.spanInput.min = .25; this.spanInput.max = 4096; this.spanInput.step = .25; this.spanInput.value = 8; this.spanInput.setAttribute('aria-label', t('speed-curve.span'));
    this.spanInput.onchange = () => { const span = Number(this.spanInput.value); if (!(span >= .25 && span <= 4096)) { this.message('speed-curve.error.span', true); return; } const anchor = this.start + this.span * .8; this.span = span; this.start = anchor - span * .8; this.updateRange(); this.schedule(); this.saveView(); };
    spanLabel.append(this.spanInput); range.append(this.rangeStart, this.pan, spanLabel); root.append(range);
    const footer = el('div', 'speed-curve-footer'); this.hint = el('span'); this.status = el('span', 'speed-curve-status'); this.status.setAttribute('role', 'status'); this.status.setAttribute('aria-live', 'polite'); footer.append(this.hint, this.status); root.append(footer); document.body.append(root);
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) this.canvas.addEventListener(type, event => this[type](event));
    for (const type of ['pointerenter', 'pointermove']) plot.addEventListener(type, event => { this.pointerLocation = { clientX: event.clientX, clientY: event.clientY }; });
    plot.addEventListener('pointerleave', () => { this.pointerLocation = null; if (this.hoverAdd) { this.hoverAdd = null; this.schedule(); } });
    this.canvas.addEventListener('wheel', event => { event.preventDefault(); event.stopPropagation(); if (event.ctrlKey) { const step = Number(this.zoom.step) * (event.deltaY > 0 ? 4 : -4); this.zoom.value = String(clamp(Number(this.zoom.value) + step, Number(this.zoom.min), Number(this.zoom.max))); this.zoom.oninput(); } else { this.start += Math.sign(event.deltaY) * this.span * .1; this.updateRange(); this.schedule(); this.saveView(); } }, { passive: false });
    root.addEventListener('contextmenu', event => event.preventDefault());
    root.addEventListener('pointerdown', event => event.stopPropagation());
    header.onpointerdown = event => {
      if (event.button !== 0 || event.target.closest('button')) return;
      event.preventDefault(); header.setPointerCapture(event.pointerId); const rect = root.getBoundingClientRect(); this.positionDrag = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
    };
    header.onpointermove = event => { const drag = this.positionDrag; if (!drag) return; const bounds = root.getBoundingClientRect(); root.style.left = `${clamp(drag.left + event.clientX - drag.x, 4, innerWidth - bounds.width - 4)}px`; root.style.top = `${clamp(drag.top + event.clientY - drag.y, 4, innerHeight - bounds.height - 4)}px`; };
    header.onpointerup = header.onpointercancel = () => { this.positionDrag = null; this.saveView(); };
  }
  open(anchor) {
    const context = this.context, entry = singleSpeedCurveNote(context.session); if (!entry) return false;
    this.close(); if (!this.root) this.build();
    this.active = true; this.session = context.session; this.entry = entry; this.note = entry.note;
    this.model = new SpeedCurveModel(this.session.chart, entry.lineIndex, this.note); this.activeLayer = Math.min(context.timeline.layer ?? 0, Math.max(0, this.model.layers.length - 1));
    const saved = readSpeedCurvePreferences();
    this.span = saved.span; this.spanInput.value = this.span; this.start = this.model.hitBeat + saved.offset; this.limit = saved.limit; this.zoom.value = Math.log10(this.limit); this.snapY = saved.snapY; this.snapStep = saved.snapStep; this.snapInput.value = this.snapStep; this.snap.setAttribute('aria-pressed', String(this.snapY)); this.snap.classList.toggle('active', this.snapY);
    this.activeLayer = Math.min(saved.layer, Math.max(0, this.model.layers.length - 1));
    this.selected = null; this.root.hidden = false; this.status.textContent = ''; this.status.classList.remove('error'); this.setMode('edit'); this.populateLayers(); this.updateRange(); this.syncFields();
    const width = Math.min(saved.width, innerWidth - 16); this.root.style.width = `${width}px`; this.root.style.height = `${Math.min(saved.height, innerHeight - 16)}px`;
    const height = this.root.getBoundingClientRect().height;
    this.root.style.left = `${clamp(saved.left ?? anchor?.x ?? innerWidth / 3, 8, Math.max(8, innerWidth - width - 8))}px`;
    this.root.style.top = `${clamp(saved.top ?? ((anchor?.y ?? 180) + 16 + height < innerHeight ? (anchor?.y ?? 180) + 16 : (anchor?.y ?? 180) - height - 16), 8, Math.max(8, innerHeight - height - 8))}px`;
    this.changed = () => this.sync(); this.session.addEventListener('change', this.changed);
    this.blur = () => { this.pointerLocation = null; if (this.transaction) this.finish(false); };
    this.theme = () => this.schedule(); window.addEventListener('blur', this.blur); document.addEventListener('rpen-editor-skin-changed', this.theme);
    this.windowResize = () => { this.clampLayout(); this.schedule(); this.saveView(); }; window.addEventListener('resize', this.windowResize);
    this.unload = () => this.saveView(true); window.addEventListener('beforeunload', this.unload);
    this.observer = new ResizeObserver(() => { if (!this.active) return; this.clampLayout(); this.schedule(); this.saveView(); }); this.observer.observe(this.root); this.observer.observe(this.plot); this.schedule(); return true;
  }
  close() {
    if (!this.active) return;
    this.finish(false); this.saveView(true); this.active = false; this.session.removeEventListener('change', this.changed); this.observer?.disconnect();
    window.removeEventListener('blur', this.blur); document.removeEventListener('rpen-editor-skin-changed', this.theme);
    window.removeEventListener('resize', this.windowResize); window.removeEventListener('beforeunload', this.unload);
    if (this.frame != null) cancelAnimationFrame(this.frame); this.frame = null;
    if (this.dragFrame != null) cancelAnimationFrame(this.dragFrame); this.dragFrame = null; this.pendingDrag = null;
    this.root.hidden = true; this.labels.replaceChildren(); this.model = null; this.note = null; this.selected = null; this.positionDrag = null; this.pointerLocation = null; this.curvePixels = []; this.visibleNodes = []; this.session = null; this.entry = null;
  }
  clampLayout() {
    const rect = this.root.getBoundingClientRect();
    this.root.style.left = `${clamp(rect.left, 8, Math.max(8, innerWidth - rect.width - 8))}px`;
    this.root.style.top = `${clamp(rect.top, 8, Math.max(8, innerHeight - rect.height - 8))}px`;
  }
  saveView(immediate = false) {
    if (!this.active) return;
    clearTimeout(this.saveTimer); this.saveTimer = null;
    if (!immediate) { this.saveTimer = setTimeout(() => { this.saveTimer = null; this.saveView(true); }, 250); return; }
    const rect = this.root.getBoundingClientRect();
    try { writeSpeedCurvePreferences({ left: rect.left, top: rect.top, width: rect.width, height: rect.height, span: this.span, offset: this.start - this.model.hitBeat, limit: this.limit, snapY: this.snapY, snapStep: this.snapStep, layer: this.activeLayer }); }
    catch { this.message('speed-curve.error.preferences', true); }
  }
  sync() {
    if (!this.active || this.committing) return;
    const entry = singleSpeedCurveNote(this.context.session);
    if (this.session !== this.context.session || !entry || entry.lineIndex !== this.entry.lineIndex || entry.note !== this.note) { this.close(); return; }
    if (this.session.chart !== this.model.chart) {
      this.transaction = null; this.draft = null; this.drag = null;
      this.model = new SpeedCurveModel(this.session.chart, this.entry.lineIndex, this.note, this.model); this.selected = this.findNode(this.selected?.beat); this.populateLayers(); this.syncFields(); this.updateRange(); this.schedule();
    }
  }
  handleKeydown(event) {
    if (!this.active || event.defaultPrevented || event.isComposing || event.keyCode === 229) return false;
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); if (this.transaction || this.drag) this.finish(false); else this.close(); return true; }
    const inside = this.root.contains(event.target), body = event.target === this.root.ownerDocument.body;
    const point = this.pointerLocation && this.coords(this.pointerLocation), hovered = point && this.containsPlot(point);
    if (!inside && !(body && this.selected) && !hovered) return false;
    const action = shortcutAction(event, this.context.preferences, 'events', { hasSelection: Boolean(this.selected) });
    if (!['Delete', 'QuickDelete', 'AddTap'].includes(action)) return false;
    event.stopImmediatePropagation();
    // Leave native text editing intact, including a customized numeric key.
    if (isTextEntry(event.target)) return true;
    event.preventDefault();
    if (action === 'AddTap') {
      if (!event.repeat && hovered && !this.drag && !this.positionDrag) { this.finish(false); this.addAt(point); }
      return true;
    }
    if (!event.repeat) { this.finish(false); if (this.selected) this.remove(this.selected); }
    return true;
  }
  populateLayers() {
    this.owner.textContent = t('speed-curve.owner', { line: this.entry.lineIndex });
    this.layer.replaceChildren(...Array.from({ length: Math.max(1, this.model.layers.length) }, (_, index) => new Option(t('speed-curve.layerN', { layer: index }), String(index)))); this.layer.value = String(this.activeLayer);
  }
  setMode(mode) {
    this.finish(false); this.hoverAdd = null; this.mode = mode; for (const [key, button] of this.modeButtons) { button.setAttribute('aria-pressed', String(key === mode)); button.classList.toggle('active', key === mode); }
    this.canvas.style.cursor = mode === 'add' ? 'crosshair' : mode === 'delete' ? 'not-allowed' : 'default'; this.hint.textContent = t('speed-curve.hint.' + mode);
  }
  message(key, error = false, values) { this.status.textContent = t(key, values); this.status.classList.toggle('error', error); }
  failure(error) { const key = error.message; this.status.textContent = key.startsWith('speed-curve.') ? t(key) : key; this.status.classList.add('error'); }
  updateRange() {
    const first = this.model.nodes[0]?.beat ?? this.model.hitBeat, last = this.model.nodes.at(-1)?.beat ?? this.model.hitBeat;
    this.pan.min = Math.min(first - 16, this.model.hitBeat - 64, this.start); this.pan.max = Math.max(last + 16, this.model.hitBeat + 16, this.start + this.span) - this.span; this.pan.value = this.start;
  }
  get currentModel() { return this.draft?.model ?? this.model; }
  findNode(beat) { return Number.isFinite(beat) ? this.currentModel.nodes.find(node => Math.abs(node.beat - beat) < 1e-6) ?? null : null; }
  choose(node, field) {
    this.finish(false); this.selected = node; const ref = this.model.ref(node, this.activeLayer);
    if (ref) { this.activeLayer = ref.layer; this.layer.value = String(ref.layer); }
    else this.message('speed-curve.error.bpm', true);
    this.syncFields(); this.schedule();
    if (field && ref && !this.inputs[field].disabled) this.inputs[field].focus();
  }
  syncFields(reset = false) {
    const model = this.currentModel, node = this.selected, ref = node && model.ref(node, this.activeLayer);
    const outgoing = node && model.outgoing(node, ref?.layer ?? this.activeLayer);
    const fixed = ref?.edge === 'judgment';
    this.fields.classList.toggle('empty', !node);
    for (const [key, input] of Object.entries(this.inputs)) {
      input.disabled = !ref || (key === 'easing' ? !outgoing : key === 'beat' ? fixed : Boolean(node?.judgment));
      input.title = key === 'easing' ? outgoing ? t('speed-curve.segment', { start: fmt(outgoing.start), end: fmt(outgoing.end) }) : t('speed-curve.error.lastNode') : fixed ? t('speed-curve.judgment') : key === 'distance' && node?.judgment ? t('speed-curve.error.hit') : '';
      if (reset || document.activeElement !== input || this.drag) input.value = node && (key !== 'easing' || outgoing) ? fmt(key === 'beat' ? node.beat : key === 'distance' ? model.distance(node.beat) : outgoing.easing) : '';
    }
    this.speedLabel.textContent = node ? `${t('speed-curve.speed')} ${fmt(model.speed(node.beat))}${node.judgment ? ' · ' + t('speed-curve.judgmentShort') : node.bpm ? ' · BPM' : ''}` : t('speed-curve.select');
  }
  begin() {
    if (this.transaction || !this.selected) return;
    const ref = this.model.ref(this.selected, this.activeLayer); if (!ref) return;
    this.pause(); this.transaction = { model: this.model, node: this.selected, ref, selection: this.session.selectionState() }; this.editError = false;
  }
  input(key) {
    if (!this.selected) return; this.begin(); if (!this.transaction) return;
    const input = this.inputs[key]; if (!input.value.trim() || !Number.isFinite(Number(input.value))) { this.editError = true; this.message('speed-curve.error.number', true); return; }
    const base = this.transaction, division = Math.max(1, this.context.timeline.division);
    const options = { beat: this.selected.beat, distance: this.currentModel.distance(this.selected.beat) };
    options[key] = key === 'beat' ? Math.round(Number(input.value) * division) / division : Number(input.value);
    if (key === 'easing') { delete options.distance; if (this.inputs.easing.disabled) return; }
    this.preview(base, options);
  }
  preview(base, options) {
    try {
      this.draft = editSpeedCurveNode(base.model, base.ref, options); this.editError = false;
      this.selected = this.findNode(this.draft.beat) ?? { beat: this.draft.beat, refs: [base.ref] };
      this.status.textContent = t('speed-curve.preview', { count: this.draft.changed }); this.status.classList.remove('error'); this.syncFields(); this.schedule(); this.invalidate();
    } catch (error) { this.editError = true; this.failure(error); }
  }
  finish(apply) {
    if (!this.transaction) { this.drag = null; return; }
    const transaction = this.transaction, draft = this.draft, valid = apply && !this.editError && draft && this.session.chart === transaction.model.chart;
    this.transaction = null; this.draft = null; this.drag = null;
    if (valid) this.commit(draft, transaction.selection);
    else { this.selected = transaction.node; this.syncFields(true); this.schedule(); this.invalidate(); }
  }
  commit(result, selection = this.session.selectionState()) {
    try {
      this.committing = true; this.session.commit(t('speed-curve.undo.' + result.action), result.chart, selection);
      this.model = new SpeedCurveModel(this.session.chart, this.entry.lineIndex, this.note, this.model); this.selected = this.findNode(result.beat); this.updateRange();
      this.message(result.fitted ? 'speed-curve.done.fitted' : 'speed-curve.done.' + result.action, false, { layer: result.layer, count: result.changed });
    } catch (error) { this.failure(error); }
    finally { this.committing = false; this.syncFields(); this.schedule(); this.invalidate(); }
  }
  remove(node) { try { this.pause(); this.commit(deleteSpeedCurveNode(this.model, this.model.ref(node, this.activeLayer))); } catch (error) { this.failure(error); } }
  coords(event) { const r = this.canvas.getBoundingClientRect(); return { x: event.clientX - r.left, y: event.clientY - r.top }; }
  containsPlot(point) { const r = this.rect; return r && point.x >= r.left && point.x <= r.left + r.width && point.y >= r.top && point.y <= r.top + r.height; }
  world(point) { const r = this.rect; return { beat: this.start + (point.x - r.left) / r.width * this.span, distance: (r.top + r.height / 2 - point.y) / (r.height / 2) * this.limit }; }
  screen(beat, distance) { const r = this.rect; return { x: r.left + (beat - this.start) / this.span * r.width, y: r.top + r.height / 2 - distance / this.limit * r.height / 2 }; }
  nearest(point) { let best, distance = 13; for (const node of this.visibleNodes ?? []) { const p = this.screen(node.beat, this.currentModel.distance(node.beat)), d = Math.hypot(p.x - point.x, p.y - point.y); if (d < distance) { distance = d; best = node; } } return best; }
  additionAt(point) {
    const world = this.world(point), beat = Math.round(world.beat * this.context.timeline.division) / this.context.timeline.division;
    let near = false;
    const points = this.curvePixels ?? [], stride = this.rect.width / Math.max(1, points.length - 1);
    const first = Math.max(0, Math.floor((point.x - this.rect.left - 14) / stride)), last = Math.min(points.length - 2, Math.ceil((point.x - this.rect.left + 14) / stride));
    for (let i = first; i <= last && !near; i++) {
      const a = points[i], b = points[i + 1], dx = b.x - a.x, dy = b.y - a.y, u = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
      near = Math.hypot(point.x - a.x - u * dx, point.y - a.y - u * dy) <= 14;
    }
    return { beat, distance: near || Math.abs(beat - this.model.hitBeat) < 1e-7 ? this.model.distance(beat) : this.snapY ? Math.round(world.distance / this.snapStep) * this.snapStep : world.distance, near };
  }
  addAt(point) {
    const { beat, distance } = this.additionAt(point);
    try { this.pause(); this.commit(addSpeedCurveNode(this.model, this.activeLayer, beat, distance)); } catch (error) { this.failure(error); }
  }
  pointerdown(event) {
    if (event.button !== 0) return; event.preventDefault(); event.stopPropagation(); this.canvas.focus();
    const point = this.coords(event), node = this.nearest(point);
    if (!this.containsPlot(point)) return;
    if (this.mode === 'delete') { if (node) this.remove(node); else this.message('speed-curve.error.selectDelete', true); return; }
    if (this.mode === 'add') { this.addAt(point); return; }
    if (!node) { this.selected = null; this.syncFields(); this.schedule(); return; }
    this.choose(node); if (this.model.ref(node, this.activeLayer)?.edge === 'judgment') { this.message('speed-curve.judgment'); return; } this.begin(); if (!this.transaction) { this.message('speed-curve.error.bpm', true); return; }
    this.drag = { x: point.x, y: point.y }; this.canvas.setPointerCapture(event.pointerId);
  }
  pointermove(event) {
    const point = this.coords(event), world = this.world(point);
    if (!this.drag) {
      const model = this.currentModel; this.canvas.title = `${fmt(world.beat)} ${t('speed-curve.beats')} · ${fmt(model.distance(world.beat))} · ${t('speed-curve.speed')} ${fmt(model.speed(world.beat))}`;
      if (this.mode === 'add') {
        this.hoverAdd = this.additionAt(point); this.schedule();
      }
      return;
    }
    event.preventDefault();
    if (Math.hypot(point.x - this.drag.x, point.y - this.drag.y) < 2 && !this.draft) return;
    const beat = Math.round(world.beat * this.context.timeline.division) / this.context.timeline.division;
    const distance = Math.abs(beat - this.model.hitBeat) < 1e-7 ? this.model.distance(this.model.hitBeat) : this.snapY ? Math.round(world.distance / this.snapStep) * this.snapStep : world.distance;
    this.pendingDrag = { beat, distance };
    if (this.dragFrame == null) this.dragFrame = requestAnimationFrame(() => { this.dragFrame = null; if (this.transaction && this.pendingDrag) this.preview(this.transaction, this.pendingDrag); this.pendingDrag = null; });
  }
  pointerup() { if (this.dragFrame != null) { cancelAnimationFrame(this.dragFrame); this.dragFrame = null; if (this.transaction && this.pendingDrag) this.preview(this.transaction, this.pendingDrag); this.pendingDrag = null; } if (this.drag) this.finish(!this.editError); }
  pointercancel() { this.finish(false); }
  fit() {
    this.start = this.model.hitBeat - this.span * .8; let max = 100;
    for (let i = 0; i <= 100; i++) max = Math.max(max, Math.abs(this.model.distance(this.start + i / 100 * this.span)));
    this.limit = clamp(max * 1.15, 200, 100000); this.zoom.value = Math.log10(this.limit); this.updateRange(); this.schedule(); this.saveView();
  }
  previewState() { return this.active && this.draft ? { chart: this.draft.chart } : null; }
  schedule() { if (!this.active || this.frame != null) return; this.frame = requestAnimationFrame(() => { this.frame = null; this.draw(); }); }
  draw() {
    if (!this.active) return;
    const width = this.plot.clientWidth, height = this.plot.clientHeight, ratio = Math.min(2, devicePixelRatio || 1);
    if (!width || !height) return;
    if (this.canvas.width !== Math.round(width * ratio) || this.canvas.height !== Math.round(height * ratio)) { this.canvas.width = Math.round(width * ratio); this.canvas.height = Math.round(height * ratio); }
    const c = this.canvas.getContext('2d'); c.setTransform(ratio, 0, 0, ratio, 0, 0); c.clearRect(0, 0, width, height);
    const style = getComputedStyle(this.root), color = (name, fallback) => style.getPropertyValue('--rpen-' + name).trim() || fallback;
    const text = color('muted', '#aaa'), accent = color('accent', '#ffdc70'), line = color('border', '#666'), success = color('success', '#65c878');
    this.rect = { left: 64, top: 24, width: Math.max(1, width - 80), height: Math.max(1, height - 58) };
    const r = this.rect, model = this.currentModel; c.font = '11px system-ui'; c.textAlign = 'right';
    // Default 100-unit divisions, changed with zoom to keep the grid bounded.
    this.gridStep = 100 * 10 ** Math.round(Math.log10(this.limit / 1600));
    for (let value = -Math.floor(this.limit / this.gridStep) * this.gridStep; value <= this.limit; value += this.gridStep) {
      const point = this.screen(this.start, value); c.strokeStyle = value === 0 ? line : color('border', '#666') + '33'; c.lineWidth = value === 0 ? 1.3 : .5;
      c.beginPath(); c.moveTo(r.left, point.y); c.lineTo(r.left + r.width, point.y); c.stroke();
      const labelStride = Math.max(1, Math.ceil(24 / (r.height / 2 / this.limit * this.gridStep)));
      if (Math.round(value / this.gridStep) % labelStride === 0) { c.fillStyle = text; c.fillText(fmt(value), r.left - 8, point.y + 4); }
    }
    const division = Math.max(1, this.context.timeline.division), step = Math.max(1 / division, this.span / 900), labelStep = Math.max(1, Math.ceil(this.span / Math.max(2, r.width / 65)));
    for (let i = Math.ceil(this.start / step); i * step <= this.start + this.span; i++) { const beat = i * step, x = this.screen(beat, 0).x; c.strokeStyle = line; c.globalAlpha = Math.abs(beat - Math.round(beat)) < 1e-5 ? .35 : .12; c.beginPath(); c.moveTo(x, r.top); c.lineTo(x, r.top + r.height); c.stroke(); }
    c.globalAlpha = 1; c.fillStyle = text; c.textAlign = 'center';
    for (let beat = Math.ceil(this.start / labelStep) * labelStep; beat <= this.start + this.span; beat += labelStep) c.fillText(fmt(beat), this.screen(beat, 0).x, height - 18);
    c.textAlign = 'left'; c.fillText(t('speed-curve.distance'), 8, 14); c.textAlign = 'right'; c.fillText(t('speed-curve.timeAxis'), width - 10, height - 3);
    c.save(); c.beginPath(); c.rect(r.left, r.top, r.width, r.height); c.clip();
    const samples = Math.min(900, Math.ceil(r.width * 1.2)), path = new Path2D(); this.curvePixels = [];
    for (let i = 0; i <= samples; i++) { const beat = this.start + i / samples * this.span, point = this.screen(beat, model.distance(beat)); this.curvePixels.push(point); if (i === 0) path.moveTo(point.x, point.y); else path.lineTo(point.x, point.y); }
    c.strokeStyle = accent; c.lineWidth = 2; c.stroke(path);
    const hit = this.screen(model.hitBeat, model.distance(model.hitBeat)); c.setLineDash([3, 4]); c.strokeStyle = success; c.lineWidth = 1; c.beginPath(); c.moveTo(hit.x, r.top); c.lineTo(hit.x, r.top + r.height); c.stroke(); c.setLineDash([]);
    c.fillStyle = success; c.beginPath(); c.moveTo(hit.x, hit.y - 5); c.lineTo(hit.x + 5, hit.y); c.lineTo(hit.x, hit.y + 5); c.lineTo(hit.x - 5, hit.y); c.closePath(); c.fill();
    if (this.mode === 'add' && this.hoverAdd) { const p = this.screen(this.hoverAdd.beat, this.hoverAdd.distance); c.strokeStyle = success; c.lineWidth = 1.5; c.beginPath(); c.arc(p.x, p.y, this.hoverAdd.near ? 7 : 5, 0, Math.PI * 2); c.moveTo(p.x - 11, p.y); c.lineTo(p.x + 11, p.y); c.moveTo(p.x, p.y - 11); c.lineTo(p.x, p.y + 11); c.stroke(); }
    const visible = model.nodes.filter(node => node.beat >= this.start && node.beat <= this.start + this.span && Math.abs(model.distance(node.beat)) <= this.limit);
    this.visibleNodes = visible; const occupied = new Set();
    for (const node of visible) { const p = this.screen(node.beat, model.distance(node.beat)), pixel = Math.round(p.x); if (occupied.has(pixel) && node !== this.selected) continue; occupied.add(pixel); c.beginPath(); c.arc(p.x, p.y, node === this.selected || Math.abs(node.beat - (this.selected?.beat ?? Infinity)) < 1e-6 ? 5.5 : 3.5, 0, Math.PI * 2); c.fillStyle = node.bpm && !node.refs.length ? text : accent; c.fill(); c.strokeStyle = color('surface', '#292929'); c.lineWidth = 2; c.stroke(); }
    c.restore();
    this.labels.replaceChildren();
    const selected = visible.find(node => Math.abs(node.beat - (this.selected?.beat ?? Infinity)) < 1e-6);
    c.font = '10px system-ui';
    if (selected) {
      const node = selected;
      const p = this.screen(node.beat, model.distance(node.beat)), ref = model.ref(node, this.activeLayer), outgoing = model.outgoing(node, ref?.layer ?? this.activeLayer);
      const values = [['beat', fmt(node.beat)], ['distance', fmt(model.distance(node.beat))], ['easing', !ref ? 'BPM' : outgoing ? `↗ ${outgoing.approximate ? '≈' : ''}${outgoing.easing}` : '—']];
      const labelWidth = clamp(values.reduce((sum, [, value]) => sum + c.measureText(value).width + 9, 0), 65, 180), labelHeight = 23;
      const bounds = { x: clamp(p.x + 8, r.left, width - labelWidth - 3), y: clamp(p.y - 33, r.top, r.top + r.height - labelHeight), width: labelWidth, height: labelHeight };
      const chip = el('div', 'speed-curve-node-label'); chip.style.left = `${bounds.x}px`; chip.style.top = `${bounds.y}px`; chip.style.maxWidth = `${labelWidth}px`; chip.dataset.nodeBeat = String(node.beat);
      chip.classList.add('active');
      for (const [field, value] of values) {
        const button = el('button', '', value); button.type = 'button'; button.title = field === 'easing' && ref ? outgoing ? t('speed-curve.segment', { start: fmt(outgoing.start), end: fmt(outgoing.end) }) : t('speed-curve.error.lastNode') : t('speed-curve.' + (field === 'beat' ? 'time' : field));
        button.disabled = this.mode === 'delete' ? ref?.edge === 'judgment' : field === 'easing' && !outgoing;
        if (ref?.edge === 'judgment' && (field !== 'easing' || this.mode === 'delete')) button.title = t('speed-curve.judgment');
        button.onclick = () => this.mode === 'delete' ? this.remove(node) : this.choose(node, field); chip.append(button);
      }
      this.labels.append(chip);
      c.strokeStyle = line; c.lineWidth = .7; c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(clamp(p.x, bounds.x, bounds.x + bounds.width), clamp(p.y, bounds.y, bounds.y + bounds.height)); c.stroke();
    }
    this.hint.textContent = t('speed-curve.hint.' + this.mode);
    this.rangeStart.textContent = `${fmt(this.start)} – ${fmt(this.start + this.span)}`; this.pan.value = this.start;
  }
}
