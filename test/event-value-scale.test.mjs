import test from 'node:test';
import assert from 'node:assert/strict';
import { createChart, createLine, createEvent, assertChart } from '../src/core/chart.mjs';
import { EditorSession } from '../src/application/session.mjs';
import { captureSelection, commitSelectionEdit } from '../src/application/batch-edit.mjs';
import { canScaleEventValue, eventScaleColumns, eventScaleKey, snapEventScaleAxis, eventScaleAxisSnap, EVENT_SCALE_TRAVEL, eventScaleRate, eventScaleRuler, eventScaleGesture } from '../src/core/event-value-scale.mjs';
import { scaleEventValues } from '../src/application/event-value-scale.mjs';
import { withCustomEasing, cropCustomEvent, eventNumericValue } from '../src/core/event-easing.mjs';
import { linearCurve } from '../src/core/animation-curve.mjs';
import { DEFAULT_EDITOR_PREFERENCES } from '../src/core/default-settings.mjs';
import { normalizeEditorPreferences } from '../src/platform/editor-preferences.mjs';
import { BatchControls } from '../src/ui/batch-controls.mjs';
import { Timeline } from '../src/ui/timeline.mjs';
import { TempoMap } from '../src/core/tempo.mjs';
import { EventValueScale } from '../src/ui/event-value-scale.mjs';

function fixture() {
  const chart = createChart(); chart.judgeLineList.push(createLine());
  for (const [index, line] of chart.judgeLineList.entries()) {
    line.eventLayers.push({ moveXEvents: [{ ...createEvent(index * 100 + 10, index * 100 + 30, 4, 8), marker: 'keep' }, createEvent(index * 100 + 30, index * 100 + 50, 8, 12)], moveYEvents: [createEvent(-100, 0, 4, 8)], alphaEvents: [createEvent(0, 255, 4, 8)] });
  }
  const session = new EditorSession(chart); session.eventLayer = 1; session.focus = 'events'; session.xyBinding = true;
  session.multiLineEnabled = true; session.multiLineMode = 'events'; session.multiLineIndices = [0, 1];
  session.multiEventSelection = new Map([[0, new Set(['moveXEvents:0', 'moveXEvents:1', 'moveYEvents:0'])], [1, new Set(['moveXEvents:0'])]]);
  const snapshot = captureSelection(session); snapshot.notes = [];
  return { session, snapshot, columns: eventScaleColumns(snapshot.events) };
}

test('each selected line and column owns its midpoint axis, cached snap candidates and preserved custom axis', () => {
  const { snapshot, columns } = fixture(); assert.equal(columns.size, 3);
  assert.equal(columns.get('0:moveXEvents').axis, 30); assert.equal(columns.get('0:moveYEvents').axis, -50); assert.equal(columns.get('1:moveXEvents').axis, 120);
  columns.get('0:moveXEvents').axis = 15;
  const next = eventScaleColumns(snapshot.events, columns); assert.equal(next.get('0:moveXEvents').axis, 15);
  assert.deepEqual(next.get('0:moveXEvents').values, [10, 20, 30, 40, 50]);
});

test('axis snaps only within the pixel radius to tens, selected endpoints and per-event midpoints', () => {
  const columns = eventScaleColumns([{ lineIndex: 0, type: 'rotateEvents', event: createEvent(13, 41, 0, 1) }]), column = columns.values().next().value;
  assert.equal(snapEventScaleAxis(12.8, column, .1), 13);
  assert.equal(snapEventScaleAxis(27.3, column, .1), 27);
  assert.equal(snapEventScaleAxis(30.4, column, .1), 30);
  assert.equal(snapEventScaleAxis(33, column, .1), 33);
  assert.equal(snapEventScaleAxis(40.8, column, .1), 41);
});

test('factor supports default/custom snapping, free negative scaling and a fresh unit origin each drag', () => {
  assert.equal(EVENT_SCALE_TRAVEL, 150 * 1.3);
  assert.equal(eventScaleRate(0), 1); assert.equal(eventScaleRate(9.1), 1.05); assert.equal(eventScaleRate(5.2), 1.05);
  assert.equal(eventScaleRate(-390), -1); assert.equal(eventScaleRate(8.45, 1, false), 1.0433333333);
  assert.equal(eventScaleRate(22.75, 1, true, .2), 1.2); assert.equal(eventScaleRate(0, .5), 1);
  assert.equal(eventScaleRate(0, 1, true, .3), 1);
  assert.equal(eventScaleRate(5.2, 1, true, .3), 1);
});

test('axis snapping identifies source endpoints/midpoints and gives zero a wider capture radius', () => {
  const event = createEvent(-23, 41, 1, 3), column = eventScaleColumns([{ lineIndex: 2, type: 'rotateEvents', index: 7, event }]).values().next().value;
  const start = eventScaleAxisSnap(-23.2, column, .1); assert.equal(start.value, -23); assert.equal(start.targets[0].kind, 'start'); assert.equal(start.targets[0].index, 7);
  const end = eventScaleAxisSnap(41.3, column, .1); assert.equal(end.targets[0].kind, 'end'); assert.equal(end.targets[0].event, event);
  const middle = eventScaleAxisSnap(9.2, column, .1); assert.equal(middle.targets[0].kind, 'middle');
  assert.equal(eventScaleAxisSnap(1.5, column, .1).kind, 'zero'); assert.equal(eventScaleAxisSnap(1.5, column, .1).value, 0);
  assert.equal(eventScaleAxisSnap(21.5, column, .1).value, 21.5);
});

test('scale ruler stays inside the canvas for negative factors and offscreen ball positions', () => {
  for (const rate of [-5, -1, -.05, 0, 1, 5]) {
    const unit = .5, labels = [], rectangles = [], points = [];
    const context = { fillRect: (...args) => rectangles.push(args), beginPath() {}, moveTo: (...point) => points.push(point), lineTo: (...point) => points.push(point), stroke() {}, fillText: (...args) => labels.push(args) };
    const mode = Object.create(EventValueScale.prototype);
    const active = { kind: 'event-value-scale', unit, point: { x: 120 + (rate - 1) * EVENT_SCALE_TRAVEL * unit, y: 200 }, scaleOrigin: { x: 120, y: 200 }, rate };
    const layout = eventScaleRuler(active, { left: -600, right: 600, top: 0, bottom: 500 });
    mode.drawRuler(context, layout);
    assert.equal(rectangles.length, 1); const [x, y, width, height] = rectangles[0];
    assert.ok(x >= -600 && x + width <= 600 && y === 0 && height === 40);
    assert.ok(labels.length > 0); assert.ok(points.length > 10);
    if (rate <= -.5) assert.ok(labels.some(([text]) => Number(text) < 0), JSON.stringify({ rate, labels }));
    for (const [text, x, y] of labels) { assert.ok(Number.isFinite(Number(text))); assert.ok(x >= -600 && x <= 600 && y >= 0 && y <= 40); }
    assert.deepEqual(points.slice(-2), [[active.point.x, -4], [active.point.x, 17]]);
  }
});

test('ruler ticks remain anchored across snapping and zero, with a dead zone and one-way downward adjustment', () => {
  const active = { scaleOrigin: { x: 300, y: 200 }, point: { x: 300, y: 200 }, unit: 1, rate: 1 };
  const bounds = { left: -600, right: 900, top: 0, bottom: 600 };
  const initial = eventScaleRuler(active, bounds); assert.deepEqual([initial.left, initial.right, initial.top], [-45, 450, 236]);
  assert.ok(Math.abs((1 + (initial.left - initial.origin) / initial.pixels) - (1 - 150 / initial.pixels - 1)) < 1e-12);
  for (const [x, y, rate] of [[320, 202, 1.1], [322, 198, 1.1], [300, 210, 1]]) {
    active.point = { x, y }; active.rate = rate;
    const next = eventScaleRuler(active, bounds); assert.deepEqual([next.left, next.right, next.top], [-45, 450, 236]);
    assert.equal(next.marker, x); assert.equal(next.origin, 300);
  }
  for (const x of [120, 105, 100, 50, -50]) {
    active.point = { x, y: 200 }; active.rate = eventScaleRate(x - 300);
    const next = eventScaleRuler(active, bounds);
    assert.equal(next.origin - next.pixels, 105); assert.equal(next.marker, x); assert.equal(next.top, 236);
    assert.ok(next.left < x && next.right > x); // Continue through zero into negatives.
  }
  active.point = { x: -50, y: 260 }; const pushed = eventScaleRuler(active, bounds); assert.equal(pushed.top, 280);
  active.point = { x: -50, y: 259 }; assert.equal(eventScaleRuler(active, bounds).top, 280);
  active.point = { x: 320, y: 200 }; assert.equal(eventScaleRuler(active, bounds).top, 280);
  assert.equal(eventScaleRuler({ ...active, rulerFrame: undefined }, bounds).top, 236);
});

test('gesture needs a horizontal probe plus continuation; vertical and short drags never scale', () => {
  let probe = {}; assert.equal(eventScaleGesture(probe, 3, 2), undefined);
  assert.equal(eventScaleGesture(probe, 7, 1), 'horizontal'); assert.equal(eventScaleGesture(probe, 20, 2), 'horizontal'); assert.equal(eventScaleGesture(probe, 30, 3), 'scale');
  probe = {}; assert.equal(eventScaleGesture(probe, 1, 8), 'vertical'); assert.equal(eventScaleGesture(probe, 100, 8), 'vertical');
  probe = {}; assert.equal(eventScaleGesture(probe, -8, 1), 'horizontal'); assert.equal(eventScaleGesture(probe, -30, 2), 'scale');
  probe = {}; assert.equal(eventScaleGesture(probe, 100, 1), 'horizontal'); assert.equal(eventScaleGesture(probe, 117, 1), 'scale');
});

test('scaling previews only selected values on their true owners, preserves times/fields, and undoes once', () => {
  const { session, snapshot, columns } = fixture(), original = structuredClone(session.chart);
  const result = scaleEventValues(snapshot, columns, -2), line0 = result.chart.judgeLineList[0].eventLayers[1], line1 = result.chart.judgeLineList[1].eventLayers[1];
  assert.equal(result.valueScaleChanged, true);
  assert.deepEqual(line0.moveXEvents.map(e => [e.start, e.end]), [[70, 30], [30, -10]]);
  assert.deepEqual([line0.moveYEvents[0].start, line0.moveYEvents[0].end], [50, -150]);
  assert.deepEqual([line1.moveXEvents[0].start, line1.moveXEvents[0].end], [140, 100]);
  assert.equal(line1.moveYEvents, session.chart.judgeLineList[1].eventLayers[1].moveYEvents);
  assert.equal(line1.moveXEvents[1], session.chart.judgeLineList[1].eventLayers[1].moveXEvents[1]);
  assert.deepEqual(line0.moveXEvents[0].startTime, original.judgeLineList[0].eventLayers[1].moveXEvents[0].startTime);
  assert.equal(line0.moveXEvents[0].marker, 'keep'); assert.deepEqual(session.chart, original); assert.equal(session.history.dirty, false);
  assertChart(result.chart); commitSelectionEdit(session, result, 'scale'); assert.equal(session.history.undoStack.length, 1);
  session.travel('undo'); assert.deepEqual(session.chart, original); session.travel('redo'); assert.deepEqual(session.chart, result.chart);
  assert.equal(session.multiEventSelection.get(1).has('moveXEvents:0'), true);
});

test('single constants scale about a relocated axis; one and zero factors do not corrupt events', () => {
  const { snapshot } = fixture(); snapshot.events = [{ lineIndex: 0, type: 'moveXEvents', index: 0, event: snapshot.chart.judgeLineList[0].eventLayers[1].moveXEvents[0] }];
  const columns = eventScaleColumns(snapshot.events); columns.get('0:moveXEvents').axis = 0;
  assert.equal(scaleEventValues(snapshot, columns, 1).valueScaleChanged, false);
  assert.equal(scaleEventValues(snapshot, columns, 1).chart, snapshot.chart);
  const zero = scaleEventValues(snapshot, columns, 0).chart.judgeLineList[0].eventLayers[1].moveXEvents[0]; assert.equal(zero.start, 0); assert.equal(zero.end, 0);
});

test('custom easing is affinely scaled, alpha remains integer and legal, unsupported values are untouched', () => {
  const { snapshot } = fixture(), tracks = snapshot.chart.judgeLineList[0].eventLayers[1];
  const event = cropCustomEvent(withCustomEasing(createEvent(0, 100, 0, 10), linearCurve()), .4, .8, [4, 0, 1], [8, 0, 1]);
  tracks.moveXEvents[0] = event;
  snapshot.events = [{ lineIndex: 0, type: 'moveXEvents', index: 0, event }, { lineIndex: 0, type: 'alphaEvents', index: 0, event: tracks.alphaEvents[0] }];
  const columns = eventScaleColumns(snapshot.events), axis = columns.get('0:moveXEvents').axis;
  const result = scaleEventValues(snapshot, columns, -1.5), next = result.chart.judgeLineList[0].eventLayers[1];
  assert.ok(Math.abs(eventNumericValue(next.moveXEvents[0], .2) - (axis + (eventNumericValue(event, .2) - axis) * -1.5)) < 1e-8);
  assert.equal(Number.isInteger(next.alphaEvents[0].start), true); assert.equal(next.alphaEvents[0].start, 255); assert.ok(next.alphaEvents[0].end < 0); assertChart(result.chart);
  for (const event of [{ start: 'a', end: 'b' }, { start: [1, 2, 3], end: [4, 5, 6] }, { start: 0, end: 1, trajectory: {} }]) assert.equal(canScaleEventValue({ event }), false);
});

test('settings default enabled, persist independently, reject invalid steps', () => {
  assert.equal(DEFAULT_EDITOR_PREFERENCES.eventValueScale, true); assert.equal(DEFAULT_EDITOR_PREFERENCES.eventValueScaleSnap, true); assert.equal(DEFAULT_EDITOR_PREFERENCES.eventValueScaleStep, .05);
  assert.deepEqual(normalizeEditorPreferences({ eventValueScale: false, eventValueScaleSnap: false, eventValueScaleStep: .2 }), { eventValueScale: false, eventValueScaleSnap: false, eventValueScaleStep: .2 });
  assert.equal(normalizeEditorPreferences({ eventValueScaleStep: NaN }).eventValueScaleStep, undefined);
});

test('disabled blue ball uses original endpoint behavior and never constructs mode resources', () => {
  const { session } = fixture(); session.multiSelectionIntent = 'events';
  const canvas = { clientWidth: 600, clientHeight: 600, style: {}, addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 600 }) };
  const timeline = new Timeline(canvas, canvas, () => session, () => {}, () => {}); timeline.tempo = new TempoMap(session.chart.BPMList);
  const controls = Object.create(BatchControls.prototype), button = { title: 'end', style: {}, getAnimations: () => [], setPointerCapture() {}, hasPointerCapture: () => false, animate() {} };
  Object.assign(controls, { timeline, getSession: () => session, enabled: () => true, reportError: error => { throw error; }, valueScaleOptions: () => ({ enabled: false }), groups: new Map([['events', { hint: {}, host: {} }]]), anchorMode: 0 });
  const pointer = (x, y) => ({ button: 0, pointerId: 1, clientX: x, clientY: y, preventDefault() {}, stopPropagation() {} });
  controls.begin(pointer(200, 200), 'events', 'event-end', button); controls.move(pointer(250, 170));
  assert.equal(controls.active.scaleProbe, undefined); assert.equal(controls.valueScale, undefined); assert.equal(controls.active.kind, 'event-end');
  assert.ok(controls.active.result); controls.cancel(); assert.equal(timeline.bulkPreview, null);
});
