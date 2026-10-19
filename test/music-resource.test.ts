import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorSession } from '../src/application/session.ts';
import { createChart, createNote } from '../src/core/chart.ts';

test('不可撤销的音乐替换不新增历史，撤销重做其他编辑仍保留新音乐', () => {
  const chart = createChart(); chart.META.song = 'music.ogg'; chart.META.offset = 375;
  const session = new EditorSession(chart);
  session.insertNotes([createNote(1, 1, 0)]);
  session.insertNotes([createNote(1, 2, 0)]);
  session.travel('undo');
  const edits = [...session.recentEdits];
  session.replaceMusicResource('music-leading.wav');
  assert.equal(session.history.undoStack.length, 1);
  assert.equal(session.history.redoStack.length, 1);
  assert.deepEqual(session.recentEdits, edits);
  assert.equal(session.history.dirty, true);
  for (const direction of ['undo', 'redo', 'redo'] as const) {
    session.travel(direction);
    assert.equal(session.chart.META.song, 'music-leading.wav');
    assert.equal(session.chart.META.offset, 375);
  }
  assert.equal(session.notes.length, 2);
  assert.equal(chart.META.song, 'music.ogg');
  session.history.markSaved(); assert.equal(session.history.dirty, false);
});

test('空历史中的音乐替换仍要求保存，重复替换不会新增撤销项', () => {
  const session = new EditorSession();
  session.replaceMusicResource('leading.wav');
  assert.equal(session.history.dirty, true);
  assert.equal(session.history.undo(), false);
  session.history.markSaved();
  session.replaceMusicResource('leading-2.wav');
  assert.equal(session.history.dirty, true);
  assert.equal(session.chart.META.song, 'leading-2.wav');
  assert.equal(session.history.undoStack.length, 0);
  assert.equal(session.recentEdits.length, 0);
});
