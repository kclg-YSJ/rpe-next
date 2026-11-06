import { assetUrl } from '../core/asset-url.mjs';
import { builtinShaderSource, canonicalShaderName, legacyShaderSource, builtinShaderReference } from '../core/shader.mjs';
import { shaderAssetPath, shaderText } from '../core/shader-assets.mjs';
import { t } from '../i18n.mjs';
const pending = new Map();
export async function readShaderSource(reference, assets, chartName = '') {
  const path = shaderAssetPath(assets, reference, chartName);
  if (path) return shaderText(assets.get(path));
  const name = canonicalShaderName(reference);
  if (!name || !builtinShaderReference(reference)) throw Error(t('shader-editor.missing', { path: reference }));
  if (!pending.has(name)) pending.set(name, fetch(assetUrl(`rpe/shaders/${name}.glsl`)).then(async response => {
    if (!response.ok) throw Error(t('shader-editor.missing', { path: reference }));
    return response.text();
  }).catch(error => { pending.delete(name); throw error; }));
  return builtinShaderSource(await pending.get(name), legacyShaderSource(name, reference));
}
