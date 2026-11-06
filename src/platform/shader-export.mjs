import { shaderAssetPath, chartShaderEvents, shaderFileReference } from '../core/shader-assets.mjs';
import { canonicalShaderName, shaderLine, legacyShaderSource, SHADER_NAMES, builtinShaderReference } from '../core/shader.mjs';
import { readShaderSource } from './shader-sources.mjs';
import { t } from '../i18n.mjs';

export function mapChartShaders(chart, map) {
  const roots = {};
  const rootEvent = event => event && typeof event === 'object' ? map(event, shaderLine(event, chart)) : event;
  for (const key of ['effects', 'shaderEvents']) if (Array.isArray(chart[key])) roots[key] = chart[key].map(rootEvent);
  if (Array.isArray(chart.META?.effects)) roots.META = { ...chart.META, effects: chart.META.effects.map(rootEvent) };
  return { ...chart, ...roots, judgeLineList: chart.judgeLineList.map((line, index) => line.extended?.paintEvents ? { ...line, extended: { ...line.extended, paintEvents: line.extended.paintEvents.map(event => map(event, index)) } } : line) };
}
// Only materialize resources actually referenced by this export snapshot.
export async function prepareShaderExport(chart, assets, chartName) {
  const nextAssets = new Map(assets), refs = new WeakMap();
  for (const event of chartShaderEvents(chart)) {
    const reference = event.shader ?? event.name, name = canonicalShaderName(reference ?? event.shaderType);
    if (shaderAssetPath(assets, reference, chartName)) continue;
    if (!builtinShaderReference(reference ?? event.shaderType)) { if (shaderFileReference(reference)) throw Error(t('shader-editor.missing', { path: reference })); continue; }
    if (!name) continue;
    if (SHADER_NAMES.indexOf(name) < 10) { refs.set(event, name.replace(/_(\w)/g, (_, x) => x.toUpperCase())); continue; }
    const source = await readShaderSource(reference ?? name, assets, chartName);
    let stem = `shaders/builtin/${name}${legacyShaderSource(name, reference) ? '-legacy' : ''}`, path = stem + '.glsl', suffix = 2;
    const bytes = new TextEncoder().encode(source);
    while (nextAssets.has(path) && different(nextAssets.get(path), bytes)) path = `${stem}-${suffix++}.glsl`;
    nextAssets.set(path, bytes); refs.set(event, '/' + path);
  }
  return { chart: mapChartShaders(chart, (event, line) => refs.has(event) ? { ...event, line, shader: refs.get(event), clone: false } : event), assets: nextAssets };
}
function different(a, b) { return a.byteLength !== b.byteLength || a.some((value, index) => value !== b[index]); }
