import test from 'node:test';
import assert from 'node:assert/strict';
import { createChart, createNote, createEvent, assertChart, serializeChart, parseChart } from '../src/core/chart.mjs';
import { TempoMap } from '../src/core/tempo.mjs';
import { LineRuntime } from '../src/core/scene.mjs';
import { EditorSession } from '../src/application/session.mjs';
import { LinePanel } from '../src/ui/line-panel.mjs';
import { Preview } from '../src/ui/preview.mjs';
import { RpeSkin } from '../src/ui/skin.mjs';
import { ResourceNoteSkin } from '../src/ui/resource-note-skin.mjs';
import { parseNoteSkin } from '../src/core/note-skin.mjs';
import { noteSkinFixture } from './fixtures/note-skin.mjs';
import { textureInViewport } from '../src/ui/preview-background.mjs';

const input = value => ({ value: String(value) });
const context = () => new Proxy({ calls: [], measureText: text => ({ width: text.length * 20, fontBoundingBoxAscent: 40, fontBoundingBoxDescent: 10 }) }, { get(target, key) {
  return key in target ? target[key] : (...args) => target.calls.push({ method: key, args });
} });
const destinations = context => context.calls.filter(call => call.method === 'drawImage').map(call => call.args.slice(-4));

test('音符 size 只改变宽度，sizeControl 仍影响两轴而 Hold 头尾高度与长度不受 size 影响', () => {
  const chart = createChart(), line = chart.judgeLineList[0];
  line.sizeControl = [{ x: 0, size: 2 }, { x: 100, size: 2, easing: 1 }];
  line.notes = [1, 2, 3, 4].flatMap(type => [0.5, 2].map(size => ({ ...createNote(type, 4, 0, 8), size })));
  const runtime = new LineRuntime(line, new TempoMap(chart.BPMList)), state = runtime.state(0);
  for (let index = 0; index < runtime.notes.length; index += 2) {
    const first = runtime.noteState(runtime.notes[index], state, 0), second = runtime.noteState(runtime.notes[index + 1], state, 0);
    assert.equal(second.size, first.size * 4); assert.equal(second.sizeY, first.sizeY);
    assert.equal(first.sizeY, runtime.notes[index].note.type === 2 ? 1 : 2);
    assert.equal(first.y, second.y); assert.equal(first.tail, second.tail);
  }
});

test('默认皮肤和导入皮肤分别控制音符宽度与贴图高度，Hold 头尾与重复身体保持高度基准', () => {
  const skin = new RpeSkin(() => {});
  for (const [name, width, height] of [['Tap2', 100, 20], ['Hold', 100, 100], ['HoldHead', 120, 20], ['HoldEnd', 100, 10]]) skin.images.set(name, { name, naturalWidth: width, naturalHeight: height });
  const first = context(), second = context();
  skin.head(first, 1, 0, 0, 40, false, undefined, 0, 80); skin.head(second, 1, 0, 0, 120, false, undefined, 0, 80);
  assert.equal(destinations(first)[0][3], 16); assert.equal(destinations(second)[0][3], 16);
  assert.equal(destinations(second)[0][2], 120);
  first.calls = []; second.calls = [];
  skin.hold(first, 0, 0, -100, 40, false, true, undefined, 80); skin.hold(second, 0, 0, -100, 120, false, true, undefined, 80);
  assert.deepEqual(destinations(first).map(rect => rect[3]), destinations(second).map(rect => rect[3]));
  assert.deepEqual(destinations(second).map(rect => rect[3]), [100, 8, 16]);
  const record = parseNoteSkin(noteSkinFixture()), pack = new ResourceNoteSkin(record, new Map([['click.png', { naturalWidth: 160, naturalHeight: 64 }], ['hold.png', { naturalWidth: 160, naturalHeight: 300 }]]), (_, picture) => picture);
  skin.setResourcePack(pack); first.calls = []; second.calls = [];
  skin.head(first, 1, 0, 0, 40, false, undefined, 0, 80); skin.head(second, 1, 0, 0, 120, false, undefined, 0, 80);
  assert.equal(destinations(first)[0][3], 32); assert.equal(destinations(second)[0][3], 32);
  for (const compact of [false, true]) {
    pack.info = { ...pack.info, holdCompact: compact }; first.calls = []; second.calls = [];
    skin.hold(first, 0, 0, -100, 40, false, true, undefined, 80); skin.hold(second, 0, 0, -100, 120, false, true, undefined, 80);
    assert.deepEqual(destinations(first).map(rect => [rect[1], rect[3]]), destinations(second).map(rect => [rect[1], rect[3]]));
  }
});

test('判定线面板按 BPM 倍率倒数写入，锚点支持屏外值并可撤销，未编辑倍率不损失精度', () => {
  const session = new EditorSession(), panel = new LinePanel({}, () => session);
  const values = { name: input('Line'), parent: input(-1), group: input(0), zOrder: input(0), bpmfactor: input(2), texture: input('line.png'), isCover: true, rotateWithFather: true, anchorX: input(-0.25), anchorY: input(1.5) };
  panel.applyLine(values);
  assert.equal(session.line.bpmfactor, 0.5); assert.deepEqual(session.line.anchor, [-0.25, 1.5]);
  const tempo = new TempoMap(session.chart.BPMList);
  assert.equal(tempo.seconds(4, session.line.bpmfactor), 1); assert.equal(tempo.beat(1, session.line.bpmfactor), 4);
  assert.deepEqual(parseChart(serializeChart(session.chart)).judgeLineList[0].anchor, [-0.25, 1.5]);
  session.history.undo(); assert.equal(session.line.bpmfactor, 1); assert.deepEqual(session.line.anchor, [0.5, 0.5]);
  const factor = 3.141592653589793; session.chart.judgeLineList[0].bpmfactor = factor;
  values.bpmfactor = input(1 / factor); panel.applyLine(values); assert.equal(session.line.bpmfactor, factor);
  values.bpmfactor = input(0); assert.throws(() => panel.applyLine(values), /BPM/);
  values.bpmfactor = input(1); values.anchorX = input(''); assert.throws(() => panel.applyLine(values), /锚点/);
});

test('默认线、图片和多行文字共用左下原点锚点，旋转缩放仍围绕判定位置', () => {
  globalThis.devicePixelRatio = 1;
  const preview = new Preview({}), line = createChart().judgeLineList[0], picture = { naturalWidth: 100, naturalHeight: 60 };
  preview.lineScale = 1; preview.skin = { tinted: () => picture, tintedSource: (_, source) => source };
  preview.images = { images: new Map([['picture.png', picture]]) };
  const state = { scaleX: -2, scaleY: 3, alpha: 255, color: [255, 255, 255], text: 'AB\nC' };
  for (const anchor of [[0, 1], [1, 0], [-0.25, 1.5]]) {
    const draw = context(); line.anchor = anchor;
    preview.drawLine(draw, line, state, 2);
    assert.deepEqual(destinations(draw)[0], [-8000 * anchor[0], -10 * (1 - anchor[1]), 8000, 10]);
    assert.deepEqual(draw.calls.find(call => call.method === 'scale').args, [-2, 3]);
    draw.calls = []; preview.drawLine(draw, { ...line, Texture: 'picture.png' }, state, 2);
    assert.deepEqual(destinations(draw)[0], [-200 * anchor[0], -120 * (1 - anchor[1]), 200, 120]);
    draw.calls = []; preview.drawLine(draw, { ...line, extended: { textEvents: [createEvent('AB\nC')] } }, state, 2);
    assert.deepEqual(draw.calls.filter(call => call.method === 'fillText').map(call => call.args), [['AB', -80 * anchor[0], -200 * (1 - anchor[1]) + 80], ['C', -80 * anchor[0], -200 * (1 - anchor[1]) + 180]]);
  }
  const view = { left: 0, top: 0, width: 200, height: 200 };
  assert.equal(textureInViewport(picture, { anchor: [1, 0.5] }, { x: 150, y: 0, scaleX: 2, scaleY: 1, rotation: 0 }, 200, 200, 1, view), true);
  assert.equal(textureInViewport(picture, { anchor: [0, 0.5] }, { x: 150, y: 0, scaleX: 2, scaleY: 1, rotation: 0 }, 200, 200, 1, view), false);
});

test('Y 缩放事件按谱面尺寸绘制，默认线粗细仅辅助没有缩放事件的线', () => {
  globalThis.devicePixelRatio = 1;
  const preview = new Preview({}), line = createChart().judgeLineList[0], picture = { naturalWidth: 4000, naturalHeight: 5 };
  preview.lineScale = 1.5; preview.skin = { tinted: () => picture, tintedSource: (_, source) => source };
  const state = { scaleX: 1, scaleY: 20, alpha: 255, color: [0, 255, 0] };
  const scaled = context();
  preview.drawLine(scaled, { ...line, extended: { scaleYEvents: [createEvent(20)] } }, state, 1);
  assert.deepEqual(destinations(scaled)[0], [-2000, -2.5, 4000, 5]);
  const plain = context();
  preview.drawLine(plain, { ...line, extended: {} }, { ...state, scaleY: 1 }, 1);
  assert.deepEqual(destinations(plain)[0], [-2000, -3.75, 4000, 7.5]);
});

test('锚点校验拒绝无效格式，省略时仍默认中心而非改变老谱结构', () => {
  const chart = createChart(); delete chart.judgeLineList[0].anchor; assertChart(chart);
  assert.equal(Object.hasOwn(parseChart(serializeChart(chart)).judgeLineList[0], 'anchor'), false);
  for (const anchor of [[0.5], [0, Infinity], { x: 0.5, y: 0.5 }]) { chart.judgeLineList[0].anchor = anchor; assert.throws(() => assertChart(chart), /anchor/); }
});
