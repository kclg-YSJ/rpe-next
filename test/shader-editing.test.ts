import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createChart, createLine, diagnose, parseChart, serializeChart } from '../src/core/chart.ts';
import { fromNumber } from '../src/core/beat.ts';
import { shaderEvents, shaderParameterTrack, shaderParameters, parseShaderValue, shaderTypeFields, shaderEventLanes } from '../src/core/shader-events.ts';
import { ShaderRuntime } from '../src/core/shader.ts';
import { EditorSession } from '../src/application/session.ts';
import { eventList, placedEvent, insertEvent, transformEvents, deleteEvents, copyEvents, pasteEvents } from '../src/application/event-commands.ts';
import { reorderLine, deleteLine, duplicateLine } from '../src/application/line-commands.ts';
import { TempoMap } from '../src/core/tempo.ts';
import { Timeline } from '../src/ui/timeline.ts';
import { Preview } from '../src/ui/preview.ts';
import { packageEntries } from '../src/platform/files.ts';
import type { ArchiveEntries } from '../src/platform/archive.ts';
import type { AnyEventType, Beat } from '../src/core/types.ts';
import type { ShaderLaneEvent } from '../src/core/shader-events.ts';
import type { ProjectImages } from '../src/platform/images.ts';

/**
 * The shader effect records this file writes into `chart.effects`.
 *
 * `Chart` deliberately indexes unknown keys, so `chart.effects` is `unknown` and the records have to
 * be described on the test side. Every field is optional because `core/shader.ts` reads these as
 * untrusted chart data (`ShaderEffectRecord`); spelling the shape out here keeps the two `vars`
 * literals and the spread-overrides readable instead of asserting them into a narrower type.
 */
interface EffectDouble {
  shader?: string;
  line?: number;
  start?: Beat;
  end?: Beat;
  global?: boolean;
  order?: number;
  clone?: boolean;
  startTime?: Beat;
  endTime?: Beat;
  vars?: Record<string, unknown>;
  extension?: { untouched: boolean };
  [key: string]: unknown;
}

/**
 * One recorded 2D-context call, as the proxy below pushes it.
 *
 * The proxy invents a method for every property the code under test names and records the
 * arguments, so neither the method set nor the argument list can be spelled out; `unknown[]` is the
 * honest annotation for both. Keeping this interface explicit is what stops `calls` from being
 * inferred as `never[]`, which is what made every read of it an error.
 */
interface RecordedCall {
  method: string | symbol;
  args: unknown[];
  color: unknown;
  alpha: unknown;
}

/** The recording stand-in for a `CanvasRenderingContext2D`. */
interface RecordingContext {
  calls: RecordedCall[];
  fillStyle?: unknown;
  globalAlpha?: number;
  [key: string]: unknown;
}

/**
 * A structural double for the canvas the `Timeline` and `Preview` constructors are built on.
 *
 * Both only read the CSS box, register listeners and ask for a 2D context — they never treat the
 * argument as a real DOM node. The `style` bag is typed as `Record<string, string>` rather than
 * `object` so the assertions that read back `surface.style.opacity` narrow to a string.
 */
interface CanvasDouble {
  style: Record<string, string>;
  clientWidth: number;
  clientHeight: number;
  addEventListener(): void;
  focus(): void;
  setPointerCapture(): void;
  getContext(kind: string): unknown;
  getBoundingClientRect(): { width: number; height: number };
}

/**
 * `Timeline` and `Preview` declare their canvases as the real `HTMLCanvasElement`, which the partial
 * double above deliberately is not. This helper is the single documented place that bridges the two,
 * instead of repeating the bridging at every construction site. It returns the *same* object, so a
 * test that keeps its own reference to the double still observes what the renderer writes to it.
 */
function canvasSurface(double: CanvasDouble): HTMLCanvasElement {
  return double as unknown as HTMLCanvasElement;
}

/**
 * The `images` bag `Preview.draw` reads its background out of.
 *
 * The test installs a bare `{ background }` literal before any project exists: none of the store's
 * other members (the decode queue, the texture maps, the byte budget) are touched by a draw. This
 * names the members the renderer actually reads, and the background carries only its pixel size —
 * the renderer never reads `source` on this path. `ProjectImages` is a class whose members are all
 * required, so the literal is bridged to it in `previewImages` below in one documented place.
 */
interface PreviewImagesDouble {
  background: { naturalWidth: number; naturalHeight: number } | null;
  backgroundName?: string;
  backgroundAnimated?: boolean;
}

/**
 * `Preview.images` is declared as the real `ProjectImages`, which the partial double above
 * deliberately is not. A class type and a bare literal shape do not "sufficiently overlap" for a
 * direct assertion, so the bridge goes through `unknown` in this one spot — `any` would hide a
 * genuine mismatch. Every member `Preview.draw` reads is present on the double.
 */
function previewImages(store: PreviewImagesDouble): ProjectImages {
  const open: unknown = store;
  return open as ProjectImages;
}

function effect(shader = 'grayscale', line = 0): EffectDouble {
  return { shader, line, start: [0, 0, 1], end: [4, 0, 1], global: false, order: 0, vars: { factor: 0.5 } };
}

function recordingContext(): RecordingContext {
  // The target starts as `{ calls: [] }` plus the two style fields the recorder reads back, and the
  // typed surface is declared before the Proxy so the trap and the caller share one shape.
  const target: RecordingContext = { calls: [] };
  return new Proxy(target, {
    get(object, key) {
      // `key in object` does not narrow a `string | symbol`, so the existing-member read goes
      // through the index signature the interface already declares.
      if (key in object) return object[key as string];
      return (...args: unknown[]) => object.calls.push({ method: key, args, color: object.fillStyle, alpha: object.globalAlpha ?? 1 });
    },
  });
}

function canvas(context: RecordingContext): CanvasDouble {
  return { style: {}, clientWidth: 600, clientHeight: 600, addEventListener() {}, focus() {}, setPointerCapture() {}, getContext: () => context, getBoundingClientRect: () => ({ width: 600, height: 600 }) };
}

/**
 * The shape `Timeline.eventRects` holds: `timeline.ts` declares the array as `unknown[]` because the
 * note and event areas push differently-shaped rectangles into it. This names the event members the
 * assertions below read.
 */
interface EventRectDouble {
  x: number;
  y: number;
  width: number;
  height: number;
  index: number;
  type: AnyEventType;
}

/**
 * The shader rectangles in `Timeline.eventRects`.
 *
 * The array is `unknown[]`, and `unknown` is not assignable to {@link EventRectDouble}, so the
 * elements cannot be narrowed with a type predicate directly. This reads each element through the
 * structural check the drawing code already guarantees — every entry it pushes carries these six
 * members — and returns the projection, leaving non-shader entries out.
 */
function paintEventRects(timeline: Timeline): EventRectDouble[] {
  const rectangles: EventRectDouble[] = [];
  for (const value of timeline.eventRects) {
    const rectangle: EventRectDouble = value as EventRectDouble;
    if (rectangle.type === 'paintEvents') rectangles.push(rectangle);
  }
  return rectangles;
}

test('extra 着色器投影到所属线，可修改、复制、删除与撤销，未知数据保留', () => {
  const chart = createChart(); chart.judgeLineList.push(createLine());
  // `chart.effects` is an untrusted chart field, so the list is narrowed once here and read back
  // through that binding; each record is an `EffectDouble`, which is what the literals above build.
  const effects: EffectDouble[] = [{ ...effect(), extension: { untouched: true } }, effect('noise', 1)];
  chart.effects = effects;
  const original = structuredClone(chart); const session = new EditorSession(chart);
  assert.equal(shaderEvents(chart, 0).length, 1); assert.deepEqual(chart, original);
  session.eventSelection.add('paintEvents:0');
  transformEvents(session, '编辑 shader', event => ({ ...event, order: 7, endTime: [6, 0, 1], vars: { factor: [{ startTime: [1, 0, 1], endTime: [5, 0, 1], start: 0, end: 1, easingType: 2 }] } }));
  assert.equal(eventList(session, 'paintEvents')[0].order, 7);
  // Each read re-narrows the replaced document: `transformEvents` installs a new chart, so the
  // effects array has to come off `session.chart` at assertion time.
  const find = (line: number): EffectDouble => (session.chart.effects as EffectDouble[]).find(event => event.line === line)!;
  assert.deepEqual(find(0).end, [6, 0, 1]);
  assert.deepEqual(find(0).extension, { untouched: true });
  assert.deepEqual(find(1), (original.effects as EffectDouble[])[1]);
  copyEvents(session); pasteEvents(session, 8);
  assert.equal(eventList(session, 'paintEvents').length, 2);
  deleteEvents(session); assert.equal(eventList(session, 'paintEvents').length, 1);
  session.travel('undo'); assert.equal(eventList(session, 'paintEvents').length, 2);
  assert.deepEqual(parseChart(serializeChart(session.chart)), session.chart);
});

test('放置默认 chromatic；同类与不同 shader 均可重叠，普通事件仍拒绝重叠', () => {
  const chart = createChart(); chart.effects = [effect()]; const session = new EditorSession(chart);
  // `placedEvent` returns `ChartEvent | null`; `createChart` always leaves a line at index 0, so both
  // placements succeed. The assertion pins that down before the value is passed on. The fifth
  // parameter is `easingType`, which the original left off; passing `undefined` keeps the call
  // byte-for-byte the same as the argument list that was already there.
  const placed = placedEvent(session, 'paintEvents', 0, 4, undefined);
  assert.ok(placed);
  assert.equal(placed.shader, 'chromatic'); insertEvent(session, 'paintEvents', placed);
  assert.equal(diagnose(session.chart).filter(issue => issue.path.startsWith('paintEvents')).length, 0);
  const second = placedEvent(session, 'paintEvents', 1, 3, undefined);
  assert.ok(second);
  insertEvent(session, 'paintEvents', second);
  copyEvents(session); pasteEvents(session, 1);
  assert.equal(diagnose(session.chart).filter(issue => issue.path.startsWith('paintEvents')).length, 0);
  assert.equal(eventList(session, 'paintEvents').length, 4);
  const normal = placedEvent(session, 'moveXEvents', 10, 14, undefined);
  assert.ok(normal);
  insertEvent(session, 'moveXEvents', normal);
  assert.throws(() => placedEvent(session, 'moveXEvents', 11, 13, undefined), /重叠/);
});

test('重叠的同类 shader 按 order 独立叠加，相接边界只应用后一个事件', () => {
  const chart = createChart();
  chart.effects = [{ ...effect(), order: 2 }, { ...effect(), order: 1 }, { ...effect(), start: [4, 0, 1], end: [8, 0, 1] }];
  // `ShaderRuntime.load` is `async`, so the stub has to return a promise rather than `void`. Resolved
  // immediately, which is what an empty body produced at runtime.
  const runtime = new ShaderRuntime(); runtime.load = () => Promise.resolve();
  const tempo = new TempoMap(chart.BPMList); runtime.compile(chart, tempo);
  assert.deepEqual(runtime.active(tempo.seconds(2)).map(entry => entry.order), [1, 2]);
  assert.equal(runtime.active(tempo.seconds(4)).length, 1);
  assert.equal(runtime.active(tempo.seconds(8)).length, 0);
});

test('shader 参数标量、向量、默认值、绝对拍数及原版 clone 类型', async () => {
  const source = await readFile(new URL('../public/assets/rpe/shaders/pr/rain_pr.glsl', import.meta.url), 'utf8');
  const definitions = shaderParameters(source);
  // The GLSL declares `rainColor`, so the lookup resolves; the assertion pins that down before the
  // value is read.
  const rainColor = definitions.find(entry => entry.name === 'rainColor');
  assert.ok(rainColor);
  assert.deepEqual(rainColor.value, [0.7, 0.8, 0.9, 0.6]);
  assert.ok(!definitions.some(entry => ['screenSize', 'time'].includes(entry.name)));
  assert.equal(parseShaderValue('0.25', 1), 0.25); assert.deepEqual(parseShaderValue('1, 2, 3, 4', 4), [1, 2, 3, 4]);
  assert.throws(() => parseShaderValue('1,', 2)); assert.throws(() => parseShaderValue('NaN', 1));
  const projected = { ...effect(), startTime: [2, 0, 1], endTime: [4, 0, 1] };
  assert.deepEqual(shaderParameterTrack(projected, 'factor')[0], { startTime: [2, 0, 1], endTime: [4, 0, 1], start: 0.5, end: 0.5, easingType: 1 });
  assert.deepEqual(shaderTypeFields('circle_blur_2'), { shader: 'circleBlur', clone: true });
  assert.deepEqual(shaderTypeFields('rain'), { shader: '/rain_pr.glsl', clone: false });
});

test('shader 参数按原版真实秒插值，使用所属线倍率；首段开始前采用默认值', () => {
  const chart = createChart(); chart.judgeLineList[0].bpmfactor = 2;
  chart.BPMList.push({ startTime: [2, 0, 1], bpm: 60 });
  chart.effects = [{ ...effect(), clone: true, vars: { factor: [{ startTime: [0, 0, 1], endTime: [4, 0, 1], start: 0, end: 1, easingType: 1 }], later: [{ startTime: [3, 0, 1], endTime: [4, 0, 1], start: 8, end: 9 }] } }];
  // `ShaderRuntime.load` is `async`, so the stub has to return a promise rather than `void`. Resolved
  // immediately, which is what an empty body produced at runtime.
  const runtime = new ShaderRuntime(); runtime.load = () => Promise.resolve(); runtime.compile(chart, new TempoMap(chart.BPMList));
  assert.equal(runtime.active(2)[0].shader, 'grayscale_2');
  assert.equal(runtime.active(2)[0].values.factor, 1 / 3);
  assert.equal(runtime.active(2)[0].values.later, undefined);
  assert.equal(runtime.active(7).length, 0);
});

/**
 * The parameter track `ChartEvent.vars.factor` holds.
 *
 * `ChartEvent.vars` is `unknown` — shader events carry parameter tracks the core never types — and
 * the assertions below compare beat triples out of it. This reads the one binding off the event list
 * at assertion time, because `transformEvents` replaces the document.
 */
function factorTrack(session: EditorSession): unknown[] {
  const event = eventList(session, 'paintEvents')[0];
  const vars: unknown = event.vars;
  const bag: Record<string, unknown> = vars === undefined || vars === null ? {} : vars as Record<string, unknown>;
  const track: unknown = bag.factor;
  return Array.isArray(track) ? track : [];
}

test('移动 shader 默认对齐参数首拍，可关闭自动对齐；参数时长不变', () => {
  const chart = createChart();
  chart.effects = [{ ...effect(), vars: { factor: [{ startTime: [1, 0, 1], endTime: [3, 0, 1], start: 0, end: 1, easingType: 1 }] } }];
  const session = new EditorSession(chart); session.eventSelection.add('paintEvents:0');
  transformEvents(session, '移动', event => ({ ...event, startTime: [8, 0, 1], endTime: [12, 0, 1] }));
  // Each read goes back through the session: chart edits replace the document, so a binding hoisted
  // before the mutation would report the pre-edit track.
  const moved: { startTime?: unknown; endTime?: unknown } = factorTrack(session)[0] as { startTime?: unknown; endTime?: unknown };
  assert.deepEqual(moved.startTime, [8, 0, 1]);
  assert.deepEqual(moved.endTime, [10, 0, 1]);
  session.shaderAutoAlign = false;
  transformEvents(session, '移动', event => ({ ...event, startTime: [10, 0, 1], endTime: [14, 0, 1] }));
  const unaligned: { startTime?: unknown } = factorTrack(session)[0] as { startTime?: unknown };
  assert.deepEqual(unaligned.startTime, [8, 0, 1]);
});

test('特殊层实际画出 extra 事件并可命中，参数外层不画普通数值缓动', () => {
  globalThis.devicePixelRatio = 1;
  const chart = createChart(); chart.effects = [effect(), effect('noise')];
  const session = new EditorSession(chart); const context = recordingContext();
  const timeline = new Timeline(canvasSurface(canvas(recordingContext())), canvasSurface(canvas(context)), () => session, () => {}, () => {});
  timeline.extended = true; timeline.drawEvents(0);
  const rectangles = paintEventRects(timeline);
  assert.equal(rectangles.length, 2); assert.notEqual(rectangles[0].x, rectangles[1].x);
  assert.ok(context.calls.some(call => call.method === 'fillText' && call.args[0] === 'grayscale'));
  const rectangle = rectangles[0];
  assert.equal(timeline.eventInteraction.hit({ x: rectangle.x + 1, y: rectangle.y + 1 })?.type, 'paintEvents');
  session.eventSelection.add('paintEvents:0');
  transformEvents(session, '移动 shader', event => ({ ...event, startTime: fromNumber(20), endTime: fromNumber(24) }));
  timeline.drawEvents(0); assert.equal(paintEventRects(timeline).length, 1);
});

test('首尾相接的 shader 保持完整宽度，只有真正重叠时分栏且不随视野改变', () => {
  const chart = createChart(); chart.effects = [effect(), { ...effect('noise'), start: [4, 0, 1], end: [8, 0, 1] }];
  const session = new EditorSession(chart); const context = recordingContext();
  const timeline = new Timeline(canvasSurface(canvas(recordingContext())), canvasSurface(canvas(context)), () => session, () => {}, () => {});
  timeline.extended = true; timeline.origin = 2; timeline.drawEvents(2);
  const width = timeline.eventColumnBounds(3, 600).width;
  const rectangles = paintEventRects(timeline);
  assert.equal(rectangles.length, 2); assert.equal(rectangles[0].width, width); assert.equal(rectangles[1].width, width);
  assert.equal(rectangles[0].x, rectangles[1].x);
  timeline.origin = 6; timeline.drawEvents(6);
  const last = paintEventRects(timeline)[0];
  assert.ok(last);
  assert.equal(last.width, width);
  // `shaderEventLanes` takes `ShaderLaneEvent[]`, whose beat fields are `unknown`: the triples below
  // are what `beatValue` reads, and the annotation is what keeps the array from widening to `number[]`.
  const events: ShaderLaneEvent[] = [{ startTime: [0, 0, 1], endTime: [8, 0, 1] }, { startTime: [2, 0, 1], endTime: [4, 0, 1] }, { startTime: [8, 0, 1], endTime: [12, 0, 1] }];
  const layout = shaderEventLanes(events);
  assert.deepEqual([...layout.values()], [{ lane: 0, count: 2 }, { lane: 1, count: 2 }, { lane: 0, count: 1 }]);
});

test('shader 使用相同的不透明背景底色，成功时替换原画面、失败及结束时恢复', () => {
  globalThis.devicePixelRatio = 1;
  const chart = createChart(); chart.effects = [effect()];
  const context = recordingContext(); const surface = canvas(context); const preview = new Preview(canvasSurface(surface));
  // `Preview.images` is the full project store, of which this test installs only the background.
  preview.visible = true; preview.images = previewImages({ background: { naturalWidth: 1350, naturalHeight: 900 } });
  preview.shaderRuntime.load = () => Promise.resolve(); preview.shaderPipeline.render = () => true;
  const tempo = new TempoMap(chart.BPMList); preview.draw(chart, tempo, 0, 0);
  const fill = context.calls.findIndex(call => call.method === 'fillRect' && call.color === '#111');
  const background = context.calls.findIndex(call => call.method === 'drawImage');
  assert.ok(fill >= 0 && fill < background); assert.equal(context.calls[fill].alpha, 1);
  assert.equal(context.calls[background].alpha, 0.35); assert.equal(surface.style.opacity, '0');
  preview.shaderPipeline.render = () => false; preview.draw(chart, tempo, 0, 0); assert.equal(surface.style.opacity, '1');
  preview.shaderPipeline.render = () => true; preview.draw(chart, tempo, 3, 0); assert.equal(surface.style.opacity, '1');
  context.calls.length = 0; preview.applyShaders = false; preview.draw(chart, tempo, 0, 0);
  assert.ok(!context.calls.some(call => call.method === 'fillRect' && call.color === '#111'));
});

test('PEZ 更新所属 extra.json 并保留其他字段、原资源及其他项目', () => {
  const chart = createChart(); chart.effects = [effect()];
  const encode = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));
  // `packageEntries` takes the archive map the importer builds (`Map<string, Uint8Array>`), which is
  // what the encoder above produces.
  const assets: ArchiveEntries = new Map([['song/EXTRA.JSON', encode({ extension: 42, effects: [] })], ['other/extra.json', encode({ effects: ['keep'] })]]);
  const output = packageEntries(chart, assets, 'song/chart.json');
  const extra: unknown = JSON.parse(new TextDecoder().decode(output.get('song/EXTRA.JSON')));
  assert.deepEqual(extra, { extension: 42, effects: chart.effects });
  assert.deepEqual(output.get('other/extra.json'), assets.get('other/extra.json'));
  assert.deepEqual(JSON.parse(new TextDecoder().decode(assets.get('song/EXTRA.JSON'))).effects, []);
  // `chart.effects` is `unknown`; the empty list is the shape the assertion below reads back.
  chart.effects = [] as EffectDouble[];
  assert.deepEqual(JSON.parse(new TextDecoder().decode(packageEntries(chart, assets, 'song/chart.json').get('song/EXTRA.JSON'))).effects, []);
});

test('判定线重排、复制、删除时 shader 所属线同步，原对象不变', () => {
  const chart = createChart(); chart.judgeLineList.push(createLine()); chart.effects = [effect(), effect('noise', 1)];
  // `reorderLine`/`deleteLine`/`duplicateLine` return a new chart whose `effects` is still an
  // untrusted field, so each result is narrowed once at the point of use.
  const reordered = reorderLine(chart, 0, 1).effects as EffectDouble[];
  assert.equal(reordered[0].line, 1);
  assert.deepEqual(deleteLine(chart, 0).effects, [{ ...(chart.effects as EffectDouble[])[1], line: 0 }]);
  const duplicateEffects = duplicateLine(chart, 0).effects as EffectDouble[];
  assert.equal(duplicateEffects.length, 3);
  const duplicated = duplicateEffects.find(event => event.line === 2);
  assert.ok(duplicated);
  assert.deepEqual(duplicated.vars, (chart.effects as EffectDouble[])[0].vars);
  const effects = chart.effects as EffectDouble[];
  assert.equal(effects.length, 2); assert.equal(effects[0].line, 0);
});
