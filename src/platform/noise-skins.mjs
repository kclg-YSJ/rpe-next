import { assetUrl } from '../core/asset-url.ts';
import { parseNoiseSkin, skinPath } from '../core/noise-skin.mjs';

export async function loadBuiltinNoiseSkins(request = url => fetch(url)) {
  const read = async path => {
    const response = await request(assetUrl(`noise-skins/${path}`));
    if (!response.ok) throw new Error('内置皮肤资源载入失败：' + path);
    return new Uint8Array(await response.arrayBuffer());
  };
  const catalogue = JSON.parse(new TextDecoder().decode(await read('index.json')));
  const names = new Set();
  if (!Array.isArray(catalogue)) throw new Error('内置皮肤列表无效');
  for (const entry of catalogue) {
    if (!entry || typeof entry.name !== 'string' || !entry.name || entry.name.includes('/') || names.has(entry.name) || !Array.isArray(entry.files) || !entry.files.includes('main.glsl')) throw new Error('内置皮肤条目无效');
    skinPath(entry.name); names.add(entry.name);
    for (const path of entry.files) skinPath(path);
  }
  return Promise.all(catalogue.map(async entry => {
    const files = new Map(await Promise.all(entry.files.map(async path => [path, await read(`${entry.name}/${path}`)])));
    const definition = parseNoiseSkin(files);
    return { name: entry.name, author: definition.author, files };
  }));
}

const sameBytes = (left, right) => left === right || left instanceof Uint8Array && left.length === right.length && left.every((byte, index) => byte === right[index]);

export function builtinNoiseSkinRoot(skin, assets) {
  // Imported skins with the same name may be different. Reuse an exact copy or
  // choose a free root, keeping all existing chart resources untouched.
  for (let suffix = 0; ; suffix++) {
    const root = skinPath(`shader/${skin.name}${suffix ? `-builtin${suffix > 1 ? '-' + suffix : ''}` : ''}`);
    const existing = [...assets].filter(([path]) => path.startsWith(root + '/'));
    if (!existing.length || existing.length === skin.files.size && [...skin.files].every(([path, bytes]) => sameBytes(assets.get(`${root}/${path}`), bytes))) return root;
  }
}
export function installBuiltinNoiseSkin(skin, assets) {
  const root = builtinNoiseSkinRoot(skin, assets);
  return { root, entries: assets.has(root + '/main.glsl') ? new Map() : new Map([...skin.files].map(([path, bytes]) => [`${root}/${path}`, bytes.slice()])) };
}
