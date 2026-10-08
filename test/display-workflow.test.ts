import test from 'node:test';
import assert from 'node:assert/strict';
import { previewViewport, eventChains, simultaneousNotes, hitParticles, SPECIAL_TRACKS } from '../src/core/editor-display.ts';
import { createChart, createEvent, createNote } from '../src/core/chart.ts';
import { TempoMap } from '../src/core/tempo.ts';
import { Timeline } from '../src/ui/timeline.ts';
import type { TimelineSession } from '../src/ui/timeline.ts';
import type { RectangleDrag } from '../src/ui/timeline.ts';
import { EditorSession } from '../src/application/session.ts';
import { RpeSkin } from '../src/ui/skin.ts';
import type { DrawableImage } from '../src/ui/skin.ts';
import { AutoSaveClock } from '../src/application/autosave.ts';
import { AudioTransport } from '../src/platform/audio.ts';
import type { AudioContextLike, AudioContextFactory } from '../src/platform/audio.ts';
import { assetBytes, resourceReferences, mediaType } from '../src/platform/files.ts';
import type { ArchiveEntries } from '../src/platform/archive.ts';
import { migratePreferences, shortcutAction, shortcutReleased } from '../src/core/preferences.ts';

/**
 * A structural double for the two canvases `Timeline` is built on.
 *
 * The constructor only reads the CSS box, registers listeners and asks for a 2D context, so the
 * test supplies those members and nothing else. `getBoundingClientRect` returns the top-left corner
 * only, which is all the pointer maths reads.
 */
interface CanvasDouble {
  clientWidth: number;
  clientHeight: number;
  style: object;
  addEventListener(): void;
  focus(): void;
  setPointerCapture(): void;
  getBoundingClientRect(): { left: number; top: number };
}

/**
 * `Timeline` declares its canvases as the real `HTMLCanvasElement`, which the partial double above
 * deliberately is not. This helper is the single documented place that bridges the two.
 */
function timelineSurface(double: CanvasDouble): HTMLCanvasElement {
  return double as unknown as HTMLCanvasElement;
}

/**
 * The session as `Timeline` sees it.
 *
 * `TimelineSession` declares optional members the editor attaches at runtime, and a class type never
 * carries an index signature, so the two do not "sufficiently overlap" for a direct assertion. The
 * session holds every named member the timeline reads, so the bridge goes through `unknown` here.
 */
function timelineSession(session: EditorSession): TimelineSession {
  const open: unknown = session;
  return open as TimelineSession;
}

/**
 * The pointer stand-in the timeline handlers are driven with.
 *
 * `Timeline.down`/`move`/`up` are declared as taking a real `PointerEvent`, which this partial is
 * not: it carries only the members the handlers read. `pointerEvent` below is the one place that
 * bridges the two.
 */
interface PointerDouble {
  button?: number;
  shiftKey?: boolean;
  clientX: number;
  clientY: number;
}

/** Bridges the pointer double to the real event type the timeline handlers declare. */
function pointerEvent(double: PointerDouble): PointerEvent {
  return double as unknown as PointerEvent;
}

/** The 2D-context double `RpeSkin.hold` draws into; only `drawImage` is observed. */
interface SkinContextDouble {
  save(): void;
  restore(): void;
  translate(horizontal: number, vertical: number): void;
  scale(horizontal: number, vertical: number): void;
  drawImage(...args: unknown[]): void;
}

/** `RpeSkin.hold` declares a real `CanvasRenderingContext2D`; this bridges the partial double. */
function skinContext(double: SkinContextDouble): CanvasRenderingContext2D {
  return double as unknown as CanvasRenderingContext2D;
}

/**
 * The media element double the audio tests install through the `Audio` global.
 *
 * `AudioTransport` constructs its element through that global and reads only this slice.
 * `onloadedmetadata` is the handshake `load` waits on, and `src` fires it on a microtask exactly as
 * a real element would.
 *
 * `play` is deliberately *not* `async` here and carries no `pending` of its own: each test installs
 * its own subclass (`PlainMedia` / `PendingMedia` below) so the promise timing matches the original
 * test body one-for-one. Wrapping both in a single `async play` would add a microtask and change
 * when the transport observes the element as playing.
 */
class MediaDouble {
  duration = 120;
  currentTime = 0;
  paused = true;
  preload = 'auto';
  playbackRate = 1;
  preservesPitch = true;
  readyState: number | undefined = 4;
  onloadedmetadata: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(value: string) { void value; queueMicrotask(() => this.onloadedmetadata?.()); }
  play(): Promise<void> { this.paused = false; return Promise.resolve(); }
  pause(): void { this.paused = true; }
  load(): void {}
  removeAttribute(): void {}
}

/** The first audio test's element: `play` resolves on the next microtask, as the original `async` did. */
class PlainMedia extends MediaDouble {
  override async play(): Promise<void> { this.paused = false; }
}

/** The second audio test's element: `play` parks on `pending` so the test can interleave a reload. */
class PendingMedia extends MediaDouble {
  pending: Promise<void> | null = null;
  override play(): Promise<void> { this.paused = false; return this.pending ?? Promise.resolve(); }
}

/**
 * The `Audio` constructor stand-in the transport is handed through the global.
 *
 * The global's DOM type is far wider than the slice the transport reads, so the class reference is
 * bridged in this one place.
 */
function audioConstructor(media: typeof MediaDouble): typeof Audio {
  return media as unknown as typeof Audio;
}

/**
 * The context double `AudioTransport` drives.
 *
 * `AudioContextLike` is the production structural slice; the element-source factory is optional
 * there and installed by the double because the native-media path calls it. `decodeAudioData` is
 * overridden to optional here rather than kept required: `load` guards it with a
 * `typeof ... === 'function'` check, and these two tests omit it on purpose so the transport takes
 * the native-media path rather than the decoded-sample path. Requiring it (as the base interface
 * does) would force a decoder onto the double and silently change which branch is under test.
 */
type ContextDouble = Omit<AudioContextLike, 'decodeAudioData'> & {
  currentTime: number;
  createMediaElementSource(media: unknown): { connect(): void; disconnect(): void };
  decodeAudioData?(audioData: ArrayBuffer): Promise<unknown>;
};

/** The gain/media-source node the double shares between both factories. */
function sharedNode(): { gain: { value: number }; connect(): void; disconnect(): void } {
  return { gain: { value: 1 }, connect() {}, disconnect() {} };
}

/**
 * Builds the factory `AudioTransport` takes from the context double.
 *
 * `AudioContextFactory` requires the full `AudioContextLike`, including `decodeAudioData`, which
 * these two tests deliberately leave off so the native-media branch is exercised. Every other member
 * is present, so the bridge goes through `unknown` in this one documented spot.
 */
function contextFactory(context: ContextDouble): AudioContextFactory {
  const open: unknown = context;
  return () => open as AudioContextLike;
}

test('比例裁切按原 1350×900 基准，3:2 默认及宽高比例均不拉伸', () => {
  for (const ratio of [1.5, 16 / 9, 9 / 16]) {
    const view = previewViewport(900, 438, ratio);
    assert.ok(Math.abs(view.width / view.height - ratio) < 1e-9);
    assert.ok(view.left >= 0 && view.top >= 0);
  }
  assert.equal(previewViewport(900, 438).scale, 438 / 900);
});

test('连续事件跨值方向共享范围，时间间隙开始新段，保留原索引', () => {
  const chains = eventChains([createEvent(10, -20, 1, 2), createEvent(0, 10, 0, 1), createEvent(90, 90, 3, 4)]);
  assert.equal(chains.length, 2); assert.equal(chains[0].min, -20); assert.equal(chains[0].max, 10);
  assert.deepEqual(chains[0].entries.map(entry => entry.index), [1, 0]);
  assert.deepEqual(SPECIAL_TRACKS.map(track => track.key), ['scaleXEvents', 'scaleYEvents', 'colorEvents', 'paintEvents', 'textEvents']);
});

test('多押检测跨线和 BPM 倍率，选择状态不影响高亮', () => {
  const chart = createChart(); const other = structuredClone(chart.judgeLineList[0]); other.bpmfactor = 2;
  chart.judgeLineList[0].notes = [createNote(1, 2, 0), createNote(2, 3, 0, 4)];
  other.notes = [createNote(3, 1, 100)]; chart.judgeLineList.push(other);
  const simultaneous = simultaneousNotes(chart, new TempoMap(chart.BPMList));
  assert.equal(simultaneous.size, 2);
  // `simultaneous` is a `Set<Note>`; the assertion above proves the match is present, which is what
  // lets the read below narrow.
  const matched = other.notes[0];
  assert.ok(simultaneous.has(matched));
});

test('Hold 头尾沿身体边缘拼接，头尾宽度使用身体缩放基准', () => {
  const skin = new RpeSkin(() => {});
  // `RpeSkin.images` is keyed by its file-local `SkinImage`, whose exported form is `DrawableImage`.
  for (const [name, width, height] of [['Hold', 100, 100], ['HoldHead', 120, 20], ['HoldEnd', 100, 10]] as [string, number, number][]) skin.images.set(name, { name, naturalWidth: width, naturalHeight: height } as DrawableImage);
  const calls: unknown[][] = []; const context: SkinContextDouble = { save() {}, restore() {}, translate() {}, scale() {}, drawImage(...args: unknown[]) { calls.push(args); } };
  skin.hold(skinContext(context), 100, 200, 50, 50);
  assert.deepEqual(calls.map(call => call.slice(1)), [[-25, -150, 50, 150], [-25, -155, 50, 5], [-30, 0, 60, 10]]);
});

test('粒子四个、原时长和指数扩散，定位采样结果确定', () => {
  const particles = hitParticles(0.2, 42, 175);
  assert.equal(particles.length, 4); assert.equal(particles[0].alpha, 0.7);
  assert.deepEqual(particles, hitParticles(0.2, 42, 175)); assert.deepEqual(hitParticles(2 / 3, 42, 175), []);
});

function canvas(): CanvasDouble { return { clientWidth: 500, clientHeight: 600, style: {}, addEventListener() {}, focus() {}, setPointerCapture() {}, getBoundingClientRect() { return { left: 0, top: 0 }; } }; }
test('合并多线音符命中绘制在当前线之外的目标线', () => {
  const chart = createChart(); chart.judgeLineList.push(structuredClone(chart.judgeLineList[0]));
  chart.judgeLineList[0].notes = [createNote(1, 1, 0)];
  chart.judgeLineList[1].notes = [createNote(1, 1, 0)];
  const session = new EditorSession(chart); session.setMultiLineEnabled(true); session.addMultiLine(1); session.selectLine(0);
  const timeline = new Timeline(timelineSurface(canvas()), timelineSurface(canvas()), () => timelineSession(session), () => {}, () => {}); timeline.origin = 0; timeline.scale = 144;
  const hit = timeline.hit({ x: timeline.noteHorizontal(0, 0), y: timeline.verticalForLine(1, 0) });
  // `hit` returns `null` when nothing is under the point; the coordinates above land on line 1.
  assert.ok(hit);
  assert.equal(hit.lineIndex, 1);
});

test('多线框选横向滚动时保留绝对起点', () => {
  const chart = createChart(); chart.judgeLineList.push(structuredClone(chart.judgeLineList[0]));
  const session = new EditorSession(chart); session.setMultiLineEnabled(true); session.addMultiLine(1); session.setMultiLineMerge(false);
  const timeline = new Timeline(timelineSurface(canvas()), timelineSurface(canvas()), () => timelineSession(session), () => {}, () => {}); timeline.multiLineWidth = 400;
  // `Timeline.down`/`move` are still unannotated, so the doubles pass through the untyped boundary.
  const start: PointerDouble = { button: 0, shiftKey: true, clientX: 80, clientY: 380 };
  timeline.down(pointerEvent(start));
  // The shift-drag above opens a rectangle drag, which is the variant that carries the world-X
  // fields; the assertion narrows `timeline.drag` to it before the reads below.
  const drag = timeline.drag;
  assert.ok(drag && drag.kind === 'rectangle');
  const initial = (drag as RectangleDrag).startWorldX;
  timeline.multiLineScroll = 80; timeline.move(pointerEvent({ clientX: 300, clientY: 420 }));
  const moved = timeline.drag;
  assert.ok(moved && moved.kind === 'rectangle');
  assert.equal((moved as RectangleDrag).startWorldX, initial);
  assert.equal((moved as RectangleDrag).currentWorldX, 380);
});

test('Shift 框选和左拖轨迹生效，右键保留给上下文菜单；Y 缩放不依赖 BPM', () => {
  const session = new EditorSession(); session.insertNotes([createNote(1, 2, 0)]); session.selection.clear();
  const timeline = new Timeline(timelineSurface(canvas()), timelineSurface(canvas()), () => timelineSession(session), () => {}, () => {});
  timeline.scale = 144;
  const start: PointerDouble = { button: 0, shiftKey: true, clientX: 100, clientY: 380 };
  timeline.down(pointerEvent(start)); timeline.up(pointerEvent(start));
  const drag = timeline.drag;
  assert.ok(drag);
  assert.equal(drag.kind, 'rectangle'); assert.equal(session.selection.size, 0);
  timeline.down(pointerEvent({ button: 0, clientX: 400, clientY: 500 })); assert.equal(session.selection.size, 1);
  session.selection.clear(); timeline.down(pointerEvent({ button: 0, clientX: 50, clientY: 400 })); timeline.move(pointerEvent({ clientX: 400, clientY: 450 })); timeline.up(pointerEvent({ clientX: 400, clientY: 450 })); assert.equal(session.selection.size, 1);
  timeline.down(pointerEvent({ button: 2, clientX: 50, clientY: 400 })); timeline.up(pointerEvent({ button: 2, clientX: 400, clientY: 450 })); assert.equal(session.selection.size, 1);
  timeline.scale = 333;
  for (const bpm of [60, 120, 240]) { timeline.tempo = new TempoMap([{ bpm, startTime: [0, 0, 1] }]); assert.equal(timeline.vertical(0) - timeline.vertical(bpm / 60), 333); }
});

test('自动保存固定间隔而非输入防抖，并隔离并发写入', async () => {
  let saved = 0; let finish: (() => void) | undefined;
  // `reportError` is only reached on a failure path this test never takes; the handler keeps the
  // original `assert.fail` behaviour by delegating to it, rather than passing the overloaded
  // function reference straight through.
  const clock = new AutoSaveClock(() => { saved++; return new Promise<void>(resolve => { finish = resolve; }); }, (error: unknown) => { assert.fail(error instanceof Error ? error.message : String(error)); });
  clock.reset(0); await clock.tick(59000, true, 60, true); assert.equal(saved, 0);
  const pending = clock.tick(60000, true, 60, true); assert.equal(saved, 0); await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(saved, 1);
  await clock.tick(120000, true, 60, true); assert.equal(saved, 1);
  finish?.(); await pending; const next = clock.tick(120000, true, 60, true); await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(saved, 2); finish?.(); await next;
});

test('资源回退处理大小写、相对路径、过期 META 及同名文件歧义', () => {
  const bytes = new Uint8Array([1]); const other = new Uint8Array([2]);
  // The archive map the importer builds, which is what `assetBytes`/`resourceReferences` take.
  const assets: ArchiveEntries = new Map([['Song/Music.FLAC', bytes], ['other/Music.FLAC', other], ['Song/Cover.JPEG', bytes], ['Song/info.txt', new TextEncoder().encode('Chart: chart.json\nSong: ./Music.FLAC\nPicture: Cover.JPEG')]]);
  const chart = createChart(); chart.META.song = 'missing.mp3';
  assert.equal(assetBytes(assets, './music.flac', 'Song/chart.json'), bytes);
  assert.equal(assetBytes(assets, 'music.flac', 'unknown/chart.json'), null);
  assert.equal(resourceReferences(chart, assets, 'Song/chart.json').song, './Music.FLAC');
  assert.equal(mediaType('Cover.JPEG'), 'image/jpeg'); assert.equal(mediaType('Music.FLAC'), 'audio/flac');
  assets.set('Song/info.txt', new TextEncoder().encode('Chart: charts/chart.json\nSong: ./Music.FLAC\nPicture: Cover.JPEG'));
  assert.equal(resourceReferences(chart, assets, 'Song/charts/chart.json').song, 'Song/./Music.FLAC');
});

test('原预览快捷键包含恢复、跃进、从头和按住模式', () => {
  const preferences = migratePreferences();
  for (const [key, expected] of [['i', 'StartView'], ['o', 'EndView'], ['p', 'JumpView'], ['[', 'ReplayView'], ['t', 'StartView_HOLD'], ['u', 'JumpView_HOLD']] as [string, string][]) assert.equal(shortcutAction({ key }, preferences), expected);
  assert.equal(shortcutReleased({ key: 'Shift' }, 'T'), false);
  assert.equal(shortcutReleased({ key: 'Control' }, 'LEFTCTRL&T'), true);
  assert.equal(shortcutReleased({ key: 't' }, 'LEFTCTRL&T'), true);
});

test('原生音频默认保调，切模式/倍速/定位保留真实媒体时钟', async () => {
  const original = globalThis.Audio;
  globalThis.Audio = audioConstructor(PlainMedia);
  const node = sharedNode();
  const context: ContextDouble = { currentTime: 0, destination: {}, createGain: () => node, createBufferSource: () => ({ buffer: null, playbackRate: { value: 1 }, connect() {}, disconnect() {}, stop() {}, start() {} }), createMediaElementSource: () => node, resume: async () => {} };
  const audio = new AudioTransport(contextFactory(context));
  try {
    await audio.load(new ArrayBuffer(4), 'song.flac');
    // `load` installs the media element it created through the `Audio` global; `null` only when the
    // decoder path was taken instead, which the `try` above proves did not happen here.
    const media = audio.media;
    assert.ok(media);
    assert.equal(media.preservesPitch, true);
    audio.seek(12); await audio.play(); media.currentTime = 13; assert.equal(audio.time, 13);
    audio.setRate(0.5); assert.equal(media.currentTime, 13); assert.equal(media.playbackRate, 0.5);
    audio.setPreservePitch(false); assert.equal(media.preservesPitch, false); audio.pause(); assert.equal(audio.time, 13);
    audio.clear(); assert.equal(audio.media, null);
  } finally { globalThis.Audio = original; }
});

test('旧音乐的异步播放完成或失败不会暂停新谱面音乐', async () => {
  const original = globalThis.Audio;
  globalThis.Audio = audioConstructor(PendingMedia);
  const node = sharedNode();
  const context: ContextDouble = { currentTime: 0, destination: {}, createGain: () => node, createBufferSource: () => ({ buffer: null, playbackRate: { value: 1 }, connect() {}, disconnect() {}, stop() {}, start() {} }), createMediaElementSource: () => node, resume: async () => {} };
  const audio = new AudioTransport(contextFactory(context));
  try {
    for (const rejectOld of [false, true]) {
      await audio.load(new ArrayBuffer(4)); const oldMedia = audio.media; let finish: (() => void) | undefined;
      assert.ok(oldMedia);
      // `pending` and the members read below live on the `MediaDouble` this file installed through
      // the global, so the element is viewed through that class rather than the transport's slice.
      const oldDouble = oldMedia as unknown as PendingMedia;
      oldDouble.pending = new Promise<void>((resolve, reject) => { finish = rejectOld ? () => reject(new Error('旧音乐中止')) : resolve; });
      const oldPlay = audio.play(); await Promise.resolve();
      await audio.load(new ArrayBuffer(4)); await audio.play(); finish?.(); await oldPlay;
      const current = audio.media;
      assert.ok(current);
      assert.equal(audio.playing, true); assert.equal(current.paused, false); assert.equal(oldDouble.paused, true);
      audio.clear();
    }
  } finally { globalThis.Audio = original; }
});
