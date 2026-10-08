import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCurveNotes } from '../src/core/curve-notes.ts';
import { beatValue } from '../src/core/beat.ts';
import { createChart, createLine, createNote, createEvent, serializeChart, parseChart } from '../src/core/chart.ts';
import { gameUiLayout, gameUiBindings, scoreAt } from '../src/core/game-ui.ts';
import type { GameUiLayoutItem } from '../src/core/game-ui.ts';
import { drawGameUi } from '../src/ui/game-ui.ts';
import { previewViewport } from '../src/core/editor-display.ts';
import { Preview } from '../src/ui/preview.ts';
import { Timeline } from '../src/ui/timeline.ts';
import type { TimelineSession } from '../src/ui/timeline.ts';
import { TempoMap } from '../src/core/tempo.ts';
import { EditorSession } from '../src/application/session.ts';
import { isPlaybackSpace } from '../src/ui/keyboard.ts';
import { normalizeEditorPreferences } from '../src/platform/editor-preferences.ts';
import { migratePreferences, shortcutAction } from '../src/core/preferences.ts';

/**
 * The curve options the tests build from {@link curve} plus overrides.
 *
 * `startTime`/`endTime` are `Beat` triples, but an object literal widens them to `number[]`, which is
 * not a `Beat`. Annotating the shared base once keeps every call site a plain object literal whose
 * spreads stay assignable.
 */
type CurveOptions = Parameters<typeof generateCurveNotes>[0];

const curve: Pick<CurveOptions, 'startTime' | 'endTime' | 'startX' | 'endX'> = { startTime: [0, 0, 1], endTime: [4, 0, 1], startX: -400, endX: 400 };

/** One recorded fake-context call: the method, its arguments and the state read at call time. */
interface RecordedCall {
  method: string | symbol;
  args: unknown[];
  font: string | undefined;
  alpha: number | undefined;
  color: string | undefined;
}

/**
 * The recording 2D-context double.
 *
 * Every method call is captured and any property read (`font`, `globalAlpha`, `fillStyle`) is
 * echoed into the record, so assertions can check both the call and the state it was made in. Only
 * the members the tests touch are declared; this is not a `CanvasRenderingContext2D`.
 */
interface RecordingContext {
  calls: RecordedCall[];
  font?: string;
  globalAlpha?: number;
  fillStyle?: string;
  [key: string]: unknown;
}

function recordingContext(): RecordingContext {
  const calls: RecordedCall[] = [];
  const target = { calls, font: undefined as string | undefined, globalAlpha: undefined as number | undefined, fillStyle: undefined as string | undefined };
  return new Proxy(target, { get(object, key) {
    return key in object ? object[key as keyof typeof object] : (...args: unknown[]) => calls.push({ method: key, args, font: object.font, alpha: object.globalAlpha, color: object.fillStyle });
  } });
}

/** A structural double for the canvases `Preview` and `Timeline` are built on. */
interface CanvasDouble {
  clientWidth: number;
  clientHeight: number;
  style: object;
  addEventListener(): void;
  focus(): void;
  setPointerCapture(): void;
  getContext(): RecordingContext | object;
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
}

function canvas(context: RecordingContext | object = {}): CanvasDouble {
  return { clientWidth: 600, clientHeight: 600, style: {}, addEventListener() {}, focus() {}, setPointerCapture() {},
    getContext: () => context, getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 600 }) };
}

/**
 * `Preview` and `Timeline` declare their canvas as the real `HTMLCanvasElement`, which the partial
 * double above deliberately is not. This is the one place that view is taken.
 */
function canvasSurface(context: RecordingContext | object = {}): HTMLCanvasElement { return canvas(context) as unknown as HTMLCanvasElement; }

/** The recorded context as `drawGameUi` sees it; the double is bridged in this one spot. */
function drawContext(context: RecordingContext): CanvasRenderingContext2D { return context as unknown as CanvasRenderingContext2D; }

/** `TimelineSession` is an open bag, so `EditorSession` is handed over through that view here. */
function timelineSession(session: EditorSession): TimelineSession { return session as unknown as TimelineSession; }

/**
 * The layout entry for `key`, narrowed to the union member that key names.
 *
 * `GameUiLayoutItem` is discriminated on `key`, and no element carries both `fontSize` and
 * `width`/`height`; the generic signature below therefore returns the member the key selects, which
 * is what lets the call sites read the member's own fields. It throws loudly if the table has no
 * such key rather than dereferencing a missing entry.
 */
function layoutItem<K extends GameUiLayoutItem['key']>(items: readonly GameUiLayoutItem[], key: K): Extract<GameUiLayoutItem, { key: K }> {
  const found = items.find((item): item is Extract<GameUiLayoutItem, { key: K }> => item.key === key);
  if (!found) throw new Error(`missing layout item ${key}`);
  return found;
}

/**
 * The same lookup as `layoutItem`, for the maps the tests build keyed by `item.key`.
 *
 * The map is keyed by the union's own `key` values, so the entry is present whenever the base table
 * has one; the assertion states that instead of a generic narrowing TypeScript cannot follow through
 * a `Map` lookup.
 */
function mappedItem(items: ReadonlyMap<string, GameUiLayoutItem>, key: GameUiLayoutItem['key']): GameUiLayoutItem {
  const found = items.get(key);
  if (!found) throw new Error(`missing layout item ${key}`);
  return found;
}

test('曲线按横线分格 × 密度生成，不含端点，29 种缓动均有效，可一次撤销', () => {
  for (let easingType = 1; easingType <= 29; easingType++) {
    const notes = generateCurveNotes({ ...curve, easingType });
    assert.equal(notes.length, 15);
    // `noUncheckedIndexedAccess` makes every index optional; the length is asserted just above, so
    // these are the first and last of the 15 generated notes.
    const first = notes[0]; const last = notes.at(-1);
    assert.ok(first); assert.ok(last);
    assert.equal(beatValue(first.startTime), 0.25);
    assert.equal(beatValue(last.startTime), 3.75);
    assert.ok(notes.every(note => note.type === 4 && Number.isFinite(note.positionX) && note.above === 1 && note.speed === 1 && note.isFake === 0));
    assert.ok(notes.every(note => beatValue(note.startTime) === beatValue(note.endTime)));
  }
  const notes = generateCurveNotes(curve);
  const middle = notes[7];
  assert.ok(middle);
  assert.equal(middle.positionX, 0);
  const session = new EditorSession(); const original = session.chart;
  session.insertNotes(notes, '生成曲线音符'); assert.equal(session.history.undoStack.length, 1);
  session.travel('undo'); assert.equal(session.chart, original);
  session.travel('redo'); assert.equal(session.notes.length, 15);
  assert.deepEqual(parseChart(serializeChart(session.chart)), session.chart);
});

test('曲线保留七分拍与分数起拍，同拍使用横向等距，非法输入不生成', () => {
  const notes = generateCurveNotes({ ...curve, division: 7, startTime: [0, 1, 3], endTime: [1, 1, 3] });
  assert.equal(notes.length, 6);
  const first = notes[0]; const last = notes.at(-1);
  assert.ok(first); assert.ok(last);
  assert.deepEqual(first.startTime, [0, 10, 21]); assert.deepEqual(last.startTime, [1, 4, 21]);
  const same = generateCurveNotes({ ...curve, endTime: curve.startTime, density: 3, easingType: 29 });
  assert.deepEqual(same.map(note => note.positionX), [-200, 0, 200]);
  assert.equal(generateCurveNotes({ ...curve, density: 0.5 }).length, 7);
  // Each entry overrides one option with the invalid value the generator must reject; the union is
  // named so the spread stays assignable to `CurveNoteOptions`.
  const invalid: Partial<CurveOptions>[] = [{ density: 0 }, { density: Infinity }, { type: 2 }, { endTime: [-1, 0, 1] }, { endTime: [100, 0, 1], density: 1000 }];
  for (const value of invalid) assert.throws(() => generateCurveNotes({ ...curve, ...value }));
});

test('预览全局 Hold 层低于其他音符，绑定线隐藏本体但保留音符，缩放不漏远音符', () => {
  globalThis.devicePixelRatio = 1;
  const chart = createChart(); chart.judgeLineList.push(createLine());
  chart.judgeLineList[0].notes = [createNote(1, 1, 0)];
  chart.judgeLineList[1].notes = [createNote(2, 1, 0, 3)];
  chart.judgeLineList[1].attachUI = 'name';
  const context = recordingContext(); const preview = new Preview(canvasSurface(context)); preview.visible = true;
  // `order` records which of the two overlay draws ran, in the order they ran.
  const order: string[] = [];
  // `Preview.skin` is the full `RpeSkin`; the two overlay entry points and `tinted` are all the draw
  // path touches, so the double is bridged through `unknown` in this one spot.
  preview.skin = { tinted: () => null, head: () => { order.push('tap'); return true; }, hold: () => { order.push('hold'); return true; } } as unknown as Preview['skin'];
  preview.draw(chart, new TempoMap(chart.BPMList), 0, 0);
  assert.deepEqual(order, ['hold', 'tap']);
  assert.equal(context.calls.filter(call => call.method === 'fillRect' && call.color !== '#111').length, 1);
  chart.judgeLineList[0].notes = [createNote(1, 6, 0)];
  const tempo = new TempoMap(chart.BPMList); preview.viewDivisor = 10; order.length = 0;
  preview.draw(chart, tempo, 0, 0); assert.ok(order.includes('tap'));
  preview.viewDivisor = 1; order.length = 0; preview.draw(chart, tempo, 0, 0); assert.ok(!order.includes('tap'));
});

test('编辑区重叠点选优先 Tap，X 偏移反变换与绝对竖线吸附一致，Y 轴不受影响', () => {
  const session = new EditorSession(); session.insertNotes([createNote(1, 1, 0), createNote(2, 1, 0, 3)]);
  const timeline = new Timeline(canvasSurface(), canvasSurface(), () => timelineSession(session), () => {}, () => {});
  const vertical = timeline.vertical(1);
  // `hit` returns `null` when nothing is under the point; the coordinates above land on the tap.
  const hit = timeline.hit({ x: timeline.horizontal(0), y: vertical });
  assert.ok(hit);
  assert.equal(hit.item.type, 1);
  timeline.cameraX = 270; timeline.snapX = false;
  for (const position of [-900, 0, 135, 980]) assert.ok(Math.abs(timeline.positionAt(timeline.horizontal(position)) - position) < 1e-9);
  timeline.snapX = true; assert.equal(timeline.positionAt(timeline.horizontal(140)), 135);
  timeline.notesOnly = true; assert.equal(timeline.vertical(1), vertical);
});

test('游戏 UI 遵循原 UI.txt 边距、字体尺寸，横竖比例转换保持边距', () => {
  const items = gameUiLayout(1350, 900);
  assert.equal(layoutItem(items, 'combonumber').fontSize, 67); assert.equal(layoutItem(items, 'score').fontSize, 49);
  assert.equal(layoutItem(items, 'bar').height, 8); assert.equal(layoutItem(items, 'pause').width, 42);
  const base = new Map(items.map(item => [item.key, item]));
  for (const ratio of [16 / 9, 9 / 16, 1, 32 / 9]) {
    const view = previewViewport(900, 600, ratio);
    const width = view.width / view.scale; const height = view.height / view.scale;
    const adapted = new Map(gameUiLayout(width, height).map(item => [item.key, item]));
    for (const [key, item] of base) {
      const changed = mappedItem(adapted, key as GameUiLayoutItem['key']);
      assert.ok(Math.abs((changed.x - item.edgeX * width / 2) - (item.x - item.edgeX * 675)) < 1e-9);
      assert.ok(Math.abs((changed.y - item.edgeY * height / 2) - (item.y - item.edgeY * 450)) < 1e-9);
    }
  }
});

test('UI 绑定使用已解析的父线、叠层和扩展事件，后绑定覆盖且移除后恢复默认', () => {
  const chart = createChart(); chart.META.name = 'Test';
  const parent = chart.judgeLineList[0]; parent.eventLayers[0].moveXEvents = [createEvent(200)]; parent.attachUI = 'name';
  const child = createLine(); child.father = 0; child.attachUI = 'name'; child.eventLayers[0].moveXEvents = [createEvent(50)];
  child.eventLayers[0].alphaEvents = [createEvent(128)]; child.extended.scaleXEvents = [createEvent(2)]; chart.judgeLineList.push(child);
  const preview = new Preview(canvasSurface(recordingContext())); preview.visible = true;
  preview.draw(chart, new TempoMap(chart.BPMList), 0, 0);
  const states = preview.scene.sample(0); const binding = gameUiBindings(chart, states).get('name');
  // `get` returns `undefined` for an unbound id; `'name'` is bound on the child line below.
  assert.ok(binding);
  assert.equal(binding.x, 250); assert.equal(binding.scaleX, 2); assert.equal(binding.alpha, 128);
  assert.deepEqual(binding.color, [255, 255, 255]);
  const context = recordingContext(); const view = previewViewport(1350, 900);
  drawGameUi(drawContext(context), chart, states, [], 0, -1, view, 0.5, null, 60);
  const text = context.calls.find(call => call.method === 'fillText' && call.args[0] === 'Test');
  assert.ok(text);
  assert.equal(text.font, '17.5px RPEGame, sans-serif'); assert.equal(text.alpha, 128 / 255);
  const position = context.calls.filter(call => call.method === 'translate').at(-2);
  assert.ok(position);
  assert.ok(Math.abs(Number(position.args[0]) - 481.7) < 1e-9);
  parent.attachUI = ''; child.attachUI = ''; assert.equal(gameUiBindings(chart, states).size, 0);
  assert.deepEqual(parseChart(serializeChart(chart)), chart);
});

test('连击严格越过判定时间，Hold 尾计数且忽略假音符', () => {
  const chart = createChart(); chart.judgeLineList[0].notes = [createNote(1, 1, 0), createNote(2, 0, 0, 4), { ...createNote(3, 0, 0), isFake: 1 }];
  const preview = new Preview(canvasSurface(recordingContext())); preview.visible = true; preview.draw(chart, new TempoMap(chart.BPMList), 0, 0);
  assert.deepEqual(preview.completionTimes, [0.5, 2]);
  assert.deepEqual(scoreAt(preview.completionTimes, 0.5), { combo: 0, score: 0 });
  assert.deepEqual(scoreAt(preview.completionTimes, 2), { combo: 1, score: 500000 });
  assert.deepEqual(scoreAt(preview.completionTimes, 2.001), { combo: 2, score: 1000000 });
});

test('空格优先播放涵盖非文本控件，文本和组合输入豁免；新增视图设置与热键可迁移', () => {
  // `isPlaybackSpace` reads the event's `target` as a text-entry candidate: `isContentEditable`, and
  // `closest('input')` returning the element's `type`. The doubles below supply exactly those two,
  // and are bridged to `KeyboardEvent` at the call sites because the real type is far wider.
  interface TargetDouble {
    isContentEditable?: boolean;
    closest(selector: string): { type?: string } | null;
  }
  const target = (type: string | null): TargetDouble => ({ closest: (selector: string) => selector === 'input' && type ? { type } : null });
  const keyEvent = (target: TargetDouble | null, isComposing = false): KeyboardEvent =>
    ({ key: ' ', isComposing, target }) as unknown as KeyboardEvent;
  for (const type of [null, 'range', 'checkbox', 'radio', 'button', 'color']) assert.equal(isPlaybackSpace(keyEvent(target(type))), true);
  for (const type of ['text', 'number', 'search', 'email']) assert.equal(isPlaybackSpace(keyEvent(target(type))), false);
  assert.equal(isPlaybackSpace(keyEvent({ isContentEditable: true, closest: () => null })), false);
  assert.equal(isPlaybackSpace(keyEvent(null, true)), false);
  const preference = migratePreferences('{"showViewUI":true}'); assert.equal(preference.settings.showGameUI, true);
  assert.equal(shortcutAction({ key: 'n', altKey: true }, preference), 'SwitchUI');
  assert.equal(shortcutAction({ key: 'f', ctrlKey: true }, preference), 'CurveBegin');
  assert.equal(shortcutAction({ key: 'g', ctrlKey: true }, preference), 'CurveEnd');
  assert.deepEqual(normalizeEditorPreferences({ notesOnly: true, showGameUI: true, cameraX: 540, viewDivisor: 2, scale: 333 }), { scale: 333, cameraX: 540, viewDivisor: 2, notesOnly: true, showGameUI: true });
});
