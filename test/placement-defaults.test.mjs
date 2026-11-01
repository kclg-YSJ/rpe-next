import test from 'node:test';
import assert from 'node:assert/strict';
import { createChart, createLine, createNote, assertChart } from '../src/core/chart.mjs';
import { DEFAULT_NOTE_PLACEMENT, DEFAULT_LINE_EVENTS, normalizeNoteDefaults, normalizeLineDefaults, createPlacedNote, createPlacedLine } from '../src/core/placement-defaults.mjs';
import { EditorSession } from '../src/application/session.mjs';
import { ensureLineCount, duplicateLine } from '../src/application/line-commands.mjs';
import { readEditorPreferences, writeEditorPreferences } from '../src/platform/editor-preferences.mjs';
import { Timeline } from '../src/ui/timeline.mjs';
import { generateCurveNotes } from '../src/core/curve-notes.mjs';
import { quickCurveNotes } from '../src/core/quick-curve.mjs';
import { trackedNoteEvents, noteTrackingChart } from '../src/application/note-tracking.mjs';
import { TempoMap } from '../src/core/tempo.mjs';
import { SceneRuntime } from '../src/core/scene.mjs';
import { noiseTrackingTarget } from '../src/core/noise-tracking.mjs';

const noteSettings = { above: 2, isFake: 1, speed: .75, size: 1.5, judgeArea: .8, alpha: 180, yOffset: 80, visibleTime: 3,
  tint: [100, 180, 240], tintHitEffects: [250, 160, 80], hitsound: 'sounds/tap.ogg' };
const lineSettings = { moveXEvents: 120, moveYEvents: -80, rotateEvents: 35, alphaEvents: -2, speedEvents: 7.5 };

test('放置默认值与既有构造器一致，音符类型/坐标/拍数不被默认值覆盖，Hold 下方编码正确', () => {
  for (const type of [1, 2, 3, 4]) assert.deepEqual(createPlacedNote(type, 2, 135, 4), createNote(type, 2, 135, 4));
  const note = createPlacedNote(2, 2, -135, 4, { ...noteSettings, type: 1, positionX: 0, startTime: [0, 0, 1], endTime: [0, 0, 1], lineIndex: 8 });
  assert.equal(note.type, 2); assert.equal(note.positionX, -135); assert.deepEqual(note.startTime, [2, 0, 1]); assert.deepEqual(note.endTime, [4, 0, 1]);
  assert.equal(note.above, 0); assert.equal(Object.hasOwn(note, 'lineIndex'), false);
  for (const key of Object.keys(noteSettings).filter(key => key !== 'above')) assert.deepEqual(note[key], noteSettings[key]);
  assert.equal(createPlacedNote(1, 2, 0, undefined, noteSettings).above, 2);
  const second = createPlacedNote(2, 2, 0, 4, noteSettings); note.tint[0] = 0; assert.equal(second.tint[0], 100); assert.equal(noteSettings.tint[0], 100);
});

test('默认值校验拒绝无效值与未知字段，允许负流速与判定线负透明度，不继承原型值', () => {
  const notes = normalizeNoteDefaults({ size: 0, judgeArea: NaN, visibleTime: -1, speed: NaN, alpha: 200.8, tint: [0, 256, 0], hitsound: {}, type: 2 });
  assert.equal(notes.size, 1); assert.equal(notes.judgeArea, 1); assert.equal(notes.visibleTime, 999999); assert.equal(notes.speed, 1); assert.equal(notes.alpha, 200);
  assert.deepEqual(notes.tint, [255, 255, 255]); assert.equal(notes.hitsound, ''); assert.equal(Object.hasOwn(notes, 'type'), false);
  assert.equal(normalizeNoteDefaults({ speed: -2 }).speed, -2); assert.equal(normalizeNoteDefaults({ alpha: -2 }).alpha, 0);
  assert.equal(normalizeNoteDefaults({ judgeArea: 0 }).judgeArea, 0); assert.equal(normalizeNoteDefaults({ judgeArea: -1 }).judgeArea, -1);
  assert.deepEqual(normalizeLineDefaults({ moveXEvents: NaN, speedEvents: Infinity }), DEFAULT_LINE_EVENTS);
  assert.equal(normalizeLineDefaults({ alphaEvents: -2.5 }).alphaEvents, -2); assert.equal(normalizeLineDefaults({ alphaEvents: 999 }).alphaEvents, 255);
  assert.equal(normalizeLineDefaults(Object.create({ speedEvents: 12 })).speedEvents, 10);
  assert.equal(normalizeNoteDefaults(Object.create({ hitsound: 'bad.wav', tint: [0, 0, 0] })).hitsound, '');
});

test('修改默认参数不改已有谱面、不进历史；新增音符可撤销重做，复制内容保留原属性，重新会话恢复音符默认值', () => {
  const chart = createChart(), oldNote = createNote(1, 1, 0); chart.judgeLineList[0].notes = [oldNote];
  const session = new EditorSession(chart), before = session.chart; session.noteDefaults = normalizeNoteDefaults(noteSettings); session.lineEventDefaults = normalizeLineDefaults(lineSettings);
  assert.equal(session.chart, before); assert.equal(session.history.dirty, false);
  const placed = session.createNote(1, 4, 270); session.insertNotes([placed]);
  assert.equal(session.notes[0], oldNote); assert.equal(oldNote.size, 1); assert.equal(session.notes[1].size, 1.5);
  session.travel('undo'); assert.equal(session.chart, before); session.travel('redo'); assert.equal(session.notes[1].size, 1.5);
  session.insertNotes([{ ...oldNote, startTime: [5, 0, 1], endTime: [5, 0, 1] }]); assert.equal(session.notes.at(-1).speed, 1);
  assert.deepEqual(new EditorSession(session.chart).noteDefaults, normalizeNoteDefaults());
  assert.equal(createNote(1, 0, 0).speed, 1); assert.equal(createLine().eventLayers[0].speedEvents[0].start, 10);
});

test('单条及批量新线在第零拍生成相同首尾垫底值，现有线/复制线/导入线不受影响，支持撤销重做', () => {
  const chart = createChart(), session = new EditorSession(chart, { lineEventDefaults: lineSettings }), old = chart.judgeLineList[0];
  session.addLine(); assert.equal(session.chart.judgeLineList[0], old);
  const line = session.line;
  for (const [key, value] of Object.entries(lineSettings)) {
    const event = line.eventLayers[0][key][0]; assert.equal(event.start, value); assert.equal(event.end, value);
    assert.deepEqual(event.startTime, [0, 0, 1]); assert.deepEqual(event.endTime, [1, 0, 1]);
  }
  session.travel('undo'); assert.equal(session.chart, chart); session.travel('redo'); assert.equal(session.line, line);
  const next = ensureLineCount(session.chart, 5, session.lineEventDefaults); assertChart(next);
  for (const added of next.judgeLineList.slice(2)) assert.deepEqual(added.eventLayers, line.eventLayers);
  next.judgeLineList[2].eventLayers[0].moveXEvents[0].start = 5; assert.equal(next.judgeLineList[3].eventLayers[0].moveXEvents[0].start, 120);
  assert.equal(duplicateLine(next, 0).judgeLineList.at(-1).eventLayers[0].speedEvents[0].start, 10);
  assert.equal(new EditorSession(chart, { lineEventDefaults: lineSettings }).chart, chart);
  assert.deepEqual(createPlacedLine('A').eventLayers, createLine('A').eventLayers);
});

test('仅判定线默认值通过浏览器/桌面统一偏好层持久化，音符默认值不会写入设置', () => {
  const saved = new Map(), storage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) };
  writeEditorPreferences({ lineEventDefaults: lineSettings, noteDefaults: noteSettings }, storage);
  const loaded = readEditorPreferences(storage); assert.deepEqual(loaded.lineEventDefaults, lineSettings); assert.equal(Object.hasOwn(loaded, 'noteDefaults'), false);
  writeEditorPreferences({ ...loaded, lineEventDefaults: DEFAULT_LINE_EVENTS }, storage); assert.deepEqual(readEditorPreferences(storage).lineEventDefaults, DEFAULT_LINE_EVENTS);
  storage.setItem('rpe-next-editor-v1', JSON.stringify({ lineEventDefaults: { moveXEvents: 10, speedEvents: null, ignored: 6 } }));
  assert.deepEqual(readEditorPreferences(storage).lineEventDefaults, { ...DEFAULT_LINE_EVENTS, moveXEvents: 10 });
});

test('普通和多线光标放置、Hold 两端放置及直接放置沿用音符默认属性，直接放置的上下侧优先', () => {
  const canvas = { clientWidth: 900, clientHeight: 600, style: {}, addEventListener() {} }, session = new EditorSession();
  session.noteDefaults = normalizeNoteDefaults(noteSettings); const timeline = new Timeline(canvas, canvas, () => session, () => {}, () => {});
  timeline.cursor = { x: timeline.noteHorizontal(135), y: timeline.vertical(2) }; timeline.addAtCursor(1);
  assert.equal(session.notes[0].size, 1.5); assert.equal(session.notes[0].above, 2); assert.equal(session.notes[0].positionX, 135);
  session.addLine(); session.setMultiLineEnabled(true, 'notes'); session.addMultiLine(0); timeline.cursorLineIndex = 0; timeline.addAtCursor(3);
  assert.equal(session.chart.judgeLineList[0].notes.at(-1).type, 3); assert.equal(session.chart.judgeLineList[0].notes.at(-1).hitsound, 'sounds/tap.ogg');
  timeline.cursorLineIndex = 1; timeline.addAtCursor(2); timeline.cursor.y = timeline.vertical(4); timeline.addAtCursor(2);
  assert.equal(session.chart.judgeLineList[1].notes[0].above, 0); assert.equal(session.chart.judgeLineList[1].notes[0].alpha, 180);
  session.setMultiLineEnabled(false); timeline.cursorLineIndex = 1;
  timeline.noteView = { flow: true, sideAt: y => y < 300 ? 1 : -1, timeAt: y => y / 100, originX: 300, pixelsPerUnit: .5 };
  timeline.cursor = { x: 300, y: 200 }; timeline.addAtCursor(1); assert.equal(session.notes.at(-1).above, 1); assert.equal(session.notes.at(-1).size, 1.5);
  timeline.cursor.y = 400; timeline.addAtCursor(4); assert.equal(session.notes.at(-1).above, 2);
});

test('曲线填充与中键黄条的新音符使用同一属性默认值，中键仍跟随源音符的上下方向', () => {
  const notes = generateCurveNotes({ startTime: [1, 0, 1], endTime: [2, 0, 1], startX: -100, endX: 100, noteDefaults: noteSettings });
  assert.equal(notes.length, 3); assert.ok(notes.every(note => note.size === 1.5 && note.above === 2 && note.alpha === 180));
  const quick = quickCurveNotes(createNote(1, 1, 0), [2, 0, 1], 100, { noteDefaults: noteSettings });
  assert.ok(quick.every(note => note.size === 1.5 && note.above === 1 && note.hitsound === 'sounds/tap.ogg'));
  assert.equal(DEFAULT_NOTE_PLACEMENT.visibleTime, 999999);
});

test('追踪新增线使用自定义垫底值，生成至高层时补偿底层移动旋转而不产生坐标偏差', () => {
  const chart = createChart(); chart.judgeLineList[0].notes = [createNote(1, 4, 135)];
  const tempo = new TempoMap(chart.BPMList), generated = trackedNoteEvents(chart, tempo, { target: { lineIndex: 0, noteIndex: 0 }, start: 0, end: 3, lineIndex: -1, layer: 2, lineDefaults: { ...lineSettings, alphaEvents: 180 } });
  const next = noteTrackingChart(chart, generated, false, tempo), runtime = new SceneRuntime(); runtime.compile(next, tempo);
  assert.equal(next.judgeLineList[1].eventLayers[0].speedEvents[0].start, 7.5); assert.equal(next.judgeLineList[1].eventLayers[0].moveXEvents[0].start, 120);
  const source = noiseTrackingTarget(chart, tempo, { mode: 'note', lineIndex: 0, noteIndex: 0 });
  for (const seconds of [0, .2, .6, 1.2]) {
    const a = source.sample(seconds), b = runtime.sampler(seconds)(1); assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < .25); assert.ok(Math.abs(a.rotation - b.rotation) < .03);
  }
});
