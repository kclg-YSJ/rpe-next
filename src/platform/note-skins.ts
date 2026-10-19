import { readZip, writeZip } from './archive.ts';
import { parseNoteSkin, serializeNoteSkinInfo, NOTE_SKIN_LIMITS } from '../core/note-skin.ts';
import { assetUrl } from '../core/asset-url.ts';
import { openDatabase, ensureStore } from './storage.ts';
import { nativeStorage, nativePackages } from './native.ts';
import type { NoteSkinInfo, NoteSkinRecord } from '../core/note-skin.ts';

export interface StoredNoteSkin {
  id: string;
  files: [string, Uint8Array][];
  originalFiles?: [string, Uint8Array][];
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
  const database = await openDatabase('rpe-next-note-skins', 1, (connection, transaction) => ensureStore(connection, transaction!, 'packages', { keyPath: 'id' }));
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction('packages', mode); let request: IDBRequest<T>;
    try { request = action(transaction.objectStore('packages')); } catch (error) { database.close(); reject(error); return; }
    transaction.oncomplete = () => { database.close(); resolve(request.result); };
    transaction.onabort = transaction.onerror = () => { database.close(); reject(transaction.error ?? new Error('皮肤存储失败')); };
  });
}
export const readNoteSkins = (): Promise<StoredNoteSkin[]> => nativeStorage ? nativePackages<StoredNoteSkin>('note-skins', 'read') : access<StoredNoteSkin[]>('readonly', store => store.getAll() as IDBRequest<StoredNoteSkin[]>);
export const storeNoteSkin = (record: NoteSkinRecord): Promise<unknown> => { const stored: StoredNoteSkin = { id: String(record.id ?? ''), files: [...record.files], originalFiles: [...(record.originalFiles ?? record.files)], imported: Date.now() }; return nativeStorage ? nativePackages('note-skins', 'write', stored.id, stored) : access('readwrite', store => store.put(stored)); };
export const deleteNoteSkin = (id: string): Promise<unknown> => nativeStorage ? nativePackages('note-skins', 'delete', id) : access('readwrite', store => store.delete(id));
export const exportNoteSkin = (record: NoteSkinRecord): Blob => writeZip(record.files);

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

export async function decodeNoteSkinSounds(record: NoteSkinRecord, context: unknown): Promise<Map<string, AudioBuffer>> {
  const audio = context as { decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer> };
  return new Map(await Promise.all([...record.sounds].map(async ([type, bytes]): Promise<[string, AudioBuffer]> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const buffer = await Promise.race([audio.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer), new Promise<AudioBuffer>((resolve, reject) => { timer = setTimeout(() => reject(new Error('音效解码超时')), 20000); })]);
      if (buffer.duration > 120) throw new Error('打击音效超过 120 秒');
      return [type, buffer];
    } catch (error) { throw new Error(`${type} 音效读取失败：${errorMessage(error)}`); }
    finally { if (timer !== undefined) clearTimeout(timer); }
  })));
}

export function updateNoteSkin(record: NoteSkinRecord, info: NoteSkinInfo, replacements: Map<string, Uint8Array | null> = new Map()): NoteSkinRecord {
  const files = new Map(record.files);
  for (const [name, bytes] of replacements) bytes ? files.set(name, bytes) : files.delete(name);
  files.set('info.yml', new TextEncoder().encode(serializeNoteSkinInfo(info)));
  return { ...parseNoteSkin(files, record.id), originalFiles: record.originalFiles ?? record.files, builtin: record.builtin };
}

export async function importNoteSkin(files: ImportFiles, directory = false): Promise<NoteSkinRecord> {
  let entries: Map<string, Uint8Array>;
  if (!directory) {
    const file = files[0]; if (!file || file.size > NOTE_SKIN_LIMITS.bytes + 1024 * 1024) throw new Error('音符皮肤包过大');
    entries = await readZip(await file.arrayBuffer() as ArrayBuffer, { maxFiles: NOTE_SKIN_LIMITS.files, maxBytes: NOTE_SKIN_LIMITS.bytes, maxFileBytes: NOTE_SKIN_LIMITS.fileBytes });
  } else {
    const selected = [...files];
    if (selected.length > NOTE_SKIN_LIMITS.files || selected.some(file => file.size > NOTE_SKIN_LIMITS.fileBytes) || selected.reduce((sum, file) => sum + file.size, 0) > NOTE_SKIN_LIMITS.bytes) throw new Error('音符皮肤文件数量或大小超限');
    entries = new Map(await Promise.all(selected.map(async (file): Promise<[string, Uint8Array]> => [file.webkitRelativePath || file.name, new Uint8Array(await file.arrayBuffer())])));
  }
  const record = parseNoteSkin(entries);
  // Identity is independent of filesystem paths and remains stable after parameter edits.
  const ordered = new Map([...record.files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  const digest = await crypto.subtle.digest('SHA-256', await writeZip(ordered).arrayBuffer());
  record.id = 'pack-' + [...new Uint8Array(digest)].slice(0, 12).map(byte => byte.toString(16).padStart(2, '0')).join('');
  record.originalFiles = record.files;
  return record;
}

export async function builtinNoteSkins(): Promise<NoteSkinRecord[]> {
  const response = await fetch(assetUrl('note-skins/index.json')); if (!response.ok) throw new Error('内置音符皮肤目录读取失败');
  const list: unknown = await response.json(); if (!Array.isArray(list)) throw new Error('内置音符皮肤目录无效');
  return Promise.all(list.map(async entry => {
    const item = entry as Record<string, unknown> | null;
    if (!item || typeof item.directory !== 'string' || !/^[a-z0-9-]+$/.test(item.directory) || !Array.isArray(item.files) || item.files.length > NOTE_SKIN_LIMITS.files) throw new Error('内置音符皮肤条目无效');
    const directory = item.directory;
    const names: unknown[] = item.files;
    const files = new Map<string, Uint8Array>(await Promise.all(names.map(async name => {
      if (typeof name !== 'string' || name.startsWith('/') || name.includes('..') || name.includes('\\')) throw new Error('内置音符皮肤路径无效');
      const result = await fetch(assetUrl(`note-skins/${directory}/${name}`)); if (!result.ok) throw new Error('内置音符皮肤素材缺失');
      return [name, new Uint8Array(await result.arrayBuffer())] as [string, Uint8Array];
    })));
    const record = parseNoteSkin(files, 'builtin-' + directory); return { ...record, builtin: true, originalFiles: record.files };
  }));
}
