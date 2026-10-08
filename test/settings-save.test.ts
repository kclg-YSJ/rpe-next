import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_HOTKEYS, migratePreferences, shortcutAction, shortcutMatches } from '../src/core/preferences.ts';
import { parseShortcut } from '../src/core/shortcut-spec.ts';
import { HOTKEY_LABELS, validateHotkeys, recordedShortcut } from '../src/core/hotkey-settings.ts';
import { ManualSaveQueue } from '../src/application/manual-save.ts';
import { History } from '../src/application/history.ts';
import { normalizeEditorPreferences } from '../src/platform/editor-preferences.ts';
import { Preview } from '../src/ui/preview.ts';
import { PasteGesture } from '../src/ui/paste-gesture.ts';
import type { PasteContext } from '../src/ui/paste-gesture.ts';
import type { Chart } from '../src/core/types.ts';
import type { ProjectImages } from '../src/platform/images.ts';
import type { RpeSkin } from '../src/ui/skin.ts';

/**
 * The gesture context these tests pass.
 *
 * `PasteGesture.down` declares the full `PasteContext`, but the callbacks below never read it — the
 * gesture only carries it to `paste`/`open` — so the empty stand-in is named here and cast at the
 * call site, exactly as `selection-shortcuts.test.ts` does for the same argument.
 */
type PasteContextDouble = Partial<PasteContext>;

/** The `{ chart }` project a save writes, and the snapshot carrying it plus the saved document. */
interface SavedProject { chart: Chart }
interface SaveSnapshot { document: Chart; project: SavedProject }

/**
 * A stand-in document for `History`.
 *
 * `History` is declared over `Chart`, but these tests only round-trip a `{ value }` marker through
 * `document`/`commit`/`markSaved` and never read a chart field. Staged as `unknown` and bridged in
 * this one documented place rather than growing the marker into a full `Chart`.
 */
function historyDocument(marker: unknown): Chart {
  const document: Chart = marker as Chart;
  return document;
}

/** The 2D-context recorder `Preview.drawLine` draws into; only the methods it calls are supplied. */
interface RecordingContext {
  save(): void;
  restore(): void;
  scale(): void;
  fillRect(...args: unknown[]): void;
  drawImage(...args: unknown[]): void;
}

/** The `drawLine` signature's parameters, named once so the doubles below can be bridged to them. */
type DrawLineContext = Parameters<Preview['drawLine']>[0];
type DrawLineSource = Parameters<Preview['drawLine']>[1];
type DrawLineState = Parameters<Preview['drawLine']>[2];

/** `drawLine` declares a real 2D context; the recorder is bridged through `unknown` here. */
function canvasContext(context: RecordingContext): DrawLineContext {
  const open: unknown = context;
  const bridged: DrawLineContext = open as DrawLineContext;
  return bridged;
}

/**
 * The judge-line stand-in `drawLine` receives.
 *
 * Its `JudgeLineSource` slice requires `Texture`, while the default-texture path under test is
 * precisely the case with no texture name, so the empty record is staged as `unknown` and bridged
 * here instead of gaining a field it never had at runtime.
 */
function lineSource(line: unknown): DrawLineSource {
  const bridged: DrawLineSource = line as DrawLineSource;
  return bridged;
}

/**
 * The sampled line state `drawLine` reads.
 *
 * `TintedLineState` is not exported, and it names members (position, rotation, text) this test never
 * supplies because the drawn path reads only `scaleX`/`scaleY`/`alpha`/`color`; the partial is
 * bridged through `unknown` rather than padded out with values the original never passed.
 */
function lineState(state: unknown): DrawLineState {
  const bridged: DrawLineState = state as DrawLineState;
  return bridged;
}

/** `Preview` declares a real canvas element; these tests never draw to it, so `{}` is bridged here. */
function previewCanvas(double: unknown): HTMLCanvasElement {
  const bridged: HTMLCanvasElement = double as HTMLCanvasElement;
  return bridged;
}

test('默认热键全部有名称，允许区域、长短按和选择状态复用', () => {
  assert.deepEqual(Object.keys(HOTKEY_LABELS).sort(), Object.keys(DEFAULT_HOTKEYS).sort());
  const result = validateHotkeys(DEFAULT_HOTKEYS);
  assert.equal(result.valid, true);
  assert.equal(result.issues.filter(issue => issue.severity === 'info').length, 4);
  const preferences = migratePreferences();
  assert.equal(shortcutAction({ key: 'r' }, preferences, 'notes'), 'AddHold');
  assert.equal(shortcutAction({ key: 'r' }, preferences, 'events'), 'AddEvent');
  assert.equal(shortcutAction({ key: 'ArrowLeft' }, preferences), 'LastBeat');
  assert.equal(shortcutAction({ key: 'ArrowLeft' }, preferences, 'notes', { hasSelection: true }), 'PageLeft');
});

test('按语义检查冲突，左右修饰键等价，额外修饰键可区分', () => {
  assert.equal(validateHotkeys({ ...DEFAULT_HOTKEYS, Save: 'rightctrl + z' }).valid, false);
  assert.equal(validateHotkeys({ ...DEFAULT_HOTKEYS, Save: 'Ctrl+Alt+S' }).valid, true);
  assert.equal(shortcutMatches({ key: 's', ctrlKey: true, altKey: true }, 'CTRL&S'), false);
  assert.equal(validateHotkeys({ ...DEFAULT_HOTKEYS, AddEvent: 'Q' }).valid, false);
  assert.equal(validateHotkeys({ ...DEFAULT_HOTKEYS, AddEvent: 'W' }).valid, true);
  assert.equal(validateHotkeys({ ...DEFAULT_HOTKEYS, Save: '/' }).valid, false);
});

test('录入校验非法组合、重复键、标点以及 Shift 数字', () => {
  for (const value of ['Ctrl', 'Ctrl++S', 'S&S', 'S&D', 'InvalidKey']) assert.ok(parseShortcut(value).error);
  assert.equal(recordedShortcut({ key: 'Control', ctrlKey: true }), null);
  assert.equal(recordedShortcut({ key: '!', code: 'Digit1', shiftKey: true })!.value, 'LEFTSHIFT&1');
  assert.equal(shortcutMatches({ key: '!', code: 'Digit1', shiftKey: true }, 'SHIFT&1'), true);
  assert.equal(recordedShortcut({ key: '/', code: 'Slash', ctrlKey: true })!.value, 'LEFTCTRL&SLASH');
  assert.ok(recordedShortcut({ key: 'Process', isComposing: true })!.error);
});

test('清除热键可跨重启保留，重新绑定暂停后原空格不匹配', () => {
  const preferences = migratePreferences('{}', 'AddDrag\nPause CTRL+P\nFutureAction Z');
  assert.equal(preferences.hotkeys.AddDrag, '');
  assert.equal(shortcutAction({ key: 'w' }, preferences), undefined);
  assert.equal(shortcutMatches({ key: ' ' }, preferences.hotkeys.Pause), false);
  assert.equal(shortcutMatches({ key: 'p', ctrlKey: true }, preferences.hotkeys.Pause), true);
  assert.equal(preferences.originalHotkeys.FutureAction, 'Z');
});

test('重绑长按粘贴组合键后，释放 Shift / Alt 也会清理手势', () => {
  const noContext: PasteContextDouble = {};
  for (const [modifier, released] of [['shiftKey', 'Shift'], ['altKey', 'Alt']]) {
    let pasted = 0;
    const gesture = new PasteGesture({ paste: () => pasted++, open() {}, valid: () => true, schedule: () => 1, unschedule() {} });
    gesture.down({ key: 'g', [modifier]: true, preventDefault() {} }, noContext as PasteContext);
    assert.equal(gesture.up({ key: released, preventDefault() {} }), true);
    assert.equal(pasted, 1); assert.equal(gesture.pending, null);
  }
});

test('手动保存推迟工作、复用未完成请求，保存期间编辑仍保持未保存状态', async () => {
  const scheduled: Array<() => void> = []; const writes: SavedProject[] = []; const original = { value: 1 }; const history = new History(historyDocument(original));
  const next = { value: 2 }; history.commit('edit', historyDocument(next));
  // `ManualSaveQueue` takes its project type from the writer; the snapshot shape is inferred from the
  // capture closure at each `save` call, which is what lets it carry the extra `document` field.
  const queue = new ManualSaveQueue<SavedProject>(async project => writes.push(project), callback => scheduled.push(callback));
  const capture = (): SaveSnapshot => ({ document: history.document, project: { chart: history.document } });
  const complete = (snapshot: SaveSnapshot): void => history.markSaved(snapshot.document);
  const first = queue.save(history, capture, complete);
  assert.equal(queue.save(history, capture, complete), first);
  assert.equal(writes.length, 0);
  history.commit('edit during save', historyDocument({ value: 3 }));
  await scheduled.shift()!(); await first;
  assert.equal(writes[0].chart, next); assert.equal(history.dirty, true);
  history.undo(); assert.equal(history.dirty, false);
});

test('后台写入失败保留脏状态且可重试，不同谱面互不阻塞', async () => {
  const scheduled: Array<() => void> = []; let fail = true;
  const queue = new ManualSaveQueue<SavedProject>(async () => { if (fail) throw new Error('quota'); }, callback => scheduled.push(callback));
  const first = new History(historyDocument({})); first.commit('edit', historyDocument({})); const second = new History(historyDocument({})); second.commit('edit', historyDocument({}));
  const save = (history: History) => queue.save(history, () => ({ project: { chart: history.document }, document: history.document }), (snapshot: SaveSnapshot) => history.markSaved(snapshot.document));
  const failed = assert.rejects(save(first), /quota/);
  const other = assert.rejects(save(second), /quota/);
  assert.equal(scheduled.length, 2);
  await scheduled.shift()!(); await scheduled.shift()!(); await failed; await other;
  assert.equal(first.dirty, true); assert.equal(second.dirty, true);
  fail = false; const retried = save(first); await scheduled.shift()!(); await retried;
  assert.equal(first.dirty, false); assert.equal(second.dirty, true);
});

test('判定线粗细持久化、迁移并实时绘制，不改变自定义图片尺寸', () => {
  globalThis.devicePixelRatio = 1;
  assert.equal(normalizeEditorPreferences({ lineScale: 20 }).lineScale, 10);
  assert.equal(migratePreferences('{"LineScale":2}').settings.lineScale, 2);
  const calls: unknown[][] = [];
  const context: RecordingContext = { save() {}, restore() {}, scale() {}, fillRect(...args: unknown[]) { calls.push(args); }, drawImage(...args: unknown[]) { calls.push(args.slice(1)); } };
  const preview = new Preview(previewCanvas({})); const state = lineState({ scaleX: 1, scaleY: 1, color: [255, 255, 255], alpha: 255 });
  preview.drawLine(canvasContext(context), lineSource({}), state, 1); assert.equal(calls.at(-1)![3], 7.5);
  preview.lineScale = 2; preview.drawLine(canvasContext(context), lineSource({}), state, 1); assert.equal(calls.at(-1)![3], 10);
  // `Preview.images`/`Preview.skin` are declared as the `ProjectImages`/`RpeSkin` classes, but
  // `drawLine` only reaches for `images.get` and `tintedSource`, so the bare stubs are staged as
  // `unknown` and bridged in these two documented places.
  const store: unknown = { images: new Map([['custom.png', { width: 120, height: 80 }]]) };
  preview.images = store as ProjectImages;
  const skin: unknown = { tintedSource: (key: string, texture: unknown) => texture };
  preview.skin = skin as RpeSkin;
  preview.drawLine(canvasContext(context), lineSource({ Texture: 'custom.png' }), state, 1); assert.deepEqual(calls.at(-1), [-60, -40, 120, 80]);
});
