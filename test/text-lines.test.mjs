import test from 'node:test';
import assert from 'node:assert/strict';
import { rectanglePixels, fitTextMask, textSkeleton } from '../src/core/text-fit.mjs';
import { createChart, createLine, createEvent } from '../src/core/chart.mjs';
import { textLinesChart } from '../src/application/text-lines.mjs';
import { TempoMap } from '../src/core/tempo.mjs';
import { SceneRuntime } from '../src/core/scene.mjs';
import { EditorSession } from '../src/application/session.mjs';

function maskFixture(angles = [0, Math.PI / 4]) {
  const width = 90; const height = 60; const mask = new Uint8Array(width * height);
  angles.forEach((angle, index) => { for (const pixel of rectanglePixels(width, height, 20.5 + index * 40, 30.5, 17, 5, angle)) mask[pixel] = 1; });
  return { mask, width, height, length: 17, thickness: 5, limit: 8, tolerance: 0.3 };
}
const sample = (chart, beat) => { const tempo = new TempoMap(chart.BPMList); const scene = new SceneRuntime(); scene.compile(chart, tempo); return scene.sample(tempo.seconds(beat)); };
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);
const options = { strokes: [{ x: 80, y: -120, angle: Math.PI / 4 }], indices: [0], beat: 4, size: 0.4 };

test('text fit covers rotated rectangles and stops before using the upper bound', () => {
  const fixture = maskFixture(); const original = fixture.mask.slice(); const result = fitTextMask(fixture);
  assert.equal(result.passed, true); assert.equal(result.strokes.length, 2); assert.ok(result.error <= fixture.tolerance); assert.deepEqual(fixture.mask, original);
  assert.equal(result.skeletonCoverage, 1);
  assert.equal(result.covered.reduce((sum, value) => sum + value, 0), result.target - result.missing + result.excess);
});
test('text fit reports both missing and excess ink, rejects insufficient lines and invalid input', () => {
  const result = fitTextMask({ ...maskFixture(), limit: 1 }); assert.equal(result.passed, false); assert.ok(result.missing > 0);
  const wide = fitTextMask({ ...maskFixture([0]), thickness: 9, tolerance: 0 }); assert.equal(wide.passed, false); assert.ok(wide.excess > 0);
  near(wide.error, 1 - (wide.target - wide.missing) / (wide.target + wide.excess));
  assert.throws(() => fitTextMask({ ...maskFixture(), length: Infinity }));
  assert.throws(() => fitTextMask({ ...maskFixture(), length: 100000 }));
  assert.throws(() => fitTextMask({ ...maskFixture(), mask: new Uint8Array(5400) }), /可见/);
});
test('stroke weight does not create parallel Drag rows, and axial/diagonal strokes stay aligned', () => {
  for (const angle of [0, Math.PI / 4, Math.PI / 2, Math.PI * 3 / 4]) {
    const fits = [3, 7, 15].map(weight => {
      const mask = new Uint8Array(100 * 100);
      for (const index of rectanglePixels(100, 100, 50.5, 50.5, 60, weight, angle)) mask[index] = 1;
      return fitTextMask({ mask, width: 100, height: 100, length: 20, thickness: 5, limit: 20, tolerance: 0.3 });
    });
    for (const fit of fits) {
      assert.equal(fit.passed, true); assert.ok(fit.strokes.length <= 4); assert.ok(fit.strokes.every(stroke => stroke.angle === angle));
      assert.ok(fit.strokes.every(stroke => Math.abs(-(stroke.x - 50.5) * Math.sin(angle) + (stroke.y - 50.5) * Math.cos(angle)) < 1));
    }
    assert.deepEqual(fits[0].strokes, fits[2].strokes);
  }
});
test('non-special angles remain available for genuine slanted strokes', () => {
  const mask = new Uint8Array(100 * 100);
  for (const index of rectanglePixels(100, 100, 50.5, 50.5, 60, 5, Math.PI / 8)) mask[index] = 1;
  const fit = fitTextMask({ mask, width: 100, height: 100, length: 20, thickness: 5, limit: 20, tolerance: 0.3 });
  assert.equal(fit.passed, true); assert.ok(fit.strokes.filter(stroke => stroke.angle === Math.PI / 8).length >= fit.strokes.length / 2);
});
test('thinning preserves a closed counter and isolated small components cannot be silently omitted', () => {
  const width = 100; const height = 100; const ring = new Uint8Array(width * height);
  for (let row = 20; row <= 80; row++) for (let column = 20; column <= 80; column++) if (row < 32 || row > 68 || column < 32 || column > 68) ring[row * width + column] = 1;
  const skeleton = textSkeleton(ring, width, height); const visited = new Set([5050]); const queue = [5050];
  for (let cursor = 0; cursor < queue.length; cursor++) for (const neighbor of [queue[cursor] - 1, queue[cursor] + 1, queue[cursor] - width, queue[cursor] + width]) {
    if (neighbor < 0 || neighbor >= skeleton.length || skeleton[neighbor] || visited.has(neighbor)) continue;
    visited.add(neighbor); queue.push(neighbor);
  }
  assert.equal(visited.has(0), false);
  const fixture = maskFixture([0]); fixture.mask[10 * fixture.width + 80] = 1;
  const fit = fitTextMask({ ...fixture, limit: 1, tolerance: 0.9 });
  assert.equal(fit.passed, false); assert.equal(fit.skeletonCoverage, 0);
});
test('coverage threshold is independently adjustable, including zero and full coverage', () => {
  const fixture = maskFixture([0]); fixture.mask[10 * fixture.width + 80] = 1;
  const settings = { ...fixture, limit: 1, tolerance: 0.9 };
  const strict = fitTextMask(settings); const relaxed = fitTextMask({ ...settings, requiredCoverage: 0 });
  assert.equal(strict.requiredCoverage, 0.95); assert.equal(strict.passed, false);
  assert.equal(relaxed.requiredCoverage, 0); assert.equal(relaxed.passed, true); assert.equal(relaxed.skeletonCoverage, 0);
  const full = fitTextMask({ ...maskFixture(), requiredCoverage: 1 });
  assert.equal(full.passed, true); assert.equal(full.skeletonCoverage, 1); assert.equal(full.requiredCoverage, 1);
  for (const requiredCoverage of [NaN, Infinity, -0.1, 1.01]) assert.throws(() => fitTextMask({ ...settings, requiredCoverage }), /覆盖度/);
});
test('text generation writes target pose, leaves earlier and future poses and source untouched', () => {
  const chart = createChart(); chart.judgeLineList.push(createLine());
  chart.judgeLineList[0].eventLayers[0].moveXEvents.push(createEvent(400, 600, 8, 10));
  const original = structuredClone(chart); const next = textLinesChart(chart, options);
  assert.deepEqual(chart, original); assert.equal(next.judgeLineList[1], chart.judgeLineList[1]);
  const pose = sample(next, 4)[0]; near(pose.x, 80); near(pose.y, -120); near(pose.rotation, 45);
  assert.deepEqual(sample(next, 3), sample(chart, 3)); near(sample(next, 9)[0].x, 500);
  assert.deepEqual(next.judgeLineList[0].notes, []);
});
test('text generation compensates selected parents, intermediate ancestors, layers and bpmfactor', () => {
  const chart = createChart(); chart.judgeLineList = Array.from({ length: 4 }, () => createLine());
  chart.judgeLineList[1].father = 0; chart.judgeLineList[2].father = 1; chart.judgeLineList[3].father = 0; chart.judgeLineList[3].rotateWithFather = false;
  chart.judgeLineList[1].eventLayers[0].moveXEvents = [createEvent(35)];
  chart.judgeLineList[2].bpmfactor = 2;
  chart.judgeLineList[2].eventLayers.push({ moveXEvents: [createEvent(17)], moveYEvents: [createEvent(-9)], rotateEvents: [createEvent(12)] });
  const strokes = [{ x: -20, y: 30, angle: 1.2 }, { x: 70, y: 20, angle: 0.2 }, { x: 0, y: -100, angle: -0.8 }];
  const next = textLinesChart(chart, { ...options, strokes, indices: [0, 2, 3], addNotes: true });
  const poses = sample(next, 4);
  [0, 2, 3].forEach((index, entry) => { near(poses[index].x, strokes[entry].x); near(poses[index].y, strokes[entry].y); near(poses[index].rotation, strokes[entry].angle * 180 / Math.PI); });
  assert.equal(next.judgeLineList[1], chart.judgeLineList[1]);
  const note = next.judgeLineList[2].notes[0]; assert.equal(note.type, 4); assert.equal(note.speed, 0); assert.equal(note.isFake, 1);
  near(new TempoMap(chart.BPMList).seconds(note.startTime, 2), 3);
});
test('text generation handles empty tracks, empty-string parent and one atomic undo', () => {
  const chart = createChart(); chart.judgeLineList[0].father = ''; chart.judgeLineList[0].eventLayers = [];
  const session = new EditorSession(chart); const next = textLinesChart(chart, { ...options, addNotes: true });
  assert.deepEqual(sample(next, -1), sample(chart, -1));
  session.commit('文字拼合', next); assert.equal(session.chart, next); session.travel('undo'); assert.equal(session.chart, chart); session.travel('redo'); assert.equal(session.chart, next);
});
test('text note types are shared by preview and generated helpers without changing existing notes', () => {
  const chart = createChart();
  for (const noteType of [4, 1, 3]) {
    for (const flags of [{ preview: true }, { addNotes: true }]) {
      const result = textLinesChart(chart, { ...options, noteType, ...flags });
      const note = result.judgeLineList[0].notes[0];
      assert.equal(note.type, noteType); assert.equal(note.speed, 0); assert.equal(note.isFake, 1); assert.equal(note.size, options.size);
    }
    assert.deepEqual(textLinesChart(chart, { ...options, noteType }).judgeLineList[0].notes, []);
  }
  assert.deepEqual(chart.judgeLineList[0].notes, []);
  for (const noteType of [2, 0, '1', NaN]) assert.throws(() => textLinesChart(chart, { ...options, noteType }), /类型/);
});
test('replacement splits an overlapping eased prefix without changing its previous animation', () => {
  const chart = createChart(); chart.judgeLineList[0].eventLayers[0].moveXEvents = [{ ...createEvent(0, 100, 0, 8), easingType: 5 }];
  assert.throws(() => textLinesChart(chart, options), /替换/);
  const next = textLinesChart(chart, { ...options, replace: true });
  for (const beat of [0, 1, 2, 3.9]) near(sample(next, beat)[0].x, sample(chart, beat)[0].x);
  near(sample(next, 4)[0].x, 80);
  chart.judgeLineList[0].eventLayers[0].moveXEvents[0].bezier = 1;
  assert.throws(() => textLinesChart(chart, { ...options, replace: true }), /Bezier/);
});
test('invalid target and parent structures fail without changing the chart', () => {
  const chart = createChart(); const original = structuredClone(chart);
  assert.throws(() => textLinesChart(chart, { ...options, strokes: [{ x: NaN, y: 1, angle: 0 }] }), /坐标/);
  assert.throws(() => textLinesChart(chart, { ...options, indices: [7] }), /范围/);
  assert.deepEqual(chart, original);
  chart.judgeLineList[0].father = 0; assert.throws(() => textLinesChart(chart, options), /父线/);
  chart.judgeLineList[0].father = -1; chart.judgeLineList[0].attachUI = 'score'; assert.throws(() => textLinesChart(chart, options), /UI/);
});

test('fractional beats and BPM factors never round a step later than its requested instant', () => {
  const chart = createChart(); chart.BPMList.push({ bpm: 167, startTime: [6, 0, 1] });
  const beat = 9 + 1 / 7; const beatTime = [9, 1, 7];
  const exact = textLinesChart(chart, { ...options, beat, beatTime });
  assert.deepEqual(exact.judgeLineList[0].eventLayers[0].moveXEvents.at(-1).startTime, beatTime);
  for (const factor of [1, 1.3, 0.6, 2.345]) {
    chart.judgeLineList[0].bpmfactor = factor;
    const next = textLinesChart(chart, { ...options, beat, beatTime });
    near(sample(next, beat)[0].x, 80); near(sample(next, beat)[0].y, -120);
    assert.deepEqual(sample(next, beat - 0.001), sample(chart, beat - 0.001));
  }
});
