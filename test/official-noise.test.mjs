import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDocument } from '../src/core/formats.mjs';
import { createChart, parseChart, serializeChart } from '../src/core/chart.mjs';
import { convertOfficialNoiseAreas } from '../src/core/official-noise.mjs';
import { NoiseAreaRuntime } from '../src/core/noise-areas.mjs';
import { TempoMap } from '../src/core/tempo.mjs';
import { openFiles, assetBytes, createChartExport } from '../src/platform/files.mjs';
import { writeZip, readZip } from '../src/platform/archive.mjs';

const near = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const areaSource = (overrides = {}) => ({ bottomLeftPercentage: { x: 0.4, y: 0.4 }, topRightPercentage: { x: 0.6, y: 0.6 },
  appearTime: 1, enableTime: 2, disableTime: 4, disappearTime: 5, isSubtract: false, moveEvents: [], rotateEvents: [], scaleEvents: [], ...overrides });
const sourceChart = areas => ({ formatVersion: 3, offset: 0, judgeLineList: [{ bpm: 120, notesAbove: [], notesBelow: [], speedEvents: [], judgeLineMoveEvents: [], judgeLineRotateEvents: [], judgeLineDisappearEvents: [] }], blockAreaList: areas });
const runtime = source => new NoiseAreaRuntime(convertOfficialNoiseAreas([source], 120)[0], new TempoMap(createChart().BPMList));

test('official noise uses music seconds, global beats and normalized absolute coordinates including offset', () => {
  const source = sourceChart([areaSource({ bottomLeftPercentage: { x: -1, y: -0.2 }, topRightPercentage: { x: 2, y: 1.2 }, isSubtract: true })]);
  source.offset = 0.25; source.judgeLineList.push({ ...source.judgeLineList[0], bpm: 60 });
  const chart = parseDocument(JSON.stringify(source)); const area = chart.blockAreaList[0]; const tempo = new TempoMap(chart.BPMList);
  assert.equal(chart.META.RPEVersion, 220); assert.equal(chart.META.offset, 250); assert.equal(chart.judgeLineList[1].bpmfactor, 2);
  assert.deepEqual(area.bottomLeft, { x: -2025, y: -630 }); assert.deepEqual(area.topRight, { x: 2025, y: 630 }); assert.equal(area.isInvert, true);
  near(tempo.seconds(area.appearTime) + 0.25, 1); near(tempo.seconds(area.disappearTime) + 0.25, 5);
  near(tempo.seconds(area.activeIntervals[0].startTime) + 0.25, 2); assert.equal(area.activeIntervals[0].readyFlash, 0.5);
  const sample = new NoiseAreaRuntime(area, tempo);
  assert.equal(sample.sample(0.74).state, 'hiddenBefore'); assert.equal(sample.sample(0.75).state, 'disabled');
  assert.equal(sample.sample(1.26).state, 'ready'); assert.equal(sample.sample(1.75).state, 'active'); assert.equal(sample.sample(4.75).state, 'hiddenAfter');
  assert.deepEqual(chart.rpeNextLegacySource.document, source);
  assert.equal(chart.noiseAreaOptions.ignoreTripleInversion, true);
});

test('rotation and scale use outgoing anchors; the orbit retains its pivot after translation', () => {
  const orbit = runtime(areaSource({
    moveEvents: [{ time: 1, endPosition: { x: 0.5, y: 0.8 } }],
    rotateEvents: [{ time: 1, rotation: 0, anchor: { x: 0.5, y: 0.7 } }, { time: 3, rotation: 360, anchor: { x: 0.5, y: 0.5 } }],
  }));
  near(orbit.sample(1.5).center.x, 180); near(orbit.sample(1.5).center.y, 450);
  near(orbit.sample(2).center.x, 0); near(orbit.sample(2).center.y, 630);
  near(orbit.sample(2.5).center.x, -180); near(orbit.sample(2.5).center.y, 450);
  near(orbit.sample(3).anchorR.y, 0);
  const scale = runtime(areaSource({ scaleEvents: [
    { time: 1, scale: { x: 1, y: 1 }, anchor: { x: 0.6, y: 0.7 } },
    { time: 3, scale: { x: 3, y: 3 }, anchor: { x: 0.5, y: 0.5 } },
  ] }));
  near(scale.sample(2).center.x, -135); near(scale.sample(2).center.y, -180);
  near(scale.sample(3).center.x, -270); near(scale.sample(3).center.y, -360);
});

test('official first keyframe is a step, later keyframes interpolate and final value persists', () => {
  const sample = runtime(areaSource({ moveEvents: [{ time: 2, endPosition: { x: 0.6, y: 0.6 }, easeTypeX: 1, easeTypeY: 2 }, { time: 4, endPosition: { x: 0.8, y: 0.8 }, easeTypeX: 13, easeTypeY: 13 }] }));
  near(sample.sample(1.5).center.x, 0); near(sample.sample(2).center.x, 135);
  near(sample.sample(3).center.x, 202.5); near(sample.sample(3).center.y, 225);
  near(sample.sample(4).center.x, 405); near(sample.sample(4.5).center.x, 405);
});

function officialEase(progress, type) {
  if (!type) return progress;
  const exponent = Math.floor((type - 1) / 3) + 2; const direction = (type - 1) % 3;
  if (direction === 0) return progress ** exponent;
  if (direction === 1) return 1 - (1 - progress) ** exponent;
  return progress < 0.5 ? (2 * progress) ** exponent / 2 : 1 - (2 - 2 * progress) ** exponent / 2;
}

test('all 13 continuous official easing types map by function, independent X/Y; quint in-out uses two native events', () => {
  for (let type = 0; type <= 12; type++) {
    const sample = runtime(areaSource({ moveEvents: [{ time: 1, endPosition: { x: 0.5, y: 0.5 }, easeTypeX: type, easeTypeY: 0 }, { time: 3, endPosition: { x: 1.5, y: 1.5 }, easeTypeX: 13, easeTypeY: 13 }] }));
    for (const progress of [0, 0.11, 0.25, 0.49, 0.5, 0.76, 0.93, 1]) {
      const state = sample.sample(1 + progress * 2); near(state.center.x, 1350 * officialEase(progress, type)); near(state.center.y, 900 * progress);
    }
    if (type === 12) assert.equal(sample.area.moveXEvents.length, 3);
  }
});

test('Zero holds previous value until endpoint, One steps at segment start, same-time frames preserve incoming and outgoing values', () => {
  for (const ease of [13, 14]) {
    const sample = runtime(areaSource({ moveEvents: [{ time: 1, endPosition: { x: 0.5, y: 0.5 }, easeTypeX: ease, easeTypeY: ease }, { time: 3, endPosition: { x: 1.5, y: 1.5 }, easeTypeX: 0, easeTypeY: 0 }] }));
    near(sample.sample(0.99).center.x, 0); near(sample.sample(2.99).center.x, ease === 13 ? 0 : 1350); near(sample.sample(3).center.x, 1350);
  }
  const sample = runtime(areaSource({ moveEvents: [{ time: 3, endPosition: { x: 0.7, y: 0.5 } }, { time: 1, endPosition: { x: 0.5, y: 0.5 } }, { time: 3, endPosition: { x: 1.5, y: 0.5 } }, { time: 4, endPosition: { x: 2.5, y: 0.5 } }] }));
  near(sample.sample(2).center.x, 135); near(sample.sample(3).center.x, 1350); near(sample.sample(3.5).center.x, 2025);
});

test('same-time rotation steps retain every outgoing pivot and continue into the next interval', () => {
  const source = areaSource({ rotateEvents: [
    { time: 1, rotation: 0, anchor: { x: 0.5, y: 1 } },
    { time: 1, rotation: 90, anchor: { x: 0.5, y: 0.5 } },
    { time: 1, rotation: 180, anchor: { x: 0.5, y: 0.5 } },
    { time: 3, rotation: 270, anchor: { x: 0.5, y: 0.9 } },
  ] });
  const sample = runtime(source);
  near(sample.sample(0.99).center.x, 0); near(sample.sample(0.99).center.y, 0);
  near(sample.sample(1).center.x, -450); near(sample.sample(1).center.y, 450);
  near(sample.sample(2).center.x, -450 * Math.sqrt(2)); near(sample.sample(2).center.y, 0);
  near(sample.sample(3).center.x, -450); near(sample.sample(3).center.y, -450);
  const chart = createChart(); chart.blockAreaList = [sample.area];
  const restored = parseChart(serializeChart(chart));
  const restoredRuntime = new NoiseAreaRuntime(restored.blockAreaList[0], new TempoMap(chart.BPMList));
  near(restoredRuntime.sample(2).center.x, sample.sample(2).center.x);
});

test('same-time independent scale steps preserve pivot order and initial nonunit scale', () => {
  const sample = runtime(areaSource({ scaleEvents: [
    { time: 1, scale: { x: 2, y: 3 }, anchor: { x: 0.6, y: 0.7 } },
    { time: 1, scale: { x: 4, y: 6 }, anchor: { x: 0.5, y: 0.5 } },
    { time: 3, scale: { x: 8, y: 12 }, anchor: { x: 0.8, y: 0.8 } },
  ] }));
  near(sample.sample(1).center.x, -135); near(sample.sample(1).center.y, -180);
  near(sample.sample(2).center.x, -202.5); near(sample.sample(2).center.y, -270);
  near(sample.sample(3).center.x, -270); near(sample.sample(3).center.y, -360);
});

test('an instantaneous rotation at a fractional musical boundary moves the center before absolute movement', () => {
  const seconds = 81.90476;
  const source = areaSource({ appearTime: seconds, enableTime: seconds, disableTime: seconds + 1, disappearTime: seconds + 1,
    rotateEvents: [
      { time: seconds, rotation: 0, easeType: 14, anchor: { x: 0.5, y: 1 } },
      { time: seconds, rotation: 75, anchor: { x: 0.5, y: 0.9 } },
    ],
    moveEvents: [{ time: seconds, endPosition: { x: 0.5, y: 0.3 } }],
  });
  const tempo = new TempoMap([{ bpm: 220.5, startTime: [0, 0, 1] }]);
  const sample = new NoiseAreaRuntime(convertOfficialNoiseAreas([source], 220.5)[0], tempo);
  for (const time of [seconds, tempo.seconds(sample.area.appearTime), seconds + 0.1]) {
    const state = sample.sample(time);
    near(state.center.x, 450 * Math.sin(75 * Math.PI / 180));
    near(state.center.y, 450 * (1 - Math.cos(75 * Math.PI / 180)) - 180);
    assert.equal(state.state, 'active');
  }
});

test('instant transform markers cannot bypass ordinary overlap validation', () => {
  const chart = createChart(); chart.blockAreaList = [runtime(areaSource({ rotateEvents: [
    { time: 1, rotation: 0, anchor: { x: 0.5, y: 1 } },
    { time: 1, rotation: 90, anchor: { x: 0.5, y: 0.5 } },
  ] })).area];
  const first = chart.blockAreaList[0].rotateEvents[0];
  first.endTime = [4, 0, 1];
  assert.throws(() => parseChart(serializeChart(chart)), /transformStep/);
  first.endTime = first.startTime; delete first.transformStep;
  assert.throws(() => parseChart(serializeChart(chart)), /同起点/);
});

test('anchors become absolute, rotation becomes clockwise and transforms retain scale-rotate-move ordering', () => {
  const sample = runtime(areaSource({
    bottomLeftPercentage: { x: 0.5, y: 0.5 }, topRightPercentage: { x: 0.7, y: 0.7 },
    scaleEvents: [{ time: 1, anchor: { x: 0.5, y: 0.5 }, scale: { x: 2, y: 3 } }],
    rotateEvents: [{ time: 1, anchor: { x: 0.5, y: 0.5 }, rotation: 90 }],
    moveEvents: [{ time: 1, endPosition: { x: 0.7, y: 0.5 } }],
  }));
  const state = sample.sample(2); near(state.center.x, 270); near(state.center.y, 0);
  assert.equal(sample.area.rotateEvents[0].start, -90); assert.deepEqual(sample.area.scaleXEvents[0].anchor, { x: 0, y: 0 });
  const before = runtime(areaSource({ appearTime: 3, scaleEvents: [{ time: 0, anchor: { x: 0.5, y: 0.5 }, scale: { x: 1, y: 1 } }, { time: 4, anchor: { x: 0.5, y: 0.5 }, scale: { x: 3, y: -1 }, easeTypeX: 0, easeTypeY: 0 }] }));
  near(before.sample(3).scaleX, 2.5); near(before.sample(3).scaleY, -0.5);
});

test('outgoing easing applies to movement, rotation and independent scale axes', () => {
  const sample = runtime(areaSource({
    rotateEvents: [{ time: 1, rotation: 0, anchor: { x: 0.5, y: 0.5 }, easeType: 1 }, { time: 3, rotation: 100, anchor: { x: 0.5, y: 0.5 }, easeType: 13 }],
    scaleEvents: [{ time: 1, scale: { x: 1, y: 1 }, anchor: { x: 0.5, y: 0.5 }, easeTypeX: 1, easeTypeY: 2 }, { time: 3, scale: { x: 5, y: 5 }, anchor: { x: 0.5, y: 0.5 }, easeTypeX: 13, easeTypeY: 13 }],
  }));
  const state = sample.sample(2); near(state.values.rotateEvents.value, -25); near(state.scaleX, 2); near(state.scaleY, 4);
});

test('a linear falling block edge follows the judge line even when the final keyframe is Zero', () => {
  const bpm = 220.5; const tempo = new TempoMap([{ bpm, startTime: [0, 0, 1] }]);
  const source = areaSource({ bottomLeftPercentage: { x: -1, y: 0 }, topRightPercentage: { x: 2, y: 1 }, appearTime: 65.30612, disappearTime: 68.29932, enableTime: 66.394554, disableTime: 68.29932,
    moveEvents: [{ time: 66.394554, endPosition: { x: 0.5, y: 1.4901161e-9 }, easeTypeX: 0, easeTypeY: 0 }, { time: 68.29932, endPosition: { x: 0.5, y: -0.5 }, easeTypeX: 0, easeTypeY: 13 }] });
  const sample = new NoiseAreaRuntime(convertOfficialNoiseAreas([source], bpm)[0], tempo);
  for (const beat of [244.01, 246, 248, 250]) {
    const top = Math.max(...sample.sample(tempo.seconds(beat)).points.map(point => point.y));
    near(top, -(beat - 244) * 450 / 7, 0.002);
  }
});

test('sub-tick musical timings remain distinct; malformed official noise fails with a field path instead of disappearing', () => {
  const area = convertOfficialNoiseAreas([areaSource({ appearTime: 112.44897, disappearTime: 113, enableTime: 112.448975, disableTime: 113,
    moveEvents: [{ time: 112.448975, endPosition: { x: 0, y: 0.5 } }, { time: 112.44898, endPosition: { x: 1, y: 0.5 } }] })], 220.5)[0];
  const tempo = new TempoMap([{ bpm: 220.5, startTime: [0, 0, 1] }]);
  assert.ok(tempo.seconds(area.moveXEvents[0].startTime) < tempo.seconds(area.moveXEvents[0].endTime));
  near(tempo.seconds(area.appearTime), 112.44897, 1e-9);
  assert.throws(() => convertOfficialNoiseAreas([areaSource({ enableTime: 5 })], 120), /blockAreaList\[0\].*enableTime/);
  assert.throws(() => convertOfficialNoiseAreas([areaSource({ moveEvents: [{ time: 1, endPosition: { x: 0.5, y: 0.5 }, easeTypeX: 99 }] })], 120), /blockAreaList\[0\].moveEvents\[0\]/);
  assert.throws(() => convertOfficialNoiseAreas([areaSource({ rotateEvents: [{ time: 1, rotation: 0 }] })], 120), /anchor.x/);
  assert.throws(() => convertOfficialNoiseAreas([areaSource({ isSubtract: 1 })], 120), /isSubtract/);
});

test('existing ZIP/PEZ import resolves Japanese media, preserves originals and exports editable noise to native JSON/PEZ', async () => {
  const source = sourceChart([areaSource()]); const encoder = new TextEncoder();
  const files = new Map([['官谱/ハテ.json', encoder.encode(JSON.stringify(source))], ['官谱/ハテ.ogg', new Uint8Array([1, 2, 3])], ['官谱/ハテ.png', new Uint8Array([4, 5])]]);
  const archive = writeZip(files); const loaded = await openFiles([new File([archive], '官谱.zip')]);
  assert.equal(loaded.candidates.length, 1); const { chart, name } = loaded.candidates[0];
  assert.equal(chart.META.name, 'ハテ'); assert.deepEqual(assetBytes(loaded.assets, chart.META.song, name), files.get('官谱/ハテ.ogg'));
  assert.deepEqual(assetBytes(loaded.assets, chart.META.background, name), files.get('官谱/ハテ.png'));
  assert.deepEqual(parseChart(serializeChart(chart)).blockAreaList, chart.blockAreaList);
  assert.deepEqual(parseChart(serializeChart(chart)).noiseAreaOptions, chart.noiseAreaOptions);
  const exported = createChartExport(chart, loaded.assets, name, { format: 'pez' });
  const entries = await readZip(await exported.blob.arrayBuffer());
  assert.deepEqual(entries.get('官谱/ハテ.json'), files.get('官谱/ハテ.json'));
  const native = parseChart(new TextDecoder().decode(entries.get('官谱/ハテ.rpe.json'))); assert.deepEqual(native.blockAreaList, chart.blockAreaList);
  assert.deepEqual(native.noiseAreaOptions, chart.noiseAreaOptions);
});
