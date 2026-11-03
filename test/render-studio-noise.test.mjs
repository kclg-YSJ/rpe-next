import test from 'node:test';
import assert from 'node:assert/strict';
import { createChart } from '../src/core/chart.mjs';
import { createNoiseArea } from '../src/core/noise-areas.mjs';
import { scaledNoiseGeometry, withDefaultNoiseSkin, attachStudioNoise } from '../src/ui/render-studio/noise.mjs';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const rectangle = (cx, cy, width, height, rotation) => {
  const cos = Math.cos(rotation), sin = Math.sin(rotation);
  return {
    points: [[-width / 2, -height / 2], [width / 2, -height / 2], [width / 2, height / 2], [-width / 2, height / 2]]
      .map(([x, y]) => ({ x: cx + cos * x + sin * y, y: cy - sin * x + cos * y })),
    center: { x: cx, y: cy }, rotation,
  };
};

test('渲染器的噪域缩放只压缩自身横纵轴，矩形不会变成平行四边形', () => {
  for (const [ratio, rotation] of [[16 / 9, 0], [16 / 9, 0.5], [9 / 16, 0.3], [4 / 3, 1.1]]) {
    const positionScale = { x: Math.min(1, ratio / 1.5), y: Math.min(1, 1.5 / ratio) };
    const sample = rectangle(100, 50, 200, 100, rotation);
    const scaled = scaledNoiseGeometry(sample, positionScale);
    const edge = (a, b) => ({ x: b.x - a.x, y: b.y - a.y });
    const first = edge(scaled.points[0], scaled.points[1]), second = edge(scaled.points[1], scaled.points[2]);
    near(first.x * second.x + first.y * second.y, 0);
    near(Math.hypot(first.x, first.y), 200 * positionScale.x);
    near(Math.hypot(second.x, second.y), 100 * positionScale.y);
    near(scaled.center.x, 100 * positionScale.x);
    near(scaled.center.y, 50 * positionScale.y);
    near(scaled.rotation, rotation);
    assert.deepEqual(sample.points, rectangle(100, 50, 200, 100, rotation).points);
  }
  const sample = rectangle(0, 0, 200, 100, 0.4);
  assert.equal(scaledNoiseGeometry(sample, { x: 1, y: 1 }), sample);
});

test('默认噪域皮肤只补在没有 skin 的层上，谱面本身不被修改', () => {
  const chart = createChart();
  chart.blockAreaList = [createNoiseArea(0, 4), createNoiseArea(4, 8)];
  chart.noiseAreaLayers = [{ id: chart.blockAreaList[0].layerId, name: 'A' }];
  const snapshot = JSON.stringify(chart);
  const patched = withDefaultNoiseSkin(chart, 'shader/NoiseField');
  assert.equal(JSON.stringify(chart), snapshot);
  assert.equal(patched.noiseAreaLayers[0].skin, 'shader/NoiseField');
  assert.equal(withDefaultNoiseSkin(chart, null), chart);

  chart.noiseAreaLayers = [{ id: chart.blockAreaList[0].layerId, name: 'A', skin: 'shader/Custom' }];
  const kept = withDefaultNoiseSkin(chart, 'shader/NoiseField');
  assert.equal(kept.noiseAreaLayers[0].skin, 'shader/Custom');
});

test('渲染适配保留摄像机几何钩子与比例选项，默认皮肤副本跨帧复用', () => {
  const documentBefore = globalThis.document, attributes = [], calls = [], hook = () => {};
  globalThis.document = { createElement: () => ({ getContext(type, options) { if (type === 'webgl2') attributes.push(options); return null; } }) };
  try {
    const target = { transformGeometry: hook, draw(...args) { calls.push(args); assert.equal(this.transformGeometry, hook); return 'drawn'; } };
    const studio = attachStudioNoise({ noisePreview: target });
    assert.equal(studio.renderer.overlay, true); assert.equal(attributes[0].premultipliedAlpha, true);
    const chart = createChart(); chart.blockAreaList = [createNoiseArea(0, 4)]; const snapshot = JSON.stringify(chart);
    const options = { positionScale: { x: 1, y: .84375 }, sourceGuides: [{ marker: true }] };
    studio.setDefaultSkin('shader/NoiseField');
    for (const time of [0, .1]) assert.equal(target.draw({}, chart, {}, time, 960, 540, 1, 0, {}, options), 'drawn');
    assert.equal(calls[0][1], calls[1][1]); assert.notEqual(calls[0][1], chart);
    assert.equal(calls[0][9], options); assert.equal(target.transformGeometry, hook); assert.equal(JSON.stringify(chart), snapshot);
    studio.setDefaultSkin(null); target.draw({}, chart); assert.equal(calls[2][1], chart);
  } finally { if (documentBefore === undefined) delete globalThis.document; else globalThis.document = documentBefore; }
});
