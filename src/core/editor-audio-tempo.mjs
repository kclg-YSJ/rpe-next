import { mixRenderPcm } from './render-audio-mix.mjs';

// Bounded WSOLA for preserve-pitch playback. Stereo channels share the same
// correlation offset. Only the overlap and one requested PCM chunk are retained.
export class EditorTempoPcm {
  constructor({ sampleRate, rate, start }) {
    this.sampleRate = sampleRate; this.rate = rate; this.start = start;
    this.hop = Math.round(sampleRate * .01); this.size = this.hop * 4;
    this.search = Math.round(sampleRate * .012);
    this.pending = [new Float32Array(this.size), new Float32Array(this.size)];
    this.weights = new Float32Array(this.size); this.output = 0; this.grain = 0;
    this.window = Float32Array.from({ length: this.size }, (_, i) => .5 - .5 * Math.cos(2 * Math.PI * (i + .5) / this.size));
  }
  range(relative, frames) {
    const start = this.start + relative * this.rate - .08;
    const end = this.start + (relative + frames / this.sampleRate) * this.rate + .12;
    return { start, end, frames: Math.ceil((end - start) * this.sampleRate) };
  }
  read(input, inputStart, frames) {
    const result = new Float32Array(frames * 2), inputFrames = input.length / 2;
    const sample = (p, channel = 0) => {
      const i = Math.floor(p), f = p - i;
      const get = n => n < 0 || n >= inputFrames ? 0 : input[channel * inputFrames + n];
      return get(i) * (1 - f) + get(i + 1) * f;
    };
    for (let written = 0; written < frames;) {
      if (this.output === this.grain) {
        const expected = (this.start - inputStart) * this.sampleRate + this.grain * this.rate;
        let best = expected, score = -Infinity;
        if (this.grain > 0) {
          const compare = candidate => {
            let dot = 0, a2 = 1e-12, b2 = 1e-12;
            for (let i = 0; i < this.size - this.hop; i += 24) {
              for (let c = 0; c < 2; c++) {
                const a = this.weights[i] > 1e-9 ? this.pending[c][i] / this.weights[i] : 0;
                const b = sample(candidate + i, c); dot += a * b; a2 += a * a; b2 += b * b;
              }
            }
            return dot / Math.sqrt(a2 * b2) - Math.abs(candidate - expected) / this.search * .001;
          };
          for (let delta = -this.search; delta <= this.search; delta += 12) { const candidate = expected + delta, value = compare(candidate); if (value > score) { score = value; best = candidate; } }
          const coarse = best;
          for (let delta = -11; delta <= 11; delta++) { const candidate = coarse + delta, value = compare(candidate); if (value > score) { score = value; best = candidate; } }
        }
        for (let i = 0; i < this.size; i++) {
          const w = this.window[i]; this.weights[i] += w;
          for (let c = 0; c < 2; c++) this.pending[c][i] += sample(best + i, c) * w;
        }
        this.grain += this.hop;
      }
      const count = Math.min(frames - written, this.grain - this.output);
      for (let c = 0; c < 2; c++) for (let i = 0; i < count; i++) result[c * frames + written + i] = this.weights[i] > 1e-9 ? this.pending[c][i] / this.weights[i] : 0;
      for (const array of [...this.pending, this.weights]) { array.copyWithin(0, count); array.fill(0, array.length - count); }
      this.output += count; written += count;
    }
    return result;
  }
}

export function resampleEditorMusic({ music, start, frames, sampleRate, rate, volume = 1 }) {
  if (rate === 1) return mixRenderPcm({ music, start, frames, sampleRate, musicVolume: volume });
  const data = new Float32Array(frames * 2);
  for (const { buffer, timestamp } of music) for (let channel = 0; channel < 2; channel++) {
    const source = buffer.getChannelData(Math.min(channel, buffer.numberOfChannels - 1));
    const first = Math.max(0, Math.ceil((timestamp - start) / rate * sampleRate - 1e-7));
    const stop = Math.min(frames, Math.ceil((timestamp + buffer.duration - start) / rate * sampleRate - 1e-7));
    for (let f = first; f < stop; f++) {
      const p = (start + f / sampleRate * rate - timestamp) * buffer.sampleRate, i = Math.max(0, Math.floor(p)), fraction = p - i;
      if (i < source.length) data[channel * frames + f] += (source[i] * (1 - fraction) + (source[i + 1] ?? source[i]) * fraction) * volume;
    }
  }
  return data;
}
