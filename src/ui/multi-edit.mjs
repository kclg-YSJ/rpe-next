import { localPreferences } from '../platform/local-preferences.mjs';
import { captureSelection, commitSelectionEdit } from '../application/batch-edit.mjs';
import { previewMultiEdit, previewEventClones, NOTE_BATCH_FIELDS, EVENT_BATCH_FIELDS, EVENT_BATCH_TYPES, BATCH_OPERATIONS } from '../application/multi-edit.mjs';
import { beatValue } from '../core/beat.mjs';
import { easing, bezier } from '../core/easing.mjs';
import { createEasingPicker, EASING_NAMES } from './easing-picker.mjs';
import { NOTE_COLORS } from './timeline.mjs';
import { MultiEditParameters } from '../application/multi-edit-parameters.mjs';
import { runEventTool } from './event-tools.mjs';
import { editorSkinContext } from './editor-skin-canvas.mjs';
import { t } from '../i18n.mjs';

function control(root, title, value, options) {
  const label = document.createElement('label'); label.className = 'field'; label.append(title);
  const input = document.createElement(options ? 'select' : 'input'); input.setAttribute('aria-label', title);
  if (options) for (const [key, text] of options) input.append(new Option(text, key));
  input.value = value; label.append(input); root.append(label); return input;
}

function distributionFields(root, prefix = '') {
  const lower = control(root, t('multi-edit.s09ddb64', { p0: prefix }), '0'); const upper = control(root, t('multi-edit.sda34019', { p0: prefix }), '0');
  const easingType = control(root, t('multi-edit.s5ee79a3', { p0: prefix }), '1', EASING_NAMES.map((name, index) => [index + 1, `${index + 1} · ${name}`]));
  const cycle = control(root, t('multi-edit.s635e391', { p0: prefix }), '1'); const disturbance = control(root, t('multi-edit.s31b13fc', { p0: prefix }), '0');
  const picker = createEasingPicker(1, value => { easingType.value = value; easingType.dispatchEvent(new Event('input', { bubbles: true })); });
  easingType.addEventListener('input', () => picker.select(Number(easingType.value))); root.append(picker.element);
  const read = () => ({ lower: lower.value, upper: upper.value, easingType: Number(easingType.value), cycle: cycle.value, disturbance: disturbance.value });
  read.write = value => {
    lower.value = value.lower ?? '0'; upper.value = value.upper ?? '0'; easingType.value = value.easingType ?? 1;
    cycle.value = value.cycle ?? '1'; disturbance.value = value.disturbance ?? '0'; picker.select(Number(easingType.value));
  };
  return read;
}

function hint(root, text) { const paragraph = document.createElement('p'); paragraph.className = 'hint'; paragraph.textContent = text; root.append(paragraph); return paragraph; }

export class MultiEditPanel {
  constructor(root, getSession, timeline, { close, invalidate, notify }) {
    this.root = root; this.getSession = getSession; this.timeline = timeline;
    this.close = close; this.invalidate = invalidate; this.notify = notify; this.active = false; this.previewHovered = false;
    root.addEventListener('pointerenter', () => { this.previewHovered = true; this.invalidate(); });
    root.addEventListener('pointerleave', () => { this.previewHovered = false; this.invalidate(); });
    this.parameters = new MultiEditParameters(localPreferences, message => notify(message, 'warning'));
  }

  open(kind) {
    if (this.active && this.kind === kind) { this.sync(); return; }
    this.active = true; this.kind = kind; this.seed = 1; this.result = null; this.signature = null;
    const root = this.root; root.replaceChildren();
    const title = document.createElement('div'); title.className = 'panel-title'; title.textContent = kind === 'notes' ? t('multi-edit.sb6efc8e') : t('multi-edit.s5eadfea'); root.append(title);
    const parametersBox = document.createElement('details'); parametersBox.className = 'batch-parameters'; root.append(parametersBox);
    const parametersHeading = document.createElement('summary'); parametersHeading.textContent = t('multi-edit.s3f5d14d'); parametersBox.append(parametersHeading);
    const history = control(parametersBox, t('multi-edit.s0b6d227'), '', []);
    const historyActions = document.createElement('div'); historyActions.className = 'action-grid'; parametersBox.append(historyActions);
    const previous = document.createElement('button'); previous.textContent = t('multi-edit.see21cf8');
    const next = document.createElement('button'); next.textContent = t('multi-edit.s3ec3c8a'); historyActions.append(previous, next);
    const saved = control(parametersBox, t('multi-edit.s5cfcddd'), '', []);
    const name = control(parametersBox, t('multi-edit.s480d10d'), ''); name.maxLength = 80;
    const savedActions = document.createElement('div'); savedActions.className = 'action-grid'; parametersBox.append(savedActions);
    const save = document.createElement('button'); save.textContent = t('multi-edit.sd8dad8b');
    const remove = document.createElement('button'); remove.textContent = t('multi-edit.se1b4c1f'); savedActions.append(save, remove);
    hint(parametersBox, t('multi-edit.s10f230d'));
    this.updateHistory = () => {
      history.replaceChildren(new Option(t('multi-edit.s1900e17'), ''), ...this.parameters.history[kind].map((value, index) => new Option(t('multi-edit.s3091692', { p0: index + 1, p1: value.mode === 'script' ? t('multi-edit.s7fbccbe') : value.mode === 'clone' ? t('multi-edit.s6e60458') : `${value.field} ${value.operation} ${value.lower}…${value.upper}` }), index)));
      saved.replaceChildren(new Option(t('multi-edit.se3c12de'), ''), ...this.parameters.saved[kind].map(entry => new Option(entry.name, entry.name)));
      previous.disabled = next.disabled = !this.parameters.history[kind].length;
    };
    const loadHistory = index => {
      const entries = this.parameters.history[kind]; if (!entries.length) return;
      const position = (index + entries.length) % entries.length; history.value = position; this.load(entries[position]);
    };
    history.onchange = () => { if (history.value !== '') loadHistory(Number(history.value)); };
    previous.onclick = () => loadHistory(history.value === '' ? this.parameters.history[kind].length - 1 : Number(history.value) - 1);
    next.onclick = () => loadHistory(history.value === '' ? 0 : Number(history.value) + 1);
    saved.onchange = () => { const entry = this.parameters.saved[kind].find(entry => entry.name === saved.value); if (entry) { name.value = entry.name; this.load(entry.value); } };
    save.onclick = () => { try { this.parameters.save(kind, name.value, this.read()); this.updateHistory(); saved.value = name.value.trim(); this.notify(t('multi-edit.s9c985fc'), 'success'); } catch (error) { this.notify(error.message, 'warning'); } };
    remove.onclick = () => { if (saved.value) { this.parameters.remove(kind, saved.value); this.updateHistory(); } };
    this.updateHistory();
    hint(root, t('multi-edit.s19996f8'));
    const mode = control(root, t('multi-edit.s1640f9b'), 'form', [['form', t('multi-edit.s9537636')], ['script', t('multi-edit.s5fce32d')], ...(kind === 'events' ? [['clone', t('multi-edit.s1ead29e')]] : [])]);
    const isMultiEventEdit = kind === 'events' && this.getSession().multiLineActive && this.getSession().multiLineMode === 'events';
    const applicationMode = isMultiEventEdit ? control(root, t('multi-edit.sd0e300b'), 'per-line', [['per-line', t('multi-edit.s81122be')], ['global', t('multi-edit.s62563b0')]]) : null;
    const common = document.createElement('div'); root.append(common);
    const filter = control(common, kind === 'notes' ? t('multi-edit.s8642504') : t('multi-edit.s1eefde9'), kind === 'notes' ? '0' : 'all', kind === 'notes' ? [[0, t('multi-edit.s778fc8f')], [1, 'Tap'], [2, 'Hold'], [3, 'Flick'], [4, 'Drag']] : EVENT_BATCH_TYPES);
    const condition = control(common, t('multi-edit.se9d5ab4'), ''); condition.placeholder = kind === 'notes' ? t('multi-edit.s97d6041') : t('multi-edit.sf092c32');
    const form = document.createElement('div'); root.append(form);
    const field = control(form, t('multi-edit.s575aeda'), kind === 'notes' ? 'x' : 'both', kind === 'notes' ? NOTE_BATCH_FIELDS : EVENT_BATCH_FIELDS);
    const operation = control(form, t('multi-edit.s1645ef4'), 'By', BATCH_OPERATIONS);
    const readDistribution = distributionFields(form);
    if (kind === 'events') {
      const tools = document.createElement('div'); tools.className = 'action-grid'; form.append(tools);
      for (const [action, title] of [['cut', t('multi-edit.sa18ddc2')], ['stick', t('multi-edit.s086e390')]]) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = title;
        button.onclick = () => runEventTool(this.getSession(), action, this.notify, this.timeline.origin); tools.append(button);
      }
      hint(form, t('multi-edit.sa3225c6'));
    }
    hint(form, t('multi-edit.sd51950e'));
    if (kind === 'events') hint(form, t('multi-edit.s0456d0a'));
    const scriptBox = document.createElement('div'); scriptBox.hidden = true; root.append(scriptBox);
    const script = document.createElement('textarea'); script.rows = 7; script.className = 'batch-script'; script.setAttribute('aria-label', t('multi-edit.s79d5c05'));
    script.value = kind === 'notes' ? 'x = lerp(-500, 500, u);\nsize = 1 + 0.25 * sin(u * pi);' : 'start += 20 * sin(u * pi);\nend += 20 * sin(u * pi);';
    scriptBox.append(script);
    const help = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = t('multi-edit.sa4ef858'); help.append(summary); scriptBox.append(help);
    hint(help, t('multi-edit.s8a1d50f'));
    hint(help, t('multi-edit.sa5dbd4b'));
    hint(help, t('multi-edit.sae69bd8', { p0: (kind === 'notes' ? NOTE_BATCH_FIELDS : EVENT_BATCH_FIELDS).map(([key]) => key).filter(key => !['hitSound', 'both', 'order'].includes(key)).join(', '), p1: kind === 'notes' ? ', type, isFake, above' : ', inst' }));
    hint(help, t('multi-edit.s4db201b'));
    const clone = document.createElement('div'); clone.hidden = true; root.append(clone);
    const targets = control(clone, t('multi-edit.s60316f0'), String(this.getSession().lineIndex));
    const increment = control(clone, t('multi-edit.s5e5824d'), '0');
    const retainLabel = document.createElement('label'); retainLabel.className = 'field'; retainLabel.append(t('multi-edit.sd2cec64'));
    const retainSource = document.createElement('input'); retainSource.type = 'checkbox'; retainSource.checked = true; retainSource.setAttribute('aria-label', t('multi-edit.sd2cec64')); retainLabel.append(retainSource); clone.append(retainLabel);
    hint(clone, t('multi-edit.s3091c5b'));
    const channels = new Map();
    for (const [type, name] of EVENT_BATCH_TYPES.slice(1, 5)) {
      const details = document.createElement('details'); const heading = document.createElement('summary'); heading.textContent = t('multi-edit.s9498be5', { p0: name }); details.append(heading); clone.append(details);
      channels.set(type, distributionFields(details, `${name} · `));
    }
    hint(clone, t('multi-edit.secef59e'));
    const randomButton = document.createElement('button'); randomButton.type = 'button'; randomButton.textContent = t('multi-edit.sd364fde'); root.append(randomButton);
    randomButton.onclick = () => { this.seed++; this.parameters.update(kind, this.read()); this.refresh(); };
    this.summary = hint(root, ''); this.summary.setAttribute('role', 'status');
    const previewLabel = document.createElement('label'); previewLabel.className = 'batch-preview-toggle';
    const preview = document.createElement('input'); preview.type = 'checkbox'; preview.checked = true; previewLabel.append(preview, t('multi-edit.s00b7dd3')); root.append(previewLabel); this.previewEnabled = preview;
    const actions = document.createElement('div'); actions.className = 'action-grid batch-panel-actions'; root.append(actions);
    this.apply = document.createElement('button'); this.apply.type = 'button'; this.apply.className = 'primary'; this.apply.textContent = t('multi-edit.sb3144a8');
    const reset = document.createElement('button'); reset.type = 'button'; reset.textContent = t('multi-edit.sb1a4621');
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = t('multi-edit.sb3669b2'); actions.append(this.apply, reset, cancel);
    cancel.onclick = () => this.close();
    this.read = () => ({ ...readDistribution(), mode: mode.value, field: field.value, operation: operation.value,
      eventApplicationMode: applicationMode?.value ?? 'per-line',
      noteType: kind === 'notes' ? Number(filter.value) : 0, eventType: kind === 'events' ? filter.value : 'all',
      condition: condition.value, script: script.value, seed: this.seed, targets: targets.value, increment: increment.value, retainSource: retainSource.checked,
      division: this.timeline.division, channels: Object.fromEntries([...channels].map(([key, read]) => [key, read()])) });
    const updateMode = () => {
      form.hidden = mode.value !== 'form'; scriptBox.hidden = mode.value !== 'script'; clone.hidden = mode.value !== 'clone'; common.hidden = mode.value === 'clone';
    };
    this.load = value => {
      mode.value = value.mode; field.value = value.field; operation.value = value.operation; if (applicationMode) applicationMode.value = value.eventApplicationMode ?? 'per-line'; filter.value = kind === 'notes' ? value.noteType : value.eventType;
      condition.value = value.condition; script.value = value.script; this.seed = value.seed; targets.value = value.targets; increment.value = value.increment;
      retainSource.checked = value.retainSource !== false;
      readDistribution.write(value); for (const [key, read] of channels) read.write(value.channels?.[key] ?? {});
      updateMode(); this.parameters.update(kind, this.read()); this.refresh();
    };
    reset.onclick = () => { this.parameters.reset(kind); this.load(this.parameters.read(kind)); };
    root.oninput = event => {
      if (parametersBox.contains(event.target)) return;
      updateMode(); this.parameters.update(kind, this.read());
      this.refresh();
    };
    this.apply.onclick = () => {
      this.refresh(); if (!this.result) return;
      const result = this.result; const amount = result.changes.length;
      this.committing = true;
      try {
        commitSelectionEdit(this.getSession(), result, mode.value === 'clone' ? t('multi-edit.s7b5795d') : t('multi-edit.s57c5445', { p0: kind === 'notes' ? t('multi-edit.s7ac3289') : t('multi-edit.s550e328') }));
        const position = this.parameters.remember(kind, this.read()); this.updateHistory(); history.value = position;
        this.result = null; this.chart = this.getSession().chart; this.signature = this.selectionSignature();
        this.summary.textContent = t('multi-edit.s60014d9', { p0: amount });
        this.notify(t('multi-edit.s684ad73', { p0: amount }), 'success'); this.invalidate();
      }
      catch (error) { this.notify(error.message, 'error'); }
      finally { this.committing = false; }
    };
    this.load(this.parameters.read(kind));
    this.sync();
    const inspector = root.closest('.inspector'); if (inspector) inspector.scrollTop = 0;
  }

  hide() { this.active = false; this.result = null; this.previewHovered = false; this.invalidate(); }

  sync() {
    if (!this.active || this.committing) return;
    const session = this.getSession();
    const signature = this.selectionSignature();
    if (session.chart === this.chart && signature === this.signature) return;
    this.chart = session.chart; this.signature = signature; this.refresh();
  }

  selectionSignature() {
    const session = this.getSession();
    const multiEvents = [...(session.multiEventSelection ?? new Map())].map(([line, values]) => `${line}:${[...values].sort().join(',')}`).sort().join('|');
    return `${session.lineIndex}:${session.eventLayer}:${this.timeline.division}:${[...session.selection]}:${[...session.eventSelection]}:${multiEvents}`;
  }

  refresh() {
    this.result = null;
    try {
      const snapshot = captureSelection(this.getSession()); const options = this.read();
      this.result = options.mode === 'clone' ? previewEventClones(snapshot, options) : previewMultiEdit(snapshot, this.kind, options);
      this.summary.textContent = t('multi-edit.s72fa7cc', { p0: this.result.changes.length, p1: new Set(this.result.changes.map(change => change.lineIndex)).size });
      this.summary.classList.remove('batch-error');
    } catch (error) { this.summary.textContent = error.message; this.summary.classList.add('batch-error'); }
    this.apply.disabled = !this.result;
    this.invalidate();
  }

  drawTimeline() {
    if (!this.active || !this.result || !this.previewEnabled.checked || this.previewHovered === false) return;
    const timeline = this.timeline; const session = this.getSession();
    const canvas = this.kind === 'notes' ? timeline.notesCanvas : timeline.eventsCanvas;
    if (!canvas.clientWidth || this.kind === 'events' && timeline.notesOnly) return;
    const context = editorSkinContext(canvas.getContext('2d'), 'batch-preview'); context.save(); context.setLineDash([5, 3]); context.lineWidth = 2;
    context.beginPath(); context.rect(0, this.kind === 'events' ? 23 : 0, canvas.clientWidth, canvas.clientHeight); context.clip();
    const ranges = new Map();
    if (this.kind === 'events') for (const change of this.result.changes) {
      const rangeKey = `${change.lineIndex}:${change.type}`;
      const range = ranges.get(rangeKey) ?? [Infinity, -Infinity];
      const chain = change.lineIndex === session.lineIndex ? timeline.chainRanges?.[timeline.eventTypes.indexOf(change.type)]?.get(change.index) : null;
      if (Number.isFinite(chain?.min) && Number.isFinite(chain?.max)) { range[0] = Math.min(range[0], chain.min); range[1] = Math.max(range[1], chain.max); }
      for (const item of [change.before, change.after]) if (Number.isFinite(item.start) && Number.isFinite(item.end)) {
        range[0] = Math.min(range[0], item.start, item.end); range[1] = Math.max(range[1], item.start, item.end);
      }
      ranges.set(rangeKey, range);
    }
    for (const change of this.result.changes) {
      const item = change.after;
      const lineIndex = Number.isInteger(change.lineIndex) ? change.lineIndex : session.lineIndex;
      const multiArea = session.multiLineActive && session.multiLineMode === this.kind;
      const width = canvas.clientWidth;
      const panelWidth = multiArea ? timeline.panelWidth(width, this.kind) : width;
      const panelOffset = multiArea ? timeline.panelIndex(lineIndex, this.kind) * timeline.panelStride(width, this.kind) - timeline.multiLineViewportOffset(width, this.kind) : 0;
      const vertical = beat => multiArea ? timeline.verticalForLine(beat, lineIndex, canvas.clientHeight) : change.type === 'paintEvents' ? timeline.eventVertical(beat, change.type) : timeline.vertical(beat);
      const top = vertical(beatValue(item.endTime)); const bottom = vertical(beatValue(item.startTime));
      if (top > canvas.clientHeight || bottom < 0) continue;
      if (this.kind === 'notes') {
        context.strokeStyle = NOTE_COLORS[item.type] ?? '#fff';
        const noteWidth = timeline.noteWidth(item, timeline.highlight !== false && timeline.simultaneous?.has(change.before));
        const horizontal = timeline.clampNoteHorizontal(timeline.noteHorizontal(item.positionX, lineIndex), noteWidth, canvas.clientWidth, lineIndex);
        if (horizontal != null) context.strokeRect(horizontal - noteWidth / 2 - 3, Math.max(-10, top - 7), noteWidth + 6, Math.min(canvas.clientHeight + 20, Math.max(14, bottom - Math.max(-10, top) + 14)));
      } else {
        const column = timeline.eventTypes.indexOf(change.type); if (column < 0) continue;
        const localBounds = timeline.eventColumnBounds(column, panelWidth);
        const bounds = { x: panelOffset + localBounds.x, width: localBounds.width };
        context.save(); context.beginPath(); context.rect(bounds.x, 23, bounds.width, canvas.clientHeight); context.clip();
        context.strokeStyle = '#a4b0bd'; context.setLineDash([2, 4]); context.lineWidth = 1;
        drawEventGhost(context, change.before, bounds.x, bounds.width, vertical, ranges.get(`${lineIndex}:${change.type}`));
        context.fillStyle = '#67e8c022'; context.fillRect(bounds.x, top, bounds.width, Math.max(2, bottom - top));
        context.strokeStyle = '#8effd0'; context.setLineDash([5, 3]); context.lineWidth = 2.5;
        drawEventGhost(context, item, bounds.x, bounds.width, vertical, ranges.get(`${lineIndex}:${change.type}`));
        context.font = '12px RPE, sans-serif'; context.textAlign = 'center';
        const format = value => Number.isFinite(value) ? Number(value.toFixed(3)).toString() : Array.isArray(value) ? value.join(',') : String(value ?? '');
        if (bottom - top > 24) {
          for (const [value, position] of [[item.end ?? item.shader, Math.max(36, top + 13)], [item.start ?? item.shader, Math.min(canvas.clientHeight - 5, bottom - 4)]]) {
            context.fillStyle = '#203c33'; context.fillRect(bounds.x + 2, position - 11, bounds.width - 4, 14);
            context.fillStyle = '#baffdf'; context.fillText(format(value), bounds.x + bounds.width / 2, position, bounds.width - 8);
          }
        }
        context.restore();
      }
    }
    context.restore();
  }
}

function drawEventGhost(context, event, horizontal, width, vertical, range = [Math.min(event.start, event.end), Math.max(event.start, event.end)]) {
  const start = beatValue(event.startTime); const end = beatValue(event.endTime);
  const top = vertical(end); const bottom = vertical(start);
  context.strokeRect(horizontal, top, width, Math.max(2, bottom - top));
  if (typeof event.start !== 'number' || typeof event.end !== 'number') return;
  context.beginPath();
  for (let step = 0; step <= 30; step++) {
    const progress = step / 30;
    const amount = event.bezier ? bezier(progress, event.bezierPoints) : easing(progress, event.easingType ?? 1, event.easingLeft ?? 0, event.easingRight ?? 1);
    const value = event.start + (event.end - event.start) * amount;
    const position = horizontal + 5 + (range[0] === range[1] ? 0.5 : (value - range[0]) / (range[1] - range[0])) * (width - 10);
    if (!step) context.moveTo(position, vertical(start)); else context.lineTo(position, vertical(start + (end - start) * progress));
  }
  context.stroke();
}
