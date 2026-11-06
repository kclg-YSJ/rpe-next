import test from 'node:test';
import assert from 'node:assert/strict';
import { BatchControls } from '../src/ui/batch-controls.mjs';
import { Timeline } from '../src/ui/timeline.mjs';
import { EditorSession } from '../src/application/session.mjs';
import { createChart, createLine, createEvent, createNote } from '../src/core/chart.mjs';
import { TempoMap } from '../src/core/tempo.mjs';
import { beatValue } from '../src/core/beat.mjs';
import { snapTime } from '../src/core/edit-grid.mjs';

function fixture(area = 'events', multi = false) {
  const chart = createChart(); chart.BPMList.push({ startTime: [2, 1, 2], bpm: 240 }); chart.judgeLineList.push(createLine()); chart.judgeLineList[1].bpmfactor = .5;
  for (const line of chart.judgeLineList) { line.eventLayers[0].moveXEvents = [createEvent(0, 1, .1, 1.1), createEvent(1, 2, 2.1, 3.1)]; line.notes = [createNote(1, .1, 10), createNote(1, 2.1, 20)]; }
  const session = new EditorSession(chart); session.focus = area; session.multiSelectionIntent = area;
  if (area === 'events') session.eventSelection = new Set(['moveXEvents:0', 'moveXEvents:1']); else session.selection = new Set([0, 1]);
  if (multi) {
    session.multiLineEnabled = true; session.multiLineMode = area; session.multiLineIndices = [0, 1];
    const selection = area === 'notes' ? session.selection : session.eventSelection;
    if (area === 'notes') session.multiLineSelection = new Map([[0, new Set(selection)], [1, new Set(selection)]]);
    else session.multiEventSelection = new Map([[0, new Set(selection)], [1, new Set(selection)]]);
  }
  const canvas = { clientWidth: 600, clientHeight: 600, style: {}, addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 600 }) };
  const timeline = new Timeline(canvas, canvas, () => session, () => {}, () => {}); timeline.tempo = new TempoMap(chart.BPMList);
  const controls = Object.create(BatchControls.prototype), button = { title: '拖动', style: {}, getAnimations: () => [], setPointerCapture() {}, hasPointerCapture: () => false, animate() {} };
  Object.assign(controls, { timeline, getSession: () => session, enabled: () => true, reportError: error => { throw error; }, groups: new Map([[area, { hint: {}, host: {} }]]), anchorMode: 0 });
  const pointer = (x = 230.3, y = 157.9) => ({ button: 0, pointerId: 1, clientX: x, clientY: y, preventDefault() {}, stopPropagation() {} });
  return { controls, button, pointer, session, timeline, hint: controls.groups.get(area).hint };
}

test('batch ball delta starts at zero off the grid; displayed delta and each preview use the same snapped displacement', () => {
  for (const area of ['notes', 'events']) for (const multi of [false, true]) {
    const { controls, button, pointer, session, timeline, hint } = fixture(area, multi), original = session.chart;
    controls.begin(pointer(), area, area === 'notes' ? 'note-move' : 'event-move', button);
    assert.match(hint.textContent, /0\.000/); assert.ok(!hint.textContent.includes('-0.000'));
    const starts = new Map(controls.active.startBeatsByLine);
    controls.move(pointer()); assert.match(hint.textContent, /0\.000/);
    const point = { x: pointer().clientX, y: pointer().clientY - 43 };
    controls.move(pointer(point.x, point.y));
    for (const [lineIndex, start] of starts) {
      const factor = timeline.factorForLine(lineIndex), seconds = timeline.tempo.seconds(timeline.origin, factor) + (timeline.baseline(600) - point.y) / timeline.scale;
      const delta = beatValue(snapTime(seconds, timeline.division, timeline.tempo, factor)) - start;
      const next = controls.active.result.chart.judgeLineList[lineIndex];
      assert.ok(Math.abs(beatValue(area === 'notes' ? next.notes[0].startTime : next.eventLayers[0].moveXEvents[0].startTime) - .1 - delta) < 1e-9);
      if (lineIndex === controls.active.lineIndex) assert.ok(hint.textContent.includes(delta.toFixed(3)));
    }
    assert.equal(session.chart, original); assert.equal(session.history.undoStack.length, 0);
    controls.cancel(); assert.equal(timeline.bulkPreview, null);
  }
});

test('batch ball origin stays anchored through scrolling and BPM/multiplier changes in the visible range', () => {
  const { controls, button, pointer, session, timeline } = fixture('events', true);
  controls.begin(pointer(), 'events', 'event-move', button); const starts = new Map(controls.active.startBeatsByLine);
  timeline.origin = 4; controls.move(pointer());
  for (const [lineIndex, start] of starts) {
    const factor = timeline.factorForLine(lineIndex), seconds = timeline.tempo.seconds(4, factor) + (timeline.baseline(600) - pointer().clientY) / timeline.scale;
    const delta = beatValue(snapTime(seconds, timeline.division, timeline.tempo, factor)) - start;
    assert.ok(delta > 0); assert.ok(Math.abs(beatValue(controls.active.result.chart.judgeLineList[lineIndex].eventLayers[0].moveXEvents[0].startTime) - .1 - delta) < 1e-9);
  }
  assert.equal(session.chart, controls.active.snapshot.chart); controls.cancel();
});
