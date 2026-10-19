import test from 'node:test';
import assert from 'node:assert/strict';
import { CURVE_PRESETS, compileTrajectory, normalizeCurveExpression, sampleCurveTrajectory, presetOptions, validateCurvePreset } from '../src/core/curve-trajectory.ts';
import { createTrajectoryEvent, trajectoryChart, splitTrajectoryChart, expandTrajectory } from '../src/application/trajectory-commands.ts';
import { createChart, createLine, serializeChart } from '../src/core/chart.ts';
import { LineRuntime } from '../src/core/scene.ts';
import { TempoMap } from '../src/core/tempo.ts';
import { legacyChart, createChartExport } from '../src/platform/files.ts';
import { readZip } from '../src/platform/archive.ts';
import { EventTrack } from '../src/core/events.ts';
import { easing } from '../src/core/easing.ts';
import { simplifyTrajectorySamples } from '../src/core/trajectory-simplify.ts';
import type { Chart, ChartEvent, CurveTrajectoryOptions, EventValue } from '../src/core/types.ts';
import type { TrajectoryAxisType } from '../src/application/trajectory-commands.ts';

/** Every `near` call below compares one sampled number against another. */
const near = (actual: number, expected: number, tolerance = 1e-7): void => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

/**
 * One numeric sample from a track.
 *
 * `EventTrack.value` answers the number/colour/text union because the same evaluator serves every
 * track; the events these tests build are numeric, so a non-number would be a real bug and is
 * rejected rather than coerced.
 */
function numericSample(track: EventTrack, seconds: number): number {
  const value: EventValue = track.value(seconds);
  if (typeof value !== 'number') throw new Error('数值轨道返回了非数值');
  return value;
}

/**
 * The `moveXEvents` track of one judge line, read off a document.
 *
 * `EventLayer` is a `Partial<Record<...>>`, so the track itself is optional. Every fixture below has
 * the chart emit one, so the `?? []` fallback is unreachable and the assertions keep their original
 * values. The track is re-read here rather than hoisted because a chart edit replaces the document.
 */
function moveX(chart: Chart, lineIndex: number, layerIndex = 0): ChartEvent[] {
  return chart.judgeLineList[lineIndex].eventLayers[layerIndex].moveXEvents ?? [];
}

/**
 * One axis of an expanded trajectory.
 *
 * `expandTrajectory` always emits `moveXEvents`, and the Y and rotation axes only when the curve
 * carries a rotation. The assertions below only read axes the fixtures define, so a missing track
 * would be a real bug and is rejected rather than compared as `undefined`.
 */
function axis(entries: Map<TrajectoryAxisType, ChartEvent[]>, type: TrajectoryAxisType): ChartEvent[] {
  const events = entries.get(type);
  if (!events) throw new Error(`展开结果缺少 ${type}`);
  return events;
}

// `CURVE_PRESETS` always ships the 圆形 entry (curve-trajectory.ts declares it), so the lookup cannot
// miss; the `!` records the unguarded dereference the original made.
const circle = presetOptions(CURVE_PRESETS.find(preset => preset.id === 'circle')!);
/**
 * Builds the trajectory event every test below drives.
 *
 * `createTrajectoryEvent` merges the bag over `TRAJECTORY_DEFAULTS` through `compileTrajectory`, so a
 * caller may pass only the expressions it cares about — which the calls below do — while the declared
 * parameter is the fully compiled shape that merge produces. The one documented assertion records the
 * partial bag the untyped original passed through unchanged; adding a merge here instead would change
 * the option bag the event stores.
 */
const make = (options: Partial<CurveTrajectoryOptions>): ChartEvent => createTrajectoryEvent(options as CurveTrajectoryOptions, [2, 0, 1], [6, 0, 1], 256);

test('轨迹独立解释参数方程、原版语法和极坐标', () => {
  assert.equal(normalizeCurveExpression('sin(Pi*$t$)+π'), 'sin(pi*t)+pi');
  const evaluate = compileTrajectory({ xExpression: 't', yExpression: 't^2', parameterStart: '2', parameterEnd: '4' });
  near(evaluate(0.5).x, 3); near(evaluate(0.5).y, 9);
  const polar = compileTrajectory({ ...circle, trimStart: 0.25, trimEnd: 0.75 });
  near(polar(0).x, 0); near(polar(0).y, 200); near(polar(1).y, -200);
});

test('截取、整体旋转与实际起点对齐保持几何关系', () => {
  const evaluate = compileTrajectory({ xExpression: '400*t', yExpression: '0', trimStart: 0.25, trimEnd: 0.75, rotation: 90, alignStart: true, startX: 50, startY: -20 });
  near(evaluate(0).x, 50); near(evaluate(0).y, -20);
  near(evaluate(1).x, 50); near(evaluate(1).y, 180);
});

test('所有分类预设可采样且随机曲线可复现', () => {
  assert.equal(new Set(CURVE_PRESETS.map(preset => preset.category)).size, 3);
  for (const preset of CURVE_PRESETS) {
    const options = presetOptions(preset);
    const points = sampleCurveTrajectory(options, 129);
    assert.equal(points.length, 129);
    assert.ok(points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)), preset.id);
    assert.deepEqual(points, sampleCurveTrajectory(options, 129));
  }
  assert.throws(() => validateCurvePreset({ name: 'bad', parameters: [{ key: 't', value: 2 }] }));
  assert.throws(() => compileTrajectory({ xExpression: 'window.alert(1)' }));
});

test('生成的是一个 X 轨迹事件、不生成音符，实时驱动 Y 和角度', () => {
  const event = make({ ...circle, rotationExpression: '90*t' });
  const chart = trajectoryChart(createChart(), 0, 0, event);
  const line = chart.judgeLineList[0];
  assert.equal(line.notes.length, 0);
  assert.equal(moveX(chart, 0).filter(entry => entry.trajectory).length, 1);
  assert.equal(chart.META.RPEVersion, 210);
  const tempo = new TempoMap(chart.BPMList); const runtime = new LineRuntime(line, tempo);
  const state = runtime.state(tempo.seconds([3, 0, 1]));
  near(state.x, 0); near(state.y, 200); near(state.rotation, 22.5);
  const roundtrip = JSON.parse(serializeChart(chart));
  assert.deepEqual(roundtrip.judgeLineList[0].eventLayers[0].moveXEvents.at(-1).trajectory, event.trajectory);
});

test('拉伸一个整体事件同时改变 X/Y 时间且不改变轨迹形状', () => {
  const event = make(circle); const chart = trajectoryChart(createChart(), 0, 0, event);
  const shorter: ChartEvent = { ...event, endTime: [4, 0, 1] };
  const resized = trajectoryChart(chart, 0, 0, shorter, event);
  const tempo = new TempoMap(chart.BPMList);
  const original = new LineRuntime(chart.judgeLineList[0], tempo).state(tempo.seconds([3, 0, 1]));
  const changed = new LineRuntime(resized.judgeLineList[0], tempo).state(tempo.seconds([2, 1, 2]));
  near(original.x, changed.x); near(original.y, changed.y);
});

test('兼容导出与显式拆分按真实秒采样，支持变 BPM 和倍率', () => {
  const source = createChart(); source.BPMList.push({ bpm: 180, startTime: [4, 0, 1] }); source.judgeLineList[0].bpmfactor = 1.5;
  const event = make({ ...circle, rotationExpression: '180*t' });
  const chart = trajectoryChart(source, 0, 0, event);
  const compatible = legacyChart(chart); const split = splitTrajectoryChart(chart, 0, 0, event);
  assert.equal(compatible.META.RPEVersion, 170);
  assert.equal(moveX(compatible, 0).some(entry => entry.trajectory), false);
  assert.ok(event.trajectory);
  const tempo = new TempoMap(chart.BPMList);
  const runtime = new LineRuntime(chart.judgeLineList[0], tempo);
  const exported = new LineRuntime(compatible.judgeLineList[0], tempo);
  const fragments = new LineRuntime(split.judgeLineList[0], tempo);
  const start = tempo.seconds(event.startTime, 1.5); const end = tempo.seconds(event.endTime, 1.5);
  for (let index = 0; index <= 100; index++) {
    const seconds = start + (end - start) * index / 100;
    // The three axes are named as literals so the index below is `LineState`'s own key union; the
    // list is exactly what this test has always compared, so the annotation changes no value.
    for (const key of ['x', 'y', 'rotation'] as const) {
      near(exported.state(seconds)[key], runtime.state(seconds)[key], 0.04);
      near(fragments.state(seconds)[key], exported.state(seconds)[key]);
    }
  }
});

test('编辑目标线变化会迁移整体，重叠须显式允许替换', () => {
  const source = createChart(); source.judgeLineList.push(createLine());
  const event = make(circle); const chart = trajectoryChart(source, 0, 0, event);
  const replacement = make(circle);
  const moved = trajectoryChart(chart, 1, 1, replacement, event);
  assert.equal(moveX(moved, 0).includes(event), false);
  assert.equal(moveX(moved, 1, 1).includes(replacement), true);
  assert.throws(() => trajectoryChart(chart, 0, 0, replacement));
});

test('切线数值角度顺时针为正，经过跨周、旋转及停驻保持有限连续', () => {
  near(compileTrajectory({ xExpression: '0', yExpression: '200*t', tangentRotation: true })(0.5).rotation, -90, 0.01);
  near(compileTrajectory({ xExpression: '200*t', yExpression: '0', rotation: 90, tangentRotation: true })(0.5).rotation, -90, 0.01);
  near(compileTrajectory({ xExpression: '0', yExpression: '0', tangentRotation: true })(0.5).rotation, 0);
  const evaluate = compileTrajectory({ ...circle, angleEnd: '6*pi', tangentRotation: true, rotationExpression: 'invalid_saved_expression' });
  near(evaluate(0).rotation, -90, 0.01);
  near(evaluate(1).rotation, -1170, 0.01);
  for (let index = 1; index <= 1000; index++) assert.ok(Math.abs(evaluate(index / 1000).rotation - evaluate((index - 1) / 1000).rotation) < 2);
  const event = make({ ...circle, tangentRotation: true });
  const chart = trajectoryChart(createChart(), 0, 0, event); const tempo = new TempoMap(chart.BPMList);
  near(new LineRuntime(chart.judgeLineList[0], tempo).state(tempo.seconds([3, 0, 1])).rotation, -180, 0.01);
  assert.ok(expandTrajectory(event, tempo).has('rotateEvents'));
});

test('拟合用 RPE 缓动减少碎事件，并在整个区间遵守每轴容忍度', () => {
  const values = Array.from({ length: 129 }, (unused, index) => 300 * easing(index / 128, 3));
  const pieces = simplifyTrajectorySamples(values, 0.2);
  assert.equal(pieces.length, 1); assert.equal(pieces[0].easingType, 3);
  for (const source of [values, values.map((value, index) => value + 10 * Math.sin(index)), [0, 1, 0, 10, -20, 3, 3, 5]]) {
    const fitted = simplifyTrajectorySamples(source, 0.2);
    assert.ok(fitted.length < source.length);
    for (const piece of fitted) {
      for (let sample = 0; sample <= 1000; sample++) {
        const position = piece.first + (piece.last - piece.first) * sample / 1000;
        const index = Math.min(source.length - 2, Math.floor(position));
        const original = source[index] + (source[index + 1] - source[index]) * (position - index);
        const actual = source[piece.first] + (source[piece.last] - source[piece.first]) * easing(sample / 1000, piece.easingType);
        near(actual, original, 0.200001);
      }
    }
  }
});

test('优化默认开启、可关闭或调整容忍度，拟合保持 BPM 和首尾拍', () => {
  const event = make({ xExpression: '300*t*t', yExpression: '100*sin(3*pi*t)', tangentRotation: true });
  const tempo = new TempoMap([{ bpm: 120, startTime: [0, 0, 1] }, { bpm: 200, startTime: [4, 0, 1] }]);
  const dense = expandTrajectory(event, tempo, 1.5, { simplify: false });
  const fitted = expandTrajectory(event, tempo, 1.5, { tolerance: 0.2 });
  assert.equal(axis(dense, 'moveXEvents').length, 256);
  assert.ok(axis(fitted, 'moveXEvents').length < 10);
  for (const [type, entries] of fitted) {
    assert.deepEqual(entries[0].startTime, event.startTime); assert.deepEqual(entries.at(-1)!.endTime, event.endTime);
    const reference = new EventTrack(axis(dense, type), tempo, 1.5); const track = new EventTrack(entries, tempo, 1.5);
    const start = tempo.seconds(event.startTime, 1.5); const end = tempo.seconds(event.endTime, 1.5);
    for (let sample = 0; sample <= 2000; sample++) { const seconds = start + (end - start) * sample / 2000; near(numericSample(track, seconds), numericSample(reference, seconds), 0.2001); }
  }
  assert.throws(() => expandTrajectory(event, tempo, 1, { tolerance: 0 }));
});

test('统一导出的四种组合保存正确格式，PEZ 保留资源并同步 extra', async () => {
  const source = trajectoryChart(createChart(), 0, 0, make({ ...circle, tangentRotation: true }));
  source.chartTime = 99; source.effects = [{ shader: 'glitch', start: 0, end: 2 }];
  const bytes = new Uint8Array([1, 2, 3]);
  const assets = new Map([['project/chart.json', new TextEncoder().encode('{}')], ['project/music.ogg', bytes], ['project/image.png', bytes]]);
  const original = structuredClone(source);
  // The two lists are named as literals so each loop variable is the union the export options
  // declare; they hold exactly the four combinations the original iterated.
  for (const compatibility of ['next', 'rpe'] as const) for (const format of ['json', 'pez'] as const) {
    const output = createChartExport(source, assets, 'project/chart.json', { compatibility, format, name: '测试', split: { simplify: true, tolerance: 0.1 } });
    assert.equal(output.name, `测试.${format}`);
    let exported: Chart;
    if (format === 'json') exported = JSON.parse(await output.blob.text());
    else {
      const entries = await readZip(await output.blob.arrayBuffer());
      exported = JSON.parse(new TextDecoder().decode(entries.get('project/chart.json')));
      assert.deepEqual(entries.get('project/music.ogg'), bytes); assert.deepEqual(entries.get('project/image.png'), bytes);
      assert.deepEqual(JSON.parse(new TextDecoder().decode(entries.get('project/extra.json'))).effects, source.effects);
    }
    assert.equal(exported.chartTime, undefined);
    assert.equal(exported.META.RPEVersion, compatibility === 'next' ? 210 : 170);
    assert.equal(moveX(exported, 0).some(event => event.trajectory), compatibility === 'next');
  }
  assert.deepEqual(source, original); assert.equal(assets.size, 3);
});
