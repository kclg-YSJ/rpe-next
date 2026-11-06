/** A scoped transport clock. Nothing is installed in ordinary playback. */
export function installEditorFrameClock(audio, { onStop = () => {}, playing = true, playbackControls = false } = {}) {
  const revision = audio.loadRevision;
  const start = audio.time >= audio.duration ? 0 : audio.time;
  audio.pause();
  let time = start, requestedTime = null;
  const originals = new Map();
  const replace = (key, descriptor) => {
    originals.set(key, Object.getOwnPropertyDescriptor(audio, key));
    Object.defineProperty(audio, key, { configurable: true, ...descriptor });
  };
  replace('time', { get: () => time });
  replace('clockReady', { get: () => false }); // No real-time music or hit scheduling.
  replace('scheduleHorizon', { get: () => 0 });
  replace('update', { value() {} });
  replace('startSource', { value() {} });
  replace('startMedia', { value: async () => {} });
  replace('play', { value: async () => { if (playbackControls) audio.playing = true; } });
  replace('pause', { value: () => { if (playbackControls) audio.playing = false; else onStop(); } });
  replace('seek', { value: seconds => { if (Number.isFinite(seconds)) requestedTime = seconds; onStop(); } });
  for (const key of ['setRate', 'setPreservePitch']) {
    const original = audio[key];
    replace(key, { value: value => { onStop(); original.call(audio, value); } });
  }
  audio.position = start; audio.playing = playing;
  let restored = false;
  return { start, get time() { return time; }, set(seconds) { time = seconds; audio.position = seconds; },
    dispose() {
      if (restored) return; restored = true;
      for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(audio, key, descriptor); else delete audio[key];
      }
      audio.playing = false;
      if (audio.loadRevision === revision) audio.seek(requestedTime ?? time);
    }
  };
}
