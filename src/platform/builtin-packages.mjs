import { assetUrl } from '../core/asset-url.mjs';
import { t } from '../i18n.mjs';

const validPath = path => typeof path === 'string' && path.length > 0 && !/[:%?#\\\u0000-\u001f]/.test(path) && !path.startsWith('/') && !path.split('/').some(part => part === '..' || part === '.' || !part);

// A catalog may share identical resources without changing the portable package
// format. The resulting file map still contains every file needed for export.
export async function builtinPackageFiles(base, entry, cache = new Map()) {
  if (!/^[a-z][a-z0-9-]*$/.test(entry.directory) || !Array.isArray(entry.files)) throw Error(t('builtin-packages.invalid'));
  const paths = entry.files.map(path => [path, `${base}/${entry.directory}/${path}`]);
  for (const [path, source] of Object.entries(entry.shared ?? {})) paths.push([path, source]);
  const seen = new Set();
  for (const [path, source] of paths) {
    if (!validPath(path) || !validPath(source) || seen.has(path)) throw Error(t('builtin-packages.invalid'));
    seen.add(path);
  }
  return new Map(await Promise.all(paths.map(async ([path, source]) => {
    const url = assetUrl(source);
    if (!cache.has(url)) cache.set(url, fetch(url).then(async response => {
      if (!response.ok) throw Error(t('builtin-packages.missing', { path }));
      return new Uint8Array(await response.arrayBuffer());
    }).catch(error => { cache.delete(url); throw error; }));
    return [path, await cache.get(url)];
  })));
}

export function deferBuiltinPackage(metadata, load) {
  const record = { ...metadata, builtin: true, deferred: true, files: new Map() };
  let pending;
  record.load = () => pending ??= Promise.resolve().then(load).then(loaded => {
    const before = record.skin ?? record.manifest, after = loaded.skin ?? loaded.manifest;
    if (before.id !== after.id || (before.skinVersion ?? before.version) !== (after.skinVersion ?? after.version)) throw Error(t('builtin-packages.invalid'));
    Object.assign(record, loaded, { builtin: true, deferred: false });
    return record;
  }).catch(error => { pending = null; throw error; });
  return record;
}

export const loadBuiltinPackage = record => record?.deferred ? record.load() : Promise.resolve(record);
