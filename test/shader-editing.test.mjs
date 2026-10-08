import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createChart, createLine, diagnose, parseChart, serializeChart } from '../src/core/chart.mjs';
import { fromNumber } from '../src/core/beat.mjs';
import { shaderEvents, shaderParameterTrack, shaderParameters, parseShaderValue, shaderTypeFields, shaderEventLanes } from '../src/core/shader-events.mjs';
import { ShaderRuntime } from '../src/core/shader.mjs';
import { EditorSession } from '../src/application/session.mjs';
import { eventList, placedEvent, insertEvent, transformEvents, deleteEvents, copyEvents, pasteEvents } from '../src/application/event-commands.mjs';
import { reorderLine, deleteLine, duplicateLine } from '../src/application/line-commands.mjs';
import { TempoMap } from '../src/core/tempo.mjs';
import { Timeline } from '../src/ui/timeline.mjs';
import { Preview } from '../src/ui/preview.mjs';
import { packageEntries } from '../src/platform/files.mjs';

const effect = (shader = 'grayscale', line = 0) => ({ shader, line, start: [0, 0, 1], end: [4, 0, 1], global: false, order: 0, vars: { factor: 0.5 } });
const recordingContext = () => new Proxy({ calls: [] }, { get(target, key) { return key in target ? target[key] : (...args) => target.calls.push({ method: key, args, color: target.fillStyle, alpha: target.globalAlpha ?? 1 }); } });
const canvas = context => ({ style: {}, clientWidth: 600, clientHeight: 600, addEventListener() {}, getContext: () => context, getBoundingClientRect: () => ({ width: 600, height: 600 }) });

test('extra 着色器投影到所属线，可修改、复制、删除与撤销，未知数据保留', () => {
  const chart = createChart(); chart.judgeLineList.push(createLine());
  chart.effects = [{ ...effect(), extension: { untouched: true } }, effect('noise', 1)];
  const original = structuredClone(chart); const session = new EditorSession(chart);
  assert.equal(shaderEvents(chart, 0).length, 1); assert.deepEqual(chart, original);
  session.eventSelection.add('paintEvents:0');
  transformEvents(session, '编辑 shader', event => ({ ...event, order: 7, endTime: [6, 0, 1], vars: { factor: [{ startTime: [1, 0, 1], endTime: [5, 0, 1], start: 0, end: 1, easingType: 2 }] } }));
  assert.equal(eventList(session, 'paintEvents')[0].order, 7);
  assert.deepEqual(session.chart.effects.find(event => event.line === 0).end, [6, 0, 1]);
  assert.deepEqual(session.chart.effects.find(event => event.line === 0).extension, { untouched: true });
  assert.deepEqual(session.chart.effects.find(event => event.line === 1), original.effects[1]);
  copyEvents(session); pasteEvents(session, 8);
  assert.equal(eventList(session, 'paintEvents').length, 2);
  deleteEvents(session); assert.equal(eventList(session, 'paintEvents').length, 1);
  session.travel('undo'); assert.equal(eventList(session, 'paintEvents').length, 2);
  assert.deepEqual(parseChart(serializeChart(session.chart)), session.chart);
});

test('放置默认 chromatic；同类与不同 shader 均可重叠，普通事件仍拒绝重叠', () => {
  const chart = createChart(); chart.effects = [effect()]; const session = new EditorSession(chart);
  const placed = placedEvent(session, 'paintEvents', 0, 4);
  assert.equal(placed.shader, 'chromatic'); insertEvent(session, 'paintEvents', placed);
  assert.equal(diagnose(session.chart).filter(issue => issue.path.startsWith('paintEvents')).length, 0);
  insertEvent(session, 'paintEvents', placedEvent(session, 'paintEvents', 1, 3));
  copyEvents(session); pasteEvents(session, 1);
  assert.equal(diagnose(session.chart).filter(issue => issue.path.startsWith('paintEvents')).length, 0);
  assert.equal(eventList(session, 'paintEvents').length, 4);
  insertEvent(session, 'moveXEvents', placedEvent(session, 'moveXEvents', 10, 14));
  assert.throws(() => placedEvent(session, 'moveXEvents', 11, 13), /重叠/);
});

test('重叠的同类 shader 按 order 独立叠加，相接边界只应用后一个事件', () => {
  const chart = createChart();
  chart.effects = [{ ...effect(), order: 2 }, { ...effect(), order: 1 }, { ...effect(), start: [4, 0, 1], end: [8, 0, 1] }];
  const runtime = new ShaderRuntime(); runtime.load = () => {};
  const tempo = new TempoMap(chart.BPMList); runtime.compile(chart, tempo);
  assert.deepEqual(runtime.active(tempo.seconds(2)).map(entry => entry.order), [1, 2]);
  assert.equal(runtime.active(tempo.seconds(4)).length, 1);
  assert.equal(runtime.active(tempo.seconds(8)).length, 0);
});

test('shader 参数标量、向量、默认值、绝对拍数及原版 clone 类型', async () => {
  const source = await readFile(new URL('../public/assets/rpe/shaders/pr/rain_pr.glsl', import.meta.url), 'utf8');
  const definitions = shaderParameters(source);
  assert.deepEqual(definitions.find(entry => entry.name === 'rainColor').value, [0.7, 0.8, 0.9, 0.6]);
  assert.ok(!definitions.some(entry => ['screenSize', 'time'].includes(entry.name)));
  assert.equal(parseShaderValue('0.25', 1), 0.25); assert.deepEqual(parseShaderValue('1, 2, 3, 4', 4), [1, 2, 3, 4]);
  assert.throws(() => parseShaderValue('1,', 2)); assert.throws(() => parseShaderValue('NaN', 1));
  const projected = { ...effect(), startTime: [2, 0, 1], endTime: [4, 0, 1] };
  assert.deepEqual(shaderParameterTrack(projected, 'factor')[0], { startTime: [2, 0, 1], endTime: [4, 0, 1], start: 0.5, end: 0.5, easingType: 1 });
  assert.deepEqual(shaderTypeFields('circle_blur_2'), { shader: 'circleBlur', clone: true });
  assert.deepEqual(shaderTypeFields('rain'), { shader: '/rain_pr.glsl', clone: false });
});

test('shader 参数按原版真实秒插值，使用所属线倍率；首段开始前采用默认值', () => {
  const chart = createChart(); chart.judgeLineList[0].bpmfactor = 2;
  chart.BPMList.push({ startTime: [2, 0, 1], bpm: 60 });
  chart.effects = [{ ...effect(), clone: true, vars: { factor: [{ startTime: [0, 0, 1], endTime: [4, 0, 1], start: 0, end: 1, easingType: 1 }], later: [{ startTime: [3, 0, 1], endTime: [4, 0, 1], start: 8, end: 9 }] } }];
  const runtime = new ShaderRuntime(); runtime.load = () => {}; runtime.compile(chart, new TempoMap(chart.BPMList));
  assert.equal(runtime.active(2)[0].shader, 'grayscale_2');
  assert.equal(runtime.active(2)[0].values.factor, 1 / 3);
  assert.equal(runtime.active(2)[0].values.later, undefined);
  assert.equal(runtime.active(7).length, 0);
});

test('移动 shader 默认对齐参数首拍，可关闭自动对齐；参数时长不变', () => {
  const chart = createChart();
  chart.effects = [{ ...effect(), vars: { factor: [{ startTime: [1, 0, 1], endTime: [3, 0, 1], start: 0, end: 1, easingType: 1 }] } }];
  const session = new EditorSession(chart); session.eventSelection.add('paintEvents:0');
  transformEvents(session, '移动', event => ({ ...event, startTime: [8, 0, 1], endTime: [12, 0, 1] }));
  assert.deepEqual(eventList(session, 'paintEvents')[0].vars.factor[0].startTime, [8, 0, 1]);
  assert.deepEqual(eventList(session, 'paintEvents')[0].vars.factor[0].endTime, [10, 0, 1]);
  session.shaderAutoAlign = false;
  transformEvents(session, '移动', event => ({ ...event, startTime: [10, 0, 1], endTime: [14, 0, 1] }));
  assert.deepEqual(eventList(session, 'paintEvents')[0].vars.factor[0].startTime, [8, 0, 1]);
});

test('特殊层实际画出 extra 事件并可命中，参数外层不画普通数值缓动', () => {
  globalThis.devicePixelRatio = 1;
  const chart = createChart(); chart.effects = [effect(), effect('noise')];
  const session = new EditorSession(chart); const context = recordingContext();
  const timeline = new Timeline(canvas(recordingContext()), canvas(context), () => session, () => {}, () => {});
  timeline.extended = true; timeline.drawEvents(0);
  const rectangles = timeline.eventRects.filter(rectangle => rectangle.type === 'paintEvents');
  assert.equal(rectangles.length, 2); assert.notEqual(rectangles[0].x, rectangles[1].x);
  assert.ok(context.calls.some(call => call.method === 'fillText' && call.args[0] === 'grayscale'));
  const rectangle = rectangles[0];
  assert.equal(timeline.eventInteraction.hit({ x: rectangle.x + 1, y: rectangle.y + 1 }).type, 'paintEvents');
  session.eventSelection.add('paintEvents:0');
  transformEvents(session, '移动 shader', event => ({ ...event, startTime: fromNumber(20), endTime: fromNumber(24) }));
  timeline.drawEvents(0); assert.equal(timeline.eventRects.filter(rectangle => rectangle.type === 'paintEvents').length, 1);
});

test('首尾相接的 shader 保持完整宽度，只有真正重叠时分栏且不随视野改变', () => {
  const chart = createChart(); chart.effects = [effect(), { ...effect('noise'), start: [4, 0, 1], end: [8, 0, 1] }];
  const session = new EditorSession(chart); const context = recordingContext();
  const timeline = new Timeline(canvas(recordingContext()), canvas(context), () => session, () => {}, () => {});
  timeline.extended = true; timeline.origin = 2; timeline.drawEvents(2);
  const width = timeline.eventColumnBounds(3, 600).width;
  const rectangles = timeline.eventRects.filter(rectangle => rectangle.type === 'paintEvents');
  assert.equal(rectangles.length, 2); assert.equal(rectangles[0].width, width); assert.equal(rectangles[1].width, width);
  assert.equal(rectangles[0].x, rectangles[1].x);
  timeline.origin = 6; timeline.drawEvents(6);
  assert.equal(timeline.eventRects.find(rectangle => rectangle.type === 'paintEvents').width, width);
  const events = [{ startTime: [0, 0, 1], endTime: [8, 0, 1] }, { startTime: [2, 0, 1], endTime: [4, 0, 1] }, { startTime: [8, 0, 1], endTime: [12, 0, 1] }];
  const layout = shaderEventLanes(events);
  assert.deepEqual([...layout.values()], [{ lane: 0, count: 2 }, { lane: 1, count: 2 }, { lane: 0, count: 1 }]);
});

test('shader 使用相同的不透明背景底色，成功时替换原画面、失败及结束时恢复', () => {
  globalThis.devicePixelRatio = 1;
  const chart = createChart(); chart.effects = [effect()];
  const context = recordingContext(); const surface = canvas(context); const preview = new Preview(surface);
  preview.visible = true; preview.images = { background: { naturalWidth: 1350, naturalHeight: 900 } };
  preview.shaderRuntime.load = () => {}; preview.shaderPipeline.render = () => true;
  const tempo = new TempoMap(chart.BPMList); preview.draw(chart, tempo, 0, 0);
  const fill = context.calls.findIndex(call => call.method === 'fillRect' && call.color === '#111');
  const background = context.calls.findIndex(call => call.method === 'drawImage');
  assert.ok(fill >= 0 && fill < background); assert.equal(context.calls[fill].alpha, 1);
  assert.equal(context.calls[background].alpha, 0.35); assert.equal(surface.style.opacity, '0');
  preview.shaderPipeline.render = () => false; preview.draw(chart, tempo, 0, 0); assert.equal(surface.style.opacity, '1');
  preview.shaderPipeline.render = () => true; preview.draw(chart, tempo, 3, 0); assert.equal(surface.style.opacity, '1');
  context.calls.length = 0; preview.applyShaders = false; preview.draw(chart, tempo, 0, 0);
  assert.ok(!context.calls.some(call => call.method === 'fillRect' && call.color === '#111'));
});

test('PEZ 更新所属 extra.json 并保留其他字段、原资源及其他项目', () => {
  const chart = createChart(); chart.effects = [effect()];
  const encode = value => new TextEncoder().encode(JSON.stringify(value));
  const assets = new Map([['song/EXTRA.JSON', encode({ extension: 42, effects: [] })], ['other/extra.json', encode({ effects: ['keep'] })]]);
  const output = packageEntries(chart, assets, 'song/chart.json');
  const extra = JSON.parse(new TextDecoder().decode(output.get('song/EXTRA.JSON')));
  assert.deepEqual(extra, { extension: 42, effects: chart.effects });
  assert.deepEqual(output.get('other/extra.json'), assets.get('other/extra.json'));
  assert.deepEqual(JSON.parse(new TextDecoder().decode(assets.get('song/EXTRA.JSON'))).effects, []);
  chart.effects = []; assert.deepEqual(JSON.parse(new TextDecoder().decode(packageEntries(chart, assets, 'song/chart.json').get('song/EXTRA.JSON'))).effects, []);
});

test('判定线重排、复制、删除时 shader 所属线同步，原对象不变', () => {
  const chart = createChart(); chart.judgeLineList.push(createLine()); chart.effects = [effect(), effect('noise', 1)];
  assert.equal(reorderLine(chart, 0, 1).effects[0].line, 1);
  assert.deepEqual(deleteLine(chart, 0).effects, [{ ...chart.effects[1], line: 0 }]);
  const duplicate = duplicateLine(chart, 0); assert.equal(duplicate.effects.length, 3);
  assert.deepEqual(duplicate.effects.find(event => event.line === 2).vars, chart.effects[0].vars);
  assert.equal(chart.effects.length, 2); assert.equal(chart.effects[0].line, 0);
});
