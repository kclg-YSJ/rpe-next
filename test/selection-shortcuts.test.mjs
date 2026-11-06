import test from 'node:test';
import assert from 'node:assert/strict';
import { PasteGesture } from '../src/ui/paste-gesture.mjs';
import { applyNumberShortcut } from '../src/application/number-shortcuts.mjs';
import { EditorSession } from '../src/application/session.mjs';
import { Timeline } from '../src/ui/timeline.mjs';
import { createEvent, createNote } from '../src/core/chart.mjs';
import { migratePreferences, shortcutAction } from '../src/core/preferences.mjs';
import { TempoMap } from '../src/core/tempo.mjs';

function gestureFixture() {
  const calls = []; let timer; let valid = true;
  const gesture = new PasteGesture({ paste: context => calls.push(['paste', context]), open: () => calls.push(['open']),
    valid: () => valid, schedule: callback => { timer = callback; return 1; }, unschedule: () => { timer = null; } });
  const key = (value = 'v', repeat = false) => ({ key: value, repeat, preventDefault() {} });
  return { gesture, calls, key, elapsed: () => timer?.(), invalidate: () => { valid = false; } };
}

test('默认长按计时器不以 PasteGesture 作为宿主接收者，打开、松键、再次打开均可继续', context => {
  let callback; let clears = 0; const calls = []; const errors = [];
  context.mock.method(globalThis, 'setTimeout', function (handler) {
    assert.equal(this, undefined); callback = handler; return 7;
  });
  context.mock.method(globalThis, 'clearTimeout', function (timer) {
    assert.equal(this, undefined); assert.equal(timer, 7); clears++;
  });
  const gesture = new PasteGesture({ paste: () => calls.push('paste'), open: () => calls.push('history'), valid: () => true, reportError: error => errors.push(error) });
  const key = { key: 'v', ctrlKey: true, preventDefault() {} };
  gesture.down(key, {}); assert.deepEqual(errors, []); callback(); gesture.up(key);
  gesture.down(key, {}); gesture.up(key);
  gesture.down(key, {}); callback(); gesture.up({ ...key, key: 'Control' });
  assert.deepEqual(calls, ['history', 'paste', 'history']); assert.equal(clears, 3);
  assert.equal(gesture.pending, null); assert.deepEqual(errors, []);
});

test('计时器或历史渲染出错仍清理长按状态，不让后续取消和快捷键重复抛错', () => {
  const errors = []; const key = { key: 'v', preventDefault() {} };
  const gesture = new PasteGesture({ paste() {}, open() {}, valid: () => true, schedule() { throw new Error('schedule'); }, reportError: error => errors.push(error.message) });
  gesture.down(key, {}); assert.equal(gesture.pending, null); gesture.cancel();
  gesture.pending = { timer: 1 }; gesture.unschedule = () => { throw new Error('cancel'); };
  gesture.cancel(); assert.equal(gesture.pending, null); gesture.cancel();
  assert.deepEqual(errors, ['schedule', 'cancel']);
  let callback;
  gesture.schedule = handler => { callback = handler; return 2; }; gesture.unschedule = () => {};
  gesture.open = () => { throw new Error('render'); };
  gesture.down(key, {}); callback(); assert.equal(gesture.pending, null); assert.equal(errors.at(-1), 'render');
});

test('短按 Ctrl+V 在松键时粘贴一次，释放 Ctrl 也结束手势', () => {
  const { gesture, calls, key } = gestureFixture(); const context = { beat: 4 };
  gesture.down(key(), context); assert.deepEqual(calls, []);
  gesture.down(key('v', true), context); gesture.up(key()); gesture.up(key('Control'));
  assert.deepEqual(calls, [['paste', context]]);
  gesture.down(key(), context); gesture.up(key('Control')); gesture.up(key());
  assert.equal(calls.length, 2);
});

test('长按只打开历史一次，松开不粘贴；取消和上下文变更不误粘贴', () => {
  const fixture = gestureFixture(); const { gesture, calls, key } = fixture;
  gesture.down(key(), {}); fixture.elapsed(); gesture.down(key('v', true), {}); gesture.up(key());
  assert.deepEqual(calls, [['open']]);
  gesture.down(key(), {}); gesture.cancel(); fixture.elapsed(); gesture.up(key());
  assert.equal(calls.length, 1);
  gesture.down(key(), {}); fixture.invalidate(); fixture.elapsed(); gesture.up(key());
  assert.equal(calls.length, 1); assert.equal(gesture.pending, null);
});

test('A 镜像单音符、S 切换合法方向且可撤销，多选不适用', () => {
  const session = new EditorSession(); session.insertNotes([createNote(1, 1, 123)]); session.focus = 'notes';
  applyNumberShortcut(session, 'NumberMirror'); assert.equal(session.notes[0].positionX, -123);
  applyNumberShortcut(session, 'NumberFill'); assert.equal(session.notes[0].above, 2);
  session.travel('undo'); assert.equal(session.notes[0].above, 1);
  session.insertNotes([createNote(2, 2, 0, 3)]);
  applyNumberShortcut(session, 'NumberFill'); assert.equal(session.notes[1].above, 0);
  applyNumberShortcut(session, 'NumberFill'); assert.equal(session.notes[1].above, 1);
  session.selection = new Set([0, 1]); assert.equal(applyNumberShortcut(session, 'NumberMirror'), false);
  const preferences = migratePreferences();
  assert.equal(shortcutAction({ key: 'a' }, preferences), 'NumberMirror');
  assert.equal(shortcutAction({ key: 's' }, preferences), 'NumberFill');
  assert.equal(shortcutAction({ key: 's', ctrlKey: true }, preferences), 'Save');
  assert.equal(shortcutAction({ key: 'a', ctrlKey: true }, preferences), 'SelectAll');
});

test('事件 A 取反并同步绑定组；透明度 A/S 填尾值，钩定同步首值', () => {
  const session = new EditorSession(); session.focus = 'events';
  session.line.eventLayers[0].moveXEvents = [
    { ...createEvent(10, 20, 0, 1), linkgroup: 1 }, { ...createEvent(10, 20, 1, 2), linkgroup: 1 },
  ];
  session.eventSelection = new Set(['moveXEvents:0']);
  assert.equal(applyNumberShortcut(session, 'NumberFill'), false);
  applyNumberShortcut(session, 'NumberMirror');
  assert.deepEqual(session.line.eventLayers[0].moveXEvents.map(event => [event.start, event.end]), [[-10, -20], [-10, -20]]);
  session.travel('undo'); assert.equal(session.line.eventLayers[0].moveXEvents[0].start, 10);
  session.line.eventLayers[0].alphaEvents = [createEvent(100, 200, 0, 1)]; session.eventSelection = new Set(['alphaEvents:0']);
  applyNumberShortcut(session, 'NumberMirror'); assert.equal(session.line.eventLayers[0].alphaEvents[0].start, 100); assert.equal(session.line.eventLayers[0].alphaEvents[0].end, 0);
  session.line.eventLayers[0].alphaEvents[0].inst = 1;
  applyNumberShortcut(session, 'NumberFill'); assert.equal(session.line.eventLayers[0].alphaEvents[0].start, 255); assert.equal(session.line.eventLayers[0].alphaEvents[0].end, 255);
  for (const type of ['textEvents', 'colorEvents', 'paintEvents']) {
    session.eventSelection = new Set([`${type}:0`]); assert.equal(applyNumberShortcut(session, 'NumberMirror'), false);
  }
});

function canvas(left) {
  return { clientWidth: 500, clientHeight: 600, style: {}, addEventListener() {}, focus() {}, setPointerCapture() {},
    getBoundingClientRect: () => ({ left, top: 0, width: 500, height: 600 }) };
}
function pointer(clientX, clientY, shiftKey = false) { return { clientX, clientY, button: 0, pointerId: 1, shiftKey, preventDefault() {} }; }
function selectionFixture() {
  const session = new EditorSession(); session.insertNotes([createNote(1, 0.5, 0)]); session.selection.clear();
  session.line.eventLayers[0] = { moveXEvents: [createEvent(0, 10, 0.5, 0.8)] };
  const timeline = new Timeline(canvas(0), canvas(520), () => session, () => {}, () => {});
  timeline.eventRects = [{ type: 'moveXEvents', index: 0, x: 110, y: 350, width: 60, height: 100 }];
  return { session, timeline };
}

test('音符框选跨到事件区结束，选框越过边界且不创建事件框选', () => {
  const { session, timeline } = selectionFixture();
  timeline.down(pointer(100, 550, true)); timeline.up(pointer(100, 550, true));
  timeline.updateRectangle(pointer(900, 300)); assert.equal(timeline.drag.current.x, 900);
  timeline.eventInteraction.down(pointer(900, 300, true));
  assert.deepEqual([...session.selection], [0]); assert.equal(session.eventSelection.size, 0);
  assert.equal(session.focus, 'notes'); assert.equal(timeline.drag, null); assert.equal(timeline.eventInteraction.drag, null);
});

test('框选起点在滚轮滚动后保持绝对时间，选中跨越视野的音符和事件', () => {
  for (const kind of ['notes', 'events']) for (const reverse of [false, true]) {
    const { session, timeline } = selectionFixture();
    timeline.tempo = new TempoMap([{ bpm: 120, startTime: [0, 0, 1] }, { bpm: 180, startTime: [30, 0, 1] }]);
    session.line.bpmfactor = 2;
    session.line.notes = [createNote(1, 9, 0), createNote(1, 10, 0), createNote(1, 50, 0), createNote(1, 100, 0), createNote(1, 101, 0), createNote(1, 50, 675)];
    session.line.eventLayers[0] = { moveXEvents: [createEvent(0, 1, 9, 9.5), createEvent(1, 2, 10, 11), createEvent(2, 3, 50, 51), createEvent(3, 4, 99, 100), createEvent(4, 5, 101, 102)] };
    const first = reverse ? 100 : 10; const last = reverse ? 10 : 100;
    timeline.origin = first;
    const horizontal = kind === 'notes' ? 220 : 530;
    const endHorizontal = kind === 'notes' ? 280 : 605;
    const interaction = kind === 'notes' ? timeline : timeline.eventInteraction;
    interaction.down(pointer(horizontal, timeline.vertical(first), true));
    interaction.up(pointer(horizontal, timeline.vertical(first), true));
    const drag = timeline.rectangleSelection().drag;
    const anchorSeconds = drag.startSeconds;
    timeline.origin = last;
    assert.equal(drag.startSeconds, anchorSeconds);
    assert.equal(timeline.rectangleStart(drag).y, timeline.vertical(first));
    timeline.finishRectangle(pointer(endHorizontal, timeline.vertical(last), true));
    assert.deepEqual(kind === 'notes' ? [...session.selection] : [...session.eventSelection], kind === 'notes' ? [1, 2, 3] : ['moveXEvents:1', 'moveXEvents:2', 'moveXEvents:3']);
  }
});

test('放置模式也可 Shift 开始事件框选，跨到音符区结束时只选中事件', () => {
  const { session, timeline } = selectionFixture(); timeline.tool = 1;
  timeline.eventInteraction.down(pointer(950, 550, true)); timeline.eventInteraction.up(pointer(950, 550, true));
  timeline.updateRectangle(pointer(100, 300)); assert.equal(timeline.eventInteraction.drag.current.x, -420);
  timeline.down(pointer(100, 300, true));
  assert.deepEqual([...session.eventSelection], ['moveXEvents:0']); assert.equal(session.selection.size, 0);
  assert.equal(session.focus, 'events'); assert.equal(timeline.eventInteraction.drag, null); assert.equal(timeline.drag, null);
  assert.equal(session.notes.length, 1);
});

test('音符与事件框选只允许 Shift 左键或中键收框，普通左右键不会覆盖正在进行的框选', () => {
  for (const area of ['notes', 'events']) for (const finish of ['shift', 'middle']) {
    const { session, timeline } = selectionFixture(); timeline.tool = 1;
    const interaction = area === 'notes' ? timeline : timeline.eventInteraction;
    const startX = area === 'notes' ? 100 : 950, endX = area === 'notes' ? 400 : 530;
    interaction.down(pointer(startX, 550, true)); interaction.up(pointer(startX, 550, true));
    const original = timeline.rectangleSelection().drag, chart = session.chart;
    for (const [button, shiftKey] of [[0, false], [2, false], [2, true]]) {
      const event = { ...pointer(endX, 300), button, shiftKey };
      assert.equal(timeline.finishRectangle(event), false);
      interaction.down(event); interaction.up(event);
      assert.equal(timeline.rectangleSelection().drag, original); assert.equal(session.chart, chart);
      assert.equal(session.selection.size, 0); assert.equal(session.eventSelection.size, 0);
    }
    interaction.down({ ...pointer(endX, 300, finish === 'shift'), button: finish === 'middle' ? 1 : 0 });
    assert.equal(timeline.rectangleSelection(), null);
    assert.equal(area === 'notes' ? session.selection.size : session.eventSelection.size, 1);
    assert.equal(session.chart, chart); assert.equal(timeline.pendingHold, null); assert.equal(timeline.eventInteraction.pending, null);
  }
});

test('多线未收框时普通左键平移超宽视区，保留绝对起点、选择和收框规则', () => {
  for (const area of ['notes', 'events']) {
    const { session, timeline } = selectionFixture();
    session.chart.judgeLineList.push(structuredClone(session.line), structuredClone(session.line));
    session.multiLineEnabled = true; session.multiLineIndices = [0,1,2]; session.multiLineMode = area; session.multiLineMerge = false;
    timeline.multiLineWidth = 400; timeline.multiLineEventWidth = 400; timeline.multiLineEventWidthExplicit = true;
    const interaction = area === 'notes' ? timeline : timeline.eventInteraction, base = area === 'notes' ? 0 : 520;
    const canvas = area === 'notes' ? timeline.notesCanvas : timeline.eventsCanvas;
    let capture;
    canvas.setPointerCapture = id => { capture = id; }; canvas.hasPointerCapture = id => capture === id;
    canvas.releasePointerCapture = () => { capture = null; };
    interaction.down(pointer(base+80,550,true)); interaction.up(pointer(base+80,550,true));
    const drag = timeline.rectangleSelection().drag, seconds = drag.startSeconds, worldX = drag.startWorldX, chart = session.chart;
    interaction.down(pointer(base+400,500));
    assert.equal(capture,1); assert.ok(drag.pan);
    interaction.move(pointer(base+100,480));
    assert.equal(timeline.multiLineScroll[area],300);
    assert.equal(drag.startSeconds,seconds); assert.equal(drag.startWorldX,worldX);
    assert.equal(timeline.rectangleStart(drag).x,worldX-300);
    interaction.up(pointer(base+100,480));
    assert.equal(timeline.rectangleSelection().drag,drag); assert.equal(drag.pan,undefined); assert.equal(capture,null);
    assert.equal(session.chart,chart); assert.equal(session.selection.size,0); assert.equal(session.eventSelection.size,0);
    assert.equal(timeline.finishRectangle(pointer(base+400,300)),false);
    // A cancelled pan does not use the cancellation event's (possibly zero) coordinates.
    assert.equal(timeline.beginRectanglePan(pointer(base+400,500),canvas),true);
    timeline.updateRectangle(pointer(base-5000,500));
    const maximum = timeline.multiLineViewportOffset(500,area);
    assert.equal(maximum,732);
    assert.equal(timeline.endRectanglePan({ ...pointer(0,0),type:'pointercancel' }),true);
    assert.equal(timeline.multiLineScroll[area],maximum); assert.equal(timeline.rectangleSelection().drag,drag);
    assert.equal(timeline.beginRectanglePan(pointer(base+100,500),canvas),true);
    timeline.updateRectangle(pointer(base+6000,500)); timeline.endRectanglePan();
    assert.equal(timeline.multiLineScroll[area],0);
    assert.equal(timeline.finishRectangle({ ...pointer(base+400,300),button:1 }),true);
    assert.equal(timeline.rectangleSelection(),null);
    // Escape uses cancelPlacement and releases a captured pointer as well.
    interaction.down(pointer(base+80,550,true)); interaction.up(pointer(base+80,550,true));
    timeline.beginRectanglePan(pointer(base+400,500),canvas); timeline.cancelPlacement();
    assert.equal(capture,null); assert.equal(timeline.rectangleSelection(),null);
  }
});

test('框选平移仅适用于超宽多线分列，其他按键、面板和可完全显示的列不启动', () => {
  const { session,timeline } = selectionFixture();
  timeline.down(pointer(80,550,true)); timeline.up(pointer(80,550,true));
  assert.equal(timeline.beginRectanglePan(pointer(400,500),timeline.notesCanvas),false);
  session.chart.judgeLineList.push(structuredClone(session.line)); session.multiLineEnabled=true; session.multiLineIndices=[0,1];
  timeline.multiLineWidth=200;
  assert.equal(timeline.beginRectanglePan(pointer(400,500),timeline.notesCanvas),false);
  timeline.multiLineWidth=400;
  for(const modifier of ['shiftKey','ctrlKey','altKey','metaKey']) assert.equal(timeline.beginRectanglePan({...pointer(400,500),[modifier]:true},timeline.notesCanvas),false);
  assert.equal(timeline.beginRectanglePan({...pointer(400,500),button:2},timeline.notesCanvas),false);
  assert.equal(timeline.beginRectanglePan(pointer(400,500),timeline.eventsCanvas),false);
  session.multiLineMode='notes'; session.multiLineMerge=true;
  assert.equal(timeline.beginRectanglePan(pointer(400,500),timeline.notesCanvas),false);
});
