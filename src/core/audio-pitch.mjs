export const PITCH_VERSION = 'basic-pitch-1.0.1-dominant-v2';
export const PITCH_RATE = 22050;
export const PITCH_FRAME_RATE = PITCH_RATE / 256;
export const PITCH_MAX_SECONDS = 1800;
const names = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
export const pitchFrequency = midi => 440 * 2 ** ((midi - 69) / 12);
export function pitchName(midi) { const note = Math.round(midi); return `${names[((note % 12) + 12) % 12]}${Math.floor(note / 12) - 1}`; }

// Use polyphonic note activations to choose one voice, then the finer contour
// bins to retain vibrato and slides. Silence and uncertain frames remain gaps.
export function dominantPitches(frames, contours) {
  const pitches = new Float32Array(frames.length).fill(NaN), confidence = new Uint8Array(frames.length);
  let previous = NaN;
  for (let f = 0; f < frames.length; f++) {
    const notes = frames[f]; let winner = -1, score = 0, peak = 0;
    for (let i = 0; i < notes.length; i++) {
      const value = Number.isFinite(notes[i]) ? notes[i] : 0; peak = Math.max(peak, value);
      const continuity = Number.isFinite(previous) && Math.abs(i + 21 - previous) < 1.5 ? 1.08 : 1;
      if (value * continuity > score) { score = value * continuity; winner = i; }
    }
    if (winner < 0 || peak < .05) { previous = NaN; continue; }
    let midi = winner + 21; const contour = contours?.[f];
    if (contour) {
      const center = winner * 3; let bin = center, value = 0;
      for (let i = Math.max(0, center - 2); i <= Math.min(contour.length - 1, center + 2); i++) if (contour[i] > value) { bin = i; value = contour[i]; }
      if (value > .1) {
        const a = contour[bin - 1] ?? value, b = contour[bin + 1] ?? value, curvature = a - 2 * value + b;
        const offset = curvature < -1e-6 ? Math.max(-.5, Math.min(.5, .5 * (a - b) / curvature)) : 0;
        midi = 21 + (bin + offset) / 3;
      }
    }
    pitches[f] = midi; confidence[f] = Math.floor(Math.min(1, peak) * 255);
    // Keep the previous default's continuity decisions, but retain quieter
    // candidates so display thresholds can change without another inference.
    previous = peak >= .2 ? midi : NaN;
  }
  // Remove isolated one-frame octave errors, without averaging across real gaps.
  for (let i = 1; i + 1 < pitches.length; i++) if (confidence[i - 1] >= 51 && confidence[i] >= 51 && confidence[i + 1] >= 51 && Number.isFinite(pitches[i - 1]) && Number.isFinite(pitches[i]) && Number.isFinite(pitches[i + 1]) && Math.abs(pitches[i - 1] - pitches[i + 1]) < .6 && Math.abs(pitches[i] - pitches[i - 1]) > 7) pitches[i] = (pitches[i - 1] + pitches[i + 1]) / 2;
  return { pitches, confidence };
}

export function createPitchTrack(duration) {
  if (!(duration > 0) || duration > PITCH_MAX_SECONDS) throw Error('pitch-duration');
  const count = Math.ceil(duration * PITCH_FRAME_RATE);
  return { duration, frameRate: PITCH_FRAME_RATE, pitches: new Float32Array(count).fill(NaN), confidence: new Uint8Array(count), ready: new Uint8Array(count), revision: 0, complete: false, low: 48, high: 84 };
}
export function updatePitchRange(track) {
  let low = Infinity, high = -Infinity;
  for (let i = 0; i < track.pitches.length; i++) if (Number.isFinite(track.pitches[i]) && track.confidence[i] >= 51) { low = Math.min(low, track.pitches[i]); high = Math.max(high, track.pitches[i]); }
  if (!Number.isFinite(low)) return;
  const middle = (low + high) / 2, span = Math.max(24, high - low + 6);
  track.low = Math.max(18, Math.floor(middle - span / 2)); track.high = Math.min(111, Math.ceil(middle + span / 2));
}

export function encodePitchTrack(track) {
  const count = track.pitches.length, bytes = new Uint8Array(32 + count * 5), header = new DataView(bytes.buffer);
  bytes.set([82, 80, 73, 84, 67, 72, 1]); header.setUint32(8, count, true); header.setFloat64(12, track.duration, true); header.setFloat64(20, track.frameRate, true);
  for (let i = 0; i < count; i++) header.setFloat32(32 + i * 4, track.pitches[i], true);
  bytes.set(track.confidence, 32 + count * 4); return bytes;
}
export function decodePitchTrack(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input), header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 32 || ![82, 80, 73, 84, 67, 72, 1].every((v, i) => bytes[i] === v)) throw Error('pitch-cache');
  const count = header.getUint32(8, true), track = createPitchTrack(header.getFloat64(12, true));
  if (count !== track.pitches.length || bytes.length !== 32 + count * 5 || header.getFloat64(20, true) !== PITCH_FRAME_RATE) throw Error('pitch-cache');
  for (let i = 0; i < count; i++) { const value = header.getFloat32(32 + i * 4, true); if (!Number.isNaN(value) && (!Number.isFinite(value) || value < 18 || value > 111)) throw Error('pitch-cache'); track.pitches[i] = value; }
  track.confidence.set(bytes.subarray(32 + count * 4)); track.ready.fill(1); track.complete = true; updatePitchRange(track); return track;
}

export function pitchChunkOrder(duration, centerSeconds, size = 4) {
  const count = Math.ceil(duration / size), center = Math.max(0, Math.min(count - 1, Math.floor(centerSeconds / size)));
  return Array.from({ length: count }, (_, i) => i).sort((a, b) => Math.abs(a - center) - Math.abs(b - center) || a - b);
}

// Bounded copies only: no full-song resampled or mono AudioBuffer is retained.
export function resamplePitchWindow(buffer, startSeconds, endSeconds) {
  const count = Math.max(1, Math.ceil((endSeconds - startSeconds) * PITCH_RATE)), output = new Float32Array(count);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  let peak = 0;
  for (let i = 0; i < count; i++) {
    const at = (startSeconds + i / PITCH_RATE) * buffer.sampleRate, first = Math.floor(at), fraction = at - first;
    if (first < 0 || first >= buffer.length) continue;
    let sum = 0; for (const data of channels) sum += data[first] * (1 - fraction) + (data[first + 1] ?? 0) * fraction;
    const value = sum / channels.length; output[i] = value; peak = Math.max(peak, Math.abs(value));
  }
  return { samples: output, peak };
}

export async function pitchWaveform(buffer, signal) {
  const waveform = new Float32Array(32768), channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i)); let maximum = 0, sliceStart = performance.now();
  for (let bin = 0; bin < waveform.length; bin++) {
    const start = Math.floor(bin * buffer.length / waveform.length), end = Math.min(buffer.length, Math.max(start + 1, Math.floor((bin + 1) * buffer.length / waveform.length))); let peak = 0;
    for (let i = start; i < end; i++) { let value = 0; for (const samples of channels) value += samples[i]; peak = Math.max(peak, Math.abs(value / channels.length)); }
    waveform[bin] = peak; maximum = Math.max(maximum, peak);
    if ((bin & 255) === 255) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      if (performance.now() - sliceStart >= 6) { await new Promise(resolve => setTimeout(resolve, 0)); sliceStart = performance.now(); }
    }
  }
  if (maximum > 0) for (let i = 0; i < waveform.length; i++) waveform[i] = Math.pow(waveform[i] / maximum, 1.35);
  return { waveform, duration: buffer.duration };
}
