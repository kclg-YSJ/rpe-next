import test from 'node:test';
import assert from 'node:assert/strict';
import { EventSampler } from '../src/ui/event-sampler.mjs';
import { EditorSession } from '../src/application/session.ts';
import { createChart, createLine, createEvent } from '../src/core/chart.ts';
import { TempoMap } from '../src/core/tempo.ts';
import { SceneRuntime } from '../src/core/scene.ts';

function fixture(chart = createChart(), autoFit = true) {
  const sampler = Object.create(EventSampler.prototype);
  const session = new EditorSession(chart); session.eventLayer = 0;
  const preview = { viewDivisor: 1.7, aspectRatio: 1.5 };
  const realtimePreview = { viewDivisor: 1.3, aspectRatio: 1.5 };
  const context = { session, tempo: new TempoMap(chart.BPMList), preview, realtimePreview, previewVisible: false, sampleAutoFit: autoFit, seconds: () => 0 };
  const classes = new Set();
  sampler.host = { closest: () => ({ classList: { toggle: (name, value) => value ? classes.add(name) : classes.delete(name) } }) };
  sampler.canvas = { getBoundingClientRect: () => ({ left: 20, top: 100, width: 900, height: 600 }), setPointerCapture() {}, releasePointerCapture() {} };
  sampler.sampleBar = { getBoundingClientRect: () => ({ bottom: 170 }) };
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
  const state = scene.sampler(display.seconds)(1); const handle = sampler.handle(sampler.draftChart);
  assert.ok(Math.abs(state.x - handle.x) < 1e-8);
  assert.ok(Math.abs(state.y + handle.y) < 1e-8);
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
  assert.equal(session.chart.judgeLineList[0].eventLayers[0].alphaEvents[0].start, 80);
  assert.equal(session.chart.judgeLineList[0].eventLayers[0].alphaEvents[0].end, 160);
  assert.equal(classes.has('event-sampling'), false);
});
