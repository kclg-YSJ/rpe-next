import test from 'node:test';
import assert from 'node:assert/strict';
import { createChart, createEvent, createLine } from '../src/core/chart.ts';
import { EditorSession } from '../src/application/session.ts';
import { Timeline } from '../src/ui/timeline.ts';
import { NoiseAreaEditor } from '../src/ui/noise-area.ts';
import { createNoiseArea, createNoiseEvent } from '../src/core/noise-areas.ts';
import { TempoMap } from '../src/core/tempo.ts';
import { drawEventCurve } from '../src/ui/event-curve.ts';
import { easing, bezier } from '../src/core/easing.ts';
import { eventDisplayIndex } from '../src/ui/event-display-index.ts';
import { migratePreferences } from '../src/core/preferences.ts';
import { readEditorPreferences, writeEditorPreferences } from '../src/platform/editor-preferences.ts';
import type { Chart } from '../src/core/types.ts';

type DrawCall = { method: string | symbol; args: unknown[] };
type SurfaceContext = CanvasRenderingContext2D & { calls: DrawCall[]; paths: number[][][] };

function surface(): { context: SurfaceContext; canvas: HTMLCanvasElement } {
  const calls: DrawCall[] = []; const paths: number[][][] = []; let currentPath: number[][] = []; let subpaths: number[][][] = [];
  const context = new Proxy({ calls, paths, measureText: () => ({ width: 20 }),
    beginPath() { currentPath = []; subpaths = []; }, moveTo(x: number, y: number) { currentPath = [[x, y]]; subpaths.push(currentPath); }, lineTo(x: number, y: number) { currentPath.push([x, y]); }, stroke() { paths.push(...subpaths.map(path=>path.map(point=>[...point]))); },
  }, { get(target, key) { return (target as Record<string | symbol, unknown>)[key] ?? ((...args: unknown[]) => calls.push({ method: key, args })); } });
  const canvas = { style: {}, clientWidth: 600, clientHeight: 600, addEventListener() {}, getContext: () => context, getBoundingClientRect: () => ({ width: 600, height: 600 }) } as unknown as HTMLCanvasElement;
  return { context: context as unknown as SurfaceContext, canvas };
}

const curvePaths = (context: SurfaceContext): number[][][] => context.paths.filter(points => points.length >= 2 && points[0]![0] !== points.at(-1)![0] && points[0]![1] !== points.at(-1)![1]);

test('普通事件在单线和多线中都不在连续短事件接缝重复标注数值', () => {
  globalThis.devicePixelRatio = 1;
  const chart = createChart(); const events = Array.from({ length: 100 }, (unused, index) => createEvent(1000 + index, 1001 + index, 0.5 + index / 100, 0.5 + (index + 1) / 100));
  chart.judgeLineList[0].eventLayers[0].moveXEvents = events;
  chart.judgeLineList.push(createLine());
  const session = new EditorSession(chart); const notes = surface(); const output = surface();
  const timeline = new Timeline(notes.canvas, output.canvas, () => session, () => {}, () => {});
  timeline.origin = 0.5;
  const labels = () => output.context.calls.filter(call => call.method === 'fillText' && Number(call.args[0]) >= 1000 && Number(call.args[0]) <= 1100).map(call => call.args[0]);
  for (const selected of [false, true]) {
    if (selected) session.eventSelection.add('moveXEvents:40');
    timeline.drawEvents(0.5); assert.deepEqual(labels(), ['1100.00', '1000.00']); output.context.calls.length = 0;
  }
  session.multiLineEnabled = true; session.multiLineMode = 'events'; session.multiLineIndices = [0, 1];
  timeline.drawMultiLineEvents(0.5); assert.deepEqual(labels(), ['1100.00', '1000.00']);
});

test('噪域与普通事件共用整组数值范围，短事件、反向变化和 Bezier 曲线的绘制坐标一致', () => {
  globalThis.devicePixelRatio = 1;
  const events = [createNoiseEvent(10, 20, 0.5, 0.51), { ...createNoiseEvent(20, 45, 0.51, 0.53), bezier: 1, bezierPoints: [0.2, 0.8, 0.6, 0.1] }, createNoiseEvent(45, -10, 0.53, 1.5)];
  const snapshot = JSON.stringify(events); const chart = createChart(); chart.judgeLineList[0].eventLayers[0].moveXEvents = events;
  const session = new EditorSession(chart); const ordinary = surface();
  const timeline = new Timeline(surface().canvas, ordinary.canvas, () => session, () => {}, () => {}); timeline.origin = 0; timeline.judgementOffset = 92;
  timeline.drawEvents(0);
  const ordinaryPaths = curvePaths(ordinary.context); assert.equal(ordinaryPaths.length, 3);
  const area = createNoiseArea(0, 4); area.moveXEvents = events;
  const editor = Object.create(NoiseAreaEditor.prototype); const noise = surface();
  const layout = { width: 1000, height: 600, split: 400, eventLeft: 430, eventWidth: 90 };
  editor.getContext = () => ({ timeline, tempo: new TempoMap(chart.BPMList), session: { chart: { blockAreaList: [area] } } });
  editor.layout = () => layout; editor.y = (beat: number) => 508 - beat * 250; editor.beatAt = (vertical: number) => (508 - vertical) / 250;
  editor.selected = 0; editor.selection = new Set(['area:0']); editor.areaX = () => 100; editor.canvas = { setAttribute() {} }; editor.drawDistribution = editor.drawOwner = () => {};
  editor.drawTimeline(noise.context, layout.width, layout.height, layout);
  const noisePaths = curvePaths(noise.context); assert.equal(noisePaths.length, 3, 'short events must still draw their curve');
  const normalBounds = timeline.eventColumnBounds(0, 600); const bounds = editor.eventBounds('moveXEvents');
  for (let event = 0; event < 3; event++) for (let index = 0; index < ordinaryPaths[event].length; index++) {
    const [normalX, normalY] = ordinaryPaths[event][index]; const [noiseX, noiseY] = noisePaths[event][index];
    const normalValue = (normalX - normalBounds.x - 6) / (normalBounds.width - 12); const noiseValue = (noiseX - bounds.x - 6) / (bounds.width - 12);
    assert.ok(Math.abs(normalValue - noiseValue) < 1e-12); assert.ok(Math.abs(normalY - noiseY) < 1e-12);
  }
  for (let event = 0; event < 2; event++) assert.ok(Math.hypot(...noisePaths[event]!.at(-1)!.map((value, axis) => value - noisePaths[event + 1]![0]![axis]!)) < 1e-8);
  assert.ok(Math.abs((noisePaths[0]!.at(-1)![0]! - bounds.x - 6) / (bounds.width - 12) - 30 / 55) < 1e-12);
  editor.clipboard = { start: 0.5, entries: events.map(value => ({ type: 'moveXEvents', value })) }; editor.cursor = { beat: 0.75 };
  noise.context.paths.length = 0; editor.drawTimeline(noise.context, layout.width, layout.height, layout);
  const withGhosts = curvePaths(noise.context); assert.equal(withGhosts.length, 6);
  for (let event = 0; event < 3; event++) for (let index = 0; index < withGhosts[event].length; index++) assert.ok(Math.abs(withGhosts[event][index][0] - withGhosts[event + 3][index][0]) < 1e-12);
  timeline.eventCurveThreshold = 100; editor.clipboard = null; noise.context.paths.length = 0; editor.drawTimeline(noise.context, layout.width, layout.height, layout);
  assert.equal(curvePaths(noise.context).length, 0);
  assert.equal(JSON.stringify(events), snapshot, 'rendering must not modify event values or semantics');
});

test('缓动超调与数值跳变按普通事件的映射绘制，裁剪到事件条而不强行压平曲线', () => {
  const output = surface(); const rectangle = { x: 10, y: 0, width: 100, height: 100 };
  const first = { ...createEvent(0, 100, 0, 1), easingType: 20 };
  drawEventCurve(output.context, first, { min: 0, max: 100 }, rectangle, 100, 0);
  assert.ok(output.context.paths[0].some(([x]) => x > 104));
  assert.ok(output.context.calls.some(call => call.method === 'clip'));
  output.context.paths.length = 0;
  drawEventCurve(output.context, createEvent(10, 20, 0, 1), { min: 0, max: 100 }, rectangle, 100, 50);
  drawEventCurve(output.context, createEvent(60, 80, 1, 2), { min: 0, max: 100 }, rectangle, 50, 0);
  assert.equal(output.context.paths.length, 2); assert.equal(output.context.paths[0]!.at(-1)![1]!, output.context.paths[1]![0]![1]!);
  assert.ok(output.context.paths[0]!.at(-1)![0]! < output.context.paths[1]![0]![0]!);
});

test('事件曲线缓存跟随缓动区间和 Bezier 控制点修改，线性事件仍精确经过首尾值', () => {
  const output = surface(); const rectangle = { x: 0, y: 0, width: 112, height: 100 };
  const event = createEvent(0, 100, 0, 1);
  const draw = () => { output.context.paths.length = 0; drawEventCurve(output.context, event, { min: 0, max: 100 }, rectangle, 100, 0); return output.context.paths[0]; };
  assert.deepEqual(draw(), [[6, 100], [106, 0]]);
  event.easingType = 20;
  for (const [left, right] of [[0,1], [0.1,0.8], [0.4,0.9]]) {
    event.easingLeft = left; event.easingRight = right;
    const path = draw(); assert.deepEqual(draw(), path);
    for (let i = 0; i <= 36; i++) assert.ok(Math.abs(path[i][0] - (6 + easing(i / 36, 20, left, right) * 100)) < 1e-9);
  }
  event.bezier = 1; event.bezierPoints = [0.2, 0.8, 0.6, 0.1];
  const first = draw(); event.bezierPoints[1] = 0.1; const second = draw();
  assert.notDeepEqual(first, second);
  for (let i = 0; i <= 36; i++) assert.ok(Math.abs(second[i][0] - (6 + bezier(i / 36, event.bezierPoints) * 100)) < 1e-9);
  event.start = event.end = 30; assert.deepEqual(draw(), [[36,100],[36,0]]);
  event.end = 100; assert.equal(draw().length, 37);
});

test('事件显示索引复用排序结果，编辑、撤销和列表长度变化会刷新范围及命中索引', () => {
  const owner: { eventDisplayChart?: Chart } = {}; const chart = {} as Chart; const events = [createEvent(0,10,0,1), createEvent(10,20,1,2)];
  const first = eventDisplayIndex(owner, events, chart);
  assert.equal(eventDisplayIndex(owner, events, chart), first); assert.equal(first.groups.length, 1);
  events[1] = createEvent(10,40,3,4); const changed = eventDisplayIndex(owner, events, {} as Chart);
  assert.equal(changed.groups.length, 2); assert.deepEqual(changed.index.query(3,4).map(entry => entry.index), [1]);
  assert.equal(changed.ranges.get(1)!.max, 40);
  events.push({ ...createEvent(40,50,4,5), inst: true });
  const next = eventDisplayIndex(owner, events, owner.eventDisplayChart!); assert.notEqual(next, changed);
  assert.ok(next.unmergeable.has(next.ranges.get(2)!));
  const undone = eventDisplayIndex(owner, [createEvent(0,10,0,1),createEvent(10,20,1,2)], chart);
  assert.equal(undone.groups.length,1); assert.equal(undone.groups[0].max,20);
});

test('绘制事件曲线默认开启且保存布尔设置，关闭时普通单线和多线仍保留每段命中区域与数值', () => {
  assert.equal(migratePreferences().settings.drawEventCurves, true);
  for (const drawEventCurves of [false,true]) {
    let saved: string | undefined; const storage = { setItem(key: string, value: string) { saved = value; }, getItem() { return saved ?? null; } };
    writeEditorPreferences({ drawEventCurves },storage); assert.deepEqual(readEditorPreferences(storage),{drawEventCurves});
  }
  const chart=createChart(); chart.judgeLineList[0].eventLayers[0].moveXEvents=[createEvent(10,20,0.5,1)]; chart.judgeLineList.push(createLine());
  const session=new EditorSession(chart); const output=surface(); const timeline=new Timeline(surface().canvas,output.canvas,()=>session,()=>{},()=>{});
  for (const multi of [false,true]) {
    session.multiLineEnabled=multi; session.multiLineMode='events'; session.multiLineIndices=[0,1];
    const draw=()=>{ output.context.paths.length=0; output.context.calls.length=0; if (multi) timeline.drawMultiLineEvents(0); else timeline.drawEvents(0); };
    timeline.drawEventCurves=true; draw(); assert.ok(curvePaths(output.context).length>0); const rectangles=structuredClone(timeline.eventRects);
    timeline.drawEventCurves=false; draw(); assert.equal(curvePaths(output.context).length,0); assert.deepEqual(timeline.eventRects,rectangles);
    assert.ok(output.context.calls.some(call=>call.method==='fillText' && call.args[0]==='20.00'));
    timeline.drawEventCurves=true; draw(); assert.ok(curvePaths(output.context).length>0);
  }
});

test('多线事件只绘制可见面板，横向滚动后的框选仍选中框内屏幕外的线和事件', () => {
  const chart=createChart(); chart.judgeLineList=[0,1,2].map(()=>{const line=createLine();line.eventLayers[0].moveXEvents=[createEvent(10,20,0.5,1)];return line;});
  const session=new EditorSession(chart); session.multiLineEnabled=true; session.multiLineMode='events'; session.multiLineIndices=[0,1,2];
  const output=surface(); const timeline=new Timeline(surface().canvas,output.canvas,()=>session,()=>{},()=>{});
  timeline.multiLineEventWidth=600; timeline.multiLineEventWidthExplicit=true; (timeline.multiLineScroll as { notes: number; events: number }).events=1000;
  timeline.drawMultiLineEvents(0);
  assert.ok(timeline.eventRects.every(rect=>rect.lineIndex!==0),'offscreen first panel does not get redrawn');
  timeline.point=()=>({x:599,y:100}); timeline.rectangleTimes=()=>[0,2];
  timeline.eventInteraction.drag={kind:'rectangle',finished:true,area:'events',start:{x:0,y:500},startWorldX:0,current:{x:599,y:100},append:false};
  timeline.eventInteraction.up({} as Parameters<typeof timeline.eventInteraction.up>[0]);
  for (const lineIndex of [0,1,2]) assert.ok(session.multiEventSelection.get(lineIndex)?.has('moveXEvents:0'),`line ${lineIndex} is still selectable across horizontal scrolling`);
});
