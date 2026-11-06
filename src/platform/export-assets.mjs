import { isBackupChartFile } from '../core/chart-backups.mjs';
import { parseNoiseSkin } from '../core/noise-skin.mjs';
import { emitModHook } from '../core/mod-hooks.mjs';
import { decodeLegacy } from './legacy-text.mjs';
import { shaderAssetPath } from '../core/shader-assets.mjs';

// Follow references in the exported snapshot, then references in its resources.
// Paths use the same relative/case/basename resolution as editor playback.
export function collectExportAssetPaths(chart, assets, chartName, { resolve, media, roots, mainFile, includeBackupCharts = false }) {
  const required = new Set(roots), pending = [], processed = new Set([mainFile]), resolutions = new Map(), skins = new Set(), shaders = new Set();
  let collecting = false;
  const enqueue = name => { if (assets.has(name) && !processed.has(name)) { processed.add(name); pending.push(name); } };
  const keep = path => { required.add(path); if (collecting) enqueue(path); };
  const add = (reference, source = chartName) => {
    if (typeof reference !== 'string' || !reference) return;
    const key = source + '\0' + reference;
    if (!resolutions.has(key)) resolutions.set(key, resolve(assets, reference, source));
    const path = resolutions.get(key);
    if (path) keep(path);
  };
  const addSkin = (root, source) => {
    if (!root) return;
    const directory = source.replaceAll('\\', '/').split('/').slice(0, -1).join('/');
    const skinFile = file => {
      const path = root + '/' + file, found = resolve(assets, path, source);
      const candidates = [path, (directory ? directory + '/' : '') + path].map(name => name.toLowerCase());
      return found && candidates.includes(found.replaceAll('\\', '/').toLowerCase()) ? found : null;
    };
    const main = skinFile('main.glsl'), config = skinFile('config.json');
    if (!main && !config) return;
    const prefix = main ? main.slice(0, -'main.glsl'.length) : config.slice(0, -'config.json'.length);
    if (skins.has(prefix)) return;
    skins.add(prefix);
    const files = new Map([...assets].filter(([name]) => name.startsWith(prefix)).map(([name, bytes]) => [name.slice(prefix.length), bytes]));
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
  const visit = (value, source, kind = '') => {
    if (typeof value === 'string') { add(value, source); return; }
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { for (const child of value) visit(child, source); return; }
    for (const [key, child] of Object.entries(value)) {
      if (key === 'shader' && typeof child === 'string') { const shader = shaderAssetPath(assets, child, source); if (shader) { shaders.add(shader); keep(shader); continue; } }
      // Descriptive text, embedded source documents and remembered inactive skins
      // are not resource references. Their JSON data is still exported unchanged.
      if (['rpeNextLegacySource', 'skinPresets', 'textEvents'].includes(key) || key === 'Texture' && child === 'line.png'
        || kind === 'META' && ['name', 'composer', 'charter', 'illustration', 'level'].includes(key)
        || key === 'Name' || key === 'name' && kind === 'noiseAreaLayers') continue;
      if (/\.[\w-]+$/.test(key)) add(key, source);
      // Include both performance channels of assigned skins, including empty or
      // temporarily hidden layers. Remembered inactive skins remain unused.
      if (key === 'noiseAreaLayers' && Array.isArray(child)) { for (const layer of child) { visit(layer, source, key); addSkin(layer.skin, source); } }
      else visit(child, source, key);
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
    if (/\.json(?:\.(?:bak|backup)(?:\.\d+)?)?$/i.test(name)) {
      try { visit(JSON.parse(decodeLegacy(bytes)), name); } catch { /* An optional resource may not be JSON. */ }
    } else if (shaders.has(name) || /\.(?:glsl|frag|fs|fsh|vert|css|svg|mjs|js)$/i.test(name)) {
      const text = decodeLegacy(bytes);
      const references = /\/\/\s*@texture\s+(\S+)|#include\s*["<]([^">]+)[">]|(?:url\(\s*|(?:href|src)\s*=\s*)["']([^"']+)["']|(?:import|export)\s+(?:[^;\n]*?\s+from\s*)?["']([^"']+)["']/g;
      for (const match of text.matchAll(references)) add(match.slice(1).find(Boolean), name);
    }
  }
  return required;
}
