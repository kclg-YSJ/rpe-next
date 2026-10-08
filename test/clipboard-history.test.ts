import test from 'node:test';
import assert from 'node:assert/strict';
import { ClipboardHistory } from '../src/application/clipboard-history.ts';
import type { ClipboardHistorySession } from '../src/application/clipboard-history.ts';
import { copyObjects, deleteObjects, pasteObjects } from '../src/application/clipboard.ts';
import { captureSelection, selectionScaleAnchor } from '../src/application/batch-edit.ts';
import type { SelectionSnapshot } from '../src/application/batch-edit.ts';
import { EditorSession } from '../src/application/session.ts';
import { createChart, createNote } from '../src/core/chart.ts';
import { LineRuntime } from '../src/core/scene.ts';
import { TempoMap } from '../src/core/tempo.ts';
import { recentHits } from '../src/core/hit-effects.ts';
import { hitParticles } from '../src/core/editor-display.ts';
import { migratePreferences, shortcutAction } from '../src/core/preferences.ts';
import { normalizeEditorPreferences } from '../src/platform/editor-preferences.ts';
import { BatchControls } from '../src/ui/batch-controls.ts';

function sessionWithNote(position = 0) {
  const chart = createChart(); chart.judgeLineList[0].notes = [createNote(1, 1, position)];
  const session = new EditorSession(chart); session.selection.add(0); copyObjects(session); return session;
}

/**
 * The classes this file drives with `Object.create(X.prototype)` plus hand-written fields.
 *
 * The doubles below are the only members the test touches; typing them here keeps the partial
 * instance honest instead of asserting it into the real class.
 */
interface BatchActiveDouble {
  session: EditorSession;
  snapshot: SelectionSnapshot;
  kind: string;
  button: { style: object };
  canvas: { clientHeight: number };
  factor: number;
  start: { x: number; y: number };
  point: { x: number; y: number };
  unit: number;
  startBeat: number;
  startX: number;
  area: string;
}

/** The `timeline` stand-in `BatchControls.update`/`cancel` read and write. */
interface BatchTimelineDouble {
  tempo: TempoMap;
  origin: number;
  scale: number;
  division: number;
  positionAt(value: number): number;
  changed(): void;
  scaleAxis?: number | null;
  bulkPreview?: unknown;
}

/** `BatchControls` restricted to the instance state this test installs on the prototype object. */
interface BatchControlsDouble {
  active: BatchActiveDouble | null;
  timeline: BatchTimelineDouble;
  groups: Map<string, { hint: object }>;
  anchorMode: number;
  returnBall(active: BatchActiveDouble): void;
  update(): void;
  cancel(): void;
}

/**
 * `EditorSession` plus the `clipboardVisible` flag `ClipboardHistory.attach` creates on the first
 * copy, viewed through the structural interface the history itself declares.
 */
type ClipboardSession = EditorSession & ClipboardHistorySession;

test('fake Drag 或 Hold 离开回溯窗口后，真实音符的粒子种子和方向保持不变', () => {
  const chart = createChart(); const real = createNote(4, 0.6, 0);
  chart.judgeLineList[0].notes = [{ ...createNote(4, 0, -100), isFake: 1 }, createNote(2, 0.1, 100, 3), real, { ...createNote(2, 0, 0, 3), isFake: 1 }];
  const runtime = new LineRuntime(chart.judgeLineList[0], new TempoMap(chart.BPMList));
  const ages = [0.6, 0.7, 0.76, 0.9];
  const hits = ages.map(seconds => recentHits(runtime, seconds, -Infinity).find(hit => hit.entry.note === real));
  // Every age in `ages` is inside the effect lifetime, so no lookup is `undefined`; assert it so the
  // later reads of `hits[0]` and of each `hit` narrow to a real sample.
  assert.ok(hits.every((hit): hit is NonNullable<typeof hit> => hit !== undefined));
  assert.ok(hits.every(hit => hit && hit.seed === hits[0].seed));
  for (const seconds of ages) assert.ok(recentHits(runtime, seconds, -Infinity).every(hit => !hit.entry.note.isFake));
  const directions = hits.map((hit, index) => hitParticles(ages[index] - hit.time, hit.seed, 175).map(particle => Math.atan2(particle.y, particle.x)));
  for (const direction of directions) direction.forEach((angle, index) => assert.ok(Math.abs(angle - directions[0][index]) < 1e-10));
});

test('历史记录去重、保留固定项、淘汰最早未固定项；全部固定仍可复制当前内容', () => {
  const history = new ClipboardHistory(3); const first = sessionWithNote(1); history.remember(first);
  const firstId = history.entries[0].id; history.pin(firstId);
  history.remember(sessionWithNote(2)); const secondId = history.entries[0].id;
  history.remember(sessionWithNote(3)); history.remember(sessionWithNote(4));
  assert.equal(history.entries.length, 3); assert.ok(history.entries.some(entry => entry.id === firstId));
  assert.ok(!history.entries.some(entry => entry.id === secondId));
  history.remember(first); assert.equal(history.entries[0].id, firstId); assert.equal(history.entries[0].pinned, true);
  for (const entry of history.entries) if (!entry.pinned) history.pin(entry.id);
  history.remember(sessionWithNote(5)); assert.equal(history.entries.length, 3); assert.equal(history.current.notes[0].positionX, 5);
  assert.equal(history.activeId, null);
});

test('历史组跨谱复用、独立深复制、当前清空不删除记录，也不影响谱面撤销栈', () => {
  const history = new ClipboardHistory(); const source = sessionWithNote(100);
  source.eventSelection.add('moveXEvents:0'); copyObjects(source); history.remember(source);
  const id = history.entries[0].id; const target = new EditorSession();
  // `clipboardVisible` is created by the history on attach rather than declared on the session, so
  // the target is viewed through the interface `ClipboardHistory` itself declares.
  const targetSession: ClipboardSession = target;
  history.attach(target); assert.equal(target.clipboard.length, 1); assert.equal(target.eventClipboard.length, 1);
  history.clearCurrent(target); assert.equal(target.clipboard.length, 0); assert.equal(targetSession.clipboardVisible, false);
  assert.equal(history.entries.length, 1); assert.equal(target.history.undoStack.length, 0);
  history.use(target, id); target.clipboard[0].positionX = 333;
  assert.equal(history.entries[0].notes[0].positionX, 100);
  history.use(target, id); pasteObjects(target, 8);
  assert.equal(target.notes[0].positionX, 100); assert.equal(target.history.undoStack.length, 1);
  history.remove(id); assert.equal(history.entries.length, 0); assert.equal(target.clipboard.length, 1);
});

test('关闭历史只停止记录，普通剪贴板继续可用；恢复数据不覆盖加载期间的编辑', () => {
  const history = new ClipboardHistory(); history.remember(sessionWithNote(100));
  const saved = structuredClone(history.entries); history.enabled = false; history.remember(sessionWithNote(200));
  assert.equal(history.entries.length, 1); assert.equal(history.current.notes[0].positionX, 200);
  assert.equal(history.use(new EditorSession(), saved[0].id), false);
  const restored = new ClipboardHistory(); restored.restore(saved); assert.deepEqual(restored.entries, saved);
  saved[0].notes[0].positionX = 999; assert.equal(restored.entries[0].notes[0].positionX, 100);
  restored.remember(sessionWithNote(300)); restored.restore(saved); assert.equal(restored.entries[0].notes[0].positionX, 300);
  restored.pin(restored.entries[1].id); restored.clearUnpinned(); assert.equal(restored.entries.length, 1);
  assert.equal(normalizeEditorPreferences({ clipboardHistory: false }).clipboardHistory, false);
});

test('删除混合选择不覆盖剪贴板，所有物件一步撤销', () => {
  const session = sessionWithNote(); session.eventSelection.add('moveXEvents:0');
  const original = session.chart; const clipboard = session.clipboard;
  assert.equal(deleteObjects(session), 2); assert.equal(session.notes.length, 0);
  // `EditorSession.line` is optional because a chart may have no line at `lineIndex`, and the delete
  // above replaced the document, so the line has to be read after it. `eventLayers` entries are
  // `Partial<Record<AnyEventType, ChartEvent[]>>`, so the track itself is optional too.
  const line = session.line;
  assert.ok(line);
  assert.equal((line.eventLayers[0].moveXEvents ?? []).length, 0); assert.equal(session.clipboard, clipboard);
  assert.equal(session.history.undoStack.length, 1); session.travel('undo'); assert.equal(session.chart, original);
});

test('剪贴板历史与普通粘贴共用 Ctrl+V，由长按区分，不冲突保持时间粘贴', () => {
  const preferences = migratePreferences();
  assert.equal(preferences.hotkeys.ClipboardHistory, 'LEFTCTRL&V');
  assert.equal(shortcutAction({ key: 'v', ctrlKey: true }, preferences), 'Paste');
  assert.equal(shortcutAction({ key: 'v', ctrlKey: true, shiftKey: true }, preferences), 'KeepTimePaste');
});

test('物件组名称可持久化，重复复制保留名称，改名不改变当前剪贴板', () => {
  const history = new ClipboardHistory(); const session = sessionWithNote(100); history.remember(session);
  const id = history.entries[0].id; const current = structuredClone(history.current);
  history.rename(id, '  开场音符  '); assert.equal(history.entries[0].name, '开场音符');
  history.remember(session); assert.equal(history.entries.length, 1); assert.equal(history.entries[0].name, '开场音符');
  const restored = new ClipboardHistory(); restored.restore(history.entries);
  assert.equal(restored.entries[0].name, '开场音符'); assert.deepEqual(history.current, current);
  history.rename(id, '长'.repeat(60)); assert.equal(history.entries[0].name.length, 40);
  history.rename(id, ' '); assert.equal(history.entries[0].name, '');
});

test('缩放轴和实际锚点一致，仅在缩放拖动期间出现，取消立即移除', () => {
  const session = sessionWithNote(-200); session.insertNotes([createNote(1, 4, 100)]); session.selection = new Set([0, 1]);
  const snapshot = captureSelection(session);
  assert.equal(selectionScaleAnchor(snapshot), -50); assert.equal(selectionScaleAnchor(snapshot, 1), -200); assert.equal(selectionScaleAnchor(snapshot, 2), 100);
  // The control balls are driven here without a DOM, so the instance is built from the prototype and
  // only the fields `update`/`cancel` read are written. `BatchControlsDouble` names exactly those.
  const controls: BatchControlsDouble = Object.create(BatchControls.prototype);
  const button = { style: {} }; const canvas = { clientHeight: 600 };
  controls.active = { session, snapshot, kind: 'note-scale', button, canvas, factor: 1, start: { x: 100, y: 200 }, point: { x: 120, y: 200 }, unit: 1, startBeat: 0, startX: 100, area: 'notes' };
  controls.timeline = { tempo: new TempoMap(session.chart.BPMList), origin: 0, scale: 500, division: 4, positionAt: (value: number) => value, changed() {} };
  controls.groups = new Map([['notes', { hint: {} }]]); controls.anchorMode = 0; controls.returnBall = () => {};
  controls.update(); assert.equal(controls.timeline.scaleAxis, -50);
  controls.anchorMode = 1; controls.update(); assert.equal(controls.timeline.scaleAxis, -200);
  const active = controls.active;
  assert.ok(active);
  active.kind = 'note-move'; controls.update(); assert.equal(controls.timeline.scaleAxis, null);
  active.kind = 'note-scale'; controls.update(); controls.cancel();
  assert.equal(controls.timeline.scaleAxis, null); assert.equal(controls.timeline.bulkPreview, null);
});
