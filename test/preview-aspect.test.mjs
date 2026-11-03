import test from 'node:test';
import assert from 'node:assert/strict';
import { createChart, createLine, createEvent, createNote } from '../src/core/chart.mjs';
import { TempoMap } from '../src/core/tempo.mjs';
import { SceneRuntime } from '../src/core/scene.mjs';
import { previewViewport, previewDefaultFrame, previewPositionScale, previewNoiseGeometry } from '../src/core/editor-display.mjs';
import { createNoiseArea, createNoiseEvent, noiseRuntime } from '../src/core/noise-areas.mjs';
import { Preview } from '../src/ui/preview.mjs';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);

test('默认视野框仅在缩放大于1时显示，随比例居中缩放但不改变坐标语义', () => {
  for (const ratio of [1.5, 16 / 9, 4 / 3, 9 / 16]) {
    const view = previewViewport(1200, 800, ratio);
    assert.equal(previewDefaultFrame(view, 1), null); assert.equal(previewDefaultFrame(view, 0.5), null);
    const frame = previewDefaultFrame(view, 2);
    near(frame.width, view.width / 2); near(frame.height, view.height / 2); near(frame.left + frame.width / 2, 600); near(frame.top + frame.height / 2, 400);
  }
});
function renderer() {
  const calls = [];
  const context = new Proxy({ calls }, { get: (target, key) => key in target ? target[key] : (...args) => calls.push({ key, args }) });
  const canvas = { getBoundingClientRect: () => ({ width: 960, height: 640, left: 0, top: 0 }), getContext: () => context };
  globalThis.devicePixelRatio = 1;
  const preview = new Preview(canvas); preview.visible = true; preview.pickPreviewLines = true;
  return { preview, calls };
}

test('切换宽高比时判定线锚点始终贴合右上角，贴图尺寸不被压扁', () => {
  const chart = createChart(); const line = chart.judgeLineList[0];
  line.eventLayers[0].moveXEvents = [createEvent(675)]; line.eventLayers[0].moveYEvents = [createEvent(450)];
  const tempo = new TempoMap(chart.BPMList); const { preview, calls } = renderer();
  const widths = [];
  preview.drawLine = (context, line, state, scale) => widths.push(4000 * scale);
  for (const ratio of [1.5, 16 / 9, 4 / 3, 1, 9 / 16]) {
    preview.aspectRatio = ratio; preview.draw(chart, tempo, 0, 0);
    const view = preview.viewport, guide = preview.guides[0];
    near(guide.x, view.left + view.width); near(guide.y, view.top);
    near(widths.at(-1), 4000 * view.scale);
    assert.equal(preview.pick(guide.x - 2, guide.y + 1), 0);
    const position = calls.filter(call => call.key === 'translate').at(-1).args;
    near(position[0], guide.x); near(position[1], guide.y);
  }
  assert.equal(line.eventLayers[0].moveYEvents[0].start, 450);
});

test('父线的局部坐标先适配再旋转，原始场景采样仍保持谱面坐标', () => {
  const chart = createChart(); chart.judgeLineList.push(createLine(), createLine());
  const [parent, child, grandchild] = chart.judgeLineList;
  parent.eventLayers[0].moveXEvents = [createEvent(100)]; parent.eventLayers[0].moveYEvents = [createEvent(200)]; parent.eventLayers[0].rotateEvents = [createEvent(90)];
  child.father = 0; child.rotateWithFather = true; child.eventLayers[0].moveXEvents = [createEvent(30)]; child.eventLayers[0].moveYEvents = [createEvent(60)];
  grandchild.father = 1; grandchild.eventLayers[0].moveXEvents = [createEvent(20)];
  const scene = new SceneRuntime(); scene.compile(chart, new TempoMap(chart.BPMList));
  const [base, middle, last] = scene.sample(0, previewPositionScale(16 / 9));
  near(base.x, 100); near(base.y, 168.75); near(middle.x, 150.625); near(middle.y, 138.75);
  near(last.x, middle.x); near(last.y, middle.y - 20);
  near(scene.sampler(0)(1).x, 160); near(scene.sampler(0)(1).y, 170);
});

test('旋转后的音符、Hold 和打击特效使用局部适配位置，皮肤宽高仍等比', () => {
  const chart = createChart(); const line = chart.judgeLineList[0];
  line.eventLayers[0].rotateEvents = [createEvent(90)];
  line.notes = [createNote(1, 1, 100), createNote(2, 1, 200, 3)];
  const { preview } = renderer(); const tempo = new TempoMap(chart.BPMList); const shapes = [], hits = [];
  preview.skin = { tinted: () => null, head(context, type, x, y, width, highlight, tint, minimum, heightWidth) { shapes.push([width, heightWidth]); return true; }, hold() { return true; }, drawHit(context, hit) { hits.push(hit); return true; } };
  preview.aspectRatio = 16 / 9; preview.draw(chart, tempo, 0, 0);
  const scale = preview.viewScale; const area = preview.noteHitAreas.find(area => area.type === 1), hold = preview.noteHitAreas.find(area => area.type === 2);
  const distance = preview.scene.lines[0].notes[0].floor;
  near(area.x1, 480 + distance * 0.84375 * scale); near(area.y1, 320 + 100 * scale);
  near(hold.x2 - hold.x1, (preview.scene.lines[0].notes[1].tail - distance) * 0.84375 * scale);
  near(shapes[0][0], shapes[0][1]);
  preview.effectsSince = 0; preview.draw(chart, tempo, 0.6, 0);
  near(hits[0].x, 480); near(hits[0].y, 320 + 100 * scale);
});

test('预览宽高比不改变 viewport 的贴图缩放定义', () => {
  const view = previewViewport(960, 640, 16 / 9);
  near(view.width / view.scale, 1350); near(view.height / view.scale, 759.375);
});

function noiseRenderer(context) {
  const original = globalThis.Path2D;
  globalThis.Path2D = class {
    constructor() { this.points = []; }
    moveTo(...point) { this.points.push(point); }
    lineTo(...point) { this.points.push(point); }
    closePath() {}
  };
  context.after(() => { if (original) globalThis.Path2D = original; else delete globalThis.Path2D; });
  const result = renderer();
  result.preview.noisePreview.layer = () => ({ canvas: {}, context: { drawImage() {} } });
  result.preview.noisePreview.drawLayer = () => ({ material: {}, coverage: {} });
  return result.preview;
}

test('噪域右上角随预览比例贴合可见边界，复用到窗口外预览时不重复适配', context => {
  const preview = noiseRenderer(context); const chart = createChart(); const area = createNoiseArea(0, 8);
  area.bottomLeft = { x: 375, y: 150 }; area.topRight = { x: 675, y: 450 }; chart.blockAreaList = [area];
  const tempo = new TempoMap(chart.BPMList); const original = JSON.stringify(chart);
  for (const ratio of [1.5, 16 / 9, 4 / 3, 1, 9 / 16]) {
    preview.aspectRatio = ratio; preview.draw(chart, tempo, 1, 0);
    const guide = preview.noisePreview.guides[0], view = preview.viewport;
    assert.ok(guide.path.points.some(([horizontal, vertical]) => Math.abs(horizontal - view.left - view.width) < 1e-7 && Math.abs(vertical - view.top) < 1e-7));
    const points = structuredClone(guide.points);
    preview.noisePreview.draw({ save() {}, restore() {}, drawImage() {} }, chart, tempo, 1, 960, 640, preview.viewScale, -1, view,
      { sourceGuides: [guide], positionScale: previewPositionScale(ratio) });
    assert.deepEqual(preview.noisePreview.guides[0].points, points);
  }
  assert.equal(JSON.stringify(chart), original);
});

test('带锚点变换的噪域只在显示阶段适配比例，皮肤和几何钩子收到相同坐标', context => {
  const preview = noiseRenderer(context); const chart = createChart(); const area = createNoiseArea(0, 8);
  area.layerId = 'water'; area.rotateEvents = [createNoiseEvent(0, 60, 0, 4, { x: 125, y: 300 })];
  area.scaleXEvents = [createNoiseEvent(1, 2, 0, 4, { x: -200, y: 100 })]; chart.blockAreaList = [area];
  chart.noiseAreaLayers = [{ id: 'water', name: 'Water', skin: 'test' }];
  const tempo = new TempoMap(chart.BPMList); const runtime = noiseRuntime(area, tempo); const original = runtime.sample(1);
  let geometry, material;
  preview.noisePreview.transformGeometry = entry => { geometry = entry; return entry; };
  preview.noisePreview.gpu = { prune() {}, render(target, definition, assets, entries) { material = entries[0]; return true; } };
  for (const ratio of [1.5, 16 / 9, 4 / 3]) {
    preview.aspectRatio = ratio; preview.draw(chart, tempo, 1, 0);
    const positionScale = previewPositionScale(ratio);
    assert.equal(material, geometry);
    const edge = (points, index) => ({ x: points[index + 1].x - points[index].x, y: points[index + 1].y - points[index].y });
    const first = edge(geometry.points, 0), second = edge(geometry.points, 1);
    near(first.x * second.x + first.y * second.y, 0);
    near(Math.hypot(first.x, first.y), Math.hypot(...Object.values(edge(original.points, 0))) * positionScale.x);
    near(Math.hypot(second.x, second.y), Math.hypot(...Object.values(edge(original.points, 1))) * positionScale.y);
    near(geometry.center.x, original.center.x * positionScale.x); near(geometry.center.y, original.center.y * positionScale.y);
    near(geometry.rotation, original.rotation);
  }
  assert.deepEqual(runtime.sample(1).points, original.points);
  assert.equal(previewNoiseGeometry(original, { x: 1, y: 1 }), original);
});
