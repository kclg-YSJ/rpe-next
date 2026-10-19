import { isBackupChartFile } from '../core/chart-backups.ts';
import { parseNoiseSkin } from '../core/noise-skin.ts';
import { emitModHook } from '../core/mod-hooks.ts';
import { decodeLegacy } from './legacy-text.ts';
import type { ArchiveEntries } from './archive.ts';
import type { Chart } from '../core/types.ts';

/** The song and illustration a chart resolves to, as looked up in the asset map. */
export interface ExportAssetMedia {
  song: string;
  background: string;
}

/** The inputs {@link collectExportAssetPaths} needs from the export pipeline. */
export interface CollectExportAssetsOptions {
  /** Resolves a chart-relative reference to the archive key that actually holds it. */
  resolve: (assets: ArchiveEntries, name: string, chartName?: string) => string | null;
  media: ExportAssetMedia;
  /** Archive entries that must survive regardless of references (the chart, info, extra). */
  roots: string[];
  /** The main chart entry, already processed. */
  mainFile: string;
  includeBackupCharts?: boolean;
}

/** The subset of a 噪域 layer this walker reads. */
interface NoiseSkinLayer {
  skin?: unknown;
}

// Follow references in the exported snapshot, then references in its resources.
// Paths use the same relative/case/basename resolution as editor playback.
export function collectExportAssetPaths(chart: Chart, assets: ArchiveEntries, chartName: string, { resolve, media, roots, mainFile, includeBackupCharts = false }: CollectExportAssetsOptions): Set<string> {
  const required = new Set<string>(roots), pending: string[] = [], processed = new Set<string>([mainFile]), resolutions = new Map<string, string | null>(), skins = new Set<string>();
  let collecting = false;
  const enqueue = (name: string): void => { if (assets.has(name) && !processed.has(name)) { processed.add(name); pending.push(name); } };
  const keep = (path: string): void => { required.add(path); if (collecting) enqueue(path); };
  const add = (reference: unknown, source = chartName): void => {
    if (typeof reference !== 'string' || !reference) return;
    const key = source + '\0' + reference;
    if (!resolutions.has(key)) resolutions.set(key, resolve(assets, reference, source));
    const path = resolutions.get(key);
    if (path) keep(path);
  };
  const addSkin = (root: unknown, source: string): void => {
    if (typeof root !== 'string' || !root) return;
    const directory = source.replaceAll('\\', '/').split('/').slice(0, -1).join('/');
    const skinFile = (file: string): string | null => {
      const path = root + '/' + file, found = resolve(assets, path, source);
      const candidates = [path, (directory ? directory + '/' : '') + path].map(name => name.toLowerCase());
      return found && candidates.includes(found.replaceAll('\\', '/').toLowerCase()) ? found : null;
    };
    const main = skinFile('main.glsl'), config = skinFile('config.json');
    if (!main && !config) return;
    const prefix = main ? main.slice(0, -'main.glsl'.length) : config!.slice(0, -'config.json'.length);
    if (skins.has(prefix)) return;
    skins.add(prefix);
    const files: Map<string, Uint8Array | string> = new Map([...assets].filter(([name]) => name.startsWith(prefix)).map(([name, bytes]) => [name.slice(prefix.length), bytes]));
    if (main) keep(main);
    if (files.has('config.json')) keep(prefix + 'config.json');
    try {
      const skin = parseNoiseSkin(files);
      for (const name of skin.sources.keys()) keep(prefix + name);
      for (const images of skin.textures.values()) for (const image of images) keep(prefix + image.path);
    } catch {
      // Preserve an assigned but currently unsupported skin intact.
      for (const name of files.keys()) keep(prefix + name);
    }
  };
  const visit = (value: unknown, source: string, kind = ''): void => {
    if (typeof value === 'string') { add(value, source); return; }
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { for (const child of value) visit(child, source); return; }
    for (const [key, child] of Object.entries(value)) {
      // Descriptive text, embedded source documents and remembered inactive skins
      // are not resource references. Their JSON data is still exported unchanged.
      if (['rpeNextLegacySource', 'skinPresets', 'textEvents'].includes(key) || key === 'Texture' && child === 'line.png'
        || kind === 'META' && ['name', 'composer', 'charter', 'illustration', 'level'].includes(key)
        || key === 'Name' || key === 'name' && kind === 'noiseAreaLayers') continue;
      if (/\.[\w-]+$/.test(key)) add(key, source);
      // Include both performance channels of assigned skins, including empty or
      // temporarily hidden layers. Remembered inactive skins remain unused.
      if (key === 'noiseAreaLayers' && Array.isArray(child)) {
        for (const layer of child) {
          visit(layer, source, key);
          const layerObject = typeof layer === 'object' && layer !== null ? layer as NoiseSkinLayer : null;
          addSkin(layerObject?.skin, source);
        }
      } else visit(child, source, key);
    }
  };
  visit(chart, chartName);
  for (const name of [media.song, media.background]) add(name);

  if (includeBackupCharts) for (const name of assets.keys()) if (isBackupChartFile(name)) required.add(name);
  emitModHook('chart:export-assets', { chart, chartName, assets, required });

  collecting = true;
  for (const name of required) enqueue(name);
  for (let index = 0; index < pending.length; index++) {
    const name = pending[index], bytes = assets.get(name);
    if (!bytes) continue;
    if (/\.json(?:\.(?:bak|backup)(?:\.\d+)?)?$/i.test(name)) {
      try { visit(JSON.parse(decodeLegacy(bytes)), name); } catch { /* An optional resource may not be JSON. */ }
    } else if (/\.(?:glsl|frag|vert|css|svg|mjs|js)$/i.test(name)) {
      const text = decodeLegacy(bytes);
      const references = /\/\/\s*@texture\s+(\S+)|#include\s*["<]([^">]+)[">]|(?:url\(\s*|(?:href|src)\s*=\s*)["']([^"']+)["']|(?:import|export)\s+(?:[^;\n]*?\s+from\s*)?["']([^"']+)["']/g;
      for (const match of text.matchAll(references)) add(match.slice(1).find(Boolean), name);
    }
  }
  return required;
}
