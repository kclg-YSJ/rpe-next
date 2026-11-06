// Names travel with the GLSL as a comment; Phira and other GLSL consumers ignore it.
const marker = /^\/\/ @rpen-template (\{[^\r\n]*\})\r?\n/m;
const cache = new WeakMap();
const inferred = new WeakMap();
const attempted = new WeakMap();
let lastTemplates = [], templateNames = new Map();
export function shaderSourceInfo(source) {
  try {
    const value = JSON.parse(source.match(marker)?.[1] ?? 'null');
    if (value?.version === 1 && typeof value.name === 'string') return value;
  } catch { /* ordinary, imported GLSL */ }
  return null;
}
export const shaderSourceBody = source => source.replace(marker, '');
export function namedShaderSource(source, info) {
  const header = JSON.stringify({ ...info, version: 1, name: String(info.name).trim().slice(0, 100), chart: String(info.chart ?? '') }).replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
  // Keep #version first, as required by GLSL 1.00.
  const body = shaderSourceBody(source), version = body.match(/^\s*#version[^\r\n]*(?:\r?\n|$)/)?.[0] ?? '';
  return version + (version && !version.endsWith('\n') ? '\n' : '') + '// @rpen-template ' + header + '\n' + body.slice(version.length);
}
export function chartNamePrefix(chart, chartName = '') {
  const title = String(chart?.META?.name || chartName.replaceAll('\\', '/').split('/').at(-1)?.replace(/\.[^.]+$/, '') || 'chart').trim();
  return [...title].slice(0, 6).join('');
}
export function shaderAssetInfo(bytes) {
  if (!bytes || typeof bytes !== 'object') return null;
  if (!cache.has(bytes)) cache.set(bytes, shaderSourceInfo(new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 4096)))));
  return cache.get(bytes) ?? inferred.get(bytes) ?? null;
}
export function inferShaderAssetNames(paths, assets, templates) {
  if (templates.length !== lastTemplates.length || templates.some((entry, i) => entry !== lastTemplates[i])) { lastTemplates = templates.slice(); templateNames = new Map(templates.map(template => [shaderSourceBody(template.source), template.name])); }
  for (const path of paths) {
    const bytes = assets?.get(path);
    if (!bytes || shaderAssetInfo(bytes) || attempted.get(bytes) === templateNames || !/\/[a-f\d]{64}(?:-\d+)?\.glsl$/i.test(path)) continue;
    attempted.set(bytes, templateNames);
    const name = templateNames.get(shaderSourceBody(new TextDecoder().decode(bytes)));
    if (name) inferred.set(bytes, { name });
  }
}
export function shaderAssetName(path, assets) {
  const info = shaderAssetInfo(assets?.get(path));
  const basename = path.replaceAll('\\', '/').split('/').at(-1).replace(/\.[^.]+$/, '');
  return info?.name || (/^[a-f\d]{64}(?:-\d+)?$/i.test(basename) ? 'Shader' : basename);
}
export function shaderAssetLabel(path, assets, chart, chartName = '') {
  return shaderAssetName(path, assets) + ' · ' + chartNamePrefix(chart, chartName);
}
