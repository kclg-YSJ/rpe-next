import { localPreferences } from '../platform/local-preferences.mjs';
import { CURVE_PRESETS, TRAJECTORY_DEFAULTS, sampleCurveTrajectory, presetOptions, validateCurvePreset, editableTrajectoryOptions } from '../core/curve-trajectory.mjs';
import { createTrajectoryEvent, trajectoryChart, splitTrajectoryChart } from '../application/trajectory-commands.mjs';
import { parseBeat, formatBeat } from '../core/beat.mjs';
import { SceneRuntime } from '../core/scene.mjs';
import { previewViewport, previewPositionScale } from '../core/editor-display.mjs';
import { download } from '../platform/files.mjs';
import { prepareCanvas } from './timeline.mjs';
import { editorSkinContext } from './editor-skin-canvas.mjs';
import { trajectorySplitSettings } from '../core/trajectory-simplify.mjs';
import { parseCurvePreset, saveCurvePreset, deleteCurvePreset, copyCurvePreset } from '../core/trajectory-presets.mjs';
import { t } from '../i18n.mjs';

const STORAGE_KEY = 'rpe-next-trajectory-presets-v1';
const COMMON_FIELDS = [
  ['trimStart', t('trajectory-panel.s7c203c4'), 'number', 0, 1, 0.01], ['trimEnd', t('trajectory-panel.s9ce7cd3'), 'number', 0, 1, 0.01],
  ['rotation', t('trajectory-panel.sb23ce41'), 'number', -3600, 3600, 1],
  ['scaleX', t('trajectory-panel.s7447117'), 'number', -100, 100, 0.1], ['scaleY', t('trajectory-panel.sb79bebd'), 'number', -100, 100, 0.1],
  ['alignStart', t('trajectory-panel.sc31190f'), 'checkbox'], ['startX', t('trajectory-panel.s7316a5b'), 'number', -100000, 100000, 1], ['startY', t('trajectory-panel.s0125dac'), 'number', -100000, 100000, 1],
  ['randomness', t('trajectory-panel.s57a4a6f'), 'range', 0, 1, 0.01], ['seed', t('trajectory-panel.sed73926'), 'number', 0, 100000, 1],
];

function field(host, key, title, value, type = 'text', minimum, maximum, step, choices) {
  const label = document.createElement('label'); label.className = 'field'; label.append(title);
  const input = document.createElement(choices ? 'select' : 'input');
  input.dataset.key = key; input.setAttribute('aria-label', title);
  if (choices) input.replaceChildren(...choices.map(([value, text]) => new Option(text, value)));
  else input.type = type;
  if (minimum !== undefined) input.min = minimum;
  if (maximum !== undefined) input.max = maximum;
  input.step = step ?? 'any';
  if (type === 'checkbox') input.checked = Boolean(value); else input.value = value ?? '';
  if (key === 'seed') {
    const controls = document.createElement('span'); controls.className = 'trajectory-seed';
    const randomize = document.createElement('button'); randomize.type = 'button'; randomize.textContent = '⚄'; randomize.title = t('trajectory-panel.sed73926'); randomize.setAttribute('aria-label', t('trajectory-panel.sa598266'));
    randomize.onclick = () => { const previous = Number(input.value); input.value = (previous + 1 + crypto.getRandomValues(new Uint32Array(1))[0] % 100000) % 100001; input.dispatchEvent(new Event('input', { bubbles: true })); };
    controls.append(input, randomize); label.append(controls);
  } else label.append(input);
  host.append(label); return input;
}
const action = (title, run) => { const button = document.createElement('button'); button.type = 'button'; button.textContent = title; button.onclick = run; return button; };
function readFields(host, base) {
  const result = { ...base };
  for (const input of host.querySelectorAll('[data-key]')) {
    const key = input.dataset.key;
    result[key] = input.type === 'checkbox' ? input.checked : ['number', 'range'].includes(input.type) ? (input.value.trim() ? Number(input.value) : NaN) : input.value;
  }
  return result;
}
function drawPath(canvas, points, progress = 0) {
  const context = editorSkinContext(canvas.getContext('2d')); const width = canvas.width; const height = canvas.height;
  context.clearRect(0, 0, width, height); context.fillStyle = '#242424'; context.fillRect(0, 0, width, height);
  if (!points?.length) return;
  const xs = points.map(point => point.x); const ys = points.map(point => point.y);
  const left = Math.min(...xs); const right = Math.max(...xs); const bottom = Math.min(...ys); const top = Math.max(...ys);
  const scale = Math.min((width - 24) / Math.max(1, right - left), (height - 24) / Math.max(1, top - bottom));
  const map = point => [width / 2 + (point.x - (left + right) / 2) * scale, height / 2 - (point.y - (top + bottom) / 2) * scale];
  context.lineWidth = 2; context.strokeStyle = '#edd38c'; context.beginPath();
  points.forEach((point, index) => index ? context.lineTo(...map(point)) : context.moveTo(...map(point))); context.stroke();
  context.fillStyle = '#76efaf'; context.beginPath(); context.arc(...map(points[Math.min(points.length - 1, Math.floor(progress * (points.length - 1)))]), 4, 0, Math.PI * 2); context.fill();
}

export class TrajectoryPanel {
  constructor(host, getContext, { invalidate, notify, activate }) {
    this.host = host; this.getContext = getContext; this.invalidate = invalidate; this.notify = notify; this.activate = activate;
    this.options = structuredClone(TRAJECTORY_DEFAULTS); this.segments = 128;
    this.splitSettings = trajectorySplitSettings();
    this.startTime = [1, 0, 1]; this.endTime = [5, 0, 1]; this.enabled = true; this.animate = true;
    this.overlay = document.createElement('canvas'); this.overlay.className = 'trajectory-overlay'; this.overlay.hidden = true;
    document.querySelector('.stage').append(this.overlay);
    this.custom = [];
    try { this.custom = JSON.parse(localPreferences.getItem(STORAGE_KEY) ?? '[]').map(validateCurvePreset); } catch { this.custom = []; }
  }

  open(event = null, lineIndex, layerIndex) {
    const { session, timeline } = this.getContext();
    this.active = true; this.editing = event; this.presetDraft = null;
    this.lineIndex = lineIndex ?? session.lineIndex; this.layerIndex = layerIndex ?? Math.min(3, timeline.layer);
    if (event) { this.options = editableTrajectoryOptions(event.trajectory.options); this.startTime = [...event.startTime]; this.endTime = [...event.endTime]; this.segments = event.trajectory.segments ?? 128; this.splitSettings = trajectorySplitSettings(event.trajectory.split); }
    this.render(); this.activate('trajectory'); this.refresh();
  }

  hide() { this.active = false; this.overlay.hidden = true; this.previewChart = null; }

  render() {
    this.host.replaceChildren();
    this.content = document.createElement('div'); this.content.className = 'trajectory-scroll'; this.host.append(this.content);
    this.fields = document.createElement('div'); this.fields.className = 'trajectory-fields';
    field(this.fields, 'lineIndex', t('trajectory-panel.sc167205'), this.lineIndex, 'number', 0, this.getContext().session.chart.judgeLineList.length - 1, 1);
    field(this.fields, 'layerIndex', t('trajectory-panel.s16ad9eb'), this.layerIndex, 'number', 0, 3, 1);
    field(this.fields, 'startTime', t('trajectory-panel.s087c451'), formatBeat(this.startTime));
    field(this.fields, 'endTime', t('trajectory-panel.sc4d3fa4'), formatBeat(this.endTime));
    field(this.fields, 'mode', t('trajectory-panel.scd3b8cd'), this.options.mode, 'text', undefined, undefined, undefined, [['parametric', t('trajectory-panel.s362b25f')], ['polar', t('trajectory-panel.s882f015')]]);
    for (const [key, title] of [['xExpression', 'x(t)'], ['yExpression', 'y(t)'], ['parameterStart', t('trajectory-panel.s44de969')], ['parameterEnd', t('trajectory-panel.s71bb1db')], ['radiusExpression', 'r(θ)'], ['angleStart', t('trajectory-panel.sef63303')], ['angleEnd', t('trajectory-panel.s9f7c0f3')], ['rotationExpression', t('trajectory-panel.s515a05a')]]) field(this.fields, key, title, this.options[key]);
    field(this.fields, 'tangentRotation', t('trajectory-panel.s9d776f8'), this.options.tangentRotation, 'checkbox');
    for (const [key, title] of [['easingX', t('trajectory-panel.s7e43ff4')], ['easingY', t('trajectory-panel.s1671cb2')]]) field(this.fields, key, title, this.options[key], 'number', 1, 29, 1);
    for (const [key, title, type, minimum, maximum, step] of COMMON_FIELDS) field(this.fields, key, title, this.options[key], type, minimum, maximum, step);
    const parameters = field(this.fields, 'parametersJson', t('trajectory-panel.sea12a51'), JSON.stringify(this.options.parameters ?? {})); parameters.title = t('trajectory-panel.s71b971a');
    field(this.fields, 'segments', t('trajectory-panel.s179ca94'), this.segments, 'number', 4, 8192, 1);
    field(this.fields, 'simplify', t('trajectory-panel.sc6ed56c'), this.splitSettings.simplify, 'checkbox');
    field(this.fields, 'tolerance', t('trajectory-panel.s5664b24'), this.splitSettings.tolerance, 'number', 0.001, 10000, 0.1);
    field(this.fields, 'replace', t('trajectory-panel.s8b5b963'), this.replace, 'checkbox');
    this.content.append(this.fields);
    this.fields.oninput = () => {
      try {
        const values = readFields(this.fields, this.options);
        this.lineIndex = Number(values.lineIndex); this.layerIndex = Number(values.layerIndex);
        this.startTime = parseBeat(values.startTime); this.endTime = parseBeat(values.endTime);
        this.segments = values.segments; this.replace = values.replace;
        this.splitSettings = trajectorySplitSettings({ simplify: values.simplify, tolerance: values.tolerance });
        this.options = { ...values, parameters: JSON.parse(values.parametersJson) };
        for (const key of ['startTime', 'endTime', 'lineIndex', 'layerIndex', 'segments', 'replace', 'parametersJson', 'simplify', 'tolerance']) delete this.options[key];
        this.presetDraft = null; this.refresh();
      } catch (error) { this.error(error); }
    };
    const syntax = document.createElement('details'); syntax.className = 'trajectory-syntax';
    const summary = document.createElement('summary'); summary.textContent = t('trajectory-panel.sa4ecb8d');
    const hint = document.createElement('p'); hint.className = 'hint';
    hint.textContent = t('trajectory-panel.sbc6218f');
    hint.textContent += t('trajectory-panel.s56fe877');
    syntax.append(summary, hint); this.content.append(syntax);
    this.controls = document.createElement('div');
    field(this.controls, 'enabled', t('trajectory-panel.s49c9c0f'), this.enabled, 'checkbox');
    field(this.controls, 'animate', t('trajectory-panel.s0ae9268'), this.animate, 'checkbox');
    this.controls.oninput = () => { Object.assign(this, readFields(this.controls, {})); this.invalidate(); };
    this.content.append(this.controls);
    this.canvas = document.createElement('canvas'); this.canvas.width = 500; this.canvas.height = 240; this.canvas.className = 'trajectory-preview'; this.canvas.setAttribute('aria-label', t('trajectory-panel.s7a910a1')); this.content.append(this.canvas);
    this.message = document.createElement('p'); this.message.className = 'hint'; this.message.setAttribute('role', 'status'); this.content.append(this.message);
    const actions = document.createElement('div'); actions.className = 'trajectory-footer';
    this.applyButton = action(this.editing ? t('trajectory-panel.s2e1a917') : t('trajectory-panel.sf248e5c'), () => this.apply());
    this.splitButton = action(t('trajectory-panel.s53a23c2'), () => this.split()); this.splitButton.hidden = !this.editing;
    this.applyButton.className = 'primary';
    actions.append(this.splitButton, action(t('trajectory-panel.sb3669b2'), () => this.activate('chart')), this.applyButton); this.host.append(actions);
    this.gallery = document.createElement('div'); this.gallery.className = 'trajectory-gallery'; this.content.append(this.gallery); this.renderPresets();
    this.renderCustom();
  }

  renderPresets() {
    const expanded = new Set([...this.gallery.querySelectorAll('details[open]')].map(group => group.dataset.category));
    this.gallery.replaceChildren();
    for (const category of [t('trajectory-panel.s3bfba45'), t('trajectory-panel.sf505d38'), t('trajectory-panel.s1a26edf'), t('trajectory-panel.sc493338')]) {
      const group = document.createElement('details'); const title = document.createElement('summary'); title.textContent = category; group.append(title);
      group.dataset.category = category; group.open = expanded.has(category);
      const grid = document.createElement('div'); grid.className = 'trajectory-preset-grid'; group.append(grid);
      for (const preset of [...CURVE_PRESETS, ...this.custom].filter(entry => entry.category === category)) {
        const card = action(preset.name, () => this.expandPreset(preset, card, grid)); card.setAttribute('aria-expanded', 'false');
        const canvas = document.createElement('canvas'); canvas.width = 150; canvas.height = 90; canvas.setAttribute('aria-hidden', 'true');
        try { drawPath(canvas, sampleCurveTrajectory(presetOptions(preset), 129)); } catch {}
        card.prepend(canvas); grid.append(card);
      }
      this.gallery.append(group);
    }
  }

  expandPreset(preset, card, grid) {
    const closing = card.getAttribute('aria-expanded') === 'true';
    this.gallery.querySelectorAll('.trajectory-preset-editor').forEach(element => element.remove());
    this.gallery.querySelectorAll('[aria-expanded]').forEach(element => element.setAttribute('aria-expanded', 'false'));
    this.presetDraft = null;
    if (closing) { this.refresh(); return; }
    card.setAttribute('aria-expanded', 'true');
    const panel = document.createElement('div'); panel.className = 'trajectory-preset-editor';
    grid.insertBefore(panel, card.nextSibling);
    const title = document.createElement('strong'); title.textContent = preset.name + t('trajectory-panel.sd9a0c51'); panel.append(title);
    if (this.custom.includes(preset)) {
      panel.append(action(t('trajectory-panel.s6e5d996'), () => this.loadCustom(preset, preset.name)), action(t('trajectory-panel.sffb3981'), () => {
        try {
          const custom = deleteCurvePreset(this.custom, preset.name);
          localPreferences.setItem(STORAGE_KEY, JSON.stringify(custom)); this.custom = custom;
          if (this.customEditingName === preset.name) { this.customEditingName = null; this.validateCustom(); }
          this.presetDraft = null; this.renderPresets(); this.refresh(); this.notify(t('trajectory-panel.s1bd0271'), 'success');
        } catch (error) { this.customError(error); }
      }));
    }
    const base = presetOptions(preset);
    const parameters = document.createElement('div'); panel.append(parameters);
    for (const entry of preset.parameters) field(parameters, entry.key, entry.label ?? entry.key, entry.value, 'number', entry.min, entry.max, entry.step ?? 1);
    const common = document.createElement('div'); panel.append(common);
    for (const [key, label, type, minimum, maximum, step] of COMMON_FIELDS) field(common, key, label, base[key], type, minimum, maximum, step);
    const canvas = document.createElement('canvas'); canvas.width = 500; canvas.height = 220; canvas.className = 'trajectory-preview'; panel.append(canvas);
    const error = document.createElement('p'); error.className = 'hint'; panel.append(error);
    const update = () => {
      try {
        const options = { ...base, ...readFields(common, {}), parameters: { ...base.parameters, ...readFields(parameters, {}) } };
        const points = sampleCurveTrajectory(options, 257);
        this.presetDraft = { options, points, canvas, preset }; error.textContent = t('trajectory-panel.sf36ad83'); this.refresh();
      } catch (problem) { error.textContent = problem.message; this.presetDraft = null; this.error(problem); }
    };
    panel.oninput = update;
    panel.append(action(t('trajectory-panel.sbb6ccd7'), () => {
      if (!this.presetDraft) return;
      this.options = structuredClone(this.presetDraft.options);
      for (const input of this.fields.querySelectorAll('[data-key]')) {
        const key = input.dataset.key;
        if (key === 'parametersJson') input.value = JSON.stringify(this.options.parameters);
        else if (Object.hasOwn(this.options, key)) { if (input.type === 'checkbox') input.checked = this.options[key]; else input.value = this.options[key]; }
      }
      this.presetDraft = null; this.refresh(); error.textContent = t('trajectory-panel.s636a8ec');
    }));
    update();
  }

  renderCustom() {
    const group = document.createElement('details'); const title = document.createElement('summary'); title.textContent = t('trajectory-panel.sa51b1ba'); group.append(title);
    this.customGroup = group;
    const source = document.createElement('textarea'); source.className = 'trajectory-preset-source'; source.setAttribute('aria-label', t('trajectory-panel.s2062cd0'));
    this.customInput = source;
    source.value = this.customSource ?? JSON.stringify({ name: t('trajectory-panel.s7146275'), mode: 'parametric', xExpression: 'radius*cos(2*pi*t)', yExpression: 'radius*sin(2*pi*t)', parameters: [{ key: 'radius', label: t('trajectory-panel.sb29ee13'), value: 200, min: 1, max: 2000, step: 1 }] }, null, 2); group.append(source);
    const help = document.createElement('p'); help.className = 'hint'; help.textContent = t('trajectory-panel.sac74843'); group.append(help);
    this.customMessage = document.createElement('p'); this.customMessage.className = 'hint'; this.customMessage.setAttribute('role', 'status'); group.append(this.customMessage);
    this.customCanvas = document.createElement('canvas'); this.customCanvas.width = 500; this.customCanvas.height = 180; this.customCanvas.className = 'trajectory-preview'; this.customCanvas.setAttribute('aria-label', t('trajectory-panel.s81cae20')); group.append(this.customCanvas);
    const guarded = callback => () => { try { callback(); } catch (error) { this.customError(error); } };
    const save = (preset, originalName) => {
      const custom = saveCurvePreset(this.custom, preset, originalName);
      localPreferences.setItem(STORAGE_KEY, JSON.stringify(custom)); this.custom = custom;
      this.customEditingName = preset.name; source.value = JSON.stringify(preset, null, 2);
      this.presetDraft = null; this.renderPresets(); this.refresh(); this.validateCustom();
      this.gallery.querySelector('[data-category="自定义"]').open = true;
      this.customMessage.textContent = t('trajectory-panel.s131f057', { p0: preset.name }); this.notify(t('trajectory-panel.sd504761'), 'success');
    };
    this.customSave = action(t('trajectory-panel.s99c5368'), guarded(() => save(parseCurvePreset(source.value), this.customEditingName ?? null)));
    this.customCopy = action(t('trajectory-panel.s5d93a90'), guarded(() => save(copyCurvePreset(this.custom, parseCurvePreset(source.value)), null)));
    this.customExport = action(t('trajectory-panel.s2e18ef8'), guarded(() => { const preset = parseCurvePreset(source.value); download(new Blob([JSON.stringify(preset, null, 2)], { type: 'application/json' }), preset.name + '.trajectory.json'); }));
    group.append(this.customSave, this.customCopy, this.customExport);
    const load = action(t('trajectory-panel.se01224b'), guarded(() => this.loadCustom(copyCurvePreset(this.custom, validateCurvePreset({ ...this.options, name: this.options.name ?? t('trajectory-panel.s7146275'), parameters: Object.entries(this.options.parameters ?? {}).map(([key, value]) => ({ key, label: key, value })) })))));
    load.title = t('trajectory-panel.sa2bd587');
    group.insertBefore(load, source);
    source.oninput = () => this.validateCustom();
    const file = document.createElement('input'); file.type = 'file'; file.accept = '.json'; file.hidden = true;
    file.onchange = async () => { try { const selected = file.files[0]; if (!selected) return; if (selected.size > 65536) throw new Error(t('trajectory-panel.s7df46a3')); this.loadCustom(parseCurvePreset(await selected.text())); } catch (error) { this.customError(error); } finally { file.value = ''; } };
    group.append(action(t('trajectory-panel.s5dc5e2b'), () => file.click()), file); this.content.append(group);
    this.validateCustom();
  }

  loadCustom(preset, originalName = null) {
    this.customEditingName = originalName; this.customInput.value = JSON.stringify(preset, null, 2);
    this.customGroup.open = true; this.validateCustom(); this.customGroup.scrollIntoView({ block: 'start' });
  }

  customError(error) {
    this.customGroup.open = true; this.customMessage.textContent = error.message; this.customMessage.classList.add('error');
  }

  validateCustom() {
    this.customSource = this.customInput.value;
    this.customSave.textContent = this.customEditingName ? t('trajectory-panel.s4a61bde') : t('trajectory-panel.s99c5368');
    try {
      const preset = parseCurvePreset(this.customSource);
      this.customCopy.hidden = !this.customEditingName && !this.custom.some(entry => entry.name === preset.name);
      drawPath(this.customCanvas, sampleCurveTrajectory(presetOptions(preset), 257));
      this.customMessage.textContent = this.customEditingName ? t('trajectory-panel.s81bf38c', { p0: this.customEditingName }) : t('trajectory-panel.s22f4a49');
      this.customMessage.classList.remove('error'); this.customSave.disabled = false; this.customCopy.disabled = false; this.customExport.disabled = false; this.customInput.removeAttribute('aria-invalid');
    } catch (error) {
      this.customError(error); drawPath(this.customCanvas, null);
      this.customSave.disabled = true; this.customCopy.disabled = true; this.customExport.disabled = true; this.customInput.setAttribute('aria-invalid', 'true');
    }
  }

  error(error) { this.message.textContent = error.message; this.message.classList.add('error'); this.previewChart = null; this.points = null; this.worldPoints = null; this.applyButton.disabled = true; this.invalidate(); }

  refresh() {
    if (!this.active) return;
    try {
      const { session } = this.getContext();
      this.baseChart = session.chart;
      const options = this.presetDraft?.options ?? this.options;
      this.event = createTrajectoryEvent(options, this.startTime, this.endTime, this.segments, this.splitSettings);
      this.points = sampleCurveTrajectory(options, 257);
      this.previewChart = trajectoryChart(session.chart, this.lineIndex, this.layerIndex, this.event, this.editing, true);
      this.scene = new SceneRuntime(); this.scene.compile(this.previewChart, this.getContext().tempo);
      const { tempo } = this.getContext(); const factor = session.chart.judgeLineList[this.lineIndex].bpmfactor ?? 1;
      this.beginSeconds = tempo.seconds(this.startTime, factor); this.endSeconds = tempo.seconds(this.endTime, factor);
      this.worldPoints = this.points.map((point, index) => this.scene.sample(this.beginSeconds + (this.endSeconds - this.beginSeconds) * index / (this.points.length - 1))[this.lineIndex]);
      this.message.textContent = this.presetDraft ? t('trajectory-panel.s1980bf3') : t('trajectory-panel.s25de9dc');
      this.message.classList.remove('error'); this.applyButton.disabled = Boolean(this.presetDraft);
      for (const key of ['xExpression', 'yExpression', 'parameterStart', 'parameterEnd']) this.fields.querySelector('[data-key="' + key + '"]').closest('label').hidden = this.options.mode === 'polar';
      for (const key of ['radiusExpression', 'angleStart', 'angleEnd']) this.fields.querySelector('[data-key="' + key + '"]').closest('label').hidden = this.options.mode !== 'polar';
      this.fields.querySelector('[data-key="rotationExpression"]').disabled = Boolean(this.options.tangentRotation);
      this.fields.querySelector('[data-key="tolerance"]').disabled = !this.splitSettings.simplify;
      this.invalidate();
    } catch (error) { this.error(error); }
  }

  apply() {
    try {
      const { session } = this.getContext();
      if (this.presetDraft) throw new Error(t('trajectory-panel.s07ec0df'));
      const event = createTrajectoryEvent(this.options, this.startTime, this.endTime, this.segments, this.splitSettings);
      const chart = trajectoryChart(session.chart, this.lineIndex, this.layerIndex, event, this.editing, this.replace);
      this.editing = event;
      session.focus = 'events'; session.eventLayer = this.layerIndex;
      session.selection.clear(); session.eventSelection = new Set();
      session.commit(t('trajectory-panel.s91be5d8'), chart);
      this.splitButton.hidden = false; this.applyButton.textContent = t('trajectory-panel.s2e1a917');
      this.refresh(); this.notify(t('trajectory-panel.sb6ac442'), 'success');
    } catch (error) { this.error(error); }
  }

  split() {
    try {
      const { session } = this.getContext();
      const chart = splitTrajectoryChart(session.chart, this.lineIndex, this.layerIndex, this.editing, { ...this.splitSettings, segments: this.segments });
      this.editing = null; session.eventSelection.clear(); session.multiEventSelection.clear(); session.commit(t('trajectory-panel.sd0b8713'), chart);
      this.activate('chart'); this.notify(t('trajectory-panel.sc69dba2'), 'success');
    } catch (error) { this.error(error); }
  }

  tick(timestamp, seconds, playing, renderer) {
    if (!this.active) return null;
    if (this.baseChart !== this.getContext().session.chart) {
      if (this.editing) {
        const selected = this.getContext().session.chart.judgeLineList.flatMap(line => (line.eventLayers ?? []).flatMap(layer => layer?.moveXEvents ?? [])).find(event => event.trajectory === this.editing.trajectory);
        if (selected) { this.editing = selected; this.startTime = selected.startTime; this.endTime = selected.endTime; for (const key of ['startTime', 'endTime']) this.fields.querySelector('[data-key="' + key + '"]').value = formatBeat(this[key]); }
        else { this.editing = null; this.splitButton.hidden = true; this.applyButton.textContent = t('trajectory-panel.sf248e5c'); }
      }
      this.refresh();
    }
    const progress = playing || !this.animate ? Math.max(0, Math.min(1, (seconds - this.beginSeconds) / (this.endSeconds - this.beginSeconds))) : timestamp / 2500 % 1;
    drawPath(this.canvas, this.points, progress);
    if (this.presetDraft) drawPath(this.presetDraft.canvas, this.presetDraft.points, progress);
    this.overlay.hidden = !this.enabled || !this.worldPoints || this.getContext().previewVisible;
    if (!this.overlay.hidden) {
      const { context, width, height } = prepareCanvas(this.overlay);
      const viewport = previewViewport(width, height, renderer.aspectRatio ?? 1.5); const scale = viewport.scale / (renderer.viewDivisor ?? 1);
      const ratio = renderer.aspectRatio ?? 1.5;
      if (this.displayWorldSource !== this.worldPoints || this.worldPointRatio !== ratio) {
        this.displayWorldSource = this.worldPoints; this.worldPointRatio = ratio;
        this.displayWorldPoints = this.worldPoints.map((point, index) => this.scene.sampler(this.beginSeconds + (this.endSeconds - this.beginSeconds) * index / (this.worldPoints.length - 1), previewPositionScale(ratio))(this.lineIndex));
      }
      context.save(); context.beginPath(); context.rect(viewport.left, viewport.top, viewport.width, viewport.height); context.clip();
      context.strokeStyle = '#62e6ba'; context.lineWidth = 2; context.globalAlpha = 0.8; context.beginPath();
      const screen = point => [width / 2 + point.x * scale, height / 2 - point.y * scale];
      this.displayWorldPoints.forEach((point, index) => index ? context.lineTo(...screen(point)) : context.moveTo(...screen(point))); context.stroke();
      const marker = this.displayWorldPoints[Math.min(this.displayWorldPoints.length - 1, Math.floor(progress * (this.displayWorldPoints.length - 1)))];
      context.fillStyle = '#9cffcc'; context.beginPath(); context.arc(...screen(marker), 6, 0, Math.PI * 2); context.fill();
      context.font = '13px RPE, sans-serif'; context.fillText(t('trajectory-panel.s4c18e91') + this.lineIndex, 18 + viewport.left, 24 + viewport.top); context.restore();
    }
    return this.enabled && this.previewChart ? { chart: this.previewChart, seconds: playing || !this.animate ? seconds : this.beginSeconds + (this.endSeconds - this.beginSeconds) * progress } : null;
  }
}
