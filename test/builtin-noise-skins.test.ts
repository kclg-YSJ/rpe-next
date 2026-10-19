import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { loadBuiltinNoiseSkins, installBuiltinNoiseSkin } from '../src/platform/noise-skins.ts';
import { parseNoiseSkin } from '../src/core/noise-skin.ts';
import { createChart, serializeChart, parseChart } from '../src/core/chart.ts';
import { packageEntries } from '../src/platform/files.ts';

// `assetUrl` returns a document-relative path (`/assets/...`, or a subdirectory build prefix),
// so resolve it against the repository root the same way a browser would against the origin.
const readAsset = async (url: string): Promise<Response> => new Response(await readFile(new URL(String(url).replace(/^\/+/, ''), new URL('../', import.meta.url))));

test('两套内置皮肤资源完整、作者正确、可解析且普通与低性能通道互相独立', async () => {
  const skins = await loadBuiltinNoiseSkins(readAsset);
  assert.deepEqual(skins.map(skin => skin.name), ['NoiseField', 'Ocean']);
  for (const skin of skins) {
    const metadata = JSON.parse(new TextDecoder().decode(skin.files.get('config.json')));
    assert.equal(skin.author, metadata.author.trim()); const definition = parseNoiseSkin(skin.files);
    assert.ok(definition.parameters.length > 5); assert.ok(definition.normal.passes.length > 1);
    const directory = new URL(`../assets/noise-skins/${skin.name}/`, import.meta.url);
    const files = await readdir(directory, { recursive: true, withFileTypes: true });
    assert.equal(files.filter(entry => entry.isFile()).length, skin.files.size);
    assert.ok([...definition.textures.values()].flat().every(texture => skin.files.has(texture.path)));
  }
  assert.ok(parseNoiseSkin(skins[1].files).low);
});

test('内置皮肤按需存入谱面，重复选用不重复资源，同名自定义皮肤不被覆盖', async () => {
  const [skin] = await loadBuiltinNoiseSkins(readAsset); const assets = new Map();
  const initial = installBuiltinNoiseSkin(skin, assets); assert.equal(initial.root, 'shader/NoiseField'); assert.equal(initial.entries.size, skin.files.size);
  for (const [path, bytes] of initial.entries) assets.set(path, bytes);
  assert.equal(installBuiltinNoiseSkin(skin, assets).entries.size, 0);
  const custom = new TextEncoder().encode('custom'); assets.set('shader/NoiseField/main.glsl', custom);
  const renamed = installBuiltinNoiseSkin(skin, assets); assert.equal(renamed.root, 'shader/NoiseField-builtin');
  for (const [path, bytes] of renamed.entries) assets.set(path, bytes);
  assert.equal(assets.get('shader/NoiseField/main.glsl'), custom); assert.equal(installBuiltinNoiseSkin(skin, assets).entries.size, 0);
  const shared = [...skin.files.values()][0]; const installed = initial.entries.get('shader/NoiseField/' + [...skin.files.keys()][0]);
  assert.notEqual(shared, installed); assert.deepEqual(shared, installed);
});

test('选用的内置皮肤可通过 JSON 引用和 PEZ 完整携带，不依赖内置资源加载', async () => {
  const skins = await loadBuiltinNoiseSkins(readAsset); const assets = new Map(); const chart = createChart();
  chart.noiseAreaLayers = skins.map((skin, index) => {
    const { root, entries } = installBuiltinNoiseSkin(skin, assets);
    for (const [path, bytes] of entries) assets.set(path, bytes);
    return { id: index ? 'ocean' : 'default', name: skin.name, skin: root, parameters: {} };
  });
  const restored = parseChart(serializeChart(chart)); const exported = packageEntries(restored, assets, 'chart.json');
  for (const [index, layer] of restored.noiseAreaLayers!.entries()) {
    const relative = new Map([...exported].filter(([path]) => path.startsWith(layer.skin! + '/')).map(([path, bytes]) => [path.slice(layer.skin!.length + 1), bytes]));
    assert.equal(parseNoiseSkin(relative).author, skins[index].author); assert.ok(relative.size > 5);
  }
  assert.ok(![...exported.keys()].some(path => path.startsWith('assets/')));
});

test('内置资源加载失败可报告错误，不接受越界的目录路径', async () => {
  await assert.rejects(loadBuiltinNoiseSkins(async () => new Response('', { status: 404 })), /资源载入失败/);
  await assert.rejects(loadBuiltinNoiseSkins(async () => new Response(JSON.stringify([{ name: '../private', files: ['main.glsl'] }]))), /条目无效/);
  await assert.rejects(loadBuiltinNoiseSkins(async () => new Response(JSON.stringify([{ name: 'Test', files: ['main.glsl', '../private'] }]))), /路径无效/);
});
