import test from 'node:test';
import assert from 'node:assert/strict';
import { createChart, createLine, createNote, createEvent } from '../src/core/chart.mjs';
import { EditorSession } from '../src/application/session.mjs';
import { captureSelection, commitSelectionEdit, editCapturedSelection, nudgeSelection } from '../src/application/batch-edit.mjs';
import { previewMultiEdit, previewEventClones } from '../src/application/multi-edit.mjs';
import { MultiEditPanel } from '../src/ui/multi-edit.mjs';

function fixture(kind, current = 1) {
  const chart = createChart();
  chart.judgeLineList = Array.from({ length: 4 }, (_, line) => {
    const result = createLine();
    result.notes = [0, 1, 2].map(index => ({ ...createNote(1, index + 1, line * 100 + index), tag: `${line}:${index}` }));
    result.eventLayers[0].moveXEvents = [0, 1, 2].map(index => ({ ...createEvent(line * 100 + index, line * 100 + index + 10, index + 1, index + 2), tag: `${line}:${index}` }));
    return result;
  });
  const session = new EditorSession(chart); session.lineIndex = current; session.focus = kind;
  session.setMultiLineEnabled(true, kind); session.multiLineIndices = [0, 2, 3];
  const selected = new Map([3, 0, 2].map(line => [line, new Set(kind === 'notes' ? [0, 2] : ['moveXEvents:0', 'moveXEvents:2'])]));
  if (kind === 'notes') session.multiLineSelection = selected; else session.multiEventSelection = selected;
  session.selection = new Set(session.multiLineSelection.get(current) ?? []);
  session.eventSelection = new Set(session.multiEventSelection.get(current) ?? []);
  return session;
}
const items = (chart, kind) => chart.judgeLineList.map(line => kind === 'notes' ? line.notes : line.eventLayers[0].moveXEvents);
const tags = (chart, kind) => items(chart, kind).map(list => list.map(item => item.tag));
const selectedTags = (session, kind) => {
  const selections = kind === 'notes' ? session.multiLineSelection : session.multiEventSelection;
  return [...selections].flatMap(([line, indices]) => [...indices].map(index => items(session.chart, kind)[line][kind === 'notes' ? index : Number(index.split(':')[1])].tag)).sort();
};

for (const kind of ['notes', 'events']) test(`多线${kind}批量修改按真实来源回写，相同下标不串线，连续应用与撤销保留完整选择`, () => {
  for (const current of [0, 1, 2]) {
    const session = fixture(kind, current), original = session.chart, originalTags = tags(original, kind), originalSelected = selectedTags(session, kind);
    for (let pass = 0; pass < 2; pass++) {
      const result = previewMultiEdit(captureSelection(session), kind, { field: kind === 'notes' ? 'x' : 'both', lower: 7, upper: 7 });
      assert.deepEqual(tags(result.chart, kind), originalTags);
      commitSelectionEdit(session, result, '多线批量');
      assert.equal(session.lineIndex, current); assert.deepEqual(selectedTags(session, kind), originalSelected);
      items(session.chart, kind).forEach((list, line) => list.forEach((item, index) => {
        const value = kind === 'notes' ? item.positionX : item.start;
        assert.equal(value, line * 100 + index + (line !== 1 && index !== 1 ? 7 * (pass + 1) : 0));
      }));
    }
    session.travel('undo'); session.travel('undo'); assert.equal(session.chart, original);
    assert.deepEqual(selectedTags(session, kind), originalSelected);
    session.travel('redo'); session.travel('redo'); assert.deepEqual(tags(session.chart, kind), originalTags);
    assert.deepEqual(selectedTags(session, kind), originalSelected);
  }
});

for (const kind of ['notes', 'events']) test(`多线${kind}条件、周期跳过与脚本保持源线及未修改项的选择`, () => {
  const session = fixture(kind), selected = selectedTags(session, kind), before = tags(session.chart, kind);
  const result = previewMultiEdit(captureSelection(session), kind, { field: kind === 'notes' ? 'x' : 'start', lower: 2, upper: 2, cycle: '1 _', condition: 'line != 0' });
  commitSelectionEdit(session, result, '筛选');
  assert.deepEqual(tags(session.chart, kind), before); assert.deepEqual(selectedTags(session, kind), selected);
  commitSelectionEdit(session, previewMultiEdit(captureSelection(session), kind, { mode: 'script', script: kind === 'notes' ? 'x += line;' : 'start += line; end += line;' }), '脚本');
  assert.deepEqual(tags(session.chart, kind), before); assert.deepEqual(selectedTags(session, kind), selected);
});

for (const kind of ['notes', 'events']) test(`多线${kind}相邻移线与首尾循环同时完成，不覆盖另一条线的待移动源物件`, () => {
  for (const order of [[0, 1, 2, 3], [3, 2, 1, 0]]) {
    const session = fixture(kind); session.multiLineIndices = [0, 1, 2, 3];
    if (kind === 'notes') session.multiLineSelection = new Map(order.map(line => [line, new Set([0])]));
    else session.multiEventSelection = new Map(order.map(line => [line, new Set(['moveXEvents:0'])]));
    const before = session.chart;
    commitSelectionEdit(session, editCapturedSelection(captureSelection(session), { lineOffset: 1 }), '移线');
    assert.deepEqual(tags(session.chart, kind), [0, 1, 2, 3].map(line => [`${line}:1`, `${line}:2`, `${(line + 3) % 4}:0`]));
    assert.deepEqual(selectedTags(session, kind), ['0:0', '1:0', '2:0', '3:0']);
    session.travel('undo'); assert.equal(session.chart, before); session.travel('redo');
    assert.deepEqual(selectedTags(session, kind), ['0:0', '1:0', '2:0', '3:0']);
  }
});

test('音符批量显式移线允许交换和汇入同线，跳过项和未选中物件不丢失', () => {
  const session = fixture('notes'), before = session.chart;
  const result = previewMultiEdit(captureSelection(session), 'notes', { mode: 'script', script: 'line = (line + 1) % 4; x += 5;' });
  commitSelectionEdit(session, result, '脚本移线');
  assert.deepEqual(tags(session.chart, 'notes'), [['0:1', '3:0', '3:2'], ['1:0', '1:1', '1:2', '0:0', '0:2'], ['2:1'], ['3:1', '2:0', '2:2']]);
  assert.equal(items(session.chart, 'notes').flat().length, 12);
  assert.deepEqual(selectedTags(session, 'notes'), ['0:0', '0:2', '2:0', '2:2', '3:0', '3:2']);
  session.travel('undo'); assert.equal(session.chart, before);
});

test('事件 Line 批量保留全部源事件并追加到各自目标，连续应用不覆盖同下标事件', () => {
  const session = fixture('events');
  commitSelectionEdit(session, previewMultiEdit(captureSelection(session), 'events', { field: 'line', lower: 1, upper: 1, operation: 'By', condition: 'line < 3' }), '事件移线');
  assert.deepEqual(tags(session.chart, 'events'), [['0:0', '0:1', '0:2'], ['1:0', '1:1', '1:2', '0:0', '0:2'], ['2:0', '2:1', '2:2'], ['3:0', '3:1', '3:2', '2:0', '2:2']]);
  const afterTags = tags(session.chart, 'events'), beforeSelected = selectedTags(session, 'events');
  commitSelectionEdit(session, previewMultiEdit(captureSelection(session), 'events', { field: 'both', lower: 3, upper: 3 }), '再次编辑');
  assert.deepEqual(tags(session.chart, 'events'), afterTags); assert.deepEqual(selectedTags(session, 'events'), beforeSelected);
});

test('多线事件克隆移除源件后正确重映射未移除源件与追加选择，支持混合类型', () => {
  for (const retainSource of [true, false]) {
    const session = fixture('events'), before = session.chart;
    const result = previewEventClones(captureSelection(session), { targets: '0 2 0', retainSource, increment: 0 });
    commitSelectionEdit(session, result, '多线克隆');
    assert.equal(items(session.chart, 'events').flat().length, retainSource ? 30 : 24);
    assert.equal(selectedTags(session, 'events').length, retainSource ? 24 : 18);
    session.travel('undo'); assert.equal(session.chart, before); session.travel('redo');
    assert.equal(selectedTags(session, 'events').length, retainSource ? 24 : 18);
  }
});

test('多线方向键保持来源；仅屏外选择改变也刷新批量预览签名', () => {
  const session = fixture('notes'), before = tags(session.chart, 'notes');
  nudgeSelection(session, 'ArrowRight', 4, 11); assert.deepEqual(tags(session.chart, 'notes'), before);
  const panel = Object.create(MultiEditPanel.prototype); panel.getSession = () => session; panel.timeline = { division: 4 };
  const signature = panel.selectionSignature(); session.multiLineSelection.get(2).add(1);
  assert.notEqual(panel.selectionSignature(), signature);
});

test('多线属性移到指定线时保留目标线上已有选择，只选中目标线不产生编辑', () => {
  const session = fixture('notes'), before = session.chart;
  session.moveSelectionToLine(2);
  assert.equal(items(session.chart, 'notes').flat().length, 12);
  assert.deepEqual(selectedTags(session, 'notes'), ['0:0', '0:2', '2:0', '2:2', '3:0', '3:2']);
  const after = session.chart; session.moveSelectionToLine(2); assert.equal(session.chart, after);
  session.travel('undo'); assert.equal(session.chart, before);
});
