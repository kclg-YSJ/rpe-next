import test from 'node:test';
import assert from 'node:assert/strict';
import { createChart, createLine, createEvent, createNote, assertChart, serializeChart, parseChart } from '../src/core/chart.ts';
import { fromNumber, beatValue } from '../src/core/beat.ts';
import { TempoMap } from '../src/core/tempo.ts';
import { trackedNoiseArea, noiseTrackingTarget, noiseTrackingChart } from '../src/core/noise-tracking.mjs';
import { noiseRuntime } from '../src/core/noise-areas.ts';
import { EditorSession } from '../src/application/session.ts';
import { Preview } from '../src/ui/preview.ts';
import { NoiseTrackingPanel } from '../src/ui/noise-tracking.mjs';

const options = { start: 0, end: 8, width: 320, height: 80, active: true, target: { mode: 'line', lineIndex: 0 } };
function matches(chart, config = options) {
  const tempo = new TempoMap(chart.BPMList); const area = trackedNoiseArea(chart, tempo, config);
  assertChart(noiseTrackingChart(chart, area));
  const source = noiseTrackingTarget(chart, tempo, config.target); const runtime = noiseRuntime(area, tempo);
  const start = tempo.seconds(Array.isArray(config.start) ? beatValue(config.start) : config.start);
  const end = tempo.seconds(Array.isArray(config.end) ? beatValue(config.end) : config.end);
  for (let step = 0; step <= 800; step++) {
    const seconds = start + (end - start) * step / 800; const expected = source.sample(seconds); const actual = runtime.sample(seconds);
    assert.ok(Math.hypot(actual.center.x - expected.x, actual.center.y - expected.y) < 0.3, `position mismatch at ${seconds}: ${JSON.stringify({ actual: actual.center, expected })}`);
    assert.ok(Math.abs(actual.rotation * 180 / Math.PI - expected.rotation) < 0.03, `angle mismatch at ${seconds}`);
  }
  return area;
}

test('追踪世界坐标、父线和多层事件，矩形以原点居中且旋转锚点为原点', () => {
  const chart = createChart(); const parent = createLine(); const child = chart.judgeLineList[0];
  parent.eventLayers[0].moveXEvents = [createEvent(50, -80, 0, 8)];
  parent.eventLayers[0].moveYEvents = [createEvent(-60, 150, 0, 8)];
  parent.eventLayers[0].rotateEvents = [createEvent(15, 400, 0, 8)];
  child.father = 1; child.eventLayers[0].moveXEvents = [createEvent(200, -140, 0, 8)];
  child.eventLayers[0].moveYEvents = [createEvent(-20, 90, 0, 8)];
  child.eventLayers[0].rotateEvents = [createEvent(10, 60, 0, 8)];
  child.eventLayers.push({ moveXEvents: [createEvent(20, 40, 0, 8)] }); chart.judgeLineList.push(parent);
  const before = serializeChart(chart); const area = matches(chart);
  assert.deepEqual(area.bottomLeft, { x: -160, y: -40 }); assert.deepEqual(area.topRight, { x: 160, y: 40 });
  assert.ok(area.rotateEvents.every(event => event.anchor.x === 0 && event.anchor.y === 0));
  assert.equal(serializeChart(chart), before);
});

test('线性运动合并为少量事件，跟随 BPM 变化和目标线倍率', () => {
  const chart = createChart(); chart.BPMList.push({ startTime: fromNumber(2), bpm: 180 });
  chart.judgeLineList[0].bpmfactor = 1.5;
  chart.judgeLineList[0].eventLayers[0].moveXEvents = [createEvent(-50, 320, 0, 8)];
  const area = matches(chart); assert.ok(area.moveXEvents.length <= 6);
});

test('跳变和缓动边界不被连成斜线，瞬移与连续多周旋转保持数值', () => {
  const chart = createChart(); const layer = chart.judgeLineList[0].eventLayers[0];
  layer.moveXEvents = [createEvent(-200, -200, 0, 3), createEvent(300, -100, 3, 8)];
  layer.moveYEvents = [{ ...createEvent(-100, 200, 0, 8), easingType: 5 }];
  layer.rotateEvents = [createEvent(360, 1080, 0, 8)];
  const area = matches(chart); const tempo = new TempoMap(chart.BPMList); const runtime = noiseRuntime(area, tempo);
  assert.ok(Math.abs(runtime.sample(tempo.seconds(3) - 0.0001).center.x + 200) < 0.001);
  assert.ok(Math.abs(runtime.sample(tempo.seconds(3)).center.x - 300) < 0.001);
});

test('音符跟随位置包含正反面、控制曲线、倾斜、速度和 Hold 头部', () => {
  for (const type of [1, 2, 3, 4]) for (const above of [0, 1]) {
    const chart = createChart(); const line = chart.judgeLineList[0];
    line.eventLayers[0].rotateEvents = [createEvent(20, 70, 0, 8)];
    line.extended.inclineEvents = [createEvent(15, 15, 0, 8)];
    line.posControl = [{ x: -1000, pos: 0.8 }, { x: 1000, pos: 1.2, easing: 1 }];
    line.yControl = [{ x: -1000, y: 0.8 }, { x: 1000, y: 1.2, easing: 1 }];
    line.notes = [{ ...createNote(type, 3, 100, 7), above, yOffset: 70, speed: 0.7 }];
    matches(chart, { ...options, target: { mode: 'note', lineIndex: 0, noteIndex: 0 } });
  }
});

test('生成保留拍数、层与状态，持久化后仍是普通噪域，撤销重做不影响目标', () => {
  const session = new EditorSession(); const tempo = new TempoMap(session.chart.BPMList); const before = session.chart;
  const area = trackedNoiseArea(before, tempo, { ...options, start: [1, 1, 7], end: [5, 2, 7], invert: true, active: false });
  assert.deepEqual(area.appearTime, [1, 1, 7]); assert.deepEqual(area.disappearTime, [5, 2, 7]); assert.equal(area.isInvert, true);
  assert.deepEqual(area.activeIntervals, []); assert.ok(!Object.hasOwn(area, 'tracking'));
  const next = noiseTrackingChart(before, area); assertChart(next); assertChart(parseChart(serializeChart(next)));
  session.commit('噪域追踪', next); assert.equal(session.chart.blockAreaList.length, 1);
  session.travel('undo'); assert.equal(session.chart.blockAreaList.length, 0);
  session.travel('redo'); assert.equal(session.chart.blockAreaList.length, 1);
  assert.equal(session.chart.judgeLineList, before.judgeLineList);
});

test('拒绝空目标、过长区间和无效参数', () => {
  const chart = createChart(); const tempo = new TempoMap(chart.BPMList);
  for (const change of [{ end: 0 }, { width: 0 }, { height: NaN }, { target: { mode: 'line', lineIndex: 7 } }, { target: { mode: 'note', lineIndex: 0, noteIndex: 0 } }, { end: 10000 }, { layerId: 'removed' }]) {
    assert.throws(() => trackedNoiseArea(chart, tempo, { ...options, ...change }));
  }
});

test('音符取样返回具体编号，Hold 身体可选且不会在预览外命中', () => {
  const preview = new Preview({ getBoundingClientRect: () => ({ left: 20, top: 10 }) });
  preview.visible = true; preview.viewport = { left: 0, top: 0, width: 600, height: 400 };
  preview.noteHitAreas = [{ lineIndex: 2, noteIndex: 4, x1: 100, y1: 50, x2: 100, y2: 350, radius: 12 }];
  assert.deepEqual(preview.pickNoteTarget(120, 210), { lineIndex: 2, noteIndex: 4 }); assert.equal(preview.pickNote(120, 210), 2);
  assert.equal(preview.pickNoteTarget(160, 210), null); assert.equal(preview.pickNoteTarget(120, 500), null);
});

test('追踪预览滚轮使用原调时逻辑并同步显示时间，可滚出噪域生命周期', () => {
  const panel = Object.create(NoiseTrackingPanel.prototype); let seconds = 2; let calls = 0;
  const event = { deltaY: -100, altKey: true }; panel.animating = true; panel.animationEpoch = 1; panel.playButton = {};
  panel.getContext = () => ({ wheel: value => { assert.equal(value, event); calls++; seconds += 5; }, seconds: () => seconds }); panel.invalidate = () => {};
  panel.range = { start: 0, end: 4 }; panel.wheel(event);
  assert.equal(calls, 1); assert.equal(panel.previewSeconds, 7); assert.equal(panel.animating, false);
  assert.equal(panel.animationEpoch, null); assert.equal(panel.playButton.textContent, '▶ 演示追踪');
});
