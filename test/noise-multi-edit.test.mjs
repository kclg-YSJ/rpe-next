import test from 'node:test';
import assert from 'node:assert/strict';
import { createChart } from '../src/core/chart.mjs';
import { createNoiseArea, createNoiseEvent } from '../src/core/noise-areas.mjs';
import { captureNoiseEdit, previewNoiseEdit, noiseEventTool, applyNoiseEdit, mirrorNoiseEvent, mirrorNoiseArea } from '../src/application/noise-edit.mjs';
import { EditorSession } from '../src/application/session.mjs';
import { NoiseAreaEditor } from '../src/ui/noise-area.mjs';
import { TempoMap } from '../src/core/tempo.mjs';
import { rememberEventValueChange } from '../src/application/event-value-memory.mjs';

function fixture(keys = ['area:0', 'area:1']) {
  const chart = createChart(); chart.blockAreaList = Array.from({ length: 3 }, () => ({ ...createNoiseArea(0, 20),
    activeIntervals: [{ startTime: [0, 0, 1], endTime: [10, 0, 1], readyFlash: .5 }],
    moveXEvents: [createNoiseEvent(0, 10, 0, 1), createNoiseEvent(20, 30, 2, 3)],
    moveYEvents: [createNoiseEvent(50, 60, 0, 1)],
    rotateEvents: [createNoiseEvent(0, 10, 0, 1, { x: 12, y: -8 })],
  }));
  const session = new EditorSession(chart), editor = Object.assign(Object.create(NoiseAreaEditor.prototype), { selected: 0, event: { type: 'moveXEvents', index: 0 }, active: true, selection: new Set(keys),
    getContext: () => ({ session, tempo: new TempoMap(chart.BPMList), timeline: { origin: 0, division: 4 } }), render() {}, invalidate() {}, notify() {}, commit: (label, chart) => session.commit(label, chart), activate() {} });
  return { editor, session, chart };
}

test('area distribution applies +100/+200 to every corresponding endpoint, ignoring event counts and activation intervals', () => {
  const { editor, session, chart } = fixture(); chart.blockAreaList[1].moveXEvents.push(createNoiseEvent(40, 50, 4, 5));
  const result = previewNoiseEdit(captureNoiseEdit(editor), { eventType: 'moveXEvents', lower: 0, upper: 200 });
  assert.deepEqual(result.chart.blockAreaList.slice(0, 2).map(area => area.moveXEvents.map(event => [event.start, event.end])), [[[100, 110], [120, 130]], [[200, 210], [220, 230], [240, 250]]]);
  assert.equal(session.chart, chart); assert.equal(result.chart.blockAreaList[2], chart.blockAreaList[2]);
  for (const i of [0, 1]) { assert.equal(result.chart.blockAreaList[i].activeIntervals, chart.blockAreaList[i].activeIntervals); assert.equal(result.chart.blockAreaList[i].moveYEvents, chart.blockAreaList[i].moveYEvents); }
  applyNoiseEdit(editor, result); assert.equal(session.history.undoStack.length, 1); assert.deepEqual([...editor.selection], ['area:0', 'area:1']);
  session.travel('undo'); assert.equal(session.chart, chart); session.travel('redo'); assert.equal(session.chart, result.chart); assert.deepEqual([...editor.selection], ['area:0', 'area:1']);
});

test('empty tracks are skipped without creating events or shifting other area operands; scripts operate once per area', () => {
  const { editor, chart } = fixture(['area:0', 'area:1', 'area:2']); chart.blockAreaList[1].moveXEvents = [];
  const result = previewNoiseEdit(captureNoiseEdit(editor), { eventType: 'moveXEvents', mode: 'script', script: 'value = 100 * n;', operation: 'By' });
  assert.deepEqual(result.chart.blockAreaList.map(area => area.moveXEvents.map(event => event.start)), [[100, 120], [], [300, 320]]);
  assert.equal(result.chart.blockAreaList[1], chart.blockAreaList[1]);
  assert.throws(() => previewNoiseEdit(captureNoiseEdit(editor), { eventType: 'activeIntervals' }), /种类/);
});

test('all four initial corner targets edit empty noise areas without creating or changing internal events', () => {
  for (const type of ['bottomLeft.x', 'bottomLeft.y', 'topRight.x', 'topRight.y']) {
    const { editor, session, chart } = fixture();
    for (const area of chart.blockAreaList.slice(0, 2)) for (const key of ['moveXEvents', 'moveYEvents', 'rotateEvents', 'scaleXEvents', 'scaleYEvents', 'activeIntervals']) delete area[key];
    const [corner, axis] = type.split('.'), original = chart.blockAreaList.map(area => area[corner][axis]);
    const result = previewNoiseEdit(captureNoiseEdit(editor), { eventType: type, lower: 0, upper: 200 });
    assert.deepEqual(result.chart.blockAreaList.map(area => area[corner][axis]), [original[0] + 100, original[1] + 200, original[2]]);
    for (const index of [0, 1]) {
      assert.equal(result.chart.blockAreaList[index][corner][axis === 'x' ? 'y' : 'x'], chart.blockAreaList[index][corner][axis === 'x' ? 'y' : 'x']);
      assert.equal(result.chart.blockAreaList[index][corner === 'bottomLeft' ? 'topRight' : 'bottomLeft'], chart.blockAreaList[index][corner === 'bottomLeft' ? 'topRight' : 'bottomLeft']);
      for (const key of ['moveXEvents', 'moveYEvents', 'rotateEvents', 'scaleXEvents', 'scaleYEvents', 'activeIntervals']) assert.equal(Object.hasOwn(result.chart.blockAreaList[index], key), false);
    }
    assert.equal(result.chart.blockAreaList[2], chart.blockAreaList[2]); assert.equal(result.changes.length, 2); assert.equal(session.chart, chart);
    applyNoiseEdit(editor, result); assert.equal(session.history.undoStack.length, 1); assert.deepEqual([...editor.selection], ['area:0', 'area:1']);
    session.travel('undo'); assert.equal(session.chart, chart); session.travel('redo'); assert.equal(session.chart, result.chart);
  }
});

test('initial corner edits preserve every existing internal track, support scripts and reject invalid coordinates atomically', () => {
  const { editor, session, chart } = fixture();
  const result = previewNoiseEdit(captureNoiseEdit(editor), { eventType: 'topRight.y', mode: 'script', script: 'value = -100 * n;', operation: 'To' });
  assert.deepEqual(result.chart.blockAreaList.map(area => area.topRight.y), [-100, -200, 150]);
  for (const index of [0, 1]) for (const key of ['moveXEvents', 'moveYEvents', 'rotateEvents', 'activeIntervals']) assert.equal(result.chart.blockAreaList[index][key], chart.blockAreaList[index][key]);
  assert.throws(() => previewNoiseEdit(captureNoiseEdit(editor), { eventType: 'bottomLeft.x', lower: '1e308', upper: '1e308', operation: 'Times' }), /有限/);
  assert.equal(session.chart, chart); assert.equal(session.history.undoStack.length, 0);
  assert.throws(() => previewNoiseEdit(captureNoiseEdit(editor), { eventType: 'bottomLeft.z' }), /种类/);
});

test('single noise event cut uses configured density, selects pieces and restores the single selection on undo', () => {
  const { editor, session, chart } = fixture(['rotateEvents:0']); editor.event = { type: 'rotateEvents', index: 0 }; session.cutDensity = 2;
  editor.cutSingleEvent(); const parts = session.chart.blockAreaList[0].rotateEvents;
  assert.equal(parts.length, 8); assert.equal(editor.selection.size, 8); assert.equal(session.history.undoStack.length, 1);
  assert.ok(parts.every(part => part.easingType === 1 && part.anchor.x === 12 && part.anchor.y === -8));
  assert.equal(session.chart.blockAreaList[1], chart.blockAreaList[1]); assert.equal(session.chart.blockAreaList[0].activeIntervals, chart.blockAreaList[0].activeIntervals);
  session.travel('undo'); assert.equal(session.chart, chart); assert.deepEqual([...editor.selection], ['rotateEvents:0']);
  session.travel('redo'); assert.equal(editor.selection.size, 8);
  session.travel('undo'); editor.selection = new Set(['activeIntervals:0']); editor.event = { type: 'activeIntervals', index: 0 }; editor.cutSingleEvent(); assert.equal(session.chart, chart); assert.equal(session.history.undoStack.length, 0);
});

test('batch previews do not read or validate unselected noise areas', () => {
  const { editor, chart } = fixture(); let reads = 0;
  Object.defineProperty(chart.blockAreaList[2], 'moveXEvents', { get() { reads++; throw Error('unselected area scanned'); } });
  const result = previewNoiseEdit(captureNoiseEdit(editor), { eventType: 'moveXEvents', lower: 1, upper: 2 });
  assert.equal(result.changes.length, 4); assert.equal(reads, 0);
  editor.selection = new Set(['moveXEvents:0', 'moveXEvents:1']);
  assert.equal(previewNoiseEdit(captureNoiseEdit(editor), { lower: 1, upper: 2 }).changes.length, 2); assert.equal(reads, 0);
});

test('internal batch edits only selected ordinary event tracks, preserving anchors and inactive selections', () => {
  const { editor, chart } = fixture(['moveXEvents:1', 'rotateEvents:0', 'activeIntervals:0']);
  const result = previewNoiseEdit(captureNoiseEdit(editor), { field: 'both', lower: 100, upper: 100 });
  assert.deepEqual(result.chart.blockAreaList[0].moveXEvents.map(event => event.start), [0, 120]);
  assert.equal(result.chart.blockAreaList[0].rotateEvents[0].start, 100);
  assert.deepEqual(result.chart.blockAreaList[0].rotateEvents[0].anchor, { x: 12, y: -8 });
  assert.equal(result.chart.blockAreaList[0].activeIntervals, chart.blockAreaList[0].activeIntervals);
  assert.equal(result.keys.has('activeIntervals:0'), true);
  assert.throws(() => previewNoiseEdit(captureNoiseEdit(editor), { mode: 'script', script: 'line = 0;' }), /line/);
});

test('illegal overlapping internal times and stale previews fail before any chart or selection mutation', () => {
  const { editor, session, chart } = fixture(['moveXEvents:0', 'moveXEvents:1']);
  assert.throws(() => previewNoiseEdit(captureNoiseEdit(editor), { field: 't1', operation: 'To', lower: 0, upper: 0 }), /重叠/);
  assert.equal(session.chart, chart); assert.equal(session.history.undoStack.length, 0);
  const result = previewNoiseEdit(captureNoiseEdit(editor), { field: 'both', lower: 1, upper: 1 });
  session.commit('manual', { ...chart, META: { ...chart.META, name: 'changed' } });
  assert.throws(() => applyNoiseEdit(editor, result), /谱面已变化/); assert.equal(session.history.undoStack.length, 1);
});

test('internal cut and predecessor glue stay in this area, preserving skipped activation and selection across undo', () => {
  const { editor, session, chart } = fixture(['moveXEvents:0', 'moveXEvents:1', 'activeIntervals:0']);
  const cut = noiseEventTool(captureNoiseEdit(editor), 'cut', { division: 2, density: 1 });
  assert.equal(cut.chart.blockAreaList[0].moveXEvents.length, 4); assert.equal(cut.keys.size, 5);
  applyNoiseEdit(editor, cut); session.travel('undo'); assert.equal(session.chart, chart); assert.equal(editor.selection.size, 3);
  const stick = noiseEventTool(captureNoiseEdit(editor), 'stick'); assert.equal(stick.chart.blockAreaList[0].moveXEvents[1].start, 10);
  assert.equal(stick.chart.blockAreaList[1], chart.blockAreaList[1]);
});

test('noise F respects the last edited endpoint; G joins the actual next event; active intervals ignore both', () => {
  const { editor, session } = fixture(['moveXEvents:0']);
  const source = editor.area().moveXEvents[0], next = { ...source, end: 80 }; editor.area().moveXEvents[0] = next;
  rememberEventValueChange(session, source, next, 'end', { type: 'moveXEvents', index: 0 });
  editor.action('SwitchLock'); assert.deepEqual([editor.area().moveXEvents[0].start, editor.area().moveXEvents[0].end], [80, 80]);
  editor.action('SwitchLock'); editor.action('StickNext'); assert.equal(editor.area().moveXEvents[0].end, 20);
  editor.selection = new Set(['activeIntervals:0']); editor.event = { type: 'activeIntervals', index: 0 }; const chart = session.chart;
  editor.action('SwitchLock'); editor.action('StickNext'); assert.equal(session.chart, chart);
});

test('new noise events inherit preceding easing and value; explicit placement easing overrides it', () => {
  const { editor } = fixture(['moveXEvents:0']); editor.area().moveXEvents[1].easingType = 5;
  editor.select = function(index, event) { this.selected = index; this.event = event; };
  editor.addEvent('moveXEvents', 4, 5); const inherited = editor.area().moveXEvents.at(-1);
  assert.equal(inherited.easingType, 5); assert.equal(inherited.start, 30);
  editor.addEvent('moveXEvents', 6, 7, true, 7); assert.equal(editor.area().moveXEvents.at(-1).easingType, 7); assert.equal(editor.area().moveXEvents.at(-1).inst, 1);
});

test('mirrored noise paste reflects X, rotation, anchors and cropped source values, preserving activation and Y values', () => {
  const source = { ...createNoiseEvent(20, 40, 0, 2, { x: 50, y: 25 }), transformStart: 10, transformEnd: 60 };
  const mirrored = mirrorNoiseEvent('rotateEvents', source); assert.deepEqual([mirrored.start, mirrored.end, mirrored.transformStart, mirrored.transformEnd], [-20, -40, -10, -60]); assert.deepEqual(mirrored.anchor, { x: -50, y: 25 });
  const { chart } = fixture(), area = chart.blockAreaList[0]; area.bottomLeft.x = -10; area.topRight.x = 70;
  const result = mirrorNoiseArea(area); assert.deepEqual([result.bottomLeft.x, result.topRight.x], [-70, 10]);
  assert.deepEqual(result.moveXEvents.map(event => event.end), [-10, -30]); assert.deepEqual(result.moveYEvents, area.moveYEvents); assert.equal(result.activeIntervals, area.activeIntervals);
});
