import { openDatabase, ensureStore } from './storage.mjs';
import { readZip, writeZip } from './archive.mjs';
import { parseEditorSkin, EDITOR_SKIN_LIMITS } from '../core/editor-skin.mjs';
import { assetUrl } from '../core/asset-url.mjs';
import { nativeStorage, nativePackages } from './native.mjs';
import { t } from '../i18n.mjs';

async function access(mode, action) {
  const connection = await openDatabase('rpe-next-editor-skins', 1, (connection, transaction) => ensureStore(connection, transaction, 'packages', { keyPath: 'id' }));
  return new Promise((resolve, reject) => {
    const transaction = connection.transaction('packages', mode); let request;
    try { request = action(transaction.objectStore('packages')); } catch (error) { connection.close(); reject(error); return; }
    transaction.oncomplete = () => { connection.close(); resolve(request.result); };
    transaction.onabort = transaction.onerror = () => { connection.close(); reject(transaction.error ?? new Error(t('editor-skins.sa747ecd'))); };
  });
}
export const readEditorSkins = () => nativeStorage ? nativePackages('editor-skins', 'read') : access('readonly', store => store.getAll());
export const storeEditorSkin = record => { const stored = { id: record.skin.id, files: [...record.files], imported: Date.now() }; return nativeStorage ? nativePackages('editor-skins', 'write', stored.id, stored) : access('readwrite', store => store.put(stored)); };
export const deleteEditorSkin = id => nativeStorage ? nativePackages('editor-skins', 'delete', id) : access('readwrite', store => store.delete(id));
export const exportEditorSkin = record => writeZip(record.files);

export async function importEditorSkin(files, directory = false) {
  let entries;
  if (!directory) {
    const file = files[0]; if (!file || file.size > EDITOR_SKIN_LIMITS.bytes + 1024 * 1024) throw new Error(t('editor-skins.s37f69ab'));
    entries = await readZip(await file.arrayBuffer(), { maxFiles: EDITOR_SKIN_LIMITS.files, maxBytes: EDITOR_SKIN_LIMITS.bytes, maxFileBytes: EDITOR_SKIN_LIMITS.fileBytes });
  } else {
    const selected = [...files];
    if (selected.length > EDITOR_SKIN_LIMITS.files || selected.reduce((sum, file) => sum + file.size, 0) > EDITOR_SKIN_LIMITS.bytes || selected.some(file => file.size > EDITOR_SKIN_LIMITS.fileBytes)) throw new Error(t('editor-skins.scbc7ace'));
    entries = new Map(await Promise.all(selected.map(async file => [file.webkitRelativePath || file.name, new Uint8Array(await file.arrayBuffer())])));
  }
  entries = new Map([...entries].filter(([path]) => !path.endsWith('/')));
  if (!entries.has('skin.json')) {
    const manifests = [...entries.keys()].filter(path => path.endsWith('/skin.json'));
    if (manifests.length !== 1) throw new Error('皮肤包需要唯一的根目录 skin.json');
    const prefix = manifests[0].slice(0, -9);
    if ([...entries.keys()].some(path => !path.startsWith(prefix))) throw new Error(t('editor-skins.s4f4abee'));
    entries = new Map([...entries].map(([path, bytes]) => [path.slice(prefix.length), bytes]));
  }
  return parseEditorSkin(entries);
}

export async function builtinEditorSkins() {
  const response = await fetch(assetUrl('editor-skins/index.json'));
  if (!response.ok) throw new Error(t('editor-skins.s4c01d3e'));
  const list = await response.json(); if (!Array.isArray(list)) throw new Error(t('editor-skins.sacd2ee2'));
  return Promise.all(list.map(async entry => {
    if (!entry || typeof entry.directory !== 'string' || !/^[a-z0-9-]+$/.test(entry.directory) || !Array.isArray(entry.files)) throw new Error(t('editor-skins.s52c726d'));
    const files = new Map(await Promise.all(entry.files.map(async path => {
      if (typeof path !== 'string' || path.includes('..') || path.startsWith('/')) throw new Error(t('editor-skins.sd3e38d2'));
      const result = await fetch(assetUrl(`editor-skins/${entry.directory}/${path}`)); if (!result.ok) throw new Error(t('editor-skins.sf849c20'));
      return [path, new Uint8Array(await result.arrayBuffer())];
    })));
    return { ...parseEditorSkin(files), builtin: true };
  }));
}
