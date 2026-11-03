export const PITCH_DISPLAY_DEFAULTS = Object.freeze({ followWaveform: false, threshold: .2, opacity: .6, lineWidth: 4, showGrid: true });
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export function normalizePitchDisplay(value = {}) {
  value = value && typeof value === 'object' ? value : {};
  const result = { ...PITCH_DISPLAY_DEFAULTS, position: value.position === 'events' ? 'events' : 'inline', low: null, high: null };
  for (const key of ['followWaveform', 'showGrid']) if (typeof value[key] === 'boolean') result[key] = value[key];
  for (const [key, min, max] of [['threshold', .05, 1], ['opacity', 0, 1], ['lineWidth', 1, 10]]) if (Number.isFinite(value[key])) result[key] = clamp(value[key], min, max);
  if (Number.isFinite(value.low) && Number.isFinite(value.high) && value.low >= 18 && value.high <= 111 && value.high - value.low >= 1) { result.low = Math.round(value.low); result.high = Math.round(value.high); }
  return result;
}
export function pitchDisplayRange(track, options) {
  return { low: options.low ?? (track?.complete ? track.low : 18), high: options.high ?? (track?.complete ? track.high : 111) };
}
export function pitchFrameVisible(track, index, threshold, low, high) {
  const pitch = track.pitches[index];
  return Boolean(track.ready[index] && Number.isFinite(pitch) && pitch >= low && pitch <= high && track.confidence[index] >= Math.ceil(threshold * 255));
}
export const pitchDisplayOpacity = (options, amplitude = 1) => options.opacity * (options.followWaveform ? amplitude : 1);
