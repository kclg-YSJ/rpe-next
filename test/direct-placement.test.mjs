import test from 'node:test';
import assert from 'node:assert/strict';
import { directPlacementPlane } from '../src/core/direct-placement.mjs';
import { sortedGuideMatches, pickGuide } from '../src/core/preview-guides.mjs';
import { Timeline } from '../src/ui/timeline.mjs';
import { createChart, createNote } from '../src/core/chart.mjs';
import { EditorSession } from '../src/application/session.mjs';
import { TempoMap } from '../src/core/tempo.mjs';
import { beatValue } from '../src/core/beat.mjs';
import { snapPosition } from '../src/core/edit-grid.mjs';
import { normalizeEditorPreferences } from '../src/platform/editor-preferences.mjs';
import { DEFAULT_EDITOR_PREFERENCES } from '../src/core/default-settings.mjs';
import { DEFAULT_HOTKEYS } from '../src/core/preferences.mjs';
import { validateHotkeys } from '../src/core/hotkey-settings.mjs';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, actual + ' != ' + expected);
const viewport = { left: 24, top: 12, width: 960, height: 640 };

test('重合线按实际 alpha 降序、编号升序排列，原循环点选顺序保持不变', () => {
  const guide = { x: 100, y: 200, halfWidth: 1000, rotation: 0 };
  const guides = [{ ...guide, index: 5, alpha: -100 }, { ...guide, index: 4, alpha: 255 }, { ...guide, index: 2, alpha: 255 }, { ...guide, index: 0, alpha: 0 }, { ...guide, index: 9, alpha: 100 }, { ...guide, index: 3, alpha: 100, y: 260 }];
  const point = { x: 140, y: 200 };
  assert.deepEqual(sortedGuideMatches(guides, point).map(guide => guide.index), [2, 4, 9, 0, 5]);
  assert.equal(pickGuide(guides, point, 5), 4); assert.equal(pickGuide(guides, point, 9), 5); assert.deepEqual(sortedGuideMatches(guides, { x: 140, y: 400 }), []);
  const segment = { ...guide, index: 10, alpha: 1, segment: [{ x: 200, y: 100 }, { x: 200, y: 500 }] };
  assert.deepEqual(sortedGuideMatches([segment], { x: 200, y: 300 }).map(guide => guide.index), [10]);
});

test('直接放置坐标在平移、旋转、缩放和远处锚点下准确往返，画布大小随视窗限制', () => {
  for (const angle of [-135, 0, 37, 90, 270]) for (const scale of [.125, .7, 2]) for (const anchor of [0, 3000, 1000000]) {
    const guide = { x: 500 + Math.cos(angle * Math.PI / 180) * anchor, y: 320 + Math.sin(angle * Math.PI / 180) * anchor, rotation: angle };
    const plane = directPlacementPlane(guide, viewport, scale, 92);
    assert.ok(plane.width <= 1700 && plane.height <= 1700);
    for (const point of [{ x: 100, y: 150 }, { x: 760, y: 540 }]) {
      const local = plane.point(point), restored = plane.screen(local); near(restored.x, point.x); near(restored.y, point.y);
    }
    const baseline = plane.screen({ x: plane.originX, y: plane.baseline }); near(baseline.x, guide.x); near(baseline.y, guide.y);
  }
  assert.equal(directPlacementPlane({ x: 0, y: 0, rotation: 0 }, viewport, 0), null);
});

function timeline() {
  const canvas = { clientWidth: 1024, clientHeight: 640, style: {}, addEventListener() {}, focus() {}, setPointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1024, height: 640 }) };
  const chart = createChart(); chart.BPMList.push({ bpm: 180, startTime: [8, 0, 1] }); chart.judgeLineList[0].bpmfactor = 2;
  const session = new EditorSession(chart), editor = new Timeline(canvas, canvas, () => session, () => {}, () => {}); editor.tempo = new TempoMap(chart.BPMList); editor.scale = 200; editor.origin = 7; editor.division = 4; editor.gridCount = 21;
  return { editor, session };
}

test('直接放置复用普通音符时间映射，包含 BPM 变化、线倍率、无限横坐标及 Hold', () => {
  const { editor, session } = timeline(), plane = directPlacementPlane({ x: 3000, y: 300, rotation: 0 }, viewport, .8);
  editor.noteView = { ...plane, renderScale: 1, point: event => plane.point({ x: event.clientX, y: event.clientY }) };
  for (const beat of [7, 7.25, 8, 9.5]) near(editor.beatAt(editor.vertical(beat)), beat);
  for (const position of [-2700, -1080, 0, 2025]) near(editor.notePositionAt(editor.noteHorizontal(position)), position);
  editor.cursorLineIndex = 0; editor.cursor = { x: editor.noteHorizontal(-2700), y: editor.vertical(7.25) }; editor.addAtCursor(1);
  assert.equal(session.notes[0].positionX, -2700); assert.equal(beatValue(session.notes[0].startTime), 7.25);
  editor.cursor = { x: editor.noteHorizontal(-1080), y: editor.vertical(7.5) }; editor.addAtCursor(2); editor.cursor.y = editor.vertical(9); editor.addAtCursor(2);
  assert.equal(session.notes[1].positionX, -1080); assert.equal(beatValue(session.notes[1].startTime), 7.5); assert.equal(beatValue(session.notes[1].endTime), 9);
  session.travel('undo'); assert.equal(session.notes.length, 1); session.travel('redo'); assert.equal(session.notes.length, 2);
});

test('普通编辑在正负 X 偏移下吸附原点固定的无限竖线，音符拖拽不再回到默认区间', () => {
  const { editor, session } = timeline();
  for (const center of [-2000, 2000]) {
    editor.cameraX = center;
    for (const count of [10, 10.5, 21]) {
      editor.gridCount = count;
      for (const position of [center - 500, center, center + 500]) near(editor.notePositionAt(editor.noteHorizontal(position)), snapPosition(position, count));
    }
  }
  editor.cameraX = 2000; editor.gridCount = 21; session.insertNotes([createNote(1, 7.5, 2025)]);
  editor.drag = { kind: 'move', anchor: 0, lineIndex: 0, start: { x: editor.noteHorizontal(2025), y: editor.vertical(7.5) }, current: { x: editor.noteHorizontal(2160), y: editor.vertical(8) }, originSeconds: editor.tempo.seconds(editor.origin, editor.factor) };
  const moved = editor.movedNote(session.notes[0]); near(moved.positionX, 2160); assert.equal(beatValue(moved.startTime), 8);
});

test('重合线列表默认开启、直接放置默认关闭，两项可保存且新快捷键可修改无默认冲突', () => {
  assert.equal(DEFAULT_EDITOR_PREFERENCES.overlappingLinePicker, true); assert.equal(DEFAULT_EDITOR_PREFERENCES.directPlacement, false);
  for (const enabled of [true, false]) assert.deepEqual(normalizeEditorPreferences({ overlappingLinePicker: enabled, directPlacement: enabled }), { overlappingLinePicker: enabled, directPlacement: enabled });
  assert.equal(DEFAULT_HOTKEYS.DirectPlacement, 'LEFTALT&D'); assert.equal(validateHotkeys(DEFAULT_HOTKEYS).valid, true);
});
