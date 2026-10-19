import type { Chart } from './types.ts';

export type Assets = Map<string, Uint8Array>;
export type Folders = Set<string>;

export const IMAGE_EXTENSION = /\.(png|jpe?g|webp|gif|bmp|avif)$/i;
export const slashPath = (path: unknown) => String(path ?? '').replaceAll('\\', '/');
export const pathKey = (path: unknown) => slashPath(path).toLowerCase();
export const withinFolder = (path: unknown, folder: unknown) => !folder || pathKey(path).startsWith(pathKey(folder) + '/');
export const parentFolder = (path: unknown) => slashPath(path).split('/').slice(0, -1).join('/');

// Paths remain portable between PEZ archives and desktop named asset copies.
export function validAssetPath(value: unknown): string {
  const path = slashPath(value);
  if (!path || path.split('/').some(part => !part || part === '.' || part === '..'
    || /[<>:"|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part)
    || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw Error('名称包含无效路径或文件名');
  return path;
}

export function collectAssetFolders(path: unknown, folders: Folders): void {
  const parts = slashPath(path).split('/'); parts.pop();
  for (let index = 1; index <= parts.length; index++) folders.add(parts.slice(0, index).join('/'));
}

export function noiseSkinRoots(assets: Assets, chart: Chart = {} as Chart, chartName = ''): Set<string> {
  const roots = new Set<string>(), directory = parentFolder(chartName);
  for (const name of assets.keys()) {
    const path = slashPath(name);
    if (/(?:^|\/)shader\/[^/]+\/main\.glsl$/i.test(path)) roots.add(path.slice(0, -10));
  }
  for (const layer of chart.noiseAreaLayers ?? []) for (const root of [layer.skin, ...Object.keys(layer.skinPresets ?? {})]) {
    if (!root) continue;
    for (const candidate of [root, directory ? directory + '/' + root : root]) {
      if ([...assets.keys()].some(path => withinFolder(path, candidate))) roots.add(candidate);
    }
  }
  return roots;
}

export function skinOwnedPath(path: unknown, roots: Iterable<string>): boolean { return [...roots].some(root => pathKey(root) === pathKey(path) || withinFolder(path, root)); }
export function libraryImages(assets: Assets, chart: Chart = {} as Chart, chartName = ''): [string, Uint8Array][] {
  const roots = noiseSkinRoots(assets, chart, chartName);
  return [...assets].filter(([name]) => IMAGE_EXTENSION.test(name) && !skinOwnedPath(name, roots));
}

export function libraryFolders(assets: Assets, folders: Iterable<string> = [], chart: Chart = {} as Chart, chartName = ''): Set<string> {
  const roots = noiseSkinRoots(assets, chart, chartName), result = new Set<string>();
  for (const folder of folders) if (!skinOwnedPath(folder, roots)) { result.add(slashPath(folder)); collectAssetFolders(folder + '/_', result); }
  for (const [path] of libraryImages(assets, chart, chartName)) collectAssetFolders(path, result);
  return result;
}

export interface AssetLibraryContext {
  assets: Assets;
  folders?: Folders;
  chart?: Chart;
  chartName?: string;
}

export function assertImageFolder(context: AssetLibraryContext, folder: string): void {
  const roots = noiseSkinRoots(context.assets, context.chart, context.chartName);
  if ([...roots].some(root => skinOwnedPath(folder, roots) || withinFolder(root, folder))) throw Error('此文件夹包含噪域皮肤，请在噪域层管理中管理皮肤');
  if ([...context.assets.keys()].some(path => withinFolder(path, folder) && !IMAGE_EXTENSION.test(path))) throw Error('此文件夹包含非图片文件，请单独移动其中的图片');
}

export interface MovedLibraryPaths {
  assets: Assets;
  folders: Set<string>;
  paths: Map<string, string>;
}

export function moveLibraryPaths(context: AssetLibraryContext, from: unknown, to: unknown, folder = false): MovedLibraryPaths {
  const source = validAssetPath(from), target = validAssetPath(to);
  const { assets } = context, folders = libraryFolders(assets, context.folders, context.chart, context.chartName);
  const roots = noiseSkinRoots(assets, context.chart, context.chartName);
  if (skinOwnedPath(source, roots) || skinOwnedPath(target, roots)) throw Error('不能在图片素材库中修改噪域皮肤文件');
  if (folder) {
    assertImageFolder(context, source);
    if (withinFolder(target, source)) throw Error('不能把文件夹移动到自己的子文件夹');
    if (!folders.has(source)) throw Error('源文件夹不存在');
    if ([...assets.keys()].some(path => pathKey(path) === pathKey(target))) throw Error('目标位置已有同名文件');
    if (source !== target && [...folders].some(path => pathKey(path) === pathKey(target) && pathKey(path) !== pathKey(source))) throw Error('目标文件夹已存在');
  } else if (!assets.has(source) || !IMAGE_EXTENSION.test(target)) throw Error('请选择有效的图片文件名');
  const paths = new Map([...assets.keys()].filter(path => folder ? withinFolder(path, source) : path === source)
    .map(path => [path, folder ? target + slashPath(path).slice(source.length) : target]));
  const occupied = new Set([...assets.keys()].filter(path => !paths.has(path)).map(pathKey));
  const targetFiles = new Set<string>();
  for (const next of paths.values()) {
    if (occupied.has(pathKey(next)) || targetFiles.has(pathKey(next)) || [...folders].some(path => pathKey(path) === pathKey(next))) throw Error('目标位置已有同名文件或文件夹');
    targetFiles.add(pathKey(next));
    for (let parent = parentFolder(next); parent; parent = parentFolder(parent)) if (occupied.has(pathKey(parent))) throw Error('目标路径中存在同名文件');
  }
  const nextAssets = new Map([...assets].map(([path, bytes]) => [paths.get(path) ?? path, bytes]));
  const nextFolders = new Set([...context.folders ?? []].map(path => folder && (pathKey(path) === pathKey(source) || withinFolder(path, source)) ? target + slashPath(path).slice(source.length) : path));
  if (folder) nextFolders.add(target);
  for (const next of paths.values()) collectAssetFolders(next, nextFolders);
  collectAssetFolders(target + (folder ? '/_' : ''), nextFolders);
  return { assets: nextAssets, folders: nextFolders, paths };
}
