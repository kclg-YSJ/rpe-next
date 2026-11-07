import test from 'node:test';
import assert from 'node:assert/strict';
import { previewNoteHit } from '../src/core/preview-note-hit.mjs';
import { Preview } from '../src/ui/preview.mjs';
import { RpeSkin } from '../src/ui/skin.mjs';
import { ResourceNoteSkin } from '../src/ui/resource-note-skin.mjs';
import { createChart, createEvent, createNote } from '../src/core/chart.mjs';
import { TempoMap } from '../src/core/tempo.mjs';
import { CameraProjection } from '../assets/mods/spatial-camera/projection.mjs';

const image = (width, height) => ({ naturalWidth: width, naturalHeight: height });
const pointer = (area, x, y) => ({ x: area.x1 + x * Math.cos(area.rotation) - y * Math.sin(area.rotation), y: area.y1 + x * Math.sin(area.rotation) + y * Math.cos(area.rotation) });
const shape = (change = {}) => ({ lineIndex: 3, noteIndex: 4, type: 1, x1: 300, y1: 200, x2: 300, y2: 200, rotation: Math.PI / 4, pickWidth: 200, pickHeightWidth: 200, pickSkew: 0, pickHighlight: false, pickShowHead: true, pickSide: 1, ...change });
const skin = { noteImage: () => image(1000, 50) };

test('旋转音符以实际长宽判定，不再用宽度半径吞掉周围的判定线，左右端仍能点中', () => {
  const area = shape();
  for (const x of [-99, 0, 99]) assert.equal(previewNoteHit(area, pointer(area, x, 0), skin), true);
  for (const p of [[0, 40], [0, -40], [115, 0], [-115, 0]]) assert.equal(previewNoteHit(area, pointer(area, ...p), skin), false);
  assert.equal(previewNoteHit(area, pointer(area, 0, 8), skin), true);
});

test('独立宽度、纵向尺寸、倾斜及高亮皮肤比例沿用绘制几何', () => {
  const area = shape({ pickWidth: 40, pickHeightWidth: 400, pickSkew: 2 });
  assert.equal(previewNoteHit(area, pointer(area, 35, 8), skin, 0), true);
  assert.equal(previewNoteHit(area, pointer(area, -15, 8), skin, 0), false);
  assert.equal(previewNoteHit(area, pointer(area, 0, 15), skin, 0), false);
  const tallSkin = { resourcePack: {}, noteImage: (_type, highlight) => image(100, highlight ? 100 : 20) };
  const tall = shape({ pickHighlight: true });
  assert.equal(previewNoteHit(tall, pointer(tall, 90, 90), tallSkin, 0), true);
  assert.equal(previewNoteHit({ ...tall, pickHighlight: false }, pointer(tall, 90, 90), tallSkin, 0), false);
});

function holdRecorder() {
  let matrix = { x: 0, y: 0, sx: 1, sy: 1 }; const stack = [], rectangles = [];
  return { rectangles,
    save() { stack.push({ ...matrix }); }, restore() { matrix = stack.pop(); },
    translate(x, y) { matrix.x += matrix.sx * x; matrix.y += matrix.sy * y; }, scale(x, y) { matrix.sx *= x; matrix.sy *= y; },
    drawImage(_picture, ...args) { const [x, y, width, height] = args.length === 8 ? args.slice(4) : args; const left = matrix.x + matrix.sx * x, top = matrix.y + matrix.sy * y; rectangles.push({ left: Math.min(left, left + matrix.sx * width), right: Math.max(left, left + matrix.sx * width), top: Math.min(top, top + matrix.sy * height), bottom: Math.max(top, top + matrix.sy * height) }); },
  };
}

test('Hold 的头身尾命中范围与默认及资源皮肤实际绘制一致，覆盖反向、零速和紧凑模式', () => {
  const normal = new RpeSkin(() => {});
  for (const [name, width, height] of [['Hold3', 100, 400], ['HoldHL', 100, 400], ['HoldHead', 120, 10], ['HoldHeadHL', 120, 10], ['HoldEnd', 100, 15]]) normal.images.set(name, image(width, height));
  const packs = [normal];
  for (const compact of [false, true]) for (const keep of [false, true]) {
    const info = { holdAtlas: [15, 10], holdAtlasMH: [15, 10], holdCompact: compact, holdKeepHead: keep, holdRepeat: false };
    const pictures = new Map([['click.png', image(100, 10)], ['click_mh.png', image(150, 15)], ['hold.png', image(100, 400)], ['hold_mh.png', image(100, 400)]]);
    const pack = new ResourceNoteSkin({ id: 'test', info }, pictures, (_key, picture) => picture);
    const wrapper = new RpeSkin(() => {}); wrapper.setResourcePack(pack); packs.push(wrapper);
  }
  for (const renderer of packs) for (const tail of [-150, 0, 150]) for (const side of [-1, 1]) for (const showHead of [false, true]) for (const highlighted of [false, true]) {
    const context = holdRecorder(), factor = renderer.noteScale(highlighted);
    renderer.hold(context, 0, 0, tail, 50, highlighted, showHead, undefined, 100, side);
    const area = shape({ type: 2, pickWidth: 50 * factor, pickHeightWidth: 100 * factor, pickHighlight: highlighted, pickShowHead: showHead, pickSide: side });
    const end = pointer(area, 0, tail); area.x2 = end.x; area.y2 = end.y;
    for (const [x, y] of [[0, -200], [0, -155], [0, -150], [0, -75], [0, 0], [0, 5], [0, 75], [0, 150], [0, 155], [0, 200], [24, 0], [30, 0], [60, 0]]) {
      const expected = context.rectangles.some(r => x > r.left + .01 && x < r.right - .01 && y > r.top + .01 && y < r.bottom - .01);
      const boundary = context.rectangles.some(r => Math.abs(x-r.left)<.01 || Math.abs(x-r.right)<.01 || Math.abs(y-r.top)<.01 || Math.abs(y-r.bottom)<.01);
      if (!boundary) assert.equal(previewNoteHit(area, pointer(area, x, y), renderer, 0), expected, JSON.stringify({ tail, side, showHead, highlighted, x, y, rectangles: context.rectangles }));
    }
  }
});

test('预览点击反向遍历保持顶层优先、不复制命中列表且兼容既有工具命中数据', () => {
  const preview = new Preview({ getBoundingClientRect: () => ({ left: 20, top: 30 }) });
  preview.visible = true; preview.viewport = { left: 0, top: 0, width: 800, height: 600 }; preview.skin = skin;
  const area = shape({ rotation: 0 });
  preview.noteHitAreas = [area, { ...area, lineIndex: 5 }];
  preview.noteHitAreas.slice = () => assert.fail('pointer queries must not copy all hit areas');
  assert.deepEqual(preview.pickNoteTarget(320, 230), { lineIndex: 5, noteIndex: 4 });
  assert.equal(preview.pickNoteTarget(320, 280), null);
  assert.equal(preview.pickNoteTarget(0, 230), null);
  preview.noteHitAreas = [{ lineIndex: 7, noteIndex: 2, x1: 100, y1: 50, x2: 100, y2: 350, radius: 12 }];
  assert.deepEqual(preview.pickNoteTarget(120, 230), { lineIndex: 7, noteIndex: 2 });
});

test('靠近旋转音符的可见判定线可以点选，同时音符本体仍返回其所属线', () => {
  globalThis.devicePixelRatio = 1;
  const context = new Proxy({}, { get: (target, key) => key in target ? target[key] : () => {} });
  const preview = new Preview({ getContext: () => context, getBoundingClientRect: () => ({ left: 0, top: 0, width: 900, height: 600 }) });
  const chart = createChart();
  chart.judgeLineList[0].eventLayers[0].rotateEvents = [createEvent(45)];
  chart.judgeLineList[0].notes = [createNote(4, 0, 0)];
  Object.assign(preview, { visible: true, pickPreviewLines: true, skin: { ...skin, tinted: () => null, head: () => true }, showHitEffects: false, applyShaders: false });
  preview.draw(chart, new TempoMap(chart.BPMList), 0, 0);
  const area = preview.noteHitAreas[0], offset = pointer({ ...area, rotation: Math.PI/4 }, 0, 35);
  assert.equal(preview.pickNote(offset.x, offset.y), null);
  assert.equal(preview.pickNote(area.x1, area.y1), 0);
  preview.guides = [{ index: 1, x: offset.x, y: offset.y, rotation: 100, halfWidth: 500, alpha: 100 }];
  assert.equal(preview.pick(offset.x, offset.y), 1);
});

test('三维摄像机重映射后保留投影的点击范围，不误用原平面的音符矩形', () => {
  const area = shape(), renderer = { noteHitAreas: [area] };
  Object.assign(area, { radius: 30 });
  const camera = { project: p => ({ x: p.x / 2 + 400, y: 300 - p.y / 2, depth: 10 }) };
  CameraProjection.prototype.mapHits.call({}, renderer, camera, { width: 800, height: 600, center: { x: 0, y: 0 } }, { viewport: { left: 0, top: 0, width: 800, height: 600 }, scale: 1 });
  assert.equal(area.pickWidth, undefined);
  assert.equal(previewNoteHit(area, { x: area.x1, y: area.y1 }, skin), true);
  assert.equal(previewNoteHit(area, { x: area.x1 + area.radius + 2, y: area.y1 }, skin), false);
});
