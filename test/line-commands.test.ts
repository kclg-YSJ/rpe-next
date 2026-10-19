import test from 'node:test';
import assert from 'node:assert/strict';
import { createChart, createLine, createNote } from '../src/core/chart.ts';
import { reorderLine, deleteLine, duplicateLine, setLineParent, ensureLineCount, MAX_BATCH_LINE_COUNT } from '../src/application/line-commands.ts';
import { History } from '../src/application/history.ts';
import { EditorSession } from '../src/application/session.ts';

test('批量增加补足目标总数，保留原线和父线，作为一步撤销重做', () => {
  const chart = createChart(); chart.judgeLineList.push(createLine('child')); chart.judgeLineList[1]!.father = 0;
  const session = new EditorSession(chart); const next = ensureLineCount(chart, 6);
  assert.equal(next.judgeLineList.length, 6);
  assert.equal(next.judgeLineList[0], chart.judgeLineList[0]); assert.equal(next.judgeLineList[1], chart.judgeLineList[1]);
  assert.deepEqual(next.judgeLineList.slice(2).map(line => line.Name), ['Line 3', 'Line 4', 'Line 5', 'Line 6']);
  assert.notEqual(next.judgeLineList[2]!.eventLayers, next.judgeLineList[3]!.eventLayers);
  assert.equal(next.judgeLineList[2]!.eventLayers![0]!.alphaEvents![0]!.start, 255);
  session.commit('批量增加判定线', next);
  assert.equal(session.history.undoStack.length, 1);
  session.travel('undo'); assert.equal(session.chart, chart);
  session.travel('redo'); assert.equal(session.chart, next);
});

test('目标不大于已有总数时不删除或增加历史，非法或过大的输入被拒绝', () => {
  const chart = createChart(); chart.judgeLineList.push(createLine());
  assert.equal(ensureLineCount(chart, 1), chart); assert.equal(ensureLineCount(chart, 2), chart);
  for (const count of [0, -1, 1.5, NaN, Infinity, '3', MAX_BATCH_LINE_COUNT + 1, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => ensureLineCount(chart, count as unknown as number));
  assert.equal(chart.judgeLineList.length, 2);
});

test('重排与删除同步父线引用，撤销恢复完整原图', () => {
  const chart = createChart();
  chart.judgeLineList = [createLine('parent'), createLine('child'), createLine('grandchild')];
  chart.judgeLineList[1].father = 0; chart.judgeLineList[2].father = 1;
  const moved = reorderLine(chart, 0, 2);
  assert.deepEqual(moved.judgeLineList.map(line => line.Name), ['child', 'grandchild', 'parent']);
  assert.deepEqual(moved.judgeLineList.map(line => line.father), [2, 0, -1]);
  const removed = deleteLine(moved, 0);
  assert.deepEqual(removed.judgeLineList.map(line => line.father), [-1, -1]);
  const history = new History(chart); history.commit('move', moved); history.commit('delete', removed);
  history.undo(); assert.equal(history.document, moved);
  history.undo(); assert.equal(history.document, chart);
  assert.equal(chart.judgeLineList[1].father, 0);
});

test('父线循环被拒绝，复制深保留未知字段但不共享可变数据', () => {
  const chart = createChart(); chart.judgeLineList.push(createLine());
  chart.judgeLineList[1].father = 0;
  chart.judgeLineList[1].custom = { value: [1, 2] };
  chart.judgeLineList[1].notes = [createNote(1, 0, 0)];
  assert.throws(() => setLineParent(chart, 0, 1), /循环/);
  assert.throws(() => setLineParent(chart, 0, 10), /索引/);
  assert.equal(setLineParent(chart, 1, -1).judgeLineList[1].father, -1);
  const cloned = duplicateLine(chart, 1).judgeLineList[2];
  assert.deepEqual(cloned.custom, chart.judgeLineList[1].custom);
  assert.notEqual(cloned.notes[0], chart.judgeLineList[1].notes[0]);
  assert.equal(cloned.father, 0);
});
