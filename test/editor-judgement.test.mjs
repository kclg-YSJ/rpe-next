import test from 'node:test';
import assert from 'node:assert/strict';
import { Timeline } from '../src/ui/timeline.mjs';
import { EditorSession } from '../src/application/session.mjs';
import { createChart, createLine } from '../src/core/chart.mjs';
import { editorSkinContext, setEditorCanvasSkin } from '../src/ui/editor-skin-canvas.mjs';
import { drawEditorJudgement, editorJudgementWidth } from '../src/ui/editor-judgement.mjs';
import { normalizeEditorPreferences } from '../src/platform/editor-preferences.mjs';
import { DEFAULT_EDITOR_PREFERENCES } from '../src/core/default-settings.mjs';

function surface(id) {
  const strokes = [], state = [], context = { globalAlpha: 1, lineWidth: 1, strokeStyle: '', dash: [], path: [],
    save() { state.push({ globalAlpha: this.globalAlpha, lineWidth: this.lineWidth, strokeStyle: this.strokeStyle, dash: [...this.dash] }); },
    restore() { Object.assign(this, state.pop()); }, beginPath() { this.path = []; }, moveTo(x, y) { this.path.push([x, y]); }, lineTo(x, y) { this.path.push([x, y]); },
    setLineDash(value) { this.dash = [...value]; }, stroke() { strokes.push({ color: this.strokeStyle, width: this.lineWidth, alpha: this.globalAlpha, dash: [...this.dash], path: this.path.map(point => [...point]) }); }, measureText: () => ({ width: 12 }),
  };
  const proxy = new Proxy(context, { get: (target, key) => target[key] ?? (() => {}) });
  const canvas = { id, style: {}, clientWidth: 600, clientHeight: 600, addEventListener() {}, getContext: () => proxy, getBoundingClientRect: () => ({ width: 600, height: 600 }) }; context.canvas = canvas;
  return { canvas, context: proxy, strokes };
}

test('底部判定线使用用户颜色，不经过皮肤色板、透明度、线宽缩放或虚线映射', () => {
  const output = surface('events');
  try {
    setEditorCanvasSkin({ palette: { '#19a0cc': '#ff0000' }, opacity: 0.1, lineWidthScale: 8, lineDash: [10, 10] });
    const context = editorSkinContext(output.context);
    context.strokeStyle = '#19a0cc'; context.setLineDash([3, 3]); context.beginPath(); context.moveTo(0, 0); context.lineTo(10, 10); context.stroke();
    drawEditorJudgement(context, [{ left: 0, right: 100, y: 50 }], '#19a0cc', 2);
    assert.deepEqual(output.strokes[0], { color: '#ff0000', width: 8, alpha: 0.1, dash: [10, 10], path: [[0, 0], [10, 10]] });
    assert.deepEqual(output.strokes[1], { color: '#19a0cc', width: 2, alpha: 0.6, dash: [], path: [[0, 50], [100, 50]] });
  } finally { setEditorCanvasSkin(null); }
});

test('音符和事件编辑底部判定线均在横竖网格之后绘制', () => {
  const chart = createChart(), session = new EditorSession(chart), notes = surface('notes'), events = surface('events');
  const timeline = new Timeline(notes.canvas, events.canvas, () => session, () => {}, () => {}); timeline.judgementColor = '#19a0cc';
  timeline.draw(0);
  for (const output of [notes, events]) {
    const judgement = output.strokes.findLastIndex(stroke => stroke.color === '#19a0cc'); assert.ok(judgement >= 0);
    assert.ok(!output.strokes.slice(judgement + 1).some(stroke => ['#555555', '#9ba5b0', '#737d88', '#334154'].includes(stroke.color)));
  }
});

test('多线判定线只绘制事件栏和音符栏，不跨越栏间空隙', () => {
  const chart = createChart(); chart.judgeLineList.push(createLine()); const session = new EditorSession(chart), output = surface('events');
  const timeline = new Timeline(surface('notes').canvas, output.canvas, () => session, () => {}, () => {});
  session.setMultiLineEnabled(true, 'events'); session.multiLineIndices = [0, 1]; timeline.multiLineEventWidth = 200; timeline.multiLineEventWidthExplicit = true;
  const segments = timeline.judgementSegments(600, 600, 0, 'events'); assert.equal(segments.length, 2); assert.ok(segments[0].right < segments[1].left);
  drawEditorJudgement(output.context, segments, '#19a0cc'); assert.equal(output.strokes[0].path.length, 4);
  timeline.multiLineEventWidth = 600;
  assert.equal(timeline.judgementSegments(600, 600, 0, 'events').length, 1, 'fully offscreen judgement segments are culled');
});

test('判定线宽度和不透明度独立于节拍网格与皮肤，数值可保存并限制在有效范围', () => {
  assert.equal(DEFAULT_EDITOR_PREFERENCES.judgementWidth, 5); assert.equal(DEFAULT_EDITOR_PREFERENCES.judgementAlpha, 0.6);
  const settings = { judgementWidth: 5, judgementAlpha: 0.6, barWidth: 9 }, output = surface('notes');
  assert.equal(editorJudgementWidth(settings, 960), 5);
  drawEditorJudgement(output.context, [{ left: 0, right: 100, y: 50 }], '#ffffff', 5, 0.6); assert.equal(output.strokes[0].alpha, 0.6);
  assert.deepEqual(normalizeEditorPreferences({ judgementWidth: 99, judgementAlpha: -1 }), { judgementWidth: 12, judgementAlpha: 0 });
  assert.deepEqual(normalizeEditorPreferences({ judgementWidth: 5, judgementAlpha: 0.6 }), { judgementWidth: 5, judgementAlpha: 0.6 });
});
