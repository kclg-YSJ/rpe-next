import { createPitchTrack, pitchChunkOrder, resamplePitchWindow, updatePitchRange, PITCH_FRAME_RATE } from '../core/audio-pitch.mjs';
import { pitchAudioKey, readPitchCache, writePitchCache } from '../platform/audio-pitch-cache.mjs';
import { ResourceCache } from '../core/resource-cache.mjs';
const cancelError = () => new DOMException('Cancelled', 'AbortError');
export class AudioPitch extends EventTarget {
  constructor(sources, { createWorker = () => new Worker(new URL('../platform/audio-pitch-worker.mjs', import.meta.url), { type: 'module' }), key = pitchAudioKey, read = readPitchCache, write = writePitchCache } = {}) {
    super(); this.sources = sources; this.createWorker = createWorker; this.key = key; this.read = read; this.write = write;
    this.cache = new ResourceCache({ maxBytes: 8 * 1024 ** 2, maxEntries: 4 }); this.keys = new WeakMap(); this.serial = 0; this.progress = 0; this.stage = 'idle';
  }
  changed() { this.dispatchEvent(new Event('change')); }
  stop() { this.serial++; this.controller?.abort(); this.worker?.terminate(); this.worker = null; this.busy = false; this.controller = null; }
  clear() { this.stop(); this.cache.clear(); this.track = null; this.entry = null; this.sourceId = null; this.changed(); }
  async start(id, centerSeconds = 0) {
    this.stop(); const serial = this.serial, controller = this.controller = new AbortController(), signal = controller.signal;
    this.sourceId = id; this.track = null; this.entry = null; this.error = null; this.warning = null; this.busy = true; this.progress = 0; this.stage = 'preparing'; this.changed();
    const check = () => { if (signal.aborted || serial !== this.serial) throw cancelError(); };
    try {
      const entry = await this.sources.resolve(id, signal); check(); this.entry = entry;
      const buffer = entry.buffer, cached = this.cache.get(this.keys.get(buffer)); if (cached) { this.track = cached; this.progress = 1; return; }
      const track = createPitchTrack(Math.min(buffer.duration, this.sources.original?.duration ?? buffer.duration));
      const key = this.keys.get(buffer) ?? await this.key(buffer, signal); check(); this.keys.set(buffer, key); const saved = await this.read(key); check();
      if (saved && saved.duration === track.duration) { this.track = saved; this.cache.set(key, saved, saved.pitches.byteLength + saved.confidence.byteLength + saved.ready.byteLength); this.progress = 1; return; }
      this.track = track; this.stage = 'model'; this.changed();
      const worker = this.worker = this.createWorker();
      let request = 0;
      const call = value => new Promise((resolve, reject) => {
        const rid = ++request; let timeout;
        const cleanup = () => { clearTimeout(timeout); signal.removeEventListener('abort', cancelled); worker.removeEventListener('message', message); worker.removeEventListener('error', failed); };
        const cancelled = () => { cleanup(); reject(cancelError()); }, failed = event => { cleanup(); reject(Error(event.message || 'pitch-worker')); };
        const message = event => { if (event.data.id !== rid) return; cleanup(); event.data.error ? reject(Error(event.data.error)) : resolve(event.data); };
        signal.addEventListener('abort', cancelled, { once: true }); worker.addEventListener('message', message); worker.addEventListener('error', failed);
        timeout = setTimeout(() => { cleanup(); reject(Error('pitch-timeout')); }, 120000);
        worker.postMessage({ ...value, id: rid }, value.samples ? [value.samples.buffer] : []);
      });
      await call({ action: 'load' }); check(); this.stage = 'analyzing';
      const order = pitchChunkOrder(track.duration, centerSeconds); let done = 0;
      for (const index of order) {
        check(); const begin = index * 4, end = Math.min(track.duration, begin + 4), windowStart = begin - .5;
        const { samples, peak } = resamplePitchWindow(buffer, windowStart, end + .5);
        const result = peak < .0001 ? null : await call({ action: 'analyze', samples }); check();
        const first = Math.ceil(begin * PITCH_FRAME_RATE), last = Math.min(track.pitches.length, Math.ceil(end * PITCH_FRAME_RATE));
        for (let frame = first; frame < last; frame++) {
          const local = Math.round((frame / PITCH_FRAME_RATE - windowStart) * PITCH_FRAME_RATE);
          track.pitches[frame] = result?.pitches[local] ?? NaN; track.confidence[frame] = result?.confidence[local] ?? 0; track.ready[frame] = 1;
        }
        track.revision++; this.progress = ++done / order.length; this.changed();
        await new Promise(resolve => setTimeout(resolve, 12));
      }
      track.complete = true; updatePitchRange(track); track.revision++;
      this.cache.set(key, track, track.pitches.byteLength + track.confidence.byteLength + track.ready.byteLength);
      try { await this.write(key, track); } catch { check(); this.warning = 'cache'; }
    } catch (error) { if (error.name !== 'AbortError' && serial === this.serial) this.error = error.message; }
    finally { if (serial === this.serial) { this.worker?.terminate(); this.worker = null; this.busy = false; this.controller = null; this.changed(); } }
  }
}
