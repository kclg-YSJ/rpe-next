import test from 'node:test';
import assert from 'node:assert/strict';
import { createChart, createNote, parseChart, serializeChart } from '../src/core/chart.ts';
import type { NoteType } from '../src/core/types.ts';
import { LineRuntime } from '../src/core/scene.ts';
import { TempoMap } from '../src/core/tempo.ts';
import { lineGuides, pickGuide } from '../src/core/preview-guides.ts';
import type { LineGuide } from '../src/core/preview-guides.ts';
import { Preview } from '../src/ui/preview.ts';

/** One recorded 2D-context call, as the recording proxy below stores it. */
interface RecordedCall {
  method: string | symbol;
  args: unknown[];
  filter: unknown;
}

/** The recorder the proxy falls back to; `calls` collects every method the preview invokes. */
interface RecordingContext {
  calls: RecordedCall[];
  /** The CSS filter in force when each call was recorded. */
  filter: unknown;
  [key: string]: unknown;
}

/** The canvas double `Preview` is constructed with. */
interface CanvasDouble {
  style: { opacity?: string };
  getContext(): RecordingContext;
  getBoundingClientRect(): { left?: number; top?: number; width?: number; height?: number };
}

/** `Preview` declares a real `HTMLCanvasElement`; this is the one place the double is bridged. */
function previewCanvas(double: CanvasDouble): HTMLCanvasElement {
  return double as unknown as HTMLCanvasElement;
}

/**
 * A canvas double positioned at `(left, top)`.
 *
 * `Preview`'s hit test subtracts the canvas box's origin, and reads nothing else off `DOMRect`, so
 * this supplies the two coordinates it consumes.
 */
function canvasAt(left: number, top: number): CanvasDouble {
  return { style: {}, getContext: () => recordingContext(), getBoundingClientRect: () => ({ left, top }) };
}

/**
 * The recording 2D context.
 *
 * Any member other than `calls`/`filter` reads back as a recorder function, which is what makes the
 * property read below (`target[key]`) legitimate: the proxy answers every drawing entry point.
 */
function recordingContext(): RecordingContext {
  const target: RecordingContext = { calls: [], filter: undefined };
  return new Proxy(target, { get(store, key) {
    // `calls` and `filter` are the two real fields; everything else is a recorder.
    if (typeof key === 'string' && key in store) return store[key];
    return (...args: unknown[]) => {
      const recorded: RecordedCall = { method: key, args, filter: store.filter };
      store.calls.push(recorded);
    };
  } });
}

function previewSurface(): { context: RecordingContext; canvas: CanvasDouble } {
  const context = recordingContext();
  return { context, canvas: { style: {}, getContext: () => context, getBoundingClientRect: () => ({ width: 600, height: 400 }) } };
}

/**
 * The last recorded `drawImage` call's CSS filter.
 *
 * The preview always draws before this is read, so the call exists; the assertion states that
 * rather than asserting the value away.
 */
function lastDrawFilter(context: RecordingContext): unknown {
  const call = context.calls.filter(entry => entry.method === 'drawImage').at(-1);
  assert.ok(call);
  return call.filter;
}

test('编辑背景的不透明度不会被连续绘制覆盖，模糊修改在下一帧生效', () => {
  globalThis.devicePixelRatio = 1;
  const chart = createChart(); const tempo = new TempoMap(chart.BPMList);
  const { context, canvas } = previewSurface(); const preview = new Preview(previewCanvas(canvas));
  Object.assign(preview, { visible: true, applyShaders: false, opacity: 0.1, showHitEffects: false, images: { background: { naturalWidth: 1350, naturalHeight: 900 } } });
  preview.draw(chart, tempo, 0, 0); preview.draw(chart, tempo, 0.1, 0);
  assert.equal(canvas.style.opacity, '0.1');
  assert.equal(lastDrawFilter(context), 'blur(10.5px)');
  preview.backgroundBlur = 18; preview.opacity = 0.2;
  preview.draw(chart, tempo, 0.2, 0);
  assert.equal(canvas.style.opacity, '0.2');
  assert.equal(lastDrawFilter(context), 'blur(18px)');
  preview.backgroundBlur = 0; preview.opacity = 0;
  preview.draw(chart, tempo, 0.3, 0);
  assert.equal(canvas.style.opacity, '0');
  assert.equal(lastDrawFilter(context), 'none');
});

test('背景预览跳过 Tap 与 Hold 打击特效生成，正常预览仍生成特效', () => {
  globalThis.devicePixelRatio = 1;
  const chart = createChart(); chart.judgeLineList[0].notes = [createNote(1, 0, 0), createNote(2, 0, 0, 4)];
  const tempo = new TempoMap(chart.BPMList); const effects: string[] = [];
  const preview = new Preview(previewCanvas(previewSurface().canvas));
  Object.assign(preview, { visible: true, applyShaders: false, effectsSince: -Infinity, showHitEffects: false,
    skin: { images: new Map(), head: () => true, hold: () => true, tinted(name: string) { if (name.startsWith('img-')) effects.push(name); return null; } } });
  preview.draw(chart, tempo, 0.05, 0); preview.draw(chart, tempo, 0.7, 0);
  assert.equal(effects.length, 0);
  preview.showHitEffects = true;
  preview.draw(chart, tempo, 0.05, 0); assert.ok(effects.length >= 2);
  effects.length = 0;
  preview.draw(chart, tempo, 0.7, 0); assert.ok(effects.length > 0);
});

test('普通音符 above=2 与 Hold above=0 均向下，原字段无损保存', () => {
  const chart = createChart();
  chart.judgeLineList[0].notes = ([1, 2, 3, 4] as NoteType[]).flatMap(type => [0, 1, 2].map(above => ({ ...createNote(type, 4, 0, 6), above })));
  const parsed = parseChart(JSON.stringify(chart));
  assert.deepEqual(JSON.parse(serializeChart(parsed)), chart);
  const runtime = new LineRuntime(parsed.judgeLineList[0], new TempoMap(parsed.BPMList));
  for (const entry of runtime.notes) assert.equal(Math.sign(runtime.noteState(entry, runtime.state(0), 0).y), entry.note.above === 1 ? 1 : -1);
});

test('透明、负透明、零长度及绑定 UI 线仍可点击；退出预览不穿透', () => {
  const states = [0, -255, 255].map((alpha, index) => ({ alpha, x: index * 200, y: 0, scaleX: index === 2 ? 0 : 1, rotation: 0 }));
  const guides: LineGuide[] = lineGuides(states, [{}, {}, { attachUI: 'score' }], [0, 1, 2], 1000, 600, 1);
  assert.equal(guides.length, 3);
  assert.equal(pickGuide([guides[0]], { x: 500, y: 300 }, -1), 0);
  assert.equal(pickGuide([guides[1]], { x: 700, y: 300 }, -1), 1);
  assert.equal(pickGuide([guides[2]], { x: 900, y: 300 }, -1), 2);
  // `Preview` only reads the box's `left`/`top`, so the canvas is built through `previewCanvas`
  // rather than widening the surface double to a full `HTMLCanvasElement`.
  const preview = new Preview(previewCanvas(canvasAt(10, 20)));
  Object.assign(preview, { guides, pickPreviewLines: true, viewport: { left: 0, top: 0, width: 1000, height: 600 } });
  assert.equal(preview.pick(510, 320), null);
  preview.visible = true;
  assert.equal(preview.pick(510, 320), 0);
  assert.equal(preview.pick(0, 320), null);
});
