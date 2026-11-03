import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioTransport } from '../src/platform/audio.mjs';
import { EditorPlayback } from '../src/application/playback.mjs';
import { HitSounds } from '../src/platform/hitsounds.mjs';
import { createChart, createNote } from '../src/core/chart.mjs';
import { TempoMap } from '../src/core/tempo.mjs';
import { SceneRuntime } from '../src/core/scene.mjs';
import { recentHits } from '../src/core/hit-effects.mjs';

class SeekingMedia extends EventTarget {
  duration = 120;
  current = 0;
  target = 0;
  paused = true;
  seeking = false;
  readyState = 4;
  plays = 0;
  seeks = 0;
  get currentTime() { return this.current; }
  set currentTime(value) { this.target = value; this.seeking = true; this.seeks++; }
  finishSeek() { this.current = this.target; this.seeking = false; this.dispatchEvent(new Event('seeked')); }
  play() { this.paused = false; this.plays++; return this.pending ?? Promise.resolve(); }
  pause() { this.paused = true; }
  removeAttribute() {} load() {}
}

function setup() {
  const starts = [];
  const context = { currentTime: 0, resume: async () => {}, destination: {},
    createGain: () => ({ gain: {}, connect() {} }),
    createBufferSource: () => ({ playbackRate: {}, connect() {}, disconnect() {}, stop() {}, start(at, offset) { starts.push({ at, offset }); } }),
  };
  const audio = new AudioTransport(() => context);
  audio.media = new SeekingMedia();
  return { audio, context, starts };
}

test('从时间滑条结尾重播时先通知视图回到音频零秒，正负 offset 与零秒特效均保留', async () => {
  for (const offset of [-500, 0, 500]) {
    const { audio, context, starts } = setup(); audio.media = null; audio.buffer = { duration: 10 };
    const chart = createChart(); chart.META.offset = offset; chart.BPMList = [{ bpm: 120, startTime: [0, 0, 1] }];
    chart.judgeLineList[0].notes = [createNote(1, Math.max(0, -offset / 1000) * 2, 0)];
    const scene = new SceneRuntime(); scene.compile(chart, new TempoMap(chart.BPMList));
    let since = Infinity, seekCount = 0;
    const playback = new EditorPlayback(audio, { stop() {}, async prepare() {} }, () => {
      assert.equal(audio.time, 0); assert.equal(audio.playing, false); assert.equal(starts.length, 0);
      since = audio.time - offset / 1000 - .001; seekCount++;
    });
    audio.seek(audio.duration); await playback.toggle(chart);
    assert.equal(seekCount, 1); assert.equal(audio.playing, true); assert.equal(starts[0].offset, 0);
    context.currentTime = Math.max(0, offset / 1000) + .05;
    assert.equal(recentHits(scene.lines[0], audio.time - offset / 1000, since).length, 1);
  }
});

test('中途播放与已取消的结尾播放准备不会隐式回零，迟到的准备结果不会恢复播放', async () => {
  const { audio } = setup(); audio.media = null; audio.buffer = { duration: 10 };
  let seekCount = 0, release;
  const sounds = { stop() {}, prepare: async () => {} }, playback = new EditorPlayback(audio, sounds, () => { seekCount++; });
  audio.seek(4); await playback.toggle(createChart()); assert.equal(audio.time, 4); assert.equal(seekCount, 0); playback.pause();
  audio.seek(10); sounds.prepare = () => new Promise(resolve => { release = resolve; });
  const pending = playback.toggle(createChart()); await playback.toggle(createChart()); release(); await pending;
  assert.equal(audio.time, 10); assert.equal(audio.playing, false); assert.equal(seekCount, 0); assert.equal(playback.pending, false);
});

test('超大谱音乐直接使用流式 URL，保持定位与倍速且不解码整首音频', async () => {
  const original = globalThis.Audio;
  class LoadedMedia extends SeekingMedia { set src(value) { this.url = value; queueMicrotask(() => this.onloadedmetadata?.()); } }
  globalThis.Audio = LoadedMedia;
  const { audio, context } = setup(); audio.media = null;
  context.createMediaElementSource = () => ({ connect() {}, disconnect() {} });
  context.decodeAudioData = () => { throw Error('must not decode'); };
  try {
    await audio.loadStream('rpe://app/__large-preview/test/music', 1000);
    assert.equal(audio.buffer, null); assert.equal(audio.usesMedia, true); assert.equal(audio.media.url, 'rpe://app/__large-preview/test/music');
    audio.seek(30); audio.media.finishSeek(); assert.equal(audio.time, 30);
    audio.clear(); await audio.loadStream(null, 1000); assert.equal(audio.duration, 1000);
    audio.clear(); assert.equal(audio.duration, 600);
  } finally { audio.clear(); globalThis.Audio = original; }
});

test('载入音乐优先保存解码样本；解码器不支持时仍可回退原生媒体', async () => {
  const original = globalThis.Audio;
  class LoadedMedia extends SeekingMedia {
    set src(value) { queueMicrotask(() => this.onloadedmetadata?.()); }
    removeAttribute() {} load() {}
  }
  globalThis.Audio = LoadedMedia;
  const { audio, context } = setup(); audio.media = null;
  context.createMediaElementSource = () => ({ connect() {}, disconnect() {} });
  const buffer = { duration: 99.8, length: 4, numberOfChannels: 1, sampleRate: 48000, getChannelData: () => new Float32Array([0, 0.25, -0.5, 1]) };
  context.decodeAudioData = async () => buffer;
  try {
    assert.equal(await audio.load(new ArrayBuffer(4), 'vbr.mp3'), true);
    assert.equal(audio.buffer, buffer); assert.equal(audio.usesMedia, false); assert.equal(audio.duration, 99.8);
    const cached = await (await fetch(audio.mediaUrl)).arrayBuffer();
    assert.equal(new TextDecoder().decode(cached.slice(0, 4)), 'RIFF');
    assert.equal(new DataView(cached).getFloat32(48, true), 0.25);
    context.decodeAudioData = async () => { throw new Error('仅原生媒体支持此格式'); };
    assert.equal(await audio.load(new ArrayBuffer(4), 'native-only.m4a'), true);
    assert.equal(audio.buffer, null); assert.equal(audio.usesMedia, true);
    audio.clear();
  } finally { globalThis.Audio = original; }
});

test('浏览器不支持 PCM 媒体时回退原音乐，保持解码样本可用', async () => {
  const original = globalThis.Audio;
  class LoadedMedia extends SeekingMedia {
    loads = 0;
    set src(value) { this.loads++; queueMicrotask(() => this.loads === 2 ? this.onerror?.() : this.onloadedmetadata?.()); }
    removeAttribute() {} load() {}
  }
  globalThis.Audio = LoadedMedia;
  const { audio, context } = setup(); audio.media = null;
  context.createMediaElementSource = () => ({ connect() {}, disconnect() {} });
  const buffer = { duration: 1, length: 1, numberOfChannels: 1, sampleRate: 48000, getChannelData: () => new Float32Array(1) };
  context.decodeAudioData = async () => buffer;
  try {
    assert.equal(await audio.load(new Uint8Array([1, 2, 3]).buffer, 'music.mp3'), true);
    assert.equal(audio.buffer, buffer);
    assert.equal(audio.media.loads, 3);
    assert.deepEqual(new Uint8Array(await (await fetch(audio.mediaUrl)).arrayBuffer()), new Uint8Array([1, 2, 3]));
    audio.clear();
  } finally { globalThis.Audio = original; }
});

test('PCM 转换途中清空音乐，不会把已取消的音乐重新装入', async () => {
  const original = globalThis.Audio;
  class LoadedMedia extends SeekingMedia {
    set src(value) { queueMicrotask(() => this.onloadedmetadata?.()); }
    removeAttribute() {} load() {}
  }
  globalThis.Audio = LoadedMedia;
  const { audio, context } = setup(); audio.media = null;
  let beganEncoding;
  const encoding = new Promise(resolve => { beganEncoding = resolve; });
  context.createMediaElementSource = () => { throw new Error('已取消的音乐不应连接音频输出'); };
  context.decodeAudioData = async () => ({ duration: 2, length: 96000, numberOfChannels: 1, sampleRate: 48000,
    getChannelData: () => { beganEncoding(); return new Float32Array(96000); },
  });
  try {
    const loaded = audio.load(new ArrayBuffer(4), 'music.ogg');
    await encoding; audio.clear();
    assert.equal(await loaded, false);
    assert.equal(audio.media, null); assert.equal(audio.buffer, null);
  } finally { globalThis.Audio = original; }
});

test('连续拖动时间滑条后等待最后一次定位完成，等待中画面不读取旧播放头', async () => {
  const { audio, context } = setup();
  const controls = new EditorPlayback(audio, { stop() {}, prepare: async () => {} }, () => {});
  controls.seek(3); controls.seek(12); controls.seek(27);
  const playing = audio.play(); await Promise.resolve();
  context.currentTime = 3;
  assert.equal(audio.media.plays, 0); assert.equal(audio.clockReady, false);
  assert.equal(audio.time, 27); assert.equal(audio.time - 0.15, 26.85);
  audio.media.finishSeek(); await playing;
  assert.equal(audio.media.plays, 1); assert.equal(audio.clockReady, true);
  audio.media.current = 28.25; assert.equal(audio.time - 0.15, 28.1);
});

test('等待定位时暂停或再次定位，会取消旧播放请求，不会被迟到事件恢复播放', async () => {
  const { audio } = setup();
  audio.seek(10); const previous = audio.play(); await Promise.resolve();
  audio.pause(); await previous;
  audio.seek(40); const current = audio.play(); await Promise.resolve();
  assert.equal(audio.media.plays, 0); audio.media.finishSeek(); await current;
  assert.equal(audio.media.plays, 1); assert.equal(audio.time, 40);
  audio.pause(); assert.equal(audio.time, 40);
  const seeks = audio.media.seeks; await audio.play();
  assert.equal(audio.media.seeks, seeks); assert.equal(audio.time, 40);
});

test('音乐真正启动前、定位和缓冲等待中不提前调度打击音', async () => {
  const { audio, context, starts } = setup();
  let finishPlay; audio.media.pending = new Promise(resolve => { finishPlay = resolve; });
  const playing = audio.play(); await Promise.resolve();
  const chart = createChart(); chart.judgeLineList[0].notes = [createNote(1, 0, 0)];
  const sounds = new HitSounds(audio); sounds.gain = {}; sounds.buffers.set('tap', {});
  const tempo = new TempoMap(chart.BPMList);
  context.currentTime = 4; sounds.tick(chart, tempo);
  assert.equal(starts.length, 0); assert.equal(audio.time, 0);
  finishPlay(); await playing; sounds.tick(chart, tempo);
  assert.equal(starts.length, 1); assert.equal(starts[0].at, 4);
  audio.media.readyState = 1; sounds.tick(chart, tempo); assert.equal(sounds.sources.size, 0);
});

test('常速使用解码样本和同一音频时钟，反复暂停、定位不依赖压缩媒体播放头', async () => {
  const { audio, context, starts } = setup(); audio.buffer = { duration: 100 };
  for (const [index, target] of [0, 12.345, 3.2, 76.8, -0.5].entries()) {
    audio.pause(); audio.seek(target); context.currentTime = index * 10; await audio.play();
    const scheduled = starts.at(-1);
    assert.equal(scheduled.offset, Math.max(0, target));
    assert.equal(scheduled.at, context.currentTime + Math.max(0, -target));
    context.currentTime += 0.25;
    assert.ok(Math.abs(audio.time - (target + 0.25)) < 1e-9);
    audio.media.current = 99;
    assert.ok(Math.abs(audio.time - 0.125 - (target + 0.25 - 0.125)) < 1e-9);
  }
  assert.equal(audio.media.plays, 0); assert.equal(audio.duration, 100);
});

test('保调倍速切换保留音乐秒位置；原生倍速调整不反复触发 seek', async () => {
  const { audio, context } = setup(); audio.buffer = { duration: 100 };
  audio.seek(10); await audio.play(); context.currentTime = 1;
  audio.setRate(0.5); assert.equal(audio.time, 11); assert.equal(audio.usesMedia, true);
  audio.media.finishSeek(); await Promise.resolve(); await Promise.resolve();
  assert.equal(audio.media.plays, 1); audio.media.current = 12;
  const seeks = audio.media.seeks; audio.setRate(0.75);
  assert.equal(audio.media.seeks, seeks); assert.equal(audio.time, 12);
  audio.setPreservePitch(false); assert.equal(audio.usesMedia, false); assert.equal(audio.time, 12);
  context.currentTime = 2; assert.equal(audio.time, 12.75);
  audio.setRate(1); assert.equal(audio.time, 12.75);
});

test('保调倍速暂停记录媒体真正停止的位置，连续续播不触发额外定位', async () => {
  const { audio } = setup(); audio.buffer = { duration: 100 }; audio.setRate(1.5);
  const media = audio.media;
  media.pause = () => { if (!media.paused) media.current += 0.0003; media.paused = true; };
  audio.seek(10); media.finishSeek();
  const seeks = media.seeks;
  for (let index = 0; index < 20; index++) {
    await audio.play();
    media.current += 0.8;
    audio.pause();
    assert.equal(audio.time, media.currentTime);
    assert.equal(media.seeks, seeks);
  }
  await audio.play();
  assert.equal(media.seeks, seeks);
});

test('保调倍速暂停待定位的音频时保留目标时间，不能读取旧播放头', async () => {
  const { audio } = setup(); audio.buffer = { duration: 100 }; audio.setRate(0.75);
  audio.media.current = 4;
  audio.seek(30); const playing = audio.play(); await Promise.resolve();
  audio.pause(); await playing;
  assert.equal(audio.time, 30);
  audio.media.finishSeek();
  await audio.play();
  assert.equal(audio.time, 30);
});

test('媒体负时间预滚不会预先调度越过音乐起点的打击音', async () => {
  const { audio, context, starts } = setup();
  audio.seek(-0.05); await audio.play();
  const chart = createChart(); chart.judgeLineList[0].notes = [createNote(1, 0, 0)];
  const sounds = new HitSounds(audio); sounds.gain = {}; sounds.buffers.set('tap', {});
  const tempo = new TempoMap(chart.BPMList); sounds.tick(chart, tempo);
  assert.equal(starts.length, 0);
  context.currentTime = 0.05; audio.update(); await Promise.resolve(); sounds.tick(chart, tempo);
  assert.equal(starts.length, 1);
});

test('临时声部播放保持原音乐与时长，暂停/倍速/保调/定位共用同一个时钟，恢复原音乐位置不跳变', async () => {
  const previous = globalThis.Audio;
  class StemMedia extends SeekingMedia {
    set src(value) { queueMicrotask(() => this.onloadedmetadata?.()); }
    removeAttribute() {} load() {}
  }
  globalThis.Audio = StemMedia;
  const { audio, context } = setup(), streams = [];
  context.createMediaElementSource = media => ({ connect() { streams.push(media); }, disconnect() {} });
  const samples = new Float32Array(12000), original = { duration: 100, length: 12000, numberOfChannels: 1, sampleRate: 12000, getChannelData: () => samples }, stem = { ...original, getChannelData: () => Float32Array.from(samples, () => .25) }; audio.buffer = original;
  try {
    audio.seek(10); await audio.play(); context.currentTime = 1; await audio.setPlaybackBuffer(stem); assert.equal(audio.time, 11); assert.equal(audio.buffer, original); assert.equal(audio.playbackBuffer, stem); assert.equal(audio.duration, 100); assert.equal(audio.playing, true);
    audio.setRate(.75); const active = audio.playbackMedia; assert.notEqual(active, audio.media); assert.equal(active.playbackRate, .75); active.finishSeek(); await Promise.resolve(); await Promise.resolve(); active.current = 12.25; audio.pause(); assert.equal(audio.time, 12.25);
    const seeks = active.seeks; await audio.play(); assert.equal(active.seeks, seeks); assert.equal(audio.time, 12.25); audio.setPreservePitch(false); assert.equal(audio.usesMedia, false); context.currentTime += 1; assert.equal(audio.time, 13);
    audio.resetPlaybackBuffer(); assert.equal(audio.playbackBuffer, original); assert.equal(audio.time, 13); assert.equal(audio.playing, true); audio.setPreservePitch(true); audio.media.finishSeek(); await Promise.resolve(); assert.equal(audio.media.playbackRate, .75); assert.equal(audio.time, 13);
    audio.pause(); audio.clear(); assert.equal(audio.playbackOverride, null); assert.equal(audio.buffer, null);
  } finally { globalThis.Audio = previous; }
});

test('声部媒体准备途中取消或清空音乐，不会恢复迟到音源', async () => {
  const previous = globalThis.Audio;
  class StemMedia extends SeekingMedia { set src(value) { queueMicrotask(() => this.onloadedmetadata?.()); } removeAttribute() {} load() {} }
  globalThis.Audio = StemMedia;
  const { audio, context } = setup(); context.createMediaElementSource = () => ({ connect() {}, disconnect() {} });
  const samples = new Float32Array(96000), original = { duration: 2, length: samples.length, numberOfChannels: 1, sampleRate: 48000, getChannelData: () => samples }; audio.buffer = original;
  try {
    const controller = new AbortController(), pending = audio.setPlaybackBuffer({ ...original }, { signal: controller.signal }); controller.abort(); await assert.rejects(pending, { name: 'AbortError' }); assert.equal(audio.playbackOverride, null);
    const stale = audio.setPlaybackBuffer({ ...original }); audio.clear(); await assert.rejects(stale, { name: 'AbortError' }); assert.equal(audio.playbackOverride, null); assert.equal(audio.buffer, null);
  } finally { globalThis.Audio = previous; }
});

test('缓存声部播放资源，切回后复用媒体和PCM地址，清空音乐释放全部缓存', async () => {
  const previous = globalThis.Audio;
  class StemMedia extends SeekingMedia { set src(value) { this.url = value; queueMicrotask(() => this.onloadedmetadata?.()); } removeAttribute() {} load() {} }
  globalThis.Audio = StemMedia;
  const { audio, context } = setup(); let mediaSources = 0; context.createMediaElementSource = () => { mediaSources++; return { connect() {}, disconnect() {} }; };
  const samples = new Float32Array(12000), original = { duration: 1, length: 12000, numberOfChannels: 1, sampleRate: 12000, getChannelData: () => samples }, first = { ...original }, second = { ...original }; audio.buffer = original;
  try {
    await audio.setPlaybackBuffer(first); const prepared = audio.playbackOverride; await audio.setPlaybackBuffer(second); audio.resetPlaybackBuffer(); audio.seek(.3); audio.setRate(.75);
    await audio.setPlaybackBuffer(first); assert.equal(audio.playbackOverride, prepared); assert.equal(audio.playbackMedia, prepared.media); assert.equal(mediaSources, 2); assert.equal(audio.playbackMedia.playbackRate, .75); assert.equal(audio.time, .3);
    assert.equal((await fetch(prepared.url)).ok, true); audio.clear(); assert.equal(audio.playbackCache.size, 0); assert.equal(audio.playbackCache.bytes, 0); await assert.rejects(fetch(prepared.url));
  } finally { globalThis.Audio = previous; }
});
