import { chartHasAnimationCurves } from './chart-animation-curves.mjs';
import { diagnostic } from './chart-diagnostics.mjs';
import { builtinShaderReference, shaderLine } from './shader.mjs';
import { shaderFileReference, shaderAssetTarget, chartShaderEntries } from './shader-assets.mjs';
import { shaderVariableProblems } from './shader-uniforms.mjs';
import { beatValue } from './beat.mjs';

const slash = value => String(value ?? '').replaceAll('\\', '/');
const directory = value => slash(value).split('/').slice(0, -1).join('/');
function normalize(value) { const parts = []; for (const part of slash(value).split('/')) { if (part === '..') parts.pop(); else if (part && part !== '.') parts.push(part); } return parts.join('/').toLowerCase(); }
export class DiagnosticAssetIndex {
  constructor(paths) {
    this.exact = new Set(paths); this.normalized = new Map(); this.basenames = new Map();
    for (const path of paths) { const key = normalize(path), basename = key.split('/').at(-1); for (const [map, name] of [[this.normalized, key], [this.basenames, basename]]) { if (!map.has(name)) map.set(name, []); map.get(name).push(path); } }
  }
  resolve(name, source = '') {
    if (name.startsWith('/')) { const matches = this.normalized.get(normalize(name)) ?? []; return { path: matches.length === 1 ? matches[0] : undefined, matches }; }
    const prefix = directory(source), local = (prefix ? prefix + '/' : '') + name;
    for (const path of [local, name]) if (this.exact.has(path)) return { path, matches: [path] };
    for (const key of [normalize(local), normalize(name)]) { const matches = this.normalized.get(key); if (matches?.length === 1) return { path: matches[0], matches }; }
    const matches = this.basenames.get(normalize(name).split('/').at(-1)) ?? [];
    return { path: matches.length === 1 ? matches[0] : undefined, matches };
  }
  resolveShader(name, source = '') {
    const target = shaderAssetTarget(name, source);
    if (target === null) return { path: undefined, matches: [] };
    if (this.exact.has(target)) return { path: target, matches: [target] };
    const matches = this.normalized.get(target.toLowerCase()) ?? [];
    return { path: matches.length === 1 ? matches[0] : undefined, matches };
  }
}
const file = /\.(?:png|jpe?g|webp|gif|bmp|avif|ogg|wav|mp3|flac|m4a|aac|opus|webm|glsl|frag|fs|fsh|vert|json)$/i;
export function referencedResources(chart, options) {
  const result = [];
  const add = (asset, location) => { if (typeof asset === 'string' && asset.trim()) result.push({ asset, ...location }); };
  add(chart.META?.song || options.media?.song, { path: 'META.song' }); add(chart.META?.background || options.media?.background, { path: 'META.background' });
  for (const [line, value] of (chart.judgeLineList ?? []).entries()) {
    if (value.Texture && value.Texture !== 'line.png') add(value.Texture, { line, path: 'Texture' });
    for (const [index, note] of (value.notes ?? []).entries()) add(note.hitsound || note.hitSound, { line, index, path: `notes[${index}]` });
  }
  for (const [index, layer] of (chart.noiseAreaLayers ?? []).entries()) if (layer.skin) {
    add(layer.skin + '/config.json', { path: `noiseAreaLayers[${index}]`, optional: true }); add(layer.skin + '/main.glsl', { path: `noiseAreaLayers[${index}]` });
  }
  const shaders = [...(chart.effects ?? []), ...(chart.shaderEvents ?? []), ...(chart.META?.effects ?? []), ...(chart.judgeLineList ?? []).flatMap(line => line.extended?.paintEvents ?? [])];
  for (const [index, effect] of shaders.entries()) {
    const shader = effect.shader;
    if (shaderFileReference(shader) && !builtinShaderReference(shader)) add(shader, { line: effect.line ?? 0, path: `effects.${index}`, shader: true });
    const visit = value => { if (typeof value === 'string' && file.test(value)) add(value, { line: effect.line ?? 0, path: `effects.${index}` }); else if (value && typeof value === 'object') for (const item of Object.values(value)) visit(item); };
    visit(effect.vars);
  }
  return result;
}
export function resourceDiagnostics(chart, options = {}, deep = false) {
  if (!options.assetPaths) return [];
  const index = new DiagnosticAssetIndex(options.assetPaths), issues = [], references = referencedResources(chart, options), visited = new Set();
  for (let i = 0; i < references.length; i++) {
    const ref = references[i], source = ref.source ?? options.chartName ?? '', key = source + '\0' + ref.asset;
    if (visited.has(key)) continue; visited.add(key);
    const resolved = ref.shader ? index.resolveShader(ref.asset, source) : index.resolve(ref.asset, source);
    if (!resolved.path && !(ref.optional && !resolved.matches.length)) issues.push(diagnostic(resolved.matches.length ? 'assetAmbiguous' : 'assetMissing', 'error', { ...ref, asset: ref.asset }, { name: ref.asset, matches: resolved.matches.slice(0, 5).join(', ') }));
    else if (deep && options.assetTexts?.[resolved.path] !== undefined) {
      const text = options.assetTexts[resolved.path], location = { path: ref.path, source: resolved.path };
      if (/\.json$/i.test(resolved.path)) {
        try {
          const visit = value => { if (typeof value === 'string' && file.test(value)) references.push({ asset: value, ...location }); else if (value && typeof value === 'object') for (const [name, child] of Object.entries(value)) if (!['author', 'name', 'description', 'skinPresets'].includes(name)) visit(child); };
          visit(JSON.parse(text));
        } catch (error) { issues.push(diagnostic('assetConfig', 'error', { asset: resolved.path, path: ref.path }, { name: resolved.path, reason: error.message })); }
      } else for (const match of text.matchAll(/\/\/\s*@texture\s+(\S+)|#include\s*["<]([^">]+)[">]/g)) references.push({ asset: match[1] ?? match[2], ...location });
    }
  }
  if (options.shaderUniforms) for (const { event, ...location } of chartShaderEntries(chart)) {
    if (!shaderFileReference(event.shader)) continue;
    const path = index.resolveShader(event.shader, options.chartName).path, schema = options.shaderUniforms[path];
    if (!schema) continue;
    const time = event.startTime ?? event.start ?? 0; let beat = 0; try { beat = Array.isArray(time) ? beatValue(time) : Number(time) || 0; } catch { /* time validation reports malformed beats separately */ }
    for (const problem of shaderVariableProblems(event, schema)) issues.push(diagnostic(problem.code, 'error', { ...location, line: location.extended ? location.line : shaderLine(event, chart), path: `${location.path}.vars.${problem.name}`, asset: event.shader, shaderParameter: true, beat }, { name: problem.name, shader: path, type: problem.type }));
  }
  return issues;
}
export function compatibilityDiagnostics(chart, target = 'next') {
  if (target === 'next') return [];
  const issues = [], where = { target, path: 'compatibility' };
  if (chart.blockAreaList?.length) issues.push(diagnostic('compatNoise', 'error', where, { target }));
  if (Object.values(chart.globalEvents?.types ?? {}).some(type => Object.values(type.columns ?? {}).some(column => column.events?.length))) issues.push(diagnostic('compatGlobal', 'error', where, { target }));
  if (chartHasAnimationCurves(chart)) issues.push(diagnostic('compatCustomCurve', 'info', where, { target }));
  if (chart.judgeLineList?.some(line => line.eventLayers?.some(layer => layer?.moveXEvents?.some(event => event.trajectory)))) issues.push(diagnostic('compatTrajectory', 'info', where, { target }));
  if (target === 'phira') for (const [line, value] of (chart.judgeLineList ?? []).entries()) for (const [layer, tracks] of [...(value.eventLayers ?? []), value.extended].entries()) for (const [type, events] of Object.entries(tracks ?? {})) {
    for (const [index, event] of (Array.isArray(events) ? events : []).entries()) if (event.bezier && event.bezierPoints && (event.bezierPoints[0] < 0 || event.bezierPoints[0] > 1 || event.bezierPoints[2] < 0 || event.bezierPoints[2] > 1 || event.bezierPoints[0] > .95 && event.bezierPoints[2] < .05 || event.bezierPoints[0] < .05 && event.bezierPoints[2] < .05 || event.bezierPoints[0] > .95 && event.bezierPoints[2] > .95)) issues.push(diagnostic('compatBezier', 'warning', { ...where, line, layer, extended: layer === (value.eventLayers?.length ?? 0), index, path: `${type}[${index}]` }));
  }
  return issues;
}
