import test from 'node:test';
import assert from 'node:assert/strict';
import { createChart } from '../src/core/chart.mjs';
import { EditorSession } from '../src/application/session.mjs';
import { replaceShaderResource, shaderReferenceCount } from '../src/application/shader-resource-commands.mjs';
import { materializeShader } from '../src/platform/shader-library.mjs';
import { chartNamePrefix, namedShaderSource, shaderSourceBody, shaderAssetLabel, inferShaderAssetNames } from '../src/core/shader-source-info.mjs';
import { shaderUniforms, shaderUniformSchema, shaderVariableProblems } from '../src/core/shader-uniforms.mjs';
import { resourceDiagnostics } from '../src/core/diagnostic-resources.mjs';
import { ChartDiagnostics } from '../src/platform/chart-diagnostics.mjs';
import { ShaderRuntime } from '../src/core/shader.mjs';
import { TempoMap } from '../src/core/tempo.mjs';
import { createChartExport, openFiles } from '../src/platform/files.mjs';
import { fragmentSource, shaderDefaults } from '../src/ui/shader-pipeline.mjs';

const encode = source => new TextEncoder().encode(source), decode = bytes => new TextDecoder().decode(bytes);
const source = '#version 100\nprecision mediump float;\nvarying vec2 uv;\nuniform sampler2D screenTexture;\nuniform float strength; // %0.5%\nvoid main(){gl_FragColor=texture2D(screenTexture,uv)*strength;}';
const event = shader => ({ shader, line: 0, start: [0, 0, 1], end: [8, 0, 1], vars: { strength: .5 } });

test('chart shader names survive Unicode, source renames and PEZ round trips without exposing the hash', async () => {
  const chart = createChart(); chart.META.name = '示例😀超长谱面名称';
  const template = { id: 'original', name: '柔光', source }, asset = await materializeShader(template, new Map(), chartNamePrefix(chart));
  const assets = new Map([[asset.path, asset.bytes]]); chart.effects = [event(asset.shader)];
  assert.equal(chartNamePrefix(chart), '示例😀超长谱');
  assert.equal(shaderAssetLabel(asset.path, assets, chart), '柔光 · 示例😀超长谱');
  assert.equal(shaderSourceBody(decode(asset.bytes)), source); assert.match(decode(asset.bytes), /^#version 100\n\/\/ @rpen-template/);
  const exported = createChartExport(chart, assets, 'nested/chart.json');
  const imported = await openFiles([{ name: 'shader.pez', arrayBuffer: () => exported.blob.arrayBuffer() }]);
  assert.deepEqual(imported.assets.get(asset.path), asset.bytes);
  assert.equal(shaderAssetLabel(asset.path, imported.assets, imported.candidates[0].chart), '柔光 · 示例😀超长谱');
  const renamed = { ...chart, META: { ...chart.META, name: '新谱名' } };
  assert.equal(shaderAssetLabel(asset.path, assets, renamed), '柔光 · 新谱名');
  const legacy = 'shaders/custom/' + 'a'.repeat(64) + '.glsl'; assets.set(legacy, encode(source)); inferShaderAssetNames([legacy], assets, [template]);
  assert.equal(shaderAssetLabel(legacy, assets, chart), '柔光 · 示例😀超长谱');
  assert.match(namedShaderSource('void main(){}', { name: 'quote"\n// arbitrary' }), /^\/\/ @rpen-template [^\n]+\nvoid main/);
  const metadata = namedShaderSource(source, { name: '@rpen-builtin uniform float fake; // %9%' });
  assert.equal(fragmentSource(metadata), fragmentSource(source)); assert.deepEqual(shaderDefaults(metadata), shaderDefaults(source));
});

test('all references use the same chart file; source replacement, undo, redo and conflicts preserve event data', async () => {
  const chart = createChart(), resource = await materializeShader({ id: 'shared', name: '同一效果', source }, new Map(), '示例');
  chart.effects = [event(resource.shader), { ...event(resource.shader), line: 1 }]; chart.judgeLineList.push(structuredClone(chart.judgeLineList[0]));
  chart.judgeLineList[1].extended.paintEvents = [{ shader: resource.shader, startTime: [1, 0, 1], endTime: [3, 0, 1], vars: { strength: .8 } }];
  const session = new EditorSession(chart), assets = new Map([[resource.path, resource.bytes]]), before = JSON.stringify(session.chart); let changes = 0;
  const editor = { assets, session, chartName: 'chart.json', shaderAssetsChanged: () => changes++ };
  assert.equal(replaceShaderResource(editor, resource.path, new Uint8Array(resource.bytes), resource.bytes), resource.bytes);
  assert.equal(changes, 0); assert.equal(session.history.undoStack.length, 0);
  assert.equal(shaderReferenceCount(session.chart, assets, resource.path, editor.chartName), 3);
  const changed = encode(namedShaderSource(source.replace('%0.5%', '%0.9%'), { name: '新版' }));
  replaceShaderResource(editor, resource.path, changed, resource.bytes);
  assert.equal(changes, 1); assert.equal(JSON.stringify(session.chart), before); assert.equal(assets.get(resource.path), changed);
  const runtime = new ShaderRuntime(); runtime.setAssets(assets); runtime.compile(session.chart, new TempoMap(chart.BPMList));
  assert.equal(runtime.effects.length, 3); for (const effect of runtime.effects) assert.equal(runtime.source(effect.shader, effect.sourceName), decode(changed));
  session.travel('undo'); assert.equal(assets.get(resource.path), resource.bytes); session.travel('redo'); assert.equal(assets.get(resource.path), changed);
  assert.equal(changes, 3); assert.throws(() => replaceShaderResource(editor, resource.path, encode(source), resource.bytes), /重新载入/);
});

test('reapplying a global snapshot reuses its edited chart copy; changing the global source creates another isolated snapshot', async () => {
  const template = { id: 'global-source', name: '共享模板', source }, first = await materializeShader(template, new Map(), '谱面一'), assets = new Map([[first.path, first.bytes]]);
  const edited = encode(decode(first.bytes).replace('%0.5%', '%0.8%')); assets.set(first.path, edited);
  const reused = await materializeShader(template, assets, '谱面一'); assert.equal(reused.path, first.path); assert.equal(reused.bytes, edited);
  const updated = await materializeShader({ ...template, source: source + '\n// new global version' }, assets, '谱面一');
  assert.notEqual(updated.path, first.path); assert.equal(assets.get(first.path), edited);
  const secondChart = await materializeShader(template, new Map(), '谱面二'); assert.equal(shaderSourceBody(decode(secondChart.bytes)), source);
  const otherTemplate = await materializeShader({ ...template, id: 'different-global' }, assets, '谱面一'); assert.notEqual(otherTemplate.path, first.path);
});

test('parameter diagnostics detect removed definitions and vector dimensions on every reference without deleting tracks', () => {
  const chart = createChart(); chart.effects = [event('/custom.fs'), event('/custom.fs')];
  chart.effects[0].vars = { removed: [{ startTime: [0, 0, 1], endTime: [2, 0, 1], start: 0, end: 1 }], position: [1, 2, 3, 4], strength: .5 };
  chart.effects[1].vars = { removed: 2, position: [1, 2] };
  const bytes = encode(source + '\nuniform vec2 position; // %0,0%\n// uniform float removed; // %0%\n/* uniform vec4 other; */');
  const schema = shaderUniformSchema(bytes), before = JSON.stringify(chart);
  assert.equal(shaderUniformSchema(bytes), schema);
  assert.deepEqual(Object.keys(schema), ['strength', 'position']);
  const issues = resourceDiagnostics(chart, { assetPaths: ['custom.fs'], shaderUniforms: { 'custom.fs': schema } });
  assert.deepEqual(issues.map(issue => issue.code), ['shaderUniformMissing', 'shaderUniformType', 'shaderUniformMissing']);
  assert.equal(new Set(issues.map(issue => issue.path)).size, 3); assert.ok(issues.every(issue => issue.severity === 'error'));
  assert.equal(JSON.stringify(chart), before); assert.equal(shaderVariableProblems({ vars: {} }, schema).length, 0);
  assert.equal(shaderUniforms('// uniform float ignored;\nvoid main(){}').length, 0);
  assert.equal(shaderVariableProblems({ vars: { strength: [{ start: 1, end: 2 }, null] } }, schema)[0].code, 'shaderUniformType');
});

test('basic diagnostics pass cached, compact uniform definitions only when chart or assets change', () => {
  const chart = createChart(); chart.effects = [event('/main.fs')]; const assets = new Map([['main.fs', encode(source)], ['unused.glsl', encode(source.repeat(10))]]);
  const context = { chart, assets, assetRevision: 0 }, diagnostics = new ChartDiagnostics(() => context);
  diagnostics.update(); clearTimeout(diagnostics.timer);
  const first = diagnostics.options(); assert.deepEqual(Object.keys(first.shaderUniforms), ['main.fs']); assert.equal(first.assetTexts, undefined);
  assert.equal(diagnostics.update(), false); assert.equal(diagnostics.options().shaderUniforms['main.fs'], first.shaderUniforms['main.fs']);
  assets.set('main.fs', encode(source.replace('strength', 'renamed'))); context.assetRevision++;
  assert.equal(diagnostics.update(), true); clearTimeout(diagnostics.timer);
  const changed = diagnostics.options(); assert.notEqual(changed.shaderUniforms['main.fs'], first.shaderUniforms['main.fs']); assert.ok(changed.shaderUniforms['main.fs'].renamed);
  diagnostics.reset();
});

test('runtime keeps unchanged decoded sources through unrelated refreshes and does not sort or read assets per frame', () => {
  const chart = createChart(), bytes = encode(source), assets = new Map([['main.fs', bytes]]); let starts = 0;
  const segments = [3, 0, 2, 2].map((start, index) => ({ get startTime() { starts++; return [start, 0, 1]; }, endTime: [4, 0, 1], start: index, end: index, easingType: 1 }));
  chart.effects = [{ ...event('/main.fs'), vars: { strength: segments } }]; const tempo = new TempoMap(chart.BPMList), runtime = new ShaderRuntime(); runtime.setAssets(assets); runtime.compile(chart, tempo);
  const saved = runtime.source('/main.fs', '/main.fs'), duringCompile = starts;
  // Equal start times choose the last segment, matching stable chronological sorting.
  assert.equal(runtime.active(tempo.seconds(2.5))[0].values.strength, 3);
  for (let i = 0; i < 100; i++) runtime.active(tempo.seconds(2.5));
  assert.ok(starts - duringCompile < segments.length * 101);
  runtime.setAssets(assets, '', 1); runtime.compile(chart, tempo); assert.equal(runtime.source('/main.fs', '/main.fs'), saved); assert.equal(runtime.sourceBytes.get('file:main.fs'), bytes);
});
