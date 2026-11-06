import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createChart, createLine } from '../src/core/chart.mjs';
import { TempoMap } from '../src/core/tempo.mjs';
import { SHADER_NAMES, canonicalShaderName, shaderLine, ShaderRuntime, builtinShaderSource } from '../src/core/shader.mjs';
import { shaderTypeFields, shaderParameters } from '../src/core/shader-events.mjs';
import { shaderAssetPath, chartShaderFiles, MAX_SHADER_BYTES } from '../src/core/shader-assets.mjs';
import { assertShaderSource, saveShaderTemplate, readShaderLibrary, materializeShader, removeShaderTemplate } from '../src/platform/shader-library.mjs';
import { prepareShaderExport } from '../src/platform/shader-export.mjs';
import { packageEntries, openFiles, createChartExport } from '../src/platform/files.mjs';
import { SHADER_PRESETS } from '../src/core/shader-presets.mjs';
import { fragmentSource, shaderDefaults } from '../src/ui/shader-pipeline.mjs';
import { DiagnosticAssetIndex, resourceDiagnostics } from '../src/core/diagnostic-resources.mjs';
import { createShaderProblemReporter } from '../src/ui/shader-tool.mjs';
import { shaderSourceBody } from '../src/core/shader-source-info.mjs';

const encode = value => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));
const source = '#version 100\nprecision mediump float;\nvarying vec2 uv;\nuniform sampler2D screenTexture;\nuniform float power; // %0.5%\nvoid main(){gl_FragColor=texture2D(screenTexture,uv)*power;}';
const effect = shader => ({ shader, start: [0, 0, 1], end: [4, 0, 1], vars: {} });

test('one Phira source per visible effect; identical clone names remain input aliases with legacy ownership', async () => {
  assert.equal(SHADER_NAMES.length, 40); assert.equal(SHADER_NAMES.some(name => name.endsWith('_2')), false);
  const files = await readdir(new URL('../assets/rpe/shaders/', import.meta.url));
  assert.equal(files.filter(name => name.endsWith('.glsl')).length, 40);
  assert.ok(!files.some(name => name.endsWith('_2.glsl')));
  for (const name of SHADER_NAMES) {
    const code = builtinShaderSource(await readFile(new URL(`../assets/rpe/shaders/${name}.glsl`, import.meta.url), 'utf8'));
    assert.match(code, /uniform sampler2D screenTexture/); assert.match(code, /varying\s+(?:lowp\s+)?vec2 uv/);
    assert.doesNotMatch(code.replace(/\/\/[^\n]*/g, ''), /CC_Texture0|v_texCoord/);
  }
  assert.equal(canonicalShaderName('grayscale_2'), 'grayscale'); assert.equal(canonicalShaderName(14), 'grayscale');
  assert.deepEqual(shaderTypeFields('grayscale_2'), { shader: 'grayscale', clone: false });
  const chart = createChart(); chart.judgeLineList = Array.from({ length: 30 }, createLine);
  assert.equal(shaderLine({ shader: 'grayscale', clone: true }, chart), 14);
  assert.equal(shaderLine({ shader: 'grayscale_2' }, chart), 14);
  assert.equal(shaderLine({ shaderType: 25 }, chart), 25);
});

test('public shader manifest lists exactly the maintained sources with matching hashes', async () => {
  const root = new URL('../assets/rpe/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
  const entries = manifest.files.filter(entry => entry.path.startsWith('shaders/'));
  assert.deepEqual(entries.map(entry => entry.path).sort(), SHADER_NAMES.map(name => `shaders/${name}.glsl`).sort());
  for (const entry of entries) {
    const bytes = await readFile(new URL(entry.path, root));
    assert.equal(entry.bytes, bytes.length, entry.path);
    assert.equal(entry.sha256, createHash('sha256').update(bytes).digest('hex'), entry.path);
  }
});

test('built-in compatibility source selection handles LF and CRLF checkouts equally', async () => {
  const raw = await readFile(new URL('../assets/rpe/shaders/rain.glsl', import.meta.url), 'utf8');
  const lf = raw.replaceAll('\r\n', '\n'), crlf = lf.replaceAll('\n', '\r\n');
  for (const legacy of [false, true]) {
    const expected = builtinShaderSource(lf, legacy);
    assert.doesNotMatch(expected, /#ifdef RPEN_LEGACY_SOURCE/);
    assert.equal(builtinShaderSource(crlf, legacy).replaceAll('\r\n', '\n'), expected);
  }
});

test('Phira root paths cannot be shadowed by a chart-relative file or a built-in with the same basename', async () => {
  const assets = new Map([['rain.glsl', encode(source)], ['nested/rain.glsl', encode(source + '\n// nested')], ['nested/only.glsl', encode(source)]]);
  assert.equal(shaderAssetPath(assets, '/rain.glsl', 'nested/chart.json'), 'rain.glsl');
  assert.equal(shaderAssetPath(assets, 'rain.glsl', 'nested/chart.json'), 'nested/rain.glsl');
  assert.equal(shaderAssetPath(assets, '/only.glsl', 'nested/chart.json'), null);
  const runtime = new ShaderRuntime(), chart = createChart(); chart.effects = [effect('/rain.glsl')];
  runtime.setAssets(assets, 'nested/chart.json'); runtime.compile(chart, new TempoMap(chart.BPMList));
  assert.equal(runtime.source('rain', '/rain.glsl'), source); assert.equal(runtime.errors.size, 0);
  const missing = createChart(); missing.effects = [effect('/missing/grayscale.glsl')];
  await assert.rejects(prepareShaderExport(missing, assets, 'nested/chart.json'), /不存在/);
  missing.effects = [effect('missing/rain.glsl')]; await assert.rejects(prepareShaderExport(missing, assets, 'nested/chart.json'), /不存在/);
});

test('file shaders support fs/fsh and explicit Phira paths independently of filename extension', async () => {
  const chart = createChart(), assets = new Map();
  const names = ["retro's TV.fs", 'Mixed.FSH', 'glitch.fs', 'nested/custom.effect', 'shader_without_extension'];
  chart.effects = names.map(name => { assets.set(name, encode(source)); return effect('/' + name); });
  const runtime = new ShaderRuntime(); runtime.setAssets(assets, 'pack/chart.json'); runtime.compile(chart, new TempoMap(chart.BPMList));
  assert.equal(runtime.errors.size, 0); assert.equal(runtime.sources.size, names.length);
  for (const entry of runtime.effects) assert.equal(runtime.source(entry.shader, entry.sourceName), source);
  assert.equal(resourceDiagnostics(chart, { assetPaths: [...assets.keys()], chartName: 'pack/chart.json' }).length, 0);
  const prepared = await prepareShaderExport(chart, assets, 'pack/chart.json'), output = createChartExport(prepared.chart, prepared.assets, 'pack/chart.json');
  const reimported = await openFiles([{ name: 'chart.pez', arrayBuffer: () => output.blob.arrayBuffer() }]);
  assert.deepEqual(reimported.candidates[0].chart.effects.map(e => e.shader), chart.effects.map(e => e.shader));
  for (const name of names) assert.deepEqual(reimported.assets.get(name), encode(source));
});

test('basic missing-shader checks use the same indexed path rules as playback and ignore duplicate references', () => {
  const chart = createChart(); chart.effects = [effect('/missing.fs'), effect('/missing.fs'), effect('/glitch.fs'), effect('/code_without_extension'), effect('nested/only.fsh'), effect('/rain_pr.glsl'), effect('grayscale')];
  const paths = ['pack/missing.fs', 'glitch.fs', 'elsewhere/only.fsh'];
  const issues = resourceDiagnostics(chart, { assetPaths: paths, chartName: 'pack/chart.json' });
  assert.deepEqual(issues.map(e => e.asset).sort(), ['/missing.fs', '/code_without_extension', 'nested/only.fsh'].sort());
  assert.ok(issues.every(e => e.code === 'assetMissing' && e.shader && e.severity === 'error'));
  const index = new DiagnosticAssetIndex(['fx/code.fs', 'fx/CODE.fs']);
  assert.equal(index.resolveShader('/fx/code.fs').path, 'fx/code.fs');
  assert.equal(index.resolveShader('/fx/CoDe.fs').matches.length, 2);
  const repaired = resourceDiagnostics(chart, { assetPaths: [...paths, 'missing.fs', 'code_without_extension', 'pack/nested/only.fsh'], chartName: 'pack/chart.json' });
  assert.equal(repaired.length, 0);
});

test('missing shader alerts do not repeat across preview instances or image reloads within one chart session', () => {
  let scope = {}, alerts = [];
  const report = createShaderProblemReporter(() => scope, message => alerts.push(message));
  const chart = createChart(); chart.effects = [effect('/missing.fs')]; const tempo = new TempoMap(chart.BPMList);
  const previews = [new ShaderRuntime(() => {}, report), new ShaderRuntime(() => {}, report)];
  for (let revision = 0; revision < 8; revision++) for (const runtime of previews) { runtime.setAssets(new Map(), 'chart.json', revision); runtime.compile(chart, tempo); }
  assert.equal(alerts.length, 1);
  for (const runtime of previews) { runtime.setAssets(new Map([['missing.fs', encode(source)]]), 'chart.json', 9); runtime.compile(chart, tempo); assert.equal(runtime.errors.size, 0); }
  for (const runtime of previews) { runtime.setAssets(new Map(), 'chart.json', 10); runtime.compile(chart, tempo); }
  assert.equal(alerts.length, 1);
  scope = {};
  for (const runtime of previews) { runtime.setAssets(new Map(), 'other.json', 11); runtime.compile(chart, tempo); }
  assert.equal(alerts.length, 2);
});

test('idle source lookups reuse cached missing paths without enumerating assets, reading source or retrying notifications', () => {
  let scans = 0, reads = 0, alerts = 0;
  class CountedAssets extends Map {
    keys() { scans++; return super.keys(); }
    get(name) { reads++; return super.get(name); }
  }
  const assets = new CountedAssets([['other.png', new Uint8Array([1])]]), runtime = new ShaderRuntime(() => {}, () => alerts++), chart = createChart();
  chart.effects = [effect('/absent.fs')]; const tempo = new TempoMap(chart.BPMList);
  runtime.setAssets(assets, 'chart.json'); runtime.compile(chart, tempo); const initialScans = scans;
  for (let i = 0; i < 1000; i++) { runtime.setAssets(assets, 'chart.json'); runtime.compile(chart, tempo); assert.equal(runtime.source('/absent.fs', '/absent.fs'), ''); }
  assert.equal(scans, initialScans); assert.equal(reads, 0); assert.equal(alerts, 1);
});

test('fs shader dependencies are retained only when their source is referenced', () => {
  const chart = createChart(); chart.effects = [effect('/fx/main.fs')];
  const assets = new Map([['fx/main.fs', encode(source + '\n// @texture textures/mask.png')], ['fx/textures/mask.png', new Uint8Array([1])], ['fx/unused.fs', encode(source)]]);
  const entries = packageEntries(chart, assets, 'chart.json');
  assert.ok(entries.has('fx/main.fs')); assert.ok(entries.has('fx/textures/mask.png')); assert.equal(entries.has('fx/unused.fs'), false);
  chart.effects = []; const empty = packageEntries(chart, assets, 'chart.json');
  assert.equal(empty.has('fx/main.fs'), false); assert.equal(empty.has('fx/textures/mask.png'), false);
});

test('custom shader loading is chart-local, detects replaced bytes and drops stale asynchronous results', async () => {
  const chart = createChart(); chart.effects = [effect('/code.glsl')]; const tempo = new TempoMap(chart.BPMList), messages = [];
  const runtime = new ShaderRuntime(() => {}, m => messages.push(m)), assets = new Map([['code.glsl', encode(source)]]);
  runtime.setAssets(assets, 'chart.json', 1); runtime.compile(chart, tempo); assert.equal(runtime.source('/code.glsl', '/code.glsl'), source);
  assets.set('code.glsl', encode(source + '\n// updated')); runtime.setAssets(assets, 'chart.json', 2); runtime.compile(chart, tempo); assert.match(runtime.source('/code.glsl', '/code.glsl'), /updated/);
  runtime.setAssets(new Map(), 'other.json'); runtime.compile(chart, tempo); assert.equal(runtime.source('/code.glsl', '/code.glsl'), ''); assert.equal(messages.length, 1);
  runtime.compile(chart, tempo); assert.equal(messages.length, 1);
  const original = globalThis.fetch; let finish;
  try {
    globalThis.fetch = () => new Promise(resolve => { finish = resolve; }); const pending = runtime.load('grayscale', 'grayscale');
    runtime.setAssets(new Map(), 'third.json'); finish({ ok: true, text: async () => source }); await pending; assert.equal(runtime.sources.size, 0); assert.equal(runtime.loading.size, 0);
  } finally { globalThis.fetch = original; }
});

test('file shaders round-trip in PEZ with exact bytes; default export excludes unused templates and files', async () => {
  const chart = createChart(); chart.effects = [effect('/shaders/custom/code.glsl')];
  const assets = new Map([['shaders/custom/code.glsl', encode(source)], ['shaders/custom/unused.glsl', encode(source + ' ')], ['nested/chart.json', encode(chart)]]);
  const before = structuredClone(chart), entries = packageEntries(chart, assets, 'nested/chart.json');
  assert.deepEqual(entries.get('shaders/custom/code.glsl'), encode(source)); assert.equal(entries.has('shaders/custom/unused.glsl'), false);
  assert.ok(packageEntries(chart, assets, 'nested/chart.json', { includeUnusedFiles: true }).has('shaders/custom/unused.glsl'));
  const output = createChartExport(chart, assets, 'nested/chart.json'); const imported = await openFiles([{ name: 'out.pez', arrayBuffer: () => output.blob.arrayBuffer() }]);
  assert.equal(imported.candidates[0].chart.effects[0].shader, '/shaders/custom/code.glsl');
  assert.deepEqual(imported.assets.get('shaders/custom/code.glsl'), encode(source)); assert.deepEqual(chart, before);
  assert.deepEqual(chartShaderFiles(chart, assets, 'nested/chart.json'), ['shaders/custom/code.glsl']);
});

test('portable built-ins materialize only when referenced, preserve legacy variant and never overwrite chart assets', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async url => ({ ok: true, text: () => readFile(new URL(url), 'utf8') });
    const chart = createChart(); chart.effects = [effect('/rain_pr.glsl'), effect('rain'), { ...effect('grayscale'), clone: true }, { ...effect(undefined), shaderType: 20 }, { ...effect(undefined), shaderType: 21 }];
    const assets = new Map([['shaders/builtin/rain.glsl', encode('not overwritten')]]), before = structuredClone(chart);
    const next = await prepareShaderExport(chart, assets, 'nested/chart.json');
    assert.equal(next.chart.effects[0].shader, '/shaders/builtin/rain-2.glsl'); assert.equal(next.chart.effects[1].shader, '/shaders/builtin/rain-legacy.glsl');
    assert.equal(next.chart.effects[2].shader, 'grayscale'); assert.equal(next.chart.effects[2].clone, false); assert.equal(next.chart.effects[2].line, 0);
    assert.notEqual(next.chart.effects[3].shader, next.chart.effects[4].shader); assert.match(next.chart.effects[3].shader, /liquid/); assert.match(next.chart.effects[4].shader, /flowing/);
    assert.deepEqual(next.assets.get('shaders/builtin/rain.glsl'), encode('not overwritten'));
    const entries = packageEntries(next.chart, next.assets, 'nested/chart.json'); assert.equal(entries.has('shaders/builtin/rain.glsl'), false); assert.ok(entries.has('shaders/builtin/rain-2.glsl')); assert.ok(entries.has('shaders/builtin/rain-legacy.glsl'));
    assert.deepEqual(chart, before); assert.equal(assets.size, 1); assert.equal(next.chart.judgeLineList[0], chart.judgeLineList[0]);
  } finally { globalThis.fetch = original; }
});

test('shared template persistence has source conflict protection; applied snapshots survive template changes and deletion', async () => {
  const previousStorage = globalThis.localStorage, previousDocument = globalThis.document, values = new Map();
  globalThis.localStorage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) }; globalThis.document = new EventTarget();
  try {
    const entry = await saveShaderTemplate({ name: '测试', source }); assert.equal(readShaderLibrary()[0].source, source);
    const resource = await materializeShader(entry, new Map()), chartAssets = new Map([[resource.path, resource.bytes]]);
    const changed = await saveShaderTemplate({ ...entry, source: source + '\n// v2' }, source);
    let fail = true; globalThis.localStorage.setItem = (key, value) => { values.set(key, value); if (fail) { fail = false; throw Error('storage failure'); } };
    await assert.rejects(saveShaderTemplate({ ...changed, source: source + '\n// failed' }, changed.source), /storage failure/); assert.equal(readShaderLibrary()[0].source, changed.source);
    await assert.rejects(saveShaderTemplate(entry, source), /改变/); assert.equal(readShaderLibrary()[0].source, changed.source);
    assert.equal(shaderSourceBody(new TextDecoder().decode(chartAssets.get(resource.path))), source);
    await assert.rejects(saveShaderTemplate({ name: '测试', source }), /已存在/);
    await removeShaderTemplate(changed.id, changed.source); assert.equal(readShaderLibrary().length, 0); assert.equal(chartAssets.size, 1);
    const duplicate = await materializeShader(entry, chartAssets); assert.equal(duplicate.path, resource.path);
  } finally { globalThis.localStorage = previousStorage; globalThis.document = previousDocument; }
});

test('creative examples follow GLSL 1.00; invalid versions, missing entries and excessive sources are rejected', () => {
  assert.ok(SHADER_PRESETS.length >= 16); assert.equal(new Set(SHADER_PRESETS.map(p => p.source)).size, SHADER_PRESETS.length);
  for (const preset of SHADER_PRESETS) { assert.doesNotThrow(() => assertShaderSource(preset.source)); assert.match(preset.source, /uniform sampler2D screenTexture/); }
  assert.throws(() => assertShaderSource('#version 300 es\nvoid main(){}'), /1.00/); assert.throws(() => assertShaderSource('no entry'), /main/); assert.throws(() => assertShaderSource('x'.repeat(MAX_SHADER_BYTES + 1)), /256/);
  assert.throws(() => assertShaderSource('uniform vec3 invalid; // %0,0,0%\nvoid main(){}'), /float/);
  assert.throws(() => assertShaderSource('uniform vec2 missing;\nvoid main(){}'), /默认值/);
  assert.doesNotThrow(() => assertShaderSource('// uniform float disabled;\nvoid main(){}'));
  const precise = source.replace('uniform sampler2D', 'uniform lowp sampler2D').replace('uniform float power', 'uniform highp float power');
  assert.doesNotThrow(() => assertShaderSource(precise)); assert.equal(shaderParameters(precise)[0].name, 'power'); assert.equal(shaderDefaults(precise).power, .5);
  assert.doesNotMatch(fragmentSource(precise), /0\.7031|uniform lowp sampler2D/);
  const adapted = fragmentSource(source + '\n// gl_FragCoord.xy'); assert.match(adapted, /gl_FragCoord.xy/); assert.doesNotMatch(adapted, /CC_Texture0/);
});
