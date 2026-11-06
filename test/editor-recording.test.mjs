import test from 'node:test';
import assert from 'node:assert/strict';
import { editorRecordingPlan, validEditorRenderFps } from '../src/core/editor-recording.mjs';
import { installEditorFrameClock } from '../src/application/editor-frame-clock.mjs';
import { DEFAULT_HOTKEYS, shortcutAction } from '../src/core/preferences.mjs';
import { normalizeEditorPreferences } from '../src/platform/editor-preferences.mjs';
import { EditorTempoPcm, resampleEditorMusic } from '../src/core/editor-audio-tempo.mjs';
import { createChart, createNote } from '../src/core/chart.mjs';
import { createEditorRecordingAudio } from '../src/application/editor-recording-audio.mjs';
import { LargeChartWorkspace } from '../src/ui/large-chart-workspace.mjs';

test('editor recording frame times do not depend on processing speed', () => {
  const plan = editorRecordingPlan({ start: -.25, end: 1.26, rate: .5, fps: 60 });
  assert.equal(plan.frames, 182);
  assert.equal(plan.time(60), .25);
  assert.equal(plan.time(182), 1.26);
  assert.equal(plan.duration(7), 7 / 60);
  for (const fps of [1, 24, 60, 120, 240]) assert.ok(validEditorRenderFps(fps));
  for (const fps of [0, -1, 241, 29.97, Infinity, '60']) assert.equal(validEditorRenderFps(fps), false);
  assert.throws(() => editorRecordingPlan({ start: 0, end: Infinity }));
  assert.throws(() => editorRecordingPlan({ start: 0, end: 50000 }));
});

test('recording shortcut is configurable and editor FPS is a separate persistent preference', () => {
  const event = { key: 'U', code: 'KeyU', ctrlKey: true, shiftKey: true, altKey: false };
  assert.equal(shortcutAction(event, { hotkeys: DEFAULT_HOTKEYS }), 'EditorRecording');
  assert.equal(shortcutAction({ ...event, ctrlKey: false, shiftKey: false }, { hotkeys: DEFAULT_HOTKEYS }), 'JumpView_HOLD');
  assert.deepEqual(normalizeEditorPreferences({ fpsLimit: 120, editorRenderFps: 24 }), { fpsLimit: 120, editorRenderFps: 24 });
  assert.equal(normalizeEditorPreferences({ editorRenderFps: 0 }).editorRenderFps, undefined);
});

function transport(time = 2) {
  return { position: time, playing: true, duration: 10, loadRevision: 1,
    get time() { return this.position; }, get clockReady() { return this.playing; },
    pause() { this.playing = false; }, seek(time) { this.position = time; }, update() {}, async play() { this.playing = true; },
    setRate(value) { this.rate = value; this.seek(this.time); }, setPreservePitch(value) { this.preservePitch = value; this.seek(this.time); }
  };
}
test('scoped frame clock disables real scheduling, requests a stop on seek and restores every transport property', () => {
  const audio = transport(), keys = Object.getOwnPropertyDescriptors(audio); let stops = 0;
  const clock = installEditorFrameClock(audio, { onStop: () => stops++ });
  assert.equal(audio.playing, true); assert.equal(audio.clockReady, false);
  clock.set(3.75); assert.equal(audio.time, 3.75);
  audio.seek(7); assert.equal(stops, 1); assert.equal(audio.time, 3.75);
  clock.dispose(); clock.dispose();
  assert.equal(audio.time, 7); assert.equal(audio.playing, false);
  for (const key of ['time', 'pause', 'seek', 'play', 'update', 'clockReady']) assert.deepEqual(Object.getOwnPropertyDescriptor(audio, key), keys[key]);
  assert.equal(Object.hasOwn(audio, 'scheduleHorizon'), false);
});
test('clock restarts at zero when recording from the end and does not seek a replacement song', () => {
  const audio = transport(10), clock = installEditorFrameClock(audio);
  assert.equal(clock.start, 0); clock.set(4); audio.loadRevision++; audio.position = 0;
  clock.dispose(); assert.equal(audio.time, 0);
});

function tone(sampleRate = 12000, seconds = 4, hz = 220) {
  const data = Float32Array.from({ length: sampleRate * seconds }, (_, i) => Math.sin(i / sampleRate * hz * Math.PI * 2) * .7);
  return { sampleRate, duration: seconds, numberOfChannels: 1, length: data.length, getChannelData: () => data };
}
test('music resampling honors the playback clock and unity rate leaves samples unchanged', () => {
  const buffer = tone(), music = [{ buffer, timestamp: 0 }], sampleRate = buffer.sampleRate, frames = 1000;
  const normal = resampleEditorMusic({ music, start: 0, frames, sampleRate, rate: 1 });
  assert.deepEqual(normal.slice(0, frames), buffer.getChannelData().slice(0, frames));
  const fast = resampleEditorMusic({ music, start: 0, frames, sampleRate, rate: 2 });
  for (let i = 0; i < frames; i++) assert.ok(Math.abs(fast[i] - buffer.getChannelData()[i * 2]) < 1e-6);
});
test('bounded preserve-pitch tempo conversion retains pitch and continuity over arbitrary chunk boundaries', () => {
  const sampleRate = 12000, buffer = tone(sampleRate), music = [{ buffer, timestamp: 0 }];
  for (const rate of [.5, .75, 1.5, 2]) {
    const stretch = new EditorTempoPcm({ sampleRate, rate, start: .1 }); let relative = 0, previous = 0, crossings = 0, maximumJump = 0;
    for (const frames of [997, 1371, 4000, 2132, 3500]) {
      const range = stretch.range(relative, frames);
      const input = resampleEditorMusic({ music, start: range.start, frames: range.frames, sampleRate, rate: 1 });
      const data = stretch.read(input, range.start, frames);
      for (let i = 0; i < frames; i++) { if (previous < 0 && data[i] >= 0) crossings++; maximumJump = Math.max(maximumJump, Math.abs(data[i] - previous)); previous = data[i]; assert.ok(Number.isFinite(data[i])); }
      relative += frames / sampleRate;
    }
    assert.ok(Math.abs(crossings / relative - 220) < 5, `${rate}: ${crossings / relative}`);
    assert.ok(maximumJump < .25, `${rate}: discontinuity ${maximumJump}`);
    assert.equal(stretch.pending[0].length, sampleRate * .04);
  }
});

test('editor recording uses the selected stem mix, music clock and music volume', async () => {
  const chart = createChart(); chart.META.offset = 125;
  const buffer = tone(48000), editor = { hasDocument: true, home: false, session: { chart }, chart, assets: new Map(), chartName: 'test',
    audio: { buffer: tone(48000, 2, 110), playbackBuffer: buffer, volume: .5, preservePitch: false },
    hitSounds: { enabled: false, delays: {}, volume: 1 } };
  const track = await createEditorRecordingAudio(editor, { start: .2, rate: 2 });
  try {
    const data = await track.read(0, 4800);
    for (let i = 0; i < 4800; i++) assert.ok(Math.abs(data[i] - buffer.getChannelData()[9600 + i * 2] * .5) < 1e-5);
  } finally { track.dispose(); }
});

test('recorded hits keep skin priority, offset and delay, original pitch, tails across audio chunks', async () => {
  const chart = createChart(); chart.META.offset = 50; chart.judgeLineList[0].notes = [createNote(1, .4, 0)];
  const hit = { ...tone(48000, .04), getChannelData: () => new Float32Array(1920).fill(.75) };
  const editor = { hasDocument: true, session: { chart }, chart, assets: new Map(), chartName: 'test', audio: { volume: 0, preservePitch: false },
    hitSounds: { enabled: true, delays: { tap: 25, drag: 0, flick: 0 }, volume: .4, buffers: new Map(['tap', 'drag', 'flick'].map(name => [name, tone(48000, .04)])), skinBuffers: new Map([['tap', hit]]), async prepare() {} } };
  const track = await createEditorRecordingAudio(editor, { start: .2, rate: 2 });
  try {
    const first = await track.read(0, 2400), second = await track.read(.05, 2400);
    // Hit music time = .2 + .05 + .025, relative time = (.275 - .2)/2.
    assert.equal(first[1799], 0); assert.ok(Math.abs(first[1800] - .3) < 1e-6);
    assert.ok(Math.abs(second[1319] - .3) < 1e-6); assert.equal(second[1320], 0);
  } finally { track.dispose(); }
});

test('large-chart recording waits for bounded editing and preview data without invoking playback buffering', async () => {
  const calls = []; let covered = false, loaded = false;
  const fake = { previews: [{ aspectRatio: 1.5, viewDivisor: 1, visible: true, showHitEffects: true }],
    document: { pending: Promise.resolve(), async ensurePage(range) { assert.equal(range.lines.length, 1); await Promise.resolve(); calls.push('page'); covered = true; }, covers() { return covered; } },
    range: () => ({ start: 0, end: 2, lines: [3] }),
    view: { set() { loaded = false; }, contains() { return loaded; } },
    async readPreview(seconds, options) { assert.equal(seconds, .75); assert.equal(options.recording, true); await Promise.resolve(); calls.push('preview'); loaded = true; }
  };
  await LargeChartWorkspace.prototype.prepareRecordingFrame.call(fake, .75);
  assert.deepEqual(calls, ['page', 'preview']); assert.ok(covered && loaded);
  fake.document.covers = () => false;
  await assert.rejects(LargeChartWorkspace.prototype.prepareRecordingFrame.call(fake, .75), /编辑页/);
});
