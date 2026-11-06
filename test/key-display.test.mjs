import test from 'node:test';
import assert from 'node:assert/strict';
import { keyDisplayLabel, KeyDisplayState } from '../src/core/key-display.mjs';
import { normalizeEditorPreferences } from '../src/platform/editor-preferences.mjs';
import { DEFAULT_EDITOR_PREFERENCES } from '../src/core/default-settings.mjs';
import { DEFAULT_HOTKEYS, shortcutAction } from '../src/core/preferences.mjs';
import { KeyDisplayTool } from '../src/ui/key-display-tool.mjs';
import { RecordingPlaybackAudio } from '../src/application/editor-recording-playback-audio.mjs';
import { installEditorFrameClock } from '../src/application/editor-frame-clock.mjs';

test('key display is off by default, persists independently and has a separate customizable shortcut', () => {
  assert.equal(DEFAULT_EDITOR_PREFERENCES.keyDisplay, false);
  assert.deepEqual(normalizeEditorPreferences({ keyDisplay: true, editorRenderAutoPlay: false, editorRenderMode: 'editing', editorRenderMouse: true }), { keyDisplay: true, editorRenderAutoPlay: false });
  const event = { key: 'K', code: 'KeyK', ctrlKey: true, shiftKey: true };
  assert.equal(shortcutAction(event, { hotkeys: DEFAULT_HOTKEYS }), 'KeyDisplay');
  assert.equal(shortcutAction({ ...event, key: 'L', code: 'KeyL' }, { hotkeys: { ...DEFAULT_HOTKEYS, KeyDisplay: 'LEFTCTRL&LEFTSHIFT&L' } }), 'KeyDisplay');
});
test('disabled key display creates no DOM, module load, callback, queue or animation', () => {
  const tool = new KeyDisplayTool(error => { throw error; });
  for (let i = 0; i < 100; i++) tool.input({ type: 'keydown', key: 'A' });
  tool.set(false); tool.beginRender(100); tool.draw(200); tool.endRender();
  assert.equal(tool.panel, null); assert.equal(tool.loading, null); assert.equal(tool.clock, null); assert.equal(tool.enabled, false);
});
test('key labels preserve shortcuts and navigation, exclude private inputs and unfinished IME', () => {
  assert.equal(keyDisplayLabel({ key: 'z', code: 'KeyZ', ctrlKey: true, shiftKey: true }), 'Ctrl + Shift + Z');
  assert.equal(keyDisplayLabel({ key: ' ', code: 'Space' }), 'Space');
  assert.equal(keyDisplayLabel({ key: 'ArrowLeft' }), '←');
  assert.equal(keyDisplayLabel({ key: 'Process', isComposing: true }), null);
  assert.equal(keyDisplayLabel({ key: 'a', target: { closest: () => ({}) } }), null);
});
test('keycaps merge repeats, float upward, fade with distance, remain bounded and expire', () => {
  const state = new KeyDisplayState(); state.add('A', 0); state.add('A', .1);
  assert.equal(state.rows(.2)[0].count, 2);
  assert.ok(state.rows(.9)[0].rise > state.rows(.2)[0].rise);
  for (let i = 0; i < 20; i++) state.add(String(i), .2);
  assert.equal(state.keys.length, 12); assert.equal(state.rows(.3)[0].alpha, 0);
  state.shift(5); assert.equal(state.rows(5.3).length, 12); assert.equal(state.rows(7.2).length, 0);
});
test('playback recording can start paused and use play/pause without native audio', () => {
  let stops = 0;
  const audio = { duration: 4, position: 1, playing: false, loadRevision: 1, get time() { return this.position; }, pause() { this.playing = false; }, seek(time) { this.position = time; }, play() { throw Error('native playback must not run'); } };
  const clock = installEditorFrameClock(audio, { playing: false, playbackControls: true, onStop: () => stops++ });
  assert.equal(audio.playing, false); audio.play(); assert.equal(audio.playing, true); audio.pause(); assert.equal(audio.playing, false); assert.equal(stops, 0);
  audio.seek(2); assert.equal(stops, 1); clock.dispose(); assert.equal(audio.time, 2);
});
test('fixed output audio is silent during pauses and resumes at the same music position', async () => {
  const reads = [], source = { async read(at, frames) { reads.push({ at, frames }); return new Float32Array(frames * 2).fill(.5); } };
  const track = new RecordingPlaybackAudio(source, { start: 2, rate: 2, fps: 10, sampleRate: 100 });
  track.frame(0, 2, false); track.frame(2, 2, true); track.frame(5, 2.6, false); track.frame(7, 2.6, true);
  const data = await track.read(0, 100);
  assert.deepEqual([...data.slice(0, 20)], new Array(20).fill(0)); assert.deepEqual([...data.slice(20, 50)], new Array(30).fill(.5)); assert.deepEqual([...data.slice(50, 70)], new Array(20).fill(0));
  assert.ok(Math.abs(reads[1].at - .3) < 1e-8);
});
