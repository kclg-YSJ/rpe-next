import test from 'node:test';
import assert from 'node:assert/strict';
import { createChart, createLine } from '../src/core/chart.ts';
import { libraryImages, libraryFolders, moveLibraryPaths, validAssetPath } from '../src/core/asset-library.ts';
import type { Assets, Folders } from '../src/core/asset-library.ts';
import { remapAssetReferences, assetReference } from '../src/platform/asset-library.ts';
import { assetPath } from '../src/platform/files.ts';
import type { Chart } from '../src/core/types.ts';

const bytes = new Uint8Array([1, 2, 3]);

interface LibraryContext {
  assets: Assets;
  folders: Folders;
  chart: Chart;
  chartName: string;
}

function context(names: string[], folders: string[] = [], chart: Chart = createChart()): LibraryContext {
  return { assets: new Map(names.map(name => [name, bytes])), folders: new Set(folders), chart, chartName: 'charts/main.json' };
}

test('library hides complete noise skin packages, including unused and remembered skins, without hiding unrelated shader images', () => {
  const ctx = context(['plain.png', 'shader/Noise/main.glsl', 'shader/Noise/pattern.png', 'shader/Noise/sub/other.jpg',
    'shader/filter/image.png', 'charts/shader/Ocean/main.glsl', 'charts/shader/Ocean/ocean.png', 'shader/remembered/image.png']);
  ctx.chart.noiseAreaLayers = [{ id: 'default', name: '', skin: '', skinPresets: { 'shader/remembered': {} } }];
  assert.deepEqual(libraryImages(ctx.assets, ctx.chart, ctx.chartName).map(([path]) => path), ['plain.png', 'shader/filter/image.png']);
  const folders = libraryFolders(ctx.assets, ['shader/Noise', 'shader/Noise/sub', 'empty'], ctx.chart, ctx.chartName);
  assert.ok(folders.has('empty')); assert.ok(folders.has('shader/filter')); assert.ok(!folders.has('shader/Noise'));
  assert.equal(ctx.assets.size, 8);
});

test('image moves update exact resolved references, retain other same-basename bindings and resolve chart-relative paths', () => {
  const ctx = context(['charts/a/same.png', 'charts/b/same.png', 'other/cover.png']);
  ctx.chart.judgeLineList = [createLine(), createLine(), createLine()];
  ctx.chart.judgeLineList[0]!.Texture = 'a/same.png';
  ctx.chart.judgeLineList[1]!.Texture = 'b/same.png';
  ctx.chart.judgeLineList[2]!.Texture = 'line.png';
  ctx.chart.META.background = 'a/same.png';
  const result = moveLibraryPaths(ctx, 'charts/a/same.png', 'other/moved.png');
  const chart = remapAssetReferences(ctx.chart, ctx.assets, result.assets, result.paths, ctx.chartName);
  assert.equal(assetPath(result.assets, chart.judgeLineList[0]!.Texture, ctx.chartName), 'other/moved.png');
  assert.equal(chart.judgeLineList[1], ctx.chart.judgeLineList[1]);
  assert.equal(chart.judgeLineList[2], ctx.chart.judgeLineList[2]);
  assert.equal(assetPath(result.assets, chart.META.background, ctx.chartName), 'other/moved.png');
  assert.ok(ctx.assets.has('charts/a/same.png')); assert.equal(ctx.chart.judgeLineList[0]!.Texture, 'a/same.png');
});

test('same-path image edits never rebind lines or rewrite existing references', () => {
  const ctx = context(['charts/a/pic.png']); ctx.chart.judgeLineList[0]!.Texture = 'pic.png';
  assert.equal(remapAssetReferences(ctx.chart, ctx.assets, new Map(ctx.assets), new Map([['charts/a/pic.png', 'charts/a/pic.png']]), ctx.chartName), ctx.chart);
});

test('reference generation handles a same-named file shadowed by the chart directory', () => {
  const ctx = context(['a.png', 'charts/a.png']);
  const ref = assetReference(ctx.assets, 'a.png', ctx.chartName);
  assert.equal(assetPath(ctx.assets, ref, ctx.chartName), 'a.png');
  assert.equal(assetPath(ctx.assets, assetReference(ctx.assets, 'charts/a.png', ctx.chartName), ctx.chartName), 'charts/a.png');
});

test('folder moves preserve nested images and empty folders, updating all references atomically', () => {
  const ctx = context(['art/a.png', 'art/sub/b.png', 'keep.png'], ['art', 'art/empty', 'art/sub', 'destination']);
  ctx.chart.META.background = 'art/sub/b.png';
  const result = moveLibraryPaths(ctx, 'art', 'destination/new', true);
  assert.deepEqual([...result.assets.keys()], ['destination/new/a.png', 'destination/new/sub/b.png', 'keep.png']);
  assert.ok(result.folders.has('destination/new/empty')); assert.ok(!result.folders.has('art'));
  const chart = remapAssetReferences(ctx.chart, ctx.assets, result.assets, result.paths, ctx.chartName);
  assert.equal(assetPath(result.assets, chart.META.background, ctx.chartName), 'destination/new/sub/b.png');
});

test('folder/image collisions, non-image folders, cycles and skin-package mutations fail without changing assets', () => {
  const ctx = context(['art/a.png', 'other/A.PNG', 'mixed/music.ogg', 'mixed/b.png', 'shader/Ocean/main.glsl', 'shader/Ocean/o.png'], ['empty', 'other']);
  for (const run of [
    () => moveLibraryPaths(ctx, 'art/a.png', 'other/a.png'),
    () => moveLibraryPaths(ctx, 'art/a.png', 'other'),
    () => moveLibraryPaths(ctx, 'art', 'art/child', true),
    () => moveLibraryPaths(ctx, 'empty', 'art/a.png', true),
    () => moveLibraryPaths(ctx, 'mixed', 'new', true),
    () => moveLibraryPaths(ctx, 'shader', 'new', true),
    () => moveLibraryPaths(ctx, 'art/a.png', 'shader/Ocean/new.png'),
  ]) assert.throws(run);
  assert.ok(ctx.assets.has('art/a.png')); assert.ok(ctx.folders.has('empty'));
  for (const path of ['../evil.png', '/abs.png', 'C:/evil.png', 'a//b.png', 'a/NUL.png', 'a/trailing.']) assert.throws(() => validAssetPath(path), /无效/);
  assert.equal(validAssetPath('中文/图片.png'), '中文/图片.png');
});

test('case-only renames and empty-folder moves keep valid structure', () => {
  const ctx = context(['art/a.png'], ['art', 'empty/sub']);
  const image = moveLibraryPaths(ctx, 'art/a.png', 'art/A.png');
  assert.equal(image.assets.get('art/A.png'), bytes);
  const folder = moveLibraryPaths(ctx, 'empty', 'renamed', true);
  assert.ok(folder.folders.has('renamed/sub')); assert.ok(!folder.folders.has('empty/sub'));
});
