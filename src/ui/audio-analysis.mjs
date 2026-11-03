import { editorSkinContext, editorCanvasRevision, editorCanvasOpacity } from './editor-skin-canvas.mjs';
import { AudioSourcesPanel } from './audio-sources.mjs';
import { WaveformEnvelope } from '../core/waveform.mjs';
import { t } from '../i18n.mjs';
import { AudioPitchView } from './audio-pitch.mjs';

const clamp = (value, minimum = 0, maximum = 1) => Math.max(minimum, Math.min(maximum, value));

function channelSamples(buffer) {
  if (!buffer || typeof buffer.getChannelData !== 'function' || !buffer.length) return null;
  const channels = Math.max(1, Number(buffer.numberOfChannels) || 1);
  const length = Number(buffer.length) || 0;
  const output = new Float32Array(length);
  for (let channel = 0; channel < channels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < length; index++) output[index] += (data[index] ?? 0) / channels;
  }
  return output;
}

export function analyseAudioBuffer(buffer, options = {}) {
  const samples = channelSamples(buffer);
  if (!samples) return null;
  const waveformSize = Math.max(256, Math.min(65536, Number(options.waveformSize) || 32768));
  const waveform = new Float32Array(waveformSize);
  let peakMaximum = 0;
  for (let index = 0; index < waveform.length; index++) {
    const start = Math.floor(index * samples.length / waveform.length);
    const end = Math.max(start + 1, Math.floor((index + 1) * samples.length / waveform.length));
    let peak = 0;
    for (let cursor = start; cursor < end && cursor < samples.length; cursor++) peak = Math.max(peak, Math.abs(samples[cursor]));
    waveform[index] = peak;
    peakMaximum = Math.max(peakMaximum, peak);
  }
  if (peakMaximum > 0) for (let index = 0; index < waveform.length; index++) waveform[index] = Math.min(1, Math.pow(waveform[index] / peakMaximum, 1.35));
  const bands = Math.max(16, Math.min(128, Number(options.bands) || 64));
  const frameCount = Math.max(256, Math.min(8192, Number(options.spectrumFrames) || 2048));
  const spectrum = new Float32Array(frameCount * bands);
  const frameSize = 1024;
  const real = new Float64Array(frameSize); const imaginary = new Float64Array(frameSize); const reverse = new Uint16Array(frameSize);
  const rawSpectrum = new Float32Array(frameCount * bands);
  const bandPeaks = new Float32Array(bands);
  for (let index = 1, reversed = 0; index < frameSize; index++) {
    let bit = frameSize >> 1;
    for (; reversed & bit; bit >>= 1) reversed ^= bit;
    reversed ^= bit; reverse[index] = reversed;
  }
  for (let frame = 0; frame < frameCount; frame++) {
    const center = Math.floor((frame + 0.5) * samples.length / frameCount);
    const start = center - frameSize / 2;
    for (let index = 0; index < frameSize; index++) {
      const value = samples[Math.max(0, Math.min(samples.length - 1, start + index))] ?? 0;
      const window = 0.5 - 0.5 * Math.cos(Math.PI * 2 * index / (frameSize - 1));
      real[index] = value * window; imaginary[index] = 0;
    }
    for (let index = 1; index < frameSize; index++) if (index < reverse[index]) {
      [real[index], real[reverse[index]]] = [real[reverse[index]], real[index]];
      [imaginary[index], imaginary[reverse[index]]] = [imaginary[reverse[index]], imaginary[index]];
    }
    for (let size = 2; size <= frameSize; size <<= 1) {
      const half = size >> 1; const angle = -Math.PI * 2 / size;
      for (let startIndex = 0; startIndex < frameSize; startIndex += size) for (let offset = 0; offset < half; offset++) {
        const cosine = Math.cos(angle * offset); const sine = Math.sin(angle * offset);
        const target = startIndex + offset; const paired = target + half;
        const pairedReal = real[paired] * cosine - imaginary[paired] * sine;
        const pairedImaginary = real[paired] * sine + imaginary[paired] * cosine;
        real[paired] = real[target] - pairedReal; imaginary[paired] = imaginary[target] - pairedImaginary;
        real[target] += pairedReal; imaginary[target] += pairedImaginary;
      }
    }
    for (let band = 0; band < bands; band++) {
      const low = Math.max(1, Math.floor(Math.pow(band / bands, 2.2) * (frameSize / 2 - 1)));
      const high = Math.max(low + 1, Math.min(frameSize / 2, Math.ceil(Math.pow((band + 1) / bands, 2.2) * (frameSize / 2 - 1) + 1)));
      let energy = 0;
      let count = 0;
      for (let bin = low; bin < high; bin++) {
        const magnitude = Math.hypot(real[bin], imaginary[bin]) / (frameSize * 0.5);
        energy += magnitude * magnitude;
        count++;
      }
      const value = count ? Math.sqrt(energy / count) : 0;
      rawSpectrum[frame * bands + band] = value;
      bandPeaks[band] = Math.max(bandPeaks[band], value);
    }
  }
  for (let frame = 0; frame < frameCount; frame++) for (let band = 0; band < bands; band++) {
    const value = rawSpectrum[frame * bands + band];
    const peak = bandPeaks[band];
    if (peak <= 0) continue;
    const floor = peak * 0.025;
    const normalized = clamp((value - floor) / Math.max(peak - floor, Number.EPSILON));
    rawSpectrum[frame * bands + band] = Math.pow(normalized, 0.48);
  }
  spectrum.set(rawSpectrum);
  return { duration: Number(buffer.duration) || 0, waveform, spectrum, bands, frameCount };
}

export class AudioAnalysis {
  constructor(canvas, getTimeline, getAudio, onChange = () => {}) {
    this.canvas = canvas;
    this.getTimeline = getTimeline;
    this.getAudio = getAudio;
    this.onChange = onChange;
    this.mode = 'waveform';
    this.enabled = false;
    this.alpha = 0.2;
    this.width = 0.62;
    this.data = null;
    this.layers = []; this.analysisCache = new WeakMap(); this.waveformCache = new WeakMap();
  }

  setBuffer(buffer) { if (this.sources) { this.sources.reset(buffer); return; } this.data = analyseAudioBuffer(buffer); this.layers = this.data ? [{ data: this.data, color: '#5db9d4', id: 'original', buffer }] : []; this.draw(); }
  attachSources(sources, notify, onsets) {
    this.sources = sources; this.onsets = onsets; this.sourcePanel = new AudioSourcesPanel(sources, notify, onsets);
    onsets?.addEventListener('change', () => { if (onsets.preview && onsets.preview !== this.previewResult) { this.previewResult = onsets.preview; this.enabled = true; if (this.enabledInput) this.enabledInput.checked = true; this.onChange(); } this.draw(this.lastOffsetSeconds ?? 0); });
    const refresh = async () => {
      if (onsets?.preview && (!sources.original || onsets.preview.sourceRevision !== sources.revision || onsets.preview.selection !== sources.selectedIds.join('\0'))) onsets.clearPreview();
      const selection = sources.selectedIds.join('\0'); if (this.originalAudio && this.originalAudio !== sources.original || this.sourceSelection && this.sourceSelection !== selection) onsets?.cancel(); this.originalAudio = sources.original; this.sourceSelection = selection;
      const serial = this.sourceSerial = (this.sourceSerial ?? 0) + 1;
      try {
        const layers = [];
        for (const id of sources.selectedIds) {
          const entry = await sources.resolve(id); if (serial !== this.sourceSerial) return;
          let data = this.analysisCache.get(entry.buffer); if (!data) { data = analyseAudioBuffer(entry.buffer); if (data) this.analysisCache.set(entry.buffer, data); }
          if (data) layers.push({ id, buffer: entry.buffer, color: entry.color, data });
        }
        const selected = await sources.resolveSelection(); if (serial !== this.sourceSerial) return; this.layers = layers; this.data = layers[0]?.data ?? null; this.sourceBuffer = selected.buffer; this.sourceOffset = 0; this.draw(this.lastOffsetSeconds ?? 0);
      } catch { if (serial === this.sourceSerial) { this.layers = []; this.sourceBuffer = null; this.data = null; this.draw(); } }
    };
    sources.addEventListener('change', refresh); refresh();
  }

  render(host) {
    host.replaceChildren();
    if (this.sourcePanel) { this.sourcePanel.render(); host.append(this.sourcePanel.host); this.sourcePanel.refreshEnvironment(); }
    const heading = document.createElement('h3'); heading.textContent = t('audio-analysis.s2cfdcbf'); heading.className = 'audio-analysis-heading'; host.append(heading);
    const title = document.createElement('p'); title.className = 'hint';
    title.textContent = t('audio-analysis.s799c07a'); host.append(title);
    const enabled = document.createElement('label'); enabled.className = 'field'; enabled.append(t('audio-analysis.s1ca3ef1'));
    const enabledInput = document.createElement('input'); enabledInput.type = 'checkbox'; enabledInput.checked = this.enabled;
    this.enabledInput = enabledInput;
    enabledInput.oninput = () => { this.enabled = enabledInput.checked; this.pitchView?.syncState(); this.onChange(); this.draw(this.lastOffsetSeconds ?? 0); }; enabled.append(enabledInput); host.append(enabled);
    const alpha = document.createElement('label'); alpha.className = 'field'; alpha.append(t('audio-analysis.s61b101b'));
    const alphaInput = document.createElement('input'); alphaInput.type = 'range'; alphaInput.min = '0.02'; alphaInput.max = '1'; alphaInput.step = '0.01'; alphaInput.value = this.alpha;
    alphaInput.oninput = () => { this.alpha = Number(alphaInput.value); this.onChange(); this.draw(this.lastOffsetSeconds ?? 0); }; alpha.append(alphaInput); host.append(alpha);
    const width = document.createElement('label'); width.className = 'field'; width.append(t('audio-analysis.sa875081'));
    const widthInput = document.createElement('input'); widthInput.type = 'range'; widthInput.min = '0.2'; widthInput.max = '1'; widthInput.step = '0.01'; widthInput.value = this.width;
    widthInput.oninput = () => { this.width = Number(widthInput.value); this.onChange(); this.draw(this.lastOffsetSeconds ?? 0); }; width.append(widthInput); host.append(width);
    const mode = document.createElement('div'); mode.className = 'analysis-mode-buttons';
    for (const [value, label] of [['waveform', t('audio-analysis.s1b686e5')], ['spectrum', t('audio-analysis.s75c6d62')]]) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.classList.toggle('active', this.mode === value);
      button.onclick = () => { this.mode = value; this.enabled = true; this.render(host); this.onChange(); this.draw(this.lastOffsetSeconds ?? 0); }; mode.append(button);
    }
    host.append(mode);
    this.pitchView ??= new AudioPitchView(this, () => this.requestFrame?.());
    const pitchHost = document.createElement('div'); pitchHost.className = 'audio-pitch-panel'; this.pitchView.render(pitchHost); host.append(pitchHost);
    if (!this.data) { const empty = document.createElement('p'); empty.className = 'hint'; empty.textContent = t('audio-analysis.s9463632'); host.append(empty); }
    if (this.sourcePanel?.onsetPanel) host.append(this.sourcePanel.onsetPanel.host);
  }

  draw(offsetSeconds = 0) {
    this.lastOffsetSeconds = offsetSeconds;
    const canvas = this.canvas; if (!canvas) return;
    const timeline = this.getTimeline?.(); const stage = canvas.parentElement;
    if (!this.enabled || !this.data || timeline?.getSession?.()?.multiLineActive) { if (!canvas.hidden) canvas.hidden = true; this.lastFrame = null; return; }
    const stageRect = stage?.getBoundingClientRect?.(); const notesRect = timeline?.notesCanvas?.getBoundingClientRect?.();
    if (!stageRect || !notesRect || !notesRect.width || !notesRect.height) {
      if (!canvas.hidden) canvas.hidden = true; this.lastFrame = null; return;
    }
    if (canvas.hidden) canvas.hidden = false;
    const ratio = globalThis.devicePixelRatio || 1;
    const width = stageRect.width; const height = stageRect.height;
    const left = notesRect.left - stageRect.left; const right = notesRect.right - stageRect.left;
    const center = (left + right) / 2; const half = Math.max(8, (right - left) * clamp(this.width) / 2);
    const fullPixelWidth = Math.round(width * ratio), cropLeft = Math.max(0, Math.floor((center - half) * ratio) - 2), cropRight = Math.min(fullPixelWidth, Math.ceil((center + half) * ratio) + 2), pixelWidth = Math.max(1, cropRight - cropLeft);
    this.drawRegion = { left: cropLeft, width: pixelWidth, fullWidth: fullPixelWidth, ratio };
    const cropStyle = [cropLeft, pixelWidth, ratio, editorCanvasRevision()];
    if (!this.cropStyle || cropStyle.some((value, index) => value !== this.cropStyle[index])) { canvas.style.left = cropLeft / ratio + 'px'; canvas.style.right = 'auto'; canvas.style.width = pixelWidth / ratio + 'px'; this.cropStyle = cropStyle; }
    const timelineHeight = Math.min(height, notesRect.height), viewHeight = timeline.viewHeight(), factor = timeline.factor, preview = this.onsets?.preview;
    const pitchId = this.pitchView?.active && this.pitchView.position === 'inline' ? this.pitchView.id : null;
    const laneCount = this.layers.length + (pitchId && !this.layers.some(layer => layer.id === pitchId) ? 1 : 0);
    const frame = [width, height, left, right, ratio, canvas.width, canvas.height, timelineHeight, viewHeight, timeline.origin, timeline.tempo, timeline.scale, timeline.judgementOffset, factor, offsetSeconds, this.mode, this.width, this.alpha, this.layers, this.data, this.getAudio()?.buffer, editorCanvasRevision(), preview, pitchId];
    if (this.lastFrame?.length === frame.length && frame.every((value, index) => value === this.lastFrame[index])) return;
    if (canvas.width !== pixelWidth || canvas.height !== Math.round(height * ratio)) { canvas.width = pixelWidth; canvas.height = Math.round(height * ratio); frame[5] = canvas.width; frame[6] = canvas.height; }
    this.lastFrame = frame;
    const nativeContext = canvas.getContext('2d'), context = editorSkinContext(nativeContext);
    nativeContext.setTransform(1, 0, 0, 1, 0, 0); nativeContext.clearRect(0, 0, canvas.width, canvas.height);
    context.setTransform(ratio, 0, 0, ratio, -cropLeft, 0);
    const originSeconds = timeline.tempo.seconds(timeline.origin, factor), judgementY = viewHeight - timeline.judgementOffset, scale = timeline.scale;
    const rowCount = Math.ceil(timelineHeight);
    if (!this.rowSeconds || this.rowSeconds.length < rowCount) this.rowSeconds = new Float64Array(rowCount);
    if (this.mode === 'waveform') for (let row = 0; row < rowCount; row++) this.rowSeconds[row] = originSeconds + (judgementY - row) / scale + offsetSeconds;
    context.save(); context.lineWidth = 1;
    for (const [layerIndex, layer] of this.layers.entries()) {
      if (layer.id === pitchId) continue;
      const source = layer.data, laneWidth = half * 2 / laneCount, laneCenter = center - half + laneWidth * (layerIndex + .5), laneHalf = laneWidth / 2; context.globalAlpha = clamp(this.alpha); context.strokeStyle = layer.color; context.fillStyle = layer.color;
      const duration = Math.min(source.duration, this.getAudio()?.buffer?.duration ?? source.duration);
      if (this.mode === 'spectrum') {
        const start = Math.max(0, originSeconds + (judgementY - timelineHeight) / scale + offsetSeconds), end = Math.min(duration, originSeconds + judgementY / scale + offsetSeconds);
        if (end > start) {
          const texture = this.spectrumTexture(source, context.fillStyle), top = timeline.vertical(timeline.tempo.beat(end - offsetSeconds, timeline.factor)), bottom = timeline.vertical(timeline.tempo.beat(start - offsetSeconds, timeline.factor));
          context.save(); context.translate(laneCenter - laneHalf, bottom); context.scale(1, -1); context.imageSmoothingEnabled = false;
          context.drawImage(texture, 0, start / source.duration * source.frameCount, source.bands, (end - start) / source.duration * source.frameCount, 0, 0, laneWidth, bottom - top); context.restore();
        }
        continue;
      }
      const first = Math.max(0, Math.floor(judgementY - (duration - offsetSeconds - originSeconds) * scale) - 1), last = Math.min(rowCount, Math.ceil(judgementY + (offsetSeconds + originSeconds) * scale) + 1);
      let envelope = this.waveformCache.get(source.waveform);
      if (!envelope) { envelope = new WaveformEnvelope(source.waveform); this.waveformCache.set(source.waveform, envelope); }
      const samplesPerSecond = source.waveform.length / source.duration, rowDuration = 1 / scale;
      const alpha = nativeContext.globalAlpha; nativeContext.globalAlpha = alpha * editorCanvasOpacity(canvas);
      for (let y = first; y < last; y++) {
        const audioSeconds = this.rowSeconds[y];
        if (audioSeconds < 0 || audioSeconds - rowDuration > duration) continue;
        const amplitude = envelope.peak((audioSeconds - rowDuration) * samplesPerSecond, Math.min(duration, audioSeconds) * samplesPerSecond);
        const extent = amplitude * Math.max(1, laneHalf - (this.layers.length > 1 ? 2 : 0));
        nativeContext.fillRect(laneCenter - extent, y, Math.max(1, extent * 2), 1);
      }
      nativeContext.globalAlpha = alpha;
    }
    if (preview && preview.selection === this.sources?.selectedIds.join('\0')) {
      context.globalAlpha = .8; context.strokeStyle = '#63e6ad'; context.lineWidth = 1;
      for (const peak of preview.peaks) {
        const seconds = peak.seconds + preview.offsetSeconds - offsetSeconds, y = timeline.vertical(timeline.tempo.beat(seconds, timeline.factor)); if (y < 0 || y > timelineHeight) continue;
        context.beginPath(); context.moveTo(center - half, y); context.lineTo(center + half, y); context.stroke();
      }
    }
    context.restore();
  }

  spectrumTexture(data, color) {
    if (data.texture?.color === color) return data.texture.canvas;
    const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(data.bands, data.frameCount) : document.createElement('canvas'); canvas.width = data.bands; canvas.height = data.frameCount;
    const context = canvas.getContext('2d'); context.fillStyle = color; context.fillRect(0, 0, 1, 1); const rgba = context.getImageData(0, 0, 1, 1).data, pixels = context.createImageData(data.bands, data.frameCount);
    for (let index = 0; index < data.spectrum.length; index++) { const magnitude = data.spectrum[index]; if (magnitude <= .01) continue; pixels.data[index * 4] = rgba[0]; pixels.data[index * 4 + 1] = rgba[1]; pixels.data[index * 4 + 2] = rgba[2]; pixels.data[index * 4 + 3] = Math.round(rgba[3] * (.18 + .82 * magnitude)); }
    context.putImageData(pixels, 0, 0); data.texture = { color, canvas }; return canvas;
  }
}
