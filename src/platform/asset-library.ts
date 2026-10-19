import { assetPath, resourceReferences } from './files.ts';
import { parentFolder } from '../core/asset-library.ts';
import type { ArchiveEntries } from './archive.ts';
import type { Chart } from '../core/types.ts';

// Prefer chart-relative references only when they resolve to the intended file.
export function assetReference(assets: ArchiveEntries, path: string, chartName = ''): string {
  const directory = parentFolder(chartName), relative = directory && path.startsWith(directory + '/') ? path.slice(directory.length + 1) : path;
  if (assetPath(assets, relative, chartName) === path) return relative;
  if (assetPath(assets, path, chartName) === path) return path;
  const a = directory.split('/').filter(Boolean), b = path.split('/');
  while (a.length && b.length && a[0] === b[0]) { a.shift(); b.shift(); }
  return '../'.repeat(a.length) + b.join('/');
}

export function remapAssetReferences(chart: Chart, before: ArchiveEntries, after: ArchiveEntries, paths: Map<string, string> | undefined, chartName = ''): Chart {
  if (!paths?.size) return chart;
  const reference = (name: string): string => { const original = assetPath(before, name, chartName), target = original ? paths.get(original) : undefined; return target && target !== original ? assetReference(after, target, chartName) : name; };
  let changed = false;
  const lines = chart.judgeLineList.map(line => {
    const texture = reference(line.Texture);
    if (texture === line.Texture) return line;
    changed = true; return { ...line, Texture: texture };
  });
  const sources = resourceReferences(chart, before, chartName), meta = { ...chart.META };
  for (const key of ['background', 'song'] as const) {
    const name = String(chart.META[key] || sources[key] || ''), target = reference(name);
    if (target !== name) { meta[key] = target; changed = true; }
  }
  return changed ? { ...chart, META: meta, judgeLineList: lines } : chart;
}
