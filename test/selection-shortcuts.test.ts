import test from 'node:test';
import assert from 'node:assert/strict';
import { PasteGesture } from '../src/ui/paste-gesture.ts';
import type { PasteContext } from '../src/ui/paste-gesture.ts';
import { applyNumberShortcut } from '../src/application/number-shortcuts.ts';
import type { NumberShortcutSession } from '../src/application/number-shortcuts.ts';
import { EditorSession } from '../src/application/session.ts';
import { Timeline } from '../src/ui/timeline.ts';
import type { TimelineSession } from '../src/ui/timeline.ts';
import { createEvent, createNote } from '../src/core/chart.ts';
import { migratePreferences, shortcutAction } from '../src/core/preferences.ts';
import { TempoMap } from '../src/core/tempo.ts';
import type { AnyEventType } from '../src/core/types.ts';

/**
 * One `[name, argument]` pair recorded by the `paste`/`open` callbacks the gesture is built with.
 *
 * The fixture pushes both `['paste', context]` and `['open']`, so the argument slot is optional and
 * the name is a plain string rather than a union of the two literals.
 */
type GestureCall = [name: string] | [name: string, argument: unknown];

/**
 * A structural double for the two canvases `Timeline` is built on.
 *
 * The constructor only reads the CSS box and registers listeners, so the test supplies those
 * members and nothing else. `left` is the one field the fixture varies.
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

/**
 * `Timeline` declares its canvases as the real `HTMLCanvasElement`, which the partial double above
 * deliberately is not. This helper is the single documented place that bridges the two.
 */
function timelineSurface(double: CanvasDouble): HTMLCanvasElement {
  return double as unknown as HTMLCanvasElement;
}

/**
 * The session as `Timeline` sees it: the real `EditorSession`, viewed through the interface
 * `Timeline` declares.
 *
 * `TimelineSession` carries optional members the editor only attaches at runtime, and a class type
 * never carries an index signature, so the two do not "sufficiently overlap" for a direct
 * assertion. The session holds every named member the timeline reads, so the bridge goes through
 * `unknown` in this one documented spot.
 */
function timelineSession(session: EditorSession): TimelineSession {
  const open: unknown = session;
  return open as TimelineSession;
}

/**
 * The session as `applyNumberShortcut` sees it.
 *
 * `NumberShortcutSession` extends `EventEditSession`, whose members are spelled out structurally
 * rather than importing the class; `EditorSession` satisfies those named members, but the interface
 * is an open shape the class cannot be asserted to directly. Bridged through `unknown` here.
 */
function shortcutSession(session: EditorSession): NumberShortcutSession {
  const open: unknown = session;
  return open as NumberShortcutSession;
}

/** The pointer stand-in the timeline handlers are driven with; only these members are read. */
interface PointerDouble {
  clientX: number;
  clientY: number;
  button: number;
  pointerId: number;
  shiftKey: boolean;
  preventDefault(): void;
}

/**
 * The double as the timeline's pointer handlers see it.
 *
 * `Timeline.down`/`up`/`updateRectangle`/`finishRectangle` and `EventInteraction.down`/`up` all take
 * a real pointer event, which this partial is not: it carries only the six members the handlers
 * read. The bridge is confined to these call sites.
 */
function pointerEvent(double: PointerDouble): PointerEvent {
  return double as unknown as PointerEvent;
}

/**
 * The `eventRects` entries the fixture installs.
 *
 * `EventInteraction.hit` reads `type`, `index`, `x`, `y`, `width` and `height`, and the multi-line
 * paths additionally compare `lineIndex`; the fixture's rectangle predates the multi-line view and
 * deliberately carries no `lineIndex`, so the field is optional here and stays absent at runtime.
 * Spelled out so the literal is checked against what the hit test consumes.
 */
interface EventRectEntry {
  type: AnyEventType;
  index: number;
  lineIndex?: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

function gestureFixture() {
  const calls: GestureCall[] = []; let timer: (() => void) | null = null; let valid = true;
  const gesture = new PasteGesture({ paste: context => calls.push(['paste', context]), open: () => calls.push(['open']),
    valid: () => valid, schedule: callback => { timer = callback; return 1; }, unschedule: () => { timer = null; } });
  const key = (value = 'v', repeat = false) => ({ key: value, repeat, preventDefault() {} });
  return { gesture, calls, key, elapsed: () => timer?.(), invalidate: () => { valid = false; } };
}

/**
 * The `{ session, chart, lineIndex, targetLineIndex, layer, beat }` bag `PasteContext` describes.
 *
 * The gesture fixtures above pass a bare `{}` or `{ beat }`: the callbacks never read the context,
 * they only carry it to the `paste`/`open` collaborators. This is the one place that names the
 * shape, and the casts at those call sites document that the partial is deliberate.
 */
type PasteContextDouble = Partial<PasteContext>;

test('默认长按计时器不以 PasteGesture 作为宿主接收者，打开、松键、再次打开均可继续', context => {
  let callback: (() => void) | undefined; let clears = 0; const calls: string[] = []; const errors: Error[] = [];
  context.mock.method(globalThis, 'setTimeout', function (this: unknown, handler: () => void) {
    assert.equal(this, undefined); callback = handler; return 7;
  });
  context.mock.method(globalThis, 'clearTimeout', function (this: unknown, timer: number) {
    assert.equal(this, undefined); assert.equal(timer, 7); clears++;
  });
  const gesture = new PasteGesture({ paste: () => calls.push('paste'), open: () => calls.push('history'), valid: () => true, reportError: error => errors.push(error) });
  const key = { key: 'v', ctrlKey: true, preventDefault() {} };
  const noContext: PasteContextDouble = {};
  gesture.down(key, noContext as PasteContext); assert.deepEqual(errors, []); callback?.(); gesture.up(key);
  gesture.down(key, noContext as PasteContext); gesture.up(key);
  gesture.down(key, noContext as PasteContext); callback?.(); gesture.up({ ...key, key: 'Control' });
  assert.deepEqual(calls, ['history', 'paste', 'history']); assert.equal(clears, 3);
  assert.equal(gesture.pending, null); assert.deepEqual(errors, []);
});

test('计时器或历史渲染出错仍清理长按状态，不让后续取消和快捷键重复抛错', () => {
  // `reportError` reads `.message`, so the recorded values are the message strings.
  const errors: string[] = []; const key = { key: 'v', preventDefault() {} };
  const noContext: PasteContextDouble = {};
  const gesture = new PasteGesture({ paste() {}, open() {}, valid: () => true, schedule() { throw new Error('schedule'); }, reportError: error => errors.push(error.message) });
  gesture.down(key, noContext as PasteContext); assert.equal(gesture.pending, null); gesture.cancel();
  // `cancel()` only reads `timer`, but `PastePending` declares `releaseKeys` as required, so the
  // literal carries an empty list rather than leaving the field off the shape the gesture defines.
  gesture.pending = { context: noContext as PasteContext, key: 'v', opened: false, releaseKeys: [], timer: 1 }; gesture.unschedule = () => { throw new Error('cancel'); };
  gesture.cancel(); assert.equal(gesture.pending, null); gesture.cancel();
  assert.deepEqual(errors, ['schedule', 'cancel']);
  let callback: (() => void) | undefined;
  gesture.schedule = handler => { callback = handler; return 2; }; gesture.unschedule = () => {};
  gesture.open = () => { throw new Error('render'); };
  gesture.down(key, noContext as PasteContext); callback?.(); assert.equal(gesture.pending, null); assert.equal(errors.at(-1), 'render');
});

test('短按 Ctrl+V 在松键时粘贴一次，释放 Ctrl 也结束手势', () => {
  const { gesture, calls, key } = gestureFixture(); const context: PasteContextDouble = { beat: 4 };
  gesture.down(key(), context as PasteContext); assert.deepEqual(calls, []);
  gesture.down(key('v', true), context as PasteContext); gesture.up(key()); gesture.up(key('Control'));
  assert.deepEqual(calls, [['paste', context]]);
  gesture.down(key(), context as PasteContext); gesture.up(key('Control')); gesture.up(key());
  assert.equal(calls.length, 2);
});

test('长按只打开历史一次，松开不粘贴；取消和上下文变更不误粘贴', () => {
  const fixture = gestureFixture(); const { gesture, calls, key } = fixture;
  const noContext: PasteContextDouble = {};
  gesture.down(key(), noContext as PasteContext); fixture.elapsed(); gesture.down(key('v', true), noContext as PasteContext); gesture.up(key());
  assert.deepEqual(calls, [['open']]);
  gesture.down(key(), noContext as PasteContext); gesture.cancel(); fixture.elapsed(); gesture.up(key());
  assert.equal(calls.length, 1);
  gesture.down(key(), noContext as PasteContext); fixture.invalidate(); fixture.elapsed(); gesture.up(key());
  assert.equal(calls.length, 1); assert.equal(gesture.pending, null);
});

test('A 镜像单音符、S 切换合法方向且可撤销，多选不适用', () => {
  const session = new EditorSession(); session.insertNotes([createNote(1, 1, 123)]); session.focus = 'notes';
  applyNumberShortcut(shortcutSession(session), 'NumberMirror'); assert.equal(session.notes[0].positionX, -123);
  applyNumberShortcut(shortcutSession(session), 'NumberFill'); assert.equal(session.notes[0].above, 2);
  session.travel('undo'); assert.equal(session.notes[0].above, 1);
  session.insertNotes([createNote(2, 2, 0, 3)]);
  applyNumberShortcut(shortcutSession(session), 'NumberFill'); assert.equal(session.notes[1].above, 0);
  applyNumberShortcut(shortcutSession(session), 'NumberFill'); assert.equal(session.notes[1].above, 1);
  session.selection = new Set([0, 1]); assert.equal(applyNumberShortcut(shortcutSession(session), 'NumberMirror'), false);
  const preferences = migratePreferences();
  assert.equal(shortcutAction({ key: 'a' }, preferences), 'NumberMirror');
  assert.equal(shortcutAction({ key: 's' }, preferences), 'NumberFill');
  assert.equal(shortcutAction({ key: 's', ctrlKey: true }, preferences), 'Save');
  assert.equal(shortcutAction({ key: 'a', ctrlKey: true }, preferences), 'SelectAll');
});

test('事件 A 取反并同步绑定组；透明度 A/S 填尾值，钩定同步首值', () => {
  const session = new EditorSession(); session.focus = 'events';
  // `EditorSession.line` is optional because a chart may lack a line at `lineIndex`, and
  // `eventLayers` entries are `Partial<Record<AnyEventType, ChartEvent[]>>`, so each track is
  // optional too. Every read goes through the session at assertion time rather than being bound
  // once: a chart edit replaces the document, so a hoisted track would report stale data.
  const line = session.line;
  assert.ok(line);
  line.eventLayers[0].moveXEvents = [
    { ...createEvent(10, 20, 0, 1), linkgroup: 1 }, { ...createEvent(10, 20, 1, 2), linkgroup: 1 },
  ];
  session.eventSelection = new Set(['moveXEvents:0']);
  const moveX = (): { start: unknown; end: unknown }[] => (session.line?.eventLayers[0].moveXEvents ?? []);
  const alpha = (): { start: unknown; end: unknown; inst?: unknown }[] => (session.line?.eventLayers[0].alphaEvents ?? []);
  assert.equal(applyNumberShortcut(shortcutSession(session), 'NumberFill'), false);
  applyNumberShortcut(shortcutSession(session), 'NumberMirror');
  assert.deepEqual(moveX().map(event => [event.start, event.end]), [[-10, -20], [-10, -20]]);
  session.travel('undo'); assert.equal(moveX()[0].start, 10);
  session.line!.eventLayers[0].alphaEvents = [createEvent(100, 200, 0, 1)]; session.eventSelection = new Set(['alphaEvents:0']);
  applyNumberShortcut(shortcutSession(session), 'NumberMirror'); assert.equal(alpha()[0].start, 100); assert.equal(alpha()[0].end, 0);
  session.line!.eventLayers[0].alphaEvents[0].inst = 1;
  applyNumberShortcut(shortcutSession(session), 'NumberFill'); assert.equal(alpha()[0].start, 255); assert.equal(alpha()[0].end, 255);
  for (const type of ['textEvents', 'colorEvents', 'paintEvents'] as AnyEventType[]) {
    session.eventSelection = new Set([`${type}:0`]); assert.equal(applyNumberShortcut(shortcutSession(session), 'NumberMirror'), false);
  }
});

function canvas(left: number): CanvasDouble {
  return { clientWidth: 500, clientHeight: 600, style: {}, addEventListener() {}, focus() {}, setPointerCapture() {},
    getBoundingClientRect: () => ({ left, top: 0, width: 500, height: 600 }) };
}
function pointer(clientX: number, clientY: number, shiftKey = false): PointerDouble {
  return { clientX, clientY, button: 0, pointerId: 1, shiftKey, preventDefault() {} };
}
function selectionFixture() {
  const session = new EditorSession(); session.insertNotes([createNote(1, 0.5, 0)]); session.selection.clear();
  const line = session.line;
  assert.ok(line);
  line.eventLayers[0] = { moveXEvents: [createEvent(0, 10, 0.5, 0.8)] };
  const timeline = new Timeline(timelineSurface(canvas(0)), timelineSurface(canvas(520)), () => timelineSession(session), () => {}, () => {});
  // No `lineIndex`: the original fixture carried none, and `EventInteraction`'s multi-line paths
  // compare the rectangle's line against the session's, so adding one would change which events the
  // stroke selects. The field is left absent to keep the hit test exactly as it was.
  const rectangles: EventRectEntry[] = [{ type: 'moveXEvents', index: 0, x: 110, y: 350, width: 60, height: 100 }];
  // `Timeline.eventRects` is declared as `EventRectangle[]`, which requires `lineIndex`; the fixture
  // above deliberately omits it, so the assignment is bridged through `unknown` in this one spot
  // rather than adding a field that would change the hit test.
  timeline.eventRects = rectangles as unknown as Timeline['eventRects'];
  return { session, timeline };
}

test('音符框选跨到事件区结束，选框越过边界且不创建事件框选', () => {
  const { session, timeline } = selectionFixture();
  timeline.down(pointerEvent(pointer(100, 550, true))); timeline.up(pointerEvent(pointer(100, 550, true)));
  timeline.updateRectangle(pointerEvent(pointer(900, 300)));
  // `Timeline.drag` is nullable and the assertion above has just proved a rectangle drag is open.
  const drag = timeline.drag;
  assert.ok(drag);
  assert.equal(drag.current?.x, 900);
  timeline.eventInteraction.down(pointerEvent(pointer(900, 300)));
  assert.deepEqual([...session.selection], [0]); assert.equal(session.eventSelection.size, 0);
  assert.equal(session.focus, 'notes'); assert.equal(timeline.drag, null); assert.equal(timeline.eventInteraction.drag, null);
});

test('框选起点在滚轮滚动后保持绝对时间，选中跨越视野的音符和事件', () => {
  for (const kind of ['notes', 'events']) for (const reverse of [false, true]) {
    const { session, timeline } = selectionFixture();
    timeline.tempo = new TempoMap([{ bpm: 120, startTime: [0, 0, 1] }, { bpm: 180, startTime: [30, 0, 1] }]);
    // Re-read the line after every chart-replacing edit rather than hoisting a binding, so the
    // assertions below never observe a stale document.
    const line = session.line;
    assert.ok(line);
    line.bpmfactor = 2;
    line.notes = [createNote(1, 9, 0), createNote(1, 10, 0), createNote(1, 50, 0), createNote(1, 100, 0), createNote(1, 101, 0), createNote(1, 50, 675)];
    line.eventLayers[0] = { moveXEvents: [createEvent(0, 1, 9, 9.5), createEvent(1, 2, 10, 11), createEvent(2, 3, 50, 51), createEvent(3, 4, 99, 100), createEvent(4, 5, 101, 102)] };
    const first = reverse ? 100 : 10; const last = reverse ? 10 : 100;
    timeline.origin = first;
    const horizontal = kind === 'notes' ? 220 : 530;
    const endHorizontal = kind === 'notes' ? 280 : 605;
    const interaction = kind === 'notes' ? timeline : timeline.eventInteraction;
    interaction.down(pointerEvent(pointer(horizontal, timeline.vertical(first), true)));
    interaction.up(pointerEvent(pointer(horizontal, timeline.vertical(first), true)));
    const selection = timeline.rectangleSelection();
    assert.ok(selection);
    const drag = selection.drag;
    const anchorSeconds = drag.startSeconds;
    timeline.origin = last;
    assert.equal(drag.startSeconds, anchorSeconds);
    assert.equal(timeline.rectangleStart(drag).y, timeline.vertical(first));
    timeline.finishRectangle(pointerEvent(pointer(endHorizontal, timeline.vertical(last))));
    assert.deepEqual(kind === 'notes' ? [...session.selection] : [...session.eventSelection], kind === 'notes' ? [1, 2, 3] : ['moveXEvents:1', 'moveXEvents:2', 'moveXEvents:3']);
  }
});

test('放置模式也可 Shift 开始事件框选，跨到音符区结束时只选中事件', () => {
  const { session, timeline } = selectionFixture(); timeline.tool = 1;
  timeline.eventInteraction.down(pointerEvent(pointer(950, 550, true))); timeline.eventInteraction.up(pointerEvent(pointer(950, 550, true)));
  timeline.updateRectangle(pointerEvent(pointer(100, 300)));
  const drag = timeline.eventInteraction.drag;
  assert.ok(drag);
  assert.equal(drag.current?.x, -420);
  timeline.down(pointerEvent(pointer(100, 300)));
  assert.deepEqual([...session.eventSelection], ['moveXEvents:0']); assert.equal(session.selection.size, 0);
  assert.equal(session.focus, 'events'); assert.equal(timeline.eventInteraction.drag, null); assert.equal(timeline.drag, null);
  assert.equal(session.notes.length, 1);
});
