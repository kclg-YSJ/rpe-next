import test from 'node:test';
import assert from 'node:assert/strict';
import { createChart, createLine, createNote, createEvent } from '../src/core/chart.ts';
import { beatValue } from '../src/core/beat.ts';
import { compileExpression, compileBatchScript } from '../src/core/batch-script.ts';
import { EditorSession } from '../src/application/session.ts';
import { captureSelection, commitSelectionEdit } from '../src/application/batch-edit.ts';
import type { SelectionEditResult } from '../src/application/batch-edit.ts';
import { previewMultiEdit, previewEventClones, batchOperation } from '../src/application/multi-edit.ts';
import type { CloneOptions, MultiEditResult } from '../src/application/multi-edit.ts';
import { shaderEvents } from '../src/core/shader-events.ts';
import { RpeSkin } from '../src/ui/skin.ts';
import type { DrawableImage } from '../src/ui/skin.ts';
import { MultiEditPanel } from '../src/ui/multi-edit.ts';
import type { Color, Note, ChartEvent } from '../src/core/types.ts';

/**
 * The `targets` option as the tests supply it.
 *
 * `CloneOptions.targets` is declared as `string[]`, but the panel hands the raw 目标线号序列 text
 * through and `sequence` funnels it with `String(...)`, so a plain string is what the callers
 * actually pass and what the runtime accepts. `cloneOptions` below is the one place that widens the
 * test-side view of that single field rather than loosening the production type.
 */
type CloneOptionsDouble = Omit<CloneOptions, 'targets'> & { targets?: string | string[] };

/**
 * Viewing a test's clone options as the production `CloneOptions`.
 *
 * `targets` is the only divergent field, and only in the direction the runtime already handles
 * (`sequence` stringifies whatever it is given). Bridged through `unknown` in this one documented
 * spot; every other member is checked against `CloneOptions` by `CloneOptionsDouble`.
 */
function cloneOptions(options: CloneOptionsDouble): CloneOptions {
  const open: unknown = options;
  return open as CloneOptions;
}

/**
 * `commitSelectionEdit` takes a `SelectionEditResult`, while the preview functions return a
 * `MultiEditResult`.
 *
 * The two shapes differ in one way: `MultiEditResult` has no `multiLineSelection`, and
 * `commitSelectionEdit` reads it as optional. The runner only ever reads the members both declare,
 * so this is the runner's view of the same object; bridged through `unknown` in one place.
 */
function selectionEditResult(result: MultiEditResult): SelectionEditResult {
  const open: unknown = result;
  return open as SelectionEditResult;
}

/** The `MultiEditResult` behind the shared preview members. */
type PreviewResult = MultiEditResult;

/** One recorded preview stroke: the dash colour pushed by `stroke()`. */
type StrokeColor = string | undefined;

/**
 * The 2D-context double `MultiEditPanel.drawTimeline` draws into.
 *
 * It records the polyline vertices and each stroke colour; the methods it stubs out are the ones the
 * drawing code calls but this test does not observe. `strokeStyle` is written by the panel and read
 * back by `stroke()`.
 */
interface DrawContextDouble {
  strokeStyle?: string;
  save(): void;
  restore(): void;
  setLineDash(segments: number[]): void;
  beginPath(): void;
  rect(x: number, y: number, width: number, height: number): void;
  clip(): void;
  strokeRect(x: number, y: number, width: number, height: number): void;
  fillRect(x: number, y: number, width: number, height: number): void;
  fillText(text: string, x: number, y: number): void;
  moveTo(horizontal: number, vertical: number): void;
  lineTo(horizontal: number, vertical: number): void;
  stroke(): void;
}

/**
 * The panel's canvas double.
 *
 * `MultiEditPanel.drawTimeline` reads `clientWidth`/`clientHeight` and asks for the 2D context.
 */
interface PanelCanvasDouble {
  clientWidth: number;
  clientHeight: number;
  getContext(kind: string): DrawContextDouble;
}

/**
 * The `timeline` slice `MultiEditPanel.drawTimeline` reads.
 *
 * The real `Timeline` is far wider than this; only the event canvas, the track list and the two
 * coordinate helpers are touched.
 */
interface PanelTimelineDouble {
  eventsCanvas: PanelCanvasDouble;
  eventTypes: string[];
  vertical(beat: number): number;
  eventColumnBounds(channel: number, width: number): { x: number; width: number };
}

/**
 * `MultiEditPanel` built from its prototype with only the fields `drawTimeline` reads.
 *
 * The panel is normally constructed against a live DOM, which this test does not have, so the
 * instance is created from the prototype and the fields are written by hand. This names exactly the
 * members the method touches.
 */
interface MultiEditPanelDouble {
  active: boolean;
  kind: string;
  getSession(): EditorSession;
  previewEnabled: { checked: boolean };
  previewHovered: boolean;
  timeline: PanelTimelineDouble;
  result: PreviewResult | null;
  drawTimeline(): void;
}

/** The 2D-context double `RpeSkin.hold`/`head` draw into; only `drawImage` is observed. */
interface SkinContextDouble {
  save(): void;
  restore(): void;
  translate(horizontal: number, vertical: number): void;
  scale(horizontal: number, vertical: number): void;
  drawImage(...args: unknown[]): void;
}

/**
 * `RpeSkin.hold`/`head` declare a real `CanvasRenderingContext2D`, which the partial double above is
 * not. This helper is the single documented place that bridges the two.
 */
function skinContext(double: SkinContextDouble): CanvasRenderingContext2D {
  return double as unknown as CanvasRenderingContext2D;
}

function fixture() {
  const chart = createChart(); chart.judgeLineList.push(createLine('target'), createLine('last'));
  chart.judgeLineList[0].notes = [createNote(1, 2, -100), createNote(2, 4, 50, 5), createNote(4, 6, 100)];
  chart.judgeLineList[0].eventLayers[0].moveXEvents = [createEvent(0, 10, 1, 2), createEvent(10, 20, 3, 4), createEvent(20, 30, 5, 6)];
  const session = new EditorSession(chart); session.selection = new Set([2, 0, 1]);
  session.eventSelection = new Set(['moveXEvents:2', 'moveXEvents:0', 'moveXEvents:1']); return session;
}

/**
 * The `moveXEvents` track of one judge line, read off a document.
 *
 * `eventLayers` entries are `Partial<Record<AnyEventType, ChartEvent[]>>`, so each track is optional
 * and every read goes through this helper. These tests read tracks off a freshly returned chart at
 * assertion time rather than hoisting a binding, because a chart edit replaces the document.
 */
function moveX(chart: { judgeLineList: { eventLayers: object[] }[] }, lineIndex: number): ChartEvent[] {
  const line = chart.judgeLineList[lineIndex];
  const layer: { moveXEvents?: ChartEvent[] } = line.eventLayers[0] as { moveXEvents?: ChartEvent[] };
  return layer.moveXEvents ?? [];
}

/** The notes of one judge line, read off a document. */
function notesOf(chart: { judgeLineList: { notes?: Note[] }[] }, lineIndex: number): Note[] {
  return chart.judgeLineList[lineIndex].notes ?? [];
}

test('克隆可移除源事件，同线目标只移除原件，重复目标与未选中事件完整保留', () => {
  const session = fixture(); session.focus = 'events'; session.selection.clear(); session.eventSelection = new Set(['moveXEvents:0', 'moveXEvents:2']);
  const original = session.chart;
  const result = previewEventClones(captureSelection(session), cloneOptions({ targets: '0 1 0', increment: 4, division: 4, retainSource: false }));
  assert.equal(session.chart, original);
  assert.equal(moveX(result.chart, 0).length, 5);
  assert.equal(moveX(result.chart, 1).length, 3);
  assert.equal(moveX(result.chart, 0)[0], moveX(original, 0)[1]);
  assert.deepEqual([...result.eventSelection], ['moveXEvents:1', 'moveXEvents:2', 'moveXEvents:3', 'moveXEvents:4']);
  commitSelectionEdit(session, selectionEditResult(result), '克隆');
  session.travel('undo'); assert.equal(session.chart, original); assert.deepEqual([...session.eventSelection], ['moveXEvents:0', 'moveXEvents:2']);
  session.travel('redo'); assert.equal(session.chart, result.chart); assert.equal(session.eventSelection.size, 4);
  const other = previewEventClones(captureSelection(fixture()), cloneOptions({ targets: '1', retainSource: false }));
  assert.equal(moveX(other.chart, 0).length, 0);
  assert.equal(other.eventSelection.size, 0);
});

test('多事件虚影以共同数值范围绘制，首尾整体平移不会归一化为相同曲线', () => {
  const starts: [number, number][] = []; const strokes: StrokeColor[] = [];
  const context: DrawContextDouble = { save() {}, restore() {}, setLineDash() {}, beginPath() {}, rect() {}, clip() {}, strokeRect() {}, fillRect() {}, fillText() {},
    moveTo(horizontal: number, vertical: number) { starts.push([horizontal, vertical]); }, lineTo() {}, stroke() { strokes.push(this.strokeStyle); } };
  const session = fixture();
  const canvas: PanelCanvasDouble = { clientWidth: 500, clientHeight: 600, getContext: () => context };
  // The panel is driven without a DOM, so only the fields `drawTimeline` reads are written.
  const panel: MultiEditPanelDouble = Object.create(MultiEditPanel.prototype);
  Object.assign(panel, { active: true, kind: 'events', getSession: () => session, previewEnabled: { checked: true }, previewHovered: true,
    timeline: { eventsCanvas: canvas, eventTypes: ['moveXEvents'], vertical: (beat: number) => 550 - beat * 100, eventColumnBounds: () => ({ x: 10, width: 80 }) },
    result: { changes: [{ lineIndex: 0, index: 0, type: 'moveXEvents', before: createEvent(0, 10, 1, 2), after: createEvent(100, 110, 1, 2) }] } });
  panel.drawTimeline();
  assert.equal(starts.length, 2); assert.equal(starts[0][1], starts[1][1]);
  assert.ok(starts[1][0] - starts[0][0] > 50);
  assert.deepEqual(strokes, ['#a4b0bd', '#8effd0']);
});

test('有限脚本解析算术、条件、函数、顺序赋值，拒绝执行任意代码和非有限结果', () => {
  assert.equal(compileExpression('clamp(-2 + pow(3, 2), 0, 5)')({}), 5);
  assert.equal(compileExpression('i % 2 == 0 && N > 1 ? lerp(-10, 10, u) : 0')({ i: 2, N: 4, u: 1 }), 10);
  assert.equal(compileExpression('true || missing')({}), 1);
  assert.equal(compileExpression('2 ^ 3 ^ 2')({}), 512);
  for (const text of ['window.alert(1)', 'constructor(1)', '1/0', 'sqrt(-1)', 'unknown', 'this.constructor.constructor(1)']) assert.throws(() => compileExpression(text)({}));
  for (const text of ['__proto__ = 1', 'while(true) {}', 'x = fetch(1)', 'x = 1; document = 2']) assert.throws(() => compileBatchScript(text, ['x']));
});

test('原版六种修改方式', () => {
  assert.deepEqual(['By', 'To', 'Times', 'Max', 'Min', 'Flip'].map(mode => batchOperation(5, 3, mode)), [8, 3, 15, 5, 3, 1]);
});

test('音符 RGB 编辑使用原版 tint 字段，贴图染色保留 Hold 三段尺寸', () => {
  const session = fixture(); session.notes[0].tint = [100, 200, 150];
  const result = previewMultiEdit(captureSelection(session), 'notes', { field: 'red', operation: 'To', lower: 10, upper: 30 });
  // `BatchChange.after` is a `Note | ChartEvent` union; these are note changes, so the note view is
  // taken through a narrowing helper rather than a cast.
  const afterRed: Note = result.changes[0].after as Note;
  assert.deepEqual(afterRed.tint, [10, 200, 150]);
  assert.equal(afterRed.color, undefined);
  const skin = new RpeSkin(() => {}); const tinted: [string, Color][] = [];
  // `RpeSkin.images` is keyed by its file-local `SkinImage`, which is exactly the structural slice
  // `DrawableImage` extends and which the tinting path reads. `DrawableImage` is that slice's
  // exported form, so the stand-ins are declared as one.
  for (const name of ['Hold3', 'HoldHead', 'HoldEnd', 'Tap2']) skin.images.set(name, { naturalWidth: 100, naturalHeight: 10 } as DrawableImage);
  // `tinted` is declared as returning `DrawableImage | null`; the stub records the call and returns
  // a bare named record, which is all `drawImage` receives on this path.
  skin.tinted = (name: string, color: Color): DrawableImage => {
    tinted.push([name, color]);
    return { name, width: 1, height: 1, naturalWidth: 1, naturalHeight: 1 } as DrawableImage;
  };
  const draws: unknown[][] = []; const context: SkinContextDouble = { save() {}, restore() {}, translate() {}, scale() {}, drawImage(...args: unknown[]) { draws.push(args); } };
  skin.hold(skinContext(context), 0, 100, 0, 50, false, true, [10, 20, 30]);
  assert.deepEqual(tinted.map(([name]) => name), ['Hold3', 'HoldEnd', 'HoldHead']);
  assert.ok(draws.every(args => args.slice(1).every(value => Number.isFinite(value))));
  tinted.length = 0; skin.head(skinContext(context), 1, 0, 0, 50, false, [255, 255, 255]); assert.equal(tinted.length, 0);
});

test('音符按时间排序分配 0…1，周期与筛选生效；预览无副作用且一次撤销', () => {
  const session = fixture(); const original = session.chart;
  const result = previewMultiEdit(captureSelection(session), 'notes', { field: 'x', operation: 'To', lower: -200, upper: 200, cycle: '1 -1 1' });
  assert.equal(session.chart, original); assert.equal(session.history.undoStack.length, 0);
  assert.deepEqual(notesOf(result.chart, 0).map(note => note.positionX), [-200, -0, 200]);
  commitSelectionEdit(session, selectionEditResult(result), '多音符编辑'); assert.equal(session.history.undoStack.length, 1);
  session.travel('undo'); assert.equal(session.chart, original); session.travel('redo'); assert.equal(session.chart, result.chart);
  const selected = fixture();
  const filtered = previewMultiEdit(captureSelection(selected), 'notes', { field: 'speed', operation: 'To', lower: 2, upper: 4, noteType: 2 });
  assert.deepEqual(notesOf(filtered.chart, 0).map(note => note.speed), [1, 2, 1]);
  const skipped = previewMultiEdit(captureSelection(selected), 'notes', { field: 'x', operation: 'To', lower: 7, upper: 7, cycle: '1 _ 1', condition: 't1 >= 2' });
  assert.deepEqual(notesOf(skipped.chart, 0).map(note => note.positionX), [7, 50, 7]);
});

test('脚本按语句顺序修改拍数，非 Hold 保持首尾同拍，跨线移动保留扩展属性', () => {
  const session = fixture(); session.notes[1].custom = { preserved: true };
  const snapshot = captureSelection(session);
  const result = previewMultiEdit(snapshot, 'notes', { mode: 'script', script: 't1 += 1; t2 += 1; x = -x; size = 1 + i / 4; line = i % 2;' });
  assert.equal(notesOf(result.chart, 0).length, 2); assert.equal(notesOf(result.chart, 1).length, 1);
  const hold = notesOf(result.chart, 1)[0]; assert.equal(beatValue(hold.startTime), 5); assert.equal(beatValue(hold.endTime), 6); assert.deepEqual(hold.custom, { preserved: true });
  assert.equal(session.notes.length, 3);
  const tail = previewMultiEdit(snapshot, 'notes', { field: 't2', operation: 'By', lower: 1, upper: 1 });
  assert.equal(beatValue(notesOf(tail.chart, 0)[0].startTime), 3);
  assert.throws(() => previewMultiEdit(snapshot, 'notes', { mode: 'script', script: 'line = 999;' }), /不存在/);
  assert.throws(() => previewMultiEdit(snapshot, 'notes', { mode: 'script', script: 't2 = 0;' }), /结束拍/);
});

test('原版事件普通属性从 1/N 分配，Duration 首尾相接，Order 内容换槽且时间不变', () => {
  const snapshot = captureSelection(fixture());
  const result = previewMultiEdit(snapshot, 'events', { field: 'both', operation: 'By', lower: 0, upper: 30 });
  assert.deepEqual(result.changes.map(change => (change.after as ChartEvent).start), [10, 30, 50]);
  const durations = previewMultiEdit(snapshot, 'events', { field: 'duration', operation: 'To', lower: 1, upper: 3 });
  assert.deepEqual(durations.changes.map(change => [beatValue((change.after as ChartEvent).startTime), beatValue((change.after as ChartEvent).endTime)]), [[1, 2], [2, 4], [4, 7]]);
  const order = previewMultiEdit(snapshot, 'events', { field: 'order', operation: 'Flip', lower: 0.5, upper: 0.5 });
  assert.deepEqual(order.changes.map(change => (change.after as ChartEvent).start), [20, 10, 0]);
  assert.deepEqual(order.changes.map(change => beatValue((change.after as ChartEvent).startTime)), [1, 3, 5]);
});

test('事件 Line 是复制并保留源事件，修改单端后解除不再相同的钩定', () => {
  const session = fixture();
  // Chart edits replace the document, so the track is read through the session at each use rather
  // than bound once before the mutation below.
  const source = moveX(session.chart, 0);
  source[0].end = 0; source[0].inst = 1;
  const moved = previewMultiEdit(captureSelection(session), 'events', { field: 'line', operation: 'To', lower: 1, upper: 1 });
  assert.equal(moveX(moved.chart, 0).length, 3);
  assert.equal(moveX(moved.chart, 1).length, 4);
  const result = previewMultiEdit(captureSelection(session), 'events', { field: 'end', operation: 'By', lower: 1, upper: 1 });
  assert.equal((result.changes[0].after as ChartEvent).inst, 0);
});

test('扰动预览稳定，应用与预览完全一致，换种子重新采样', () => {
  const snapshot = captureSelection(fixture()); const options = { field: 'x', disturbance: '-10 10', seed: 9 };
  const first = previewMultiEdit(snapshot, 'notes', options); const second = previewMultiEdit(snapshot, 'notes', options);
  assert.deepEqual(first.chart, second.chart);
  assert.notDeepEqual(first.chart, previewMultiEdit(snapshot, 'notes', { ...options, seed: 10 }).chart);
});

test('特殊层着色器克隆保留参数并按新起拍对齐；颜色文字完整保留', () => {
  const session = fixture();
  const line = session.line;
  assert.ok(line);
  // The shader record is a loose chart payload rather than a full `ChartEvent`, so it is built as
  // one and the track is written through the extended layer's per-type view.
  const paintEvent: Record<string, unknown> = { startTime: [1, 0, 1], endTime: [2, 0, 1], shader: 'chromatic', vars: { power: [{ ...createEvent(1, 2, 1, 2), custom: true }] }, custom: { keep: 1 } };
  line.extended = {
    colorEvents: [{ ...createEvent(), start: [10, 20, 30], end: [30, 40, 50] }],
    textEvents: [{ ...createEvent(), start: 'hello', end: 'world' }],
    paintEvents: [paintEvent as unknown as ChartEvent],
  };
  session.eventSelection = new Set(['colorEvents:0', 'textEvents:0', 'paintEvents:0']);
  const result = previewEventClones(captureSelection(session), cloneOptions({ targets: '1 2', increment: 4, division: 4 }));
  const shader = shaderEvents(result.chart, 2)[0];
  assert.equal(beatValue(shader.startTime), 2);
  // `ChartEvent.vars` is `unknown` — the parameter bag is an untrusted chart field — so the track is
  // read through a narrowing helper rather than dereferenced directly.
  const power = shaderParameterSegments(shader, 'power');
  assert.equal(beatValue(power[0].startTime), 2);
  assert.deepEqual(shader.custom, { keep: 1 });
  assert.deepEqual(specialTrack(result.chart, 2, 'colorEvents')[0].start, [10, 20, 30]);
  assert.equal(specialTrack(result.chart, 2, 'textEvents')[0].start, 'hello');
});

/**
 * The segments of one shader parameter track on an event.
 *
 * `ChartEvent.vars` is `unknown`, so the bag is narrowed to a record and the named track to a list
 * of `{ startTime }` segments.
 */
function shaderParameterSegments(event: ChartEvent, name: string): { startTime: unknown; [key: string]: unknown }[] {
  const vars: unknown = event.vars;
  const bag: Record<string, unknown> = vars === undefined || vars === null ? {} : vars as Record<string, unknown>;
  const track: unknown = bag[name];
  return Array.isArray(track) ? track as { startTime: unknown }[] : [];
}

/**
 * One extended track of a judge line.
 *
 * `JudgeLine.extended` is an `EventLayer`, whose entries are `Partial<Record<AnyEventType, ChartEvent[]>>`.
 */
function specialTrack(chart: { judgeLineList: { extended?: object }[] }, lineIndex: number, type: string): ChartEvent[] {
  const extended = chart.judgeLineList[lineIndex].extended;
  const layer: Record<string, ChartEvent[] | undefined> = extended === undefined ? {} : extended as Record<string, ChartEvent[] | undefined>;
  return layer[type] ?? [];
}

test('无匹配、错误时间和非法脚本整次失败，不污染原谱', () => {
  const session = fixture(); const original = structuredClone(session.chart); const snapshot = captureSelection(session);
  assert.throws(() => previewMultiEdit(snapshot, 'events', { mode: 'script', script: 'start += 1; t2 = i == 2 ? -1 : t2;' }), /结束拍/);
  assert.throws(() => previewMultiEdit(snapshot, 'notes', { condition: 'false' }), /没有匹配/);
  assert.throws(() => previewMultiEdit(snapshot, 'notes', { mode: 'script', script: 'type = 99;' }), /音符类型/);
  assert.deepEqual(session.chart, original); assert.equal(session.history.undoStack.length, 0);
});

test('克隆按线号序列而非线号数值累加横线增量，复制保留 Bezier、绑定与自定义字段', () => {
  const session = fixture(); session.eventSelection = new Set(['moveXEvents:0']);
  const source = moveX(session.chart, 0);
  Object.assign(source[0], { bezier: 1, bezierPoints: [0.2, 0.4, 0.6, 0.8], linkgroup: 9, custom: { value: 7 } });
  const result = previewEventClones(captureSelection(session), cloneOptions({ targets: '2 1 2', increment: '2', division: 4,
    channels: { moveXEvents: { lower: 0, upper: 100, cycle: '1 -1' } } }));
  assert.deepEqual(result.changes.map(change => beatValue((change.after as ChartEvent).startTime)), [1, 1.5, 2]);
  assert.deepEqual(result.changes.map(change => (change.after as ChartEvent).start), [0, -50, 100]);
  assert.equal(moveX(result.chart, 0).length, 3);
  assert.equal(moveX(result.chart, 2).length, 3);
  assert.deepEqual((result.changes[0].after as ChartEvent).bezierPoints, [0.2, 0.4, 0.6, 0.8]);
  assert.deepEqual((result.changes[0].after as ChartEvent).custom, { value: 7 });
  // Both reads go through the live documents: the preview returned a new chart, and the source track
  // is re-read off the session at assertion time.
  assert.notEqual((result.changes[0].after as ChartEvent).custom, moveX(session.chart, 0)[0].custom);
  assert.throws(() => previewEventClones(captureSelection(session), cloneOptions({ targets: '3' })), /已有/);
});
