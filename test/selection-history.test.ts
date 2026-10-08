import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorSession } from '../src/application/session.ts';
import { createChart, createNote, createEvent, createLine } from '../src/core/chart.ts';
import { transformEvents, deleteEvents } from '../src/application/event-commands.ts';
import { cutSelectedEvents } from '../src/application/event-tools.ts';
import { captureSelection, commitSelectionEdit, editCapturedSelection } from '../src/application/batch-edit.ts';
import type { Note } from '../src/core/types.ts';

function fixture() {
  const chart = createChart();
  chart.judgeLineList[0].notes = [createNote(1, 1, -100), createNote(1, 2, 0), createNote(1, 3, 100)];
  chart.judgeLineList[0].eventLayers[0].moveXEvents = [createEvent(0, 10, 0, 1), createEvent(10, 20, 1, 2)];
  const session = new EditorSession(chart); session.selection = new Set([0, 2]); return session;
}

test('撤销与重做音符批改保留多选；改选后撤销也保持当前选择', () => {
  const session = fixture();
  session.transformSelection('移动', (note: Note | undefined): Note => {
    // `transformSelection` reports `undefined` for a selected index the current line has no note
    // for; the fixture's selection (`0` and `2`) always resolves.
    if (!note) throw new Error('选中索引没有对应音符');
    return { ...note, positionX: note.positionX + 10 };
  });
  session.travel('undo'); assert.deepEqual([...session.selection], [0, 2]); assert.equal(session.notes[0].positionX, -100);
  session.travel('redo'); assert.deepEqual([...session.selection], [0, 2]); assert.equal(session.notes[0].positionX, -90);
  session.selection = new Set([1, 2]); session.travel('undo'); assert.deepEqual([...session.selection], [1, 2]);
  session.selection.clear(); session.travel('redo'); assert.equal(session.selection.size, 0);
});

test('切割、删除事件撤销后恢复原物件多选，重做恢复新段索引', () => {
  const session = fixture(); session.selection.clear(); session.focus = 'events';
  session.eventSelection = new Set(['moveXEvents:0', 'moveXEvents:1']);
  transformEvents(session, '改值', event => {
    // The fixture builds this track from numeric endpoints, so `EventValue` is a number here.
    const end = typeof event.end === 'number' ? event.end : 0;
    return { ...event, end: end + 1 };
  });
  session.travel('undo'); assert.equal(session.eventSelection.size, 2);
  cutSelectedEvents(session, { division: 2, density: 1 }); assert.equal(session.eventSelection.size, 4);
  session.travel('undo'); assert.deepEqual([...session.eventSelection], ['moveXEvents:0', 'moveXEvents:1']);
  session.travel('redo'); assert.equal(session.eventSelection.size, 4);
  deleteEvents(session); assert.equal(session.eventSelection.size, 0);
  session.travel('undo'); assert.equal(session.eventSelection.size, 4);
});

test('插入、删除后的当前多选按物件重新定位，不选中旧索引对应的其他物件', () => {
  const session = fixture(); session.selection = new Set([0]); session.deleteSelection();
  session.selection = new Set([0, 1]); session.travel('undo'); assert.deepEqual([...session.selection], [1, 2]);
  session.travel('redo'); assert.deepEqual([...session.selection], [0, 1]);
  session.insertNotes([createNote(1, 4, 0)]); session.selection = new Set([0, 1]);
  session.travel('undo'); assert.deepEqual([...session.selection], [0, 1]);
});

test('跨线移动多选撤销和重做时恢复正确的线与选择', () => {
  const session = fixture(); session.chart.judgeLineList.push(createLine());
  commitSelectionEdit(session, editCapturedSelection(captureSelection(session), { lineOffset: 1 }), '移线');
  assert.equal(session.lineIndex, 1); assert.deepEqual([...session.selection], [0, 1]);
  session.travel('undo'); assert.equal(session.lineIndex, 0); assert.deepEqual([...session.selection], [0, 2]);
  session.travel('redo'); assert.equal(session.lineIndex, 1); assert.deepEqual([...session.selection], [0, 1]);
});

test('没有历史可撤销时不清空多选', () => {
  const session = fixture(); session.travel('undo'); assert.deepEqual([...session.selection], [0, 2]);
});
