import test from 'node:test';
import assert from 'node:assert/strict';
import { createChart, createLine, createEvent } from '../src/core/chart.mjs';
import { beatValue } from '../src/core/beat.mjs';
import { TempoMap } from '../src/core/tempo.mjs';
import { easing, bezier } from '../src/core/easing.mjs';
import { EditorSession } from '../src/application/session.mjs';
import { cutEventParts, cutSelectedEvents, stickSelectedEvents, stickSelectedEventToNext } from '../src/application/event-tools.mjs';
import { eventListAt, selectedEventEntries, splitSelectedEvents } from '../src/application/event-commands.mjs';
import { migratePreferences } from '../src/core/preferences.mjs';
import { normalizeEditorPreferences } from '../src/platform/editor-preferences.mjs';

test('切割从最近横线向两端采样，保留余段、缓动结果和未知字段', () => {
  const source = { ...createEvent(0, 100, 0.1, 1.1), easingType: 5, custom: { value: 7 }, linkgroup: 3, inst: 1 };
  const parts = cutEventParts('moveXEvents', source, { division: 4, density: 2, beat: 0.6 });
  assert.deepEqual(parts.map(item => beatValue(item.startTime)), [0.1, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1]);
  assert.equal(beatValue(parts.at(-1).endTime), 1.1);
  for (const [index, part] of parts.entries()) {
    assert.ok(Math.abs(part.start - easing((beatValue(part.startTime) - 0.1), 5) * 100) < 1e-8);
    assert.equal(part.easingType, 1); assert.equal(part.inst, 0); assert.equal(part.linkgroup, 0); assert.deepEqual(part.custom, { value: 7 });
    if (index) { assert.deepEqual(parts[index - 1].endTime, part.startTime); assert.equal(parts[index - 1].end, part.start); }
  }
  assert.equal(source.inst, 1);
  const fromStart = cutEventParts('moveXEvents', source, { division: 4, density: 2, beat: 10 });
  assert.equal(beatValue(fromStart[1].startTime), 0.225);
});

test('切割 Bezier、颜色和透明度，文字/着色器/零长度不切割', () => {
  const source = { ...createEvent(0, 100, 0, 1), bezier: 1, bezierPoints: [0.1, 0.8, 0.7, 0.2] };
  const parts = cutEventParts('moveYEvents', source, { division: 2, density: 1 });
  assert.ok(Math.abs(parts[0].end - bezier(0.5, source.bezierPoints) * 100) < 1e-8);
  const colors = cutEventParts('colorEvents', createEvent([0, 1, 10], [255, 8, 100]), { division: 2, density: 1 });
  assert.deepEqual(colors[0].end, [127, 4, 55]);
  assert.equal(cutEventParts('alphaEvents', createEvent(0, 255), { division: 2, density: 1 })[0].end, 127);
  assert.equal(cutEventParts('textEvents', createEvent('a', 'b')), null);
  assert.equal(cutEventParts('paintEvents', createEvent()), null);
  assert.equal(cutEventParts('moveXEvents', createEvent(0, 1, 1, 1)), null);
  assert.throws(() => cutEventParts('speedEvents', createEvent(0, 1, 0, 10000), { density: 128 }), /过多/);
});

test('批量切割一次撤销，选择新段并保留跳过事件，其他层不变', () => {
  const session = new EditorSession();
  session.line.eventLayers[0].moveXEvents = [createEvent(0, 10, 1, 2), createEvent(5, 6, 0, 0.5)];
  session.line.extended.textEvents = [createEvent('a', 'b')];
  session.eventSelection = new Set(['moveXEvents:0', 'textEvents:0']);
  const original = session.chart;
  assert.deepEqual(cutSelectedEvents(session, { division: 2, density: 2 }), { changed: 1, generated: 4, skipped: 1 });
  assert.equal(session.history.undoStack.length, 1);
  assert.deepEqual([...session.eventSelection], ['moveXEvents:1', 'moveXEvents:2', 'moveXEvents:3', 'moveXEvents:4', 'textEvents:0']);
  session.travel('undo'); assert.equal(session.chart, original);
});

test('粘合按时间找前一同类事件，跨间隙且钩定同步传递，保留曲线', () => {
  const session = new EditorSession();
  session.line.eventLayers[0].moveXEvents = [
    { ...createEvent(80, 90, 5, 6), easingType: 6 },
    createEvent(0, 10, 0, 1), { ...createEvent(50, 50, 3, 4), inst: 1 },
  ];
  session.eventSelection = new Set(['moveXEvents:0', 'moveXEvents:1', 'moveXEvents:2']);
  assert.deepEqual(stickSelectedEvents(session), { changed: 2, skipped: 1 });
  assert.deepEqual(session.line.eventLayers[0].moveXEvents.map(item => [item.start, item.end]), [[10, 90], [0, 10], [10, 10]]);
  assert.equal(session.line.eventLayers[0].moveXEvents[0].easingType, 6);
  assert.equal(session.history.undoStack.length, 1);
  session.travel('undo'); assert.equal(session.line.eventLayers[0].moveXEvents[0].start, 80);
});

function multiFixture() {
  const chart = createChart(); chart.judgeLineList = Array.from({ length: 3 }, () => createLine());
  for (const [index, line] of chart.judgeLineList.entries()) line.eventLayers.push({
    moveXEvents: [createEvent(80 + index, 90 + index, 2, 3), createEvent(index, 10 + index, 0, 1)],
    moveYEvents: [createEvent(100 + index, 200 + index, 0, 1), { ...createEvent(300, 400, 2, 3), inst: 1 }],
  });
  const session = new EditorSession(chart); session.eventLayer = 1; session.focus = 'events';
  session.setMultiLineEnabled(true, 'events'); session.multiLineIndices = [0, 1, 2];
  return session;
}
const selectedOwners = session => selectedEventEntries(session).map(({ lineIndex, type, index }) => [lineIndex, type, index]);

test('多线模式单选非当前线切割：排序重映射选择，原线原层不变且一步撤销重做', () => {
  const session = multiFixture(); session.multiEventSelection.set(2, new Set(['moveXEvents:0']));
  const original = session.chart, selection = session.selectionState();
  assert.deepEqual(cutSelectedEvents(session, { division: 2, density: 1 }), { changed: 1, generated: 2, skipped: 0 });
  assert.equal(session.lineIndex, 0); assert.equal(session.eventSelection.size, 0);
  assert.equal(session.chart.judgeLineList[0], original.judgeLineList[0]);
  assert.equal(session.chart.judgeLineList[1], original.judgeLineList[1]);
  assert.equal(session.chart.judgeLineList[2].eventLayers[0], original.judgeLineList[2].eventLayers[0]);
  assert.deepEqual(eventListAt(session, 2, 'moveXEvents').map(event => [beatValue(event.startTime), event.start, event.end]), [[0, 2, 12], [2, 82, 87], [2.5, 87, 92]]);
  assert.deepEqual(selectedOwners(session), [[2, 'moveXEvents', 1], [2, 'moveXEvents', 2]]);
  assert.equal(session.history.undoStack.length, 1);
  session.travel('undo'); assert.equal(session.chart, original); assert.deepEqual(session.selectionState(), selection);
  session.travel('redo'); assert.deepEqual(selectedOwners(session), [[2, 'moveXEvents', 1], [2, 'moveXEvents', 2]]);
});

test('跨线跨列切割按所属线倍率换算共同时间，跳过的文字与零长事件保留选择和数组', () => {
  const session = multiFixture();
  session.chart.BPMList.push({ bpm: 240, startTime: [1, 0, 1] });
  session.chart.judgeLineList[1].bpmfactor = 2;
  session.chart.judgeLineList[1].eventLayers[1].moveXEvents = [createEvent(0, 100, .6, 1.6)];
  session.chart.judgeLineList[1].extended.textEvents = [createEvent('a', 'b')];
  session.chart.judgeLineList[2].extended.scaleXEvents = [createEvent(1, 3, 0, 1)];
  session.chart.judgeLineList[2].eventLayers[1].moveYEvents = [createEvent(10, 10, 0, 0)];
  session.multiEventSelection = new Map([[1, new Set(['moveXEvents:0', 'textEvents:0'])], [2, new Set(['scaleXEvents:0', 'moveYEvents:0'])]]);
  const original = session.chart, tempo = new TempoMap(original.BPMList);
  assert.deepEqual(cutSelectedEvents(session, { division: 4, density: 1, beat: 1.4, tempo }), { changed: 2, generated: 8, skipped: 2 });
  assert.deepEqual(eventListAt(session, 1, 'moveXEvents').map(event => beatValue(event.startTime)), [.6, .85, 1.1, 1.35]);
  assert.equal(session.chart.judgeLineList[0], original.judgeLineList[0]);
  assert.equal(session.chart.judgeLineList[1].extended.textEvents, original.judgeLineList[1].extended.textEvents);
  assert.equal(eventListAt(session, 2, 'moveYEvents'), original.judgeLineList[2].eventLayers[1].moveYEvents);
  assert.equal(session.multiEventSelection.get(1).has('textEvents:0'), true);
  assert.equal(session.multiEventSelection.get(2).has('moveYEvents:0'), true);
  assert.equal(selectedEventEntries(session).length, 10); assert.equal(session.history.undoStack.length, 1);
  session.travel('undo'); assert.equal(session.chart, original);
});

test('多线切割总生成上限跨线累计，失败不修改谱面、选择或撤销栈', () => {
  const session = multiFixture();
  for (const lineIndex of [1, 2]) {
    session.chart.judgeLineList[lineIndex].eventLayers[1].moveXEvents = [createEvent(0, 1, 0, 501)];
    session.multiEventSelection.set(lineIndex, new Set(['moveXEvents:0']));
  }
  const chart = session.chart, selection = session.selectionState();
  assert.throws(() => cutSelectedEvents(session, { division: 1, density: 100 }), /过多/);
  assert.equal(session.chart, chart); assert.deepEqual(session.selectionState(), selection); assert.equal(session.history.undoStack.length, 0);
});

test('跨线粘合只找所属线同层同列的前项，钩定连续传递并保留选择', () => {
  const session = multiFixture();
  session.chart.judgeLineList[1].eventLayers[1].moveXEvents.push({ ...createEvent(5, 5, 1.5, 2), inst: 1 });
  session.multiEventSelection = new Map([[1, new Set(['moveXEvents:0', 'moveXEvents:2'])], [2, new Set(['moveYEvents:1', 'moveYEvents:0'])]]);
  const original = session.chart, selection = session.selectionState();
  assert.deepEqual(stickSelectedEvents(session), { changed: 3, skipped: 1 });
  assert.deepEqual(eventListAt(session, 1, 'moveXEvents').map(event => [event.start, event.end]), [[11, 91], [1, 11], [11, 11]]);
  assert.deepEqual(eventListAt(session, 2, 'moveYEvents').map(event => [event.start, event.end]), [[102, 202], [202, 202]]);
  assert.equal(session.chart.judgeLineList[0], original.judgeLineList[0]);
  assert.equal(session.chart.judgeLineList[1].eventLayers[0], original.judgeLineList[1].eventLayers[0]);
  assert.deepEqual(session.selectionState(), selection); assert.equal(session.history.undoStack.length, 1);
  session.travel('undo'); assert.equal(session.chart, original); assert.deepEqual(session.selectionState(), selection);
  session.travel('redo'); assert.deepEqual(session.selectionState(), selection);
});

test('非当前线单选的前后粘合均使用实际所属线，缺少相邻事件不产生历史', () => {
  const session = multiFixture(); session.multiEventSelection.set(2, new Set(['moveXEvents:0']));
  assert.deepEqual(stickSelectedEvents(session), { changed: 1, skipped: 0 });
  assert.equal(eventListAt(session, 2, 'moveXEvents')[0].start, 12);
  session.travel('undo'); session.multiEventSelection.set(2, new Set(['moveXEvents:1']));
  const original = session.chart;
  assert.equal(stickSelectedEventToNext(session), true);
  assert.equal(eventListAt(session, 2, 'moveXEvents')[1].end, 82);
  assert.equal(session.chart.judgeLineList[0], original.judgeLineList[0]);
  assert.deepEqual(selectedOwners(session), [[2, 'moveXEvents', 1]]);
  session.travel('undo'); assert.equal(session.chart, original);
  session.multiEventSelection.set(2, new Set(['moveXEvents:0']));
  assert.equal(stickSelectedEventToNext(session), false); assert.equal(session.history.undoStack.length, 0);
});

test('多线按当前时间拆分用同一秒数和所属线倍率，排序不会错切后续原索引', () => {
  const session = multiFixture();
  session.chart.judgeLineList[1].bpmfactor = 2;
  session.chart.judgeLineList[1].eventLayers[1].moveXEvents = [createEvent(0, 100, 0, 2), createEvent(200, 400, 0, 2)];
  session.multiEventSelection = new Map([[1, new Set(['moveXEvents:0', 'moveXEvents:1'])], [2, new Set(['moveXEvents:0', 'moveYEvents:1'])]]);
  const original = session.chart;
  splitSelectedEvents(session, 2.5, new TempoMap(original.BPMList));
  assert.deepEqual(eventListAt(session, 1, 'moveXEvents').map(event => [beatValue(event.startTime), beatValue(event.endTime), event.start, event.end]), [[0, 1.25, 0, 62.5], [0, 1.25, 200, 325], [1.25, 2, 62.5, 100], [1.25, 2, 325, 400]]);
  assert.deepEqual(eventListAt(session, 2, 'moveXEvents').map(event => [beatValue(event.startTime), beatValue(event.endTime)]), [[0, 1], [2, 2.5], [2.5, 3]]);
  assert.equal(selectedEventEntries(session).length, 8); assert.equal(session.history.undoStack.length, 1);
  session.travel('undo'); assert.equal(session.chart, original); assert.equal(selectedEventEntries(session).length, 4);
  session.travel('redo'); assert.equal(selectedEventEntries(session).length, 8);
});

test('迁移并保存原版 CutRho 设置', () => {
  const result = migratePreferences('{"CutRho":8}');
  assert.equal(result.settings.cutDensity, 8); assert.ok(result.report.appliedSettings.includes('CutRho'));
  assert.equal(normalizeEditorPreferences({ cutDensity: 8 }).cutDensity, 8);
});
