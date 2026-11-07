// AudioAnalysis and AudioPitchView expose a timeline getter, but their row loops
// also read scale/judgementOffset directly. Supply the physical classic geometry
// only to those views; keep chart timing and the real timeline settings intact.
export function installAudioGeometry(api, state) {
  const analysis = api.editor.audioAnalysis;
  if (!analysis?.getTimeline) return;
  const adapters = new WeakMap();
  api.patch(analysis, 'getTimeline', previous => function(...args) {
    const timeline = previous.apply(this, args);
    if (!state.active || !timeline || timeline.noteView) return timeline;
    if (!adapters.has(timeline)) {
      const view = Object.create(timeline);
      Object.defineProperties(view, {
        scale: {get: () => timeline.scale * state.scale},
        judgementOffset: {get: () => timeline.viewHeight() - timeline.baseline()}
      });
      // Bound mappings already include classic scaling. Binding prevents the
      // effective scale above from being applied to those functions twice.
      for (const key of ['vertical','verticalForLine','baseline','timeAt','beatAt','viewHeight','getSession']) view[key] = timeline[key].bind(timeline);
      adapters.set(timeline, view);
    }
    return adapters.get(timeline);
  });
}
