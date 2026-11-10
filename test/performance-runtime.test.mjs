import test from 'node:test';
import assert from 'node:assert/strict';
import { createChart, createLine, createEvent, createNote } from '../src/core/chart.mjs';
import { TempoMap } from '../src/core/tempo.mjs';
import { SpeedIntegral } from '../src/core/events.mjs';
import { SceneRuntime } from '../src/core/scene.mjs';
import { TimelineActivity } from '../src/core/timeline-activity.mjs';
import { IntervalIndex } from '../src/core/interval-index.mjs';
import { ProjectImages, textureScale, animatedImage } from '../src/platform/images.mjs';
import { PreviewBackground, textureInViewport } from '../src/ui/preview-background.mjs';

test('积分快路径与原 Simpson 积分在常值、线性、Bezier、空隙和负时间保持一致', () => {
  class ReferenceIntegral extends SpeedIntegral {
    integrate(segment, end) {
      if (!segment.entry) return 0;
      const step = (end - segment.start) / 20; let sum = 0;
      for (let index = 0; index <= 20; index++) sum += (index === 0 || index === 20 ? 1 : index % 2 ? 4 : 2) * this.sample(segment.entry, segment.start + step * index);
      return sum * step / 3;
    }
  }
  const tempo = new TempoMap(createChart().BPMList);
  for (const events of [[], [createEvent(4, 4, -4, 3)], [createEvent(-3, 8, -2, 4), createEvent(2, -4, 6, 9)],
    [{ ...createEvent(4, 4, -4, 3), bezier: 1, bezierPoints: [.2, .8, .6, .1] }],
    [{ ...createEvent(1, 6, -4, 3), bezier: 1, bezierPoints: [.2, .8, .6, .1] }, { ...createEvent(3, 9, 5, 8), easingType: 26 }]]) {
    const actual = new SpeedIntegral(events, tempo); const expected = new ReferenceIntegral(events, tempo);
    for (let index = -60; index <= 180; index++) assert.ok(Math.abs(actual.distance(index / 20) - expected.distance(index / 20)) < 1e-7);
  }
});

test('打击位置只求目标线与父链；同一时刻共享父线结果，重新编译后正确失效', () => {
  const chart = createChart(); chart.judgeLineList = Array.from({ length: 40 }, () => createLine());
  chart.judgeLineList[3].father = 1; chart.judgeLineList[4].father = 1;
  chart.judgeLineList[1].eventLayers[0].moveXEvents = [createEvent(120)];
  const scene = new SceneRuntime(); const tempo = new TempoMap(chart.BPMList); scene.compile(chart, tempo);
  const expected = scene.sample(.5); const visited = [];
  scene.lines.forEach((runtime, index) => { const state = runtime.state.bind(runtime); runtime.state = seconds => { visited.push(index); return state(seconds); }; });
  const sample = scene.sampler(.5);
  assert.deepEqual(sample(3), expected[3]); assert.deepEqual(sample(4), expected[4]); sample(3);
  assert.deepEqual(visited, [3, 1, 4]);
  const changed = { ...chart, judgeLineList: [...chart.judgeLineList] };
  changed.judgeLineList[1] = { ...chart.judgeLineList[1], eventLayers: [{ moveXEvents: [createEvent(220)] }] };
  scene.compile(changed, tempo); assert.equal(scene.sampler(.5)(3).x, 220);
});

test('密度缓存只统计当前线与当前层；切线、编辑、BPM、尺寸和音频时长更新缓存', () => {
  const chart = createChart(); chart.judgeLineList.push(createLine());
  chart.judgeLineList[0].notes = [createNote(1, 2, 0)]; chart.judgeLineList[1].notes = [createNote(2, 10, 0, 20)];
  const tempo = new TempoMap(chart.BPMList); const activity = new TimelineActivity(); activity.compile(chart, tempo);
  const first = activity.density(0, 0, false, 12, 400);
  assert.equal(first.windowSeconds, 1);
  for(let i=0;i<first.bins;i++) { const seconds=(i+.5)*12/first.bins;assert.equal(first.noteBins[i],Math.abs(seconds-1)<=.5?1:0);assert.equal(first.eventBins[i],seconds<=.5?5:0); }
  assert.equal(activity.density(0, 0, false, 12, 400), first);
  assert.equal(activity.duration, 10);
  assert.notEqual(activity.density(1, 0, false, 12, 400), first);
  assert.equal(activity.density(0, 0, true, 12, 400).eventBins.some(Boolean), false);
  assert.equal(activity.layerState(0, 0, true, 0, 100, 0, 100), 'empty');
  assert.equal(activity.layerState(0, 0, false, 0, 100, 0, 100), 'visible');
  assert.equal(activity.layerState(0, 0, false, 2, 100, 2, 100), 'outside');
  const sized = activity.density(0, 0, false, 12, 600); assert.equal(sized.bins, 600);
  assert.notEqual(activity.density(0, 0, false, 40, 600), sized);
  const changed = { ...chart, judgeLineList: [{ ...chart.judgeLineList[0], notes: [] }, chart.judgeLineList[1]] };
  activity.compile(changed, tempo); assert.equal(activity.density(0, 0, false, 12, 400).noteBins.some(Boolean), false);
  activity.compile(changed, new TempoMap([{ bpm: 60, startTime: [0, 0, 1] }])); assert.equal(activity.duration, 20);
});

test('事件层可见性查询与区间列表查询在重叠事件和端点上保持一致', () => {
  const items = Array.from({ length: 200 }, (unused, index) => ({ start: index / 3, end: index / 3 + index % 7 }));
  const tree = new IntervalIndex(items, entry => entry.start, entry => entry.end);
  for (let point = -2; point < 80; point += .25) assert.equal(tree.has(point, point + .1), tree.query(point, point + .1).length > 0);
});

function png(width, height) {
  const bytes = new Uint8Array(40); const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x89504e47); view.setUint32(4, 0x0d0a1a0a); view.setUint32(8, 13); view.setUint32(12, 0x49484452); view.setUint32(16, width); view.setUint32(20, height);
  return bytes;
}

test('贴图按需加载，最多同时解码两张，保留原坐标尺寸并释放过期位图', async () => {
  const original = globalThis.createImageBitmap; let active = 0; let maximum = 0; let decoded = 0; let closed = 0;
  globalThis.createImageBitmap = async (blob, options) => {
    active++; maximum = Math.max(maximum, active); decoded++; await new Promise(resolve => setTimeout(resolve, 1)); active--;
    return { width: options.resizeWidth, height: options.resizeHeight, close() { closed++; } };
  };
  try {
    const chart = createChart(); chart.judgeLineList = Array.from({ length: 8 }, (unused, index) => ({ ...createLine(), Texture: `${index}.png` }));
    const assets = new Map(chart.judgeLineList.map(line => [line.Texture, png(3840, 2160)]));
    const images = new ProjectImages(() => {}); await images.load(chart, assets, 'chart.json');
    assert.equal(decoded, 0);
    const pending = chart.judgeLineList.map(line => { images.texture(line.Texture, .3); return images.describe(line.Texture).pending; });
    await Promise.all(pending); assert.equal(maximum, 2); assert.equal(decoded, 8);
    const texture = images.texture('0.png', .25); assert.equal(texture.naturalWidth, 3840); assert.equal(texture.source.width, 1920);
    assert.equal(images.decodedBytes, 8 * 1920 * 1080 * 4);
    images.budget = 1; for (const record of images.records.values()) record.lastUsed = -10000;
    images.trim(); assert.equal(closed, 8); assert.equal(images.decodedBytes, 0);
    images.texture('1.png', 1); const loading = images.describe('1.png').pending;
    images.clear(); await loading; assert.equal(images.images.size, 0); assert.equal(closed, 9);
  } finally { if (original) globalThis.createImageBitmap = original; else delete globalThis.createImageBitmap; }
});

test('贴图采样分辨率不低于屏幕需求，动画图片不被当成静态缓存', () => {
  for (const scale of [.01, .1, .3, .8, 1, 3]) { assert.ok(textureScale(scale) >= Math.min(scale, 1)); assert.ok(textureScale(scale) <= 1); }
  assert.equal(animatedImage('image.gif', new Uint8Array()), true);
  const bytes = png(10, 10); assert.equal(animatedImage('image.png', bytes), false);
  new DataView(bytes.buffer).setUint32(12, 0x6163544c); assert.equal(animatedImage('image.png', bytes), true);
});

test('背景模糊只在图片、缩放、DPI、尺寸或模糊值变化时重算；动画背景持续更新', () => {
  const original = globalThis.document; let paints = 0;
  const target = { setTransform() {}, drawImage() { paints++; } };
  globalThis.document = { createElement: () => ({ getContext: () => target }) };
  try {
    const cache = new PreviewBackground(); const context = { drawImage() {} }; const image = { naturalWidth: 1920, naturalHeight: 1080 };
    cache.draw(context, image, 900, 600, 1, 10, 1); cache.draw(context, image, 900, 600, 1, 10, 1); assert.equal(paints, 1);
    cache.draw(context, image, 900, 600, 1, 20, 1); assert.equal(paints, 2);
    cache.draw(context, image, 900, 600, .5, 20, 1); assert.equal(paints, 3);
    cache.draw(context, image, 900, 600, .5, 20, 2); assert.equal(paints, 4);
    cache.draw(context, image, 800, 600, .5, 20, 2); assert.equal(paints, 5);
    cache.draw(context, { ...image }, 800, 600, .5, 20, 2); assert.equal(paints, 6);
    cache.draw(target, image, 800, 600, .5, 20, 2, true); cache.draw(target, image, 800, 600, .5, 20, 2, true); assert.equal(paints, 8);
  } finally { if (original) globalThis.document = original; else delete globalThis.document; }
});

test('贴图裁剪考虑锚点、旋转和负缩放，边缘仍保留', () => {
  const texture = { naturalWidth: 400, naturalHeight: 40 }; const line = { anchor: [0, 1] };
  const state = { x: 1000, y: 0, rotation: 0, scaleX: 1, scaleY: 1 };
  const viewport = { left: 0, top: 0, width: 600, height: 400 };
  const visible = next => textureInViewport(texture, line, { ...state, ...next }, 600, 400, 1, viewport);
  assert.equal(visible({}), false); assert.equal(visible({ x: 300 }), true);
  assert.equal(visible({ x: 500, scaleX: -1 }), true);
  assert.equal(visible({ x: 500, rotation: 180 }), true);
  assert.equal(visible({ x: 350, rotation: 90 }), false);
});
