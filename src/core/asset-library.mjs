import { t } from '../i18n.mjs';
export const IMAGE_EXTENSION = /\.(png|jpe?g|webp|gif|bmp|avif)$/i;
export const slashPath = path => String(path ?? '').replaceAll('\\', '/');
export const pathKey = path => slashPath(path).toLowerCase();
export const withinFolder = (path, folder) => !folder || pathKey(path).startsWith(pathKey(folder) + '/');
export const parentFolder = path => slashPath(path).split('/').slice(0, -1).join('/');

// Paths remain portable between PEZ archives and desktop named asset copies.
export function validAssetPath(value) {
  const path = slashPath(value);
  if (!path || path.split('/').some(part => !part || part === '.' || part === '..'
    || /[<>:"|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part)
    || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw Error(t('asset-library.sa02b966'));
  return path;
}

export function collectAssetFolders(path, folders) {
  const parts = slashPath(path).split('/'); parts.pop();
  for (let index = 1; index <= parts.length; index++) folders.add(parts.slice(0, index).join('/'));
}

export function noiseSkinRoots(assets, chart = {}, chartName = '') {
  const roots = new Set(), directory = parentFolder(chartName);
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

export function skinOwnedPath(path, roots) { return [...roots].some(root => pathKey(root) === pathKey(path) || withinFolder(path, root)); }
export function libraryImages(assets, chart = {}, chartName = '') {
  const roots = noiseSkinRoots(assets, chart, chartName);
  return [...assets].filter(([name]) => IMAGE_EXTENSION.test(name) && !skinOwnedPath(name, roots));
}

export function libraryFolders(assets, folders = [], chart = {}, chartName = '') {
  const roots = noiseSkinRoots(assets, chart, chartName), result = new Set();
  for (const folder of folders) if (!skinOwnedPath(folder, roots)) { result.add(slashPath(folder)); collectAssetFolders(folder + '/_', result); }
  for (const [path] of libraryImages(assets, chart, chartName)) collectAssetFolders(path, result);
  return result;
}

export function assertImageFolder(context, folder) {
  const roots = noiseSkinRoots(context.assets, context.chart, context.chartName);
  if ([...roots].some(root => skinOwnedPath(folder, roots) || withinFolder(root, folder))) throw Error(t('asset-library.sa62d1e5'));
  if ([...context.assets.keys()].some(path => withinFolder(path, folder) && !IMAGE_EXTENSION.test(path))) throw Error(t('asset-library.s9f3ae53'));
}

export function moveLibraryPaths(context, from, to, folder = false) {
  from = validAssetPath(from); to = validAssetPath(to);
  const { assets } = context, folders = libraryFolders(assets, context.folders, context.chart, context.chartName);
  const roots = noiseSkinRoots(assets, context.chart, context.chartName);
  if (skinOwnedPath(from, roots) || skinOwnedPath(to, roots)) throw Error(t('asset-library.se422afb'));
  if (folder) {
    assertImageFolder(context, from);
    if (withinFolder(to, from)) throw Error(t('asset-library.se35ae3d'));
    if (!folders.has(from)) throw Error(t('asset-library.s56bc875'));
    if ([...assets.keys()].some(path => pathKey(path) === pathKey(to))) throw Error(t('asset-library.s113e1e7'));
    if (from !== to && [...folders].some(path => pathKey(path) === pathKey(to) && pathKey(path) !== pathKey(from))) throw Error(t('asset-library.sd88508d'));
  } else if (!assets.has(from) || !IMAGE_EXTENSION.test(to)) throw Error(t('asset-library.s70b1883'));
  const paths = new Map([...assets.keys()].filter(path => folder ? withinFolder(path, from) : path === from)
    .map(path => [path, folder ? to + slashPath(path).slice(from.length) : to]));
  const occupied = new Set([...assets.keys()].filter(path => !paths.has(path)).map(pathKey));
  const targetFiles = new Set();
  for (const target of paths.values()) {
    if (occupied.has(pathKey(target)) || targetFiles.has(pathKey(target)) || [...folders].some(path => pathKey(path) === pathKey(target))) throw Error(t('asset-library.s4a04304'));
    targetFiles.add(pathKey(target));
    for (let parent = parentFolder(target); parent; parent = parentFolder(parent)) if (occupied.has(pathKey(parent))) throw Error(t('asset-library.s537d637'));
  }
  const nextAssets = new Map([...assets].map(([path, bytes]) => [paths.get(path) ?? path, bytes]));
  const nextFolders = new Set([...context.folders ?? []].map(path => folder && (pathKey(path) === pathKey(from) || withinFolder(path, from)) ? to + slashPath(path).slice(from.length) : path));
  if (folder) nextFolders.add(to);
  for (const target of paths.values()) collectAssetFolders(target, nextFolders);
  collectAssetFolders(to + (folder ? '/_' : ''), nextFolders);
  return { assets: nextAssets, folders: nextFolders, paths };
}
