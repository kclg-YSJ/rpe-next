// Maps fixed output frames to played music time. Paused output is silent, and
// manual play/pause does not shift the offline music or hit-sound samples.
export class RecordingPlaybackAudio {
  constructor(source, { start, rate, fps, sampleRate }) { Object.assign(this, { source, start, rate, fps, sampleRate }); this.segments = []; }
  frame(index, musicTime, playing) {
    const previous = this.segments.at(-1);
    const expected = previous ? previous.musicTime + (previous.playing ? (index - previous.index) / this.fps * this.rate : 0) : null;
    if (!previous || previous.playing !== playing || Math.abs(expected - musicTime) > 1e-6) this.segments.push({ index, musicTime, playing });
  }
  async read(relative, frames) {
    const startSample = Math.round(relative * this.sampleRate), result = new Float32Array(frames * 2);
    let done = 0;
    while (done < frames) {
      const sample = startSample + done;
      let segmentIndex = 0;
      while (segmentIndex + 1 < this.segments.length && Math.round(this.segments[segmentIndex + 1].index / this.fps * this.sampleRate) <= sample) segmentIndex++;
      const segment = this.segments[segmentIndex], next = this.segments[segmentIndex + 1];
      const first = Math.round((segment?.index ?? 0) / this.fps * this.sampleRate);
      const count = Math.min(frames - done, next ? Math.round(next.index / this.fps * this.sampleRate) - sample : frames - done);
      if (count <= 0) throw Error('Recording audio timeline is inconsistent');
      if (segment?.playing) {
        const played = (segment.musicTime - this.start) / this.rate + (sample - first) / this.sampleRate;
        const data = await this.source.read(played, count);
        for (let channel = 0; channel < 2; channel++) result.set(data.subarray(channel * count, (channel + 1) * count), channel * frames + done);
      }
      done += count;
    }
    return result;
  }
}
