import test from 'node:test';
import assert from 'node:assert/strict';
import { NoiseAreaEditor } from '../src/ui/noise-area.mjs';
import { createNoiseArea, createNoiseEvent } from '../src/core/noise-areas.mjs';
import { fromNumber } from '../src/core/beat.mjs';
import { TempoMap } from '../src/core/tempo.mjs';
import { noiseSampleHandle, samplingTarget, fitNoiseSampleView } from '../src/core/noise-sampling.mjs';
import { previewPositionScale, previewNoiseGeometry } from '../src/core/editor-display.mjs';
import { createChart } from '../src/core/chart.mjs';

test('噪域编辑只查询可见生命周期，保留原顺序、边界命中及撤销后的索引更新', () => {
  let chart = createChart();
  chart.blockAreaList = Array.from({ length: 15000 }, (_, index) => createNoiseArea(index, index + 2));
  const editor = Object.assign(Object.create(NoiseAreaEditor.prototype), { getContext: () => ({ session: { chart } }) });
  const actual = editor.visibleAreas(7000, 7001);
  const expected = chart.blockAreaList.flatMap((area, index) => index + 2 >= 7000 && index <= 7001 ? [index] : []);
  assert.deepEqual(actual.map(entry => entry.index), expected);
  const index = editor.areaIndex; editor.visibleAreas(7001, 7002); assert.equal(editor.areaIndex, index);
  const original = chart;
  chart = { ...chart, blockAreaList: chart.blockAreaList.map((area, index) => index === 0 ? createNoiseArea(7000, 7001) : area) };
  assert.equal(editor.visibleAreas(7000, 7001)[0].index, 0); assert.notEqual(editor.areaIndex, index);
  chart = original; assert.deepEqual(editor.visibleAreas(7001, 7000).map(entry => entry.index), expected);
});

const interval = (start, end, readyFlash) => ({ startTime: fromNumber(start), endTime: fromNumber(end), readyFlash });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);

function samplingEditor(area, ratio, divisor = 1) {
  const editor = Object.create(NoiseAreaEditor.prototype); const renderer = { aspectRatio: ratio, viewDivisor: divisor };
  const chart = createChart(); chart.blockAreaList = [area]; const tempo = new TempoMap(chart.BPMList);
  const rect = { width: 960, height: 640, left: 30, top: 20, toJSON() { return { width: this.width, height: this.height, left: this.left, top: this.top }; } };
  editor.getContext = () => ({ previewVisible: true, preview: renderer, realtimePreview: renderer, session: { chart }, tempo });
  editor.overlay = { getBoundingClientRect: () => rect, setPointerCapture() {} };
  editor.sampleBar = { getBoundingClientRect: () => ({ bottom: 84 }) }; editor.selected = 0; editor.sampleSeconds = 1;
  editor.sampleZoom = [{ renderer, original: divisor, divisor }]; editor.invalidate = () => {}; editor.notify = message => assert.fail(message);
  return editor;
}

test('噪域取样的屏幕映射与比例适配一致，拖拽反算保留谱面坐标', () => {
  for (const ratio of [1.5, 16 / 9, 4 / 3, 1, 9 / 16]) {
    const area = createNoiseArea(0, 8); area.topRight = { x: 675, y: 450 };
    const editor = samplingEditor(area, ratio); editor.sampleMode = { field: 'topRight' };
    let view = editor.sampleView(); const corner = view.screen(noiseSampleHandle(area, editor.context.tempo, 1, editor.sampleMode, view.positionScale));
    near(corner.x, view.viewport.left + view.viewport.width); near(corner.y, view.viewport.top);
    editor.sampleDown({ clientX: view.left + corner.x, clientY: view.top + corner.y, button: 0, pointerId: 1, preventDefault() {}, stopPropagation() {} });
    assert.ok(editor.sampleDrag);
    const target = { x: 500, y: 300 }, changed = { ...area, topRight: target }; const screen = view.screen(noiseSampleHandle(changed, editor.context.tempo, 1, editor.sampleMode, view.positionScale));
    editor.sampleMove({ clientX: view.left + screen.x, clientY: view.top + screen.y });
    assert.deepEqual(editor.area().topRight, target); assert.deepEqual(area.topRight, { x: 675, y: 450 });
    view = editor.sampleView();
    for (const point of [target, { x: -1000, y: 800 }]) { const world = view.world(view.screen(point)); near(world.x, point.x); near(world.y, point.y); }
  }
});

test('带锚点旋转缩放的取样控制点和自动视野使用相同的比例适配', () => {
  for (const type of ['rotateEvents', 'scaleXEvents', 'scaleYEvents']) for (const ratio of [16 / 9, 4 / 3]) {
    const area = createNoiseArea(0, 8); area[type] = [createNoiseEvent(type === 'rotateEvents' ? 0 : 1, type === 'rotateEvents' ? 120 : 5, 0, 4, { x: -700, y: 800 })];
    const editor = samplingEditor(area, ratio, 1.3); editor.sampleMode = samplingTarget(area, type, 0, 'end');
    const positionScale = previewPositionScale(ratio), projected = noiseSampleHandle(area, editor.context.tempo, 1, editor.sampleMode, positionScale);
    const expected = fitNoiseSampleView(projected, 960, 640, ratio, 1.3, 64);
    editor.fitSampleView(); near(editor.context.preview.viewDivisor, expected);
    const view = editor.sampleView(), point = view.screen(projected);
    near(point.x, 480 + projected.x * view.scale); near(point.y, 320 - projected.y * view.scale);
    const world = view.world(point); near(world.x, projected.x); near(world.y, projected.y);
  }
});

test('旋转及负缩放噪域的角点、事件值和锚点取样跟随可见几何，点击不改值', () => {
  for (const ratio of [1.5, 16 / 9, 4 / 3, 9 / 16]) for (const mirrored of [false, true]) {
    const area = createNoiseArea(0, 8);
    area.bottomLeft = { x: -180, y: -90 }; area.topRight = { x: 260, y: 170 };
    area.moveXEvents = [createNoiseEvent(120, 190, 0, 4)]; area.moveYEvents = [createNoiseEvent(-40, 80, 0, 4)];
    area.rotateEvents = [createNoiseEvent(15, 52, 0, 4, { x: -220, y: 310 })];
    area.scaleXEvents = [createNoiseEvent(1, mirrored ? -1.7 : 1.7, 0, 4, { x: -300, y: 190 })];
    area.scaleYEvents = [createNoiseEvent(1, .75, 0, 4, { x: 270, y: -210 })];
    const targets = [{ field: 'bottomLeft' }, { field: 'topRight' }, ...['moveXEvents', 'moveYEvents', 'rotateEvents', 'scaleXEvents', 'scaleYEvents'].flatMap(type => ['start', 'end', ...(type.startsWith('move') ? [] : ['anchor'])].map(field => samplingTarget(area, type, 0, field)))];
    for (const target of targets) {
      const editor = samplingEditor(area, ratio); editor.sampleMode = target; editor.context.sampleAutoFit = false;
      const view = editor.sampleView(), first = view.screen(noiseSampleHandle(area, editor.context.tempo, 1, target, view.positionScale));
      const input = point => ({ clientX: view.left + point.x, clientY: view.top + point.y, button: 0, pointerId: 1, preventDefault() {}, stopPropagation() {} });
      const snapshot = JSON.stringify(editor.area()); editor.sampleDown(input(first)); assert.ok(editor.sampleDrag); assert.equal(JSON.stringify(editor.area()), snapshot); assert.equal(editor.draftChart, undefined);
      const changed = structuredClone(area);
      if (target.field === 'anchor') { changed[target.type][0].anchor.x += 31; changed[target.type][0].anchor.y -= 23; }
      else if (target.type) changed[target.type][0][target.field] += target.type.startsWith('scale') ? .12 : 6;
      else { changed[target.field].x += 27; changed[target.field].y -= 19; }
      const wanted = noiseSampleHandle(changed, editor.context.tempo, 1, target, view.positionScale);
      editor.sampleMove(input(view.screen(wanted)));
      const actual = editor.area(), handle = noiseSampleHandle(actual, editor.context.tempo, 1, target, view.positionScale);
      assert.ok(Math.hypot(handle.x - wanted.x, handle.y - wanted.y) < .001, `${ratio} ${mirrored} ${JSON.stringify(target)}`);
      if (target.field === 'anchor') assert.deepEqual(actual[target.type][0].anchor, changed[target.type][0].anchor);
      else if (target.type) assert.ok(Math.abs(actual[target.type][0][target.field] - changed[target.type][0][target.field]) < .001);
      else assert.deepEqual(actual[target.field], changed[target.field]);
    }
  }
});

function distributionEditor(tempo) {
  const editor = Object.create(NoiseAreaEditor.prototype);
  editor.distributions = new WeakMap(); editor.getContext = () => ({ tempo });
  editor.layout = () => ({ height: 1000 }); editor.y = beat => 900 - tempo.seconds(beat) * 100;
  return editor;
}
function strokes(editor, area) {
  const points = []; const context = new Proxy({ globalAlpha: 1, moveTo: (...point) => points.push(point), lineTo: (...point) => points.push(point) }, { get(target, key) { return key in target ? target[key] : () => {}; } });
  editor.drawDistribution(context, area, 10, 60, editor.y(10), editor.y(0)); return points;
}

test('激活概览的虚线使用秒数跨 BPM 映射，并在生命周期及上个激活段处裁剪', () => {
  const tempo = new TempoMap([{ startTime: fromNumber(0), bpm: 120 }, { startTime: fromNumber(3), bpm: 60 }]);
  const editor = distributionEditor(tempo); const area = createNoiseArea(0, 10);
  area.activeIntervals = [interval(4, 5, 1.2), interval(5.1, 6, 1), interval(7, 8, 0)];
  const points = strokes(editor, area); assert.equal(points.length, 4);
  near(points[0][1], editor.y(4)); near(points[1][1], editor.y(2.6));
  near(points[2][1], editor.y(5.1)); near(points[3][1], editor.y(5));
  area.appearTime = fromNumber(3.8); editor.distributions.delete(area);
  near(strokes(editor, area)[1][1], editor.y(3.8));
});

test('虚线支持旧预闪布尔值，并在 BPM 变化后更新缓存', () => {
  const area = createNoiseArea(0, 10); area.activeIntervals = [interval(2, 3, true), interval(5, 6, false)];
  const tempo = new TempoMap([{ startTime: fromNumber(0), bpm: 120 }]); const editor = distributionEditor(tempo);
  const points = strokes(editor, area); assert.equal(points.length, 2); near(points[1][1], editor.y(1));
  const nextTempo = new TempoMap([{ startTime: fromNumber(0), bpm: 60 }]);
  editor.getContext = () => ({ tempo: nextTempo }); editor.y = beat => 900 - nextTempo.seconds(beat) * 100;
  near(strokes(editor, area)[1][1], editor.y(1.5));
});

test('零时长激活事件在噪域概览中仍显示完整预闪虚线', () => {
  const area = createNoiseArea(0, 10); area.activeIntervals = [interval(4, 4, 0.5)];
  const tempo = new TempoMap([{ startTime: fromNumber(0), bpm: 120 }]), editor = distributionEditor(tempo), points = strokes(editor, area);
  assert.equal(points.length, 2); near(points[0][1], editor.y(4)); near(points[1][1], editor.y(3));
});

test('噪域内部短事件首尾相接时仅标注连续组范围，放大仍不堆叠内部端点', () => {
  const editor = Object.create(NoiseAreaEditor.prototype); const timeline = { eventValueThreshold: 30, eventValueFontSize: 13 };
  editor.getContext = () => ({ timeline }); editor.layout = () => ({ width: 1000, height: 800, eventLeft: 450 });
  const events = Array.from({ length: 100 }, (unused, index) => createNoiseEvent(1000 + index, 1001 + index, index / 100, (index + 1) / 100));
  for (const scale of [200, 1500]) {
    editor.y = beat => 600 - beat * scale;
    const texts = []; const context = new Proxy({ fillText: text => texts.push(text) }, { get(target, key) { return target[key] ?? (() => {}); } });
    editor.drawEventValues(context, events, 'moveXEvents', { x: 500, width: 80 }, 800);
    assert.deepEqual(texts, ['1100', '1000']);
    texts.length = 0; editor.drawEventValues(context, events, 'moveXEvents', { x: 500, width: 20 }, 800); assert.deepEqual(texts, []);
  }
});

test('噪域内部事件时间留有间隙时分别标注，粘贴预览也按连续组处理', () => {
  const editor = Object.create(NoiseAreaEditor.prototype); editor.getContext = () => ({ timeline: {} });
  editor.layout = () => ({ width: 1000, height: 800, eventLeft: 450 }); editor.y = beat => 700 - beat * 200;
  const events = [createNoiseEvent(10, 20, 0, 0.5), createNoiseEvent(20, 30, 0.5, 1), createNoiseEvent(40, 50, 2, 2.5)];
  const texts = []; const context = new Proxy({ fillText: text => texts.push(text) }, { get(target, key) { return target[key] ?? (() => {}); } });
  editor.drawEventValues(context, events, 'rotateEvents', { x: 800, width: 80 }, 800, true);
  assert.deepEqual(texts, ['30', '10', '50', '40']);
});

function drawInternalEvents(events, { seamless = true, type = 'moveXEvents', selected = false, hover = null } = {}) {
  const editor = Object.create(NoiseAreaEditor.prototype); const area = createNoiseArea(0, 4); area[type] = events;
  const tempo = new TempoMap([{ startTime: fromNumber(0), bpm: 120 }]);
  const timeline = { seamlessEvents: seamless, division: 4, gridCount: 11, origin: 0 };
  editor.getContext = () => ({ timeline, tempo, session: { chart: { blockAreaList: [area] } } });
  const layout = { width: 1000, height: 800, split: 400, eventLeft: 430, eventWidth: 90 };
  editor.layout = () => layout; editor.y = beat => 700 - beat * 200; editor.beatAt = vertical => (700 - vertical) / 200;
  editor.selected = 0; editor.selection = new Set(selected ? [type + ':2'] : ['area:0']); editor.hover = hover;
  editor.areaX = () => 100; editor.drawDistribution = () => {}; editor.drawOwner = () => {}; editor.canvas = { setAttribute() {} };
  const calls = []; const context = new Proxy({}, { get(target, key) { return target[key] ?? ((...args) => calls.push({ method: key, args })); } });
  editor.drawTimeline(context, layout.width, layout.height, layout);
  const bounds = editor.eventBounds(type); const rectangles = calls.filter(call => call.method === 'strokeRect' && call.args[0] === bounds.x);
  const caps = calls.filter(call => call.method === 'fillRect' && call.args[0] === bounds.x && call.args[3] === 4);
  return { editor, rectangles, caps };
}

test('连续事件无接缝对噪域内部填充、边框和首尾横条同时生效，保留各段命中区域', () => {
  const events = Array.from({ length: 100 }, (unused, index) => createNoiseEvent(index, index + 1, index / 100, (index + 1) / 100));
  const joined = drawInternalEvents(events); assert.equal(joined.rectangles.length, 1); assert.equal(joined.caps.length, 2);
  assert.equal(joined.editor.rects.filter(rect => rect.type === 'moveXEvents').length, 100);
  const separate = drawInternalEvents(events, { seamless: false }); assert.equal(separate.rectangles.length, 100); assert.equal(separate.caps.length, 200);
  const selected = drawInternalEvents(events, { selected: true }); assert.equal(selected.rectangles.length, 100);
  const hovered = drawInternalEvents(events, { hover: { type: 'moveXEvents', index: 2, kind: 'move' } }); assert.equal(hovered.rectangles.length, 2);
});

test('噪域激活段同样支持无接缝，断开的事件组分别绘制且钩定事件保留边界', () => {
  const activations = Array.from({ length: 4 }, (unused, index) => interval(index / 4, (index + 1) / 4, 0));
  assert.equal(drawInternalEvents(activations, { type: 'activeIntervals' }).rectangles.length, 1);
  const events = [createNoiseEvent(0, 1, 0, 0.25), createNoiseEvent(1, 2, 0.25, 0.5), createNoiseEvent(2, 3, 1, 1.25), createNoiseEvent(3, 4, 1.25, 1.5)];
  assert.equal(drawInternalEvents(events).rectangles.length, 2);
  events[0].inst = 1; assert.equal(drawInternalEvents(events).rectangles.length, 3);
});

test('噪域内部视野裁剪不妨碍框选视野外事件，仍按拍数和原始索引选择', () => {
  const events = [createNoiseEvent(0,1,0,1),createNoiseEvent(1,2,100,101),createNoiseEvent(2,3,-100,-99)];
  const {editor} = drawInternalEvents(events);
  assert.deepEqual(editor.rects.filter(rect=>rect.type==='moveXEvents').map(rect=>rect.index),[0]);
  const all = [...editor.selectionRects('events')].filter(rect=>rect.type==='moveXEvents');
  assert.deepEqual(all.map(rect=>[rect.index,rect.start,rect.end]),[[0,0,1],[1,100,101],[2,-100,-99]]);
});
