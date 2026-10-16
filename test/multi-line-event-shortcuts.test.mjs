import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorSession } from '../src/application/session.ts';
import { createChart, createLine, createEvent } from '../src/core/chart.ts';
import { Timeline } from '../src/ui/timeline.ts';
import { applyNumberShortcut } from '../src/application/number-shortcuts.ts';
import { eventListAt, selectEvent, selectAllEvents, selectedEventEntries, deleteEvents, insertEventAt } from '../src/application/event-commands.ts';
import { deleteObjects } from '../src/application/clipboard.ts';

function fixture() {
  const chart = createChart(); chart.judgeLineList = Array.from({ length: 3 }, () => createLine());
  for (const line of chart.judgeLineList) {
    line.eventLayers[0].moveXEvents = [createEvent(10, 20, 1, 2), createEvent(30, 40, 3, 4)];
    line.eventLayers[0].alphaEvents = [{ ...createEvent(100, 200, 1, 2), inst: 1 }];
  }
  const session = new EditorSession(chart); session.setMultiLineEnabled(true, 'events'); session.multiLineIndices = [0, 1, 2]; session.focus = 'events';
  const canvas = () => ({ clientWidth: 500, clientHeight: 600, style: {}, addEventListener() {}, focus() {}, setPointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 500, height: 600 }) });
  const timeline = new Timeline(canvas(), canvas(), () => session, () => {}, () => {}, assert.fail);
  timeline.eventRects = [0, 1, 2].map(lineIndex => ({ lineIndex, type: 'moveXEvents', index: 0, x: 20 + lineIndex * 100, y: 200, width: 60, height: 80 }));
  const click = (lineIndex, ctrlKey = false) => {
    const pointer = { clientX: 50 + lineIndex * 100, clientY: 240, button: 0, pointerId: 1, ctrlKey, preventDefault() {} };
    timeline.eventInteraction.down(pointer); timeline.eventInteraction.up(pointer);
  };
  return { session, timeline, click };
}

test('多线事件连续单击替换全部选择，保持当前线并能独立编辑非当前线', () => {
  const { session, click } = fixture();
  click(0); click(1); click(2);
  assert.deepEqual(selectedEventEntries(session).map(entry => entry.lineIndex), [2]);
  assert.equal(session.eventSelection.size, 0); assert.equal(session.lineIndex, 0);
  assert.equal(session.multiSelectionIntent, null);
  assert.equal(applyNumberShortcut(session, 'NumberMirror'), true);
  assert.deepEqual(session.chart.judgeLineList.map(line => line.eventLayers[0].moveXEvents[0].end), [20, 20, -20]);
  session.travel('undo'); assert.equal(eventListAt(session, 2, 'moveXEvents')[0].end, 20);
  assert.deepEqual(selectedEventEntries(session).map(entry => entry.lineIndex), [2]);
});

test('Ctrl 跨线增减选择，点击已选成员仍可拖动整组，点击新成员替换整组', () => {
  const { session, click } = fixture();
  click(0); click(1, true);
  assert.deepEqual(selectedEventEntries(session).map(entry => entry.lineIndex), [0, 1]);
  click(1); assert.equal(selectedEventEntries(session).length, 2);
  assert.equal(applyNumberShortcut(session, 'NumberMirror'), false);
  click(0, true); assert.deepEqual(selectedEventEntries(session).map(entry => entry.lineIndex), [1]);
  click(2); assert.deepEqual(selectedEventEntries(session).map(entry => entry.lineIndex), [2]);
});

test('非当前线 A/S 填充钩定透明度，取反仍遵循所属线的绑定组且可撤销', () => {
  const { session } = fixture();
  selectEvent(session, 1, 'alphaEvents', 0);
  applyNumberShortcut(session, 'NumberMirror');
  assert.deepEqual([eventListAt(session, 1, 'alphaEvents')[0].start, eventListAt(session, 1, 'alphaEvents')[0].end], [0, 0]);
  applyNumberShortcut(session, 'NumberFill');
  assert.equal(eventListAt(session, 1, 'alphaEvents')[0].start, 255);
  assert.equal(eventListAt(session, 0, 'alphaEvents')[0].start, 100);
  session.travel('undo'); assert.equal(eventListAt(session, 1, 'alphaEvents')[0].end, 0);
  session.chart.judgeLineList[1].eventLayers[0].moveXEvents.forEach(event => { event.linkgroup = 7; });
  selectEvent(session, 1, 'moveXEvents', 0);
  applyNumberShortcut(session, 'NumberMirror');
  assert.deepEqual(eventListAt(session, 1, 'moveXEvents').map(event => event.end), [-20, -20]);
  assert.deepEqual(eventListAt(session, 0, 'moveXEvents').map(event => event.end), [20, 40]);
});

test('快捷删除按命中事件所属线执行，批量删除和撤销保留跨线选择', () => {
  const { session, click } = fixture(); click(1);
  selectEvent(session, 2, 'moveXEvents', 1, { replace: true }); deleteEvents(session);
  assert.deepEqual(session.chart.judgeLineList.map(line => line.eventLayers[0].moveXEvents.length), [2, 2, 1]);
  assert.equal(selectedEventEntries(session).length, 0);
  session.travel('undo'); assert.deepEqual(selectedEventEntries(session).map(entry => [entry.lineIndex, entry.index]), [[2, 1]]);
  click(1, true); assert.equal(deleteObjects(session), 2);
  assert.deepEqual(session.chart.judgeLineList.map(line => line.eventLayers[0].moveXEvents.length), [2, 1, 1]);
  session.travel('undo'); assert.equal(selectedEventEntries(session).length, 2);
});

test('全选只覆盖多线组及当前事件层，放置事件不会保留其他线的旧选择', () => {
  const { session } = fixture(); session.multiLineIndices = [1, 2];
  selectAllEvents(session, ['moveXEvents', 'alphaEvents']);
  assert.equal(selectedEventEntries(session).length, 6); assert.equal(session.eventSelection.size, 0);
  assert.equal(session.multiSelectionIntent, 'events');
  insertEventAt(session, 2, 'moveXEvents', createEvent(0, 1, 5, 6));
  assert.deepEqual(selectedEventEntries(session).map(entry => [entry.lineIndex, entry.index]), [[2, 2]]);
  session.eventLayer = 1;
  selectAllEvents(session, ['moveXEvents']); assert.equal(selectedEventEntries(session).length, 0);
});
