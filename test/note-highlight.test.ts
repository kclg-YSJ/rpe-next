import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNoteSkin } from '../src/core/note-skin.ts';
import { ResourceNoteSkin } from '../src/ui/resource-note-skin.ts';
import type { NoteSkinInfo, NoteSkinRecord as ResourceNoteSkinRecord } from '../src/ui/resource-note-skin.ts';
import { RpeSkin } from '../src/ui/skin.ts';
import { Timeline } from '../src/ui/timeline.ts';
import { EditorSession } from '../src/application/session.ts';
import { createChart, createNote } from '../src/core/chart.ts';
import { noteSkinFixture, pngHeader } from './fixtures/note-skin.ts';
import type { NoteType } from '../src/core/types.ts';

interface Picture { naturalWidth: number; naturalHeight: number }
interface RuntimePack {
  info: NoteSkinInfo;
  noteScale(highlight?: boolean): number;
  head(context: CanvasRenderingContext2D, type: NoteType, horizontal: number, vertical: number, width: number, highlight?: boolean, color?: unknown, heightWidth?: number): boolean;
  hold(context: CanvasRenderingContext2D, horizontal: number, head: number, tail: number, width: number, highlight?: boolean, showHead?: boolean, color?: unknown, heightWidth?: number): boolean;
  dispose(): void;
}
const RuntimePack = ResourceNoteSkin as unknown as new (record: ResourceNoteSkinRecord, images: Map<string, Picture>,
  tintSource: (name: string, source: Picture | null | undefined, color: [number, number, number]) => Picture | null) => RuntimePack;

function skin(ratio = 1.5): RpeSkin {
  const files = noteSkinFixture();
  for (const [name, width, height] of [['click.png', 160, 40], ['click_mh.png', 160 * ratio, 40 * ratio],
    ['drag.png', 80, 20], ['drag_mh.png', 200, 50], ['flick.png', 192, 40], ['flick_mh.png', 256, 80], ['hold_mh.png', 240, 450]] as const) {
    files.set(name, pngHeader(width, height));
  }
  const record = parseNoteSkin(files);
  record.info.holdAtlasMH = [18, 27];
  const images = new Map(Object.entries(record.images).map(([name, size]): [string, Picture] => [name, { naturalWidth: size.width, naturalHeight: size.height }]));
  const pack = new RuntimePack(record as unknown as ResourceNoteSkinRecord, images, (_name, source) => source ?? null), result = new RpeSkin(() => {});
  result.setResourcePack(pack as unknown as Parameters<RpeSkin['setResourcePack']>[0]); return result;
}

interface DrawCall { method: string | symbol; args: unknown[] }
interface DrawContext extends CanvasRenderingContext2D { calls: DrawCall[] }
function context(): DrawContext {
  const target = { calls: [] as DrawCall[] };
  return new Proxy(target, { get(store, key) {
    if (typeof key === 'string' && key in store) return (store as unknown as Record<string, unknown>)[key];
    return (...args: unknown[]): void => { store.calls.push({ method: key, args }); };
  } }) as unknown as DrawContext;
}
const drawn = (draw: DrawContext): number[][] => draw.calls.filter(call => call.method === 'drawImage').map(call => call.args.slice(-4) as number[]);

test('resource highlight scale uses the shared Tap width ratio for Tap, Drag, Flick and Hold rather than normalizing away padding', () => {
  const runtime = skin();
  assert.equal(runtime.noteScale(false), 1); assert.equal(runtime.noteScale(true), 1.5);
  for (const type of [1, 2, 3, 4] as NoteType[]) {
    const normal = context(), highlighted = context();
    runtime.head(normal, type, 0, 0, 80, false, undefined, 0, 160);
    runtime.head(highlighted, type, 0, 0, 80, true, undefined, 0, 160);
    assert.equal(drawn(normal)[0]![2], 80); assert.equal(drawn(highlighted)[0]![2], 120);
  }
  const a = context(), b = context();
  runtime.head(a, 1, 0, 0, 80, false, undefined, 0, 160); runtime.head(b, 1, 0, 0, 80, true, undefined, 0, 160);
  assert.equal(drawn(a)[0]![3], 40); assert.equal(drawn(b)[0]![3], 60);
  runtime.setResourcePack(null); assert.equal(runtime.noteScale(true), 1);
});

test('highlight Hold scales its body width and both caps together while preserving duration, compact placement and width-only note size', () => {
  const runtime = skin();
  for (const compact of [false, true]) {
    (runtime.resourcePack as unknown as RuntimePack).info = { ...(runtime.resourcePack as unknown as RuntimePack).info, holdCompact: compact };
    const normal = context(), highlighted = context(), wide = context();
    runtime.hold(normal, 0, 200, 20, 80, false, true, undefined, 80);
    runtime.hold(highlighted, 0, 200, 20, 80, true, true, undefined, 80);
    runtime.hold(wide, 0, 200, 20, 240, true, true, undefined, 80);
    const a = drawn(normal), b = drawn(highlighted), c = drawn(wide);
    assert.ok(b.every(rect => rect[2] === 120)); assert.ok(c.every(rect => rect[2] === 360));
    assert.equal(a[0]![3], 180); assert.equal(b[0]![3], 180);
    assert.equal(b[1]![3], a[1]![3]! * 1.5); assert.equal(b[2]![3], a[2]![3]! * 1.5);
    assert.deepEqual(c.map(rect => rect[3]), b.map(rect => rect[3]));
    assert.deepEqual(c.map(rect => rect[1]), b.map(rect => rect[1]));
  }
});

test('timeline hit testing and drag width follow highlighted texture bounds and the highlight display switch', () => {
  const canvas = (): HTMLCanvasElement => ({ clientWidth: 600, clientHeight: 600, addEventListener() {}, style: {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 600 }) }) as unknown as HTMLCanvasElement;
  const chart = createChart(); chart.judgeLineList[0]!.notes = [createNote(1, 4, 0), createNote(4, 4, 500)];
  const session = new EditorSession(chart), timeline = new Timeline(canvas(), canvas(), () => session, () => {}, () => {});
  timeline.skin = skin(); timeline.origin = 4; timeline.simultaneous = new Set(session.notes);
  const note = session.notes[0]!, base = timeline.noteBaseWidth(note), x = timeline.noteHorizontal(0) + base * 0.65, y = timeline.vertical(4);
  assert.equal(timeline.noteWidth(note), base * 1.5);
  assert.equal(timeline.hit({ x, y })?.item, note);
  assert.equal(timeline.noteWidth({ ...note }, true), base * 1.5);
  timeline.highlight = false;
  assert.equal(timeline.noteWidth(note), base); assert.equal(timeline.hit({ x, y }), undefined);
});

test('equal-sized and smaller highlight textures retain their declared relative scale and switching packs resets it', () => {
  const same = skin(1), small = skin(0.75), large = skin();
  assert.equal(same.noteScale(true), 1); assert.equal(small.noteScale(true), 0.75);
  large.setResourcePack(same.resourcePack); assert.equal(large.noteScale(true), 1);
  large.setResourcePack(null); assert.equal(large.noteScale(true), 1);
});
