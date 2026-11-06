import { localPreferences } from './local-preferences.mjs';
import { flushLocalPreferences } from './local-preferences.mjs';
import { MAX_SHADER_BYTES } from '../core/shader-assets.mjs';
import { shaderUniforms } from '../core/shader-uniforms.mjs';
import { namedShaderSource, shaderSourceBody, shaderSourceInfo } from '../core/shader-source-info.mjs';
import { t } from '../i18n.mjs';
const KEY = 'rpen-shader-library-v1';
let cachedText, cachedLibrary;
async function persistLibrary(text) {
  const previous = localPreferences.getItem(KEY);
  try { localPreferences.setItem(KEY, text); await flushLocalPreferences(); }
  catch (error) {
    // The native preference cache is optimistic. Restore only our own failed
    // write, without rolling back a newer edit from another open workspace.
    if (localPreferences.getItem(KEY) === text) {
      try { if (previous == null) localPreferences.removeItem(KEY); else localPreferences.setItem(KEY, previous); await flushLocalPreferences(); } catch { /* keep the original storage error */ }
    }
    throw error;
  }
  document.dispatchEvent(new Event('rpen-shader-library-changed'));
}
export function assertShaderSource(source) {
  if (typeof source !== 'string' || new TextEncoder().encode(source).byteLength > MAX_SHADER_BYTES) throw Error(t('shader-editor.tooLarge'));
  source = shaderSourceBody(source);
  if (!/\bvoid\s+main\s*\(\s*(?:void)?\s*\)/.test(source)) throw Error(t('shader-editor.noMain'));
  if (/^\s*#version\s+(?!100\b)/m.test(source)) throw Error(t('shader-editor.version'));
  for (const { type, name, validDefault } of shaderUniforms(source)) {
    if (!['float', 'vec2', 'vec4'].includes(type)) throw Error(t('shader-editor.uniformType', { name }));
    if (!validDefault) throw Error(t('shader-editor.uniformDefault', { name }));
  }
}
export function readShaderLibrary() {
  const text = localPreferences.getItem(KEY); if (!text) return [];
  if (text === cachedText && cachedLibrary) return cachedLibrary.slice();
  if (text.length > 8 * 1024 * 1024) throw Error(t('shader-editor.libraryFull'));
  const data = JSON.parse(text);
  if (data?.format !== 'rpen-shaders' || data.version !== 1 || !Array.isArray(data.templates) || data.templates.length > 256) throw Error(t('shader-editor.invalidLibrary'));
  const ids = new Set();
  const library = data.templates.map(entry => {
    assertShaderSource(entry.source);
    if (typeof entry.id !== 'string' || !/^[\w-]{1,100}$/.test(entry.id) || ids.has(entry.id) || typeof entry.name !== 'string') throw Error(t('shader-editor.invalidLibrary'));
    ids.add(entry.id); return Object.freeze({ id: entry.id, name: entry.name.slice(0, 100), source: entry.source });
  });
  cachedText = text; cachedLibrary = library; return library.slice();
}
export async function saveShaderTemplate({ id, name, source }, expectedSource) {
  assertShaderSource(source);
  name = String(name).trim().slice(0, 100); if (!name) throw Error(t('shader-editor.nameRequired'));
  const templates = readShaderLibrary(), current = templates.find(entry => entry.id === id);
  if (id && (!current || current.source !== (typeof expectedSource === 'object' ? expectedSource.source : expectedSource) || typeof expectedSource === 'object' && current.name !== expectedSource.name)) throw Error(t('shader-editor.conflict'));
  if (templates.some(entry => entry.id !== id && entry.name === name)) throw Error(t('shader-editor.duplicateName'));
  const record = { id: id ?? crypto.randomUUID(), name, source }, next = id ? templates.map(entry => entry.id === id ? record : entry) : [...templates, record];
  const text = JSON.stringify({ format: 'rpen-shaders', version: 1, templates: next });
  if (next.length > 256 || text.length > 8 * 1024 * 1024) throw Error(t('shader-editor.libraryFull'));
  await persistLibrary(text); return record;
}
export async function removeShaderTemplate(id, expectedSource) {
  const templates = readShaderLibrary(), current = templates.find(entry => entry.id === id);
  if (!current || current.source !== expectedSource) throw Error(t('shader-editor.conflict'));
  await persistLibrary(JSON.stringify({ format: 'rpen-shaders', version: 1, templates: templates.filter(entry => entry.id !== id) }));
}
export async function materializeShader(template, assets, chartPrefix = '') {
  const source = shaderSourceBody(template.source); assertShaderSource(source);
  const origin = template.id ? 'library:' + template.id : template.origin;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode((origin ?? '') + '\0' + source)));
  const hash = [...digest].map(v => v.toString(16).padStart(2, '0')).join('');
  const text = namedShaderSource(source, { name: template.name || 'Shader', chart: chartPrefix, origin, revision: hash });
  const bytes = new TextEncoder().encode(text); assertShaderSource(text);
  let path = `shaders/custom/${hash}.glsl`, serial = 2;
  while (assets.has(path)) {
    const existing = assets.get(path), info = shaderSourceInfo(new TextDecoder().decode(existing));
    // Reusing the same global snapshot must preserve edits to its chart copy.
    if (origin && info?.origin === origin && info.revision === hash || existing.length === bytes.length && existing.every((v, i) => v === bytes[i])) return { path, bytes: existing, shader: '/' + path };
    path = `shaders/custom/${hash}-${serial++}.glsl`;
  }
  return { path, bytes, shader: '/' + path };
}
