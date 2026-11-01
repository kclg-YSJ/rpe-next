import test from 'node:test';
import assert from 'node:assert/strict';
import { NotePreview } from '../src/core/note-preview.mjs';
import { SceneRuntime } from '../src/core/scene.mjs';
import { createChart, createLine, createNote, createEvent } from '../src/core/chart.mjs';
import { TempoMap } from '../src/core/tempo.mjs';
import { fromNumber } from '../src/core/beat.mjs';
import { simultaneousNotes } from '../src/core/editor-display.mjs';
import { recentHits } from '../src/core/hit-effects.mjs';
import { Timeline } from '../src/ui/timeline.mjs';
import { EditorSession } from '../src/application/session.mjs';
import { normalizeEditorPreferences } from '../src/platform/editor-preferences.mjs';
import { DEFAULT_EDITOR_PREFERENCES } from '../src/core/default-settings.mjs';
import { Preview } from '../src/ui/preview.mjs';

const compile = chart => { const tempo = new TempoMap(chart.BPMList), scene = new SceneRuntime(); scene.compile(chart, tempo); return { tempo, scene }; };
test('超大谱局部拖拽保留重合组余量，并按实际处理数量调整高亮与连击', () => {
  const chart = createChart(); chart.judgeLineList[0].notes = [createNote(1, 2, 0)];
  const { scene } = compile(chart), source = scene.lines[0].notes[0]; source.multiplicity = 10000000;
  scene.largeOwner = { owner: { quantity: () => 7 } };
  const note = { ...source.note, startTime: fromNumber(4), endTime: fromNumber(4), positionX: 300 };
  const draft = new NotePreview(); draft.update(scene, new Map([[0, new Map([[0, note]])]]));
  const runtime = draft.runtime(scene, 0), visible = runtime.visibleNotes(0, runtime.state(0), Infinity);
  assert.deepEqual(visible.map(entry => [entry.note.positionX, entry.multiplicity]), [[0, 9999993], [300, 7]]);
  assert.equal(draft.completionDelta(1.5), -7); assert.equal(draft.completionDelta(2.5), 0);
});
const geometry = (runtime, seconds) => {
  const state = runtime.state(seconds);
  return runtime.visibleNotes(seconds, state, 300).map(entry => ({ index: entry.index, start: entry.start, end: entry.end, ...runtime.noteState(entry, state, seconds) })).sort((a, b) => a.index - b.index);
};
const hits = (runtime, seconds) => (runtime.previewHits?.(seconds, -Infinity, .7) ?? recentHits(runtime, seconds, -Infinity, .7)).map(({ entry, time }) => [entry.index, time, entry.note.positionX]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);

test('音符拖拽草稿的可见性、位置和打击特效与真实修改一致，兼容 BPM、倍率、Hold 与控制曲线', () => {
  const chart = createChart(); chart.BPMList.push({ bpm: 180, startTime: [8, 0, 1] });
  const line = chart.judgeLineList[0]; line.bpmfactor = 2;
  line.posControl = [{ x: 0, pos: 1, easing: 1 }, { x: 1200, pos: .6, easing: 1 }];
  line.yControl = [{ x: 0, y: 1, easing: 1 }, { x: 1200, y: .5, easing: 1 }];
  line.eventLayers[0].speedEvents = [{ ...createEvent(4), endTime: [100, 0, 1] }];
  line.notes = [createNote(1, 1, 100), createNote(2, 2, -100, 10), { ...createNote(3, 40, 0), speed: 0 }, createNote(4, 3, 300)];
  const { scene, tempo } = compile(chart), preview = new NotePreview();
  const moved = new Map([[0, { ...line.notes[0], positionX: 2200, startTime: fromNumber(9), endTime: fromNumber(9) }],
    [1, { ...line.notes[1], positionX: -1800, startTime: fromNumber(4), endTime: fromNumber(12) }],
    [2, { ...line.notes[2], startTime: fromNumber(6), endTime: fromNumber(6) }]]);
  const expectedChart = { ...chart, judgeLineList: [{ ...line, notes: line.notes.map((note, index) => moved.get(index) ?? note) }] };
  const expected = compile(expectedChart).scene.lines[0];
  preview.update(scene, new Map([[0, moved]])); const runtime = preview.runtime(scene, 0);
  for (const seconds of [0, 2.1, 4.2, 6.1, 8.1, 9.1, 10.1, 12]) {
    assert.deepEqual(geometry(runtime, seconds), geometry(expected, seconds));
    assert.deepEqual(hits(runtime, seconds), hits(expected, seconds));
  }
  assert.equal(scene.lines[0].line, line); assert.equal(line.notes[0].positionX, 100);
  assert.equal(runtime.tracks, scene.lines[0].tracks); assert.equal(runtime.speeds, scene.lines[0].speeds);
  preview.update(scene, null); assert.equal(preview.runtime(scene, 0), scene.lines[0]);
  assert.deepEqual(geometry(preview.runtime(scene, 0), 0), geometry(scene.lines[0], 0));
});

test('拖拽中的双押高亮和计数同步更新，交换时刻时不错误沿用旧高亮', () => {
  const chart = createChart(), line = chart.judgeLineList[0];
  line.notes = [createNote(1, 0, -100), createNote(1, 0, 0), createNote(1, 1, 100)];
  const { scene, tempo } = compile(chart), preview = new NotePreview(), counts = new Map(), original = simultaneousNotes(chart, tempo, counts);
  const swaps = new Map([[0, { ...line.notes[0], startTime: fromNumber(1), endTime: fromNumber(1) }], [2, { ...line.notes[2], startTime: fromNumber(0), endTime: fromNumber(0) }]]);
  preview.update(scene, new Map([[0, swaps]]));
  const runtime = preview.runtime(scene, 0), entries = runtime.visibleNotes(0, runtime.state(0));
  assert.deepEqual(entries.sort((a, b) => a.index - b.index).map(entry => preview.simultaneous(entry, original, counts)), [false, true, true]);
  preview.update(scene, new Map([[0, new Map([[0, swaps.get(0)]])]]));
  assert.equal(preview.completionDelta(.1), -1); assert.equal(preview.completionDelta(.6), 0);
  assert.equal(preview.completionDelta(0), 0);
});

test('密集谱面只为被拖动音符准备临时索引，重复绘制复用草稿且不重建原索引', () => {
  const chart = createChart(); chart.judgeLineList = Array.from({ length: 8 }, () => createLine());
  for (const line of chart.judgeLineList) line.notes = Array.from({ length: 12500 }, (_, index) => createNote(1, index / 4, 0));
  const { scene } = compile(chart), preview = new NotePreview(), base = scene.lines[3], index = base.index, holdIndex = base.holdIndex;
  let prepared = 0; const original = base.noteEntry; base.noteEntry = function (...args) { prepared++; return original.apply(this, args); };
  const overrides = new Map([[3, new Map([[12, { ...base.notes[12].note, positionX: 2000 }]])]]);
  preview.update(scene, overrides); const runtime = preview.runtime(scene, 3);
  for (let frame = 0; frame < 100; frame++) { preview.update(scene, overrides); geometry(runtime, .5); }
  assert.equal(prepared, 1); assert.equal(preview.runtimes.size, 1);
  assert.equal(preview.runtime(scene, 4), scene.lines[4]); assert.equal(base.index, index); assert.equal(base.holdIndex, holdIndex);
  assert.equal(base.notes.length, 12500); assert.equal(scene.chart, chart);
});

test('普通和旋转音符编辑共用缓存的拖拽草稿，不修改历史，吸附结果不变时不重建草稿', () => {
  const chart = createChart(), session = new EditorSession(chart);
  session.insertNotes([createNote(1, 1, 0)]); session.selection = new Set([0]);
  const canvas = { clientWidth: 1000, clientHeight: 600, addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 600 }) };
  const timeline = new Timeline(canvas, canvas, () => session, () => {}, () => {}); timeline.tempo = new TempoMap(chart.BPMList);
  timeline.noteView = { baseline: 400, pixelsPerUnit: .5, renderScale: 1 }; timeline.scale = 200;
  const history = session.history.undoStack.length;
  timeline.drag = { kind: 'move', anchor: 0, lineIndex: 0, start: { x: 400, y: 300 }, current: { x: 467, y: 275 }, originSeconds: 0 };
  const preview = timeline.previewNotes(); assert.equal(preview.get(0).get(0).positionX, 135);
  timeline.drag.current.x = 468; assert.equal(timeline.previewNotes(), preview);
  assert.equal(session.notes[0].positionX, 0); assert.equal(session.history.undoStack.length, history);
  timeline.cancelPlacement(); assert.equal(timeline.previewNotes(), null);
  assert.equal(DEFAULT_EDITOR_PREFERENCES.placementOpacity, .5);
  assert.deepEqual(normalizeEditorPreferences({ placementOpacity: .3 }), { placementOpacity: .3 });
  assert.deepEqual(normalizeEditorPreferences({ placementOpacity: 8 }), { placementOpacity: 1 });
});

test('放置坐标提前编译场景后，预览仍刷新新增音符的双押、计数与渲染轨道缓存', testContext => {
  const previousRatio = globalThis.devicePixelRatio; globalThis.devicePixelRatio = 1;
  testContext.after(() => { if (previousRatio === undefined) delete globalThis.devicePixelRatio; else globalThis.devicePixelRatio = previousRatio; });
  const context = new Proxy({}, { get: (target, key) => key in target ? target[key] : () => {} });
  const canvas = { style: {}, getBoundingClientRect: () => ({ width: 960, height: 640, left: 0, top: 0 }), getContext: () => context };
  const chart = createChart(), tempo = new TempoMap(chart.BPMList), preview = new Preview(canvas); preview.visible = true;
  preview.draw(chart, tempo, 0, 0);
  const first = createNote(1, 1, 0), second = createNote(1, 1, 135);
  const next = { ...chart, judgeLineList: [{ ...chart.judgeLineList[0], notes: [first, second] }] };
  preview.scene.compile(next, tempo); preview.draw(next, tempo, 0, 0);
  assert.equal(preview.simultaneous.has(first), true); assert.equal(preview.simultaneous.has(second), true);
  assert.equal(preview.completionTimes.length, 2); assert.equal(preview.preparedChart, next);
  const counts = preview.completionTimes; preview.draw(next, tempo, .1, 0); assert.equal(preview.completionTimes, counts);
});

test('预览保留零时长、零音符速度和零线速 Hold 的上下侧，判定后仍只显示尾部', testContext => {
  const previousRatio = globalThis.devicePixelRatio; globalThis.devicePixelRatio = 1;
  testContext.after(() => { if (previousRatio === undefined) delete globalThis.devicePixelRatio; else globalThis.devicePixelRatio = previousRatio; });
  const context = new Proxy({}, { get: (target, key) => key in target ? target[key] : () => {} });
  const canvas = { style: {}, getBoundingClientRect: () => ({ width: 960, height: 640, left: 0, top: 0 }), getContext: () => context };
  for (const mode of ['duration', 'noteSpeed', 'lineSpeed']) {
    const chart = createChart(), line = chart.judgeLineList[0];
    if (mode === 'lineSpeed') line.eventLayers[0].speedEvents = [createEvent(0)];
    line.notes = [1, 0, 2].map((above, index) => ({ ...createNote(2, 4, (index - 1) * 200, mode === 'duration' ? 4 : 8), above, speed: mode === 'noteSpeed' ? 0 : 1 }));
    const tempo = new TempoMap(chart.BPMList), preview = new Preview(canvas), calls = [];
    Object.assign(preview, { visible: true, showHitEffects: false, showGameUI: false, applyShaders: false, skin: { tinted: () => null, hold(...args) { calls.push(args); return true; } } });
    for (const seconds of [1, 2]) {
      calls.length = 0; preview.draw(chart, tempo, seconds, 0);
      assert.equal(calls.length, 3, mode);
      for (const call of calls) {
        assert.equal(call[2], call[3], mode);
        assert.equal(call[6], seconds < 2, mode);
        assert.equal(call[9], call[1] < 0 ? 1 : -1, mode);
      }
    }
  }
});
