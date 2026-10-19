// @ts-nocheck - ported integration test with dynamic archive fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createChart, createLine, createEvent, createNote } from '../src/core/chart.ts';
import { TempoMap } from '../src/core/tempo.ts';
import { SceneRuntime } from '../src/core/scene.ts';
import { previewViewport, previewPositionScale } from '../src/core/editor-display.ts';
import { Preview } from '../src/ui/preview.ts';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);
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
