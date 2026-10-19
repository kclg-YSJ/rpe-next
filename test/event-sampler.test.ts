import test from 'node:test';
import assert from 'node:assert/strict';
import { EventSampler } from '../src/ui/event-sampler.ts';
import { EditorSession } from '../src/application/session.ts';
import { createChart, createLine, createEvent } from '../src/core/chart.ts';
import { TempoMap } from '../src/core/tempo.ts';
import { SceneRuntime } from '../src/core/scene.ts';
import type { ChartEvent } from '../src/core/types.ts';

function fixture(chart = createChart(), autoFit = true, pairedMovementSampling = false) {
  const sampler = Object.create(EventSampler.prototype);
  const session = new EditorSession(chart); session.eventLayer = 0;
  const preview = { viewDivisor: 1.7, aspectRatio: 1.5 };
  const realtimePreview = { viewDivisor: 1.3, aspectRatio: 1.5 };
  const context = { session, tempo: new TempoMap(chart.BPMList), preview, realtimePreview, previewVisible: false, sampleAutoFit: autoFit, pairedMovementSampling, seconds: () => 0, playing: () => false };
  const classes = new Set();
  sampler.host = { closest: () => ({ classList: { toggle: (name: string, value: boolean) => value ? classes.add(name) : classes.delete(name) } }) } as unknown as HTMLElement;
  sampler.canvas = { getBoundingClientRect: () => ({ left: 20, top: 100, width: 900, height: 600 }), setPointerCapture() {}, releasePointerCapture() {} };
  sampler.sampleBar = { getBoundingClientRect: () => ({ bottom: 170 }) };
  sampler.sampleHint = { textContent: '' };
  sampler.getContext = () => context; sampler.invalidate = () => {}; sampler.pause = () => {}; sampler.scene = new SceneRuntime();
  return { sampler, session, context, classes };
}

test('移动取样按父线旋转后的轴反算，并保持预览与控制点一致', () => {
  const chart = createChart(); chart.judgeLineList.push(createLine());
  chart.judgeLineList[0].eventLayers[0].rotateEvents = [createEvent(90)];
  chart.judgeLineList[1].father = 0;
  const { sampler } = fixture(chart);
  sampler.begin({ type: 'moveXEvents', index: 0, field: 'start', lineIndex: 1 });
  const point = sampler.handle(sampler.draftChart);
  sampler.applyPoint({ x: point.x, y: point.y + 125 });
  assert.ok(Math.abs(sampler.draftChart.judgeLineList[1].eventLayers[0].moveXEvents[0].start - 125) < 1e-5);
  const display = sampler.previewState(); const scene = new SceneRuntime(); scene.compile(display.chart, sampler.context.tempo);
  const state = scene.sampler(display!.seconds)(1)!; const handle = sampler.handle(sampler.draftChart!);
  assert.ok(Math.abs(state.x - handle.x) < 1e-8);
  assert.ok(Math.abs(state.y + handle.y) < 1e-8);
});

test('配套 X/Y 事件在同区间时支持二维拖动、实时预览、一次提交和撤销', () => {
  const chart = createChart();
  const layer = chart.judgeLineList[0].eventLayers[0];
  layer.moveXEvents = [createEvent(20, 20, 2, 4)];
  layer.moveYEvents = [createEvent(-30, -30, 2, 4)];
  const { sampler, session } = fixture(chart, true, true);
  assert.equal(sampler.begin({ type: 'moveXEvents', index: 0, field: 'start', lineIndex: 0 }), true);
  assert.deepEqual(sampler.mode.paired, { type: 'moveYEvents', index: 0 });
  const initial = sampler.handle(sampler.draftChart);
  sampler.applyPoint({ x: initial.x + 70, y: initial.y - 90 });
  const draft = sampler.draftChart.judgeLineList[0].eventLayers[0];
  assert.ok(Math.abs(draft.moveXEvents[0].start - 90) < 1e-3);
  assert.ok(Math.abs(draft.moveYEvents[0].start - 60) < 1e-3);
  assert.equal(draft.moveXEvents[0].end, 20);
  assert.equal(draft.moveYEvents[0].end, -30);
  const handle = sampler.handle(sampler.draftChart);
  assert.ok(Math.abs(handle.x - initial.x - 70) < 1e-3);
  assert.ok(Math.abs(handle.y - initial.y + 90) < 1e-3);
  sampler.finish(true);
  const applied = session.chart.judgeLineList[0]!.eventLayers![0]!;
  assert.equal(applied.moveXEvents![0]!.start, draft.moveXEvents[0].start);
  assert.equal(applied.moveYEvents![0]!.start, draft.moveYEvents[0].start);
  assert.equal(session.history.undoStack.length, 1);
  session.travel('undo');
  assert.equal(session.chart.judgeLineList[0]!.eventLayers![0]!.moveXEvents![0]!.start, 20);
  assert.equal(session.chart.judgeLineList[0]!.eventLayers![0]!.moveYEvents![0]!.start, -30);
});

test('配套取样取消不提交；区间不一致、配对不唯一或不同事件层时退回单轴', () => {
  const makeChart = () => {
    const chart = createChart(); const line = chart.judgeLineList[0];
    line.eventLayers[0].moveXEvents = [createEvent(10, 20, 2, 4)];
    line.eventLayers[0].moveYEvents = [createEvent(30, 40, 2, 5)];
    return chart;
  };
  {
    const chart = makeChart(); const { sampler } = fixture(chart, true, true);
    sampler.begin({ type: 'moveXEvents', index: 0, field: 'start', lineIndex: 0 });
    assert.equal(sampler.mode.paired, null);
    sampler.finish(false);
  }
  {
    const chart = makeChart(); const line = chart.judgeLineList[0];
    line.eventLayers[0].moveYEvents = [createEvent(30, 40, 2, 4), createEvent(50, 60, 2, 4)];
    const { sampler } = fixture(chart, true, true);
    sampler.begin({ type: 'moveXEvents', index: 0, field: 'start', lineIndex: 0 });
    assert.equal(sampler.mode.paired, null);
    sampler.finish(false);
  }
  {
    const chart = makeChart(); const line = chart.judgeLineList[0];
    line.eventLayers[0].moveYEvents = [];
    line.eventLayers.push({ ...line.eventLayers[0], moveYEvents: [createEvent(30, 40, 2, 4)] });
    const { sampler } = fixture(chart, true, true);
    sampler.begin({ type: 'moveXEvents', index: 0, field: 'start', lineIndex: 0 });
    assert.equal(sampler.mode.paired, null);
    sampler.finish(false);
  }
  {
    const chart = createChart(); const line = chart.judgeLineList[0];
    line.eventLayers[0].moveXEvents = [createEvent(10, 20, 2, 4)];
    line.eventLayers[0].moveYEvents = [createEvent(30, 40, 2, 4)];
    const { sampler, session } = fixture(chart, true, true);
    sampler.begin({ type: 'moveXEvents', index: 0, field: 'start', lineIndex: 0 });
    const initial = sampler.handle(sampler.draftChart);
    sampler.applyPoint({ x: initial.x + 40, y: initial.y + 80 });
    sampler.finish(false);
    assert.equal(session.chart, chart);
  }
});

test('尾值取样不被同拍开始的后续事件覆盖，取消不修改谱面', () => {
  const chart = createChart();
  chart.judgeLineList[0].eventLayers[0].moveXEvents = [createEvent(0, 100, 0, 1), createEvent(500, 600, 1, 2)];
  const { sampler, session } = fixture(chart);
  sampler.begin({ type: 'moveXEvents', index: 0, field: 'end', lineIndex: 0 });
  assert.equal(sampler.handle(sampler.draftChart).x, 100);
  sampler.applyPoint({ x: 250, y: 0 });
  assert.equal(sampler.handle(sampler.draftChart).x, 250);
  sampler.finish(false);
  assert.equal(session.chart, chart);
  assert.equal(chart.judgeLineList[0].eventLayers[0].moveXEvents[1].start, 500);
});

test('宽高比适配后的父子线移动及旋转取样与实际渲染重合', () => {
  for (const ratio of [16 / 9, 4 / 3, 9 / 16]) for (const type of ['moveXEvents', 'moveYEvents', 'rotateEvents']) {
    const chart = createChart(); chart.judgeLineList.push(createLine());
    chart.judgeLineList[0].eventLayers[0].rotateEvents = [createEvent(35)];
    chart.judgeLineList[1].father = 0;
    const { sampler, context } = fixture(chart, false); context.realtimePreview.aspectRatio = ratio;
    sampler.begin({ type, index: 0, field: 'start', lineIndex: 1 });
    const targetChart = sampler.eventChart(type === 'rotateEvents' ? 20 : 125);
    const target = sampler.handle(targetChart); sampler.applyPoint(target);
    const value = sampler.draftChart.judgeLineList[1].eventLayers[0][type][0].start;
    assert.ok(Math.abs(value - (type === 'rotateEvents' ? 20 : 125)) < 0.001, `${ratio} ${type}: ${value}`);
    const view = sampler.view(); const screen = view.screen(sampler.handle(sampler.draftChart));
    const display = sampler.previewState(); const scene = new SceneRuntime(); scene.compile(display.chart, context.tempo);
    const scale = { x: Math.min(1, ratio / 1.5), y: Math.min(1, 1.5 / ratio) };
    const state = scene.sampler(display.seconds, scale)(1);
    if (type !== 'rotateEvents') {
      assert.ok(Math.abs(screen.x - (450 + state!.x * view.scale)) < 1e-8);
      assert.ok(Math.abs(screen.y - (300 - state!.y * view.scale)) < 1e-8);
    }
    sampler.finish(false);
  }
});

test('拖拽出界时扩大视野且保持捕获，完成或取消恢复各自原缩放和编辑区', () => {
  for (const apply of [false, true]) {
    const { sampler, context, classes, session } = fixture();
    const original = session.chart;
    sampler.begin({ type: 'moveXEvents', index: 0, field: 'start', lineIndex: 0 });
    assert.ok(classes.has('event-sampling'));
    const handle = sampler.view().screen(sampler.handle(sampler.draftChart));
    sampler.down({ button: 0, clientX: handle.x + 20, clientY: handle.y + 100, pointerId: 1, preventDefault() {}, stopPropagation() {} });
    sampler.move({ clientX: 1200, clientY: handle.y + 100, preventDefault() {} });
    assert.ok(sampler.drag);
    assert.ok(context.realtimePreview.viewDivisor > 1.3);
    const before = sampler.draftChart.judgeLineList[0].eventLayers[0].moveXEvents[0].start;
    sampler.move({ clientX: 1200, clientY: handle.y + 100, preventDefault() {} });
    assert.equal(sampler.draftChart.judgeLineList[0].eventLayers[0].moveXEvents[0].start, before);
    sampler.move({ clientX: 1240, clientY: handle.y + 100, preventDefault() {} });
    assert.ok(sampler.draftChart.judgeLineList[0].eventLayers[0].moveXEvents[0].start > before);
    sampler.finish(apply);
    assert.equal(context.preview.viewDivisor, 1.7); assert.equal(context.realtimePreview.viewDivisor, 1.3);
    assert.equal(classes.has('event-sampling'), false);
    assert.equal(session.chart === original, !apply);
  }
});

test('初始出界控制点自动纳入视野，关闭自适应则保留原视野', () => {
  const chart = createChart(); chart.judgeLineList[0].eventLayers[0].moveYEvents = [createEvent(5000)];
  for (const enabled of [false, true]) {
    const { sampler, context } = fixture(chart, enabled);
    sampler.begin({ type: 'rotateEvents', index: 0, field: 'start', lineIndex: 0 });
    assert.equal(context.realtimePreview.viewDivisor > 1.3, enabled);
    if (enabled) {
      const point = sampler.view().screen(sampler.handle(sampler.draftChart));
      assert.ok(point.y >= 90 && point.y < 600);
    }
    sampler.finish(false);
    assert.equal(context.realtimePreview.viewDivisor, 1.3);
  }
});

test('多次数值取样仅在应用时提交，取消及完成均恢复编辑区域', () => {
  const { sampler, classes, session } = fixture();
  const chart = session.chart;
  sampler.updateValueDraft({ type: 'alphaEvents', index: 0, field: 'start', lineIndex: 0 }, 80);
  sampler.updateValueDraft({ type: 'alphaEvents', index: 0, field: 'end', lineIndex: 0 }, 160);
  assert.equal(session.chart, chart); assert.ok(classes.has('event-sampling'));
  sampler.finish(true);
  const line = session.chart.judgeLineList[0]!;
  assert.equal(line.eventLayers![0]!.alphaEvents![0]!.start, 80);
  assert.equal(line.eventLayers![0]!.alphaEvents![0]!.end, 160);
  assert.equal(classes.has('event-sampling'), false);
});

test('数值取样提交可使用调用方标签，空取样不产生历史', () => {
  const { sampler, session } = fixture();
  sampler.updateValueDraft({ type: 'alphaEvents', index: 0, field: 'start', lineIndex: 0 }, 80);
  sampler.finishValue(true, '拖动修改事件起始透明度');
  assert.equal(session.history.undoStack.at(-1)!.label, '拖动修改事件起始透明度');
  const historyLength = session.history.undoStack.length;
  sampler.finishValue(false);
  sampler.finishValue(true, '拖动修改事件起始透明度');
  assert.equal(session.history.undoStack.length, historyLength);
});

test('数值取样暂停时循环预览事件时间段，播放中跟随当前时间', () => {
  const { sampler, session, context } = fixture();
  const event = session.chart.judgeLineList[0]!.eventLayers![0]!.alphaEvents![0]!;
  const start = context.tempo.seconds(event.startTime, 1);
  const end = context.tempo.seconds(event.endTime, 1);
  assert.ok(end > start, '默认事件有正的时间跨度');
  sampler.updateValueDraft({ type: 'alphaEvents', index: 0, field: 'start', lineIndex: 0 }, 80);
  assert.equal(sampler.looping, true);
  const first = sampler.previewState().seconds;
  assert.ok(first >= start - 1e-9 && first <= end + 1e-9, `${first} 应落在 [${start}, ${end}]`);
  sampler.valueDraft.startedAt -= 200;
  const second = sampler.previewState().seconds;
  assert.notEqual(second, first, '预览时间随时间推进');
  assert.ok(second >= start - 1e-9 && second <= end + 1e-9);
  context.playing = () => true;
  assert.equal(sampler.looping, false);
  assert.equal(sampler.previewState().seconds, 0, '播放中沿用当前时间');
  context.playing = () => false;
  sampler.finishValue(false);
  assert.equal(sampler.looping, false, '结束取样后停止循环');
  assert.equal(sampler.previewState(), null);
});

test('无时间跨度的事件退化为当前时间静态预览', () => {
  const chart = createChart();
  chart.judgeLineList[0].eventLayers[0].alphaEvents = [createEvent(0, 0, 2, 2)];
  const { sampler, context } = fixture(chart);
  sampler.updateValueDraft({ type: 'alphaEvents', index: 0, field: 'start', lineIndex: 0 }, 80);
  assert.equal(sampler.looping, false);
  assert.equal(sampler.previewState().seconds, context.seconds());
});

test('数值拖动和取样沿用绑定组同步规则，钩定首尾一致并作为一步撤销',()=>{
  const chart=createChart(),events=[{...createEvent(20,120,0,4),linkgroup:7,inst:1},{...createEvent(20,120,4,8),linkgroup:7}];
  chart.judgeLineList[0].eventLayers[0].moveXEvents=events;
  const {sampler,session}=fixture(chart);
  sampler.updateValueDraft({type:'moveXEvents',index:0,lineIndex:0,field:'end'},50);
  assert.deepEqual(sampler.valueDraft.chart.judgeLineList[0].eventLayers[0].moveXEvents.map((event: ChartEvent)=>[event.start,event.end]),[[50,50],[50,50]]);
  assert.equal(session.chart,chart);sampler.finishValue(true);assert.equal(session.history.undoStack.length,1);
  session.travel('undo');assert.equal(session.chart,chart);
});

test('草稿期间发生其他编辑或撤销时，不覆盖新谱面或清空重做',()=>{
  for(const action of ['commit','undo','session','layer']){
    const {sampler,session,context}=fixture();
    session.commit('改名',{...session.chart,META:{...session.chart.META,name:'Changed'}});
    sampler.updateValueDraft({type:'alphaEvents',index:0,field:'start',lineIndex:0},80);
    if(action==='commit')session.commit('其他修改',{...session.chart,META:{...session.chart.META,name:'Other'}});
    if(action==='undo')session.travel('undo');
    if(action==='session')context.session=new EditorSession();
    if(action==='layer')session.eventLayer=1;
    const current=context.session.chart,history=context.session.history.undoStack.length,redo=context.session.history.redoStack.length;
    sampler.finishValue(true);
    assert.equal(context.session.chart,current,action);assert.equal(context.session.history.undoStack.length,history,action);assert.equal(context.session.history.redoStack.length,redo,action);
    assert.equal(sampler.previewState(),null);assert.equal(session.liveEventEdit,false);
  }
});

test('过期草稿停止预览且后续拖动更新不会悄悄恢复旧修改',()=>{
  const {sampler,session}=fixture();
  sampler.updateValueDraft({type:'alphaEvents',index:0,field:'start',lineIndex:0},80);
  session.commit('其他修改',{...session.chart,META:{...session.chart.META,name:'Other'}});
  assert.equal(sampler.updateValueDraft({type:'alphaEvents',index:0,field:'end',lineIndex:0},120),false);
  assert.equal(sampler.valueDraft,null);assert.equal(session.chart.META.name,'Other');assert.equal(session.history.undoStack.length,1);
});
