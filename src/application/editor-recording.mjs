import { editorRecordingPlan } from '../core/editor-recording.mjs';
import { installEditorFrameClock } from './editor-frame-clock.mjs';
import { RecordingPlaybackAudio } from './editor-recording-playback-audio.mjs';
import { createEditorRecordingAudio } from './editor-recording-audio.mjs';
import { createEditorCapture } from '../platform/editor-capture.mjs';
import { createVideoOutput } from '../platform/video-output.mjs';
import { createVideoEncodingSession } from '../platform/video-encoder.mjs';
import { editorRecordingEncoding, editorRecordingName } from '../platform/editor-recording-encoding.mjs';
import { fileMime } from '../core/render-settings.mjs';
import { t } from '../i18n.mjs';

// CSS animations must follow output time too, rather than the encoder's speed.
class AnimationClock {
  constructor() { this.items = new Map(); }
  set(seconds) {
    const current = new Set(document.getAnimations());
    for (const animation of this.items.keys()) if (!current.has(animation)) this.items.delete(animation);
    for (const animation of current) {
      if (!this.items.has(animation)) {
        if (animation.playState !== 'running') continue;
        this.items.set(animation, { time: Number(animation.currentTime) || 0, rate: animation.playbackRate, wall: performance.now(), at: seconds });
        animation.pause();
      }
      const saved = this.items.get(animation);
      if (saved) { try { animation.currentTime = saved.time + (seconds - saved.at) * 1000 * saved.rate; } catch { /* detached animation */ } }
    }
  }
  dispose() {
    for (const [animation, saved] of this.items) if (animation.playState !== 'idle') {
      try { animation.currentTime = saved.time + (performance.now() - saved.wall) * saved.rate; animation.play(); } catch { /* detached animation */ }
    }
    this.items.clear();
  }
}

export async function recordEditor(editor, hooks, task) {
  if (!editor.hasDocument || editor.home) throw Error(t('render.openChart'));
  if (globalThis.rpenEditorCapture?.version !== 1) throw Error(t('editor-recording.desktopRequired'));
  const audio = editor.audio, source = editor.chart, disk = editor.session.largeDocument, diskRevision = disk?.revision, loadRevision = audio.loadRevision;
  const wasPlaying = audio.playing, rate = audio.rate, fps = editor.editorPreferences.editorRenderFps ?? 60;
  const audioState = () => JSON.stringify([audio.volume, audio.rate, audio.preservePitch, editor.hitSounds.enabled, editor.hitSounds.volume, editor.hitSounds.delays, editor.hitSounds.onlyCurrentLine, editor.hitSounds.onlyCurrentLine ? editor.session.lineIndex : null]);
  const initialAudioState = audioState(), musicBuffer = audio.playbackBuffer, soundPack = editor.hitSounds.skinBuffers;
  const audioChanged = () => audioState() !== initialAudioState || audio.playbackBuffer !== musicBuffer || editor.hitSounds.skinBuffers !== soundPack;
  const start = audio.time >= audio.duration ? 0 : audio.time;
  const plan = editorRecordingPlan({ start, end: audio.duration, rate, fps });
  editor.playback.pause();
  const indicator = hooks.createIndicator(task), controller = new AbortController(), signal = controller.signal;
  let capture, encoder, output, sound, clock, animations, completed = false, warning;
  const valid = () => editor.hasDocument && !editor.home && (disk ? editor.session.largeDocument === disk && !disk.disposed && disk.revision === diskRevision : editor.chart === source) && audio.loadRevision === loadRevision;
  const pagehide = () => controller.abort();
  window.addEventListener('pagehide', pagehide, { once: true });
  try {
    indicator.update('preparing');
    capture = await createEditorCapture();
    let first = await capture.frame();
    const width = first.width, height = first.height; first.close(); first = null;
    const settings = await editorRecordingEncoding(width, height, fps);
    if (task.stopped || !valid()) return;
    const title = editorRecordingName(editor);
    output = await createVideoOutput(`${title} - ${t('editor-recording.fileName')}.${settings.format}`, fileMime(settings.format), { signal });
    if (!output || task.stopped || !valid()) return;
    sound = await createEditorRecordingAudio(editor, { start, rate, sampleRate: settings.sampleRate, signal });
    if (task.stopped || !valid()) return;
    const audioTimeline = new RecordingPlaybackAudio(sound, { start, rate, fps, sampleRate: settings.sampleRate });
    encoder = await createVideoEncodingSession({ sampleFrames: true, audioTrack: audioTimeline, settings, stream: output, signal });
    if (task.stopped || !valid()) return;
    clock = installEditorFrameClock(audio, { onStop: () => task.stop(), playing: editor.editorPreferences.editorRenderAutoPlay !== false || wasPlaying, playbackControls: true });
    const timestamp = performance.now();
    clock.set(start); task.capturing = true; hooks.begin?.(start, timestamp);
    animations = new AnimationClock();
    for (let index = 0; index < 43200 * fps && !task.stopped; index++) {
      if (signal.aborted) throw signal.reason;
      if (!valid()) { warning = t('editor-recording.projectChanged'); break; }
      if (audioChanged()) { warning = t('editor-recording.audioChanged'); break; }
      const frameTime = clock.time, framePlaying = audio.playing;
      audioTimeline.frame(index, frameTime, framePlaying);
      indicator.update('recording', index, fps);
      // Draw once with the frame clock, then let Chromium composite the DOM,
      // canvases and WebGL surfaces before capturing the client-area pixels.
      await hooks.prepareFrame?.();
      if (task.stopped || !valid()) break;
      let fence;
      await new Promise((resolve, reject) => requestAnimationFrame(() => {
        try { hooks.drawFrame(timestamp + index * 1000 / fps); animations.set(index / fps); fence = capture.supportsFence ? indicator.fence(index) : null; setTimeout(resolve, 0); } catch (error) { reject(error); }
      }));
      if (!fence) await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const image = await capture.frame(fence);
      try {
        if (image.width !== width || image.height !== height) { warning = t('editor-recording.resized'); break; }
        await encoder.add(image);
      } finally { image.close(); }
      clock.set(Math.min(audio.duration, frameTime + (framePlaying ? rate / fps : 0)));
      if (framePlaying && clock.time >= audio.duration - 1e-9) break;
    }
    if (!encoder.frames) return;
    indicator.update('finishing');
    const stats = await encoder.finish(), saved = await output.commit(); completed = true;
    task.result = { ...stats, ...saved, fps, width, height };
    hooks.showResult(task.result);
    if (warning) editor.notify(warning, 'warning', 7000);
  } finally {
    window.removeEventListener('pagehide', pagehide);
    animations?.dispose(); clock?.dispose(); task.capturing = false;
    indicator.dispose();
    if (!completed) { await encoder?.abort().catch(() => {}); await output?.abort().catch(() => {}); }
    sound?.dispose(); await capture?.dispose().catch(() => {});
    hooks.end?.(); editor.invalidate();
    // A dismissed save dialog leaves the editor exactly as it was.
    if (!clock && valid() && wasPlaying) await editor.playback.toggle(editor.chart);
  }
}
