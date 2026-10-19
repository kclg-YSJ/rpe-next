// @ts-nocheck - ported integration test with dynamic archive fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createChart, createNote, createLine } from '../src/core/chart.ts';
import { registerModHook } from '../src/core/mod-hooks.ts';
import { packageEntries, createChartExport, openFiles } from '../src/platform/files.ts';
import { scanMigration, materializeProject } from '../src/platform/migration.ts';
import { readZip, writeZip } from '../src/platform/archive.ts';
import { parseInfo } from '../src/platform/legacy-text.ts';

const encode = value => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));
const json = value => JSON.parse(new TextDecoder().decode(value));
const bytes = new Uint8Array([1, 2, 3]);

test('默认仅打包当前谱面的媒体、判定线贴图和音符音效，保留路径与字节且不修改项目', async () => {
  const chart = createChart();
  Object.assign(chart.META, { name: 'unrelated.png', song: '../shared/SONG.ogg', background: 'cover.png' });
  chart.judgeLineList[0].Texture = 'TEXTURES/used.png';
  chart.judgeLineList[0].notes = [{ ...createNote(1, 0, 0), hitsound: 'sounds/hit.ogg' }, { ...createNote(3, 1, 0), hitSound: 'shared-hit.wav' }];
  chart.judgeLineList[0].extended.textEvents = [{ startTime: [0, 0, 1], endTime: [1, 0, 1], start: 'unrelated.png', end: 'other.json' }];
  chart.judgeLineList.push({ ...createLine(), Texture: 'animation.gif' });
  const assets = new Map([
    ['project/chart.json', encode(chart)], ['project/cover.png', bytes], ['shared/song.ogg', bytes],
    ['project/textures/used.png', bytes], ['project/sounds/hit.ogg', bytes], ['audio/shared-hit.wav', bytes], ['project/animation.gif', bytes],
    ['unrelated.png', bytes], ['other.json', encode(createChart())], ['project/unused.mp3', bytes], ['project/textures/unused.png', bytes],
    ['another/info.txt', encode('Chart: other.json')], ['another/extra.json', encode({ effects: [] })], ['readme.txt', encode('unrelated')],
  ]);
  const original = structuredClone(chart), originalAssets = new Map(assets);
  for (const compatibility of ['next', 'rpe']) {
    const exported = createChartExport(chart, assets, 'project/chart.json', { compatibility });
    const output = await readZip(await exported.blob.arrayBuffer());
    assert.deepEqual([...output.keys()].sort(), ['project/chart.json', 'project/cover.png', 'shared/song.ogg', 'project/textures/used.png',
      'project/sounds/hit.ogg', 'audio/shared-hit.wav', 'project/animation.gif', 'info.txt'].sort());
    for (const name of [...output.keys()].filter(name => !name.endsWith('.json') && name !== 'info.txt')) assert.deepEqual(output.get(name), assets.get(name));
    const info = parseInfo(new TextDecoder().decode(output.get('info.txt')));
    for (const field of ['Chart', 'Song', 'Picture']) assert.ok(output.has(info[field]));
    assert.equal(json(output.get('project/chart.json')).judgeLineList[0].extended.textEvents[0].start, 'unrelated.png');
  }
  assert.deepEqual(chart, original); assert.deepEqual(assets, originalAssets);
  assert.ok(packageEntries(chart, assets, 'project/chart.json', { includeUnusedFiles: true }).has('unrelated.png'));
});

test('所选噪域皮肤保留完整渲染依赖，未使用的皮肤、贴图及参数预设不导致打包', async () => {
  const catalogue = JSON.parse(await readFile(new URL('../assets/noise-skins/index.json', import.meta.url), 'utf8'));
  const assets = new Map();
  for (const skin of catalogue) for (const name of skin.files) assets.set(`shader/${skin.name}/${name}`, new Uint8Array(await readFile(new URL(`../assets/noise-skins/${skin.name}/${name}`, import.meta.url))));
  const chart = createChart();
  chart.noiseAreaLayers = [{ id: 'default', name: '默认层', skin: 'shader/Ocean', skinPresets: { 'shader/NoiseField': { parameters: {} } } }];
  assets.set('shader/Ocean/tex/unreferenced.png', bytes);
  let output = packageEntries(chart, assets, 'chart.json');
  assert.ok(output.has('shader/Ocean/main.glsl')); assert.ok(output.has('shader/Ocean/config.json'));
  for (const name of ['Caustics.png', 'Flow.png', 'Foam.png']) assert.ok(output.has('shader/Ocean/tex/' + name));
  assert.equal(output.has('shader/Ocean/tex/unreferenced.png'), false);
  assert.equal([...output.keys()].some(name => name.startsWith('shader/NoiseField/')), false);
  assert.deepEqual(json(output.get('chart.json')).noiseAreaLayers[0].skinPresets, chart.noiseAreaLayers[0].skinPresets);
  chart.judgeLineList[0].Texture = 'shader/NoiseField/tex/PointNoise.png';
  output = packageEntries(chart, assets, 'chart.json');
  assert.ok(output.has('shader/NoiseField/tex/PointNoise.png')); assert.equal(output.has('shader/NoiseField/main.glsl'), false);
  const legacy = await readZip(await createChartExport(chart, assets, 'chart.json', { compatibility: 'rpe', removeNoiseAreas: true }).blob.arrayBuffer());
  assert.equal([...legacy.keys()].some(name => name.startsWith('shader/Ocean/')), false);
  assert.ok(legacy.has('shader/NoiseField/tex/PointNoise.png'));
  chart.judgeLineList[0].Texture = 'line.png'; chart.noiseAreaLayers[0].skin = 'shader/Missing';
  assets.set('shader/NoiseField/tex/line.png', bytes);
  output = packageEntries(chart, assets, 'chart.json');
  assert.equal([...output.keys()].some(name => name.startsWith('shader/')), false);
});

test('保留所选皮肤的低性能通道依赖，备份谱面使用的皮肤也随显式包含备份一同保留', () => {
  const chart = createChart(), backup = createChart(); backup.noiseAreaLayers = [{ id: 'default', name: '备份层', skin: 'shader/Low' }];
  const assets = new Map([
    ['AutoSave_old.json', encode(backup)],
    ['shader/Low/config.json', encode({ version: 1, targets: {}, passes: [{ shader: 'main.glsl', output: '$screen' }], lowPerformance: { passes: [{ shader: 'low.glsl', output: '$screen' }] } })],
    ['shader/Low/main.glsl', encode('uniform float touchReleaseDuration; // %0.5%\nuniform sampler2D noise; // @texture tex/full.png')],
    ['shader/Low/low.glsl', encode('uniform sampler2D noise; // @texture tex/low.png')],
    ['shader/Low/tex/full.png', bytes], ['shader/Low/tex/low.png', bytes], ['shader/Low/tex/orphan.png', bytes],
  ]);
  const output = packageEntries(chart, assets, 'chart.json', { includeBackupCharts: true });
  assert.ok(output.has('shader/Low/main.glsl')); assert.ok(output.has('shader/Low/low.glsl'));
  assert.ok(output.has('shader/Low/tex/full.png')); assert.ok(output.has('shader/Low/tex/low.png'));
  assert.equal(output.has('shader/Low/tex/orphan.png'), false);
  assert.equal([...packageEntries(chart, assets, 'chart.json').keys()].some(name => name.startsWith('shader/Low/')), false);
});

test('引用资源递归保留相对依赖、配置循环、着色器贴图与 include，模组可声明额外资源', () => {
  const chart = createChart(); chart.customMaterial = 'materials/config.json';
  const assets = new Map([
    ['scene/materials/config.json', encode({ shader: 'passes/effect.glsl', next: 'second.json' })],
    ['scene/materials/second.json', encode({ next: 'config.json' })],
    ['scene/materials/passes/effect.glsl', encode('uniform sampler2D noise; // @texture tex/noise.png\n#include "shared.glsl"')],
    ['scene/materials/passes/tex/noise.png', bytes], ['scene/materials/passes/shared.glsl', encode('// @texture tex/detail.png')],
    ['scene/materials/passes/tex/detail.png', bytes], ['scene/unused.png', bytes], ['scene/mod-only.json', encode({ image: 'mod-only.png' })], ['scene/mod-only.png', bytes],
  ]);
  const off = registerModHook('chart:export-assets', request => { assert.ok(request.required instanceof Set); request.required.add('scene/mod-only.json'); });
  let output;
  try { output = packageEntries(chart, assets, 'scene/chart.json'); } finally { off(); }
  for (const name of assets.keys()) assert.equal(output.has(name), name !== 'scene/unused.png', name);
  assert.equal(packageEntries(chart, assets, 'scene/chart.json').has('scene/mod-only.json'), false);
});

test('自动保存 extra 与普通备份使用独立开关，包含未使用文件也不会绕过默认过滤', async () => {
  const chart = createChart(); chart.effects = [{ shader: 'glitch', start: 0, end: 1 }];
  const backupName = 'AutoSave_extra_2026_10_18_14_3_5_.json';
  const backupExtra = encode({ effects: [{ shader: 'old/effect.glsl', start: 9, end: 10 }] });
  const assets = new Map([['chart.json', encode(chart)], ['extra.json', encode({ effects: chart.effects })], [backupName, backupExtra], ['AutoSave_extra.json', backupExtra],
    ['AutoSave_2026_10_18_14_3_5_chart.json', encode(chart)], ['old/effect.glsl', encode('void main() {}')], ['unused.png', bytes], ['unused2.png', bytes]]);
  for (const includeUnusedFiles of [false, true]) for (const includeBackupCharts of [false, true]) {
    const output = packageEntries(chart, assets, 'chart.json', { includeUnusedFiles, includeBackupCharts });
    assert.equal(output.has(backupName), includeBackupCharts);
    assert.equal(output.has('AutoSave_extra.json'), includeBackupCharts);
    assert.equal(output.has('AutoSave_2026_10_18_14_3_5_chart.json'), includeBackupCharts);
    assert.equal(output.has('old/effect.glsl'), includeUnusedFiles || includeBackupCharts);
    assert.equal(output.has('unused.png'), includeUnusedFiles);
    assert.deepEqual(json(output.get('extra.json')).effects, chart.effects);
    if (includeBackupCharts) assert.deepEqual(output.get(backupName), backupExtra);
  }
  const file = new File([writeZip(assets)], 'test.pez');
  const imported = await openFiles([file]);
  assert.equal(imported.assets.has(backupName), false); assert.deepEqual(imported.candidates[0].chart.effects, chart.effects);
  const entries = [...assets].map(([name, content]) => ({ path: 'Resources/1/' + name, getFile: async () => new File([content], name) }));
  entries.push({ path: 'Resources/1/info.txt', getFile: async () => new File(['Chart: chart.json'], 'info.txt') });
  const plan = await scanMigration(entries, 'RPE');
  const migrated = await materializeProject(plan, plan.projects[0]);
  assert.equal(new Map(migrated.assets).has(backupName), false); assert.deepEqual(migrated.chart.effects, chart.effects);
});

test('已转换原始谱面只在勾选未使用文件时附带，导出后重导入只显示当前主谱', async () => {
  const chart = createChart(); chart.rpeNextLegacySource = { text: 'orphan.png', format: 'legacy' };
  const assets = new Map([['main.pec', encode('source')], ['orphan.png', bytes], ['other.png', bytes]]);
  const output = createChartExport(chart, assets, 'main.pec');
  const loaded = await openFiles([new File([output.blob], 'test.pez')]);
  assert.equal(loaded.candidates.length, 1); assert.equal(loaded.candidates[0].name, 'main.rpe.json');
  assert.equal(loaded.assets.has('main.pec'), false); assert.equal(loaded.assets.has('orphan.png'), false);
  assert.ok(packageEntries(chart, assets, 'main.pec', { includeUnusedFiles: true }).has('main.pec'));
});
