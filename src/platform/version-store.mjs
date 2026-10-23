import { openDatabase, ensureStore } from './storage.mjs';
import { nativeStorage, nativeReady, nativeWrite, nativeRead } from './native.mjs';
import { t } from '../i18n.mjs';

const DATABASE = 'rpe-next-chart-vcs';
const VERSION = 1;
const NATIVE_KINDS = { repos: 'version-repos', commits: 'version-commits', trees: 'version-trees', blobs: 'version-blobs' };
const NATIVE_MIGRATION_KEY = 'rpe-next-chart-vcs-native-migrated-v1';

function versionDatabase() {
  return openDatabase(DATABASE, VERSION, (connection, transaction) => {
    for (const name of ['repos', 'trees', 'blobs']) ensureStore(connection, transaction, name, { keyPath: 'id' });
    const commits = ensureStore(connection, transaction, 'commits', { keyPath: 'id' });
    if (!commits.indexNames.contains('repoId')) commits.createIndex('repoId', 'repoId');
  });
}

async function access(stores, mode, action) {
  const connection = await versionDatabase();
  return new Promise((resolve, reject) => {
    const transaction = connection.transaction(stores, mode, mode === 'readwrite' ? { durability: 'strict' } : undefined);
    let result;
    try { result = action(transaction); }
    catch (error) { transaction.abort(); connection.close(); reject(error); return; }
    transaction.oncomplete = () => { connection.close(); resolve(result?.result); };
    transaction.onerror = transaction.onabort = () => {
      connection.close();
      reject(transaction.error ?? new Error(t('version-store.s34f8195')));
    };
  });
}

class IndexedVersionStore {
  ephemeral = false;

  async get(kind, id) {
    let value;
    return access([kind], 'readonly', transaction => {
      const request = transaction.objectStore(kind).get(id);
      request.onsuccess = () => { value = request.result; };
      return { get result() { return value; } };
    });
  }

  async put(kind, record) {
    return access([kind], 'readwrite', transaction => transaction.objectStore(kind).put(record));
  }

  async delete(kind, id) {
    return access([kind], 'readwrite', transaction => transaction.objectStore(kind).delete(id));
  }

  async list(kind) {
    let value = [];
    return access([kind], 'readonly', transaction => {
      const request = transaction.objectStore(kind).getAll();
      request.onsuccess = () => { value = request.result ?? []; };
      return { get result() { return value; } };
    });
  }

  async listCommits(repoId) {
    let value = [];
    return access(['commits'], 'readonly', transaction => {
      const request = transaction.objectStore('commits').index('repoId').getAll(repoId);
      request.onsuccess = () => { value = request.result ?? []; };
      return { get result() { return value; } };
    });
  }

  async clear() {
    return access(['repos', 'commits', 'trees', 'blobs'], 'readwrite', transaction => {
      for (const name of ['repos', 'commits', 'trees', 'blobs']) transaction.objectStore(name).clear();
    });
  }
}

function openLegacyVersionDatabase() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    let missing = false;
    const request = indexedDB.open(DATABASE);
    request.onupgradeneeded = () => { missing = true; request.transaction.abort(); };
    request.onsuccess = () => {
      if (missing) { request.result.close(); resolve(null); }
      else resolve(request.result);
    };
    request.onerror = () => missing ? resolve(null) : reject(request.error);
    request.onblocked = () => reject(new Error(t('version-store.sab69e75')));
  });
}

function readLegacyVersionData(database) {
  const names = Object.keys(NATIVE_KINDS);
  if (!names.every(name => database.objectStoreNames.contains(name))) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(names, 'readonly'), result = {};
    for (const name of names) {
      const request = transaction.objectStore(name).getAll();
      request.onsuccess = () => { result[name] = request.result ?? []; };
    }
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
  });
}

function markNativeVersionMigration() {
  try { globalThis.localStorage?.setItem(NATIVE_MIGRATION_KEY, '1'); } catch {}
}

async function migrateLegacyVersionData() {
  if (!nativeStorage || typeof indexedDB === 'undefined') return;
  try { if (globalThis.localStorage?.getItem(NATIVE_MIGRATION_KEY) === '1') return; } catch {}
  const database = await openLegacyVersionDatabase();
  if (!database) { markNativeVersionMigration(); return; }
  try {
    const data = await readLegacyVersionData(database);
    if (!data) { markNativeVersionMigration(); return; }
    for (const [kind, records] of Object.entries(data)) {
      for (const record of records) {
        if (record?.id) await nativeWrite(NATIVE_KINDS[kind], record.id, record, { migration: true });
      }
    }
    markNativeVersionMigration();
  } finally { database.close(); }
}

class NativeVersionStore {
  ephemeral = false;

  constructor() {
    this.readyPromise = (async () => {
      await nativeReady();
      try { await migrateLegacyVersionData(); }
      catch (error) { this.migrationError = error; }
    })();
  }

  async ready() { return this.readyPromise; }

  async get(kind, id) {
    await this.ready();
    return nativeRead(NATIVE_KINDS[kind], id);
  }

  async put(kind, record) {
    await this.ready();
    return nativeWrite(NATIVE_KINDS[kind], record.id, record);
  }

  async delete(kind, id) {
    await this.ready();
    return nativeStorage.call('remove', NATIVE_KINDS[kind], id);
  }

  async list(kind) {
    await this.ready();
    const nativeKind = NATIVE_KINDS[kind];
    const summaries = await nativeStorage.call('list', nativeKind, false);
    const records = [];
    for (const summary of summaries) {
      const record = await nativeRead(nativeKind, summary.data.id);
      if (record) records.push(record);
    }
    return records;
  }

  async listCommits(repoId) {
    return (await this.list('commits')).filter(commit => commit.repoId === repoId);
  }

  async clear() {
    for (const kind of Object.keys(NATIVE_KINDS)) {
      for (const record of await this.list(kind)) await this.delete(kind, record.id);
    }
  }
}

export function createMemoryVersionStore() {
  const data = { repos: new Map(), commits: new Map(), trees: new Map(), blobs: new Map() };
  const copy = record => record === undefined ? undefined : structuredClone(record);
  return {
    ephemeral: true,
    async get(kind, id) { return copy(data[kind].get(id)); },
    async put(kind, record) { data[kind].set(record.id, copy(record)); },
    async delete(kind, id) { data[kind].delete(id); },
    async list(kind) { return [...data[kind].values()].map(copy); },
    async listCommits(repoId) { return [...data.commits.values()].filter(commit => commit.repoId === repoId).map(copy); },
    async clear() { for (const store of Object.values(data)) store.clear(); },
    data
  };
}

let sharedStore;

export function openVersionStore() {
  if (sharedStore) return sharedStore;
  if (nativeStorage) sharedStore = new NativeVersionStore();
  else sharedStore = typeof indexedDB === 'undefined' ? createMemoryVersionStore() : new IndexedVersionStore();
  return sharedStore;
}
