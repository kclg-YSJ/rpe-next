import { animationCurveValue, assertAnimationCurve } from '../core/animation-curve.mjs';
import { addCurvePoint, moveCurveNodes, moveCurveHandle, setCurveMode, deleteCurveNodes, materializeCurve } from '../core/animation-curve-edit.mjs';
import { addCurveTemplate, curveLibraryText, parseCurveLibrary } from '../platform/animation-curve-library.mjs';
import { isTextEntry } from './keyboard.mjs';
import { TempoMap } from '../core/tempo.mjs';
import { formatBeat } from '../core/beat.mjs';
import { evaluateNumericExpression } from '../core/numeric-expression.mjs';
import { ANIMATION_CURVE_EXAMPLES, animationCurveExample } from '../core/animation-curve-examples.mjs';
import { readCurvePreferences, writeCurvePreferences } from '../platform/animation-curve-preferences.mjs';
import { curveHelpDiagram } from './animation-curve-help.mjs';
import { curveIcon } from './curve-icons.mjs';
import { t } from '../i18n.mjs';

export function mountAnimationCurveEditor(host, options) {
  const send = (type, detail) => options.request(type, detail);
  const initial = options.initial;
  let disposed = false, observer, resizeTimer, layoutGesture, previousFocus = document.activeElement;
  const preferences = readCurvePreferences();
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const text = key => t('animation-curve.' + key);
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const copy = x => structuredClone(x), round = x => Math.round(x * 1e6) / 1e6;
  let numericDraft, state = copy(initial.state);
  let curve, templates = [], event, selection = new Set(), hover, gesture, mode = 'select', undo = [], redo = [], selectedTemplate = '', valid = true, frame = 0;
  let timing;
  let view = preferences.view, snap = preferences.snap, ui = {}, playing = false, uiScale = 1;

  function status(message, error = false) { ui.status.textContent = message; ui.status.classList.toggle('error', error); ui.status.setAttribute('role', error ? 'alert' : 'status'); }
  function safely(action) { try { return action(); } catch (e) { status(e.message, true); } }
  function invalidate() { if (!disposed && !frame) frame = requestAnimationFrame(() => { frame = 0; draw(); }); }
  function rememberView() {
    if (disposed) return;
    const bounds = host.getBoundingClientRect();
    try { writeCurvePreferences({ ...preferences, view, snap, realValues: ui.realValues?.checked ?? false, ...(preferences.maximized ? {} : { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height }) }); }
    catch (e) { status(text('preferencesError') + e.message, true); }
  }
  function change(next, commit = true) {
    assertAnimationCurve(next); curve = next; invalidate(); renderFields();
    if (commit && valid) send('apply', curve);
  }
  function checkpoint(before) {
    if (JSON.stringify(before) === JSON.stringify(curve)) { send('cancelPreview'); return; }
    try { if (!valid) throw Error(text('stale')); const previousState = copy(state); send('apply', curve); undo.push({ curve: before, state: previousState }); if (undo.length > 150) undo.shift(); redo = []; }
    catch (e) { curve = before; send('cancelPreview'); invalidate(); renderFields(); throw e; }
  }
  function edit(action) { safely(() => { if (!valid) throw Error(text('stale')); const before = copy(curve); change(action(copy(curve)), false); checkpoint(before); }); }
  function history(back) {
    const from = back ? undo : redo, to = back ? redo : undo; if (!from.length || !valid) return;
    const before = { curve: copy(curve), state: copy(state) }, next = copy(from.at(-1));
    try { send('restore', next); curve = next.curve; from.pop(); to.push(before); selection.clear(); renderFields(); invalidate(); }
    catch (e) { status(e.message, true); }
  }
  function button(icon, label, action, parent = ui.toolbar, caption) { const b = el('button', 'curve-button'); b.append(curveIcon(icon)); if (caption) b.append(el('span', '', text(caption))); b.type = 'button'; b.dataset.action = label; b.title = b.ariaLabel = text(label); b.onclick = () => { safely(() => { finishNumeric(); action(); }); if (b.isConnected) { b.blur(); host.focus({ preventScroll: true }); } }; parent.append(b); return b; }
  function stopPlayback() { if (!playing) return; playing = false; send('playback', null); syncPlayback(); invalidate(); }
  function syncPlayback() { if (!ui.play) return; ui.play.replaceChildren(curveIcon(playing ? 'pause' : 'play'), el('span', '', text(playing ? 'pauseShort' : 'playShort'))); ui.play.title = ui.play.ariaLabel = text(playing ? 'pausePreview' : 'preview'); ui.play.setAttribute('aria-pressed', String(playing)); }
  function togglePlayback() { if (playing) { stopPlayback(); return; } if (!valid) throw Error(text('stale')); send('playback', curve); playing = true; syncPlayback(); invalidate(); }
  function field(label, input, parent) { const row = el('label', 'curve-field'); row.append(el('span', '', text(label)), input); parent.append(row); input.ariaLabel = text(label); return input; }
  function input(type, value) { const i = el('input'); i.type = type; i.value = value; if (type === 'number') { i.type = 'text'; i.dataset.curveNumber = 'true'; i.inputMode = 'decimal'; } return i; }
  function setMode(next) { mode = next; for (const [name, b] of Object.entries(ui.tools)) b.setAttribute('aria-pressed', String(name === mode)); ui.canvas.style.cursor = mode === 'select' ? 'default' : 'crosshair'; }
  function layout() {
    const margin = 8, width = Math.min(preferences.width, innerWidth - margin * 2), height = Math.min(preferences.height, innerHeight - margin * 2);
    host.classList.toggle('maximized', preferences.maximized);
    const box = preferences.maximized ? { left: margin, top: margin, width: innerWidth - margin * 2, height: innerHeight - margin * 2 }
      : { left: clamp(preferences.left ?? (innerWidth - width) / 2, margin, Math.max(margin, innerWidth - width - margin)), top: clamp(preferences.top ?? (innerHeight - height) / 2, margin, Math.max(margin, innerHeight - height - margin)), width, height };
    for (const [key, value] of Object.entries(box)) host.style[key] = `${value}px`;
    uiScale = clamp(Math.sqrt(box.width * box.height / (1080 * 700)), .88, 1.2);
    host.style.setProperty('--curve-unit', `${uiScale}px`); host.style.fontSize = `${13 * uiScale}px`;
    host.classList.toggle('compact', box.width < 780); host.classList.toggle('short', box.height < 560);
    if (ui.maximize) ui.maximize.replaceChildren(curveIcon(preferences.maximized ? 'restore' : 'maximize'));
  }
  function toggleMaximized() { if (!preferences.maximized) Object.assign(preferences, savedBounds()); preferences.maximized = !preferences.maximized; layout(); invalidate(); rememberView(); }
  function savedBounds() { const r = host.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; }
  function beginLayout(e, resize) {
    if (e.button !== 0 || !resize && e.target.closest('button,input,select')) return;
    e.preventDefault(); finishNumeric(); host.focus({ preventScroll: true });
    if (preferences.maximized) return;
    layoutGesture = { x: e.clientX, y: e.clientY, bounds: savedBounds(), resize, control: e.currentTarget, id: e.pointerId };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function moveLayout(e) {
    if (!layoutGesture) return;
    const g = layoutGesture, dx = e.clientX - g.x, dy = e.clientY - g.y;
    if (g.resize) { preferences.width = clamp(g.bounds.width + dx, Math.min(600, innerWidth - 16), innerWidth - g.bounds.left - 8); preferences.height = clamp(g.bounds.height + dy, Math.min(420, innerHeight - 16), innerHeight - g.bounds.top - 8); }
    else { preferences.left = g.bounds.left + dx; preferences.top = g.bounds.top + dy; }
    layout(); invalidate();
  }
  function endLayout(e) { const g = layoutGesture; if (!g) return; layoutGesture = null; if (g.control.hasPointerCapture(g.id)) g.control.releasePointerCapture(g.id); Object.assign(preferences, savedBounds()); rememberView(); }
  function cancelLayout() { const g = layoutGesture; if (!g) return; layoutGesture = null; Object.assign(preferences, g.bounds); if (g.control.hasPointerCapture(g.id)) g.control.releasePointerCapture(g.id); layout(); invalidate(); }
  function build() {
    host.replaceChildren(); host.tabIndex = -1; host.setAttribute('role', 'dialog'); host.setAttribute('aria-label', text('title')); host.dataset.ui = 'animation-curve';
    const header = ui.header = el('header', 'curve-header'); const title = el('div'); title.append(el('h1', '', text('title')), el('small', '', `${formatBeat(event.startTime)} → ${formatBeat(event.endTime)} ${text('beats')} · ${text('normalized')}`)); header.append(title);
    const actions = el('div', 'curve-actions'); header.append(actions); button('help', 'help', showHelp, actions); ui.maximize = button('maximize', 'maximize', toggleMaximized, actions); button('check', 'done', () => { finishNumeric(); send('closed'); }, actions, 'done'); host.append(header);
    ui.toolbar = el('div', 'curve-toolbar'); host.append(ui.toolbar); ui.tools = {};
    for (const key of ['select', 'add', 'delete']) ui.tools[key] = button(key, key, () => setMode(key));
    ui.toolbar.append(el('span', 'curve-separator')); button('undo', 'undo', () => history(true)); button('redo', 'redo', () => history(false));
    ui.toolbar.append(el('span', 'curve-separator')); button('fit', 'fit', fit); ui.play = button('play', 'preview', togglePlayback, ui.toolbar, 'playShort'); syncPlayback();
    const snapInput = input('number', snap * 100); snapInput.min = '0'; snapInput.max = '50'; snapInput.step = '1'; snapInput.onchange = () => { const x = Number(snapInput.value); if (Number.isFinite(x) && x >= 0 && x <= 50) { snap = x / 100; rememberView(); } }; field('snap', snapInput, ui.toolbar);
    ui.realValues = input('checkbox', ''); ui.realValues.checked = preferences.realValues; field('realValues', ui.realValues, ui.toolbar); ui.realValues.onchange = () => { invalidate(); rememberView(); };
    const body = el('div', 'curve-body'), stage = el('section', 'curve-stage'); body.append(stage); ui.canvas = el('canvas', 'curve-canvas'); ui.canvas.tabIndex = 0; ui.canvas.ariaLabel = text('graph'); stage.append(ui.canvas);
    ui.pan = input('range', 0); ui.pan.min = '0'; ui.pan.max = '1000'; ui.pan.step = '1'; ui.pan.className = 'curve-pan'; ui.pan.ariaLabel = text('timeRange'); ui.pan.oninput = () => { const span = view.x1 - view.x0; view.x0 = Number(ui.pan.value) / 1000 * Math.max(0, 1 - span); view.x1 = view.x0 + span; invalidate(); }; ui.pan.onchange = rememberView; stage.append(ui.pan);
    ui.zoom = input('range', 0); ui.zoom.min = '-30'; ui.zoom.max = '80'; ui.zoom.step = '1'; ui.zoom.className = 'curve-zoom'; ui.zoom.ariaLabel = text('verticalZoom'); ui.zoom.oninput = () => { const mid = (view.y0 + view.y1) / 2, span = 1.4 * 2 ** (-Number(ui.zoom.value) / 20); view.y0 = mid - span / 2; view.y1 = mid + span / 2; invalidate(); }; ui.zoom.onchange = rememberView; stage.append(ui.zoom);
    const aside = el('aside', 'curve-inspector'); body.append(aside); ui.fields = el('section', 'curve-node-fields'); aside.append(ui.fields);
    const library = el('details', 'curve-library'); library.open = true; library.append(el('summary', '', text('templates'))); aside.append(library);
    ui.name = input('text', curve.name ?? ''); ui.name.maxLength = 140; field('name', ui.name, library);
    const controls = el('div', 'curve-library-actions'); library.append(controls);
    button('saveNew', 'saveNew', () => saveTemplate(false), controls); button('save', 'saveTemplate', () => saveTemplate(true), controls); button('delete', 'deleteTemplate', deleteTemplate, controls);
    button('export', 'exportTemplates', exportTemplates, controls); button('import', 'importTemplates', () => ui.import.click(), controls);
    ui.import = input('file', ''); ui.import.hidden = true; ui.import.accept = '.json,.rpencurve'; ui.import.onchange = () => importTemplates(ui.import.files[0]); library.append(ui.import);
    ui.library = el('div', 'curve-template-list'); library.append(ui.library); renderLibrary();
    host.append(body); ui.status = el('div', 'curve-status', text('hint')); ui.status.ariaLive = 'polite'; host.append(ui.status);
    ui.help = el('section', 'curve-help'); ui.help.hidden = true; ui.help.setAttribute('role', 'dialog'); ui.help.ariaLabel = text('help'); host.append(ui.help); setMode('select'); renderFields();
    ui.canvas.onpointerdown = down; ui.canvas.onpointermove = move; ui.canvas.onpointerup = up;
    ui.canvas.onpointercancel = cancel; ui.canvas.onlostpointercapture = () => { if (gesture) cancel(); };
    ui.canvas.onpointerleave = () => { if (!gesture) { hover = null; invalidate(); } };
    ui.canvas.ondblclick = e => { if (mode === 'select') safely(() => addAt(point(e).x)); };
    ui.canvas.oncontextmenu = e => { e.preventDefault(); cancel(); };
    host.addEventListener('pointerdown', e => e.stopPropagation()); host.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); });
    ui.canvas.onwheel = e => { e.preventDefault(); const p = point(e), ratio = Math.exp(clamp(e.deltaY, -200, 200) * .003);
      if (e.ctrlKey || e.metaKey) { const span = clamp((view.x1 - view.x0) * ratio, .02, 1); view.x0 = clamp(p.x - (p.x - view.x0) * ratio, 0, 1 - span); view.x1 = view.x0 + span; }
      else if (e.shiftKey) { const span = view.x1 - view.x0, dx = span * e.deltaY / 500; view.x0 = clamp(view.x0 + dx, 0, 1 - span); view.x1 = view.x0 + span; }
      else { const span = clamp((view.y1 - view.y0) * ratio, .01, 20000), rel = (p.y - view.y0) / (view.y1 - view.y0); view.y0 = p.y - rel * span; view.y1 = view.y0 + span; }
      syncZoom(); invalidate(); rememberView();
    };
    const grip = el('div', 'curve-resize-grip'); grip.title = text('resize'); grip.ariaHidden = 'true'; host.append(grip);
    header.addEventListener('pointerdown', e => beginLayout(e, false)); grip.addEventListener('pointerdown', e => beginLayout(e, true));
    for (const control of [header, grip]) { control.addEventListener('pointermove', moveLayout); control.addEventListener('pointerup', endLayout); control.addEventListener('pointercancel', cancelLayout); }
    header.ondblclick = e => { if (!e.target.closest('button,input,select')) toggleMaximized(); };
    observer = new ResizeObserver(() => { ui.help.style.top = `${ui.header.offsetHeight}px`; invalidate(); }); observer.observe(ui.canvas); observer.observe(ui.header);
    layout(); syncZoom(); invalidate(); host.focus({ preventScroll: true });
  }
  function syncZoom() { ui.lastSpan = view.x1 - view.x0; ui.pan.disabled = view.x1 - view.x0 >= .999999; ui.zoom.value = clamp(-20 * Math.log2((view.y1 - view.y0) / 1.4), -30, 80); ui.pan.value = view.x1 - view.x0 < 1 ? view.x0 / (1 - (view.x1 - view.x0)) * 1000 : 0; }
  function fit() { const values = curve.nodes.flatMap(n => [n.y, n.in?.[1], n.out?.[1]]).filter(Number.isFinite), min = Math.min(0, ...values), max = Math.max(1, ...values), pad = (max - min) * .15; view = { x0: 0, x1: 1, y0: min - pad, y1: max + pad }; syncZoom(); invalidate(); rememberView(); }
  function geometry() { const r = ui.canvas.getBoundingClientRect(); return { width: r.width, height: r.height, left: 68 * uiScale, right: r.width - 30 * uiScale, top: 28 * uiScale, bottom: r.height - 48 * uiScale }; }
  function pixel(x, y, g = geometry()) { return [g.left + (x - view.x0) / (view.x1 - view.x0) * (g.right - g.left), g.bottom - (y - view.y0) / (view.y1 - view.y0) * (g.bottom - g.top)]; }
  function point(e) { const r = ui.canvas.getBoundingClientRect(), g = geometry(), px = e.clientX - r.left, py = e.clientY - r.top; return { x: view.x0 + (px - g.left) / (g.right - g.left) * (view.x1 - view.x0), y: view.y0 + (g.bottom - py) / (g.bottom - g.top) * (view.y1 - view.y0), px, py }; }
  function handleControl(n, side, g) {
    const center = pixel(n.x, n.y, g), actual = pixel(...n[side], g);
    let dx = actual[0] - center[0], dy = actual[1] - center[1], length = Math.hypot(dx, dy);
    if (length >= 18) return { pixel: actual, point: n[side], expanded: false };
    if (length < 1e-6) {
      const other = n[side === 'in' ? 'out' : 'in'];
      if (other) { const p = pixel(...other, g); dx = center[0] - p[0]; dy = center[1] - p[1]; length = Math.hypot(dx, dy); }
      if (length < 1e-6) { dx = side === 'in' ? -1 : 1; dy = 0; length = 1; }
    }
    const p = [center[0] + dx / length * 18, center[1] + dy / length * 18];
    // Short/zero controls get a distinct pick target without changing the curve.
    // Use that visible position only once a drag starts, so the handle follows it.
    return { pixel: p, point: [view.x0 + (p[0] - g.left) / (g.right - g.left) * (view.x1 - view.x0), view.y0 + (g.bottom - p[1]) / (g.bottom - g.top) * (view.y1 - view.y0)], expanded: true };
  }
  function hit(p) {
    const material = materializeCurve(curve), g = geometry();
    const candidates = []; curve.nodes.forEach((n, i) => { if (selection.has(i)) { const ns = material.nodes[i]; for (const key of ['in', 'out']) if (ns[key] && (key === 'in' ? i > 0 : i < curve.nodes.length - 1)) { const control = handleControl(ns, key, g), [x, y] = control.pixel; candidates.push({ i, key, point: control.point, distance: Math.hypot(x - p.px, y - p.py) }); } } const [x, y] = pixel(n.x, n.y, g); candidates.push({ i, key: 'node', distance: Math.hypot(x - p.px, y - p.py) }); });
    return candidates.filter(c => c.distance < 10).sort((a, b) => a.distance - b.distance)[0];
  }
  function addAt(x) { const actual = snap > 0 ? Math.round(x / snap) * snap : x; edit(c => addCurvePoint(c, actual)); selection = new Set([curve.nodes.findIndex(n => Math.abs(n.x - actual) < 1e-6)]); renderFields(); }
  function down(e) {
    if (!valid) return;
    if (e.button !== 0 && e.button !== 1) return; e.preventDefault(); ui.canvas.focus(); const p = point(e), found = hit(p);
    if (mode === 'add' && e.button === 0) { safely(() => addAt(p.x)); return; }
    if (mode === 'delete' && e.button === 0) { if (found) { selection = new Set([found.i]); removeSelected(); } return; }
    if (found && e.button === 0) { if (e.shiftKey && found.key === 'node') { if (selection.has(found.i)) selection.delete(found.i); else selection.add(found.i); } else if (!selection.has(found.i)) selection = new Set([found.i]); }
    else if (!e.shiftKey && e.button === 0) selection.clear();
    const segmentY = animationCurveValue(curve, clamp(p.x, 0, 1)), segmentPixel = pixel(p.x, segmentY), nearSegment = !found && Math.abs(segmentPixel[1] - p.py) < 8 && p.x > 0 && p.x < 1;
    gesture = { before: copy(curve), start: p, hit: found, kind: e.button === 1 || e.altKey && !found ? 'pan' : found ? found.key : nearSegment ? 'segment' : 'marquee', selection: new Set(selection), view: copy(view), moved: false };
    if (gesture.kind === 'segment') gesture.segment = curve.nodes.findIndex((n, i) => i < curve.nodes.length - 1 && n.x <= p.x && curve.nodes[i + 1].x >= p.x);
    ui.canvas.setPointerCapture(e.pointerId); renderFields(); invalidate();
  }
  function move(e) {
    if (!valid) return;
    const p = point(e); hover = p;
    if (!gesture) { invalidate(); return; }
    const g = gesture, dxPixel = p.px - g.start.px, dyPixel = p.py - g.start.py;
    if (!g.moved && Math.hypot(dxPixel, dyPixel) < 3) return; g.moved = true;
    safely(() => {
      if (g.kind === 'pan') { const geo = geometry(), dx = -dxPixel / (geo.right - geo.left) * (g.view.x1 - g.view.x0), dy = dyPixel / (geo.bottom - geo.top) * (g.view.y1 - g.view.y0), span = g.view.x1 - g.view.x0; view.x0 = clamp(g.view.x0 + dx, 0, 1 - span); view.x1 = view.x0 + span; view.y0 = g.view.y0 + dy; view.y1 = g.view.y1 + dy; syncZoom(); invalidate(); return; }
      if (g.kind === 'marquee') { selection = new Set(e.shiftKey ? g.selection : []); curve.nodes.forEach((n, i) => { if (n.x >= Math.min(p.x, g.start.x) && n.x <= Math.max(p.x, g.start.x) && n.y >= Math.min(p.y, g.start.y) && n.y <= Math.max(p.y, g.start.y)) selection.add(i); }); renderFields(); invalidate(); return; }
      let dx = p.x - g.start.x, dy = p.y - g.start.y;
      if (e.shiftKey) { if (Math.abs(dxPixel) >= Math.abs(dyPixel)) dy = 0; else dx = 0; }
      if (g.kind === 'node') {
        if (snap > 0) { const n = g.before.nodes[g.hit.i]; if (dx) dx = Math.round((n.x + dx) / snap) * snap - n.x; if (dy) dy = Math.round((n.y + dy) / snap) * snap - n.y; }
        change(moveCurveNodes(g.before, [...selection], dx, dy), false);
      } else if (g.kind === 'segment') { const next = materializeCurve(g.before), i = g.segment; next.nodes[i].mode = 'corner'; next.nodes[i].out[1] += dy * 4 / 3; next.nodes[i + 1].in[1] += dy * 4 / 3; if (next.nodes[i + 1].mode === 'auto') next.nodes[i + 1].mode = 'corner'; change(next, false); }
      else { const before = g.hit.point; change(moveCurveHandle(g.before, g.hit.i, g.kind, [before[0] + dx, before[1] + dy], e.altKey), false); }
      send('preview', curve);
    });
  }
  function up(e) { if (!gesture) return; const g = gesture; gesture = null; if (ui.canvas.hasPointerCapture(e.pointerId)) ui.canvas.releasePointerCapture(e.pointerId); if (g.kind === 'pan') rememberView(); else if (g.kind !== 'marquee') safely(() => checkpoint(g.before)); invalidate(); }
  function cancel() { if (gesture) { curve = gesture.before; gesture = null; send('cancelPreview'); renderFields(); invalidate(); } }
  function removeSelected() { if (![...selection].some(i => i > 0 && i < curve.nodes.length - 1)) { status(text('fixedEndpoints'), true); return; } edit(c => deleteCurveNodes(c, [...selection])); selection.clear(); renderFields(); }
  const parseNumber = value => { try { return evaluateNumericExpression(value); } catch { return NaN; } };
  function finishNumeric() { numericDraft?.control.curveFinish?.(); }
  function numericEdit(control, transform) {
    const begin = () => { numericDraft ??= { control, before: copy(curve) }; };
    const update = quiet => {
      begin();
      if (!control.value.trim() || !Number.isFinite(parseNumber(control.value))) { if (!quiet) status(text('invalidNumber'), true); return false; }
      try { change(transform(copy(numericDraft.before), parseNumber(control.value) / 100), false); send('preview', curve); control.removeAttribute('aria-invalid'); return true; }
      catch (error) { control.setAttribute('aria-invalid', 'true'); if (!quiet) status(error.message, true); return false; }
    };
    const finish = () => { if (!numericDraft || numericDraft.control !== control) return; const before = numericDraft.before; try { if (update(false)) checkpoint(before); else { change(before, false); send('cancelPreview'); } } catch (e) { status(e.message, true); } finally { numericDraft = null; } };
    control.curveFinish = finish; control.onfocus = begin; control.oninput = () => update(true); control.onchange = finish;
    control.onblur = () => { finish(); queueMicrotask(renderFields); };
  }
  function renderFields() {
    if (!ui.fields) return;
    // Preserve text and cursor while an input is being edited.
    if (ui.fields.contains(document.activeElement) && isTextEntry(document.activeElement)) return;
    ui.fields.replaceChildren(el('h3', '', text('node'))); const indices = [...selection].filter(i => curve.nodes[i]);
    if (!indices.length) { ui.fields.append(el('p', 'hint', text('selectHint'))); return; }
    const i = indices[0], n = curve.nodes[i], fixed = i === 0 || i === curve.nodes.length - 1;
    for (const key of ['x', 'y']) { const control = input('number', round(n[key] * 100)); control.disabled = fixed || indices.length > 1; numericEdit(control, (c, v) => { const n = c.nodes[i]; if (key === 'x' && (v <= c.nodes[i - 1].x || v >= c.nodes[i + 1].x) || key === 'y' && Math.abs(v) > 10000) throw Error(text('invalidNode')); return moveCurveNodes(c, [i], key === 'x' ? v - n.x : 0, key === 'y' ? v - n.y : 0); }); field(key === 'x' ? 'time' : 'value', control, ui.fields); }
    const modes = el('select'); for (const name of ['auto', 'smooth', 'corner', 'linear', 'hold']) modes.append(new Option(text(name), name)); modes.value = n.mode ?? 'corner'; modes.onchange = () => edit(c => setCurveMode(c, indices, modes.value)); field('mode', modes, ui.fields);
    if (indices.length === 1) { const material = materializeCurve(curve).nodes[i]; for (const side of ['in', 'out']) if (material[side] && (side === 'in' ? i > 0 : i < curve.nodes.length - 1)) { const row = el('div', 'curve-handle-inputs'); row.append(el('span', '', text(side))); for (const axis of [0, 1]) { const value = input('number', round(material[side][axis] * 100)); value.ariaLabel = text(side) + ' ' + (axis === 0 ? 'X' : 'Y') + ' %'; numericEdit(value, (c, v) => { const point = [...materializeCurve(c).nodes[i][side]]; if (axis === 0 && (v < (side === 'in' ? c.nodes[i - 1].x : c.nodes[i].x) || v > (side === 'in' ? c.nodes[i].x : c.nodes[i + 1].x)) || axis === 1 && Math.abs(v) > 10000) throw Error(text('invalidHandle')); point[axis] = v; return moveCurveHandle(c, i, side, point); }); row.append(value); } ui.fields.append(row); } }
    const remove = button('delete', 'delete', removeSelected, ui.fields, 'deleteShort'); remove.disabled = !indices.some(i => i > 0 && i < curve.nodes.length - 1);
  }
  function renderLibrary() {
    ui.library.replaceChildren(); for (const item of templates) { const b = el('button', 'curve-template', item.name); b.type = 'button'; b.setAttribute('aria-pressed', String(item.id === selectedTemplate)); b.onclick = () => { selectedTemplate = item.id; ui.name.value = item.name; selection.clear(); edit(() => copy(item.curve)); fit(); renderLibrary(); }; ui.library.append(b); }
    if (!templates.length) ui.library.append(el('small', 'hint', text('emptyLibrary')));
  }
  function persistLibrary(next) { send('library', next); templates = next; renderLibrary(); }
  function saveTemplate(replace) { const id = replace && templates.some(t => t.id === selectedTemplate) ? selectedTemplate : undefined; const next = addCurveTemplate(templates, ui.name.value || curve.name || text('unnamed'), curve, id); selectedTemplate = id ?? next.at(-1).id; ui.name.value = next.find(t => t.id === selectedTemplate).name; persistLibrary(next); }
  let deleteArmed = '';
  function deleteTemplate() { if (!selectedTemplate) { status(text('chooseTemplate'), true); return; } if (deleteArmed !== selectedTemplate) { deleteArmed = selectedTemplate; status(text('confirmDelete')); return; } persistLibrary(templates.filter(t => t.id !== selectedTemplate)); selectedTemplate = ''; deleteArmed = ''; }
  function exportTemplates() { const blob = new Blob([curveLibraryText(templates)], { type: 'application/json' }), url = URL.createObjectURL(blob), a = el('a'); a.href = url; a.download = 'animation-curves.rpencurve'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); }
  async function importTemplates(file) { if (!file) return; try { if (file.size > 8 * 1024 * 1024) throw Error(text('libraryTooLarge')); let next = templates; for (const item of parseCurveLibrary(await file.text())) next = addCurveTemplate(next, item.name, item.curve); persistLibrary(next); } catch (e) { status(e.message, true); } finally { ui.import.value = ''; } }
  function hideHelp() { ui.help.hidden = true; host.focus({ preventScroll: true }); }
  function showHelp() {
    cancel(); stopPlayback();
    ui.help.replaceChildren(el('h2', '', text('help')));
    const controls = el('details', 'curve-help-controls'); controls.open = false; controls.append(el('summary', '', text('operationGuide')));
    for (const key of ['helpCoordinates', 'helpNodes', 'helpHandles', 'helpModes', 'helpView', 'helpKeyboard', 'helpTemplates', 'helpCrop', 'helpExport']) controls.append(el('p', '', text(key)));
    ui.help.append(controls, el('h3', '', text('examples')), el('p', 'hint', text('diagramLegend')));
    const examples = el('div', 'curve-help-examples'); ui.help.append(examples);
    for (const example of ANIMATION_CURVE_EXAMPLES) {
      const title = text(`example.${example.id}.title`), definition = animationCurveExample(example.id, title), card = el('article', 'curve-help-example');
      card.dataset.example = example.id; card.append(el('h4', '', title), curveHelpDiagram(definition, title), el('p', '', text(`example.${example.id}.steps`)));
      button('load', 'loadExample', () => { hideHelp(); edit(() => definition); selection = new Set(definition.nodes.length > 2 ? [1] : [0]); ui.name.value = title; selectedTemplate = ''; fit(); renderFields(); renderLibrary(); }, card, 'loadExample');
      examples.append(card);
    }
    const actions = el('div', 'curve-actions'); ui.help.append(actions);
    button('check', 'backToCurve', hideHelp, actions, 'backToCurve'); ui.help.hidden = false; ui.help.scrollTop = 0; ui.help.tabIndex = -1; ui.help.focus({ preventScroll: true });
  }
  function draw() {
    if (!curve || !ui.canvas) return; const g = geometry(), canvas = ui.canvas, dpi = devicePixelRatio || 1;
    if (g.width < 10 || g.height < 10) return;
    const w = Math.round(g.width * dpi), h = Math.round(g.height * dpi); if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const c = canvas.getContext('2d'); c.setTransform(dpi, 0, 0, dpi, 0, 0); c.clearRect(0, 0, g.width, g.height);
    const css = getComputedStyle(document.documentElement), ink = css.getPropertyValue('--text').trim() || '#e4e9f2', muted = css.getPropertyValue('--muted').trim() || '#8996ad', accent = css.getPropertyValue('--accent').trim() || '#8bbaff';
    c.font = `${12 * uiScale}px system-ui`; c.fillStyle = muted; c.strokeStyle = muted; c.lineWidth = 1;
    const tick = (span, count) => { const base = 10 ** Math.floor(Math.log10(span / count)), unit = span / count / base; return (unit > 5 ? 10 : unit > 2 ? 5 : unit > 1 ? 2 : 1) * base; };
    const sx = tick(view.x1 - view.x0, Math.max(2, (g.right - g.left) / (70 * uiScale))), sy = tick(view.y1 - view.y0, Math.max(2, (g.bottom - g.top) / (45 * uiScale)));
    const real = ui.realValues.checked, actual = real && typeof event.start === 'number', basis = event.customEasing && 'sourceStart' in event.customEasing ? [event.customEasing.sourceStart, event.customEasing.sourceEnd] : [event.start, event.end];
    const beatAt = x => { const [a, b] = event.customEasing?.domain ?? [0, 1]; return timing?.tempo.beat(timing.start + (x - a) / (b - a) * (timing.end - timing.start), timing.factor); };
    for (let x = Math.ceil(view.x0 / sx) * sx; x <= view.x1 + 1e-9; x += sx) { const [px] = pixel(x, 0, g); c.globalAlpha = .18; c.beginPath(); c.moveTo(px, g.top); c.lineTo(px, g.bottom); c.stroke(); c.globalAlpha = 1; c.fillText(real && timing ? String(Math.round(beatAt(x) * 1000) / 1000) : `${round(x * 100)}%`, px - 12, g.bottom + 21); }
    for (let y = Math.ceil(view.y0 / sy) * sy; y <= view.y1 + 1e-9; y += sy) { const [, py] = pixel(0, y, g); c.globalAlpha = .18; c.beginPath(); c.moveTo(g.left, py); c.lineTo(g.right, py); c.stroke(); c.globalAlpha = 1; c.fillText(actual ? String(Math.round((basis[0] + (basis[1] - basis[0]) * y) * 1000) / 1000) : `${round(y * 100)}%`, 8, py + 4); }
    c.fillStyle = ink; c.fillText(text(actual ? 'eventValue' : 'value'), 8, 15); c.fillText(text(real && timing ? 'beatTime' : 'time'), g.right - 90, g.height - 6);
    c.save(); c.beginPath(); c.rect(g.left, g.top, g.right - g.left, g.bottom - g.top); c.clip();
    c.setLineDash([5, 5]); c.strokeStyle = muted; c.globalAlpha = .4; c.beginPath(); c.moveTo(...pixel(0, 0)); c.lineTo(...pixel(1, 1)); c.stroke(); c.setLineDash([]); c.globalAlpha = 1;
    if (event.customEasing?.domain) { const [a, b] = event.customEasing.domain; c.fillStyle = accent; c.globalAlpha = .08; const left = pixel(a, 0)[0], right = pixel(b, 0)[0]; c.fillRect(left, g.top, right - left, g.bottom - g.top); c.globalAlpha = 1; }
    c.strokeStyle = accent; c.lineWidth = 2.5; c.beginPath(); const steps = Math.min(1200, Math.ceil(g.right - g.left));
    for (let i = 0; i <= steps; i++) { const x = view.x0 + (view.x1 - view.x0) * i / steps, p = pixel(x, animationCurveValue(curve, x), g); if (!i) c.moveTo(...p); else c.lineTo(...p); } c.stroke();
    const material = materializeCurve(curve);
    curve.nodes.forEach((n, i) => { const [x, y] = pixel(n.x, n.y, g); if (selection.has(i)) { const m = material.nodes[i]; c.lineWidth = 1; c.strokeStyle = muted;
      for (const key of ['in', 'out']) if (m[key] && (key === 'in' ? i > 0 : i < curve.nodes.length - 1)) { const control = handleControl(m, key, g), p = control.pixel; c.setLineDash(control.expanded ? [3, 3] : []); c.beginPath(); c.moveTo(x, y); c.lineTo(...p); c.stroke(); c.setLineDash([]); c.fillStyle = ink; if (control.expanded) { c.strokeStyle = ink; c.strokeRect(p[0] - 3, p[1] - 3, 6, 6); c.strokeStyle = muted; } else c.fillRect(p[0] - 3, p[1] - 3, 6, 6); }
    } c.fillStyle = selection.has(i) ? accent : ink; c.beginPath(); c.arc(x, y, selection.has(i) ? 5.5 : 4, 0, Math.PI * 2); c.fill(); });
    if (gesture?.kind === 'marquee' && hover) { const a = pixel(gesture.start.x, gesture.start.y), b = pixel(hover.x, hover.y); c.strokeStyle = accent; c.fillStyle = accent; c.globalAlpha = .12; c.fillRect(a[0], a[1], b[0] - a[0], b[1] - a[1]); c.globalAlpha = 1; c.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]); }
    const labelIndex = gesture?.hit?.i ?? (selection.size === 1 ? [...selection][0] : hover ? hit(hover)?.i : null);
    if (labelIndex != null && curve.nodes[labelIndex]) { const n = curve.nodes[labelIndex], [x, y] = pixel(n.x, n.y); c.fillStyle = ink; c.fillText(`${round(n.x * 100)}%, ${round(n.y * 100)}%`, clamp(x + 10, g.left + 4, g.right - 130), clamp(y - 13, g.top + 14, g.bottom - 4)); }
    if (hover && hover.x >= 0 && hover.x <= 1) { const y = animationCurveValue(curve, hover.x), [x, py] = pixel(hover.x, y); c.fillStyle = accent; c.beginPath(); c.arc(x, py, 3, 0, Math.PI * 2); c.fill();
      if (ui.realValues.checked && typeof event.start === 'number' && typeof event.end === 'number') { const base = event.customEasing?.sourceStart ?? event.start, end = event.customEasing?.sourceEnd ?? event.end; c.fillStyle = ink; c.fillText(`${text('value')}: ${round(base + (end - base) * y)}`, g.left + 10, g.top + 18); }
    }
    c.restore();
    if (playing) { const sample = send('playhead', performance.now()); if (sample) { const p = sample.progress, v = animationCurveValue(curve, p), [x, y] = pixel(p, v); c.save(); c.beginPath(); c.rect(g.left, g.top, g.right - g.left, g.bottom - g.top); c.clip(); c.fillStyle = accent; c.beginPath(); c.arc(x, y, 7 * uiScale, 0, Math.PI * 2); c.fill(); c.restore(); invalidate(); } else { playing = false; syncPlayback(); } }
  }
  function keydown(e) {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Escape' && layoutGesture) { e.preventDefault(); cancelLayout(); return; }
    if (e.key === 'Escape' && numericDraft) { e.preventDefault(); const before = numericDraft.before; numericDraft = null; change(before, false); send('cancelPreview'); e.target.blur(); return; }
    if (isTextEntry(e.target) || e.isComposing) { if (e.key === 'Enter' && e.target.matches('input')) { e.target.dispatchEvent(new Event('change')); e.target.blur(); host.focus({ preventScroll: true }); } return; }
    if (!ui.help.hidden) { if (e.key === 'Escape') { e.preventDefault(); hideHelp(); } return; }
    const key = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && key === 'z') { e.preventDefault(); safely(() => history(!e.shiftKey)); }
    else if ((e.ctrlKey || e.metaKey) && key === 'y') { e.preventDefault(); safely(() => history(false)); }
    else if ((e.ctrlKey || e.metaKey) && key === 'a') { e.preventDefault(); selection = new Set(curve.nodes.map((_, i) => i)); renderFields(); invalidate(); }
    else if (['Delete', 'Backspace'].includes(e.key)) { e.preventDefault(); removeSelected(); }
    else if (e.key === 'Escape') { e.preventDefault(); if (gesture) cancel(); else if (playing) stopPlayback(); else { selection.clear(); setMode('select'); renderFields(); invalidate(); } }
    else if (!e.ctrlKey && !e.metaKey && !e.altKey) { if (key === 'v') setMode('select'); else if (key === 'a') setMode('add'); else if (key === 'd') setMode('delete'); else if (key === 'f') fit(); else if (e.key === ' ') { e.preventDefault(); safely(togglePlayback); } else if (e.key === 'F1' || key === '?') { e.preventDefault(); showHelp(); } }
  }

  const blur = () => { if (gesture) cancel(); if (layoutGesture) cancelLayout(); stopPlayback(); };
  const resized = () => { layout(); invalidate(); clearTimeout(resizeTimer); resizeTimer = setTimeout(rememberView, 150); };
  const themed = () => { invalidate(); };
  window.addEventListener('blur', blur); window.addEventListener('resize', resized); document.addEventListener('rpen-editor-skin-changed', themed);
  event = copy(initial.event); curve = copy(initial.curve); templates = copy(initial.templates);
  if (initial.timing) { const tempo = new TempoMap(initial.timing.BPMList), factor = initial.timing.factor ?? 1; timing = { tempo, factor, start: tempo.seconds(event.startTime, factor), end: tempo.seconds(event.endTime, factor) }; }
  build();
  return {
    keydown,
    message(type, detail) {
      if (disposed) return;
      if (type === 'error') status(detail, true);
      if (type === 'invalid' && valid) {
        cancel(); stopPlayback(); ui.play.disabled = true;
        if (numericDraft) { curve = numericDraft.before; numericDraft = null; }
        valid = false; status(detail, true); host.dataset.invalid = 'true';
        for (const field of ui.fields.querySelectorAll('input,select,button')) field.disabled = true;
        invalidate();
      }
      if (type === 'applied') { event = copy(detail.event); state = copy(detail.state); status(text('applied')); }
      if (type === 'librarySaved') { status(text('librarySaved')); }
    },
    dispose() {
      if (disposed) return;
      // Closing cancels unfinished input; completed edits already belong to history.
      if (numericDraft) { curve = numericDraft.before; numericDraft = null; }
      cancel(); stopPlayback(); cancelLayout(); rememberView(); disposed = true; clearTimeout(resizeTimer);
      observer?.disconnect(); if (frame) cancelAnimationFrame(frame); frame = 0;
      window.removeEventListener('blur', blur); window.removeEventListener('resize', resized); document.removeEventListener('rpen-editor-skin-changed', themed);
      host.remove(); if (previousFocus?.isConnected && !previousFocus.closest('#animation-curve-editor')) previousFocus.focus({ preventScroll: true });
    },
  };
}
