import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, readdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dominantPitches, createPitchTrack, encodePitchTrack, decodePitchTrack, PITCH_FRAME_RATE, pitchChunkOrder, resamplePitchWindow, pitchName, pitchFrequency, pitchWaveform } from '../src/core/audio-pitch.mjs';
import { AudioPitch } from '../src/application/audio-pitch.mjs';
import { pitchAudioKey } from '../src/platform/audio-pitch-cache.mjs';
import { installAudioPitchCache } from '../desktop/audio-pitch-cache.mjs';
import { WaveformEnvelope } from '../src/core/waveform.mjs';
import { PITCH_DISPLAY_DEFAULTS, normalizePitchDisplay, pitchDisplayRange, pitchFrameVisible, pitchDisplayOpacity } from '../src/core/audio-pitch-display.mjs';

function buffer(duration = 8, frequency = 440, rate = 22050) {
  const samples = Float32Array.from({ length: Math.round(duration * rate) }, (_, i) => .3 * Math.sin(2 * Math.PI * frequency * i / rate));
  return { samples, duration, sampleRate: rate, numberOfChannels: 1, length: samples.length, getChannelData: () => samples };
}
test('dominant pitch selects a chord voice with fine contour and breaks at uncertain or silent frames', () => {
  const frame = new Array(88).fill(0); frame[48] = .8; frame[52] = .4;
  const contour = new Array(264).fill(0); contour[144] = .8; contour[145] = .3; contour[143] = .3;
  const result = dominantPitches([frame, frame, new Array(88).fill(0), frame], [contour, contour, contour, contour]);
  assert.deepEqual([...result.pitches], [69, 69, NaN, 69]); assert.ok(result.confidence[0] > 200);
  assert.equal(pitchName(69), 'A4'); assert.equal(pitchFrequency(69), 440);
});

test('显示设置默认不跟随波形，音域兼容旧偏好并接受窄于一个八度的范围', () => {
  assert.equal(PITCH_DISPLAY_DEFAULTS.followWaveform, false); assert.equal(PITCH_DISPLAY_DEFAULTS.threshold, .2);
  const original = normalizePitchDisplay({ position: 'events', low: 60, high: 84 }); assert.equal(original.low, 60); assert.equal(original.position, 'events'); assert.equal(original.followWaveform, false);
  assert.deepEqual(pitchDisplayRange({ complete: true, low: 45, high: 85 }, normalizePitchDisplay({ low: 60, high: 64 })), { low: 60, high: 64 });
  assert.deepEqual(pitchDisplayRange({ complete: true, low: 45, high: 85 }, normalizePitchDisplay({ low: 90, high: 20 })), { low: 45, high: 85 });
  const options = normalizePitchDisplay({ threshold: 9, opacity: -1, lineWidth: 20 }); assert.equal(options.threshold, 1); assert.equal(options.opacity, 0); assert.equal(options.lineWidth, 10);
  assert.equal(pitchDisplayOpacity(PITCH_DISPLAY_DEFAULTS, .02), .6); assert.equal(pitchDisplayOpacity({ ...PITCH_DISPLAY_DEFAULTS, followWaveform: true }, .02), .012);
});

test('绘制阈值提高只减少显示帧，默认保留原20%边界，降低时复用较弱候选', () => {
  const frames = [.049, .08, .199, .2, .55, .95].map(peak => { const frame = new Float32Array(88); frame[48] = peak; return frame; });
  const raw = dominantPitches(frames), track = { ...raw, ready: new Uint8Array(frames.length).fill(1) };
  const visible = threshold => frames.map((_, i) => pitchFrameVisible(track, i, threshold, 18, 111));
  assert.deepEqual(visible(.2), [false, false, false, true, true, true]);
  assert.deepEqual(visible(.05), [false, true, true, true, true, true]); assert.deepEqual(visible(.8), [false, false, false, false, false, true]);
  assert.equal(pitchFrameVisible(track, 5, .2, 70, 80), false); assert.equal(pitchFrameVisible(track, 5, .2, 68, 70), true);
});
test('pitch caches retain silence gaps and reject malformed, truncated, unbounded or nonfinite results', () => {
  const track = createPitchTrack(10); track.pitches[10] = 69.12; track.pitches[11] = 60; track.confidence[10] = 200;
  const bytes = encodePitchTrack(track), result = decodePitchTrack(bytes);
  assert.equal(result.pitches[10], track.pitches[10]); assert.ok(Number.isNaN(result.pitches[0])); assert.equal(result.ready[100], 1); assert.equal(result.complete, true); assert.ok(result.high - result.low >= 24);
  assert.throws(() => decodePitchTrack(bytes.subarray(0, 100))); assert.throws(() => createPitchTrack(1801));
  new DataView(bytes.buffer).setFloat32(32, Infinity, true); assert.throws(() => decodePitchTrack(bytes));
  assert.ok(encodePitchTrack(createPitchTrack(1800)).byteLength < 800000);
});
test('visible sections are analyzed first; resampling uses bounded windows and preserves padding/timing', () => {
  assert.deepEqual(pitchChunkOrder(16, 9), [2, 1, 3, 0]);
  const input = buffer(2, 440, 44100), window = resamplePitchWindow(input, -.5, 2.5);
  assert.equal(window.samples.length, 3 * 22050); assert.equal(window.samples[100], 0); assert.equal(window.samples.at(-1), 0); assert.ok(window.peak > .29);
  assert.equal(input.samples.buffer.byteLength, input.length * 4, 'source buffer is never transferred');
});
test('amplitude envelopes match existing waveform width, and quiet sections are proportionally transparent', async () => {
  const input = buffer(2); for (let i = input.length / 2; i < input.length; i++) input.samples[i] *= .1;
  const data = await pitchWaveform(input), envelope = new WaveformEnvelope(data.waveform);
  const strong = envelope.peak(2000, 3000), weak = envelope.peak(20000, 21000);
  assert.ok(strong > .99); assert.ok(Math.abs(weak / strong - Math.pow(.1, 1.35)) < .001);
  const controller = new AbortController(); controller.abort(); await assert.rejects(pitchWaveform(input, controller.signal), { name: 'AbortError' });
});
test('audio fingerprints include full content, independent of playback or buffer identity', async () => {
  const a = buffer(.05), b = buffer(.05); assert.equal(await pitchAudioKey(a), await pitchAudioKey(b));
  b.samples[10] = .99; assert.notEqual(await pitchAudioKey(a), await pitchAudioKey(b));
});
class FakeWorker extends EventTarget {
  calls = []; terminated = false;
  postMessage(value) {
    this.calls.push(value);
    queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: value.action === 'load' ? { id: value.id } : { id: value.id, pitches: new Float32Array(Math.ceil(value.samples.length / 22050 * PITCH_FRAME_RATE)).fill(69), confidence: new Uint8Array(500).fill(220) } })));
  }
  terminate() { this.terminated = true; }
}
test('pitch processing creates no worker before use, caches compact tracks and releases model after completion', async () => {
  const input = buffer(9), entry = { buffer: input }, workers = [], writes = [];
  const engine = new AudioPitch({ original: input, resolve: async () => entry }, { createWorker: () => { const w = new FakeWorker(); workers.push(w); return w; }, key: async () => 'abc', read: async () => null, write: async (key, track) => writes.push({ key, complete: track.complete }) });
  assert.equal(workers.length, 0); await engine.start('piano', 8);
  assert.equal(engine.error, null); assert.equal(workers.length, 1); assert.equal(workers[0].terminated, true); assert.equal(engine.worker, null); assert.equal(engine.track.complete, true); assert.deepEqual(writes, [{ key: 'abc', complete: true }]);
  assert.ok(workers[0].calls.filter(v => v.samples).every(v => v.samples.length <= 5 * 22050)); assert.ok(engine.cache.bytes < 10000);
  const track = engine.track; await engine.start('piano'); assert.equal(engine.track, track); assert.equal(workers.length, 1);
  engine.clear(); assert.equal(engine.cache.bytes, 0); assert.equal(engine.entry, null);
});
test('switching sources or cancelling drops stale async reads and terminates an in-flight worker', async () => {
  const input = buffer(1); let release;
  const engine = new AudioPitch({ original: input, resolve: () => new Promise(resolve => { release = resolve; }) }, { key: async () => 'k', read: async () => null });
  const job = engine.start('a'); engine.clear(); release({ buffer: input }); await job; assert.equal(engine.track, null); assert.equal(engine.busy, false);
  let worker;
  engine.sources.resolve = async () => ({ buffer: input }); engine.createWorker = () => worker = Object.assign(new EventTarget(), { postMessage() {}, terminate() { this.stopped = true; } });
  const pending = engine.start('b'); while (!worker) await new Promise(resolve => setImmediate(resolve)); engine.stop(); await pending; assert.equal(worker.stopped, true); assert.equal(engine.busy, false);
});
test('desktop pitch cache uses the existing movable audio cache, enforces budgets and leaves unrelated files intact', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rpen-pitch-')); let handler; const contents = { mainFrame: {} }, event = { sender: contents, senderFrame: contents.mainFrame }; contents.mainFrame.url = 'rpe://app/index.html';
  const storage = { prepare: async () => true, access: action => action(), directory: async (id, kind) => { assert.equal(id, 'onsets'); assert.equal(kind, 'cache'); return root; } };
  installAudioPitchCache({ ipcMain: { handle: (channel, value) => { assert.equal(channel, 'rpen-audio-pitch-cache'); handler = value; } }, storage, origin: 'rpe://app', window: () => ({ webContents: contents }) });
  const key = 'a'.repeat(64), bytes = encodePitchTrack(createPitchTrack(1));
  try {
    assert.equal((await handler(event, { action: 'write', key, bytes })).ok, true); assert.deepEqual((await handler(event, { action: 'read', key })).result, bytes);
    assert.equal((await handler(event, { action: 'write', key: '../private', bytes })).ok, false);
    assert.equal((await handler({ ...event, sender: {} }, { action: 'read', key })).ok, false);
    const folder = join(root, 'pitch-v1'); await writeFile(join(folder, 'keep.txt'), 'keep');
    for (let i = 0; i < 35; i++) await handler(event, { action: 'write', key: i.toString(16).padStart(64, '0'), bytes });
    assert.ok((await readdir(folder)).filter(name => name.endsWith('.bin')).length <= 32);
    await handler(event, { action: 'clear' }); assert.equal(await readFile(join(folder, 'keep.txt'), 'utf8'), 'keep');
  } finally { await rm(root, { recursive: true, force: true }); }
});
