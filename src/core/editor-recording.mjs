// Output time is a frame count, never elapsed wall time.
export function validEditorRenderFps(value) { return Number.isInteger(value) && value >= 1 && value <= 240; }
export function editorRecordingPlan({ start, end, rate = 1, fps = 60 }) {
  if (!validEditorRenderFps(fps) || !Number.isFinite(rate) || rate <= 0 || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw RangeError('Invalid editor recording range');
  const frames = Math.ceil((end - start) / rate * fps - 1e-8);
  if (frames > 12 * 3600 * fps) throw RangeError('Editor recording exceeds 12 hours');
  return { frames, fps, start, end, rate, time: index => Math.min(end, start + index * rate / fps), duration: count => count / fps };
}
