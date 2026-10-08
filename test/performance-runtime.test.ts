import test from 'node:test';
import assert from 'node:assert/strict';
import { createChart, createLine, createEvent, createNote } from '../src/core/chart.ts';
import { TempoMap } from '../src/core/tempo.ts';
import { SpeedIntegral } from '../src/core/events.ts';
import { SceneRuntime } from '../src/core/scene.ts';
import { TimelineActivity } from '../src/core/timeline-activity.ts';
import { IntervalIndex } from '../src/core/interval-index.ts';
import { ProjectImages, textureScale, animatedImage } from '../src/platform/images.ts';
import { PreviewBackground, textureInViewport } from '../src/ui/preview-background.ts';
import type { SpeedSegment } from '../src/core/events.ts';
import type { DecodedImage, TextureRecord } from '../src/platform/images.ts';
import type { PreviewViewport } from '../src/core/editor-display.ts';

/**
 * The image shape the preview paths accept.
 *
 * `PreviewImage` is declared but not exported by `preview-background.ts`, so it is taken from
 * `draw`'s own parameter list rather than redeclared — that keeps this test in step if the
 * production shape changes.
 */
type PreviewImage = Parameters<PreviewBackground['draw']>[1];

test('积分快路径与原 Simpson 积分在常值、线性、Bezier、空隙和负时间保持一致', () => {
  class ReferenceIntegral extends SpeedIntegral {
    // `integrate` is overridden to recompute the same integral by Simpson's rule, so the signature
    // has to match the base class exactly, `override` included.
    override integrate(segment: SpeedSegment, end: number): number {
      if (!segment.entry) return 0;
      const step = (end - segment.start) / 20; let sum = 0;
      for (let index = 0; index <= 20; index++) sum += (index === 0 || index === 20 ? 1 : index % 2 ? 4 : 2) * Number(this.sample(segment.entry, segment.start + step * index));
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
  const expected = scene.sample(.5); const visited: number[] = [];
  scene.lines.forEach((runtime, index) => { const state = runtime.state.bind(runtime); runtime.state = seconds => { visited.push(index); return state(seconds); }; });
  const sample = scene.sampler(.5);
  assert.deepEqual(sample(3), expected[3]); assert.deepEqual(sample(4), expected[4]); sample(3);
  assert.deepEqual(visited, [3, 1, 4]);
  const changed = { ...chart, judgeLineList: [...chart.judgeLineList] };
  changed.judgeLineList[1] = { ...chart.judgeLineList[1], eventLayers: [{ moveXEvents: [createEvent(220)] }] };
  scene.compile(changed, tempo);
  // `sampler` reports `undefined` only for an index outside the compiled lines; index 3 exists.
  const resampled = scene.sampler(.5)(3);
  if (!resampled) throw new Error('重新编译后缺少线 3');
  assert.equal(resampled.x, 220);
});

test('密度缓存只统计当前线与当前层；切线、编辑、BPM、尺寸和音频时长更新缓存', () => {
  const chart = createChart(); chart.judgeLineList.push(createLine());
  chart.judgeLineList[0].notes = [createNote(1, 2, 0)]; chart.judgeLineList[1].notes = [createNote(2, 10, 0, 20)];
  const tempo = new TempoMap(chart.BPMList); const activity = new TimelineActivity(); activity.compile(chart, tempo);
  const first = activity.density(0, 0, false, 12, 400);
  assert.equal(first.noteBins.reduce((sum, count) => sum + count, 0), 1);
  assert.equal(first.eventBins.reduce((sum, count) => sum + count, 0), 5);
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

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(40); const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x89504e47); view.setUint32(4, 0x0d0a1a0a); view.setUint32(8, 13); view.setUint32(12, 0x49484452); view.setUint32(16, width); view.setUint32(20, height);
  return bytes;
}

/**
 * `ProjectImages.describe`/`texture` are lookups that report absence with `undefined`/`null`.
 *
 * Every call below refers to a texture the test itself just registered, so a miss means the loader
 * lost it — the helpers turn that into a loud failure instead of a silently passing assertion.
 */
function recordOf(images: ProjectImages, name: string): TextureRecord {
  const record = images.describe(name);
  if (!record) throw new Error(`没有贴图记录 ${name}`);
  return record;
}

function textureOf(images: ProjectImages, name: string, scale = 1): DecodedImage {
  const texture = images.texture(name, scale);
  if (!texture) throw new Error(`贴图 ${name} 未解码`);
  return texture;
}

test('贴图按需加载，最多同时解码两张，保留原坐标尺寸并释放过期位图', async () => {
  const original = globalThis.createImageBitmap; let active = 0; let maximum = 0; let decoded = 0; let closed = 0;
  // `createImageBitmap` is an overloaded global, so the stub is declared with its single-argument
  // shape and installed through one conversion rather than reimplementing both overloads.
  const decodeStub = async (_blob: ImageBitmapSource, options?: ImageBitmapOptions): Promise<ImageBitmap> => {
    active++; maximum = Math.max(maximum, active); decoded++; await new Promise(resolve => setTimeout(resolve, 1)); active--;
    // The loader only reads `width`/`height` off the bitmap and calls `close()`; the stub stands in
    // for a real decoder result that cannot be constructed here.
    return { width: options?.resizeWidth, height: options?.resizeHeight, close() { closed++; } } as unknown as ImageBitmap;
  };
  globalThis.createImageBitmap = decodeStub as typeof globalThis.createImageBitmap;
  try {
    const chart = createChart(); chart.judgeLineList = Array.from({ length: 8 }, (unused, index) => ({ ...createLine(), Texture: `${index}.png` }));
    const assets = new Map(chart.judgeLineList.map(line => [line.Texture, png(3840, 2160)]));
    const images = new ProjectImages(() => {}); await images.load(chart, assets, 'chart.json');
    assert.equal(decoded, 0);
    const pending = chart.judgeLineList.map(line => { images.texture(line.Texture, .3); return recordOf(images, line.Texture).pending; });
    await Promise.all(pending); assert.equal(maximum, 2); assert.equal(decoded, 8);
    const texture = textureOf(images, '0.png', .25);
    assert.equal(texture.naturalWidth, 3840);
    // `source` is the decoded bitmap; the loader always rasterises it at the requested scale.
    const source = texture.source as { width?: number };
    assert.equal(source.width, 1920);
    assert.equal(images.decodedBytes, 8 * 1920 * 1080 * 4);
    images.budget = 1; for (const record of images.records.values()) record.lastUsed = -10000;
    images.trim(); assert.equal(closed, 8); assert.equal(images.decodedBytes, 0);
    images.texture('1.png', 1); const loading = recordOf(images, '1.png').pending;
    images.clear(); await loading; assert.equal(images.images.size, 0); assert.equal(closed, 9);
  } finally { if (original) globalThis.createImageBitmap = original; else Reflect.deleteProperty(globalThis, 'createImageBitmap'); }
});

test('贴图采样分辨率不低于屏幕需求，动画图片不被当成静态缓存', () => {
  for (const scale of [.01, .1, .3, .8, 1, 3]) { assert.ok(textureScale(scale) >= Math.min(scale, 1)); assert.ok(textureScale(scale) <= 1); }
  assert.equal(animatedImage('image.gif', new Uint8Array()), true);
  const bytes = png(10, 10); assert.equal(animatedImage('image.png', bytes), false);
  new DataView(bytes.buffer).setUint32(12, 0x6163544c); assert.equal(animatedImage('image.png', bytes), true);
});

/**
 * The canvas contexts and images the preview paths are driven with.
 *
 * `PreviewBackground.draw` and `textureInViewport` are declared against the real DOM
 * `CanvasRenderingContext2D`/`PreviewImage`; the doubles here record calls but have no DOM backing,
 * so each is converted once at the boundary rather than by widening the production signatures.
 */
function contextStub(paints: { count: number }): CanvasRenderingContext2D {
  const target = { filter: 'none', setTransform() {}, drawImage() { paints.count++; } };
  return target as unknown as CanvasRenderingContext2D;
}

function contextSink(): CanvasRenderingContext2D {
  return { filter: 'none', setTransform() {}, drawImage() {} } as unknown as CanvasRenderingContext2D;
}

function imageStub(naturalWidth: number, naturalHeight: number): PreviewImage {
  return { naturalWidth, naturalHeight } as unknown as PreviewImage;
}

test('背景模糊只在图片、缩放、DPI、尺寸或模糊值变化时重算；动画背景持续更新', () => {
  const original = globalThis.document; const paints = { count: 0 };
  const target = contextStub(paints);
  // The cache builds its offscreen canvas through `document.createElement`, so the fake document
  // hands back a stub whose `getContext` is the recording context above.
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => target }) } as unknown as Document;
  try {
    const cache = new PreviewBackground(); const context = contextSink(); const image = imageStub(1920, 1080);
    cache.draw(context, image, 900, 600, 1, 10, 1); cache.draw(context, image, 900, 600, 1, 10, 1); assert.equal(paints.count, 1);
    cache.draw(context, image, 900, 600, 1, 20, 1); assert.equal(paints.count, 2);
    cache.draw(context, image, 900, 600, .5, 20, 1); assert.equal(paints.count, 3);
    cache.draw(context, image, 900, 600, .5, 20, 2); assert.equal(paints.count, 4);
    cache.draw(context, image, 800, 600, .5, 20, 2); assert.equal(paints.count, 5);
    cache.draw(context, imageStub(1920, 1080), 800, 600, .5, 20, 2); assert.equal(paints.count, 6);
    cache.draw(target, image, 800, 600, .5, 20, 2, true); cache.draw(target, image, 800, 600, .5, 20, 2, true); assert.equal(paints.count, 8);
  } finally { if (original) globalThis.document = original; else Reflect.deleteProperty(globalThis, 'document'); }
});

test('贴图裁剪考虑锚点、旋转和负缩放，边缘仍保留', () => {
  const texture = imageStub(400, 40); const line = { anchor: [0, 1] };
  const state = { x: 1000, y: 0, rotation: 0, scaleX: 1, scaleY: 1 };
  // `scale` is part of `PreviewViewport` but is not read by the clip test; `1` is the neutral value.
  const viewport: PreviewViewport = { scale: 1, left: 0, top: 0, width: 600, height: 400 };
  const visible = (next: Partial<typeof state>): boolean => textureInViewport(texture, line, { ...state, ...next }, 600, 400, 1, viewport);
  assert.equal(visible({}), false); assert.equal(visible({ x: 300 }), true);
  assert.equal(visible({ x: 500, scaleX: -1 }), true);
  assert.equal(visible({ x: 500, rotation: 180 }), true);
  assert.equal(visible({ x: 350, rotation: 90 }), false);
});
