import { snapshotParts } from './recovery-transfer.mjs';
import { t } from '../i18n.mjs';

const bridge = globalThis.rpenDesktopStorage?.version === 1 ? globalThis.rpenDesktopStorage : null;
// Recreate typed errors in the renderer; contextBridge only preserves Error messages.
export const nativeStorage = bridge ? { call: async (...args) => {
  const response = await bridge.call(...args);
  if (!response.ok) throw Object.assign(new Error(response.error.message), response.error);
  return response.result;
} } : null;
const binaryCache = new WeakMap();
let ready;
function partWeight(part) {
  // Budget the batch without serializing the entire chart on the UI thread.
  const stack = [part]; let weight = 0;
  while (stack.length && weight < 256 * 1024) {
    const value = stack.pop();
    if (typeof value === 'string') weight += value.length * 2;
    else if (value && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) { weight += key.length * 2 + 8; stack.push(item); }
    } else weight += 8;
  }
  return weight;
}
async function arrayHash(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map(value => value.toString(16).padStart(2, '0')).join('');
}
export async function nativeWrite(kind, id, record, options = {}) {
  const token = await nativeStorage.call('begin', kind, id, options), binaries = [];
  try {
    let batch = [], weight = 0;
    for (const part of snapshotParts(record, [], binaries)) {
      const size = partWeight(part);
      if (batch.length && (batch.length >= 128 || weight + size > 256 * 1024)) {
        await nativeStorage.call('parts', token, batch); batch = []; weight = 0;
      }
      batch.push(part); weight += size;
    }
    if (batch.length) await nativeStorage.call('parts', token, batch);
    for (const { path, value } of binaries) {
      const blob = value instanceof Blob, bytes = blob ? null : value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      const length = blob ? value.size : bytes.length;
      // Mutable arrays must be checked again, even if their object identity is unchanged.
      const cached = binaryCache.get(value), knownHash = blob ? cached : cached && globalThis.crypto?.subtle ? await arrayHash(bytes) : undefined;
      const entry = await nativeStorage.call('binaryBegin', token, { path, length, kind: blob ? 'blob' : 'bytes', type: blob ? value.type : '', hash: knownHash });
      let hash = entry.hash;
      if (!entry.existing) for (let offset = 0; offset < length; offset += 1024 ** 2) {
        const chunk = blob ? new Uint8Array(await value.slice(offset, offset + 1024 ** 2).arrayBuffer()) : bytes.slice(offset, offset + 1024 ** 2);
        const result = await nativeStorage.call('binaryChunk', token, entry.index, offset, chunk); hash = result.hash ?? hash;
      }
      if (hash) binaryCache.set(value, hash);
    }
    return await nativeStorage.call('commit', token);
  } catch (error) { await nativeStorage.call('abort', token).catch(() => {}); throw error; }
}

export async function decodeNative(envelope) {
  if (!envelope) return undefined;
  const data = envelope.data;
  for (const entry of envelope.binaries ?? []) {
    const bytes = new Uint8Array(entry.length);
    for (let offset = 0; offset < bytes.length;) {
      const chunk = await nativeStorage.call('blob', entry.hash, offset, Math.min(1024 ** 2, bytes.length - offset));
      if (!chunk?.length) throw Error(t('native.sde220c9')); bytes.set(chunk, offset); offset += chunk.length;
    }
    const value = entry.kind === 'blob' ? new Blob([bytes], { type: entry.type }) : bytes;
    let parent = data;
    for (const key of entry.path.slice(0, -1)) { if (!Object.hasOwn(parent, key)) throw Error(t('native.s5099694')); parent = parent[key]; }
    Object.defineProperty(parent, entry.path.at(-1), { value, enumerable: true, writable: true, configurable: true });
    binaryCache.set(value, entry.hash);
  }
  return data;
}
export async function nativeAssetBytes(value) {
  if (!(value instanceof Blob)) return value;
  const bytes = new Uint8Array(await value.arrayBuffer());
  const hash = binaryCache.get(value); if (hash) binaryCache.set(bytes, hash);
  return bytes;
}

async function legacyDatabase(name) {
  const databases = await indexedDB.databases?.();
  if (databases && !databases.some(database => database.name === name)) return null;
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name); let missing = false;
    request.onupgradeneeded = () => { missing = true; request.transaction.abort(); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => missing ? resolve(null) : reject(request.error);
  });
}
async function legacyRead(database, store, key, keys = false) {
  return new Promise((resolve, reject) => {
    const request = database.transaction(store).objectStore(store)[keys ? 'getAllKeys' : 'get'](...(keys ? [] : [key]));
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}

async function migrateLegacy() {
  const sources = [['rpe-next-library', 'projects', 'projects'], ['rpe-next-recovery', 'drafts', 'drafts'], ['rpe-next-editor-skins', 'packages', 'editor-skins'], ['rpe-next-note-skins', 'packages', 'note-skins'], ['rpe-next-mods', 'packages', 'mods'], ['rpe-next-library', 'preferences', 'preferences']];
  let overlay;
  try {
    for (const [name, store, kind] of sources) {
      const database = await legacyDatabase(name); if (!database) continue;
      try {
        if (!database.objectStoreNames.contains(store)) continue;
        const keys = await legacyRead(database, store, null, true);
        for (const [index, key] of keys.entries()) {
          const id = String(key), source = name + '/' + store;
          if (await nativeStorage.call('migrationDone', source, kind, id)) continue;
          if (!overlay) {
            overlay = document.createElement('div'); overlay.className = 'native-storage-migration'; overlay.setAttribute('role', 'status');
            const title = document.createElement('strong'); title.textContent = t('native.s4f9a22d');
            const progress = document.createElement('p'); progress.dataset.nativeProgress = 'true';
            const hint = document.createElement('p'); hint.textContent = t('native.sc316757'); overlay.append(title, progress, hint); document.body.append(overlay);
          }
          overlay.querySelector('[data-native-progress]').textContent = `${kind} · ${index + 1}/${keys.length}`;
          const value = await legacyRead(database, store, key);
          const record = kind === 'preferences' ? { id, value } : value;
          if (!record) continue;
          // A deletion marker from the old library must not resurrect a deleted project.
          if (kind === 'projects' && database.objectStoreNames.contains('revisions')) {
            const revision = await legacyRead(database, 'revisions', key); if (revision?.deleted) continue;
          }
          if (kind === 'projects' && database.objectStoreNames.contains('summaries')) {
            const summary = await legacyRead(database, 'summaries', key); if (summary?.thumbnail) record.thumbnail = summary.thumbnail;
          }
          if (kind === 'projects' && !record.thumbnail) record.thumbnail = await (await import('./thumbnail.mjs')).projectThumbnail(record);
          await nativeWrite(kind, id, record, { migration: true });
          await nativeStorage.call('markMigration', source, kind, id);
        }
      } finally { database.close(); }
    }
    if (!await nativeStorage.call('read', 'preferences', 'ui-settings')) {
      const values = {};
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        if (/^rpe(?:-next|-collab)-/.test(key)) Object.defineProperty(values, key, { value: localStorage.getItem(key), enumerable: true });
      }
      await nativeWrite('preferences', 'ui-settings', { id: 'ui-settings', values });
    }
    await nativeStorage.call('migrationComplete');
  } finally { overlay?.remove(); }
}

export function nativeReady() {
  if (!nativeStorage) return Promise.resolve();
  return ready ??= nativeStorage.call('legacyMigrationPending').then(pending => pending ? migrateLegacy() : undefined).catch(error => { ready = null; throw error; });
}
export async function nativeRead(kind, id) { await nativeReady(); return decodeNative(await nativeStorage.call('read', kind, id)); }
export async function nativeList(kind, deleted = false) { await nativeReady(); return Promise.all((await nativeStorage.call('list', kind, deleted)).map(decodeNative)); }

export async function nativePackages(kind, mode, id, record) {
  await nativeReady();
  if (mode === 'read') {
    const items = await nativeStorage.call('list', kind, false), records = [];
    for (const entry of items) records.push(await nativeRead(kind, entry.data.id));
    return records;
  }
  if (mode === 'delete') return nativeStorage.call('remove', kind, id);
  return nativeWrite(kind, id, record);
}
