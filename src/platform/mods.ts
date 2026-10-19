import { readZip, writeZip } from './archive.ts';
import { openDatabase, ensureStore } from './storage.ts';
import { nativeStorage, nativePackages } from './native.ts';
import { MOD_LIMITS, parseModPackage } from '../core/mod-package.ts';
import { assetUrl } from '../core/asset-url.ts';
import type { ModPackage } from '../core/mod-package.ts';

export interface StoredMod {
  id: string;
  files: [string, Uint8Array][];
  imported: number;
}

export interface ImportFile {
  name: string;
  webkitRelativePath?: string;
  size: number;
  arrayBuffer(): Promise<ArrayBufferLike>;
}

export type ImportFiles = FileList | readonly ImportFile[];

async function access<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase('rpe-next-mods', 1, (connection, transaction) => ensureStore(connection, transaction!, 'packages', { keyPath: 'id' }));
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction('packages', mode); let request: IDBRequest<T>;
    try { request = action(transaction.objectStore('packages')); } catch (error) { database.close(); reject(error); return; }
    transaction.oncomplete = () => { database.close(); resolve(request.result); };
    transaction.onabort = transaction.onerror = () => { database.close(); reject(transaction.error ?? new Error('模组存储失败')); };
  });
}
export const readMods = (): Promise<StoredMod[]> => nativeStorage ? nativePackages<StoredMod>('mods', 'read') : access<StoredMod[]>('readonly', store => store.getAll() as IDBRequest<StoredMod[]>);
export const storeMod = (record: ModPackage): Promise<unknown> => {
  const stored: StoredMod = { id: record.manifest.id, files: [...record.files], imported: Date.now() };
  return nativeStorage ? nativePackages('mods', 'write', stored.id, stored) : access('readwrite', store => store.put(stored));
};
export const deleteMod = (id: string): Promise<unknown> => nativeStorage ? nativePackages('mods', 'delete', id) : access('readwrite', store => store.delete(id));
export const exportMod = (record: ModPackage): Blob => writeZip(record.files);
export async function importMod(files: ImportFiles, directory = false): Promise<ModPackage> {
  let entries: Map<string, Uint8Array>;
  if (directory) {
    const list = [...files];
    if (list.length > MOD_LIMITS.files || list.some(file => file.size > MOD_LIMITS.fileBytes) || list.reduce((sum, file) => sum + file.size, 0) > MOD_LIMITS.bytes) throw Error('模组文件数量或大小超限');
    entries = new Map(await Promise.all(list.map(async (file): Promise<[string, Uint8Array]> => [file.webkitRelativePath || file.name, new Uint8Array(await file.arrayBuffer())])));
  } else {
    const file = files[0]; if (!file || file.size > MOD_LIMITS.bytes + 1024 * 1024) throw Error('模组包过大');
    entries = await readZip(await file.arrayBuffer() as ArrayBuffer, { maxFiles: MOD_LIMITS.files, maxBytes: MOD_LIMITS.bytes, maxFileBytes: MOD_LIMITS.fileBytes });
  }
  return parseModPackage(entries);
}
export async function builtinMods(): Promise<Array<ModPackage & { builtin: true }>> {
  const response = await fetch(assetUrl('mods/index.json')); if (!response.ok) throw Error('内置模组目录读取失败');
  const list: unknown = await response.json();
  if (!Array.isArray(list)) throw Error('内置模组目录无效');
  return Promise.all(list.map(async entry => {
    const item = entry as Record<string, unknown> | null;
    if (!item || typeof item.directory !== 'string' || !/^[a-z][a-z0-9-]*$/.test(item.directory) || !Array.isArray(item.files)) throw Error('内置模组条目无效');
    const directory = item.directory;
    const paths: unknown[] = item.files;
    const files = new Map<string, Uint8Array>(await Promise.all(paths.map(async path => {
      if (typeof path !== 'string' || path.includes('..') || path.startsWith('/')) throw Error('内置模组路径无效');
      const result = await fetch(assetUrl(`mods/${directory}/${path}`)); if (!result.ok) throw Error('内置模组文件缺失');
      return [path, new Uint8Array(await result.arrayBuffer())] as [string, Uint8Array];
    })));
    return { ...parseModPackage(files), builtin: true as const };
  }));
}
