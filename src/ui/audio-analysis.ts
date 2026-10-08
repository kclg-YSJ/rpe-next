/**
 * The slice of the timeline the analysis overlay reads.
 *
 * Declared structurally rather than imported from `timeline.ts` so this panel stays free of an
 * import cycle; every member but `timeAt` is reached through an optional chain, matching the
 * defensive reads the original JavaScript already made.
 */
export interface AnalysisTimeline {
  /** The notes canvas the overlay is aligned to. */
  notesCanvas?: HTMLCanvasElement | null;
  /** The live editor session; only the multi-line flag matters here. */
  getSession?: () => { multiLineActive?: boolean } | null | undefined;
  /** Seconds at a vertical canvas position. */
  timeAt(vertical: number): number;
}

/**
 * The decoded-audio fields the analysis reads.
 *
 * Every member is optional and structural rather than `AudioBuffer`, because the transport hands
 * over an `AudioBufferLike` (see `platform/audio.ts`), which declares only `duration`; the sample
 * accessors are checked at runtime below, exactly as the original did.
 */
export interface AnalysisAudioBuffer {
  duration?: number;
  numberOfChannels?: number;
  length?: number;
  getChannelData?(channel: number): Float32Array;
}

/** Which reading the overlay paints. Mirrors the stored `analysisMode` preference. */
export type AnalysisMode = 'waveform' | 'spectrum';

/** Optional analysis resolution overrides; each falls back to the constants in the original. */
export interface AudioAnalysisOptions {
  waveformSize?: number;
  bands?: number;
  spectrumFrames?: number;
}

/** One analysed buffer: a peak waveform and a normalized spectrum, both ready to paint. */
export interface AudioAnalysisData {
  duration: number;
  waveform: Float32Array;
  spectrum: Float32Array;
  bands: number;
  frameCount: number;
}

const clamp = (value: number, minimum = 0, maximum = 1): number => Math.max(minimum, Math.min(maximum, value));

function channelSamples(buffer: AnalysisAudioBuffer | null | undefined): Float32Array | null {
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

export function analyseAudioBuffer(buffer: AnalysisAudioBuffer | null | undefined, options: AudioAnalysisOptions = {}): AudioAnalysisData | null {
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
  // `samples` is non-null only for a non-null `buffer`, so this optional chain cannot take its
  // undefined branch for any input the original reached here with; it is only how the type says so.
  return { duration: Number(buffer?.duration) || 0, waveform, spectrum, bands, frameCount };
}

export class AudioAnalysis {
  canvas: HTMLCanvasElement | null;
  getTimeline: (() => AnalysisTimeline | undefined) | undefined;
  /**
   * Stored but never invoked by this module — the panel is pushed buffers through `setBuffer`.
   * Typed as `unknown` because the original never read a member off its result.
   */
  getAudio: (() => unknown) | undefined;
  onChange: () => void;
  mode: AnalysisMode;
  enabled: boolean;
  alpha: number;
  width: number;
  data: AudioAnalysisData | null;

  constructor(canvas: HTMLCanvasElement | null, getTimeline: (() => AnalysisTimeline | undefined) | undefined, getAudio: (() => unknown) | undefined, onChange: () => void = () => {}) {
    this.canvas = canvas;
    this.getTimeline = getTimeline;
    this.getAudio = getAudio;
    this.onChange = onChange;
    this.mode = 'waveform';
    this.enabled = false;
    this.alpha = 0.2;
    this.width = 0.62;
    this.data = null;
  }

  setBuffer(buffer: AnalysisAudioBuffer | null): void { this.data = analyseAudioBuffer(buffer); this.draw(); }

  render(host: HTMLElement): void {
    host.replaceChildren();
    const title = document.createElement('p'); title.className = 'hint';
    title.textContent = '分析图只显示在单线编辑区域，按当前时间视区滚动；延迟会参与对齐。'; host.append(title);
    const enabled = document.createElement('label'); enabled.className = 'field'; enabled.append('显示分析图');
    const enabledInput = document.createElement('input'); enabledInput.type = 'checkbox'; enabledInput.checked = this.enabled;
    enabledInput.oninput = () => { this.enabled = enabledInput.checked; this.onChange(); this.draw(); }; enabled.append(enabledInput); host.append(enabled);
    const alpha = document.createElement('label'); alpha.className = 'field'; alpha.append('透明度');
    const alphaInput = document.createElement('input'); alphaInput.type = 'range'; alphaInput.min = '0.02'; alphaInput.max = '1'; alphaInput.step = '0.01'; alphaInput.value = String(this.alpha);
    alphaInput.oninput = () => { this.alpha = Number(alphaInput.value); this.onChange(); this.draw(); }; alpha.append(alphaInput); host.append(alpha);
    const width = document.createElement('label'); width.className = 'field'; width.append('横向宽度');
    const widthInput = document.createElement('input'); widthInput.type = 'range'; widthInput.min = '0.2'; widthInput.max = '1'; widthInput.step = '0.01'; widthInput.value = String(this.width);
    widthInput.oninput = () => { this.width = Number(widthInput.value); this.onChange(); this.draw(); }; width.append(widthInput); host.append(width);
    const mode = document.createElement('div'); mode.className = 'analysis-mode-buttons';
    // `as const` is the four-known-values contract the `<option>`-free buttons below already had.
    for (const [value, label] of [['waveform', '波形图'], ['spectrum', '频谱']] as const) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.classList.toggle('active', this.mode === value);
      button.onclick = () => { this.mode = value; this.enabled = true; this.render(host); this.onChange(); this.draw(); }; mode.append(button);
    }
    host.append(mode);
    if (!this.data) { const empty = document.createElement('p'); empty.className = 'hint'; empty.textContent = '当前没有可分析的已解码音乐。'; host.append(empty); }
  }

  draw(offsetSeconds = 0): void {
    const canvas = this.canvas; if (!canvas) return;
    const timeline = this.getTimeline?.(); const stage = canvas.parentElement;
    const stageRect = stage?.getBoundingClientRect?.(); const notesRect = timeline?.notesCanvas?.getBoundingClientRect?.();
    if (!stageRect || !notesRect || !this.enabled || !this.data || timeline?.getSession?.()?.multiLineActive || !notesRect.width || !notesRect.height) {
      canvas.hidden = true; return;
    }
    canvas.hidden = false;
    const ratio = globalThis.devicePixelRatio || 1;
    const width = stageRect.width; const height = stageRect.height;
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) { canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio); }
    // `getContext('2d')` only returns null for a context type the canvas cannot provide, and this
    // overlay is always created as 2D; the original dereferenced it unguarded here.
    const context = canvas.getContext('2d')!; context.setTransform(ratio, 0, 0, ratio, 0, 0); context.clearRect(0, 0, width, height);
    const left = notesRect.left - stageRect.left; const right = notesRect.right - stageRect.left;
    const center = (left + right) / 2; const half = Math.max(8, (right - left) * clamp(this.width) / 2);
    const timelineHeight = Math.min(height, notesRect.height); const source = this.data;
    context.save(); context.globalAlpha = clamp(this.alpha); context.strokeStyle = this.mode === 'waveform' ? '#5db9d4' : '#d9a45d'; context.fillStyle = context.strokeStyle; context.lineWidth = 1;
    // The guard above only rejects a truthy `multiLineActive`, so the timeline stays optional here;
    // the original dereferenced it unguarded and would have thrown for a missing one.
    for (let y = 0; y < timelineHeight; y += 1) {
      const chartSeconds = timeline!.timeAt(y); const audioSeconds = chartSeconds + offsetSeconds;
      if (audioSeconds < 0 || audioSeconds > source.duration) continue;
      const progress = source.duration ? audioSeconds / source.duration : 0;
      const frame = Math.max(0, Math.min((source.waveform.length - 1), Math.floor(progress * source.waveform.length)));
      const amplitude = source.waveform[frame] ?? 0;
      if (this.mode === 'waveform') {
        const extent = amplitude * half;
        context.fillRect(center - extent, y, Math.max(1, extent * 2), 1);
      } else {
        const spectrumFrame = Math.max(0, Math.min(source.frameCount - 1, Math.floor(progress * source.frameCount)));
        const barWidth = Math.max(1, (half * 2) / source.bands);
        for (let band = 0; band < source.bands; band++) {
          const magnitude = source.spectrum[spectrumFrame * source.bands + band] ?? amplitude;
          if (magnitude <= 0.01) continue;
          context.globalAlpha = clamp(this.alpha) * (0.18 + 0.82 * magnitude);
          context.fillRect(center - half + band * barWidth, y, Math.ceil(barWidth), 1);
        }
      }
    }
    context.restore();
  }
}
