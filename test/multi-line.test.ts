import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorSession } from '../src/application/session.ts';
import { createChart, createLine, createNote } from '../src/core/chart.ts';
import { insertEvent, placedEvent, eventListAt, transformEvents } from '../src/application/event-commands.ts';
import { copyObjects, pasteObjects, deleteObjects, projectClipboard } from '../src/application/clipboard.ts';
import { parseLineExpression, formatLineExpression } from '../src/application/multi-line-edit.ts';
import { lineFeatureLabels } from '../src/core/line-groups.ts';
import { Timeline } from '../src/ui/timeline.ts';
import type { Note } from '../src/core/types.ts';
import type { ChartEvent } from '../src/core/types.ts';
import type { TimelineSession } from '../src/ui/timeline.ts';

function sessionWithLines(count = 3) {
  const chart = createChart(); chart.judgeLineList = Array.from({ length: count }, (_, index) => createLine(`Line ${index + 1}`));
  return new EditorSession(chart);
}

/**
 * The slice of canvas `Timeline` actually touches in these tests.
 *
 * A real `HTMLCanvasElement` is far wider than the double below (which has no DOM backing at all),
 * so the double is described by what it provides and handed over through one narrow conversion at
 * the call site, rather than by widening `Timeline`'s constructor to a structural type.
 */
interface CanvasDouble {
  clientWidth: number;
  clientHeight: number;
  style: Record<string, never>;
  addEventListener(): void;
  focus(): void;
  setPointerCapture(): void;
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
  getContext(): Record<string, never>;
}

function canvas(): CanvasDouble { return { clientWidth: 500, clientHeight: 600, style: {}, addEventListener() {}, focus() {}, setPointerCapture() {}, getBoundingClientRect() { return { left: 0, top: 0, width: 500, height: 600 }; }, getContext() { return { }; } }; }

/** The double only ever needs `clientWidth`/`height` from these paths; no DOM method is called. */
function asCanvas(double: CanvasDouble): HTMLCanvasElement {
  return double as unknown as HTMLCanvasElement;
}

test('多线模式保持去重排序并在关闭时保留集合', () => {
  const session = sessionWithLines();
  session.setMultiLineEnabled(true); session.addMultiLine(2); session.addMultiLine(1); session.addMultiLine(2);
  assert.deepEqual(session.multiLineIndices, [0, 1, 2]);
  session.removeMultiLine(0); assert.deepEqual(session.multiLineIndices, [1, 2]);
  session.setMultiLineEnabled(false); assert.equal(session.multiLineActive, false); assert.deepEqual(session.multiLineIndices, [1, 2]);
});

test('多线表达式支持分组名并在完整分组时优先显示分组名', () => {
  const session = sessionWithLines(4); session.chart.judgeLineGroup = ['Default', 'Verse'];
  session.chart.judgeLineList[1].Group = 1; session.chart.judgeLineList[2].Group = 1;
  assert.deepEqual(parseLineExpression('Verse 0', 4, session.chart), [0, 1, 2]);
  assert.equal(formatLineExpression([0, 1, 2], session.chart), 'Verse 0');
});

test('判定线列表标出非默认父线、绑定 UI、zOrder 和贴图', () => {
  // `lineFeatureLabels` takes a whole `JudgeLine`; only these few fields drive the labels, so the
  // rest come from the same factory the editor uses and the ones under test are overridden.
  assert.deepEqual(lineFeatureLabels({ ...createLine(), father: 0, attachUI: 'name', zOrder: 2, Texture: 'custom.png' }), ['父线=0', 'UI=name', 'Z=2', '贴图=custom.png']);
  assert.deepEqual(lineFeatureLabels({ ...createLine(), father: -1, zOrder: 0, Texture: 'line.png' }), []);
});

test('多线边界按钮按循环线组添加，音符可迁移到指定线', () => {
  const session = sessionWithLines(); session.setMultiLineEnabled(true); session.multiLineIndices = [0];
  session.addPreviousMultiLine(); assert.deepEqual(session.multiLineIndices, [0, 2]);
  session.addNextMultiLine(); assert.deepEqual(session.multiLineIndices, [0, 1, 2]);
  session.setMultiLineEnabled(false); session.insertNotes([createNote(1, 1, 0)]); session.selection = new Set([0]); session.moveSelectionToLine(2);
  assert.equal(session.lineIndex, 2); assert.equal(session.chart.judgeLineList[0].notes.length, 0);
});

test('多线音符并列显示并按所属线编辑', () => {
  const session = sessionWithLines(); session.setMultiLineEnabled(true); session.addMultiLine(1); session.addMultiLine(2);
  session.insertNotes([createNote(1, 2, 10)]);
  assert.deepEqual(session.chart.judgeLineList.map(line => line.notes.length), [1, 0, 0]);
  session.transformSelection('镜像', (note: Note | undefined): Note => {
    // The selection always resolves to a real note; a miss would be a fixture bug.
    if (!note) throw new Error('选中索引没有对应音符');
    return { ...note, positionX: -note.positionX };
  });
  assert.equal(session.chart.judgeLineList[0].notes[0].positionX, -10);
  session.selectLine(1); session.insertNotes([createNote(1, 2, 20)]);
  assert.deepEqual(session.chart.judgeLineList.map(line => line.notes.length), [1, 1, 0]);
  session.selection = new Set([0]);
  session.deleteSelection(); assert.deepEqual(session.chart.judgeLineList.map(line => line.notes.length), [1, 0, 0]);
  session.travel('undo'); assert.deepEqual(session.chart.judgeLineList.map(line => line.notes.length), [1, 1, 0]);
});

test('多线音符编辑按所属线处理，不依赖当前线', () => {
  const session = sessionWithLines(3);
  session.chart.judgeLineList[1].notes = [createNote(1, 2, 10)];
  session.chart.judgeLineList[1].numOfNotes = 1;
  session.setMultiLineEnabled(true);
  session.multiLineIndices = [0, 1];
  session.multiLineSelection = new Map([[1, new Set([0])]]);
  session.selection.clear();
  session.transformSelection('镜像非当前线音符', (note: Note | undefined): Note => {
    if (!note) throw new Error('选中索引没有对应音符');
    return { ...note, positionX: -note.positionX };
  });
  assert.equal(session.chart.judgeLineList[0].notes.length, 0);
  assert.equal(session.chart.judgeLineList[1].notes[0].positionX, -10);
  session.deleteSelection();
  assert.equal(session.chart.judgeLineList[1].notes.length, 0);
});

/** Reads a per-line selection the test just assigned; an absent entry would be a fixture bug. */
function selectionFor<T>(selections: Map<number, Set<T>>, lineIndex: number): Set<T> {
  const selection = selections.get(lineIndex);
  if (!selection) throw new Error(`第 ${lineIndex} 条线没有选区`);
  return selection;
}

/** `placedEvent` reports `null` for a range too short to be an event; the spans below are all real. */
function requireEvent(event: ChartEvent | null): ChartEvent {
  if (!event) throw new Error('放置事件失败');
  return event;
}

test('多线事件放置和批量变换保留每条线独立数组', () => {
  const session = sessionWithLines(); session.setMultiLineEnabled(true, 'events'); session.addMultiLine(1);
  // `easingType` is explicit as `undefined`: the call used to omit the argument and let the
  // untyped callee default it, so the same value is passed in to keep the produced event identical.
  const event = requireEvent(placedEvent(session, 'moveXEvents', 2, 3, undefined)); insertEvent(session, 'moveXEvents', event);
  assert.equal(eventListAt(session, 0, 'moveXEvents').length, 2);
  assert.equal(eventListAt(session, 1, 'moveXEvents').length, 1);
  session.selectLine(1);
  const second = requireEvent(placedEvent(session, 'moveXEvents', 4, 5, undefined)); insertEvent(session, 'moveXEvents', second);
  session.eventSelection = new Set(['moveXEvents:1']);
  transformEvents(session, '调整', current => {
    // Numeric track: the shift is applied to the endpoints the fixture created as numbers.
    const start = typeof current.start === 'number' ? current.start : 0;
    const end = typeof current.end === 'number' ? current.end : 0;
    return { ...current, start: start + 5, end: end + 5 };
  });
  assert.equal(eventListAt(session, 0, 'moveXEvents')[0].start, 0);
  assert.equal(eventListAt(session, 1, 'moveXEvents')[0].start, 0);
  assert.equal(eventListAt(session, 1, 'moveXEvents')[1].start, 5);
});

test('多线事件删除撤销恢复选择不丢失谱面引用', () => {
  const session = sessionWithLines(2); session.setMultiLineEnabled(true, 'events'); session.addMultiLine(1);
  insertEvent(session, 'moveXEvents', requireEvent(placedEvent(session, 'moveXEvents', 2, 3, undefined)));
  session.selectLine(1); insertEvent(session, 'moveXEvents', requireEvent(placedEvent(session, 'moveXEvents', 4, 5, undefined)));
  session.multiEventSelection = new Map([[1, new Set(['moveXEvents:0'])]]);
  session.eventSelection = new Set(['moveXEvents:0']);
  const before = eventListAt(session, 1, 'moveXEvents').length;
  deleteObjects(session); assert.equal(eventListAt(session, 1, 'moveXEvents').length, before - 1);
  session.travel('undo');
  assert.equal(eventListAt(session, 1, 'moveXEvents').length, before);
  assert.deepEqual([...selectionFor(session.multiEventSelection, 1)], ['moveXEvents:0']);
});

test('多线剪贴板复制粘贴和删除一次提交', () => {
  const session = sessionWithLines(); session.setMultiLineEnabled(true); session.addMultiLine(1);
  session.insertNotes([createNote(1, 1, 0)]); copyObjects(session); session.selection = new Set([0]);
  pasteObjects(session, 4); assert.deepEqual(session.chart.judgeLineList.map(line => line.notes.length), [2, 0, 0]);
  deleteObjects(session); assert.deepEqual(session.chart.judgeLineList.map(line => line.notes.length), [1, 0, 0]);
});

test('多线剪贴板保留来源线并按目标面板映射相对线号', () => {
  const session = sessionWithLines();
  session.chart.judgeLineList[1].notes = [createNote(1, 1, 100)];
  session.chart.judgeLineList[2].notes = [createNote(1, 2, -100)];
  session.multiLineEnabled = true; session.multiLineMode = 'notes'; session.multiLineIndices = [1, 2];
  session.multiLineSelection = new Map([[1, new Set([0])], [2, new Set([0])]]);
  copyObjects(session);
  assert.deepEqual(session.clipboardNoteLines, [1, 2]);
  const projected = projectClipboard(session, 4, { targetLineIndex: 0 });
  assert.deepEqual(projected.noteLines, [0, 1]);
  pasteObjects(session, 4, { targetLineIndex: 0 });
  assert.equal(session.chart.judgeLineList[0].notes.length, 1);
  assert.equal(session.chart.judgeLineList[1].notes.length, 2);
  assert.deepEqual([...selectionFor(session.multiLineSelection, 0)], [0]);
  assert.deepEqual([...selectionFor(session.multiLineSelection, 1)], [1]);
});

test('多线线号表达式支持空格和闭区间并拒绝反向范围', () => {
  assert.deepEqual(parseLineExpression('0 2:4 4 8', 10), [0, 2, 3, 4, 8]);
  assert.equal(formatLineExpression([4, 2, 3, 2]), '2:4');
  assert.throws(() => parseLineExpression('4:2', 10), /范围无效/);
  assert.deepEqual(parseLineExpression('-1 0 99', 3), [0]);
});

test('多线事件和音符共享单线宽度，仍可保留事件显式覆盖', () => {
  const session = sessionWithLines(2); session.setMultiLineEnabled(true, 'events'); session.addMultiLine(1);
  // `TimelineSession` is an open-ended structural view whose index signature `EditorSession` — a
  // class — does not satisfy. The editor passes the session in exactly this way at runtime, so the
  // callback hands the same object over through the interface the timeline actually declares.
  const getSession = (): TimelineSession => session as unknown as TimelineSession;
  const timeline = new Timeline(asCanvas(canvas()), asCanvas(canvas()), getSession, () => {}, () => {}); timeline.multiLineWidth = 320;
  assert.equal(timeline.panelWidth(500, 'notes'), 320);
  assert.equal(timeline.panelWidth(500, 'events'), 320);
  timeline.multiLineEventWidth = 180; assert.equal(timeline.panelWidth(500, 'events'), 320);
});
