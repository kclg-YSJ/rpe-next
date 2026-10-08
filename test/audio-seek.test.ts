import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioTransport } from '../src/platform/audio.ts';
import type { AudioContextLike, AudioBufferLike, AudioContextFactory } from '../src/platform/audio.ts';
import { EditorPlayback } from '../src/application/playback.ts';
import { HitSounds } from '../src/platform/hitsounds.ts';
import { createChart, createNote } from '../src/core/chart.ts';
import { TempoMap } from '../src/core/tempo.ts';

/**
 * One scheduled buffer-source start, as the context double records it.
 *
 * `start(at, offset)` is called with both arguments by every path under test, so both are read
 * unconditionally below.
 */
interface ScheduledStart {
  at: number;
  offset: number;
}

/**
 * The media element double, plus the two members this test drives that the production
 * `MediaElementLike` slice does not declare.
 *
 * `pending` lets a test hold `play()` unresolved, and `plays`/`seeks` count the calls the
 * assertions read. `SeekingMedia` is a real class here rather than a partial object literal, so it
 * is handed to `AudioTransport.media` through `mediaElement` below.
 */
class SeekingMedia extends EventTarget {
  duration = 120;
  current = 0;
  target = 0;
  paused = true;
  seeking = false;
  readyState = 4;
  plays = 0;
  seeks = 0;
  /** Held open by one test to keep `play()` pending; resolved immediately otherwise. */
  pending: Promise<void> | null = null;
  /** Installed by `AudioTransport.load` on the media element it creates. */
  onloadedmetadata: (() => void) | null = null;
  /** Installed by `AudioTransport.load`; only ever assigned. */
  onerror: (() => void) | null = null;
  get currentTime(): number { return this.current; }
  set currentTime(value: number) { this.target = value; this.seeking = true; this.seeks++; }
  finishSeek(): void { this.current = this.target; this.seeking = false; this.dispatchEvent(new Event('seeked')); }
  play(): Promise<void> { this.paused = false; this.plays++; return this.pending ?? Promise.resolve(); }
  pause(): void { this.paused = true; }
  removeAttribute(): void {}
  load(): void {}
}

/**
 * The double as `AudioTransport.media` sees it.
 *
 * `AudioTransport` declares that field as its own structural `MediaElementLike` slice, which this
 * class deliberately satisfies only in part — it drives playback rather than implementing the whole
 * element. Bridged through `unknown` in this one documented place, in both directions.
 */
function mediaElement(media: SeekingMedia): AudioTransport['media'] {
  const open: unknown = media;
  return open as AudioTransport['media'];
}

/**
 * The context double, as the assertions and the transport both see it.
 *
 * `AudioContextLike` is the production structural slice; the two decoder/media-source hooks are
 * added by individual tests, so they stay optional here and are assigned through the index
 * signature rather than being declared.
 */
interface ContextDouble extends AudioContextLike {
  currentTime: number;
  createMediaElementSource?: (media: unknown) => { connect(): void; disconnect(): void };
  decodeAudioData(audioData: ArrayBuffer): Promise<AudioBufferLike>;
}

/**
 * The real transport as `HitSounds` sees it.
 *
 * `HitSounds` is typed against its own structural `HitSoundTransport` slice, which is not exported
 * and which demands a real `AudioContext`; `AudioTransport` deliberately types its own context as
 * the narrower `AudioContextLike` slice, so the two do not "sufficiently overlap" for a direct
 * assertion. Every member the scheduler reads is on the real transport, so the bridge goes through
 * `unknown` in this one documented spot.
 */
function hitSoundTransport(audio: AudioTransport): ConstructorParameters<typeof HitSounds>[0] {
  const open: unknown = audio;
  return open as ConstructorParameters<typeof HitSounds>[0];
}

function setup() {
  const starts: ScheduledStart[] = [];
  const context: ContextDouble = { currentTime: 0, resume: async () => {}, destination: {},
    createGain: () => ({ gain: { value: 1 }, connect() {} }),
    createBufferSource: () => ({ buffer: null, playbackRate: { value: 1 }, connect() {}, disconnect() {}, stop() {}, start(at?: number, offset?: number) { starts.push({ at: at ?? 0, offset: offset ?? 0 }); } }),
    decodeAudioData: async () => ({ duration: 0 }),
  };
  // `AudioContextLike` is the structural slice the transport declares; the double above carries
  // every member it names, plus the two hooks individual tests install.
  const factory: AudioContextFactory = () => context;
  const audio = new AudioTransport(factory);
  const media = new SeekingMedia();
  audio.media = mediaElement(media);
  return { audio, context, media, starts };
}

test('载入音乐优先保存解码样本；解码器不支持时仍可回退原生媒体', async () => {
  const original = globalThis.Audio;
  class LoadedMedia extends SeekingMedia {
    // The transport assigns `src` and waits for `onloadedmetadata`; the microtask keeps that
    // handshake asynchronous, exactly as a real element would.
    set src(value: string) { void value; queueMicrotask(() => this.onloadedmetadata?.()); }
    override removeAttribute(): void {}
    override load(): void {}
  }
  // `AudioTransport` constructs its element through the `Audio` global, whose DOM type is far wider
  // than the slice it reads; the constructor reference is bridged in this one place.
  globalThis.Audio = LoadedMedia as unknown as typeof Audio;
  const { audio, context } = setup(); audio.media = null;
  context.createMediaElementSource = () => ({ connect() {}, disconnect() {} });
  const buffer: AudioBufferLike = { duration: 99.8 }; context.decodeAudioData = async () => buffer;
  try {
    assert.equal(await audio.load(new ArrayBuffer(4), 'vbr.mp3'), true);
    assert.equal(audio.buffer, buffer); assert.equal(audio.usesMedia, false); assert.equal(audio.duration, 99.8);
    context.decodeAudioData = async () => { throw new Error('仅原生媒体支持此格式'); };
    assert.equal(await audio.load(new ArrayBuffer(4), 'native-only.m4a'), true);
    assert.equal(audio.buffer, null); assert.equal(audio.usesMedia, true);
    audio.clear();
  } finally { globalThis.Audio = original; }
});

test('连续拖动时间滑条后等待最后一次定位完成，等待中画面不读取旧播放头', async () => {
  const { audio, context, media } = setup();
  const controls = new EditorPlayback(audio, { stop() {}, prepare: async () => {} }, () => {});
  controls.seek(3); controls.seek(12); controls.seek(27);
  const playing = audio.play(); await Promise.resolve();
  context.currentTime = 3;
  assert.equal(media.plays, 0); assert.equal(audio.clockReady, false);
  assert.equal(audio.time, 27); assert.equal(audio.time - 0.15, 26.85);
  media.finishSeek(); await playing;
  assert.equal(media.plays, 1); assert.equal(audio.clockReady, true);
  media.current = 28.25; assert.equal(audio.time - 0.15, 28.1);
});

test('等待定位时暂停或再次定位，会取消旧播放请求，不会被迟到事件恢复播放', async () => {
  const { audio, media } = setup();
  audio.seek(10); const previous = audio.play(); await Promise.resolve();
  audio.pause(); await previous;
  audio.seek(40); const current = audio.play(); await Promise.resolve();
  assert.equal(media.plays, 0); media.finishSeek(); await current;
  assert.equal(media.plays, 1); assert.equal(audio.time, 40);
  audio.pause(); assert.equal(audio.time, 40);
  const seeks = media.seeks; await audio.play();
  assert.equal(media.seeks, seeks); assert.equal(audio.time, 40);
});

test('音乐真正启动前、定位和缓冲等待中不提前调度打击音', async () => {
  const { audio, context, media, starts } = setup();
  let finishPlay: (() => void) | undefined;
  media.pending = new Promise<void>(resolve => { finishPlay = resolve; });
  const playing = audio.play(); await Promise.resolve();
  const chart = createChart(); chart.judgeLineList[0].notes = [createNote(1, 0, 0)];
  // `HitSounds` is typed against the structural transport slice, which the real `AudioTransport`
  // satisfies; the two fields below are the ones `tick` reads before it can schedule anything.
  const sounds = new HitSounds(hitSoundTransport(audio)); sounds.gain = { gain: { value: 1 }, connect() {} } as unknown as GainNode;
  sounds.buffers.set('tap', { duration: 1 } as AudioBuffer);
  const tempo = new TempoMap(chart.BPMList);
  context.currentTime = 4; sounds.tick(chart, tempo);
  assert.equal(starts.length, 0); assert.equal(audio.time, 0);
  finishPlay?.(); await playing; sounds.tick(chart, tempo);
  assert.equal(starts.length, 1); assert.equal(starts[0].at, 4);
  media.readyState = 1; sounds.tick(chart, tempo); assert.equal(sounds.sources.size, 0);
});

test('常速使用解码样本和同一音频时钟，反复暂停、定位不依赖压缩媒体播放头', async () => {
  const { audio, context, media, starts } = setup(); audio.buffer = { duration: 100 };
  for (const [index, target] of [0, 12.345, 3.2, 76.8, -0.5].entries()) {
    audio.pause(); audio.seek(target); context.currentTime = index * 10; await audio.play();
    // Every iteration schedules one source, so `starts` is never empty here; the assertion pins that
    // down before `offset`/`at` are read off the last entry.
    const scheduled = starts.at(-1);
    assert.ok(scheduled);
    assert.equal(scheduled.offset, Math.max(0, target));
    assert.equal(scheduled.at, context.currentTime + Math.max(0, -target));
    context.currentTime += 0.25;
    assert.ok(Math.abs(audio.time - (target + 0.25)) < 1e-9);
    media.current = 99;
    assert.ok(Math.abs(audio.time - 0.125 - (target + 0.25 - 0.125)) < 1e-9);
  }
  assert.equal(media.plays, 0); assert.equal(audio.duration, 100);
});

test('保调倍速切换保留音乐秒位置；原生倍速调整不反复触发 seek', async () => {
  const { audio, context, media } = setup(); audio.buffer = { duration: 100 };
  audio.seek(10); await audio.play(); context.currentTime = 1;
  audio.setRate(0.5); assert.equal(audio.time, 11); assert.equal(audio.usesMedia, true);
  media.finishSeek(); await Promise.resolve(); await Promise.resolve();
  assert.equal(media.plays, 1); media.current = 12;
  const seeks = media.seeks; audio.setRate(0.75);
  assert.equal(media.seeks, seeks); assert.equal(audio.time, 12);
  audio.setPreservePitch(false); assert.equal(audio.usesMedia, false); assert.equal(audio.time, 12);
  context.currentTime = 2; assert.equal(audio.time, 12.75);
  audio.setRate(1); assert.equal(audio.time, 12.75);
});

test('媒体负时间预滚不会预先调度越过音乐起点的打击音', async () => {
  const { audio, context, starts } = setup();
  audio.seek(-0.05); await audio.play();
  const chart = createChart(); chart.judgeLineList[0].notes = [createNote(1, 0, 0)];
  const sounds = new HitSounds(hitSoundTransport(audio)); sounds.gain = { gain: { value: 1 }, connect() {} } as unknown as GainNode;
  sounds.buffers.set('tap', { duration: 1 } as AudioBuffer);
  const tempo = new TempoMap(chart.BPMList); sounds.tick(chart, tempo);
  assert.equal(starts.length, 0);
  context.currentTime = 0.05; audio.update(); await Promise.resolve(); sounds.tick(chart, tempo);
  assert.equal(starts.length, 1);
});
