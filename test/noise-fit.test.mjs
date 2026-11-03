import test from 'node:test';
import assert from 'node:assert/strict';
import { binaryNoiseMask, fitNoiseRectangles, orderedNoiseRectangles, noiseAppearanceOffsets, NOISE_REVEALS } from '../src/core/noise-fit.mjs';
import { easing } from '../src/core/easing.mjs';
import { fittedNoiseAreas, noiseFitChart } from '../src/application/noise-fit.mjs';
import { createChart, assertChart, serializeChart, parseChart } from '../src/core/chart.mjs';
import { createNoiseArea, noiseRuntime } from '../src/core/noise-areas.mjs';
import { EditorSession } from '../src/application/session.mjs';
import { TempoMap } from '../src/core/tempo.mjs';
import { beatValue } from '../src/core/beat.mjs';
import { NoiseFitPanel } from '../src/ui/noise-fit.mjs';
import { previewNoiseGeometry } from '../src/core/editor-display.mjs';

const defaults = { first: 4, last: 8, duration: 6, width: 800, x: 100, y: -80, rotation: 0, layerId: 'default', reveal: 'left', easingType: 1 };
function raster(rows) { return { mask: Uint8Array.from(rows.join(''), Number), width: rows[0].length, height: rows.length }; }
function fit(rows, options) { const { mask, width, height } = raster(rows); return fitNoiseRectangles(mask, width, height, options); }

test('二值化深色、浅色、不透明度及反选均保留透明背景', () => {
  const pixels = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 0, 50, 50, 50, 100]);
  assert.deepEqual([...binaryNoiseMask(pixels, 4, 1)], [1, 0, 0, 1]);
  assert.deepEqual([...binaryNoiseMask(pixels, 4, 1, { polarity: 'light' })], [0, 1, 0, 0]);
  assert.deepEqual([...binaryNoiseMask(pixels, 4, 1, { polarity: 'alpha' })], [1, 1, 0, 0]);
  assert.deepEqual([...binaryNoiseMask(pixels, 4, 1, { invert: true })], [0, 1, 0, 0]);
});

test('矩形完整覆盖二值图案且不重叠、不填孔，裁切与合并保持形状', () => {
  const rows = ['00000000', '01111100', '01000100', '01000100', '01111100', '00000000'];
  const { mask, width, height } = raster(rows);
  for (const merge of [true, false]) for (const trim of [true, false]) for (const maxSpan of [1, 3, 16]) {
    const result = fitNoiseRectangles(mask, width, height, { merge, trim, maxSpan });
    const restored = new Uint8Array(mask.length);
    for (const rectangle of result.rectangles) for (let y = rectangle.y; y < rectangle.y + rectangle.height; y++) for (let x = rectangle.x; x < rectangle.x + rectangle.width; x++) {
      const index = (y + result.bounds.y) * width + x + result.bounds.x;
      assert.equal(restored[index], 0); restored[index] = 1;
    }
    assert.deepEqual(restored, mask); assert.equal(result.pixels, 14);
  }
  assert.equal(fit(['111111', '111111', '111111'], { maxSpan: 512 }).rectangles.length, 1);
  assert.equal(fit(['111111', '111111', '111111'], { merge: false }).rectangles.length, 18);
});

test('不同浮现方式保持相同几何与数量，方向、随机种子可预测', () => {
  const result = fit(['10101', '01010', '10101'], { merge: false });
  for (const [mode] of NOISE_REVEALS) {
    const sorted = orderedNoiseRectangles(result, mode, 42); assert.equal(sorted.length, result.rectangles.length);
    assert.deepEqual(new Set(sorted), new Set(result.rectangles));
  }
  const left = orderedNoiseRectangles(result, 'left'); const right = orderedNoiseRectangles(result, 'right');
  assert.ok(left[0].x < left.at(-1).x); assert.ok(right[0].x > right.at(-1).x);
  assert.deepEqual(orderedNoiseRectangles(result, 'random', 12), orderedNoiseRectangles(result, 'random', 12));
  assert.notDeepEqual(orderedNoiseRectangles(result, 'random', 12), orderedNoiseRectangles(result, 'random', 13));
});

test('生成按缓动分配出生拍并保证相同寿命，激活区间相对各块出生拍', () => {
  const result = fit(['10101'], { merge: false });
  const areas = fittedNoiseAreas(result, { ...defaults, activeStart: 1, activeEnd: 5 });
  assert.deepEqual(areas.map(area => beatValue(area.appearTime)), [4, 6, 8]);
  for (const area of areas) {
    const start = beatValue(area.appearTime);
    assert.equal(beatValue(area.disappearTime) - start, 6);
    assert.equal(beatValue(area.activeIntervals[0].startTime) - start, 1);
    assert.equal(beatValue(area.activeIntervals[0].endTime) - start, 5);
    assert.equal(area.activeIntervals[0].readyFlash, 0.5);
  }
  const quad = fittedNoiseAreas(result, { ...defaults, easingType: 5 });
  assert.ok(Math.abs(beatValue(quad[1].appearTime) - (4 + 4 * Math.sqrt(0.5))) < 1 / 19200);
  assert.ok(fittedNoiseAreas(result, { ...defaults, first: 2, last: 2 }).every(area => beatValue(area.appearTime) === 2));
  assert.ok(fittedNoiseAreas(result, { ...defaults, active: false }).every(area => area.activeIntervals.length === 0));
});

test('出现缓动控制随时间出现的数量比例：Out 先快后慢，In 先慢后快', () => {
  const rectangles = Array.from({ length: 101 }, (_, x) => ({ x, y: 0, width: 1, height: 1 }));
  const result = { rectangles, width: 101, height: 1 };
  const counts = type => {
    const areas = fittedNoiseAreas(result, { ...defaults, first: 0, last: 4, duration: 10, easingType: type });
    return [1, 2, 3, 4].map(beat => areas.filter(area => beatValue(area.appearTime) <= beat).length);
  };
  assert.deepEqual(counts(1), [26, 51, 76, 101]);
  assert.deepEqual(counts(4), [44, 76, 94, 101]);
  assert.deepEqual(counts(5), [7, 26, 57, 101]);
  for (const type of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 22]) {
    const offsets = noiseAppearanceOffsets(101, type);
    for (let index = 1; index < 100; index++) assert.ok(Math.abs(easing(offsets[index], type) - index / 100) < 1e-6, `curve ${type}, rectangle ${index}`);
  }
});

test('全部出现缓动保留首尾时间和空间顺序，回弹与弹性使用首次达到的时刻', () => {
  for (let type = 1; type <= 29; type++) {
    const offsets = noiseAppearanceOffsets(201, type);
    assert.equal(offsets[0], 0); assert.equal(offsets.at(-1), 1);
    for (let index = 1; index < offsets.length; index++) assert.ok(offsets[index] >= offsets[index - 1] && offsets[index] <= 1);
  }
  const bounce = noiseAppearanceOffsets(101, 26);
  assert.ok(bounce[90] < 0.5, '90% is first crossed before the later bounce dips');
  assert.deepEqual([...noiseAppearanceOffsets(1, 4)], [0]);
  assert.deepEqual([...noiseAppearanceOffsets(2, 4)], [0, 1]);
});

test('整体顺时针旋转绕图案中心，块自身旋转绕各自中心，层和其他对象保留', () => {
  const result = fit(['101'], { merge: false });
  const areas = fittedNoiseAreas(result, { ...defaults, x: 0, y: 0, width: 600, rotation: 90, layerId: 'picture' });
  const chart = createChart(); chart.noiseAreaLayers = [{ id: 'default', name: '默认层' }, { id: 'picture', name: '图案' }];
  chart.blockAreaList = [createNoiseArea(0, 30)]; const next = noiseFitChart(chart, areas); assertChart(next);
  assert.equal(next.blockAreaList[0], chart.blockAreaList[0]); assert.equal(next.judgeLineList, chart.judgeLineList);
  const tempo = new TempoMap(chart.BPMList); const first = noiseRuntime(areas[0], tempo).sample(tempo.seconds(4));
  assert.ok(Math.abs(first.center.x) < 1e-10); assert.ok(first.center.y > 0);
  assert.ok(first.points.every(point => Math.abs(point.x) <= 100.000001));
  assert.equal(first.rotation, Math.PI / 2); assert.equal(areas[0].layerId, 'picture');
  assert.equal(next.META.RPEVersion, 230);
});

test('一次生成可整体撤销重做，JSON 往返保持普通噪域结构', () => {
  const result = fit(['111', '101', '111']); const areas = fittedNoiseAreas(result, { ...defaults, rotation: 45 });
  const session = new EditorSession(); const original = session.chart;
  session.commit('噪域图案生成', noiseFitChart(original, areas)); const generated = session.chart;
  assert.equal(session.history.undoStack.length, 1); assert.equal(generated.blockAreaList.length, areas.length);
  session.travel('undo'); assert.equal(session.chart, original);
  session.travel('redo'); assert.equal(session.chart, generated);
  const restored = parseChart(serializeChart(generated));
  assert.deepEqual(restored.blockAreaList, generated.blockAreaList);
});

test('空图案、非法时间、激活范围与已删除的目标层不会写入谱面', () => {
  assert.throws(() => fit(['000', '000']), /没有/);
  const result = fit(['101']);
  for (const bad of [{ last: 1 }, { duration: 0 }, { activeStart: -1 }, { activeEnd: 7 }, { easingType: 30 }, { width: NaN }]) assert.throws(() => fittedNoiseAreas(result, { ...defaults, ...bad }));
  assert.throws(() => noiseFitChart(createChart(), fittedNoiseAreas(result, { ...defaults, layerId: 'deleted' })), /目标噪域层/);
});

function layoutPanel(ratio) {
  const panel = Object.create(NoiseFitPanel.prototype);
  panel.fit = fit(['11']); panel.options = { ...defaults, first: 0, last: 0, rotation: 37 };
  panel.overlay = { getBoundingClientRect: () => ({ width: 960, height: 640, left: 0, top: 0 }), setPointerCapture() {} };
  panel.renderer = { aspectRatio: ratio, viewDivisor: 1.3 }; panel.previewChart = {}; panel.dragFrame = 1; panel.syncControls = () => {};
  return panel;
}

test('图案拟合的旋转布局轮廓随比例适配，与生成噪域的渲染坐标一致', () => {
  const tempo = new TempoMap([{ startTime: [0, 0, 1], bpm: 120 }]);
  for (const ratio of [1.5, 16 / 9, 4 / 3, 9 / 16]) {
    const panel = layoutPanel(ratio), layout = panel.layout(panel.renderer);
    const area = fittedNoiseAreas(panel.fit, panel.options)[0], sample = noiseRuntime(area, tempo).sample(0);
    for (const point of previewNoiseGeometry(sample, layout.positionScale).points) {
      const horizontal = 480 + point.x * layout.scale, vertical = 320 - point.y * layout.scale;
      assert.ok(layout.corners.some(corner => Math.hypot(corner.x - horizontal, corner.y - vertical) < 1e-7));
    }
  }
});

test('不同比例下图案布局拖动、旋转及缩放反算均保留原坐标单位', () => {
  const pointer = point => ({ clientX: point.x, clientY: point.y, button: 0, pointerId: 1, preventDefault() {}, stopPropagation() {} });
  for (const ratio of [16 / 9, 4 / 3, 9 / 16]) for (const kind of ['move', 'scale', 'rotate']) {
    const panel = layoutPanel(ratio), layout = panel.layout(panel.renderer), original = { ...panel.options };
    const start = kind === 'move' ? layout.center : kind === 'scale' ? layout.resize : layout.rotate;
    panel.down(pointer(start)); assert.equal(panel.drag.kind, kind);
    let target;
    if (kind === 'move') target = { x: start.x + 100 * layout.scale * layout.positionScale.x, y: start.y - 70 * layout.scale * layout.positionScale.y };
    else if (kind === 'scale') target = { x: layout.center.x + (start.x - layout.center.x) * 2, y: layout.center.y + (start.y - layout.center.y) * 2 };
    else {
      const horizontal = start.x - layout.center.x, vertical = start.y - layout.center.y, angle = Math.PI / 4;
      target = { x: layout.center.x + horizontal * Math.cos(angle) - vertical * Math.sin(angle), y: layout.center.y + horizontal * Math.sin(angle) + vertical * Math.cos(angle) };
    }
    panel.move(pointer(target));
    if (kind === 'move') { assert.equal(panel.options.x, original.x + 100); assert.equal(panel.options.y, original.y + 70); }
    else if (kind === 'scale') assert.ok(Math.abs(panel.options.width - original.width * 2) < 1e-7);
    else assert.equal(panel.options.rotation, original.rotation + 45);
  }
});

test('多块图案的布局框包住按各自中心缩放的真实噪域，播放中复用边界缓存', () => {
  const tempo = new TempoMap([{ startTime: [0, 0, 1], bpm: 120 }]);
  for (const ratio of [16 / 9, 4 / 3, 9 / 16]) for (const rotation of [0, 37, -80, 145]) {
    const panel = layoutPanel(ratio); panel.fit = fit(['1011', '0110', '1101']); panel.options.rotation = rotation;
    const layout = panel.layout(panel.renderer), cache = panel.layoutBounds, angle = rotation * Math.PI / 180;
    const local = point => { const x = point.x - layout.center.x, y = point.y - layout.center.y; return { x: x * Math.cos(angle) + y * Math.sin(angle), y: -x * Math.sin(angle) + y * Math.cos(angle) }; };
    const box = layout.corners.map(local), points = fittedNoiseAreas(panel.fit, panel.options).flatMap(area => previewNoiseGeometry(noiseRuntime(area, tempo).sample(0), layout.positionScale).points).map(point => local({ x: 480 + point.x * layout.scale, y: 320 - point.y * layout.scale }));
    for (const axis of ['x', 'y']) {
      assert.ok(Math.abs(Math.min(...points.map(point => point[axis])) - Math.min(...box.map(point => point[axis]))) < 1e-7);
      assert.ok(Math.abs(Math.max(...points.map(point => point[axis])) - Math.max(...box.map(point => point[axis]))) < 1e-7);
    }
    panel.options.width *= 1.1; panel.options.x += 20; panel.layout(panel.renderer); assert.equal(panel.layoutBounds, cache);
  }
});
