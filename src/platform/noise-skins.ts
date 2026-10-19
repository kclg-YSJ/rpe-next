import { assetUrl } from '../core/asset-url.ts';
import { parseNoiseSkin, skinPath } from '../core/noise-skin.ts';
import type { NoiseSkinDefinition } from '../core/noise-skin.ts';

/** A catalogue entry in `noise-skins/index.json`. */
interface NoiseSkinCatalogueEntry {
  name: string;
  files: string[];
}

/** One built-in skin as the loader reports it. */
export interface BuiltinNoiseSkin {
  name: string;
  author: string;
  files: Map<string, Uint8Array>;
}

/** The request function the loader resolves asset paths through; injectable for tests. */
type Request = (url: string) => Promise<Response>;

export async function loadBuiltinNoiseSkins(request: Request = url => fetch(url)): Promise<BuiltinNoiseSkin[]> {
  const read = async (path: string): Promise<Uint8Array> => {
    const response = await request(assetUrl(`noise-skins/${path}`));
    if (!response.ok) throw new Error('内置皮肤资源载入失败：' + path);
    return new Uint8Array(await response.arrayBuffer());
  };
  const catalogue: unknown = JSON.parse(new TextDecoder().decode(await read('index.json')));
  const names = new Set<string>();
  if (!Array.isArray(catalogue)) throw new Error('内置皮肤列表无效');
  for (const raw of catalogue as unknown[]) {
    const entry = raw as Partial<NoiseSkinCatalogueEntry> | null;
    if (!entry || typeof entry.name !== 'string' || !entry.name || entry.name.includes('/') || names.has(entry.name) || !Array.isArray(entry.files) || !entry.files.includes('main.glsl')) throw new Error('内置皮肤条目无效');
    skinPath(entry.name); names.add(entry.name);
    for (const path of entry.files) skinPath(path);
  }
  return Promise.all((catalogue as NoiseSkinCatalogueEntry[]).map(async entry => {
    const files = new Map(await Promise.all(entry.files.map(async (path): Promise<[string, Uint8Array]> => [path, await read(`${entry.name}/${path}`)])));
    const definition: NoiseSkinDefinition = parseNoiseSkin(files);
    return { name: entry.name, author: definition.author, files };
  }));
}

const sameBytes = (left: Uint8Array | string | undefined, right: Uint8Array | string): boolean => left === right || left instanceof Uint8Array && right instanceof Uint8Array && left.length === right.length && left.every((byte, index) => byte === right[index]);

export function builtinNoiseSkinRoot(skin: BuiltinNoiseSkin, assets: Map<string, Uint8Array | string>): string {
  // Imported skins with the same name may be different. Reuse an exact copy or
  // choose a free root, keeping all existing chart resources untouched.
  for (let suffix = 0; ; suffix++) {
    const root = skinPath(`shader/${skin.name}${suffix ? `-builtin${suffix > 1 ? '-' + suffix : ''}` : ''}`);
    const existing = [...assets].filter(([path]) => path.startsWith(root + '/'));
    if (!existing.length || existing.length === skin.files.size && [...skin.files].every(([path, bytes]) => sameBytes(assets.get(`${root}/${path}`), bytes))) return root;
  }
}
export function installBuiltinNoiseSkin(skin: BuiltinNoiseSkin, assets: Map<string, Uint8Array | string>): { root: string; entries: Map<string, Uint8Array> } {
  const root = builtinNoiseSkinRoot(skin, assets);
  return { root, entries: assets.has(root + '/main.glsl') ? new Map<string, Uint8Array>() : new Map([...skin.files].map(([path, bytes]) => [`${root}/${path}`, bytes.slice()])) };
}
