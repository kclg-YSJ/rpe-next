import test from 'node:test';
import assert from 'node:assert/strict';
import { Timeline } from '../src/ui/timeline.ts';
import { EditorSession } from '../src/application/session.ts';
import { createNote, createEvent, createChart } from '../src/core/chart.ts';
import { beatValue } from '../src/core/beat.ts';
import { TempoMap } from '../src/core/tempo.ts';
import { LineRuntime } from '../src/core/scene.ts';
import { recentHits, HOLD_HIT_INTERVAL } from '../src/core/hit-effects.ts';
import { visibleBeats, visibleSeconds } from '../src/core/note-editing.ts';
import { mergeGuides, pickGuide, formatLineNumbers } from '../src/core/preview-guides.ts';
import { insertEvent } from '../src/application/event-commands.ts';
import { AudioTransport } from '../src/platform/audio.ts';
import type { AudioContextFactory, MediaElementLike } from '../src/platform/audio.ts';
import { RpeSkin } from '../src/ui/skin.ts';
import type { DrawableImage } from '../src/ui/skin.ts';
import type { TimelineSession, GesturePointerLike } from '../src/ui/timeline.ts';
import type { Note } from '../src/core/types.ts';

/**
 * A structural double for the canvases `Timeline` is built on.
 *
 * The constructor reads the CSS box, registers listeners, focuses and captures the pointer, and the
 * gesture paths write `style.cursor`. `clientWidth`/`clientHeight` are declared writable here because
 * the test resizes the double to model a wider pane; on the real element they are read-only, which is
 * why the double is bridged rather than passed directly.
 */
interface CanvasDouble {
  clientWidth: number;
  clientHeight: number;
  style: { cursor?: string };
  addEventListener(): void;
  focus(): void;
  setPointerCapture(): void;
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
}

/** `Timeline` declares real `HTMLCanvasElement`s; this is the one place the doubles are bridged. */
function timelineSurface(double: CanvasDouble): HTMLCanvasElement {
  return double as unknown as HTMLCanvasElement;
}

/**
 * The canvas double, kept alongside its `HTMLCanvasElement` view.
 *
 * The test resizes the canvas mid-test (`notesOnly` scaling), which only works on the double, so both
 * views are returned and the caller uses whichever one it needs.
 */
function canvas(): { double: CanvasDouble; surface: HTMLCanvasElement } {
  const double: CanvasDouble = { clientWidth: 600, clientHeight: 600, style: {}, addEventListener() {}, focus() {}, setPointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 600 }) };
  return { double, surface: timelineSurface(double) };
}

/** The pointer stand-in the timeline gesture handlers are driven with. */
interface PointerDouble {
  button: number;
  clientX: number;
  clientY: number;
  pointerId?: number;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  preventDefault?(): void;
}

/** Bridges the pointer double to the real `PointerEvent` `Timeline.down`/`move` declare. */
function pointerEvent(double: PointerDouble): PointerEvent {
  return double as unknown as PointerEvent;
}

/**
 * Bridges the pointer double to the module's `GesturePointerLike`.
 *
 * `finishRectangle`/`up` take that structural type, which requires `pointerId`, `ctrlKey` and
 * `shiftKey`; the double omits them because no branch under test reads them. `{ ...double }` supplies
 * the missing members as `undefined` while keeping the read ones, and the assertion is confined here.
 */
function gesturePointer(double: PointerDouble): GesturePointerLike {
  const completed: GesturePointerLike = { ...double, pointerId: 0, ctrlKey: false, shiftKey: false };
  return completed;
}

/** `TimelineSession` is an open bag; `EditorSession` is handed over through that view here. */
function timelineSession(session: EditorSession): TimelineSession {
  const open: unknown = session;
  return open as TimelineSession;
}

/**
 * The session's current judge line, with the layer array the event-layer test writes into.
 *
 * `EditorSession.line` is optional; the assertion fails loudly rather than dereferencing `undefined`.
 * It reads through the caller's session at call time because a chart edit replaces the document.
 */
function currentLine(session: EditorSession): NonNullable<EditorSession['line']> {
  const line = session.line;
  assert.ok(line);
  return line;
}

/** The media-element double the negative-time test installs directly on the transport. */
interface MediaDouble {
  duration: number;
  currentTime: number;
  pause(): void;
  play(): Promise<void>;
}

/**
 * The context double `AudioTransport` is built with in the negative-time test.
 *
 * The transport's factory hands back the *same* object the test keeps mutating (`context.currentTime`
 * is advanced between `update()` calls), so the extra members are written onto that object rather
 * than onto a copy — a spread would freeze the clock at its startup value and the test would observe
 * stale time.
 *
 * `decodeAudioData` is deliberately *absent*: `load` guards it with a `typeof ... === 'function'`
 * check, and supplying one would put the transport on the decoded-sample path instead of the media
 * clock this test asserts on. The factory is bridged in this one spot.
 */
function audioFactory(context: { currentTime: number; resume: () => Promise<void> }): AudioContextFactory {
  const completed = Object.assign(context, { destination: {}, createGain: () => ({ gain: {}, connect() {} }), createBufferSource: () => ({ buffer: null, playbackRate: { value: 1 }, connect() {}, disconnect() {}, stop() {}, start() {} }) });
  const open: unknown = completed;
  return () => open as ReturnType<AudioContextFactory>;
}

/**
 * A session with `notes` inserted, plus the timeline bound to it.
 *
 * `surface` is optional so the canvas-resize test can keep its own double in view; otherwise the
 * helper builds fresh canvases. The timeline's `getSession` reads back through the same session
 * object, so a chart edit that replaces the document is still seen.
 */
function editor(notes: Note[], surface?: HTMLCanvasElement): { session: EditorSession; timeline: Timeline } {
  const session = new EditorSession(); session.insertNotes(notes);
  const timeline = new Timeline(surface ?? timelineSurface(canvas().double), surface ?? timelineSurface(canvas().double), () => timelineSession(session), () => {}, () => {});
  return { session, timeline };
}

/** A left button press at canvas coordinates, in the shape the gesture handlers read. */
function pointer(horizontal: number, vertical: number): PointerDouble {
  return { button: 0, clientX: horizontal, clientY: vertical };
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
 * The skin-image stand-in the hold test installs.
 *
 * `RpeSkin.images` only reads `naturalWidth`/`naturalHeight` (the real `SkinImage` is a partial shape
 * with no name), while the test uses `name` to tell which texture `hold` selected. Declaring the
 * stand-in with both keeps that assertion typed without widening the production interface.
 */
interface SkinImageDouble extends DrawableImage {
  name: string;
}

test('仅音符视图按实际横向扩展倍率放大音符及坐标间距', () => {
  const { double, surface } = canvas();
  const { timeline } = editor([], surface);
  const size = timeline.noteWidth(createNote(1, 0, 0));
  const spacing = timeline.horizontal(135) - timeline.horizontal(0);
  double.clientWidth = 1224; timeline.notesOnly = true;
  assert.equal(timeline.noteWidth(createNote(1, 0, 0)) / size, 1224 / 600);
  assert.ok(Math.abs((timeline.horizontal(135) - timeline.horizontal(0)) / spacing - 1224 / 600) < 1e-10);
});

test('点击不吸附，拖拽不越界；界外可见音符可拾取拉回，不显示远处音符的边缘替身', () => {
  const { session, timeline } = editor([createNote(1, 2, -730)]);
  const start = pointer(timeline.horizontal(-730), timeline.vertical(2));
  assert.ok(timeline.hit({ x: start.clientX, y: start.clientY }));
  timeline.down(pointerEvent(start)); assert.equal(timeline.movedNote(session.notes[0]).positionX, -730); timeline.up(gesturePointer(start));
  assert.equal(session.notes[0].positionX, -730);
  timeline.down(pointerEvent(start)); timeline.move(pointerEvent(pointer(timeline.horizontal(900), start.clientY))); timeline.up(gesturePointer(pointer(timeline.horizontal(900), start.clientY)));
  assert.equal(session.notes[0].positionX, 675);
  assert.equal(timeline.clampNoteHorizontal(timeline.horizontal(-3000), 68), null);
  assert.equal(timeline.clampNoteHorizontal(timeline.horizontal(-675), 68), timeline.horizontal(-675));
  for (const count of [10, 11, 10.5]) {
    timeline.gridCount = count;
    assert.equal(timeline.notePositionAt(timeline.horizontal(-675)), -675);
    assert.equal(timeline.notePositionAt(timeline.horizontal(675)), 675);
  }
});

test('Hold 首尾可拖动且一次撤销，越过可见边界后持续滚动时间', () => {
  const { session, timeline } = editor([createNote(2, 2, 0, 4)]);
  const start = pointer(timeline.horizontal(0), timeline.vertical(4));
  timeline.down(pointerEvent(start));
  // `down` selects a gesture before any assertion reads it, so the drag is present here.
  const drag = timeline.drag;
  assert.ok(drag);
  assert.equal(drag.kind, 'endTime');
  timeline.move(pointerEvent(pointer(start.clientX, timeline.vertical(5))));
  assert.equal(beatValue(timeline.movedNote(session.notes[0]).endTime), 5);
  timeline.up(gesturePointer(pointer(start.clientX, timeline.vertical(5))));
  assert.equal(beatValue(session.notes[0].endTime), 5); session.travel('undo');
  assert.equal(beatValue(session.notes[0].endTime), 4);
  timeline.down(pointerEvent(start)); timeline.move(pointerEvent(pointer(start.clientX, -40)));
  timeline.onDragScroll = seconds => { timeline.origin = timeline.tempo.beat(timeline.tempo.seconds(timeline.origin) + seconds); };
  const before = beatValue(timeline.movedNote(session.notes[0]).endTime);
  for (let frame = 0; frame < 60; frame++) timeline.autoScroll(1 / 60);
  assert.ok(beatValue(timeline.movedNote(session.notes[0]).endTime) > before);
});

test('可见时间拍与秒在跨 BPM、倍率及负拍范围往返', () => {
  const tempo = new TempoMap([{ bpm: 120, startTime: [0, 0, 1] }, { bpm: 240, startTime: [4, 0, 1] }]);
  for (const factor of [1, 2]) for (const beats of [0, 0.25, 3, 9]) {
    const note = createNote(1, 6, 0); note.visibleTime = visibleSeconds(note, beats, tempo, factor);
    assert.ok(Math.abs(visibleBeats(note, tempo, factor) - beats) < 1e-8);
  }
});

test('Hold 连续打击特效只采样存活脉冲，定位不会补放过去特效', () => {
  const chart = createChart(); chart.judgeLineList[0].notes = [createNote(2, 0, 0, 200), { ...createNote(2, 0, 0, 200), isFake: 1 }];
  const runtime = new LineRuntime(chart.judgeLineList[0], new TempoMap(chart.BPMList));
  const hits = recentHits(runtime, 20, 0);
  assert.ok(hits.length >= 3 && hits.length <= 5);
  assert.ok(hits.every(hit => !hit.entry.note.isFake && hit.time <= 20 && hit.time > 20 - 2 / 3));
  assert.ok(Math.abs(hits[1].time - hits[0].time - HOLD_HIT_INTERVAL) < 1e-8);
  assert.deepEqual(recentHits(runtime, 20, 20), []);
  assert.deepEqual(recentHits(runtime, 101, 0), []);
});

test('判定线编号按距离及方向合并，重合线点击可循环选择', () => {
  const guides = [{ index: 0, x: 10, y: 20, rotation: 0, halfWidth: 100, alpha: 255 }, { index: 1, x: 11, y: 20, rotation: 0, halfWidth: 100, alpha: 255 }, { index: 3, x: 11, y: 20, rotation: 90, halfWidth: 100, alpha: 255 }];
  assert.deepEqual(mergeGuides(guides, 1).map(group => group.indices), [[0, 1], [3]]);
  assert.equal(mergeGuides(guides, 1, false).length, 3);
  assert.equal(pickGuide(guides, { x: 50, y: 20 }, 0), 1);
  assert.equal(pickGuide(guides, { x: 50, y: 20 }, 1), 0);
  assert.equal(pickGuide(guides, { x: 300, y: 300 }, 0), null);
  assert.equal(formatLineNumbers([3, 1, 0, 5]), '0–1, 3, 5');
  assert.equal(formatLineNumbers([0, 1], [{ father: -1 }, { father: 0 }]), '0, 1(0)');
});

test('直接切换空事件层后可添加事件，不引入稀疏层或覆盖其他层', () => {
  const session = new EditorSession(); const original = currentLine(session).eventLayers[0];
  session.eventLayer = 3; insertEvent(session, 'moveXEvents', createEvent(0, 100, 0, 1));
  const line = currentLine(session);
  assert.equal(line.eventLayers.length, 4); assert.equal(line.eventLayers[0], original);
  assert.deepEqual(line.eventLayers[1], {}); assert.deepEqual(line.eventLayers[2], {});
});

test('正延迟对应的负谱面时间播放和暂停均不强制归零，负媒体时间正确接入音乐', async () => {
  const context = { currentTime: 0, resume: async () => {} };
  const audio = new AudioTransport(audioFactory(context));
  let plays = 0;
  // The media element is assigned directly so the transport takes the media-clock path; the
  // assertions below re-read `audio.media` because a reload replaces it.
  const media: MediaDouble = { duration: 120, currentTime: 0, pause() {}, async play() { plays++; } };
  audio.media = media as unknown as MediaElementLike;
  await audio.play(); assert.equal(audio.time - 2, -2);
  media.currentTime = 0.5; audio.pause(); assert.equal(audio.time - 2, -1.5);
  await audio.play(); assert.equal(audio.time - 2, -1.5);
  audio.pause(); audio.seek(-1); await audio.play(); const previous = plays;
  context.currentTime = 0.5; audio.update(); assert.equal(plays, previous); assert.equal(audio.time, -0.5);
  context.currentTime = 1.25; audio.update(); assert.equal(plays, previous + 1); assert.equal(audio.time, 0.25);
});

test('普通 Hold 使用原版 Hold3，和 HL 保持相同的身体宽度基准', () => {
  const skin = new RpeSkin(() => {});
  // `RpeSkin.images` is keyed by its file-local `SkinImage`, whose exported form is `DrawableImage`.
  for (const [name, width] of [['Hold', 989], ['Hold3', 1089], ['HoldHL', 1086], ['HoldHead', 1089], ['HoldHeadHL', 1086], ['HoldEnd', 1089]] as [string, number][]) skin.images.set(name, { name, naturalWidth: width, naturalHeight: 50 } as SkinImageDouble);
  // `calls` records the arguments of each `drawImage`; index 0 is the image the hold body drew with.
  // The stand-ins carry their own `name` so the assertions can tell which texture was chosen;
  // `DrawableImage` itself does not declare `name`, so the recorded slot is read through `SkinImageDouble`.
  const calls: unknown[][] = [];
  const context = { save() {}, restore() {}, translate() {}, scale() {}, drawImage(...args: unknown[]) { calls.push(args); } };
  skin.hold(skinContext(context), 0, 0, -100, 175); skin.hold(skinContext(context), 0, 0, -100, 175, true);
  const drawn = calls.map(call => call[0] as SkinImageDouble);
  assert.equal(drawn[0].name, 'Hold3'); assert.equal(drawn[3].name, 'HoldHL');
  assert.equal(calls[0][3], calls[3][3]); assert.equal(calls[2][3], calls[5][3]);
});
