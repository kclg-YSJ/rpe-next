import test from 'node:test';
import assert from 'node:assert/strict';
import { SceneRuntime, LineRuntime, ControlCurve } from '../src/core/scene.ts';
import { createChart, createLine, createEvent, createNote } from '../src/core/chart.ts';
import { TempoMap } from '../src/core/tempo.ts';
import { EventTrack } from '../src/core/events.ts';
import type { LineState } from '../src/core/scene.ts';
import type { HitEntry } from '../src/core/hit-effects.ts';

/**
 * `SceneRuntime.sample` reports `undefined` for an index the compiled scene has no line for. Every
 * caller below indexes a line the fixture definitely created, so this narrows it the same way the
 * renderer does at runtime and keeps the arithmetic below on plain numbers.
 */
function stateAt(states: (LineState | undefined)[], index: number): LineState {
  const state = states[index];
  if (!state) throw new Error(`场景缺少线 ${index}`);
  return state;
}

/** The runtime's note list is sparse by type; the fixtures below always populate index 0. */
function noteEntry(entries: readonly HitEntry[], index: number): HitEntry {
  const entry = entries[index];
  if (!entry) throw new Error(`运行时缺少音符 ${index}`);
  return entry;
}

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
  const first = stateAt(scene.sample(0), 0);
  assert.ok(Math.abs(first.x - 100) < 1e-8);
  assert.ok(Math.abs(first.y + 50) < 1e-8);
  assert.equal(first.rotation, 110);
  child.rotateWithFather = false;
  assert.equal(stateAt(scene.sample(0), 0).rotation, 20);
  // `rotateWithFather` is deleted on purpose: the scene treats an absent value as "version 163+
  // defaults to inheriting", so the removal is driven through the line's open-ended index signature.
  const openChild: Record<string, unknown> = child;
  delete openChild.rotateWithFather; chart.META.RPEVersion = 162;
  assert.equal(stateAt(scene.sample(0), 0).rotation, 20);
  parent.father = 0;
  assert.ok(scene.sample(0).every(entry => entry !== undefined && Number.isFinite(entry.x)));
});

test('父线索引兼容数字文本，zOrder 相同时保持谱面顺序', () => {
  const chart = createChart();
  chart.judgeLineList = [createLine('A'), createLine('B'), createLine('C')];
  // A numeric *string* is written on purpose: the scene resolves `father` through `Number()`, so
  // charts that serialise the index as text must still link up. The declared field is a number, so
  // the write goes through the line's open-ended index signature.
  const openLine: Record<string, unknown> = chart.judgeLineList[1];
  openLine.father = '0'; chart.judgeLineList[0].zOrder = 4; chart.judgeLineList[1].zOrder = 2; chart.judgeLineList[2].zOrder = 2;
  const scene = new SceneRuntime(); scene.compile(chart, new TempoMap(chart.BPMList));
  assert.deepEqual(scene.order, [1, 2, 0]);
  assert.equal(stateAt(scene.sample(0), 1).x, stateAt(scene.sample(0), 0).x);
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
  assert.equal(runtime.noteState(noteEntry(runtime.notes, 0), state, 0).y, 200);
  state = runtime.state(0.5);
  const active = runtime.noteState(noteEntry(runtime.notes, 0), state, 0.5);
  assert.equal(active.y, 200);
  assert.equal(active.showHead, false);
  assert.deepEqual(runtime.visibleNotes(0.5, { ...state, alpha: -1 }), []);
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
  assert.equal(runtime.noteState(noteEntry(runtime.notes, 0), state, 0).y, 0);
});
