import { formatBeat, fromNumber, parseBeat } from '../core/beat.mjs';
import { lineDisplayLabel } from '../core/line-groups.mjs';
import { noiseLayers } from '../core/noise-skin.mjs';
import { trackedNoiseArea, noiseTrackingChart } from '../core/noise-tracking.mjs';
import { beatInputControl } from './beat-input.mjs';
import { t } from '../i18n.mjs';

const button = (text, action) => { const node = document.createElement('button'); node.type = 'button'; node.textContent = text; node.onclick = action; return node; };

export class NoiseTrackingPanel {
  constructor(host, stage, getContext, { activate, invalidate, notify, pause }) {
    Object.assign(this, { host, stage, getContext, activate, invalidate, notify, pause });
    this.options = { mode: 'line', lineIndex: 0, start: '0:0/1', end: '4:0/1', width: 500, height: 100, active: true, invert: false, layerId: 'default', sampleRate: 120, show: true };
    this.sampler = document.createElement('div'); this.sampler.className = 'noise-tracking-sampler'; this.sampler.hidden = true;
    this.sampler.setAttribute('aria-label', t('noise-tracking.se636eb1')); stage.append(this.sampler);
    this.sampler.onclick = event => this.pick(event);
    stage.addEventListener('wheel', event => {
      if (!this.previewing) return;
      event.preventDefault(); event.stopPropagation(); this.wheel(event);
    }, { passive: false, capture: true });
    this.sampleBar = document.createElement('div'); this.sampleBar.className = 'noise-sample-bar noise-tracking-sample-bar'; this.sampleBar.hidden = true;
    this.sampleHint = document.createElement('p'); this.sampleHint.className = 'hint';
    this.sampleBar.append(this.sampleHint, button(t('noise-tracking.s2052a51'), () => this.endSample())); stage.append(this.sampleBar);
    window.addEventListener('keydown', event => {
      if (this.sampling && event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); this.endSample(); }
    }, true);
    this.render();
  }
  get context() { return this.getContext(); }
  get target() { return this.options.mode === 'note' ? this.noteTarget : { mode: 'line', lineIndex: Number(this.options.lineIndex) }; }
  get previewing() { return Boolean(this.active && (this.sampling || this.options.show && this.previewChart)); }
  open() {
    this.pause(); const { session, tempo, seconds } = this.context;
    if (!this.initialized || this.owner !== session) {
      const beat = tempo.beat(seconds()); this.options.start = formatBeat(fromNumber(beat)); this.options.end = formatBeat(fromNumber(beat + 4));
      this.options.lineIndex = session.lineIndex; this.previewSeconds = tempo.seconds(beat); this.initialized = true;
    }
    this.owner = session; this.active = true; this.baseChart = null; this.activate('noise-tracking'); this.render(); this.sync();
  }
  hide() { this.active = false; this.animating = false; this.endSample(); this.previewChart = null; this.stage.closest('.editor').classList.remove('noise-tracking-preview'); this.invalidate(); }
  reset() { this.hide(); this.owner = null; this.initialized = false; this.noteTarget = null; this.noteReference = null; this.appliedArea = null; }
  field(key, text, { choices, checkbox = false, beat = false, min, max } = {}) {
    const label = document.createElement('label'); label.className = 'field'; label.append(text);
    const control = document.createElement(choices ? 'select' : 'input'); control.dataset.key = key; control.setAttribute('aria-label', text);
    if (choices) control.replaceChildren(...choices.map(([value, name]) => new Option(name, value)));
    else { control.type = checkbox ? 'checkbox' : beat ? 'text' : 'number'; if (!checkbox && !beat) { control.step = 'any'; if (min !== undefined) control.min = min; if (max !== undefined) control.max = max; } }
    if (checkbox) control.checked = this.options[key]; else control.value = this.options[key];
    const update = () => {
      this.options[key] = checkbox ? control.checked : beat || choices ? control.value : control.value.trim() ? Number(control.value) : NaN;
      if (key !== 'show') this.appliedArea = null;
      if (key === 'mode') { this.endSample(); this.updateVisibility(); }
      if (key === 'show') { this.updateChrome(); this.invalidate(); } else this.rebuild();
    };
    control.oninput = update;
    if (beat) {
      label.append(beatInputControl(control, () => this.context.timeline.division, error => this.fail(error.message)));
      control.addEventListener('change', () => { try { control.value = formatBeat(parseBeat(control.value)); control.removeAttribute('aria-invalid'); update(); } catch (error) { control.setAttribute('aria-invalid', 'true'); this.fail(error.message); } });
    } else label.append(control);
    this.scroll.append(label); this.controls.set(key, control); return control;
  }
  render() {
    this.host.replaceChildren(); this.controls = new Map(); this.scroll = document.createElement('div'); this.scroll.className = 'noise-tracking-scroll'; this.host.append(this.scroll);
    const title = document.createElement('div'); title.className = 'panel-title'; title.textContent = t('noise-tracking.sd5825e9'); this.scroll.append(title);
    this.field('mode', t('noise-tracking.s88b3073'), { choices: [['line', t('transport.line')], ['note', t('noise-tracking.s7ac3289')]] });
    this.field('lineIndex', t('transport.line'), { choices: this.context.session.chart.judgeLineList.map((line, index) => [index, lineDisplayLabel(this.context.session.chart, index)]) });
    this.targetLabel = document.createElement('p'); this.targetLabel.className = 'hint noise-tracking-target'; this.scroll.append(this.targetLabel);
    this.sampleButton = button(t('noise-tracking.s162755d'), () => this.beginSample()); this.sampleButton.className = 'wide-button'; this.scroll.append(this.sampleButton);
    this.field('start', t('noise-tracking.s087c451'), { beat: true }); this.field('end', t('noise-tracking.sc4d3fa4'), { beat: true });
    this.field('width', t('noise-tracking.s86ec1ca'), { min: 0.001, max: 100000 }); this.field('height', t('noise-tracking.seea51aa'), { min: 0.001, max: 100000 });
    this.field('layerId', t('noise-tracking.s660dfdf'), { choices: noiseLayers(this.context.session.chart).map(layer => [layer.id, layer.name]) });
    this.field('invert', t('noise-tracking.s5ec676c'), { checkbox: true }); this.field('active', t('noise-tracking.sced2eff'), { checkbox: true });
    this.field('sampleRate', t('noise-tracking.s423c4be'), { choices: [[60, t('noise-tracking.s40508e8')], [120, t('noise-tracking.s8f71922')], [240, t('noise-tracking.s71a42f5')]] });
    this.field('show', t('noise-tracking.sf43e6d2'), { checkbox: true });
    const playback = document.createElement('div'); playback.className = 'noise-tracking-playback';
    this.playButton = button(t('noise-tracking.see93fc2'), () => { this.animating = !this.animating; this.animationEpoch = null; this.playButton.textContent = this.animating ? t('noise-tracking.s41852e3') : t('noise-tracking.see93fc2'); this.invalidate(); });
    this.progress = document.createElement('input'); this.progress.type = 'range'; this.progress.min = 0; this.progress.max = 1; this.progress.step = 0.001; this.progress.value = 0; this.progress.setAttribute('aria-label', t('noise-tracking.sbf11602'));
    this.progress.oninput = () => { this.animating = false; this.playButton.textContent = t('noise-tracking.see93fc2'); if (this.range) this.previewSeconds = this.range.start + Number(this.progress.value) * (this.range.end - this.range.start); this.invalidate(); };
    this.previewTime = document.createElement('output'); playback.append(this.playButton, this.progress, this.previewTime); this.scroll.append(playback);
    const help = document.createElement('p'); help.className = 'hint'; help.textContent = t('noise-tracking.s850ffe3'); this.scroll.append(help);
    const footer = document.createElement('div'); footer.className = 'noise-tracking-footer'; this.message = document.createElement('p'); this.message.className = 'hint'; this.message.setAttribute('role', 'status');
    this.generate = button(t('noise-tracking.s6cbec60'), () => this.apply()); this.generate.className = 'primary'; this.generate.disabled = true;
    footer.append(this.message, button(t('noise-tracking.sb3669b2'), () => this.activate('chart')), this.generate); this.host.append(footer); this.updateVisibility();
  }
  updateVisibility() {
    this.controls.get('lineIndex').closest('.field').hidden = this.options.mode !== 'line';
    this.targetLabel.textContent = this.options.mode === 'line' ? t('noise-tracking.s6d81bbc') : this.noteTarget ? t('noise-tracking.s8dfdc65', { p0: lineDisplayLabel(this.context.session.chart, this.noteTarget.lineIndex), p1: this.noteTarget.noteIndex }) : t('noise-tracking.sbafe94d');
  }
  fail(message) { this.area = null; this.previewChart = null; this.generate.disabled = true; this.message.textContent = message; this.message.classList.add('error'); this.updateChrome(); this.invalidate(); }
  rebuild() {
    if (!this.active) return;
    const { session, tempo } = this.context; this.baseChart = session.chart; this.baseTempo = tempo;
    try {
      const start = parseBeat(this.options.start); const end = parseBeat(this.options.end);
      this.range = { start: tempo.seconds(start), end: tempo.seconds(end) };
      this.area = trackedNoiseArea(session.chart, tempo, { ...this.options, start, end, target: this.target, sampleRate: Number(this.options.sampleRate) });
      this.previewChart = this.appliedArea && session.chart.blockAreaList?.includes(this.appliedArea) ? session.chart : noiseTrackingChart(session.chart, this.area);
      this.previewSeconds = Math.max(this.range.start, Math.min(this.range.end - 1e-7, this.previewSeconds ?? this.range.start));
      this.generate.disabled = false; this.message.classList.remove('error');
      this.message.textContent = t('noise-tracking.s8e38f09', { p0: this.area.moveXEvents.length });
    } catch (error) { this.fail(error.message); return; }
    this.updateChrome(); this.invalidate();
  }
  sync() {
    if (!this.active) return;
    if (this.owner !== this.context.session) { this.reset(); return; }
    if (this.baseChart !== this.context.session.chart || this.baseTempo !== this.context.tempo) {
      if (this.noteTarget) {
        const lines = this.context.session.chart.judgeLineList;
        const lineIndex = lines.findIndex(line => line.notes?.includes(this.noteReference));
        if (lineIndex < 0) { this.noteTarget = null; this.noteReference = null; }
        else this.noteTarget = { mode: 'note', lineIndex, noteIndex: lines[lineIndex].notes.indexOf(this.noteReference) };
      }
      const select = this.controls.get('lineIndex'); const value = this.options.lineIndex;
      select.replaceChildren(...this.context.session.chart.judgeLineList.map((line, index) => new Option(lineDisplayLabel(this.context.session.chart, index), index))); select.value = value;
      const layer = this.controls.get('layerId'); layer.replaceChildren(...noiseLayers(this.context.session.chart).map(entry => new Option(entry.name, entry.id))); layer.value = this.options.layerId;
      this.updateVisibility(); this.rebuild();
    }
  }
  updateChrome() {
    const show = Boolean(this.active && (this.sampling || this.options.show && this.previewChart));
    this.stage.closest('.editor').classList.toggle('noise-tracking-preview', show);
    this.sampler.hidden = !this.sampling; this.sampleBar.hidden = !this.sampling;
    if (this.generate) this.generate.disabled = Boolean(this.sampling || !this.area);
  }
  beginSample() {
    this.pause(); this.animating = false; this.playButton.textContent = t('noise-tracking.see93fc2'); this.sampling = true;
    this.sampleHint.textContent = this.options.mode === 'line' ? t('noise-tracking.s48e533a') : t('noise-tracking.s7c9fc73');
    this.updateChrome(); this.invalidate();
  }
  endSample() { this.sampling = false; this.updateChrome(); this.invalidate(); }
  wheel(event) {
    this.animating = false; this.animationEpoch = null; this.playButton.textContent = t('noise-tracking.see93fc2');
    this.context.wheel(event);
    this.previewSeconds = this.context.seconds(); this.invalidate();
  }
  pick(event) {
    if (!this.sampling) return; event.preventDefault(); event.stopPropagation();
    const renderer = this.context.previewVisible ? this.context.preview : this.context.realtimePreview;
    const visible = renderer.visible; const enabled = renderer.pickPreviewLines; renderer.visible = true; renderer.pickPreviewLines = true;
    try {
      if (this.options.mode === 'line') {
        const index = renderer.pick(event.clientX, event.clientY); if (!Number.isInteger(index)) return;
        this.options.lineIndex = index; this.controls.get('lineIndex').value = index;
      } else {
        const target = renderer.pickNoteTarget(event.clientX, event.clientY); if (!target) return;
        this.noteTarget = { mode: 'note', ...target }; this.noteReference = this.context.session.chart.judgeLineList[target.lineIndex].notes[target.noteIndex];
      }
      this.appliedArea = null; this.endSample(); this.updateVisibility(); this.rebuild();
    } finally { renderer.visible = visible; renderer.pickPreviewLines = enabled; }
  }
  tick(timestamp, seconds, playing) {
    if (!this.active) return null; this.sync();
    if (this.sampling) return { chart: this.context.session.chart, seconds, sampling: true, forceLineOpacity: this.options.mode === 'line' };
    if (!this.options.show || !this.previewChart || !this.range) return null;
    if (playing) this.previewSeconds = Math.max(this.range.start, Math.min(this.range.end - 1e-7, seconds));
    else if (this.animating) {
      this.animationEpoch ??= timestamp;
      this.previewSeconds = this.range.start + ((timestamp - this.animationEpoch) / 1000 % (this.range.end - this.range.start));
    }
    this.progress.value = Math.max(0, Math.min(1, (this.previewSeconds - this.range.start) / (this.range.end - this.range.start)));
    this.previewTime.textContent = formatBeat(fromNumber(this.context.tempo.beat(this.previewSeconds))) + t('noise-tracking.s8e6821f');
    return { chart: this.previewChart, seconds: this.previewSeconds };
  }
  action(action) {
    if (!this.active) return false;
    if (action === 'Esc') { if (this.sampling) this.endSample(); else this.activate('chart'); return true; }
    return ['SelectAll', 'Copy', 'Shear', 'Paste', 'PasteMirror', 'KeepTimePaste', 'KeepTimePasteMirror', 'ClipboardHistory', 'NumberMirror', 'NumberFill', 'Delete', 'QuickDelete', 'CurveBegin', 'CurveEnd', 'AddTap', 'AddDrag', 'AddFlick', 'AddHold', 'AddEvent'].includes(action) || Boolean(action?.startsWith('Page'));
  }
  apply() {
    try {
      this.sync(); if (!this.area || this.sampling) throw new Error(t('noise-tracking.sae2c1bf'));
      const { session } = this.context; const area = this.area; this.appliedArea = area;
      session.commit(t('noise-tracking.sd5825e9'), noiseTrackingChart(session.chart, area));
      this.rebuild(); this.message.textContent = t('noise-tracking.s1269edf'); this.notify(t('noise-tracking.s04a0ee3'), 'success');
    } catch (error) { this.fail(error.message); this.notify(error.message, 'error'); }
  }
}
