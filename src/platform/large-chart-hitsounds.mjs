// Queries the complete disk document for a short audio interval. Counts become
// weighted impulses, so coincident notes do not create millions of voices.
export class LargeChartHitSounds {
  constructor(document, sounds, call) {
    this.document = document; this.sounds = sounds; this.audio = sounds.transport; this.call = call; this.scheduled = -Infinity;
  }
  signature() {
    const sounds = this.sounds;
    return JSON.stringify([this.document.revision, sounds.enabled, sounds.onlyCurrentLine ? this.document.session.lineIndex : null, sounds.delays, sounds.generation]);
  }
  contains(seconds) { return this.window && this.window.key === this.signature() && seconds >= this.window.start && seconds < this.window.end; }
  async ensure(seconds) {
    if (!this.sounds.enabled || this.contains(seconds) && seconds < this.window.end - .2) return;
    if (this.request) return this.request;
    const key = this.signature(), sounds = this.sounds;
    this.request = (async () => {
      const span = .6;
      const value = await this.call('hits', this.document.summary.id, { start: seconds, end: seconds + span, delays: sounds.delays, line: sounds.onlyCurrentLine ? this.document.session.lineIndex : null });
      if (this.disposed || this.signature() !== key) return;
      const entries = value.entries.map(entry => ({ ...entry, time: entry.time + (sounds.delays[entry.kind] ?? 0) / 1000 })).filter(entry => entry.time >= seconds && entry.time < seconds + span).sort((a,b)=>a.time-b.time);
      this.window = { key, start: seconds, end: seconds + span, entries };
    })().finally(() => { this.request = null; });
    return this.request;
  }
  tick(seconds) {
    const sounds = this.sounds, audio = this.audio, context = audio.context;
    if (!sounds.enabled || !audio.playing || !context || audio.clockReady === false || !this.contains(seconds)) return;
    const key = `${this.signature()}:${audio.playRevision}:${audio.rate}:${sounds.stopRevision}`;
    if (this.key !== key) { this.key = key; this.scheduled = seconds - .001; }
    const end = Math.min(this.window.end, seconds + .3 * audio.rate), groups = new Map();
    for (const entry of this.window.entries) {
      if (entry.time < Math.max(this.scheduled,seconds-.02) || entry.time >= end) continue;
      const buffer = sounds.skinBuffers.get(entry.sound) ?? sounds.buffers.get(entry.sound);
      if (!buffer || !sounds.gain) continue;
      if (!groups.has(buffer)) groups.set(buffer, []); groups.get(buffer).push(entry);
    }
    for (const [buffer, entries] of groups) {
      if (sounds.workletContext === context && typeof AudioWorkletNode === 'function' && buffer.sampleRate === context.sampleRate) {
        const frames = new Float64Array(entries.length), weights = new Float64Array(entries.length);
        for (const [index, entry] of entries.entries()) { frames[index] = (context.currentTime + Math.max(0,entry.time-seconds) / audio.rate) * context.sampleRate; weights[index] = entry.count; }
        let mixer = sounds.mixers.get(buffer);
        if (!mixer) {
          mixer = context.createConvolver(); mixer.normalize = false; mixer.buffer = buffer;
          mixer.generator = new AudioWorkletNode(context,'rpen-hit-impulses',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[1],processorOptions:{frames,weights}});
          mixer.generator.connect(mixer); mixer.connect(sounds.gain); sounds.mixers.set(buffer,mixer);
          mixer.generator.onprocessorerror = () => { sounds.workletContext = null; sounds.stop(); };
        } else mixer.generator.port.postMessage({frames,weights},[frames.buffer,weights.buffer]);
      } else sounds.scheduleMixed(buffer, entries.map(entry=>entry.time), seconds, context.currentTime, audio.rate, entries.map(entry=>entry.count));
    }
    this.scheduled = Math.max(this.scheduled,end);
  }
  dispose() { this.disposed = true; this.window = null; this.sounds.stop(); }
}
