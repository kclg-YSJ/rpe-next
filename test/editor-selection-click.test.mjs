import test from 'node:test';
import assert from 'node:assert/strict';
import { Timeline } from '../src/ui/timeline.mjs';
import { EditorSession } from '../src/application/session.mjs';
import { createLine, createNote } from '../src/core/chart.mjs';
import { beatValue } from '../src/core/beat.mjs';
import { DEFAULT_EDITOR_PREFERENCES } from '../src/core/default-settings.mjs';
import { readEditorPreferences, writeEditorPreferences } from '../src/platform/editor-preferences.mjs';
import { syncNotesOnlyView } from '../src/ui/view-controls.mjs';

function fixture(multi = false) {
  const session = new EditorSession(); session.chart.judgeLineList.push(createLine());
  session.chart.judgeLineList.forEach(line => { line.notes = [createNote(1, 1, 0), createNote(2, 2, 100, 3)]; });
  if (multi) { session.setMultiLineEnabled(true, 'notes'); session.multiLineIndices = [0, 1]; session.multiLineMerge = false; }
  const canvas = () => ({ clientWidth: 900, clientHeight: 600, style: {}, addEventListener() {}, focus() {}, setPointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 900, height: 600 }) });
  const timeline = new Timeline(canvas(), canvas(), () => session, () => {}, () => {}, assert.fail);
  timeline.snapX = false;
  const lineIndex = multi ? 1 : 0;
  timeline.hit = () => ({ lineIndex, index: 0, item: session.chart.judgeLineList[lineIndex].notes[0], start: 1, end: 1 });
  const select = () => {
    session.selection = new Set([0, 1]);
    if (multi) session.multiLineSelection = new Map([[0, new Set([1])], [1, new Set([0])]]);
    session.multiSelectionIntent = 'notes';
  };
  const pointer = { clientX: 500, clientY: 200, button: 0, pointerId: 1, preventDefault() {} };
  return { session, timeline, lineIndex, select, pointer };
}

for (const multi of [false, true]) test(`plain selected-note click edits one object; modifiers and drags keep group semantics (${multi})`, () => {
  const { session, timeline, select, pointer, lineIndex } = fixture(multi); select();
  const before = session.chart;
  timeline.down(pointer); timeline.up(pointer);
  assert.deepEqual(session.selectedNoteEntries().map(entry => [entry.lineIndex, entry.index]), [[lineIndex, 0]]);
  if (multi) assert.equal(session.selection.size, 0, 'current-line mirror must not claim another line\'s selected note');
  assert.equal(session.multiSelectionIntent, null); assert.equal(session.chart, before); assert.equal(session.history.undoStack.length, 0);
  timeline.clickSelectedToSingle = false; select(); timeline.down(pointer); timeline.up(pointer);
  assert.equal(session.selectedNoteEntries().length, 2);
  timeline.clickSelectedToSingle = true; select(); timeline.down({ ...pointer, ctrlKey: true }); timeline.up({ ...pointer, ctrlKey: true });
  assert.equal(session.selectedNoteEntries().length, 1);
  select(); timeline.down(pointer); timeline.move({ ...pointer, clientX: 530 }); timeline.up({ ...pointer, clientX: 530 });
  assert.equal(session.selectedNoteEntries().length, 2); assert.equal(session.history.undoStack.length, 1);
});

test('click-to-single defaults on and false survives preference storage', () => {
  assert.equal(DEFAULT_EDITOR_PREFERENCES.clickSelectedToSingle, true);
  const values = new Map(), storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  for (const clickSelectedToSingle of [true, false]) { writeEditorPreferences({ clickSelectedToSingle }, storage); assert.deepEqual(readEditorPreferences(storage), { clickSelectedToSingle }); }
});

test('note placement uses the active line immediately, before the pointer moves again', () => {
  const { session, timeline } = fixture();
  session.chart.judgeLineList.forEach(line => { line.notes = []; }); session.chart.judgeLineList[1].bpmfactor = 2;
  timeline.cursor = { x: 450, y: timeline.verticalForLine(2, 1) }; timeline.cursorLineIndex = 0;
  session.selectLine(1);
  for (const type of [1, 3, 4]) timeline.addAtCursor(type);
  assert.equal(session.chart.judgeLineList[0].notes.length, 0); assert.equal(session.notes.length, 3);
  assert.ok(session.notes.every(note => beatValue(note.startTime) === 2));
  timeline.addAtCursor(2); assert.equal(timeline.pendingHold.lineIndex, 1);
  timeline.cursor.y = timeline.verticalForLine(3, 1); timeline.addAtCursor(2);
  assert.equal(beatValue(session.notes.at(-1).endTime), 3);
  session.selectLine(0); timeline.addAtCursor(1); assert.equal(session.notes.length, 1);
});

test('multi-line modes ignore notes-only without changing its saved choice', () => {
  const { session, timeline } = fixture(), preferences = { notesOnly: true }, nodes = new Map();
  const previous = globalThis.document;
  globalThis.document = { querySelector: selector => { if (!nodes.has(selector)) nodes.set(selector, { classList: { toggle() {} }, setAttribute() {} }); return nodes.get(selector); } };
  try {
    syncNotesOnlyView(preferences, timeline); assert.equal(timeline.notesOnly, true);
    for (const mode of ['notes', 'events']) { session.setMultiLineEnabled(true, mode); syncNotesOnlyView(preferences, timeline); assert.equal(timeline.notesOnly, false); assert.equal(preferences.notesOnly, true); }
    session.setMultiLineEnabled(false); syncNotesOnlyView(preferences, timeline); assert.equal(timeline.notesOnly, true);
    preferences.notesOnly = false; session.setMultiLineEnabled(true, 'events'); syncNotesOnlyView(preferences, timeline); session.setMultiLineEnabled(false); syncNotesOnlyView(preferences, timeline); assert.equal(timeline.notesOnly, false);
  } finally { globalThis.document = previous; }
});
