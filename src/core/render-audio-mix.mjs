// Bounded planar PCM. Hits use chart seconds; offset shifts only the music.
export function mixRenderPcm({ start, frames, sampleRate, music = [], hits = [], hitBuffers, musicVolume = 1, hitVolume = 1, offset = 0, target }) {
  const data = target ?? new Float32Array(frames * 2);
  const end = start + frames / sampleRate;
  const add = (buffer, at, gain) => {
    if (!buffer || !gain) return;
    const begin = Math.max(0, Math.ceil((at - start) * sampleRate - 1e-7));
    const stop = Math.min(frames, Math.ceil((at + buffer.duration - start) * sampleRate - 1e-7));
    if (stop <= begin) return;
    const ratio = buffer.sampleRate / sampleRate;
    for (let channel = 0; channel < 2; channel++) {
      const source = buffer.getChannelData(Math.min(channel, buffer.numberOfChannels - 1));
      for (let frame = begin; frame < stop; frame++) {
        const p = (start - at) * buffer.sampleRate + frame * ratio;
        const index = Math.max(0, Math.floor(p)), fraction = Math.max(0, p - index);
        if (index < source.length) data[channel * frames + frame] += (source[index] * (1 - fraction) + (source[index + 1] ?? source[index]) * fraction) * gain;
      }
    }
  };
  for (const piece of music) add(piece.buffer, piece.timestamp - offset, musicVolume);
  for (const hit of hits) { const buffer = hitBuffers.get(hit.sound); if (buffer && hit.time < end) add(buffer, hit.time, hitVolume * (hit.count ?? 1)); }
  return data;
}
