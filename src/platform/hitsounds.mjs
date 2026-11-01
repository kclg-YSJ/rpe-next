import { upperBound } from '../core/beat.mjs';
import { assetBytes } from './files.mjs';
import { assetUrl } from '../core/asset-url.mjs';
import { t } from '../i18n.mjs';

export function hitTimeline(chart, tempo, offsets = [0, 0], lineIndex = null) {
  const entries = [];
  const lines = lineIndex === null || lineIndex === undefined
    ? chart.judgeLineList ?? []
    : [chart.judgeLineList?.[lineIndex]].filter(Boolean);
  for (const line of lines) for (const note of line.notes ?? []) {
    if (note.isFake) continue;
    const kind = note.type === 3 ? 'flick' : note.type === 4 ? 'drag' : 'tap';
    const offset = Array.isArray(offsets) ? offsets[kind === 'drag' ? 1 : kind === 'flick' && offsets.length > 2 ? 2 : 0] ?? 0 : offsets[kind] ?? 0;
    entries.push({ time: tempo.seconds(note.startTime, line.bpmfactor ?? 1) + (chart.META.offset ?? 0) / 1000 + offset,
      sound: note.hitsound || note.hitSound || kind });
  }
  return entries.sort((left, right) => left.time - right.time);
}

export class HitSounds {
  constructor(transport, { onWarning = () => {} } = {}) {
    this.transport = transport; this.buffers = new Map(); this.sources = new Set(); this.volume = 0.3; this.enabled = true; this.onlyCurrentLine = false; this.assets = new Map(); this.chartName = ''; this.generation = 0;
    this.onWarning = onWarning; this.defaultBuffers = new Map(); this.defaultPending = new Map();
    this.mixers = new Map();
    this.maxVoices = 192;
    this.maxBurst = 96;
    this.maxSameTime = 64;
    this.skinBuffers = new Map();
    this.delays = { tap: 0, drag: 0, flick: 0 };
  }

  async prepare() {
    const context = this.transport.ensureContext();
    if (!this.gain) { this.gain = context.createGain(); this.gain.connect(context.destination); }
    this.gain.gain.value = this.volume;
    const generation = this.generation, assets = this.assets, chartName = this.chartName;
    const names = new Set(['tap', 'drag', 'flick', ...(this.chart?.judgeLineList ?? []).flatMap(line => (line.notes ?? []).map(note => note.hitsound || note.hitSound).filter(Boolean))]);
    const failures = await Promise.all([...names].map(async name => {
      if (this.buffers.has(name)) return;
      const bytes = assetBytes(assets, name, chartName), builtin = ['tap', 'drag', 'flick'].includes(name);
      if (!bytes && (!builtin || this.skinBuffers.has(name))) return;
      try {
        const decoded = bytes ? await context.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)) : await this.defaultBuffer(name, context);
        if (generation === this.generation) { this.buffers.set(name, decoded); this.streamsStarted = false; }
      } catch (error) { if (!bytes && builtin) return { name, error }; }
    }));
    const failed = failures.filter(failure => failure && !this.skinBuffers.has(failure.name));
    if (generation === this.generation && failed.length) this.onWarning(t('hitsounds.loadFailed', {
      names: failed.map(failure => failure.name + '.ogg').join(', '), reason: [...new Set(failed.map(failure => failure.error.message))].join('; '),
    }));
    await this.prepareMixer(context);
  }

  async prepareMixer(context) {
    if (!context.audioWorklet || typeof AudioWorkletNode !== 'function' || this.workletContext === context) return;
    if (!this.workletPending) this.workletPending = context.audioWorklet.addModule(new URL('./hitsound-impulses.mjs', import.meta.url)).then(() => { this.workletContext = context; }).catch(() => {}).finally(() => { this.workletPending = null; });
    await this.workletPending;
  }

  async defaultBuffer(name, context) {
    if (this.defaultBuffers.has(name)) return this.defaultBuffers.get(name);
    if (this.defaultPending.has(name)) return this.defaultPending.get(name);
    const pending = (async () => {
      const response = await fetch(assetUrl(`rpe/SE/${name}.ogg`), { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw Error('HTTP ' + response.status);
      const decoded = await context.decodeAudioData(await response.arrayBuffer());
      this.defaultBuffers.set(name, decoded); return decoded;
    })();
    this.defaultPending.set(name, pending);
    try { return await pending; } finally { this.defaultPending.delete(name); }
  }

  setProject(chart, assets, chartName) { this.stop(); this.generation++; this.buffers.clear(); this.chart = chart; this.assets = assets; this.chartName = chartName; this.compiled = null; this.compiledLine = null; this.onlyCurrentLine = false; }
  setAssets(assets, chartName = this.chartName) {
    if (this.assets === assets && this.chartName === chartName) return;
    if (this.mixers.size) this.stop();
    this.generation++;
    for (const name of this.buffers.keys()) if (assetBytes(this.assets, name, this.chartName) !== assetBytes(assets, name, chartName)) this.buffers.delete(name);
    this.assets = assets; this.chartName = chartName;
  }
  setVolume(value) { this.volume = Math.max(0, Math.min(1, value)); if (this.gain) this.gain.gain.value = this.volume; }
  setDelays(values) {
    const next = Object.fromEntries(['tap', 'drag', 'flick'].map(kind => [kind, Number.isFinite(values?.[kind]) ? values[kind] : 0]));
    if (Object.keys(next).every(kind => next[kind] === this.delays[kind])) return;
    this.stop(); this.delays = next; this.compiled = null;
  }
  setSoundPack(buffers = new Map()) { this.stop(); this.skinBuffers = new Map(buffers); }
  stop() { this.stopRevision = (this.stopRevision ?? 0) + 1; for (const source of this.sources) { source.stop(); source.disconnect(); } this.sources.clear(); for (const mixer of this.mixers.values()) { mixer.generator.port.postMessage('stop'); mixer.generator.disconnect(); mixer.disconnect(); } this.mixers.clear(); this.streamsStarted = false; this.revision = -1; }

  startStreams(time, now, rate) {
    if (this.streamsStarted) return; this.streamsStarted = true;
    const context = this.transport.context, groups = new Map();
    if (!this.mixers.size) { this.streamAnchor = now - time / rate; this.streamShift = 0; }
    for (let index = this.next; index < this.entries.length; index++) {
      const entry = this.entries[index], buffer = this.skinBuffers.get(entry.sound) ?? this.buffers.get(entry.sound);
      if (!buffer || buffer.numberOfChannels > 2 || buffer.sampleRate !== context.sampleRate || this.mixers.has(buffer)) continue;
      if (!groups.has(buffer)) groups.set(buffer, []); groups.get(buffer).push((now + Math.max(0, entry.time - time) / rate - this.streamShift) * context.sampleRate);
    }
    for (const [buffer, frames] of groups) {
      const mixer = context.createConvolver(); mixer.normalize = false; mixer.buffer = buffer;
      mixer.generator = new AudioWorkletNode(context, 'rpen-hit-impulses', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1], processorOptions: { frames: new Float64Array(frames) } });
      mixer.generator.onprocessorerror = () => { if (this.mixers.get(buffer) === mixer) { this.workletContext = null; this.stop(); } };
      if (this.streamShift) mixer.generator.port.postMessage({ shift: this.streamShift * context.sampleRate });
      mixer.generator.connect(mixer); mixer.connect(this.gain); this.mixers.set(buffer, mixer);
    }
  }

  scheduleMixed(buffer, times, time, now, rate, weights) {
    const context = this.transport.context;
    const delay = Math.max(0, times[0] - time) / rate;
    const startFrame = Math.floor((now + delay) * context.sampleRate);
    const offsets = times.map(value => Math.max(0, (now + Math.max(0, value - time) / rate) * context.sampleRate - startFrame));
    const mixed = context.createBuffer(buffer.numberOfChannels, Math.ceil(offsets.at(-1)) + buffer.length + 1, context.sampleRate);
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const samples = mixed.getChannelData(channel), original = buffer.getChannelData(channel);
      for (const [position, offset] of offsets.entries()) {
        const first = Math.floor(offset), fraction = offset - first;
        const weight = weights?.[position] ?? 1;
        for (let index = 0; index < original.length; index++) { samples[first + index] += original[index] * (1 - fraction) * weight; if (fraction) samples[first + index + 1] += original[index] * fraction * weight; }
      }
    }
    const source = context.createBufferSource(); source.buffer = mixed; source.connect(this.gain);
    source.onended = () => { this.sources.delete(source); source.disconnect(); };
    source.start(startFrame / context.sampleRate); this.sources.add(source);
  }

  tick(chart, tempo, currentLine = null) {
    if (!this.enabled || !this.transport.playing || this.transport.clockReady === false) { this.stop(); return; }
    const line = this.onlyCurrentLine ? currentLine : null;
    if (this.compiled !== chart || this.tempo !== tempo || this.compiledLine !== line) {
      this.stop(); this.compiled = chart; this.tempo = tempo; this.compiledLine = line;
      this.entries = hitTimeline(chart, tempo, Object.fromEntries(Object.entries(this.delays).map(([kind, milliseconds]) => [kind, milliseconds / 1000])), line);
    }
    const time = this.transport.time; const context = this.transport.context;
    if (this.revision !== this.transport.playRevision) {
      this.stop(); this.revision = this.transport.playRevision;
      this.next = upperBound(this.entries, time - 0.02, entry => entry.time);
    }
    this.next = Math.max(this.next, upperBound(this.entries, time - 0.08, entry => entry.time));
    const canMix = typeof context.createBuffer === 'function';
    const dense = canMix && (this.mixers.size > 0 || upperBound(this.entries, time + 0.1 * this.transport.rate, entry => entry.time) - upperBound(this.entries, time - .02, entry => entry.time) > Math.min(this.maxBurst, this.maxSameTime));
    if (this.mixers.size) {
      const shift = context.currentTime - time / this.transport.rate - this.streamAnchor;
      if (Math.abs(shift - this.streamShift) > .01) { this.streamShift = shift; for (const mixer of this.mixers.values()) mixer.generator.port.postMessage({ shift: shift * context.sampleRate }); }
    }
    if (dense && this.workletContext === context && this.gain && !Number.isFinite(this.transport.scheduleHorizon)) {
      try { this.startStreams(time, context.currentTime, this.transport.rate); }
      catch { this.workletContext = null; this.stop(); this.revision = this.transport.playRevision; this.next = upperBound(this.entries, time - .02, entry => entry.time); }
    }
    const until = time + (dense && this.workletContext === context ? 0.3 : 0.1) * this.transport.rate;
    let burst = 0;
    const sameTime = new Map(), groups = new Map(), now = context.currentTime;
    while (this.next < this.entries.length && this.entries[this.next].time <= until && this.entries[this.next].time < (this.transport.scheduleHorizon ?? Infinity)) {
      const entry = this.entries[this.next++]; const buffer = this.skinBuffers.get(entry.sound) ?? this.buffers.get(entry.sound);
      if (!buffer || !this.gain) continue;
      if (this.mixers.has(buffer)) continue;
      if (canMix && typeof buffer.getChannelData === 'function' && (dense || this.sources.size >= this.maxVoices)) {
        if (!groups.has(buffer)) groups.set(buffer, []); groups.get(buffer).push(entry.time); continue;
      }
      const timeKey = Math.round(entry.time * 1000);
      const timeCount = sameTime.get(timeKey) ?? 0;
      if (burst >= this.maxBurst || this.sources.size >= this.maxVoices || timeCount >= this.maxSameTime) continue;
      const source = context.createBufferSource(); source.buffer = buffer; source.connect(this.gain);
      source.onended = () => { this.sources.delete(source); source.disconnect(); };
      source.start(now + Math.max(0, entry.time - time) / this.transport.rate);
      this.sources.add(source);
      sameTime.set(timeKey, timeCount + 1); burst++;
    }
    for (const [buffer, times] of groups) this.scheduleMixed(buffer, times, time, now, this.transport.rate);
  }
}
