import test from 'node:test';
import assert from 'node:assert/strict';
import { createChart, createLine, createEvent } from '../src/core/chart.mjs';
import { beatValue } from '../src/core/beat.mjs';
import { EditorSession } from '../src/application/session.mjs';
import { insertEventAt, placedEvent, selectEvent, deleteEvents, transformEvents } from '../src/application/event-commands.mjs';
import { copyObjects, cutObjects, deleteObjects, pasteObjects } from '../src/application/clipboard.mjs';
import { captureSelection, controlSelection } from '../src/application/batch-edit.mjs';
import { expandXyEntries, retainXySelection } from '../src/application/xy-binding.mjs';
import { Timeline } from '../src/ui/timeline.mjs';
import { DEFAULT_EDITOR_PREFERENCES } from '../src/core/default-settings.mjs';
import { readEditorPreferences, writeEditorPreferences } from '../src/platform/editor-preferences.mjs';

const x = 'moveXEvents', y = 'moveYEvents';
const times = event => [beatValue(event.startTime), beatValue(event.endTime)];
function fixture({ enabled = true, multi = false, layer = 0 } = {}) {
  const chart = createChart(); chart.judgeLineList = [createLine(), createLine()];
  for (const line of chart.judgeLineList) {
    if (layer) line.eventLayers[layer] = {};
    line.eventLayers[layer][x] = [createEvent(10, 30, 1, 4)];
    // Different array positions ensure pairing never relies on indices.
    line.eventLayers[layer][y] = [createEvent(80, 90, 8, 9), createEvent(20, 40, 1, 4)];
  }
  const session = new EditorSession(chart); session.xyBinding = enabled; session.focus = 'events'; session.eventLayer = layer;
  if (multi) { session.setMultiLineEnabled(true, 'events'); session.multiLineIndices = [0, 1]; }
  const tracks = (line = 0) => session.chart.judgeLineList[line].eventLayers[layer];
  const select = (type = x, index = 0, line = 0) => selectEvent(session, line, type, index, { replace: true });
  return { session, tracks, select };
}

test('XY binding defaults off and persists independently of paired movement sampling', () => {
  assert.equal(DEFAULT_EDITOR_PREFERENCES.xyBinding, false);
  const values = new Map(), storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  for (const xyBinding of [true, false]) {
    writeEditorPreferences({ xyBinding, pairedMovementSampling: !xyBinding }, storage);
    assert.deepEqual(readEditorPreferences(storage), { xyBinding, pairedMovementSampling: !xyBinding });
  }
});

for (const type of [x, y]) test(`placing ${type} creates a companion with that axis's previous value in one transaction`, () => {
  const { session, tracks } = fixture(); const other = type === x ? y : x, before = session.chart;
  const event = placedEvent(session, type, 5, 6);
  insertEventAt(session, 0, type, event);
  const companion = tracks()[other].at(-1);
  assert.deepEqual(times(companion), [5, 6]); assert.equal(companion.start, other === y ? 40 : 30); assert.equal(companion.end, companion.start);
  assert.equal(session.eventSelection.size, 1); assert.equal(session.history.undoStack.length, 1);
  session.travel('undo'); assert.equal(session.chart, before); session.travel('redo'); assert.deepEqual(times(tracks()[other].at(-1)), [5, 6]);
});

test('placement preserves occupied intervals, permits adjacent intervals, respects layers/owners and trajectories', () => {
  for (const [start, end, occupied] of [[1, 4, true], [2, 3, true], [0, 2, true], [4, 5, false]]) {
    const { session, tracks } = fixture(); const before = tracks()[y];
    insertEventAt(session, 0, x, createEvent(0, 0, start, end));
    assert.equal(tracks()[y].length, before.length + (occupied ? 0 : 1)); assert.equal(tracks()[y][1], before[1]);
  }
  const { session, tracks } = fixture({ layer: 1 });
  const baseLayer = session.chart.judgeLineList[1].eventLayers[0];
  insertEventAt(session, 1, x, { ...createEvent(0, 0, 5, 6), trajectory: { version: 1, segments: 16, options: {} } });
  assert.equal(tracks(1)[y].length, 2, 'intact trajectories already supply Y');
  insertEventAt(session, 1, x, createEvent(0, 0, 6, 7));
  assert.equal(tracks(0)[y].length, 2); assert.equal(tracks(1)[y].length, 3);
  assert.equal(session.chart.judgeLineList[1].eventLayers[0], baseLayer);
});

for (const remove of [deleteEvents, deleteObjects]) test(`${remove.name} deletes exact pairs on their owners/layer and undoes together`, () => {
  const { session, tracks, select } = fixture({ multi: true, layer: 1 }); select(x, 0, 1);
  session.multiEventSelection.set(0, new Set([`${y}:1`, `${x}:0`]));
  const before = session.chart; remove(session);
  for (const line of [0, 1]) { assert.equal(tracks(line)[x].length, 0); assert.deepEqual(tracks(line)[y].map(times), [[8, 9]]); }
  assert.equal(session.history.undoStack.length, 1); session.travel('undo'); assert.equal(session.chart, before);
  assert.equal(session.multiEventSelection.get(1).size, 1); assert.equal(session.multiEventSelection.get(0).size, 2);
});

test('copy keeps explicit selection, while cut copies everything it deletes and pastes both axes', () => {
  const { session, tracks, select } = fixture(); select();
  assert.equal(copyObjects(session), 1); assert.equal(session.eventClipboard.length, 1);
  assert.equal(cutObjects(session), 2); assert.equal(session.eventClipboard.length, 2);
  assert.equal(tracks()[x].length, 0); assert.equal(tracks()[y].length, 1);
  pasteObjects(session, 12); assert.deepEqual(times(tracks()[x][0]), [12, 15]); assert.deepEqual(times(tracks()[y].at(-1)), [12, 15]);
  session.travel('undo'); session.travel('undo'); assert.equal(tracks()[x].length, 1); assert.equal(tracks()[y].length, 2);
});

function interactionFixture(options = {}) {
  const f = fixture(options), { session, tracks, select } = f; select(x, 0, options.multi ? 1 : 0);
  const canvas = () => ({ clientWidth: 600, clientHeight: 600, style: {}, addEventListener() {}, focus() {}, setPointerCapture() {}, releasePointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 600 }) });
  const timeline = new Timeline(canvas(), canvas(), () => session, () => {}, () => {}, assert.fail);
  timeline.scale = 90; timeline.layer = session.eventLayer; timeline.rpeEventDrag = options.endpoint === true;
  const line = options.multi ? 1 : 0, vertical = beat => timeline.verticalForLine(beat, line);
  timeline.eventRects = [{ type: x, index: 0, lineIndex: line, x: 20, width: 60, y: vertical(4), height: vertical(1) - vertical(4) }];
  const pointer = (beat, button = 0, px = 50) => ({ clientX: px, clientY: vertical(beat), button, pointerId: 1, preventDefault() {} });
  return { ...f, timeline, interaction: timeline.eventInteraction, pointer, pair: () => [tracks(line)[x][0], tracks(line)[y][1]] };
}

for (const [kind, start, end, expected] of [['move', 2, 3, [2, 5]], ['startTime', 1, 2, [2, 4]], ['endTime', 4, 5, [1, 5]]]) {
  test(`XY ${kind} drag previews and commits both axes once, keeping values and explicit selection`, () => {
    const { session, interaction, pointer, pair, timeline } = interactionFixture(), before = session.chart;
    interaction.down(pointer(start)); assert.equal(interaction.drag.kind, kind); interaction.move(pointer(end));
    for (const event of pair()) assert.deepEqual(times(interaction.previewEvent(event)), expected);
    assert.equal(interaction.previewRectangles(timeline.eventRects, 600).length, 2);
    assert.equal(session.chart, before, 'preview must not mutate'); interaction.up(pointer(end));
    for (const event of pair()) assert.deepEqual(times(event), expected);
    assert.deepEqual(pair().map(event => [event.start, event.end]), [[10, 30], [20, 40]]);
    assert.deepEqual([...session.eventSelection], [`${x}:0`]); assert.equal(session.history.undoStack.length, 1);
    session.travel('undo'); assert.equal(session.chart, before); session.travel('redo'); for (const event of pair()) assert.deepEqual(times(event), expected);
  });
}

test('RPE endpoint drag crosses endpoints, keeps frozen previews and pairs on the non-current line/layer', () => {
  const { session, interaction, timeline, pointer, pair, tracks } = interactionFixture({ endpoint: true, multi: true, layer: 1 });
  timeline.eventEndpointDragHeld = true; interaction.down(pointer(2, 0, 550)); interaction.move(pointer(5, 0, 550));
  for (const event of pair()) assert.deepEqual(times(interaction.previewEvent(event)), [4, 5]);
  timeline.eventEndpointDragHeld = false; interaction.move(pointer(6)); interaction.up(pointer(6));
  for (const event of pair()) assert.deepEqual(times(event), [4, 5]);
  assert.deepEqual(times(tracks(0)[x][0]), [1, 4]); assert.deepEqual([...session.multiEventSelection.get(1)], [`${x}:0`]);
  assert.equal(session.history.undoStack.length, 1);
});

test('multi-select drag deduplicates companions and leaves unrelated intervals untouched', () => {
  const { session, interaction, pointer, pair, tracks } = interactionFixture({ multi: true });
  session.multiEventSelection.set(0, new Set([`${x}:0`, `${y}:1`]));
  interaction.down(pointer(2)); assert.equal(interaction.drag.xySnapshot.events.length, 4); interaction.move(pointer(3)); interaction.up(pointer(3));
  for (const line of [0, 1]) for (const event of [tracks(line)[x][0], tracks(line)[y][1]]) assert.deepEqual(times(event), [2, 5]);
  assert.deepEqual(times(tracks(0)[y][0]), [8, 9]); assert.equal(session.history.undoStack.length, 1);
});

test('batch move/resize applies pairing, including line moves, without changing explicit selection', () => {
  const { session, select } = fixture(); select();
  const original = captureSelection(session), snapshot = { ...original, events: expandXyEntries(original.chart, original.eventLayer, original.events) };
  for (const kind of ['event-move', 'event-start', 'event-end']) {
    const result = retainXySelection(controlSelection(snapshot, kind, { deltaBeat: 1, dragX: kind === 'event-move' ? 400 : 0 }), original.events);
    const changed = result.changes.filter(change => change.kind === 'events'); assert.equal(changed.length, 2);
    assert.deepEqual(times(changed[0].after), times(changed[1].after));
    assert.equal([...result.multiEventSelection.values()].reduce((sum, selection) => sum + selection.size, 0), 1);
    const selectedLine = changed[0].lineIndex; assert.equal(result.chart.judgeLineList[selectedLine].eventLayers[0][x][Number([...result.multiEventSelection.get(selectedLine)][0].split(':')[1])], changed[0].after);
  }
});

test('disabled binding does not inspect or move the opposite axis; ordinary value edits stay independent', () => {
  const { session, tracks, select } = fixture({ enabled: false }); select(); const oldY = tracks()[y];
  // A throwing iterator catches accidental pairing/index creation on the off path.
  oldY[Symbol.iterator] = () => { throw Error('disabled XY must not scan Y'); };
  insertEventAt(session, 0, x, createEvent(0, 0, 5, 6)); assert.equal(tracks()[y], oldY);
  select(); deleteEvents(session); assert.equal(tracks()[y], oldY);
  delete oldY[Symbol.iterator]; session.travel('undo'); session.xyBinding = true; select();
  transformEvents(session, 'value', event => ({ ...event, start: 99 })); assert.equal(tracks()[y], oldY);
  const f = interactionFixture({ enabled: false }); f.interaction.down(f.pointer(2)); assert.equal(f.interaction.drag.xySnapshot, undefined); f.interaction.move(f.pointer(3)); f.interaction.up(f.pointer(3));
  assert.deepEqual(times(f.pair()[1]), [1, 4]);
});
