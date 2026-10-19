import test from 'node:test';
import assert from 'node:assert/strict';
import { NoiseAreaEditor } from '../src/ui/noise-area.ts';
import { createNoiseArea, createNoiseEvent } from '../src/core/noise-areas.ts';
import { fromNumber } from '../src/core/beat.ts';
import { TempoMap } from '../src/core/tempo.ts';
import type { NoiseArea, NoiseEvent, NoiseInterval } from '../src/core/noise-areas.ts';
import type { NoiseAreaEditor as NoiseAreaEditorType, NoiseHover, NoiseRect, SelectionRect } from '../src/ui/noise-area.ts';

const interval = (start: number, end: number, readyFlash: number | boolean): NoiseInterval => ({ startTime: fromNumber(start), endTime: fromNumber(end), readyFlash } as NoiseInterval);
const near = (actual: number, expected: number): void => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);
function distributionEditor(tempo: TempoMap): NoiseAreaEditorType {
  const editor = Object.create(NoiseAreaEditor.prototype) as NoiseAreaEditorType;
  editor.distributions = new WeakMap(); editor.getContext = () => ({ tempo } as never);
  editor.layout = () => ({ height: 1000 } as never); editor.y = (beat: number) => 900 - tempo.seconds(beat) * 100;
  return editor;
}
function strokes(editor: NoiseAreaEditorType, area: NoiseArea): number[][] {
  const points: number[][] = []; const context = new Proxy({ globalAlpha: 1, moveTo: (...point: number[]) => points.push(point), lineTo: (...point: number[]) => points.push(point) }, { get(target, key) { return (target as Record<string | symbol, unknown>)[key] ?? (() => {}); } });
  editor.drawDistribution(context as unknown as CanvasRenderingContext2D, area, 10, 60, editor.y(10), editor.y(0)); return points;
}

test('激活概览的虚线使用秒数跨 BPM 映射，并在生命周期及上个激活段处裁剪', () => {
  const tempo = new TempoMap([{ startTime: fromNumber(0), bpm: 120 }, { startTime: fromNumber(3), bpm: 60 }]);
  const editor = distributionEditor(tempo); const area = createNoiseArea(0, 10);
  area.activeIntervals = [interval(4, 5, 1.2), interval(5.1, 6, 1), interval(7, 8, 0)];
  const points = strokes(editor, area); assert.equal(points.length, 4);
  near(points[0][1], editor.y(4)); near(points[1][1], editor.y(2.6));
  near(points[2][1], editor.y(5.1)); near(points[3][1], editor.y(5));
  area.appearTime = fromNumber(3.8); editor.distributions.delete(area);
  near(strokes(editor, area)[1][1], editor.y(3.8));
});

test('虚线支持旧预闪布尔值，并在 BPM 变化后更新缓存', () => {
  const area = createNoiseArea(0, 10); area.activeIntervals = [interval(2, 3, true), interval(5, 6, false)];
  const tempo = new TempoMap([{ startTime: fromNumber(0), bpm: 120 }]); const editor = distributionEditor(tempo);
  const points = strokes(editor, area); assert.equal(points.length, 2); near(points[1][1], editor.y(1));
  const nextTempo = new TempoMap([{ startTime: fromNumber(0), bpm: 60 }]);
  editor.getContext = () => ({ tempo: nextTempo } as never); editor.y = (beat: number) => 900 - nextTempo.seconds(beat) * 100;
  near(strokes(editor, area)[1][1], editor.y(1.5));
});

test('噪域内部短事件首尾相接时仅标注连续组范围，放大仍不堆叠内部端点', () => {
  const editor = Object.create(NoiseAreaEditor.prototype) as NoiseAreaEditorType; const timeline = { eventValueThreshold: 30, eventValueFontSize: 13 };
  editor.getContext = () => ({ timeline } as never); editor.layout = () => ({ width: 1000, height: 800, eventLeft: 450 } as never);
  const events = Array.from({ length: 100 }, (unused, index) => createNoiseEvent(1000 + index, 1001 + index, index / 100, (index + 1) / 100));
  for (const scale of [200, 1500]) {
    editor.y = (beat: number) => 600 - beat * scale;
    const texts: string[] = []; const context = new Proxy({ fillText: (text: string) => texts.push(text) }, { get(target, key) { return (target as Record<string | symbol, unknown>)[key] ?? (() => {}); } });
    editor.drawEventValues(context as unknown as CanvasRenderingContext2D, events, 'moveXEvents', { x: 500, width: 80 }, 800);
    assert.deepEqual(texts, ['1100', '1000']);
    texts.length = 0; editor.drawEventValues(context as unknown as CanvasRenderingContext2D, events, 'moveXEvents', { x: 500, width: 20 }, 800); assert.deepEqual(texts, []);
  }
});

test('噪域内部事件时间留有间隙时分别标注，粘贴预览也按连续组处理', () => {
  const editor = Object.create(NoiseAreaEditor.prototype) as NoiseAreaEditorType; editor.getContext = () => ({ timeline: {} } as never);
  editor.layout = () => ({ width: 1000, height: 800, eventLeft: 450 } as never); editor.y = (beat: number) => 700 - beat * 200;
  const events = [createNoiseEvent(10, 20, 0, 0.5), createNoiseEvent(20, 30, 0.5, 1), createNoiseEvent(40, 50, 2, 2.5)];
  const texts: string[] = []; const context = new Proxy({ fillText: (text: string) => texts.push(text) }, { get(target, key) { return (target as Record<string | symbol, unknown>)[key] ?? (() => {}); } });
  editor.drawEventValues(context as unknown as CanvasRenderingContext2D, events, 'rotateEvents', { x: 800, width: 80 }, 800, true);
  assert.deepEqual(texts, ['30', '10', '50', '40']);
});

function drawInternalEvents(events: (NoiseEvent | NoiseInterval)[], { seamless = true, type = 'moveXEvents', selected = false, hover = null as NoiseHover | null } = {}) {
  const editor = Object.create(NoiseAreaEditor.prototype) as NoiseAreaEditorType; const area = createNoiseArea(0, 4); (area as unknown as Record<string, unknown>)[type] = events;
  const tempo = new TempoMap([{ startTime: fromNumber(0), bpm: 120 }]);
  const timeline = { seamlessEvents: seamless, division: 4, gridCount: 11, origin: 0 };
  editor.getContext = () => ({ timeline, tempo, session: { chart: { blockAreaList: [area] } } } as never);
  const layout = { width: 1000, height: 800, split: 400, eventLeft: 430, eventWidth: 90 };
  editor.layout = () => layout as never; editor.y = (beat: number) => 700 - beat * 200; editor.beatAt = (vertical: number) => (700 - vertical) / 200;
  editor.selected = 0; editor.selection = new Set(selected ? [type + ':2'] : ['area:0']); editor.hover = hover;
  editor.areaX = () => 100; editor.drawDistribution = () => {}; editor.drawOwner = () => {}; editor.canvas = { setAttribute() {} } as unknown as HTMLCanvasElement;
  const calls: { method: string | symbol; args: unknown[] }[] = []; const context = new Proxy({}, { get(target, key) { return (target as Record<string | symbol, unknown>)[key] ?? ((...args: unknown[]) => calls.push({ method: key, args })); } });
  editor.drawTimeline(context as unknown as CanvasRenderingContext2D, layout.width, layout.height, layout);
  const bounds = editor.eventBounds(type); const rectangles = calls.filter(call => call.method === 'strokeRect' && call.args[0] === bounds.x);
  const caps = calls.filter(call => call.method === 'fillRect' && call.args[0] === bounds.x && call.args[3] === 4);
  return { editor, rectangles, caps };
}

test('连续事件无接缝对噪域内部填充、边框和首尾横条同时生效，保留各段命中区域', () => {
  const events = Array.from({ length: 100 }, (unused, index) => createNoiseEvent(index, index + 1, index / 100, (index + 1) / 100));
  const joined = drawInternalEvents(events); assert.equal(joined.rectangles.length, 1); assert.equal(joined.caps.length, 2);
  assert.equal(joined.editor.rects.filter((rect: NoiseRect) => rect.type === 'moveXEvents').length, 100);
  const separate = drawInternalEvents(events, { seamless: false }); assert.equal(separate.rectangles.length, 100); assert.equal(separate.caps.length, 200);
  const selected = drawInternalEvents(events, { selected: true }); assert.equal(selected.rectangles.length, 100);
  const hovered = drawInternalEvents(events, { hover: { type: 'moveXEvents', index: 2, kind: 'move' } as NoiseHover }); assert.equal(hovered.rectangles.length, 2);
});

test('噪域激活段同样支持无接缝，断开的事件组分别绘制且钩定事件保留边界', () => {
  const activations = Array.from({ length: 4 }, (unused, index) => interval(index / 4, (index + 1) / 4, 0));
  assert.equal(drawInternalEvents(activations, { type: 'activeIntervals' }).rectangles.length, 1);
  const events = [createNoiseEvent(0, 1, 0, 0.25), createNoiseEvent(1, 2, 0.25, 0.5), createNoiseEvent(2, 3, 1, 1.25), createNoiseEvent(3, 4, 1.25, 1.5)];
  assert.equal(drawInternalEvents(events).rectangles.length, 2);
  events[0].inst = 1; assert.equal(drawInternalEvents(events).rectangles.length, 3);
});

test('噪域内部视野裁剪不妨碍框选视野外事件，仍按拍数和原始索引选择', () => {
  const events = [createNoiseEvent(0,1,0,1),createNoiseEvent(1,2,100,101),createNoiseEvent(2,3,-100,-99)];
  const {editor} = drawInternalEvents(events);
  assert.deepEqual(editor.rects.filter((rect: NoiseRect)=>rect.type==='moveXEvents').map((rect: NoiseRect)=>rect.index),[0]);
  const all = [...editor.selectionRects('events')].filter((rect: SelectionRect)=>rect.type==='moveXEvents');
  assert.deepEqual(all.map((rect: SelectionRect)=>[rect.index,rect.start,rect.end]),[[0,0,1],[1,100,101],[2,-100,-99]]);
});
