import test from 'node:test';
import assert from 'node:assert/strict';
import { createChart, createNote, createEvent } from '../src/core/chart.mjs';
import { EditorSession } from '../src/application/session.mjs';
import { Timeline } from '../src/ui/timeline.mjs';
import { clippedDiagnosticRect } from '../src/ui/diagnostic-highlight.mjs';
import { diagnosticSubtype } from '../src/ui/diagnostics-panel.mjs';
import { diagnostic } from '../src/core/chart-diagnostics.mjs';

test('定位框围住 Hold 身体、零宽音符，并沿用现有坐标缩放和横向偏移', () => {
  const canvas = { clientWidth: 900, clientHeight: 600, style: {}, addEventListener() {} }, session = new EditorSession(createChart()), timeline = new Timeline(canvas, canvas, () => session, () => {}, () => {});
  timeline.cameraX = 2000; timeline.notesOnly = true;
  const hold = createNote(2, 1, 2000, 3), bounds = timeline.diagnosticNoteBounds(hold);
  assert.equal(bounds.x + bounds.width / 2, timeline.noteHorizontal(2000)); assert.ok(bounds.height > Math.abs(timeline.noteVertical(hold) - timeline.noteVertical(hold, 'endTime')));
  const empty = timeline.diagnosticNoteBounds({ ...hold, size: 0 }); assert.equal(empty.width, 12);
});
test('事件定位框即使在连续事件合并绘制时也只对应目标事件本身的区间', () => {
  const canvas = { clientWidth: 900, clientHeight: 600, style: {}, addEventListener() {} }, session = new EditorSession(createChart()), timeline = new Timeline(canvas, canvas, () => session, () => {}, () => {});
  const event = createEvent(0, 10, 1, 3); timeline.layer = 2;
  const bounds = timeline.diagnosticEventBounds('rotateEvents', event), column = timeline.eventColumnBounds(2, canvas.clientWidth);
  assert.equal(bounds.x, column.x); assert.equal(bounds.width, column.width); assert.equal(bounds.height, Math.abs(timeline.vertical(1) - timeline.vertical(3)) + 4);
});
test('定位框裁切在可见画布内，不会浮到右侧面板或画布边缘外', () => {
  assert.deepEqual(clippedDiagnosticRect({ x: -20, y: 15, width: 100, height: 200 }, { x: 0, y: 0, width: 80, height: 100 }), { x: 1, y: 10, width: 78, height: 89 });
  assert.equal(clippedDiagnosticRect({ x: 100, y: 100, width: 20, height: 20 }, { x: 0, y: 0, width: 80, height: 80 }), null);
});
test('报错子类按规则归组，不因实际检测数值不同分组，标题和条目都不写阈值', () => {
  const first = diagnostic('shortRead', 'info', {}, { ms: 50 }), second = diagnostic('shortRead', 'info', {}, { ms: 150 });
  assert.equal(diagnosticSubtype(first), diagnosticSubtype(second)); assert.ok(!/阈值|300/.test(first.message));
  assert.equal(diagnosticSubtype(diagnostic('timeRange', 'error', { path: 'notes[0]' })), '音符时间越界');
  assert.equal(diagnosticSubtype(diagnostic('timeRange', 'error', { path: 'moveXEvents[0]' })), '事件时间越界');
  assert.ok(!/255/.test(diagnostic('alphaRange', 'warning').message)); assert.ok(!/29/.test(diagnostic('easing', 'error').message));
});
