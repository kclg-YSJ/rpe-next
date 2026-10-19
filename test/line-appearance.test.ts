import test from 'node:test';
import assert from 'node:assert/strict';
import { createChart, createNote, createEvent, assertChart, serializeChart, parseChart } from '../src/core/chart.ts';
import { TempoMap } from '../src/core/tempo.ts';
import { LineRuntime } from '../src/core/scene.ts';
import { EditorSession } from '../src/application/session.ts';
import { LinePanel } from '../src/ui/line-panel.ts';
import type { LineFormValues } from '../src/ui/line-panel.ts';
import { Preview } from '../src/ui/preview.ts';
import { RpeSkin } from '../src/ui/skin.ts';
import { ResourceNoteSkin } from '../src/ui/resource-note-skin.ts';
import type { NoteSkinInfo, NoteSkinRecord as ResourceNoteSkinRecord } from '../src/ui/resource-note-skin.ts';
import { parseNoteSkin } from '../src/core/note-skin.ts';
import { noteSkinFixture } from './fixtures/note-skin.ts';
import { textureInViewport } from '../src/ui/preview-background.ts';
import type { Chart, JudgeLine, NoteType } from '../src/core/types.ts';

const input = (value: unknown): { value: string } => ({ value: String(value) });

interface DrawCall { method: string | symbol; args: unknown[] }
interface DrawContext extends CanvasRenderingContext2D { calls: DrawCall[] }

function context(): DrawContext {
  const target = {
    calls: [] as DrawCall[],
    measureText: (text: string): { width: number; fontBoundingBoxAscent: number; fontBoundingBoxDescent: number } =>
      ({ width: text.length * 20, fontBoundingBoxAscent: 40, fontBoundingBoxDescent: 10 }),
  };
  return new Proxy(target, { get(store, key) {
    if (typeof key === 'string' && key in store) return (store as unknown as Record<string, unknown>)[key];
    return (...args: unknown[]): void => { store.calls.push({ method: key, args }); };
  } }) as unknown as DrawContext;
}
const destinations = (draw: DrawContext): unknown[][] => draw.calls.filter(call => call.method === 'drawImage').map(call => call.args.slice(-4));
/** `LineRuntime.noteState` computes `sizeY`, but `NoteState` does not declare it. */
const noteSizeY = (state: ReturnType<LineRuntime['noteState']>): number => (state as unknown as { sizeY: number }).sizeY;

interface Picture { name?: string; naturalWidth: number; naturalHeight: number }
type SkinImageValue = Parameters<RpeSkin['images']['set']>[1];
interface RuntimePack {
  info: NoteSkinInfo;
  noteScale(highlight?: boolean): number;
  head(context: CanvasRenderingContext2D, type: NoteType, horizontal: number, vertical: number, width: number, highlight?: boolean, color?: unknown, heightWidth?: number): boolean;
  hold(context: CanvasRenderingContext2D, horizontal: number, head: number, tail: number, width: number, highlight?: boolean, showHead?: boolean, color?: unknown, heightWidth?: number): boolean;
  dispose(): void;
}
const RuntimePack = ResourceNoteSkin as unknown as new (record: ResourceNoteSkinRecord, images: Map<string, Picture>,
  tintSource: (name: string, source: Picture | null | undefined, color: [number, number, number]) => Picture | null) => RuntimePack;

test('音符 size 只改变宽度，sizeControl 仍影响两轴而 Hold 头尾高度与长度不受 size 影响', () => {
  const chart = createChart(), line = chart.judgeLineList[0]!;
  line.sizeControl = [{ x: 0, size: 2 }, { x: 100, size: 2, easing: 1 }];
  line.notes = ([1, 2, 3, 4] as NoteType[]).flatMap(type => [0.5, 2].map(size => ({ ...createNote(type, 4, 0, 8), size })));
  const runtime = new LineRuntime(line, new TempoMap(chart.BPMList)), state = runtime.state(0);
  for (let index = 0; index < runtime.notes.length; index += 2) {
    const first = runtime.noteState(runtime.notes[index]!, state, 0), second = runtime.noteState(runtime.notes[index + 1]!, state, 0);
    assert.equal(second.size, first.size * 4); assert.equal(noteSizeY(second), noteSizeY(first));
    assert.equal(noteSizeY(first), runtime.notes[index]!.note.type === 2 ? 1 : 2);
    assert.equal(first.y, second.y); assert.equal(first.tail, second.tail);
  }
});

test('默认皮肤和导入皮肤分别控制音符宽度与贴图高度，Hold 头尾与重复身体保持高度基准', () => {
  const skin = new RpeSkin(() => {});
  for (const [name, width, height] of [['Tap2', 100, 20], ['Hold', 100, 100], ['HoldHead', 120, 20], ['HoldEnd', 100, 10]] as const) {
    skin.images.set(name, { name, naturalWidth: width, naturalHeight: height } as unknown as SkinImageValue);
  }
  const first = context(), second = context();
  skin.head(first, 1, 0, 0, 40, false, undefined, 0, 80); skin.head(second, 1, 0, 0, 120, false, undefined, 0, 80);
  assert.equal(destinations(first)[0]![3], 16); assert.equal(destinations(second)[0]![3], 16);
  assert.equal(destinations(second)[0]![2], 120);
  first.calls = []; second.calls = [];
  skin.hold(first, 0, 0, -100, 40, false, true, undefined, 80); skin.hold(second, 0, 0, -100, 120, false, true, undefined, 80);
  assert.deepEqual(destinations(first).map(rect => rect[3]), destinations(second).map(rect => rect[3]));
  assert.deepEqual(destinations(second).map(rect => rect[3]), [100, 8, 16]);
  const record = parseNoteSkin(noteSkinFixture()), pack = new RuntimePack(record as unknown as ResourceNoteSkinRecord, new Map([
    ['click.png', { naturalWidth: 160, naturalHeight: 64 }],
    ['hold.png', { naturalWidth: 160, naturalHeight: 300 }],
  ]), (_, picture) => picture ?? null);
  skin.setResourcePack(pack as unknown as Parameters<RpeSkin['setResourcePack']>[0]); first.calls = []; second.calls = [];
  skin.head(first, 1, 0, 0, 40, false, undefined, 0, 80); skin.head(second, 1, 0, 0, 120, false, undefined, 0, 80);
  assert.equal(destinations(first)[0]![3], 32); assert.equal(destinations(second)[0]![3], 32);
  for (const compact of [false, true]) {
    pack.info = { ...pack.info, holdCompact: compact }; first.calls = []; second.calls = [];
    skin.hold(first, 0, 0, -100, 40, false, true, undefined, 80); skin.hold(second, 0, 0, -100, 120, false, true, undefined, 80);
    assert.deepEqual(destinations(first).map(rect => [rect[1], rect[3]]), destinations(second).map(rect => [rect[1], rect[3]]));
  }
});

test('判定线面板按 BPM 倍率倒数写入，锚点支持屏外值并可撤销，未编辑倍率不损失精度', () => {
  const session = new EditorSession(), panel = new LinePanel({} as HTMLElement, () => session);
  const values = {
    name: input('Line'), parent: input(-1), group: input(0), zOrder: input(0), bpmfactor: input(2),
    texture: input('line.png'), isCover: true, rotateWithFather: true, anchorX: input(-0.25), anchorY: input(1.5),
  };
  panel.applyLine(values as unknown as LineFormValues);
  assert.equal(session.line!.bpmfactor, 0.5); assert.deepEqual(session.line!.anchor, [-0.25, 1.5]);
  const tempo = new TempoMap(session.chart.BPMList);
  assert.equal(tempo.seconds(4, session.line!.bpmfactor), 1); assert.equal(tempo.beat(1, session.line!.bpmfactor), 4);
  assert.deepEqual(parseChart(serializeChart(session.chart)).judgeLineList[0]!.anchor, [-0.25, 1.5]);
  session.history.undo(); assert.equal(session.line!.bpmfactor, 1); assert.deepEqual(session.line!.anchor, [0.5, 0.5]);
  const factor = 3.141592653589793; session.chart.judgeLineList[0]!.bpmfactor = factor;
  values.bpmfactor = input(1 / factor); panel.applyLine(values as unknown as LineFormValues); assert.equal(session.line!.bpmfactor, factor);
  values.bpmfactor = input(0); assert.throws(() => panel.applyLine(values as unknown as LineFormValues), /BPM/);
  values.bpmfactor = input(1); values.anchorX = input(''); assert.throws(() => panel.applyLine(values as unknown as LineFormValues), /锚点/);
});

test('默认线、图片和多行文字共用左下原点锚点，旋转缩放仍围绕判定位置', () => {
  globalThis.devicePixelRatio = 1;
  const preview = new Preview({} as HTMLCanvasElement), line = createChart().judgeLineList[0]!, picture = { naturalWidth: 100, naturalHeight: 60 };
  preview.lineScale = 1;
  preview.skin = { tinted: () => picture, tintedSource: (_: unknown, source: unknown) => source } as unknown as Preview['skin'];
  preview.images = { images: new Map([['picture.png', picture]]) } as unknown as Preview['images'];
  const state = { x: 0, y: 0, rotation: 0, scaleX: -2, scaleY: 3, alpha: 255, color: [255, 255, 255], text: 'AB\nC', incline: 0, floor: 0 } as unknown as Parameters<Preview['drawLine']>[2];
  for (const anchor of [[0, 1], [1, 0], [-0.25, 1.5]]) {
    const draw = context(); line.anchor = anchor;
    preview.drawLine(draw, line, state, 2);
    assert.deepEqual(destinations(draw)[0], [-8000 * anchor[0]!, -10 * (1 - anchor[1]!), 8000, 10]);
    assert.deepEqual(draw.calls.find(call => call.method === 'scale')!.args, [-2, 3]);
    draw.calls = []; preview.drawLine(draw, { ...line, Texture: 'picture.png' }, state, 2);
    assert.deepEqual(destinations(draw)[0], [-200 * anchor[0]!, -120 * (1 - anchor[1]!), 200, 120]);
    draw.calls = []; preview.drawLine(draw, { ...line, extended: { textEvents: [createEvent('AB\nC')] } }, state, 2);
    assert.deepEqual(draw.calls.filter(call => call.method === 'fillText').map(call => call.args), [['AB', -80 * anchor[0]!, -200 * (1 - anchor[1]!) + 80], ['C', -80 * anchor[0]!, -200 * (1 - anchor[1]!) + 180]]);
  }
  const view = { left: 0, top: 0, width: 200, height: 200, scale: 1 };
  assert.equal(textureInViewport(picture, { anchor: [1, 0.5] }, { x: 150, y: 0, scaleX: 2, scaleY: 1, rotation: 0 }, 200, 200, 1, view), true);
  assert.equal(textureInViewport(picture, { anchor: [0, 0.5] }, { x: 150, y: 0, scaleX: 2, scaleY: 1, rotation: 0 }, 200, 200, 1, view), false);
});

test('锚点校验拒绝无效格式，省略时仍默认中心而非改变老谱结构', () => {
  const chart = createChart(); delete (chart.judgeLineList[0] as Partial<JudgeLine>).anchor; assertChart(chart);
  assert.equal(Object.hasOwn(parseChart(serializeChart(chart)).judgeLineList[0]!, 'anchor'), false);
  for (const anchor of [[0.5], [0, Infinity], { x: 0.5, y: 0.5 }]) {
    chart.judgeLineList[0]!.anchor = anchor as number[]; assert.throws(() => assertChart(chart), /anchor/);
  }
});
