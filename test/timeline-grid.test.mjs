import test from 'node:test';
import assert from 'node:assert/strict';
import { TempoMap } from '../src/core/tempo.mjs';
import { timelineGrid } from '../src/core/timeline-grid.mjs';
import { Timeline } from '../src/ui/timeline.mjs';
import { EditorSession } from '../src/application/session.mjs';
import { createLine } from '../src/core/chart.mjs';
import { paintTimelineGrid } from '../src/ui/timeline-grid.mjs';

const tempo = new TempoMap([{ bpm: 120, startTime: [0, 0, 1] }]);
test('dense grid keeps a fixed chart phase and all whole beats as the viewport moves', () => {
  for (const division of [4, 7, 21, 32, 64, 100]) {
    const samples = Array.from({ length: 90 }, (_, frame) => [...timelineGrid(tempo, frame / 250 - 2, frame / 250 + 10, division, 180)]);
    const center = samples.map(ticks => ticks.filter(tick => tick.beat >= 1 && tick.beat <= 9).map(tick => [tick.tick, tick.label]));
    for (const ticks of center) assert.deepEqual(ticks, center[0]);
    for (const ticks of samples) for (let beat = 1; beat <= 9; beat++) assert.ok(ticks.some(tick => tick.beat === beat && tick.label));
    assert.ok(samples.every(ticks => ticks.length <= 200));
  }
});

test('visible BPM segments get independent density and fixed labels at extreme BPM, factors and zoom', () => {
  const map = new TempoMap([{ bpm: 120, startTime: [0, 0, 1] }, { bpm: 30000, startTime: [10, 0, 1] }]);
  for (const factor of [.25, 1, 3]) for (const scale of [20, 180, 2000]) {
    const first = map.beat(0, factor), last = map.beat(8, factor), ticks = [...timelineGrid(map, first, last, 100, scale, factor)];
    assert.ok(ticks.length <= 8 * scale / 6 + 8, 'draw work must follow visible pixels, not subdivision count');
    assert.equal(new Set(ticks.map(tick => tick.tick)).size, ticks.length);
    assert.ok(ticks.every(tick => tick.beat >= first - 1e-8 && tick.beat <= last + 1e-8));
    const labels = ticks.filter(tick => tick.label).map(tick => tick.tick);
    assert.deepEqual([...timelineGrid(map, first, last, 100, scale, factor, { labelsOnly: true })].map(tick => tick.tick), labels);
  }
  const ticks = [...timelineGrid(map, 8, 500, 100, 180)];
  assert.ok(ticks.some(tick => tick.beat === 9 && tick.label));
  assert.ok(ticks.some(tick => tick.beat > 400), 'fast area must reach the far edge rather than hitting a row cap');
});

test('multi-line tick ranges and grid positions use the same time mapping and actual line factors', () => {
  const session = new EditorSession(); session.chart.judgeLineList.push(createLine()); session.chart.judgeLineList[1].bpmfactor = 2;
  const canvas = { clientHeight: 700, clientWidth: 900, style: {}, addEventListener() {} };
  const timeline = new Timeline(canvas, canvas, () => session, () => {}, () => {}); timeline.origin = 5; timeline.scale = 180; timeline.division = 100;
  for (const lineIndex of [0, 1]) for (const { beat } of timeline.gridTicks(700, lineIndex)) assert.ok(timeline.verticalForLine(beat, lineIndex) >= -1e-7 && timeline.verticalForLine(beat, lineIndex) <= 700 + 1e-7);
});

test('invalid geometry emits no rows and flow fallback stays bounded', () => {
  for (const scale of [0, NaN, -1]) assert.deepEqual([...timelineGrid(tempo, 0, 10, 100, scale)], []);
  const ticks = [...timelineGrid(tempo, 0, 1e6, 100, 180, 1, { maxRows: 200 })];
  assert.ok(ticks.length <= 201);
});

test('dense grid uses at most three canvas strokes; overlapping wide bars retain ordered composition', () => {
  const ticks = [...timelineGrid(tempo, 0, 8, 100, 180)], strokes = [], captions = [];
  const context = { beginPath() {}, moveTo() {}, lineTo() {}, stroke() { strokes.push([this.strokeStyle, this.lineWidth]); }, fillText(text) { captions.push(text); } };
  const options = { right: 900, vertical: beat => beat * 90, colors: ['minor-odd', 'minor-even', 'major'], widths: [2, 2, 2] };
  paintTimelineGrid(context, ticks, options);
  assert.ok(ticks.length > 50); assert.ok(strokes.length <= 3); assert.deepEqual(captions, ticks.filter(row => row.label).map(row => String(row.beat)));
  strokes.length = captions.length = 0;
  paintTimelineGrid(context, ticks, { ...options, widths: [12, 12, 12] });
  assert.equal(strokes.length, ticks.length);
  assert.deepEqual(strokes.map(([color]) => color), ticks.map(row => row.major ? 'major' : row.tick % 2 ? 'minor-odd' : 'minor-even'));
});
