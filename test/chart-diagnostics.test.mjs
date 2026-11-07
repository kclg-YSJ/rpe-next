import test from 'node:test';
import assert from 'node:assert/strict';
import { createChart, createLine, createNote, createEvent, diagnose } from '../src/core/chart.mjs';
import { fromNumber } from '../src/core/beat.mjs';
import { deepDiagnostics } from '../src/core/deep-diagnostics.mjs';
import { DiagnosticAssetIndex, resourceDiagnostics, compatibilityDiagnostics } from '../src/core/diagnostic-resources.mjs';
import { diagnosticPatch, applyDiagnosticPatch } from '../src/platform/diagnostic-patch.mjs';
import { ChartDiagnostics } from '../src/platform/chart-diagnostics.mjs';
import { GlobalEventRegistry } from '../src/core/global-events.mjs';

const byCode = (issues, code) => issues.filter(issue => issue.code === code);

test('零时长 Hold 仅警告，反向时间仍报错，零速度不误报非法数值', () => {
  const c = createChart();
  c.judgeLineList[0].notes = [createNote(2, 2, 0, 2), createNote(2, 4, 100, 3), { ...createNote(2, 5, 200, 8), speed: 0 }];
  const issues = diagnose(c);
  assert.deepEqual(byCode(issues, 'holdZero').map(issue => [issue.index, issue.severity]), [[0, 'warning']]);
  assert.deepEqual(issues.filter(issue => issue.severity === 'error').map(issue => [issue.index, issue.code]), [[1, 'noteTime']]);
});
test('X 过大仅提示、默认阈值 700，非零层速度和 >255 透明度为警告，负透明度不警告', () => {
  const c = createChart(), line = c.judgeLineList[0];
  line.notes = [createNote(1, 2, 700), createNote(1, 2, 701), { ...createNote(1, 3, 800), isFake: 1 }, { ...createNote(1, 4, 0), size: 0 }];
  line.eventLayers.push({ speedEvents: [createEvent(3)], alphaEvents: [createEvent(-255), createEvent(300, 300, 2, 3)] });
  const issues = diagnose(c); assert.deepEqual(byCode(issues, 'xRange').map(issue => [issue.index, issue.severity]), [[1, 'info']]);
  assert.equal(byCode(issues, 'layerSpeed').length, 1); assert.equal(byCode(issues, 'layerSpeed')[0].severity, 'warning');
  assert.equal(byCode(issues, 'alphaRange').length, 1); assert.equal(byCode(issues, 'zeroWidth').length, 1);
});
test('第 0 层五栏缺失或仅有正拍事件会自动警告，其他层和扩展事件不补足底层初始值', () => {
  const c = createChart(); assert.equal(byCode(diagnose(c), 'missingBaseline').length, 0);
  c.judgeLineList[0].eventLayers = [{}, c.judgeLineList[0].eventLayers[0]];
  const issues = byCode(diagnose(c), 'missingBaseline');
  assert.deepEqual(issues.map(issue => issue.eventType), ['moveXEvents', 'moveYEvents', 'rotateEvents', 'alphaEvents', 'speedEvents']);
  assert.ok(issues.every(issue => issue.layer === 0 && issue.beat === 0 && issue.severity === 'warning' && !issue.removable && issue.index === undefined));
  assert.equal(new Set(issues.map(issue => issue.message)).size, 5);
  c.judgeLineList = [{ ...c.judgeLineList[0], eventLayers: [] }]; assert.equal(byCode(diagnose(c), 'missingBaseline').length, 5);
  c.judgeLineList = [{ ...c.judgeLineList[0], eventLayers: null }]; assert.equal(byCode(diagnose(c), 'missingBaseline').length, 5);
});
test('第零拍之前已结束的事件、跨零事件、零拍边界及瞬时标记都提供初始值，不要求钩定或同值', () => {
  const c = createChart(); c.judgeLineList[0].eventLayers = [{
    moveXEvents: [createEvent(0, 5, .125, 1)], moveYEvents: [createEvent(0, 10, -4, -2)],
    rotateEvents: [createEvent(0, 90, -1, 2)], alphaEvents: [createEvent(255, 0, 0, 1)], speedEvents: [createEvent(5, 10, -1, 0)]
  }];
  assert.deepEqual(byCode(diagnose(c), 'missingBaseline').map(issue => issue.eventType), ['moveXEvents']);
  const line = c.judgeLineList[0], layers = [{ ...line.eventLayers[0], moveXEvents: [createEvent(1, 1, 0, 0)] }];
  assert.equal(byCode(diagnose({ ...c, judgeLineList: [{ ...line, eventLayers: layers }] }), 'missingBaseline').length, 0);
});
test('垫底检测逐线独立，仅由第 0 层触发；撤销重做和缓存更新恢复或清除对应警告', () => {
  const c = createChart(), line = createLine(); line.eventLayers[0].moveXEvents = [createEvent(10, 20, 1, 2)];
  c.judgeLineList.push(line); const sessionChart = { ...c, judgeLineList: [c.judgeLineList[0], { ...line, eventLayers: [{ ...line.eventLayers[0], moveXEvents: [createEvent(0, 0, -1, 0), ...line.eventLayers[0].moveXEvents] }] }] };
  const initial = byCode(diagnose(c), 'missingBaseline'); assert.deepEqual(initial.map(issue => [issue.line, issue.layer, issue.path]), [[1, 0, 'moveXEvents']]);
  assert.equal(byCode(diagnose(sessionChart), 'missingBaseline').length, 0); assert.deepEqual(byCode(diagnose(c), 'missingBaseline'), initial);
  const secondOnly = createChart(); secondOnly.judgeLineList[0].eventLayers.push({}); assert.equal(byCode(diagnose(secondOnly), 'missingBaseline').length, 0);
});
test('垫底检测与已有轨道检查共用一次读取，选择或修改其他轨道时复用缓存', () => {
  const c = createChart(); let reads = 0;
  const events = Array.from({ length: 10000 }, (_, index) => ({ ...createEvent(), get startTime() { reads++; return [index + 1, 0, 1]; }, endTime: [index + 2, 0, 1] }));
  c.judgeLineList[0].eventLayers[0].moveXEvents = events;
  assert.equal(byCode(diagnose(c), 'missingBaseline').length, 1); assert.equal(reads, events.length);
  reads = 0; diagnose(c); assert.equal(reads, 0);
  const next = { ...c, judgeLineList: [{ ...c.judgeLineList[0], eventLayers: [{ ...c.judgeLineList[0].eventLayers[0], moveYEvents: [createEvent(5)] }] }] };
  assert.equal(byCode(diagnose(next), 'missingBaseline').length, 1); assert.equal(reads, 0);
});
test('音符时间使用所属线 BPM 倍率和延迟，未知音频时长不采用 600 秒占位时长', () => {
  const c = createChart(); c.META.offset = 1000; c.judgeLineList[0].bpmfactor = 2;
  c.judgeLineList[0].notes = [createNote(1, -1, 0), createNote(1, -2, 0), createNote(1, 3, 0), createNote(1, 2000, 0)];
  assert.deepEqual(byCode(diagnose(c, { duration: 3 }), 'timeRange').map(issue => issue.index), [1, 2, 3]);
  assert.deepEqual(byCode(diagnose(c), 'timeRange').map(issue => issue.index), [1]);
});
test('跨音频边界的事件保留，完全处于范围外的事件报错，边界容差和合法瞬时事件不误报', () => {
  const c = createChart(); c.judgeLineList[0].eventLayers[0].moveXEvents = [createEvent(0, 0, -100, 100), createEvent(0, 1, -5, -1), createEvent(0, 1, 10, 12), createEvent(0, 0, 4, 4)];
  assert.deepEqual(byCode(diagnose(c, { duration: 4 }), 'timeRange').map(issue => issue.index), [1, 2]);
  assert.equal(byCode(diagnose(c, { duration: 4 }), 'eventTime').length, 0);
});
test('Hold 身体覆盖 Tap、不同起拍 Hold 交叠，排序与输入顺序无关，Fake/Drag/混合 Flick 不参与', () => {
  const c = createChart(); c.judgeLineList[0].notes = [createNote(2, 1, 0, 5), createNote(1, 3, 0), createNote(2, 2, 0, 6), createNote(4, 3, 0), createNote(3, 3, 0), { ...createNote(1, 4, 0), isFake: true }, { ...createNote(1, 3, 0), above: 2 }, createNote(1, 3, 1)];
  assert.deepEqual(byCode(diagnose(c), 'noteOverlap').map(issue => issue.index), [1, 2]);
  c.judgeLineList[0] = { ...c.judgeLineList[0], notes: [createNote(1, 3, 0), createNote(2, 1, 0, 5)] };
  assert.deepEqual(byCode(diagnose(c), 'noteOverlap').map(issue => issue.index), [0]);
});
test('数万重合 Hold 每个后续物件只产生一条结果，不展开重叠物件对', () => {
  const c = createChart(); c.judgeLineList[0].notes = Array.from({ length: 20000 }, (_, i) => createNote(i % 2 ? 1 : 2, i % 2 ? 2 : 1, 0, 4));
  assert.equal(byCode(diagnose(c), 'noteOverlap').length, 19999);
});
test('事件反向、异常零长度与嵌套冲突可检出，合法同值瞬时标记及 Shader 叠加保持合法', () => {
  const c = createChart(), line = c.judgeLineList[0];
  line.eventLayers[0].moveXEvents = [createEvent(0, 1, 3, 2), createEvent(0, 1, 4, 4), createEvent(2, 2, 5, 5), { ...createEvent(0, 1, 6, 6), inst: 1 }];
  line.eventLayers[0].moveYEvents = [createEvent(0, 0, 0, 10), createEvent(0, 0, 1, 2), createEvent(0, 0, 3, 4)];
  line.extended.paintEvents = [{ startTime: [0, 0, 1], endTime: [4, 0, 1], shader: 'chromatic' }, { startTime: [1, 0, 1], endTime: [3, 0, 1], shader: 'chromatic' }];
  const issues = diagnose(c); assert.equal(byCode(issues, 'eventTime').length, 2); assert.equal(byCode(issues, 'eventOverlap').length, 2);
});
test('数值、缓动编号/左右边界、Bezier 控制点、音符颜色与宽度异常可定位', () => {
  const c = createChart(), line = c.judgeLineList[0];
  line.notes = [{ ...createNote(1, 1, 0), speed: NaN, tint: [999, 0, 0], size: 0, alpha: 300 }];
  line.eventLayers[0].moveXEvents = [{ ...createEvent(0, 1), easingType: 30, easingLeft: .8, easingRight: .2 }, { ...createEvent(0, 1, 1, 2), bezier: 1, bezierPoints: [-1, 0, 2, 1] }];
  const issues = diagnose(c); for (const code of ['value', 'valueRange', 'easing', 'easingBounds', 'bezier', 'zeroWidth', 'alphaRange']) assert.ok(byCode(issues, code).length, code);
});
test('原 RPE 的常量垫底事件不使用缓动编号或切片，保留原数据且不误报；有效插值仍校验', () => {
  const c = createChart(), line = c.judgeLineList[0];
  line.extended.inclineEvents = [{ ...createEvent(0), easingType: 0 }, { ...createEvent(0, 0, 1, 2), easingType: 80, easingLeft: 0, easingRight: 0 }];
  line.extended.colorEvents = [{ ...createEvent(), start: [255, 255, 255], end: [255, 255, 255], easingType: 90 }];
  line.eventLayers[0].moveXEvents = [{ ...createEvent(0, 5), easingLeft: .5, easingRight: .5 }];
  line.eventLayers[0].moveYEvents = [{ ...createEvent(0, 5), easingType: 99, easingLeft: -2, easingRight: 5, bezier: 1, bezierPoints: [0, 0, 1, 1] }];
  const before = JSON.stringify(c), issues = diagnose(c); assert.equal(byCode(issues, 'easing').length, 0); assert.equal(byCode(issues, 'easingBounds').length, 0); assert.equal(JSON.stringify(c), before);
  const invalid = { ...c, judgeLineList: [{ ...line, extended: { ...line.extended, inclineEvents: [{ ...createEvent(0, 10), easingType: 80 }] } }] };
  assert.equal(byCode(diagnose(invalid), 'easing').length, 1);
});
test('Shader 参数内部曲线的数值、拍数与缓动也参与检查，重叠 Shader 仍不误报', () => {
  const c = createChart(); c.effects = [{ shader: 'chromatic', start: [0, 0, 1], end: [8, 0, 1], vars: { strength: [{ ...createEvent(0, Infinity, 3, 2), easingType: 99 }] } }];
  const issues = diagnose(c); for (const code of ['shaderParameterTime', 'value', 'easing']) assert.ok(byCode(issues, code).some(issue => issue.path.includes('vars.strength')));
});

test('Shader parameter beat, reversed time and audio-range errors have specific messages and keep ordinary event errors separate', () => {
  const c = createChart();
  c.effects = [{ shader: 'chromatic', start: [0, 0, 1], end: [8, 0, 1], vars: { power: [
    createEvent(0, 1, 3, 2), { ...createEvent(0, 1, 1, 2), startTime: [NaN, 0, 1] }, createEvent(0, 1, 20, 21),
  ] } }];
  c.judgeLineList[0].eventLayers[0].moveXEvents = [createEvent(0, 1, 2, 1)];
  const issues = diagnose(c, { duration: 4 });
  assert.equal(byCode(issues, 'eventTime').length, 1);
  for (const [code, segment] of [['shaderParameterTime', 0], ['shaderParameterBeat', 1], ['shaderParameterTimeRange', 2]]) {
    const found = byCode(issues, code); assert.equal(found.length, 1); assert.equal(found[0].parameter, 'power');
    assert.equal(found[0].segment, segment); assert.equal(found[0].shaderParameter, true);
    assert.match(found[0].message, /power/); assert.match(found[0].message, new RegExp(String(segment + 1)));
  }
});
test('素材解析沿用就近、精确、规范化、唯一文件名顺序，缺失和歧义分别报告', () => {
  const paths = ['pack/music.ogg', 'a/line.png', 'b/line.png', 's/HIT.WAV', 'skin/main.glsl', 'skin/config.json'];
  const index = new DiagnosticAssetIndex(paths); assert.equal(index.resolve('music.ogg', 'pack/chart.json').path, 'pack/music.ogg'); assert.equal(index.resolve('hit.wav').path, 's/HIT.WAV');
  assert.equal(index.resolve('line.png').matches.length, 2); assert.equal(index.resolve('a/line.png').path, 'a/line.png');
  const c = createChart(); c.META.song = 'music.ogg'; c.judgeLineList[0].Texture = 'unknown.png'; c.judgeLineList[0].notes = [{ ...createNote(1, 1, 0), hitsound: 'line.png' }];
  const issues = resourceDiagnostics(c, { assetPaths: paths, chartName: 'pack/chart.json' }); assert.equal(byCode(issues, 'assetMissing').length, 1); assert.equal(byCode(issues, 'assetAmbiguous').length, 1);
  c.judgeLineList[0].Texture = 'line.png'; assert.equal(byCode(resourceDiagnostics(c, { assetPaths: paths }), 'assetAmbiguous').length, 1);
});
test('深度素材检查追踪已引用皮肤的配置、pass shader、贴图与 include，不扫描未使用素材', () => {
  const c = createChart(); c.noiseAreaLayers = [{ id: 'default', skin: 'skin' }];
  const options = { assetPaths: ['skin/main.glsl', 'skin/config.json', 'skin/pass.glsl', 'unused.glsl'], assetTexts: { 'skin/config.json': '{"passes":[{"shader":"pass.glsl"}]}', 'skin/main.glsl': '// @texture missing.png', 'skin/pass.glsl': '#include "helper.glsl"', 'unused.glsl': '#include "unused-missing.glsl"' } };
  assert.equal(resourceDiagnostics(c, options).length, 0);
  assert.deepEqual(byCode(resourceDiagnostics(c, options, true), 'assetMissing').map(issue => issue.asset).sort(), ['helper.glsl', 'missing.png']);
  assert.equal(resourceDiagnostics(c, { assetPaths: ['skin/main.glsl'] }).length, 0);
});
function globalFixture() {
  const c = createChart(), source = { kind: 'mod', id: 'testmod', name: 'Test', author: 'Author', version: '1' }, registry = new GlobalEventRegistry();
  registry.register({ id: 'camera', name: 'Camera', columns: [{ id: 'x', name: 'X', min: -10, max: 10 }] }, source);
  c.globalEvents = { version: 1, types: { 'testmod/camera': { source, name: 'Camera', columns: { x: { name: 'X', valueType: 'number', events: [createEvent(0, 0, 0, 4), createEvent(20, 20, 1, 2)] } } } } };
  return { c, types: [...registry.types.values()] };
}
test('全局事件检查依赖、作者来源、版本、值域与声明禁止的重叠，允许 overlap 的列不误报', () => {
  const { c, types } = globalFixture();
  assert.equal(byCode(diagnose(c, { globalTypes: [] }), 'modMissing').length, 1);
  const issues = diagnose(c, { globalTypes: types }); assert.equal(byCode(issues, 'eventOverlap').length, 1); assert.equal(byCode(issues, 'valueRange').length, 1);
  assert.equal(byCode(diagnose(c, { globalTypes: [{ ...types[0], source: { ...types[0].source, author: 'Other', version: '2' } }] }), 'modMismatch').length, 1);
  assert.equal(byCode(diagnose(c, { globalTypes: [{ ...types[0], columns: types[0].columns.map(column => ({ ...column, overlap: true })) }] }), 'eventOverlap').length, 0);
});
test('兼容检查按目标区分，Next 保留新特性，原 RPE/Phira 提示不支持的噪域与全局事件', () => {
  const { c } = globalFixture(); c.blockAreaList = [{}];
  assert.equal(compatibilityDiagnostics(c).length, 0);
  assert.deepEqual(compatibilityDiagnostics(c, 'rpe').map(issue => issue.code), ['compatNoise', 'compatGlobal']);
  c.judgeLineList[0].eventLayers[0].moveXEvents = [{ ...createEvent(), bezier: 1, bezierPoints: [1, 0, 0, 1] }];
  assert.equal(byCode(compatibilityDiagnostics(c, 'phira'), 'compatBezier').length, 1);
});
test('诊断增量补丁仅传变化字段/线/轨道，worker 保留不变音符和事件数组，删除扩展字段也同步', () => {
  const before = createChart(); before.judgeLineList.push(createLine());
  const changed = { ...before, judgeLineList: [{ ...before.judgeLineList[0], eventLayers: [{ ...before.judgeLineList[0].eventLayers[0], moveXEvents: [createEvent(20)] }] }, before.judgeLineList[1]] };
  const patch = diagnosticPatch(before, changed); assert.equal(patch.lines.updates.length, 1); assert.deepEqual(Object.keys(patch.lines.updates[0].layers.updates[0].set), ['moveXEvents']);
  const copy = applyDiagnosticPatch(before, patch); assert.deepEqual(copy, changed); assert.equal(copy.judgeLineList[0].notes, before.judgeLineList[0].notes); assert.equal(copy.judgeLineList[1], before.judgeLineList[1]);
  const fewer = { ...changed, judgeLineList: [changed.judgeLineList[1]] }; assert.deepEqual(applyDiagnosticPatch(changed, diagnosticPatch(changed, fewer)), fewer);
  const cleared = { ...changed, judgeLineList: [{ ...changed.judgeLineList[0], extended: null }, changed.judgeLineList[1]] }; assert.deepEqual(applyDiagnosticPatch(changed, diagnosticPatch(changed, cleared)), cleared);
});
test('选择/切线不调度检查，过时响应丢弃，深度仅手动创建 Worker，谱面变更取消深度任务', async () => {
  const calls = [], workers = [], context = { chart: createChart(), assets: new Map(), registry: new GlobalEventRegistry() };
  const controller = new ChartDiagnostics(() => context, () => { const worker = { postMessage: data => calls.push(data), terminate() { this.terminated = true; } }; workers.push(worker); return worker; });
  controller.update(); controller.flush(); const token = calls[0].token; assert.equal(workers.length, 1);
  for (let i = 0; i < 100; i++) controller.update(); assert.equal(calls.length, 1);
  context.chart = { ...context.chart, META: { ...context.chart.META, name: 'Changed' } }; controller.update(); workers[0].onmessage({ data: { token, result: [{ code: 'old' }] } }); assert.equal(controller.basic.length, 0);
  await controller.startDeep(); assert.equal(workers.length, 2); assert.equal(calls.at(-1).deep, true);
  context.assetRevision = 1; controller.update(); assert.equal(workers[1].terminated, true); assert.equal(controller.running, false);
  controller.reset();
});
test('深度检查判定位置使用比例、父线和偏移；Fake 不参与，300ms 可读时间阈值沿用 RPE', async () => {
  const c = createChart(); c.judgeLineList[0].notes = [createNote(1, 4, 800), { ...createNote(1, 4, 900), isFake: 1 }, { ...createNote(1, 4, 0), visibleTime: .1 }, createNote(1, 4, 135)];
  const issues = await deepDiagnostics(c); assert.deepEqual(byCode(issues, 'outScreen').map(issue => issue.index), [0]); assert.deepEqual(byCode(issues, 'shortRead').map(issue => issue.index), [2]);
  const parent = createLine(); parent.eventLayers[0].moveYEvents = [createEvent(450)]; c.judgeLineList.push(parent); c.judgeLineList[0].father = 1; c.judgeLineList[0].notes = [createNote(1, 4, 675)];
  assert.equal(byCode(await deepDiagnostics(c, { ratio: 16 / 9 }), 'outScreen').length, 0);
});
test('Flick/Drag 后接 Tap 使用实际秒和 40–160ms/200 横坐标阈值、方向及 Fake 隔离', async () => {
  const c = createChart(); c.judgeLineList[0].notes = [createNote(3, 4, -300), createNote(1, 4.2, -300), createNote(4, 6, 300), createNote(1, 6.2, 300), createNote(3, 8, -300), createNote(1, 8.4, -300), { ...createNote(4, 10, 300), isFake: true }, createNote(1, 10.2, 300)];
  const issues = await deepDiagnostics(c); assert.equal(byCode(issues, 'tapAfterFlick').length, 1); assert.equal(byCode(issues, 'tapAfterFlick')[0].severity, 'error'); assert.equal(byCode(issues, 'tapAfterDrag').length, 1);
});
