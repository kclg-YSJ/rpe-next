import test from 'node:test';
import assert from 'node:assert/strict';
import { movementVector, changeMovementVector, parseMovementPosition } from '../src/core/movement-vector.mjs';
import { eventMovementVector, movementEventPair, editMovementVector } from '../src/application/movement-vector.mjs';
import { createChart, createLine, createEvent, assertChart } from '../src/core/chart.mjs';
import { EditorSession } from '../src/application/session.mjs';
import { readEditorPreferences, writeEditorPreferences } from '../src/platform/editor-preferences.mjs';
import { DEFAULT_EDITOR_PREFERENCES } from '../src/core/default-settings.mjs';
import { cropCustomEvent, withCustomEasing, eventNumericValue } from '../src/core/event-easing.mjs';
import { linearCurve } from '../src/core/animation-curve.mjs';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
function fixture() {
  const chart = createChart(); chart.judgeLineList.push(createLine('second'));
  const line = chart.judgeLineList[1];
  line.eventLayers.push({ moveXEvents: [createEvent(10, 110, 4, 8)], moveYEvents: [createEvent(20, 20, 4, 8)] });
  return { chart, target: { lineIndex: 1, layer: 1, type: 'moveXEvents', index: 0 } };
}

test('movement inspector uses counterclockwise degrees, signed length, fixed endpoints and translation', () => {
  let vector = movementVector([10, 20], [110, 20]);
  vector = changeMovementVector(vector, 'angle', 90);
  assert.deepEqual(vector.end, [10, 120]);
  vector = changeMovementVector(vector, 'length', -200);
  assert.deepEqual(vector.end, [10, -180]); assert.equal(vector.angle, 90);
  vector = movementVector(vector.start, vector.end, vector);
  close(vector.length, -200); close(vector.angle, 90);
  vector = changeMovementVector(vector, 'end', [-50, 50], 'end');
  assert.deepEqual(vector.start, [-50, 250]); assert.equal(vector.length, -200); assert.equal(vector.angle, 90);
  vector = changeMovementVector(vector, 'length', 50, 'end');
  assert.deepEqual(vector.end, [-50, 50]); assert.deepEqual(vector.start, [-50, 0]);
  vector = changeMovementVector(vector, 'start', [100, 100]);
  assert.deepEqual(vector.end, [100, 150]);
  vector = changeMovementVector(vector, 'length', 0); vector = changeMovementVector(vector, 'angle', 450);
  assert.equal(movementVector(vector.start, vector.end, vector).angle, 450);
  vector = changeMovementVector(vector, 'length', -25);
  assert.deepEqual(vector.end, [100, 75]); assert.equal(vector.angle, 450);
  assert.throws(() => changeMovementVector(vector, 'length', Infinity));
});

test('position input accepts two space-separated expressions and rejects incomplete input', () => {
  assert.deepEqual(parseMovementPosition('  -1.25   2e2 '), [-1.25, 200]);
  assert.deepEqual(parseMovementPosition('(1 + 2) (3 * 4)'), [3, 12]);
  for (const text of ['', '1', '1 2 3', '1 NaN', '1 2+', '1 Infinity']) assert.throws(() => parseMovementPosition(text));
});

test('paired events use only their own values on the actual selected line and layer', () => {
  const { chart, target } = fixture(); const original = structuredClone(chart);
  let { vector } = eventMovementVector(chart, target);
  assert.deepEqual(vector.start, [10, 20]); assert.deepEqual(vector.end, [110, 20]);
  vector = changeMovementVector(vector, 'angle', 90, 'end');
  const next = editMovementVector(chart, target, vector), tracks = next.judgeLineList[1].eventLayers[1];
  assert.deepEqual([tracks.moveXEvents[0].start, tracks.moveXEvents[0].end], [110, 110]);
  assert.deepEqual([tracks.moveYEvents[0].start, tracks.moveYEvents[0].end], [-80, 20]);
  assert.equal(next.judgeLineList[0], chart.judgeLineList[0]);
  assert.equal(next.judgeLineList[1].eventLayers[0], chart.judgeLineList[1].eventLayers[0]);
  assert.deepEqual(chart, original); assertChart(next);
  const reverse = eventMovementVector(next, { ...target, type: 'moveYEvents' });
  assert.deepEqual(reverse.vector.start, [110, -80]); close(reverse.vector.angle, 90);
  assert.equal(editMovementVector(next, target, eventMovementVector(next, target).vector), next);
});

test('missing axis uses the ordinary placement predecessor end, creates lazily, and undoes atomically in multi-line mode', () => {
  const { chart, target } = fixture(), tracks = chart.judgeLineList[1].eventLayers[1];
  tracks.moveYEvents = [createEvent(0, 777, 8, 9), createEvent(10, 40, 0, 1), createEvent(40, 90, 2, 3)];
  const before = structuredClone(chart), resolved = eventMovementVector(chart, target);
  assert.equal(resolved.missing, true); assert.deepEqual(resolved.vector.start, [10, 90]); assert.deepEqual(resolved.vector.end, [110, 90]);
  assert.equal(tracks.moveYEvents.length, 3); assert.deepEqual(chart, before);
  const vector = changeMovementVector(resolved.vector, 'angle', 90);
  const next = editMovementVector(chart, target, vector);
  assert.equal(next.judgeLineList[1].eventLayers[1].moveYEvents.length, 4);
  const created = next.judgeLineList[1].eventLayers[1].moveYEvents[3];
  assert.deepEqual([created.start, created.end], [90, 190]); assert.deepEqual(created.startTime, tracks.moveXEvents[0].startTime);
  const session = new EditorSession(chart); session.eventLayer = 1; session.setMultiLineEnabled(true, 'events'); session.multiLineIndices = [0, 1];
  session.multiEventSelection = new Map([[1, new Set(['moveXEvents:0'])]]); session.focus = 'events';
  session.commit('vector', next); assert.equal(session.history.dirty, true); assert.equal(session.history.undoStack.length, 1);
  session.travel('undo'); assert.deepEqual(session.chart, chart); assert.equal(session.multiEventSelection.get(1).has('moveXEvents:0'), true);
  session.travel('redo'); assert.deepEqual(session.chart, next); assertChart(next);
  assert.equal(JSON.stringify(next).includes('"vector"'), false);
});

test('missing axis falls back to zero only without a predecessor, ignoring other lines/layers', () => {
  const { chart, target } = fixture(); chart.judgeLineList[1].eventLayers[1].moveYEvents = [];
  chart.judgeLineList[1].eventLayers[0].moveYEvents[0].end = 123;
  assert.deepEqual(eventMovementVector(chart, target).vector.start, [10, 0]);
});

test('overlapping and duplicate counterparts block changes, while touching intervals permit creation', () => {
  const { chart, target } = fixture(), tracks = chart.judgeLineList[1].eventLayers[1];
  for (const event of [createEvent(0, 1, 3, 6), createEvent(0, 1, 5, 5)]) {
    tracks.moveYEvents = [event]; const original = structuredClone(chart), pair = eventMovementVector(chart, target);
    assert.ok(pair.error); assert.throws(() => editMovementVector(chart, target, changeMovementVector(pair.vector, 'length', 200)));
    assert.deepEqual(chart, original);
  }
  tracks.moveYEvents = [createEvent(0, 1, 4, 8), createEvent(1, 2, 4, 8)]; assert.ok(movementEventPair(chart, target).error);
  tracks.moveYEvents = [createEvent(0, 1, 1, 4), createEvent(1, 2, 8, 9)]; assert.equal(movementEventPair(chart, target).error, '');
});

test('binding groups follow existing property semantics, and anchored events reject incompatible angles', () => {
  const { chart, target } = fixture(), tracks = chart.judgeLineList[1].eventLayers[1];
  tracks.moveXEvents[0].linkgroup = 7; tracks.moveXEvents.push({ ...createEvent(20, 30, 9, 10), linkgroup: 7, marker: 'keep' });
  let vector = changeMovementVector(eventMovementVector(chart, target).vector, 'length', 150);
  const next = editMovementVector(chart, target, vector);
  assert.equal(next.judgeLineList[1].eventLayers[1].moveXEvents[1].end, 160);
  assert.equal(next.judgeLineList[1].eventLayers[1].moveXEvents[1].marker, 'keep');
  tracks.moveYEvents[0].inst = 1;
  vector = changeMovementVector(eventMovementVector(chart, target).vector, 'angle', 90);
  assert.throws(() => editMovementVector(chart, target, vector));
  vector = changeMovementVector(eventMovementVector(chart, target).vector, 'start', [30, 40]);
  assert.doesNotThrow(() => editMovementVector(chart, target, vector));
});

test('cropped custom easing retains its shape and unknown fields when vector endpoints move', () => {
  const { chart, target } = fixture(), tracks = chart.judgeLineList[1].eventLayers[1];
  const curve = linearCurve();
  tracks.moveXEvents[0] = { ...cropCustomEvent(withCustomEasing(createEvent(0, 100, 0, 10), curve), .4, .8, [4, 0, 1], [8, 0, 1]), privateFlag: true };
  const initial = eventMovementVector(chart, target), vector = changeMovementVector(initial.vector, 'start', [100, 100]);
  const next = editMovementVector(chart, target, vector), event = next.judgeLineList[1].eventLayers[1].moveXEvents[0];
  close(eventNumericValue(event, .5) - eventNumericValue(tracks.moveXEvents[0], .5), 100 - initial.vector.start[0]);
  assert.equal(event.privateFlag, true); assert.deepEqual(event.customEasing.domain, [.4, .8]); assertChart(next);
});

test('vector setting defaults on and round-trips independently of XY binding', () => {
  assert.equal(DEFAULT_EDITOR_PREFERENCES.movementVector, true);
  const storage = new Map(); storage.getItem = key => storage.get(key); storage.setItem = (key, value) => storage.set(key, value);
  writeEditorPreferences({ movementVector: false, xyBinding: true }, storage);
  assert.deepEqual(readEditorPreferences(storage), { movementVector: false, xyBinding: true });
});
