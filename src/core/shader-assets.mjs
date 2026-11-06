import { t } from '../i18n.mjs';
// Phira distinguishes file shaders by their leading slash. Keep resource
// resolution separate from effect identity: /rain.glsl may be user code.
export const SHADER_FILE = /\.(glsl|frag|fs|fsh)$/i;
export const shaderFileReference = reference => typeof reference === 'string' && (reference.replaceAll('\\', '/').startsWith('/') || SHADER_FILE.test(reference));
export const MAX_SHADER_BYTES = 256 * 1024;
const slash = value => value.replaceAll('\\', '/');
const normalize = value => { const parts = []; for (const part of slash(value).split('/')) { if (part === '..') parts.pop(); else if (part && part !== '.') parts.push(part); } return parts.join('/'); };
export function shaderAssetTarget(reference, chartName = '') {
  if (!shaderFileReference(reference)) return null;
  const name = slash(reference), root = name.startsWith('/');
  const directory = slash(chartName).split('/').slice(0, -1).join('/');
  return normalize(root ? name : (directory ? directory + '/' : '') + name);
}
export function shaderAssetPath(assets, reference, chartName = '') {
  if (!assets) return null;
  const target = shaderAssetTarget(reference, chartName); if (target === null) return null;
  if (assets.has(target)) return target;
  const matches = [...assets.keys()].filter(path => normalize(path).toLowerCase() === target.toLowerCase());
  return matches.length === 1 ? matches[0] : null;
}
export function shaderText(bytes) {
  if (!bytes || bytes.byteLength > MAX_SHADER_BYTES) throw Error(t('shader-editor.tooLarge'));
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
}
export function chartShaderEvents(chart) {
  return [...chartShaderEntries(chart)].map(entry => entry.event);
}
export function* chartShaderEntries(chart) {
  for (const [path, events] of [['effects', chart.effects], ['shaderEvents', chart.shaderEvents], ['META.effects', chart.META?.effects]]) {
    for (const [index, event] of (Array.isArray(events) ? events : []).entries()) if (event && typeof event === 'object') yield { event, index, path: `${path}[${index}]`, line: event.line ?? 0 };
  }
  for (const [line, value] of (chart.judgeLineList ?? []).entries()) for (const [index, event] of (value.extended?.paintEvents ?? []).entries()) if (event && typeof event === 'object') yield { event, line, index, extended: true, path: `paintEvents[${index}]` };
}
export function chartShaderFiles(chart, assets, chartName) {
  return [...new Set(chartShaderEvents(chart).map(e => shaderAssetPath(assets, e.shader, chartName)).filter(Boolean))];
}
export function chartShaderChoices(chart, assets, chartName) {
  return [...new Set([...chartShaderFiles(chart, assets, chartName), ...[...(assets?.keys() ?? [])].filter(path => SHADER_FILE.test(path) && !/(?:^|\/)shader\/[^/]+\//i.test(path))])];
}
