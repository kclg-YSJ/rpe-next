import test from 'node:test';
import assert from 'node:assert/strict';
import { TempoMap } from '../src/core/tempo.mjs';
import { fromNumber } from '../src/core/beat.mjs';
import { createChart, serializeChart, parseChart, diagnose } from '../src/core/chart.mjs';
import { createNoiseArea, createNoiseEvent, NoiseAreaRuntime, withNoiseAreas, shiftNoiseArea, validateNoiseAreas } from '../src/core/noise-areas.mjs';
import { samplingTarget, noiseSampleHandle, applyNoiseSample, fitNoiseSampleView } from '../src/core/noise-sampling.mjs';
import { previewViewport } from '../src/core/editor-display.mjs';
import { normalizeEditorPreferences } from '../src/platform/editor-preferences.mjs';
import { EditorSession } from '../src/application/session.mjs';
import { createChartExport, legacyChart } from '../src/platform/files.mjs';
import { readZip } from '../src/platform/archive.mjs';
import { TimelineActivity } from '../src/core/timeline-activity.mjs';

const tempo = new TempoMap([{ bpm: 120, startTime: [0, 0, 1] }]);
const interval = (start, end, readyFlash = 0.5) => ({ startTime: fromNumber(start), endTime: fromNumber(end), readyFlash });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} ≠ ${expected}`);

test('sampling view fits distant handles inside the preview and away from controls without zooming in', () => {
  for (const aspect of [1.5, 16 / 9, 9 / 16, 1]) for (const point of [{ x: 15000, y: 10000 }, { x: -10000, y: -20000 }, { x: 0, y: 0 }]) {
    const width = 1050; const height = 650; const viewport = previewViewport(width, height, aspect);
    const divisor = fitNoiseSampleView(point, width, height, aspect, 2.3, 90); const scale = viewport.scale / divisor;
    const horizontal = width / 2 + point.x * scale; const vertical = height / 2 - point.y * scale;
    assert.ok(divisor >= 2.3);
    assert.ok(horizontal >= viewport.left + 23 && horizontal <= viewport.left + viewport.width - 23);
    assert.ok(vertical >= Math.max(viewport.top + 23, 109) && vertical <= Math.min(viewport.top + viewport.height - 23, height - 59));
  }
  assert.equal(fitNoiseSampleView({ x: 0, y: 0 }, 1050, 650, 1.5, 2.3), 2.3);
  assert.equal(fitNoiseSampleView({ x: 15000, y: 10000 }, 0, 0, 1.5, 2.3), 2.3);
});

test('sampling auto-fit setting persists either choice without leaking temporary zoom', () => {
  for (const sampleAutoFit of [true, false]) assert.deepEqual(normalizeEditorPreferences({ sampleAutoFit, viewDivisor: 2.3 }), { viewDivisor: 2.3, sampleAutoFit });
});

test('seamless noise display preference retains both enabled and disabled values', () => {
  for (const seamlessNoiseAreas of [true, false]) assert.deepEqual(normalizeEditorPreferences({ seamlessNoiseAreas }), { seamlessNoiseAreas });
});

test('triple inversion compatibility defaults off and is a validated chart-local option', () => {
  const chart = createChart(); assert.notEqual(chart.noiseAreaOptions?.ignoreTripleInversion, true);
  for (const ignoreTripleInversion of [true, false]) {
    const source = { ...chart, noiseAreaOptions: { ignoreTripleInversion } };
    assert.deepEqual(parseChart(serializeChart(source)).noiseAreaOptions, { ignoreTripleInversion });
  }
  for (const noiseAreaOptions of [null, [], true, { ignoreTripleInversion: 1 }]) assert.throws(() => parseChart(JSON.stringify({ ...chart, noiseAreaOptions })), /noiseAreaOptions/);
});

test('noise lifetime extends chart duration independently of judge line BPM factor; null remains optional', () => {
  const chart = createChart(); chart.judgeLineList[0].bpmfactor = 3;
  chart.blockAreaList = [createNoiseArea(0, 100)]; const activity = new TimelineActivity(); activity.compile(chart, tempo);
  assert.equal(activity.duration, 50);
  chart.blockAreaList = null; assert.doesNotThrow(() => diagnose(parseChart(serializeChart(chart))));
});

test('noise lifetime clips activation without changing original times, with optional ready flash', () => {
  const area = createNoiseArea(2, 12); area.activeIntervals = [interval(-2, 3), interval(5, 7, false), interval(9, 20)];
  const original = structuredClone(area); const runtime = new NoiseAreaRuntime(area, tempo);
  assert.equal(runtime.sample(0.5).state, 'hiddenBefore');
  assert.equal(runtime.sample(1).state, 'active');
  assert.equal(runtime.sample(2.25).state, 'disabled');
  assert.equal(runtime.sample(2.5).state, 'active');
  assert.equal(runtime.sample(4).state, 'ready');
  assert.equal(runtime.sample(6).state, 'hiddenAfter');
  assert.deepEqual(area, original);
});
test('noise preparation uses half a chart second across BPM changes and adjacent activations', () => {
  const map = new TempoMap([{ bpm: 120, startTime: fromNumber(0) }, { bpm: 60, startTime: fromNumber(4) }]);
  const area = createNoiseArea(0, 12); area.activeIntervals = [interval(4.25, 6), interval(6, 7)];
  const runtime = new NoiseAreaRuntime(area, map);
  assert.equal(runtime.sample(1.74).state, 'disabled');
  assert.equal(runtime.sample(1.75).state, 'ready');
  assert.equal(runtime.sample(map.seconds(6)).state, 'active');
});
test('appearance is immediate; preparation alternates full disabled and active styles without fading out', () => {
  const area = createNoiseArea(0, 10); area.activeIntervals = [interval(4, 8)]; const runtime = new NoiseAreaRuntime(area, tempo);
  near(runtime.sample(0).alpha, 0.4); near(runtime.sample(0).activationMix, 0);
  near(runtime.sample(1.5).alpha, 0.667); near(runtime.sample(1.5).activationMix, 1);
  near(runtime.sample(1.5 + 1 / 12).alpha, 0.4); near(runtime.sample(1.5 + 1 / 12).activationMix, 0);
  near(runtime.sample(2).alpha, 0.667);
  area.activeIntervals[0].readyFlash = false; near(new NoiseAreaRuntime(area, tempo).sample(1.5).alpha, 0.4);
});
test('sampled values use four decimals without changing unrelated values or original data', () => {
  const area = createNoiseArea(); area.moveXEvents = [createNoiseEvent(0, 0, 0, 2)];
  const changed = applyNoiseSample(area, tempo, 0, samplingTarget(area, 'moveXEvents', 0, 'start'), { x: 1.23456789, y: 0 });
  assert.equal(changed.moveXEvents[0].start, 1.2346); assert.equal(changed.moveXEvents[0].end, 0); assert.equal(area.moveXEvents[0].start, 0);
});
test('noise is sampled from initial geometry; movement inherits track values', () => {
  const area = createNoiseArea(0, 16); area.bottomLeft = { x: -10, y: -110 }; area.topRight = { x: 10, y: -90 };
  area.rotateEvents = [createNoiseEvent(0, 90, 0, 4, { x: 0, y: 0 })];
  area.moveXEvents = [createNoiseEvent(0, -100, 0, 4)];
  const runtime = new NoiseAreaRuntime(area, tempo);
  near(runtime.sample(2).center.x, -200); near(runtime.sample(2).center.y, 0);
  near(runtime.sample(1).center.x, -120.71067811865476); near(runtime.sample(1).center.y, -70.71067811865476);
  near(runtime.sample(2).values.moveXEvents.value, -100);
  near(runtime.sample(0).center.y, -100);
});
test('independent scales have separate anchors and time, including before-lifetime sampling', () => {
  const area = createNoiseArea(6, 10);
  area.scaleXEvents = [createNoiseEvent(1, 2, 2, 4, { x: 100, y: -50 })];
  area.scaleYEvents = [createNoiseEvent(1, 3, 4, 8, { x: -20, y: 80 })];
  const runtime = new NoiseAreaRuntime(area, tempo);
  assert.equal(runtime.sample(0).scaleX, 1);
  const sample = runtime.sample(3); assert.equal(sample.scaleX, 2); assert.equal(sample.scaleY, 2);
  near(sample.center.x, -100); near(sample.center.y, -80);
  near(runtime.sample(5.1).scaleY, 3);
});
test('zero and negative scales are finite; interval gap retains anchor and endpoint', () => {
  const area = createNoiseArea(); area.scaleXEvents = [createNoiseEvent(0, -2, 0, 1, { x: 75, y: 0 })];
  const runtime = new NoiseAreaRuntime(area, tempo); assert.equal(runtime.sample(0).scaleX, 0);
  near(runtime.sample(1).center.x, 0); assert.equal(runtime.sample(1).scaleX, -2);
});
test('noise validation rejects malformed scalar values, anchors and overlapping tracks', () => {
  const area = createNoiseArea(); area.rotateEvents = [createNoiseEvent(0, 90)];
  assert.throws(() => validateNoiseAreas([area]), /anchor/);
  area.rotateEvents = []; area.activeIntervals = [interval(0, 3), interval(2, 4)]; assert.throws(() => validateNoiseAreas([area]), /重叠/);
  area.activeIntervals = [interval(0, 1), interval(1, 2)]; validateNoiseAreas([area]);
  area.activeIntervals[0].readyFlash = '1'; assert.throws(() => validateNoiseAreas([area]), /秒数/);
  area.activeIntervals = []; area.moveXEvents = [createNoiseEvent(0, 1)]; area.moveXEvents[0].start = null; assert.throws(() => validateNoiseAreas([area]), /有限/);
  area.moveXEvents = [createNoiseEvent(0, 1)]; area.moveXEvents[0].inst = 1; assert.throws(() => validateNoiseAreas([area]), /钩定/);
  assert.throws(() => validateNoiseAreas({}), /数组/);
});
test('lifetime resizing preserves internal data; movement and copy shift all absolute times', () => {
  const area = createNoiseArea(0, 4); area.activeIntervals = [interval(1, 3)]; area.moveXEvents = [createNoiseEvent(0, 100, -2, 8)];
  const session = new EditorSession(withNoiseAreas(createChart(), [area]));
  session.commit('resize', withNoiseAreas(session.chart, [{ ...area, disappearTime: fromNumber(2) }]));
  assert.deepEqual(session.chart.blockAreaList[0].moveXEvents, area.moveXEvents);
  assert.equal(diagnose(session.chart).filter(issue => issue.noiseArea === 0).length, 2);
  session.travel('undo'); assert.equal(session.chart.blockAreaList[0], area);
  session.travel('redo'); assert.deepEqual(session.chart.blockAreaList[0].disappearTime, fromNumber(2));
  const shifted = shiftNoiseArea(area, 10); assert.deepEqual(shifted.moveXEvents[0].startTime, fromNumber(8)); assert.deepEqual(shifted.activeIntervals[0].startTime, fromNumber(11));
});
test('preview drag sampling solves clockwise rotation, scale and movement under other transforms', () => {
  const area = createNoiseArea(); area.rotateEvents = [createNoiseEvent(0, 30, 0, 4, { x: 80, y: 20 })]; area.scaleXEvents = [createNoiseEvent(1, 2, 0, 4, { x: -100, y: 50 })]; area.moveYEvents = [createNoiseEvent(0, 70, 0, 4)];
  for (const [type, change] of [['rotateEvents', 35], ['scaleXEvents', 0.7], ['moveYEvents', 100]]) {
    const target = samplingTarget(area, type, 0, 'end'); const desired = structuredClone(area); desired[type][0].end += change;
    const point = noiseSampleHandle(desired, tempo, 2, target);
    const edited = applyNoiseSample(area, tempo, 2, target, point);
    near(edited[type][0].end, desired[type][0].end);
  }
});
test('corner and global anchor sampling preserve coordinate meaning under rotation', () => {
  const area = createNoiseArea(); area.rotateEvents = [createNoiseEvent(30, 30, 0, 4, { x: 80, y: 20 })];
  const target = samplingTarget(area, undefined, undefined, 'topRight'); const desired = structuredClone(area); desired.topRight.x += 40; desired.topRight.y -= 25;
  const edited = applyNoiseSample(area, tempo, 1, target, noiseSampleHandle(desired, tempo, 1, target)); near(edited.topRight.x, desired.topRight.x); near(edited.topRight.y, desired.topRight.y);
  const anchored = applyNoiseSample(area, tempo, 1, samplingTarget(area, 'rotateEvents', 0, 'anchor'), { x: 13, y: 17 }); assert.deepEqual(anchored.rotateEvents[0].anchor, { x: 13, y: 17 });
});
test('native JSON and PEZ preserve noise; legacy requires explicit removal', async () => {
  const chart = withNoiseAreas(createChart(), [createNoiseArea()]);
  const parsed = parseChart(serializeChart(chart)); assert.equal(parsed.META.RPEVersion, 220); assert.deepEqual(parsed.blockAreaList, chart.blockAreaList);
  const archive = createChartExport(chart, new Map(), 'chart.json', { format: 'pez' });
  const entries = await readZip(await archive.blob.arrayBuffer()); const restored = parseChart(new TextDecoder().decode(entries.get('chart.json'))); assert.deepEqual(restored.blockAreaList, chart.blockAreaList);
  assert.throws(() => legacyChart(chart), /不支持噪域/);
  assert.throws(() => createChartExport(chart, new Map(), 'chart.json', { compatibility: 'rpe' }), /不支持噪域/);
  const legacy = createChartExport(chart, new Map(), 'chart.json', { compatibility: 'rpe', format: 'json', removeNoiseAreas: true });
  assert.equal(JSON.parse(await legacy.blob.text()).blockAreaList, undefined); assert.equal(chart.blockAreaList.length, 1);
});
