import test from 'node:test';
import assert from 'node:assert/strict';
import { createChart } from '../src/core/chart.mjs';
import { TempoMap } from '../src/core/tempo.mjs';
import { createNoiseArea } from '../src/core/noise-areas.mjs';
import { noiseLayers, noiseRenderingLayers } from '../src/core/noise-skin.mjs';
import { NoisePreview } from '../src/ui/noise-preview.mjs';

function chartWithSkins() {
  const chart = createChart();
  chart.noiseAreaLayers = [
    { id: 'default', name: '默认层', skin: 'shader/NoiseField' },
    { id: 'water', name: '水面', skin: 'shader/Ocean' },
  ];
  return chart;
}

test('没有噪域的层不参与渲染，层管理仍保留全部层', () => {
  const chart = chartWithSkins();
  assert.equal(noiseLayers(chart).length, 2);
  assert.deepEqual(noiseRenderingLayers(chart), []);
  const area = { ...createNoiseArea(8, 12), layerId: 'water' };
  chart.blockAreaList = [area];
  assert.deepEqual(noiseRenderingLayers(chart), [chart.noiseAreaLayers[1]]);
  assert.equal(noiseLayers(chart).length, 2);
  const changed = { ...chart, blockAreaList: [{ ...area, layerId: 'default' }] };
  assert.deepEqual(noiseRenderingLayers(changed), [changed.noiseAreaLayers[0]]);
  assert.deepEqual(noiseRenderingLayers(chart), [chart.noiseAreaLayers[1]]);
  chart.blockAreaList.push(createNoiseArea(0, 4));
  assert.deepEqual(noiseRenderingLayers(chart), chart.noiseAreaLayers);
});

test('空层不初始化 GPU、捕获画面或执行皮肤，已有实例和选择标记清理', () => {
  const chart = chartWithSkins(), preview = new NoisePreview();
  preview.guides = [{}]; preview.hitEntries = [{}];
  preview.draw({}, chart, new TempoMap(chart.BPMList), 1, 960, 640, 1);
  assert.equal(preview.gpu, undefined);
  assert.deepEqual(preview.guides, []); assert.deepEqual(preview.hitEntries, []);
  let retained;
  preview.gpu = { prune(ids) { retained = [...ids]; }, render() { assert.fail('空层不得执行皮肤'); } };
  preview.draw({}, chart, new TempoMap(chart.BPMList), 1, 960, 640, 1);
  assert.deepEqual(retained, []);
});

test('有噪域的层在生命周期外仍执行皮肤，保留空掩码和历史 Target 行为', () => {
  const chart = chartWithSkins(), preview = new NoisePreview();
  chart.blockAreaList = [{ ...createNoiseArea(8, 12), layerId: 'water' }];
  const frames = [];
  preview.gpu = {
    prune(ids) { assert.deepEqual([...ids], ['water']); },
    render(target, layer, assets, entries, seconds) { frames.push({ layer, entries, seconds }); return true; },
  };
  const tempo = new TempoMap(chart.BPMList);
  for (const seconds of [0, 2, 20]) preview.draw({ canvas: { width: 960 } }, chart, tempo, seconds, 960, 640, 1);
  assert.equal(frames.length, 3);
  assert.ok(frames.every(frame => frame.layer.id === 'water' && frame.entries.length === 0));
  assert.deepEqual(frames.map(frame => frame.seconds), [0, 2, 20]);
});

test('复用的几何预览可在空谱面中执行对应层的皮肤', context => {
  const original = globalThis.Path2D;
  globalThis.Path2D = class { moveTo() {} lineTo() {} closePath() {} };
  context.after(() => { if (original === undefined) delete globalThis.Path2D; else globalThis.Path2D = original; });
  const chart = chartWithSkins(), preview = new NoisePreview();
  const guide = {
    area: { ...createNoiseArea(), layerId: 'water' }, index: 0, state: 'active', scaleX: 1, scaleY: 1,
    points: [{ x: -100, y: -100 }, { x: 100, y: -100 }, { x: 100, y: 100 }, { x: -100, y: 100 }],
  };
  let rendered;
  preview.gpu = { prune() {}, render(target, layer, assets, entries) { rendered = { layer, entries }; return true; } };
  preview.draw({ canvas: { width: 960 } }, chart, new TempoMap(chart.BPMList), 1, 960, 640, 1, -1, undefined, { sourceGuides: [guide] });
  assert.equal(rendered.layer.id, 'water'); assert.equal(rendered.entries[0], guide);
});

test('噪域编号和中心标记缓存排字结果，移动和旋转不重复生成，字体加载后更新', context => {
  const original = globalThis.document, listeners = []; let textDraws = 0, spriteDraws = 0;
  globalThis.document = {
    fonts: { addEventListener(name, handler) { listeners.push(handler); } },
    createElement: () => ({ width: 0, height: 0, getContext: () => ({ setTransform() {}, beginPath() {}, arc() {}, moveTo() {}, lineTo() {}, stroke() {}, measureText: () => ({ width: 80, actualBoundingBoxLeft: 40, actualBoundingBoxRight: 40, actualBoundingBoxAscent: 14, actualBoundingBoxDescent: 0 }), fillText() { textDraws++; } }) }),
  };
  context.after(() => { if (original === undefined) delete globalThis.document; else globalThis.document = original; });
  const renderer = new NoisePreview(); renderer.width = 960; renderer.height = 640;
  renderer.guides = [{ index: 12, area: { Name: '噪域名称' }, center: { x: 0, y: 0 }, rotation: 0 }];
  const target = { save() {}, restore() {}, translate() {}, rotate() {}, drawImage() { spriteDraws++; } };
  for (let frame = 0; frame < 120; frame++) { renderer.guides[0].center.x = frame; renderer.guides[0].rotation = frame / 100; renderer.drawGuides(target, 1, -1, true); }
  assert.equal(textDraws, 1); assert.equal(spriteDraws, 120);
  renderer.drawGuides(target, 1, 12, true); assert.equal(textDraws, 2);
  renderer.drawGuides(target, 2, 12, true); assert.equal(textDraws, 3);
  listeners[0](); renderer.drawGuides(target, 2, 12, true); assert.equal(textDraws, 4);
});
