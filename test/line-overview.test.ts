import test from 'node:test';
import assert from 'node:assert/strict';
import { nearbyLines, lineOverviewLayout, lineOverviewWindow, stepLine, stepOverviewLine, LineOverviewIndex } from '../src/core/line-overview.ts';
import { LineSwitcher } from '../src/ui/line-switcher.ts';
import { createChart, createLine, createNote, createEvent } from '../src/core/chart.ts';
import { TempoMap } from '../src/core/tempo.ts';
import { normalizeEditorPreferences } from '../src/platform/editor-preferences.ts';
import { shortcutAction, shortcutMatches, shortcutReleased, migratePreferences } from '../src/core/preferences.ts';
import type { HotkeySource } from '../src/core/preferences.ts';
import { isTypingText, releaseShortcutFocus } from '../src/ui/keyboard.ts';

test('线号上下切换首尾循环；附近线窗口有界且始终包含当前线', () => {
  assert.equal(stepLine(0, -120, 5), 4); assert.equal(stepLine(4, 120, 5), 0);
  assert.equal(stepLine(0, 1, 1), 0); assert.equal(stepLine(0, 1, 0), null);
  for (const count of [1, 5, 12, 13, 101]) for (let selected = 0; selected < count; selected++) {
    const indices = nearbyLines(selected, count);
    assert.ok(indices.includes(selected)); assert.equal(new Set(indices).size, indices.length);
    assert.ok(indices.every(index => index >= 0 && index < count)); assert.ok(indices.length <= 20);
  }
  assert.equal(nearbyLines(25, 100, 2, 2).length, 4);
  assert.equal(normalizeEditorPreferences({ lineSwitcher: false }).lineSwitcher, false);
});

test('速览增加一行到 20/24 个，每行高度保持不变；松开立即关闭', () => {
  const ordinary = lineOverviewLayout(900, 385); assert.equal(ordinary.columns * ordinary.rows, 20); assert.equal(ordinary.thumbnailHeight, 69);
  const large = lineOverviewLayout(1280, 580); assert.equal(large.columns * large.rows, 24); assert.equal(large.thumbnailHeight, 96);
  assert.ok(ordinary.panelWidth < 900 * 0.9); assert.ok(large.panelWidth < 1280 * 0.9);
  assert.ok(ordinary.thumbnailHeight / (ordinary.thumbnailHeight + 20) > 0.7);
  const switcher = Object.create(LineSwitcher.prototype); switcher.active = true; switcher.host = { hidden: false };
  switcher.release(); assert.equal(switcher.active, false); assert.equal(switcher.host.hidden, true);
});

test('筛选后的线号按列表循环，当前线不在候选中从首尾进入，空列表不切线', () => {
  const indices = [2, 6, 13, 19];
  assert.equal(stepOverviewLine(6, 1, indices), 13);
  assert.equal(stepOverviewLine(2, -1, indices), 19);
  assert.equal(stepOverviewLine(19, 1, indices), 2);
  assert.equal(stepOverviewLine(10, 1, indices), 2);
  assert.equal(stepOverviewLine(10, -1, indices), 19);
  assert.equal(stepOverviewLine(6, 1, [6]), 6);
  assert.equal(stepOverviewLine(6, 1, []), null);
});

test('筛选以当前时间视野为准，包含跨屏 Hold、不同 BPM 倍率及特殊事件', () => {
  const tempo = new TempoMap([{ bpm: 120, startTime: [0, 0, 1] }]);
  const line = createLine(); line.bpmfactor = 2; line.eventLayers = [];
  line.notes = [createNote(2, 1, 0, 8)]; line.extended = { textEvents: [createEvent('a', 'b', 6, 7)] };
  const index = new LineOverviewIndex(line, tempo);
  assert.equal(index.matches(3, 4, true, false), true);
  assert.equal(index.matches(3, 4, false, true), false);
  assert.equal(index.matches(3, 4, true, true), false);
  assert.equal(index.matches(6, 7, true, true), true);
  assert.equal(index.matches(10, 11, false, false), true);
  assert.equal(index.matches(10, 11, true, false), false);
  const shader = createEvent(0, 0, 10, 11);
  line.extended.paintEvents = [shader];
  const withShader = new LineOverviewIndex(line, tempo, [shader]);
  assert.equal(withShader.sample(10, 10, 11).events.length, 1);
  assert.equal(withShader.matches(10, 11, false, true), true);
});

test('筛选不会擅自改变当前线，滚轮使用筛选结果；关闭速览保留筛选，离开谱面重置', () => {
  const chart = { judgeLineList: [createLine(), createLine(), createLine()] };
  chart.judgeLineList[1].notes = [createNote(1, 4, 0)];
  const tempo = new TempoMap([{ bpm: 120, startTime: [0, 0, 1] }]);
  let selected = 0; let start = 1; let end = 3;
  const switcher = Object.create(LineSwitcher.prototype);
  Object.assign(switcher, { cache: new Map(), cards: new Map(), notesOnly: true, eventsOnly: false,
    filterInputs: new Map([['notesOnly', { checked: true }], ['eventsOnly', { checked: false }]]),
    host: { hidden: false }, getContext: () => ({ chart, tempo, selected, start, end }), select: (index: number) => { selected = index; return true; } });
  assert.deepEqual(switcher.filteredLines(switcher.getContext()), [1]); assert.equal(selected, 0);
  switcher.release(); assert.equal(switcher.notesOnly, true);
  switcher.step(-1); assert.equal(selected, 1);
  start = 10; end = 11; assert.equal(switcher.step(1), false); assert.equal(selected, 1);
  switcher.reset(); assert.equal(switcher.notesOnly, false); assert.equal(switcher.eventsOnly, false);
  assert.equal(switcher.filterInputs.get('notesOnly').checked, false);
  assert.deepEqual(switcher.filteredLines(switcher.getContext()), [0, 1, 2]);
});

test('筛选后从多行缩到一行或零行，速览顶部位置不变', () => {
  const chart = createChart(); chart.judgeLineList = Array.from({ length: 30 }, () => createLine());
  chart.judgeLineList[1].notes = [createNote(1, 4, 0)];
  const tempo = new TempoMap(chart.BPMList);
  const switcher = Object.create(LineSwitcher.prototype);
  Object.assign(switcher, { cache: new Map(), active: true, enabled: true, stage: { clientWidth: 1200, clientHeight: 580 }, lastFrame: -Infinity,
    host: { style: { setProperty() {} } }, viewport: { style: {} }, content: { style: {} }, grid: { style: {} }, empty: {}, slider: { setAttribute() {} },
    scrollTo() {}, renderWindow() {}, getContext: () => ({ chart, tempo, seconds: 2, selected: 0, start: 1, end: 3, visible: true }) });
  switcher.draw(1000); const top = switcher.host.style.top; const height = switcher.viewport.style.height;
  switcher.notesOnly = true; switcher.draw(2000);
  assert.equal(switcher.indices.length, 1); assert.equal(switcher.host.style.top, top); assert.notEqual(switcher.viewport.style.height, height);
  switcher.eventsOnly = true; switcher.draw(3000);
  assert.equal(switcher.indices.length, 0); assert.equal(switcher.host.style.top, top);
});

test('拖滑条只改变浏览行，当前线可在视野外；回到跟随模式后包含当前线', () => {
  const manual = lineOverviewWindow(8, 101, 5, 3, 15);
  assert.equal(manual.firstRow, 15); assert.equal(manual.indices[0], 75); assert.ok(!manual.indices.includes(8));
  const followed = lineOverviewWindow(9, 101, 5, 3);
  assert.ok(followed.indices.includes(9)); assert.equal(followed.firstRow, 0);
  const end = lineOverviewWindow(8, 101, 5, 3, 10000);
  assert.equal(end.firstRow, end.maxRow); assert.ok(end.indices.includes(100));
  assert.equal(end.indices[0] % 5, 0);
  assert.equal(lineOverviewWindow(0, 2, 5, 3, 10).maxRow, 0);
  const switcher = Object.create(LineSwitcher.prototype);
  switcher.enabled = true; switcher.active = true; switcher.browseRow = 15; switcher.host = { hidden: false };
  switcher.draw = () => {};
  switcher.show(); assert.equal(switcher.browseRow, null); assert.equal(switcher.animateFollow, true);
});

/**
 * Restores a `globalThis` member the test replaced, or removes it when the test installed one where
 * none existed.
 *
 * The DOM lib declares these members non-optional, which makes `delete` a type error even though the
 * properties are configurable at runtime. The removal therefore goes through a `Partial` view of the
 * global, which is the honest annotation for "this key may be absent".
 */
function restoreGlobal(name: 'requestAnimationFrame' | 'cancelAnimationFrame', original: unknown): void {
  const target: Partial<Record<typeof name, unknown>> = globalThis;
  if (original) target[name] = original;
  else delete target[name];
}

test('跨行滚动在 140ms 内平滑到达，快速反向可中断且隐藏立即取消动画', context => {
  // The frame callback is optional because the code under test only registers it before the first
  // `callback(...)` call below; the assertions pin that down at each use.
  let callback: ((time: number) => void) | undefined; let cancelled = 0; const started = performance.now();
  context.mock.method(performance, 'now', () => started);
  // `requestAnimationFrame`/`cancelAnimationFrame` are optional on `globalThis` once removed, and the
  // original test deletes them again in the `finally` below.
  const originalRequest: typeof globalThis.requestAnimationFrame | undefined = globalThis.requestAnimationFrame;
  const originalCancel: typeof globalThis.cancelAnimationFrame | undefined = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = frame => { callback = frame; return 1; };
  globalThis.cancelAnimationFrame = () => { cancelled++; };
  try {
    const switcher = Object.create(LineSwitcher.prototype);
    Object.assign(switcher, { viewport: { scrollTop: 0 }, layout: { rows: 3 }, stride: 100, animation: null, renderWindow() {}, host: { hidden: false }, active: true });
    switcher.scrollTo(100, true); assert.equal(switcher.viewport.scrollTop, 0);
    assert.ok(callback);
    callback(started + 70); assert.ok(switcher.viewport.scrollTop > 50 && switcher.viewport.scrollTop < 100);
    const intermediate = switcher.viewport.scrollTop;
    switcher.scrollTo(0, true); assert.equal(switcher.viewport.scrollTop, intermediate); assert.equal(cancelled, 1);
    callback(started + 140); assert.equal(switcher.viewport.scrollTop, 0); assert.equal(switcher.animation, null);
    switcher.scrollTo(100, true); switcher.hide(); assert.equal(switcher.animation, null); assert.equal(switcher.host.hidden, true);
    switcher.scrollTo(10000, true); assert.equal(switcher.viewport.scrollTop, 10000); assert.equal(switcher.animation, null);
  } finally {
    // The globals are declared non-optional by the DOM lib, so `delete` is rejected even though the
    // property really is configurable at runtime. `restoreGlobal` below writes the original value
    // back, or removes the key when there was none, which is what the original `delete` did.
    restoreGlobal('requestAnimationFrame', originalRequest);
    restoreGlobal('cancelAnimationFrame', originalCancel);
  }
});

test('附近线索引按真实秒对齐 BPM 倍率，统计跨屏 Hold、各层和特殊事件', () => {
  const tempo = new TempoMap([{ bpm: 120, startTime: [0, 0, 1] }, { bpm: 240, startTime: [4, 0, 1] }]);
  const line = createLine(); line.bpmfactor = 2;
  line.notes = [createNote(1, 0, 0), createNote(2, 1, 100, 20), createNote(4, 8, -100)];
  line.eventLayers = [{ moveXEvents: [createEvent(0, 10, 0, 20)] }, { rotateEvents: [createEvent(0, 90, 8, 9)] }];
  line.extended = { textEvents: [createEvent('abc', 'abc', 0, 20)] };
  const seconds = tempo.seconds([8, 0, 1], 2);
  const index = new LineOverviewIndex(line, tempo, [createEvent(0, 0, 0, 20)]);
  const sample = index.sample(seconds - 0.1, seconds - 0.2, seconds + 0.2);
  assert.equal(sample.notes.length, 2); assert.equal(sample.events.length, 4);
  assert.equal(sample.notesLeft, 2); assert.equal(sample.eventsLeft, 4);
  // `notes` holds the entries whose item is a note; the type-4 note is in range, so the lookup
  // resolves. `Sample.notes` elements carry the item plus its resolved start.
  const crossScreen = sample.notes.find(entry => entry.item.type === 4);
  assert.ok(crossScreen);
  assert.equal(crossScreen.start, seconds);
  assert.equal(index.sample(100, 100, 110).notes.length, 0);
  assert.equal(index.sample(100, 100, 110).eventsLeft, 0);
  const layerOnly = new LineOverviewIndex(line, tempo, [], 1, false);
  assert.equal(layerOnly.sample(0, 0, 20).events.length, 1);
  const extendedOnly = new LineOverviewIndex(line, tempo, [], 0, true);
  assert.equal(extendedOnly.sample(0, 0, 20).events.length, 1);
});

test('旧热键配置缺项和无效项不阻塞其他快捷键；输入法 Process 按物理键识别', () => {
  // `MigratedPreferences.hotkeys` is the complete `DefaultHotkeys` map; the test deletes one entry to
  // model a legacy file that omitted it, so the map is viewed through the partial `HotkeySource` the
  // lookup itself accepts.
  const preferences = migratePreferences(); const hotkeys: HotkeySource = preferences.hotkeys;
  delete hotkeys.ClipboardHistory;
  const source = { hotkeys };
  for (const [code, expected] of [['KeyQ', 'AddTap'], ['KeyW', 'AddDrag'], ['KeyA', 'NumberMirror'], ['KeyS', 'NumberFill'], ['KeyI', 'StartView'], ['KeyO', 'EndView'], ['Escape', 'Esc']]) {
    assert.equal(shortcutAction({ key: 'Process', code, isComposing: true }, source), expected);
  }
  assert.equal(shortcutAction({ key: 'Process', code: 'KeyV', ctrlKey: true, isComposing: true }, source), 'Paste');
  assert.equal(shortcutMatches({ key: 'q' }, null), false);
  assert.equal(shortcutReleased({ key: 'Process', code: 'KeyT', isComposing: true }, 'T'), true);
  // `HotkeySource` entries are `string | null | undefined`, which is exactly the "invalid entry"
  // case: a numeric shortcut is treated as a miss so the default applies.
  assert.equal(shortcutAction({ key: 'w' }, { hotkeys: { AddTap: 42 as unknown as string } }), 'AddDrag');
});

test('非文本控件触发快捷键时结束编辑锁，文本输入和输入法编辑不丢焦点', () => {
  let blurred = 0;
  // `closest` receives the selector the keyboard helper probes with; the doubles below echo
  // themselves back for the one selector each models.
  const control = { closest: (selector: string) => selector === 'input,select,button' ? control : null, blur: () => blurred++ };
  releaseShortcutFocus(control); assert.equal(blurred, 1); assert.equal(isTypingText(control), false);
  const text = { type: 'text', closest: (selector: string) => selector === 'input' ? text : null, blur: () => blurred++ };
  releaseShortcutFocus(text); assert.equal(blurred, 1); assert.equal(isTypingText(text), true);
  assert.equal(isTypingText({ isContentEditable: true }), true);
});
