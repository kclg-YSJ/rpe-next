import test from 'node:test';
import assert from 'node:assert/strict';
import { createChart, createLine, createNote } from '../src/core/chart.ts';
import { reorderLine, deleteLine, duplicateLine, setLineParent } from '../src/application/line-commands.ts';
import { History } from '../src/application/history.ts';

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
