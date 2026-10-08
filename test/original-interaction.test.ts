import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorSession } from '../src/application/session.ts';
import { EditorPlayback } from '../src/application/playback.ts';
import { Timeline } from '../src/ui/timeline.ts';
import type { TimelineSession } from '../src/ui/timeline.ts';
import { TempoMap } from '../src/core/tempo.ts';
import { createChart, createEvent, createNote } from '../src/core/chart.ts';
import type { ChartEvent } from '../src/core/types.ts';
import { placedEvent } from '../src/application/event-commands.ts';
import { beatValue } from '../src/core/beat.ts';
import { snapPosition, snapTime, verticalGrid, wheelSeconds } from '../src/core/edit-grid.ts';
import { hitFrame, HIT_DURATION, DEFAULT_LINE_WIDTH, DEFAULT_LINE_HEIGHT } from '../src/core/visual-constants.ts';
import { easingPicture } from '../src/core/easing-picture.ts';
import { readEditorPreferences, writeEditorPreferences } from '../src/platform/editor-preferences.ts';
import type { PreferenceStorage } from '../src/platform/editor-preferences.ts';
import { migratePreferences, shortcutAction } from '../src/core/preferences.ts';

/**
 * A structural double for the two canvases `Timeline` is built on.
 *
 * The constructor only registers listeners and reads the CSS box, so the test supplies those members
 * and nothing else. Declaring the shape here keeps the double honest: it is not an
 * `HTMLCanvasElement`, and no code under test treats it as one.
 */
interface CanvasDouble {
  clientWidth: number;
  clientHeight: number;
  style: object;
  addEventListener(): void;
  focus(): void;
  setPointerCapture(): void;
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
}

function canvas(): CanvasDouble {
  return { clientWidth: 500, clientHeight: 600, style: {}, addEventListener() {}, focus() {}, setPointerCapture() {}, getBoundingClientRect() { return { left: 0, top: 0, width: 500, height: 600 }; } };
}

/**
 * `Timeline` declares its two canvases as the real `HTMLCanvasElement`, which the partial double
 * above deliberately is not. The helper is the one place that bridges the two, and it is documented
 * as such rather than spread across every construction site.
 */
function timelineSurface(): HTMLCanvasElement { return canvas() as unknown as HTMLCanvasElement; }

/**
 * The pointer the drag-release below is driven with.
 *
 * `Timeline.up` takes a `GesturePointerLike`, which declares the buttons and modifiers a real
 * `MouseEvent`/`PointerEvent` carries. The release under test only ever reads `clientX`/`clientY` —
 * the drag it closes is already open and the modifier flags are consulted on the way *down* — so the
 * fixture passes the two coordinates it computes and this helper is the one documented place that
 * bridges them to the full shape.
 */
function gesturePointer(clientX: number, clientY: number): Parameters<Timeline['up']>[0] {
  const open: unknown = { clientX, clientY };
  return open as Parameters<Timeline['up']>[0];
}

/**
 * The session as `Timeline` sees it: the real `EditorSession`, viewed through the interface
 * `Timeline` declares.
 *
 * `TimelineSession` is an open bag (`[key: string]: unknown`), and a class type never carries an
 * index signature, so `EditorSession` neither satisfies nor overlaps that type: TypeScript rejects a
 * direct assertion because the two "do not sufficiently overlap". The session carries every named
 * member the timeline reads, so the type is bridged through `unknown` in this one documented spot —
 * `any` would hide a genuine mismatch, and re-declaring the session shape here would drift from the
 * class it is standing in for.
 */
function timelineSession(session: EditorSession): TimelineSession {
  const open: unknown = session;
  return open as TimelineSession;
}

function editor() {
  const session = new EditorSession();
  const getSession = (): TimelineSession => timelineSession(session);
  const timeline = new Timeline(timelineSurface(), timelineSurface(), getSession, () => {}, () => {});
  return { session, timeline };
}

/** The audio transport slice `EditorPlayback` drives; the real class satisfies it structurally. */
interface TransportDouble {
  time: number;
  duration: number;
  rate: number;
  playing: boolean;
  pause(): void;
  seek(seconds: number): void;
  play(): Promise<void>;
}

/**
 * The hit-sound scheduler slice `EditorPlayback.toggle` drives.
 *
 * `prepare` resolves to `undefined` here, which is what the real `HitSounds.prepare` does; the
 * generic keeps that explicit instead of leaving the promise's value type inferred as `unknown`.
 */
interface SoundsDouble {
  stop(): void;
  prepare(): Promise<void>;
}

/** The `{ scrollSpeed, scrollAcceleration }` bag the wheel handler reads; both are required by `PlaybackWheelSettings`. */
interface WheelSettingsDouble { scrollSpeed: number; scrollAcceleration: boolean; }

/** A storage stub for the preference round-trip; `PreferenceStorage` is the module's own contract. */
function storageDouble(): PreferenceStorage & { value: string | undefined } {
  const stub = { value: undefined as string | undefined,
    getItem(): string | null { return stub.value ?? null; },
    setItem(key: string, next: string): void { stub.value = next; } };
  return stub;
}

test('滚轮向上暂停并定位真实时间，继续从新位置播放；准备播放可被滚轮取消', async () => {
  let resolvePreparation: (() => void) | undefined;
  const sounds: SoundsDouble = { stop() {}, prepare: () => new Promise<void>(resolve => { resolvePreparation = resolve; }) };
  const audio: TransportDouble = { time: 10, duration: 120, rate: 1, playing: true, pause() { this.playing = false; }, seek(seconds: number) { this.time = seconds; }, async play() { this.playing = true; } };
  let visible = 0;
  const playback = new EditorPlayback(audio, sounds, () => { visible = audio.time; });
  const settings: WheelSettingsDouble = { scrollSpeed: 5, scrollAcceleration: false };
  playback.wheel({ deltaY: -100 }, settings, 0);
  assert.equal(audio.playing, false); assert.equal(visible, 10.06);
  const chart = createChart();
  const request = playback.toggle(chart); resolvePreparation?.(); await request;
  assert.equal(audio.time, 10.06); assert.equal(audio.playing, true);
  playback.pause(); const delayed = playback.toggle(chart);
  playback.wheel({ deltaY: 100 }, settings, 1); resolvePreparation?.(); await delayed;
  assert.equal(audio.playing, false); assert.equal(audio.time, 10);
  assert.ok(Math.abs(wheelSeconds(-100, 120, 5, 2, false, 0, true) - 0.6) < 1e-10);
});

test('第二次空格能取消仍在准备的播放，按键重复不会产生隐式恢复', async () => {
  let ready: (() => void) | undefined;
  const audio: TransportDouble = { time: 0, duration: 120, rate: 1, playing: false, pause() { this.playing = false; }, seek() {}, async play() { this.playing = true; } };
  const sounds: SoundsDouble = { stop() {}, prepare: () => new Promise<void>(resolve => { ready = resolve; }) };
  const playback = new EditorPlayback(audio, sounds, () => {});
  const chart = createChart();
  const first = playback.toggle(chart); await playback.toggle(chart); ready?.(); await first;
  assert.equal(audio.playing, false);
});

test('横线按秒映射跨 BPM，竖线奇偶和小数数量与吸附共享同一格点', () => {
  const tempo = new TempoMap([{ bpm: 120, startTime: [0, 0, 1] }, { bpm: 240, startTime: [4, 0, 1] }]);
  assert.equal(beatValue(snapTime(2.04, 4, tempo)), 4.25);
  assert.equal(snapPosition(35, 11), 0);
  assert.equal(Math.abs(snapPosition(0, 10)), 75);
  assert.equal(snapPosition(35, 11, false), 35);
  assert.equal(verticalGrid(3.5).spacing, 540);
  const { timeline } = editor(); timeline.tempo = tempo;
  assert.equal(timeline.scale, 500);
  assert.equal(timeline.vertical(3) - timeline.vertical(4), 250);
  assert.equal(timeline.vertical(4) - timeline.vertical(5), 125);
});

test('Hold 两次定位固定首次 X，反向放置排序，同拍不制造一拍 Hold', () => {
  const { session, timeline } = editor();
  timeline.cursor = { x: timeline.horizontal(135), y: timeline.vertical(4) };
  timeline.addAtCursor(2); assert.equal(session.notes.length, 0);
  timeline.cursor = { x: timeline.horizontal(405), y: timeline.vertical(2) };
  timeline.addAtCursor(2);
  assert.equal(session.notes[0].positionX, 135); assert.equal(beatValue(session.notes[0].startTime), 2); assert.equal(beatValue(session.notes[0].endTime), 4);
  timeline.addAtCursor(2); timeline.addAtCursor(2); assert.equal(session.notes.length, 1);
  timeline.addAtCursor(2); timeline.cancelPlacement(); assert.equal(session.notes.length, 1); assert.equal(timeline.pendingHold, null);
});

test('拖动实时值和落点一致，对未在网格上的音符吸附绝对目标而非位移', () => {
  const { session, timeline } = editor(); session.insertNotes([createNote(1, 2.1, 23)]);
  const start = { x: timeline.horizontal(23), y: timeline.vertical(2.1) };
  timeline.drag = { kind: 'move', anchor: 0, start, current: { x: start.x + 40, y: start.y - 15 } };
  const ghost = timeline.movedNote(session.notes[0]);
  assert.equal(ghost.positionX, 135); assert.equal(beatValue(ghost.startTime), 2.25);
  timeline.up(gesturePointer(start.x + 40, start.y - 15));
  assert.deepEqual(session.notes[0], ghost); session.travel('undo'); assert.equal(session.notes[0].positionX, 23);
});

test('事件继承前一终值与缓动，拒绝冲突；两次定位不产生隐式一拍事件', () => {
  const { session, timeline } = editor();
  // `EditorSession.line` is optional because a chart may lack a line at `lineIndex`; `createChart`
  // always builds one. `eventLayers` entries are `Partial<Record<AnyEventType, ChartEvent[]>>`, so
  // each track is optional as well. Placing an event replaces the document, so the track has to be
  // re-read through the session every time rather than bound once to a stale array.
  const moveXEvents = (): ChartEvent[] => session.line?.eventLayers[0].moveXEvents ?? [];
  const line = session.line;
  assert.ok(line);
  line.eventLayers[0].moveXEvents = [{ ...createEvent(5, 42, 0, 2), easingType: 7 }];
  // The fifth parameter is the easing type; the omitted argument is `undefined`, so passing it
  // explicitly keeps the same call the original made.
  const candidate = placedEvent(session, 'moveXEvents', 4, 2, undefined);
  assert.ok(candidate);
  assert.equal(candidate.start, 42); assert.equal(candidate.end, 42); assert.equal(candidate.easingType, 7);
  assert.throws(() => placedEvent(session, 'moveXEvents', 1, 3, undefined));
  assert.equal(placedEvent(session, 'moveXEvents', 2, 2, undefined), null);
  timeline.eventInteraction.place('moveXEvents', 2); assert.equal(moveXEvents().length, 1);
  timeline.eventInteraction.place('moveXEvents', 4, 3); assert.equal(moveXEvents().length, 2);
  assert.equal(moveXEvents()[1].easingType, 3);
  const prefs = migratePreferences(); const key = { key: 'r' };
  assert.equal(shortcutAction(key, prefs, 'notes'), 'AddHold'); assert.equal(shortcutAction(key, prefs, 'events'), 'AddEvent');
});

test('打击特效 31 帧按谱面秒播放，缓动图来自数学函数，判定线用原尺寸', () => {
  assert.equal(hitFrame(0), 1); assert.equal(hitFrame(0.015), 2); assert.equal(hitFrame(0.45), 31); assert.equal(hitFrame(HIT_DURATION), null);
  assert.equal(DEFAULT_LINE_WIDTH, 4000); assert.equal(DEFAULT_LINE_HEIGHT, 5);
  assert.match(easingPicture(1), /<svg/); assert.notEqual(easingPicture(1), easingPicture(7)); assert.doesNotMatch(easingPicture(1), /img-|NaN/);
});

test('Y 缩放、网格、实时预览和音量跨关闭恢复，非法存储安全回退', () => {
  const storage = storageDouble();
  const preferences = { scale: 333, division: 12, gridCount: 10, snapX: false, realtime: true, realtimeAlpha: 0.35, volume: 0.2 };
  writeEditorPreferences(preferences, storage); assert.deepEqual(readEditorPreferences(storage), preferences);
  storage.value = '{broken'; assert.deepEqual(readEditorPreferences(storage), {});
});
