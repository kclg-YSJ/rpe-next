import test from 'node:test';
import assert from 'node:assert/strict';
import { SceneRuntime, LineRuntime, ControlCurve } from '../src/core/scene.mjs';
import { createChart, createLine, createEvent, createNote } from '../src/core/chart.mjs';
import { TempoMap } from '../src/core/tempo.mjs';
import { EventTrack } from '../src/core/events.mjs';

test('全场景先求父线，位置继承、旋转开关和版本默认分别计算', () => {
  const chart = createChart();
  const parent = createLine();
  parent.eventLayers[0].moveXEvents = [createEvent(100)];
  parent.eventLayers[0].rotateEvents = [createEvent(90)];
  const child = createLine(); child.father = 1;
  child.eventLayers[0].moveXEvents = [createEvent(50)];
  child.eventLayers[0].rotateEvents = [createEvent(20)];
  chart.judgeLineList = [child, parent];
  const scene = new SceneRuntime(); scene.compile(chart, new TempoMap(chart.BPMList));
  const state = scene.sample(0)[0];
  assert.ok(Math.abs(state.x - 100) < 1e-8);
  assert.ok(Math.abs(state.y + 50) < 1e-8);
  assert.equal(state.rotation, 110);
  child.rotateWithFather = false;
  assert.equal(scene.sample(0)[0].rotation, 20);
  delete child.rotateWithFather; chart.META.RPEVersion = 162;
  assert.equal(scene.sample(0)[0].rotation, 20);
  parent.father = 0;
  assert.ok(scene.sample(0).every(entry => Number.isFinite(entry.x)));
});

test('父线索引兼容数字文本，zOrder 相同时保持谱面顺序', () => {
  const chart = createChart();
  chart.judgeLineList = [createLine('A'), createLine('B'), createLine('C')];
  chart.judgeLineList[1].father = '0'; chart.judgeLineList[0].zOrder = 4; chart.judgeLineList[1].zOrder = 2; chart.judgeLineList[2].zOrder = 2;
  const scene = new SceneRuntime(); scene.compile(chart, new TempoMap(chart.BPMList));
  assert.deepEqual(scene.order, [1, 2, 0]);
  assert.equal(scene.sample(0)[1].x, scene.sample(0)[0].x);
});

test('扩展颜色、文字和数字插值，边界不保留错误的起始文本', () => {
  const tempo = new TempoMap([{ bpm: 120, startTime: [0, 0, 1] }]);
  const color = new EventTrack([createEvent([0, 50, 100], [100, 150, 200], 0, 4)], tempo);
  assert.deepEqual(color.value(1), [50, 100, 150]);
  const text = new EventTrack([createEvent('A', 'ABC', 2, 6)], tempo);
  assert.equal(text.value(0), '');
  assert.equal(text.value(2), 'AB');
  assert.equal(text.value(4), 'ABC');
  const number = new EventTrack([createEvent('0%P%', '100%P%', 0, 4)], tempo);
  assert.equal(number.value(1), '50');
});

test('偏移在速度之前应用，Hold 判定后头部隐藏，负透明度隐藏音符', () => {
  const chart = createChart();
  const line = chart.judgeLineList[0];
  const note = createNote(2, 0, 0, 4); note.yOffset = 100; note.speed = 2;
  line.notes = [note];
  const runtime = new LineRuntime(line, new TempoMap(chart.BPMList));
  let state = runtime.state(0);
  assert.equal(runtime.noteState(runtime.notes[0], state, 0).y, 200);
  state = runtime.state(0.5);
  const active = runtime.noteState(runtime.notes[0], state, 0.5);
  assert.equal(active.y, 200);
  assert.equal(active.showHead, false);
  assert.deepEqual(runtime.visibleNotes(0.5, { ...state, alpha: -1 }), []);
});

test('零时长和零速度 Hold 在判定前保留头尾，判定瞬间隐藏头，零速度不会被遮罩提前剔除', () => {
  for (const speed of [0, 1]) {
    const chart = createChart(), line = chart.judgeLineList[0], tempo = new TempoMap(chart.BPMList);
    line.notes = [{ ...createNote(2, 4, 0, speed === 0 ? 8 : 4), speed }];
    const runtime = new LineRuntime(line, tempo), entry = runtime.notes[0];
    const before = runtime.noteState(entry, runtime.state(1), 1);
    assert.equal(before.showHead, true); assert.equal(before.y, before.tail);
    for (const seconds of speed === 0 ? [2, 3, 4] : [2]) {
      const state = runtime.state(seconds), position = runtime.noteState(entry, state, seconds);
      assert.equal(position.showHead, false); assert.equal(position.y, position.tail);
      assert.equal(runtime.visibleNotes(seconds, state).length, 1);
    }
    const after = entry.end + 0.01; assert.equal(runtime.visibleNotes(after, runtime.state(after)).length, 0);
  }
});

test('大累计流速下带小数 Y 偏移的静止 Hold 首尾严格重合，不因相消误差翻转方向', () => {
  const chart = createChart(), line = chart.judgeLineList[0], tempo = new TempoMap(chart.BPMList);
  line.eventLayers[0].speedEvents = [createEvent(193803.5502958581 / 120, undefined, 0, 2), createEvent(0, 0, 2, 100)];
  line.notes = [];
  for (const above of [1, 0, 2]) for (const speed of [1, 0, -1]) for (let i = -14; i <= 114; i++) {
    line.notes.push({ ...createNote(2, 4, 0, 8), yOffset: i * (225 / 28), speed, above });
  }
  const runtime = new LineRuntime(line, tempo);
  for (const seconds of [1.5, 2, 3.9]) {
    const state = runtime.state(seconds);
    for (const entry of runtime.notes) {
      const position = runtime.noteState(entry, state, seconds);
      assert.equal(position.tail, position.y, `offset=${entry.note.yOffset}, above=${entry.note.above}, speed=${entry.note.speed}`);
      assert.equal(position.showHead, seconds < 2);
    }
  }
});

test('带偏移的极短 Hold 保留实际身体长度，不以固定容差吞掉真实位移', () => {
  const chart = createChart(), line = chart.judgeLineList[0], tempo = new TempoMap(chart.BPMList);
  line.eventLayers[0].speedEvents = [createEvent(193803.5502958581 / 120, undefined, 0, 2), createEvent(1e-9, 1e-9, 2, 100)];
  line.notes = [{ ...createNote(2, 4, 0, 8), yOffset: 225 / 28 }];
  const runtime = new LineRuntime(line, tempo), position = runtime.noteState(runtime.notes[0], runtime.state(2.5), 2.5);
  assert.ok(position.tail > position.y); assert.ok(position.tail - position.y < 1e-6);
});

test('透明度事件按全部事件层求和，负值隐藏全部音符，零值仍保留Tap和Hold', () => {
  const chart = createChart(), line = chart.judgeLineList[0], tempo = new TempoMap(chart.BPMList);
  line.notes = [createNote(1, 1, 0), createNote(2, 1, 100, 4)];
  line.eventLayers[0].alphaEvents = [createEvent(100)];
  for (const [value, expected] of [[-101, 0], [-100, 2], [-99, 2], [-500, 0]]) {
    line.eventLayers[1] = { alphaEvents: [createEvent(value)] };
    const runtime = new LineRuntime(line, tempo), state = runtime.state(0);
    assert.equal(state.alpha, 100 + value); assert.equal(runtime.visibleNotes(0, state).length, expected);
  }
});

test('控制曲线采用右端点缓动，Y 控制为零时不漏掉远距离音符', () => {
  const curve = new ControlCurve([{ x: 0, alpha: 0, easing: 1 }, { x: 100, alpha: 1, easing: 1 }], 'alpha');
  assert.equal(curve.value(50), 0.5);
  const chart = createChart();
  const line = chart.judgeLineList[0];
  line.yControl = [{ x: 0, y: 0, easing: 1 }, { x: 999999, y: 0, easing: 1 }];
  line.notes = [createNote(1, 100, 0)];
  const runtime = new LineRuntime(line, new TempoMap(chart.BPMList));
  const state = runtime.state(0);
  assert.equal(runtime.visibleNotes(0, state).length, 1);
  assert.equal(runtime.noteState(runtime.notes[0], state, 0).y, 0);
});

test('零速度音符按出现与结束时刻查询，前后跳转和边界与逐项筛选一致，不反复扫描全谱', () => {
  const chart = createChart(), line = chart.judgeLineList[0], tempo = new TempoMap(chart.BPMList); let reads = 0;
  line.notes = Array.from({ length: 40000 }, (_, i) => ({ ...createNote(2, i * 2, 0, i * 2 + 1), speed: 0, get visibleTime() { reads++; return .2; } }));
  const runtime = new LineRuntime(line, tempo); reads = 0;
  for (const seconds of [0, .49, .5, .501, 12345, 20000, 1, 0, 39999.5, 40001]) {
    const found = runtime.visibleNotes(seconds, runtime.state(seconds));
    const expected = runtime.notes.filter(entry => entry.end >= seconds && entry.start - seconds <= .2);
    assert.deepEqual(found.map(entry => entry.index), expected.map(entry => entry.index));
  }
  assert.ok(reads < 20, `read ${reads} visibleTime fields`);
  line.notes = [4, 0, 2].map(beat => ({ ...createNote(2, beat, 0, 10), speed: 0, visibleTime: .2 }));
  const unsorted = new LineRuntime(line, tempo);
  assert.deepEqual(unsorted.visibleNotes(3, unsorted.state(3)).map(entry => entry.index), [0, 1, 2]);
});
