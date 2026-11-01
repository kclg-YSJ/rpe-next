import test from 'node:test';
import assert from 'node:assert/strict';
import { PlacementFlow, placementFlowView, clipPlacementConnection } from '../src/core/placement-flow.mjs';
import { directPlacementPlane } from '../src/core/direct-placement.mjs';
import { createChart, createEvent, createNote } from '../src/core/chart.mjs';
import { SceneRuntime } from '../src/core/scene.mjs';
import { TempoMap } from '../src/core/tempo.mjs';
import { Timeline } from '../src/ui/timeline.mjs';
import { EditorSession } from '../src/application/session.mjs';
import { beatValue } from '../src/core/beat.mjs';
import { previewPositionScale, previewNotePosition } from '../src/core/editor-display.mjs';
import { DirectPlacement } from '../src/ui/direct-placement.mjs';

const near = (value, expected, tolerance = 1e-6) => assert.ok(Math.abs(value - expected) < tolerance, `${value} != ${expected}`);
function fixture() {
  const chart = createChart(), line = chart.judgeLineList[0]; line.bpmfactor = 2;
  chart.BPMList.push({ bpm: 180, startTime: [8, 0, 1] });
  line.eventLayers[0].speedEvents = [createEvent(2, 2, 0, 2), createEvent(2, 8, 2, 6), createEvent(8, 8, 6, 20)];
  const tempo = new TempoMap(chart.BPMList), scene = new SceneRuntime(); scene.compile(chart, tempo);
  const runtime = scene.lines[0]; return { chart, line, tempo, scene, runtime, flow: new PlacementFlow(runtime, tempo) };
}

test('放置流速与判定线的速度积分逐点一致，跨 BPM、倍率、多事件层及缓动，正反转换准确', () => {
  const { chart, tempo, runtime, flow } = fixture();
  for (const seconds of [-2, 0, .1, 1.2, 2, 3.5, 6, 7, 9, 12]) { near(flow.distance(seconds), runtime.floor(seconds)); near(flow.seconds(flow.distance(seconds)), seconds); }
  const line = chart.judgeLineList[0]; line.eventLayers[0].speedEvents[1].easingType = 4;
  line.eventLayers.push({ speedEvents: [createEvent(1, 1, 0, 20)] });
  const scene = new SceneRuntime(); scene.compile(chart, tempo); const eased = new PlacementFlow(scene.lines[0], tempo);
  for (let seconds = 0; seconds < 12; seconds += .17) { near(eased.distance(seconds), scene.lines[0].floor(seconds)); near(eased.seconds(eased.distance(seconds)), seconds); }
});

test('零速和负流速仍可逆且不会使两个编辑区域越过判定线，反向段有明确的位置差异', () => {
  const { chart, line, tempo } = fixture();
  line.eventLayers[0].speedEvents = [createEvent(0, 0, 0, 2), createEvent(-2, 2, 2, 6), createEvent(2, 2, 6, 20)];
  const scene = new SceneRuntime(); scene.compile(chart, tempo); const flow = new PlacementFlow(scene.lines[0], tempo);
  let previous = -Infinity;
  for (let seconds = -1; seconds < 10; seconds += .13) { const distance = flow.distance(seconds); assert.ok(distance > previous); near(flow.seconds(distance), seconds); previous = distance; }
  const view = placementFlowView(flow, 4, { baseline: 300, height: 600 }, .5);
  for (const beat of [0, 2, 4, 8, 12]) { assert.ok(view.vertical(beat, 1) <= 300); assert.ok(view.vertical(beat, -1) >= 300); }
});

test('弹跳、弹性和圆形缓动的数值积分回折不导致鼠标反算跳到相邻时刻', () => {
  for (const easingType of [19, 22, 25, 27, 28]) for (const [start, end] of [[0, 10], [5, 1], [-2, 5]]) {
    const chart = createChart(); chart.judgeLineList[0].eventLayers[0].speedEvents = [{ ...createEvent(start, end, 0, 4), easingType }];
    const tempo = new TempoMap(chart.BPMList), scene = new SceneRuntime(); scene.compile(chart, tempo); const flow = new PlacementFlow(scene.lines[0], tempo);
    let previous = -Infinity;
    for (let index = 0; index <= 300; index++) {
      const seconds = -.1 + index / 300 * 2.2, distance = flow.distance(seconds);
      assert.ok(distance > previous); near(flow.seconds(distance), seconds, .0001); previous = distance;
    }
  }
});

test('上下双区音符和正常预览位置一致，包含旋转、父线的比例规则和 Hold，时间反算不偏移', () => {
  const { line, tempo, runtime, flow } = fixture(), now = tempo.seconds(2, line.bpmfactor);
  for (const ratio of [1.5, 16 / 9, 4 / 3]) for (const parent of [-1, 1]) for (const angle of [0, 37, 90]) {
    line.father = parent;
    const local = previewNotePosition({ x: 1, y: 1, tail: 1 }, line, previewPositionScale(ratio)), scale = .4;
    const plane = directPlacementPlane({ x: 500, y: 300, rotation: angle }, { left: 0, top: 0, width: 1000, height: 600 }, scale * local.x);
    const view = placementFlowView(flow, now, plane, scale * local.y);
    for (const side of [1, -1]) for (const type of [1, 2]) {
      const note = { ...createNote(type, 2.25, 135, 2.5), above: side === 1 ? 1 : 0 }, entry = runtime.noteEntry(note, 0, tempo), state = runtime.state(now);
      const position = previewNotePosition(runtime.noteState(entry, state, now), line, previewPositionScale(ratio));
      near(view.noteVertical(note), plane.baseline - position.y * scale);
      near(view.noteVertical(note, 'endTime'), plane.baseline - position.tail * scale);
      near(view.timeAt(view.noteVertical(note)), entry.start);
      assert.equal(view.sideAt(view.noteVertical(note)), side);
    }
  }
});

test('双区支持点击、上下方放置、Hold 端点和拖拽；跨 BPM 时保持拍数吸附及一次撤销', () => {
  const { chart, tempo, flow } = fixture(), session = new EditorSession(chart), plane = { baseline: 300, height: 600, originX: 500, pixelsPerUnit: .5 };
  const canvas = { clientWidth: 1000, clientHeight: 600, style: {}, addEventListener() {}, focus() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 600 }) };
  const editor = new Timeline(canvas, canvas, () => session, () => {}, () => {}); editor.tempo = tempo; editor.origin = 2;
  editor.noteView = { ...plane, ...placementFlowView(flow, tempo.seconds(2, 2), plane, .5), renderScale: 1 };
  for (const side of [1, -1]) {
    editor.cursor = { x: editor.noteHorizontal(side * 135), y: editor.vertical(2.25, 600, side) }; editor.addAtCursor(1);
    const note = session.notes.at(-1); near(beatValue(note.startTime), 2.25); assert.equal(Number(note.above) === 1, side === 1);
    const hit = editor.hit(editor.cursor); assert.equal(hit.item, note);
  }
  session.selection = new Set([1]); const note = session.notes[1], start = { x: editor.noteHorizontal(-135), y: editor.noteVertical(note) };
  editor.drag = { kind: 'move', anchor: 1, lineIndex: 0, start, current: { x: start.x + 67.5, y: editor.vertical(2.5, 600, -1) }, side: -1, distanceOffset: 0 };
  const moved = editor.movedNote(note); near(beatValue(moved.startTime), 2.5); near(moved.positionX, 0); assert.equal(moved.above, 2);
  editor.cancelPlacement(); editor.cursor = { x: editor.noteHorizontal(0), y: editor.vertical(2.25, 600, -1) }; editor.addAtCursor(2);
  editor.cursor.y = editor.vertical(2.75, 600, -1); editor.addAtCursor(2);
  assert.equal(session.notes.at(-1).above, 0); near(beatValue(session.notes.at(-1).endTime), 2.75);
  session.travel('undo'); assert.equal(session.notes.length, 2); session.travel('redo'); assert.equal(session.notes.length, 3);
});

test('偏差连线只在视窗内绘制，不保留远处离屏长线', () => {
  const viewport = { left: 10, top: 10, width: 100, height: 80 };
  assert.deepEqual(clipPlacementConnection({ x: 20, y: 20 }, { x: 80, y: 70 }, viewport), [{ x: 20, y: 20 }, { x: 80, y: 70 }]);
  assert.deepEqual(clipPlacementConnection({ x: 20, y: 50 }, { x: 20000, y: 50 }, viewport), [{ x: 20, y: 50 }, { x: 110, y: 50 }]);
  assert.equal(clipPlacementConnection({ x: -50, y: -10 }, { x: 80, y: -10 }, viewport), null);
});

function placementFixture(layers) {
  const chart = createChart(); chart.judgeLineList[0].eventLayers = layers;
  const session = new EditorSession(chart), tempo = new TempoMap(chart.BPMList);
  const canvas = { clientWidth: 1000, clientHeight: 600, style: {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 600 }) };
  const scene = new SceneRuntime(), preview = { visible: true, canvas, scene, aspectRatio: 1.5, viewDivisor: 1 };
  const timeline = { notesCanvas: canvas }, errors = [];
  const placement = Object.assign(Object.create(DirectPlacement.prototype), {
    session, lineIndex: 0, getContext: () => ({ session, preview, tempo, seconds: 0 }),
    timeline, host: { style: {} }, surface: { style: {} }, opacity: .5, reportError: error => errors.push(error),
    close() { this.session = null; timeline.noteView = null; },
  });
  return { placement, session, scene, timeline, errors };
}

test('真实放置布局兼容 RPE 的 null、空槽和缺失速度事件层，保持原数据与流速缓存', () => {
  for (const layers of [[{ speedEvents: [createEvent(10)] }, {}, null, null, null], [, { speedEvents: [createEvent(10)] }, undefined], null, undefined]) {
    const { placement, session, timeline, errors } = placementFixture(layers), source = session.line.eventLayers;
    assert.equal(placement.layout(), true); assert.ok(timeline.noteView?.flow);
    const flow = placement.flow; assert.equal(placement.layout(), true); assert.equal(placement.flow, flow);
    assert.equal(session.line.eventLayers, source); assert.deepEqual(errors, []);
  }
});

test('放置布局或绘制发生异常会结束临时编辑并报告错误，异常不再中断动画循环', () => {
  const layout = placementFixture([{ speedEvents: [createEvent(10)] }]);
  layout.placement.getContext = () => { throw Error('layout failed'); };
  assert.equal(layout.placement.layout(), false); assert.equal(layout.placement.active, false);
  assert.equal(layout.timeline.noteView, null); assert.equal(layout.errors[0].message, 'layout failed');
  const drawing = placementFixture([{ speedEvents: [createEvent(10)] }]);
  assert.equal(drawing.placement.layout(), true);
  drawing.timeline.draw = () => { throw Error('draw failed'); };
  assert.doesNotThrow(() => drawing.placement.draw(true)); assert.equal(drawing.placement.active, false);
  assert.equal(drawing.timeline.noteView, null); assert.equal(drawing.errors[0].message, 'draw failed');
});
