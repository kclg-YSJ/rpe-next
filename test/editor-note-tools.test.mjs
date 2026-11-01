import test from 'node:test';
import assert from 'node:assert/strict';
import { createChart, createLine, createNote, createEvent, assertChart } from '../src/core/chart.mjs';
import { fromNumber, beatValue } from '../src/core/beat.mjs';
import { TempoMap } from '../src/core/tempo.mjs';
import { SceneRuntime } from '../src/core/scene.mjs';
import { noiseTrackingTarget } from '../src/core/noise-tracking.mjs';
import { trackedNoteEvents, noteTrackingChart } from '../src/application/note-tracking.mjs';
import { quickCurveNotes, quickCurveChart } from '../src/core/quick-curve.mjs';
import { Timeline } from '../src/ui/timeline.mjs';
import { EditorSession } from '../src/application/session.mjs';
import { normalizeEditorPreferences, readEditorPreferences, writeEditorPreferences } from '../src/platform/editor-preferences.mjs';
import { DEFAULT_EDITOR_PREFERENCES } from '../src/core/default-settings.mjs';

const near = (value, expected, tolerance = 1e-7) => assert.ok(Math.abs(value - expected) < tolerance, `${value} != ${expected}`);
test('中键曲线生成 Drag、包含鼠标末端且排除原音符，支持反向时间、同拍密度和缓动', () => {
  const source = { ...createNote(2, 4, -200, 6), above: 0 }, config = { division: 4, density: 2, easingType: 4 };
  const forward = quickCurveNotes(source, fromNumber(6), 200, config);
  assert.equal(forward.length, 16); assert.ok(forward.every(note => note.type === 4 && note.above === 2));
  near(beatValue(forward[0].startTime), 4.125); near(forward[0].positionX, -200 + 400 * (1 - .9375 ** 2));
  assert.deepEqual(forward.at(-1).startTime, [6, 0, 1]); assert.equal(forward.at(-1).positionX, 200);
  const reverse = quickCurveNotes(source, fromNumber(2), 200, config); assert.deepEqual(reverse.at(-1).startTime, [2, 0, 1]); near(beatValue(reverse[0].startTime), 2.125);
  const sameTime = quickCurveNotes(source, fromNumber(4), 200, config); assert.equal(sameTime.length, 3);
  assert.deepEqual(quickCurveNotes(source, fromNumber(4), -200, config), []);
  const chart = createChart(); chart.judgeLineList.push(createLine()); const next = quickCurveChart(chart, 0, forward, 1);
  assert.equal(chart.judgeLineList[0].notes.length, 0); assert.equal(next.judgeLineList[0].notes.length, 15); assert.equal(next.judgeLineList[1].notes.length, 1);
  const session = new EditorSession(chart); session.commit('curve', next); session.travel('undo'); assert.equal(session.chart, chart); session.travel('redo'); assert.equal(session.chart, next);
});

test('横向间距比例不改贴图大小，单/双栏同比例扩宽、低比例聚拢且鼠标反算一致，直接放置独立', () => {
  const canvas = { clientWidth: 900, clientHeight: 600, style: {}, addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 900, height: 600 }) };
  const session = new EditorSession(createChart()), timeline = new Timeline(canvas, canvas, () => session, () => {}, () => {});
  timeline.notesOnlyNoteScale = 1;
  const width = timeline.noteWidth(createNote(1, 0, 0)), reference = timeline.noteHorizontal(135) - timeline.noteHorizontal(0);
  near(reference, (canvas.clientWidth - timeline.noteInset() * 2) / 1350 * 135 * 1.15);
  for (const mode of [false, true]) for (const scale of [.1, .5, 1, 3]) {
    timeline.notesOnly = mode; timeline.noteSpacing = scale;
    near(timeline.noteHorizontal(135) - timeline.noteHorizontal(0), reference * scale); near(timeline.noteWidth(createNote(1, 0, 0)), width);
    near(timeline.notePositionAt(timeline.noteHorizontal(270)), 270);
  }
  timeline.noteView = { pixelsPerUnit: .7, originX: 200, renderScale: 1 }; timeline.noteSpacing = .1;
  near(timeline.noteHorizontal(100), 270); timeline.noteSpacing = 8; near(timeline.noteHorizontal(100), 270);
  assert.equal(DEFAULT_EDITOR_PREFERENCES.noteSpacing, 1); assert.equal(normalizeEditorPreferences({ noteSpacing: .1 }).noteSpacing, .1);
});

test('仅音符视觉缩放默认 0.9，宽高等比变化但坐标、判定时间和其他视图不变，设置可持久化', () => {
  const canvas = { clientWidth: 900, clientHeight: 600, style: {}, addEventListener() {} }, session = new EditorSession(createChart());
  const timeline = new Timeline(canvas, canvas, () => session, () => {}, () => {}), note = createNote(1, 2, 135);
  const width = timeline.noteWidth(note), scale = timeline.renderNoteScale, spacing = timeline.horizontalScale(), inset = timeline.noteInset(), x = timeline.noteHorizontal(135), y = timeline.noteVertical(note);
  timeline.notesOnly = true;
  near(timeline.noteWidth(note), width * .9); near(timeline.renderNoteScale, scale * .9);
  for (const value of [.1, .6, 1, 3]) {
    timeline.notesOnlyNoteScale = value; near(timeline.noteWidth(note), width * value); near(timeline.renderNoteScale, scale * value);
    near(timeline.horizontalScale(), spacing); near(timeline.noteInset(), inset); near(timeline.noteHorizontal(135), x); near(timeline.noteVertical(note), y);
    near(timeline.notePositionAt(x), 135);
  }
  timeline.notesOnly = false; near(timeline.noteWidth(note), width);
  timeline.notesOnly = true; session.setMultiLineEnabled(true, 'notes'); near(timeline.noteWidth(note), width);
  timeline.noteView = { renderScale: .8 }; near(timeline.renderNoteScale, .8);
  const saved = new Map(), storage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) };
  writeEditorPreferences({ notesOnlyNoteScale: .65 }, storage); assert.equal(readEditorPreferences(storage).notesOnlyNoteScale, .65);
  assert.equal(DEFAULT_EDITOR_PREFERENCES.notesOnlyNoteScale, .9); assert.equal(normalizeEditorPreferences({ notesOnlyNoteScale: NaN }).notesOnlyNoteScale, undefined);
  assert.equal(normalizeEditorPreferences({ notesOnlyNoteScale: -1 }).notesOnlyNoteScale, .1); assert.equal(normalizeEditorPreferences({ notesOnlyNoteScale: 20 }).notesOnlyNoteScale, 3);
});

function tracked({ existing = false, rotation = true, hold = false } = {}) {
  const chart = createChart(); chart.META.RPEVersion = 170; chart.BPMList.push({ bpm: 180, startTime: [3, 0, 1] });
  const source = chart.judgeLineList[0]; source.father = 1; source.bpmfactor = .75;
  source.notes = [{ ...createNote(hold ? 2 : 1, 7, 300, 10), above: hold ? 0 : 2, speed: 1.3, yOffset: 25 }];
  source.eventLayers[0].moveXEvents = [createEvent(-80, 240, 0, 10)]; source.eventLayers[0].rotateEvents = [createEvent(10, 120, 0, 10)];
  const parent = createLine(); parent.eventLayers[0].moveYEvents = [createEvent(-100, 200, 0, 10)]; parent.eventLayers[0].rotateEvents = [createEvent(-40, 50, 0, 10)]; chart.judgeLineList.push(parent);
  const destination = createLine(); destination.bpmfactor = 1.8; destination.father = 1; destination.eventLayers.push({ moveXEvents: [createEvent(100, -30, 0, 10)], moveYEvents: [createEvent(20)], rotateEvents: [createEvent(22)] });
  destination.eventLayers[0] = {}; chart.judgeLineList.push(destination);
  const tempo = new TempoMap(chart.BPMList), original = JSON.stringify(chart), generated = trackedNoteEvents(chart, tempo, { start: .5, end: 6, target: { lineIndex: 0, noteIndex: 0 }, lineIndex: existing ? 2 : -1, rotation });
  const next = noteTrackingChart(chart, generated, false, tempo); assert.equal(JSON.stringify(chart), original); assertChart(next);
  const scene = new SceneRuntime(); scene.compile(next, tempo); const expected = noiseTrackingTarget(chart, tempo, { mode: 'note', lineIndex: 0, noteIndex: 0 });
  for (let index = 0; index <= 500; index++) {
    const seconds = tempo.seconds(.5) + (tempo.seconds(6) - tempo.seconds(.5)) * index / 500, a = expected.sample(seconds), b = scene.sampler(seconds)(generated.lineIndex);
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < .25, JSON.stringify({ a, b, seconds })); if (rotation) near(b.rotation, a.rotation, .03);
  }
  return { chart, tempo, generated, next };
}
test('音符追踪拟合世界坐标，补偿父子线、其他事件层、目标 BPM 倍率，Hold 和线下音符一致', () => {
  tracked(); tracked({ existing: true }); tracked({ existing: true, hold: true });
  const without = tracked({ rotation: false }); assert.equal(without.generated.tracks.has('rotateEvents'), false);
});
test('追踪冲突需显式覆盖，前后片段保留且整体修改可撤销重做，不写入特殊谱面结构', () => {
  const { chart, tempo } = tracked(), destination = chart.judgeLineList[2]; destination.eventLayers[0].moveXEvents = [createEvent(50, 90, 0, 10)];
  const generated = trackedNoteEvents(chart, tempo, { start: 2, end: 5, target: { lineIndex: 0, noteIndex: 0 }, lineIndex: 2, rotation: false });
  assert.throws(() => noteTrackingChart(chart, generated, false, tempo), /已有事件/);
  const next = noteTrackingChart(chart, generated, true, tempo), entries = next.judgeLineList[2].eventLayers[0].moveXEvents;
  assert.equal(beatValue(entries[0].startTime), 0); assert.equal(beatValue(entries.at(-1).endTime), 10);
  assert.ok(entries.every(event => !event.trajectory)); assert.deepEqual(next.judgeLineList[2].eventLayers[0].rotateEvents, destination.eventLayers[0].rotateEvents);
  const session = new EditorSession(chart); session.commit('tracking', next); session.travel('undo'); assert.equal(session.chart, chart); session.travel('redo'); assert.equal(session.chart, next);
});
