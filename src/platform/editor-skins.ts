import { readZip, writeZip } from './archive.ts';
import { openDatabase, ensureStore } from './storage.ts';
import { nativeStorage, nativePackages } from './native.ts';
import { parseEditorSkin, EDITOR_SKIN_LIMITS } from '../core/editor-skin.ts';
import type { EditorSkinPackage } from '../core/editor-skin.ts';
import { assetUrl } from '../core/asset-url.ts';

/** One stored skin package: its id plus the files the importer kept. */
interface StoredSkin {
  id: string;
  files: [string, Uint8Array][];
  imported: number;
}

/** The skin record `parseEditorSkin` returns, with the built-in flag the catalogue adds. */
interface ParsedSkin extends EditorSkinPackage {
  builtin?: boolean;
}

/** The file-like objects a directory or zip import accepts. */
interface SkinFile {
  name: string;
  size: number;
  webkitRelativePath?: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

function access<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDatabase('rpe-next-editor-skins', 1, (connection, transaction) => ensureStore(connection, transaction!, 'packages', { keyPath: 'id' })).then(connection => new Promise<T>((resolve, reject) => {
    const transaction = connection.transaction('packages', mode); let request: IDBRequest<T>;
    try { request = action(transaction.objectStore('packages')); } catch (error) { connection.close(); reject(error); return; }
    transaction.oncomplete = () => { connection.close(); resolve(request.result); };
    transaction.onabort = transaction.onerror = () => { connection.close(); reject(transaction.error ?? new Error('皮肤存储已中止')); };
  }));
}
export const readEditorSkins = (): Promise<StoredSkin[]> => nativeStorage ? nativePackages<StoredSkin>('editor-skins', 'read') : access<StoredSkin[]>('readonly', store => store.getAll() as IDBRequest<StoredSkin[]>);
export const storeEditorSkin = (record: ParsedSkin): Promise<unknown> => { const stored: StoredSkin = { id: record.skin.id ?? '', files: [...record.files], imported: Date.now() }; return nativeStorage ? nativePackages('editor-skins', 'write', stored.id, stored) : access('readwrite', store => store.put(stored)); };
export const deleteEditorSkin = (id: string): Promise<unknown> => nativeStorage ? nativePackages('editor-skins', 'delete', id) : access('readwrite', store => store.delete(id));
export const exportEditorSkin = (record: ParsedSkin): Blob => writeZip(record.files);

export async function importEditorSkin(files: SkinFile[], directory = false): Promise<ParsedSkin> {
  let entries: Map<string, Uint8Array>;
  if (!directory) {
    const file = files[0]; if (!file || file.size > EDITOR_SKIN_LIMITS.bytes + 1024 * 1024) throw new Error('皮肤包超过大小限制');
    entries = await readZip(await file.arrayBuffer(), { maxFiles: EDITOR_SKIN_LIMITS.files, maxBytes: EDITOR_SKIN_LIMITS.bytes, maxFileBytes: EDITOR_SKIN_LIMITS.fileBytes });
  } else {
    const selected = [...files];
    if (selected.length > EDITOR_SKIN_LIMITS.files || selected.reduce((sum, file) => sum + file.size, 0) > EDITOR_SKIN_LIMITS.bytes || selected.some(file => file.size > EDITOR_SKIN_LIMITS.fileBytes)) throw new Error('皮肤文件数量或大小超限');
    entries = new Map(await Promise.all(selected.map(async (file): Promise<[string, Uint8Array]> => [file.webkitRelativePath || file.name, new Uint8Array(await file.arrayBuffer())])));
  }
  entries = new Map([...entries].filter(([path]) => !path.endsWith('/')));
  if (!entries.has('skin.json')) {
    const manifests = [...entries.keys()].filter(path => path.endsWith('/skin.json'));
    if (manifests.length !== 1) throw new Error('皮肤包需要唯一的根目录 skin.json');
    const prefix = manifests[0]!.slice(0, -9);
    if ([...entries.keys()].some(path => !path.startsWith(prefix))) throw new Error('皮肤包不能包含根目录以外的文件');
    entries = new Map([...entries].map(([path, bytes]) => [path.slice(prefix.length), bytes]));
  }
  return parseEditorSkin(entries) as ParsedSkin;
}

interface BuiltinCatalogueEntry {
  directory: string;
  files: string[];
}

export async function builtinEditorSkins(): Promise<ParsedSkin[]> {
  const response = await fetch(assetUrl('editor-skins/index.json'));
  if (!response.ok) throw new Error('内置编辑器皮肤目录读取失败');
  const list: unknown = await response.json(); if (!Array.isArray(list)) throw new Error('内置编辑器皮肤列表无效');
  return Promise.all((list as unknown[]).map(async raw => {
    const entry = raw as Partial<BuiltinCatalogueEntry> | null;
    if (!entry || typeof entry.directory !== 'string' || !/^[a-z0-9-]+$/.test(entry.directory) || !Array.isArray(entry.files)) throw new Error('内置编辑器皮肤条目无效');
    const files = new Map(await Promise.all(entry.files.map(async (path): Promise<[string, Uint8Array]> => {
      if (typeof path !== 'string' || path.includes('..') || path.startsWith('/')) throw new Error('内置皮肤路径无效');
      const result = await fetch(assetUrl(`editor-skins/${entry.directory}/${path}`)); if (!result.ok) throw new Error('内置皮肤文件缺失');
      return [path, new Uint8Array(await result.arrayBuffer())];
    })));
    return { ...parseEditorSkin(files) as ParsedSkin, builtin: true };
  }));
}

