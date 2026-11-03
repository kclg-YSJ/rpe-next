import { AudioPitch } from '../application/audio-pitch.mjs';
import { pitchName, pitchFrequency, pitchWaveform } from '../core/audio-pitch.mjs';
import { WaveformEnvelope } from '../core/waveform.mjs';
import { normalizePitchDisplay, pitchDisplayRange, pitchFrameVisible, pitchDisplayOpacity } from '../core/audio-pitch-display.mjs';
import { localPreferences } from '../platform/local-preferences.mjs';
import { editorSkinContext, editorCanvasRevision } from './editor-skin-canvas.mjs';
import { t } from '../i18n.mjs';
const node = (tag, text = '', name = '') => { const value = document.createElement(tag); value.textContent = text; value.className = name; return value; };

export class AudioPitchView {
  constructor(analysis, invalidate) {
    this.analysis = analysis; this.sources = analysis.sources; this.invalidate = invalidate;
    this.engine = new AudioPitch(this.sources); this.id = ''; this.original = this.sources.original;
    let saved; try { saved = JSON.parse(localPreferences.getItem('rpen-audio-pitch-view-v1') ?? '{}'); } catch {}
    Object.assign(this, normalizePitchDisplay(saved));
    this.engine.addEventListener('change', () => { this.prepareEnvelope(); this.lastFrame = null; this.status(); this.invalidate(); });
    this.sources.addEventListener('change', () => {
      if (!this.id) { this.options(); return; }
      if (this.sources.original !== this.original || !this.sources.entries.has(this.id) || this.engine.entry && !this.sources.isCurrent(this.engine.entry)) this.choose('');
      this.options();
    });
    globalThis.rpenAudioStorage?.onProgress?.(value => { if (value.stage === 'cleared') this.choose(''); });
  }
  get active() { return Boolean(this.id && this.analysis.enabled); }
  showHover(event, target) {
    if (this.position !== 'inline' || !this.geometry || !this.engine.track || !this.canvas || this.canvas.hidden) return;
    const r = this.canvas.getBoundingClientRect(), g = this.geometry;
    if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) { target.title = this.hoverTitle ?? ''; return; }
    const seconds = g.origin + (g.judgement - (event.clientY - r.top)) / g.scale + g.offset, track = this.engine.track, index = Math.round(seconds * track.frameRate), pitch = track.pitches[index];
    const { low, high } = pitchDisplayRange(track, this);
    target.title = pitchFrameVisible(track, index, this.threshold, low, high) ? `${pitchName(pitch)} · ${pitchFrequency(pitch).toFixed(1)} Hz · ${t('pitch.beat', { beat: this.analysis.getTimeline().tempo.beat(seconds - g.offset, g.factor).toFixed(3) })}` : t('pitch.noPitch');
  }
  syncHover() {
    const timeline = this.analysis.getTimeline(), canvas = this.active && this.position === 'inline' ? timeline.notesCanvas : null;
    if (canvas === this.hoverCanvas) return;
    if (this.hoverCanvas) {
      this.hoverCanvas.removeEventListener('pointermove', this.hoverMove); this.hoverCanvas.removeEventListener('pointerleave', this.hoverLeave); this.hoverCanvas.title = this.hoverTitle;
    }
    this.hoverCanvas = canvas;
    if (!canvas) return;
    this.hoverTitle = canvas.title ?? ''; this.hoverMove = event => this.showHover(event, canvas); this.hoverLeave = () => { canvas.title = this.hoverTitle; };
    canvas.addEventListener('pointermove', this.hoverMove); canvas.addEventListener('pointerleave', this.hoverLeave);
  }
  async prepareEnvelope() {
    if (!this.followWaveform) return;
    const entry = this.engine.entry; if (!entry || this.envelope || this.envelopePending === entry) return;
    this.envelopeController?.abort(); const controller = this.envelopeController = new AbortController(); this.envelopePending = entry;
    try {
      if (!entry.buffer) await this.sources.resolve(entry.id, controller.signal);
      if (controller.signal.aborted || this.engine.entry !== entry) return;
      this.envelopeBuffer = entry.buffer;
      const data = this.analysis.analysisCache.get(entry.buffer) ?? await pitchWaveform(entry.buffer, controller.signal);
      if (controller.signal.aborted || this.engine.entry !== entry) return;
      this.envelopeData = data; this.envelope = new WaveformEnvelope(data.waveform); this.lastFrame = null; this.invalidate();
    } catch (error) { if (error.name !== 'AbortError') { this.engine.warning = 'cache'; this.status(); } }
    finally { if (this.envelopeController === controller) this.envelopePending = null; }
  }
  save() { localPreferences.setItem('rpen-audio-pitch-view-v1', JSON.stringify(normalizePitchDisplay(this))); }
  updateDisplay() { this.save(); this.lastFrame = null; for (const sync of this.displayControls?.values() ?? []) sync(); this.syncRangeInputs(); this.invalidate(); }
  resetDisplay() {
    Object.assign(this, normalizePitchDisplay({ position: this.position }));
    this.envelopeController?.abort(); this.envelopePending = null; this.envelope = this.envelopeData = this.envelopeBuffer = null;
    this.updateDisplay();
  }
  syncRangeInputs() {
    if (!this.rangeLow) return;
    const { low, high } = pitchDisplayRange(this.engine.track, this);
    this.autoRange.checked = this.low === null;
    this.rangeLow.max = Math.ceil(high) - 1; this.rangeHigh.min = Math.floor(low) + 1;
    this.rangeLow.value = Math.round(low); this.rangeHigh.value = Math.round(high);
    for (const [input, value] of [[this.rangeLow, low], [this.rangeHigh, high]]) {
      const text = `${pitchName(value)} · ${pitchFrequency(value).toFixed(0)} Hz`;
      input.nextElementSibling.textContent = text; input.setAttribute('aria-valuetext', text);
    }
  }
  options() {
    if (!this.sourceInput) return;
    const entries = this.sources.list();
    this.sourceInput.replaceChildren(new Option(t('pitch.off'), ''), ...entries.filter(entry => entry.kind !== 'original').map(entry => new Option(entry.name, entry.id)));
    this.sourceInput.value = this.id;
  }
  render(host) {
    this.host = host; host.replaceChildren(); host.append(node('h3', t('pitch.title'), 'audio-analysis-heading'));
    const field = (label, input) => { const row = node('label', label, 'field'); row.append(input); host.append(row); return input; };
    this.sourceInput = field(t('pitch.source'), node('select')); this.sourceInput.id = 'audio-pitch-source'; this.sourceInput.setAttribute('aria-label', t('pitch.source')); this.options();
    this.sourceInput.onchange = () => this.choose(this.sourceInput.value);
    this.positionInput = field(t('pitch.position'), node('select')); this.positionInput.id = 'audio-pitch-position';
    this.positionInput.replaceChildren(new Option(t('pitch.inline'), 'inline'), new Option(t('pitch.events'), 'events')); this.positionInput.value = this.position;
    this.positionInput.onchange = () => { this.position = this.positionInput.value; this.save(); this.lastFrame = null; this.syncState(); this.invalidate(); };
    const details = node('details', '', 'audio-pitch-options'); details.append(node('summary', t('pitch.displayOptions'))); host.append(details); this.displayControls = new Map();
    const checkbox = (key, label, changed = () => {}) => {
      const row = node('label', t(label), 'field'), input = node('input'); input.type = 'checkbox'; input.id = 'audio-pitch-' + key; input.checked = this[key]; input.setAttribute('aria-label', t(label));
      this.displayControls.set(key, () => { input.checked = this[key]; });
      input.oninput = () => { this[key] = input.checked; changed(); this.updateDisplay(); }; row.append(input); details.append(row); return input;
    };
    checkbox('followWaveform', 'pitch.followWaveform', () => {
      if (this.followWaveform) this.prepareEnvelope();
      else { this.envelopeController?.abort(); this.envelopePending = null; this.envelope = this.envelopeData = this.envelopeBuffer = null; }
    });
    const slider = (key, label, min, max, step, format) => {
      const row = node('label', t(label), 'field audio-pitch-slider'), box = node('span', '', 'audio-pitch-slider-control'), input = node('input'), output = node('output');
      input.type = 'range'; input.id = 'audio-pitch-' + key; input.min = min; input.max = max; input.step = step; input.value = this[key]; input.setAttribute('aria-label', t(label));
      const sync = () => { input.value = this[key]; output.textContent = format(this[key]); input.setAttribute('aria-valuetext', output.textContent); }; sync(); this.displayControls.set(key, sync);
      input.oninput = () => { this[key] = Number(input.value); sync(); this.updateDisplay(); }; box.append(input, output); row.append(box); details.append(row); return input;
    };
    slider('threshold', 'pitch.threshold', .05, 1, .01, value => `${Math.round(value * 100)}%`);
    details.append(node('p', t('pitch.thresholdHint'), 'hint'));
    slider('opacity', 'pitch.opacity', .05, 1, .01, value => `${Math.round(value * 100)}%`);
    slider('lineWidth', 'pitch.lineWidth', 1, 10, .5, value => `${value} px`);
    checkbox('showGrid', 'pitch.showGrid');
    const rangeHeading = node('h4', t('pitch.range')); details.append(rangeHeading);
    this.autoRange = node('input'); this.autoRange.type = 'checkbox'; this.autoRange.id = 'audio-pitch-auto-range'; this.autoRange.setAttribute('aria-label', t('pitch.auto'));
    const auto = node('label', t('pitch.auto'), 'field'); auto.append(this.autoRange); details.append(auto);
    this.autoRange.oninput = () => { const range = pitchDisplayRange(this.engine.track, this); this.low = this.autoRange.checked ? null : Math.round(range.low); this.high = this.autoRange.checked ? null : Math.round(range.high); this.updateDisplay(); };
    this.rangeLow = this.rangeHigh = null;
    for (const [key, label] of [['low', 'pitch.low'], ['high', 'pitch.high']]) {
      const row = node('label', t(label), 'field audio-pitch-slider'), box = node('span', '', 'audio-pitch-slider-control'), input = node('input');
      input.type = 'range'; input.id = 'audio-pitch-' + key; input.min = '18'; input.max = '111'; input.step = '1'; input.setAttribute('aria-label', t(label));
      input.oninput = () => { const range = pitchDisplayRange(this.engine.track, this); this.low = Math.round(key === 'low' ? Number(input.value) : range.low); this.high = Math.round(key === 'high' ? Number(input.value) : range.high); this.updateDisplay(); };
      box.append(input, node('output')); row.append(box); details.append(row); this[key === 'low' ? 'rangeLow' : 'rangeHigh'] = input;
    }
    details.append(node('p', t('pitch.rangeHint'), 'hint')); this.syncRangeInputs();
    const resetActions = node('div', '', 'audio-source-actions'), reset = node('button', t('pitch.reset'));
    reset.id = 'audio-pitch-reset'; reset.type = 'button'; reset.title = t('pitch.resetHint'); reset.onclick = () => this.resetDisplay(); resetActions.append(reset); details.append(resetActions);
    const controls = node('div', '', 'audio-source-actions'); this.cancelButton = node('button', t('pitch.cancel')); this.cancelButton.type = 'button'; this.cancelButton.onclick = () => { this.engine.stop(); this.engine.stage = 'cancelled'; this.engine.changed(); };
    this.retryButton = node('button', t('pitch.retry')); this.retryButton.type = 'button'; this.retryButton.onclick = () => this.choose(this.id); controls.append(this.cancelButton, this.retryButton); host.append(controls);
    this.progress = node('progress'); this.progress.max = 1; this.statusText = node('p', '', 'hint audio-pitch-status'); this.statusText.setAttribute('role', 'status'); host.append(this.progress, this.statusText, node('p', t('pitch.hint'), 'hint')); this.status();
  }
  status() {
    if (!this.statusText) return;
    this.syncRangeInputs();
    const engine = this.engine;
    this.cancelButton.hidden = !engine.busy; this.retryButton.hidden = !this.id || engine.busy || engine.track?.complete;
    this.progress.hidden = !engine.busy; this.progress.value = engine.progress;
    this.statusText.textContent = !this.id ? t('pitch.offHint') : engine.error ? t('pitch.error', { reason: engine.error === 'pitch-duration' ? t('pitch.duration') : engine.error })
      : engine.busy ? t('pitch.' + engine.stage, { percent: Math.round(engine.progress * 100) }) : engine.stage === 'cancelled' ? t('pitch.cancelled') : engine.warning ? t('pitch.cacheWarning') : t('pitch.ready');
  }
  async choose(id) {
    this.envelopeController?.abort(); this.envelopePending = null; this.envelopeBuffer = null;
    this.id = id; this.original = this.sources.original; this.envelope = null; this.envelopeData = null; this.lastFrame = null;
    if (!id) this.engine.clear();
    else { this.analysis.enabled = true; if (this.analysis.enabledInput) this.analysis.enabledInput.checked = true; this.analysis.onChange(); this.engine.start(id, this.analysis.getAudio().time); }
    if (!id && this.canvas) { this.canvas.width = this.canvas.height = 1; }
    this.options(); this.status(); this.syncState(); this.invalidate();
  }
  ensureCanvas() {
    if (this.canvas) return;
    this.canvas = node('canvas', '', 'audio-pitch-canvas'); this.canvas.id = 'audio-pitch-overlay';
    this.canvas.dataset.skinCanvas = 'audio';
    this.canvas.setAttribute('aria-label', t('pitch.title')); this.canvas.hidden = true;
    const stage = this.analysis.canvas.parentElement; stage.insertBefore(this.canvas, stage.querySelector('.canvases'));
  }
  syncState() {
    if (!this.analysis.enabled && this.engine.busy) { this.engine.stop(); this.engine.stage = 'cancelled'; this.status(); }
    this.syncHover();
    if (this.canvas && !this.active) this.canvas.hidden = true;
  }
  draw(offsetSeconds) {
    const timeline = this.analysis.getTimeline(), inEvents = this.position === 'events'; this.syncState();
    if (!this.active || !this.analysis.enabled) { if (this.canvas) this.canvas.hidden = true; return; }
    this.ensureCanvas();
    const stage = this.analysis.canvas.parentElement, stageRect = stage.getBoundingClientRect(), notes = timeline.notesCanvas.getBoundingClientRect(), events = timeline.eventsCanvas.getBoundingClientRect();
    const editor = stage.closest('.editor');
    if (inEvents && (timeline.notesOnly || timeline.noteView) || editor?.matches('.noise-mode,.global-events-mode,.event-sampling,.noise-fit-mode,.noise-tracking-preview') || stage.querySelector('.preview-wrap:not([hidden])')) { this.canvas.hidden = true; return; }
    const rect = inEvents ? events : notes;
    if (rect.width < 1 || rect.height < 1) { this.canvas.hidden = true; return; }
    const ids = this.analysis.layers.map(layer => layer.id), laneCount = timeline.getSession().multiLineActive ? 1 : Math.max(1, ids.includes(this.id) ? ids.length : ids.length + 1), laneIndex = Math.max(0, ids.indexOf(this.id) < 0 ? laneCount - 1 : ids.indexOf(this.id));
    const width = inEvents ? rect.width : rect.width * this.analysis.width / laneCount;
    const left = rect.left - stageRect.left + (inEvents ? 0 : rect.width * (1 - this.analysis.width) / 2 + laneIndex * width), top = rect.top - stageRect.top;
    const track = this.engine.track, { low, high } = pitchDisplayRange(track, this), ratio = devicePixelRatio || 1;
    const frame = [left, top, width, rect.height, timeline.origin, timeline.scale, timeline.factor, timeline.tempo, offsetSeconds, timeline.judgementOffset, this.position, low, high, ratio, editorCanvasRevision(), track, track?.revision, this.engine.stage, this.engine.busy, this.envelope, this.threshold, this.opacity, this.lineWidth, this.followWaveform, this.showGrid];
    this.canvas.hidden = false;
    if (this.lastFrame && frame.every((value, i) => value === this.lastFrame[i])) return; this.lastFrame = frame;
    Object.assign(this.canvas.style, { left: left + 'px', top: top + 'px', width: width + 'px', height: rect.height + 'px' });
    const pixelWidth = Math.max(1, Math.round(width * ratio)), pixelHeight = Math.max(1, Math.round(rect.height * ratio));
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) { this.canvas.width = pixelWidth; this.canvas.height = pixelHeight; }
    const ctx = editorSkinContext(this.canvas.getContext('2d')); ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, width, rect.height);
    const margin = width > 160 ? 24 : 8, span = Math.max(1, width - margin * 2), xAt = pitch => margin + (pitch - low) / (high - low) * span;
    ctx.save(); ctx.beginPath(); ctx.rect(0, 22, width, rect.height - 22); ctx.clip();
    const origin = timeline.tempo.seconds(timeline.origin, timeline.factor), judgement = timeline.viewHeight() - timeline.judgementOffset;
    this.geometry = { origin, judgement, scale: timeline.scale, offset: offsetSeconds, factor: timeline.factor };
    ctx.globalAlpha = .35; ctx.strokeStyle = '#aaaaaa'; ctx.lineWidth = .5;
    if (this.showGrid) for (let note = Math.ceil(low / 12) * 12; note <= high; note += 12) { ctx.beginPath(); ctx.moveTo(xAt(note), 0); ctx.lineTo(xAt(note), rect.height); ctx.stroke(); }
    ctx.globalAlpha = 1;
    const source = this.engine.entry;
    if (track && source && (!this.followWaveform || this.envelope)) {
      const data = this.envelopeData;
      const first = Math.max(0, Math.floor((origin + (judgement - rect.height) / timeline.scale + offsetSeconds) * track.frameRate)), last = Math.min(track.pitches.length - 1, Math.ceil((origin + judgement / timeline.scale + offsetSeconds) * track.frameRate));
      const samplesPerSecond = this.followWaveform ? data.waveform.length / data.duration : 0; let previous = null;
      const lineWidth = this.lineWidth;
      ctx.strokeStyle = ctx.fillStyle = source.color ?? '#63e6ad'; ctx.lineWidth = lineWidth; ctx.lineCap = 'round';
      for (let i = first; i <= last; i++) {
        const pitch = track.pitches[i]; if (!pitchFrameVisible(track, i, this.threshold, low, high)) { previous = null; continue; }
        const seconds = i / track.frameRate, py = judgement - (seconds - offsetSeconds - origin) * timeline.scale, px = xAt(pitch);
        const rowSeconds = Math.max(1 / timeline.scale, 1 / track.frameRate), amplitude = this.followWaveform ? this.envelope.peak((seconds - rowSeconds / 2) * samplesPerSecond, (seconds + rowSeconds / 2) * samplesPerSecond) : 1;
        ctx.globalAlpha = pitchDisplayOpacity(this, amplitude);
        if (previous && Math.abs(pitch - previous.pitch) < 1.5) { ctx.beginPath(); ctx.moveTo(previous.x, previous.y); ctx.lineTo(px, py); ctx.stroke(); }
        else ctx.fillRect(px - lineWidth / 2, py - 1, lineWidth, Math.max(2, timeline.scale / track.frameRate));
        previous = { x: px, y: py, pitch };
      }
    }
    ctx.restore(); ctx.globalAlpha = .8; ctx.fillStyle = '#dddddd'; ctx.font = '11px RPE, sans-serif';
    const labelStep = width < 180 ? 24 : 12;
    if (this.showGrid) for (let note = Math.ceil(low / labelStep) * labelStep; note <= high; note += labelStep) ctx.fillText(pitchName(note), Math.max(1, Math.min(width - 22, xAt(note) - 8)), inEvents ? 37 : 15);
    if (!track || !track.revision && !track.complete) { ctx.fillStyle = '#dddddd'; ctx.font = '12px RPE, sans-serif'; ctx.fillText(t(this.engine.error ? 'pitch.failedShort' : 'pitch.loading'), 8, 46); }
  }
}
