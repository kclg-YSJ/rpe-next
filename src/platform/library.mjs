import { projectThumbnail } from './thumbnail.mjs';
import { openDatabase, ensureStore, storageError } from './storage.mjs';
import { transferProject } from './recovery-transfer.mjs';
import { assertChart } from '../core/chart.mjs';
import { nativeStorage, nativeReady, nativeWrite, nativeRead, nativeList, nativeAssetBytes } from './native.mjs';
import { t } from '../i18n.mjs';

export const libraryDatabase = () => openDatabase('rpe-next-library', 2, (connection, transaction) => {
  for (const name of ['projects', 'summaries', 'revisions']) ensureStore(connection, transaction, name, { keyPath: 'id' });
  ensureStore(connection, transaction, 'preferences');
});

async function access(stores, mode, action) {
  const connection = await libraryDatabase();
  return new Promise((resolve, reject) => {
    const transaction = connection.transaction(stores, mode, mode === 'readwrite' ? { durability: 'strict' } : undefined);
    let result;
    try { result = action(transaction); }
    catch (error) { transaction.abort(); connection.close(); reject(error); return; }
    transaction.oncomplete = () => { connection.close(); resolve(result?.result); };
    transaction.onerror = () => { connection.close(); reject(transaction.error); };
    transaction.onabort = () => { connection.close(); reject(transaction.error ?? new Error(t('library.secdb1a9'))); };
  });
}

const projectWrites = new Map();
let channel;
function changes() { return channel ??= typeof BroadcastChannel === 'function' ? new BroadcastChannel('rpe-next-library-v2') : null; }
export function subscribeLibrary(callback) {
  const connection = changes(); if (!connection) return () => {};
  const receive = event => callback(event.data);
  connection.addEventListener('message', receive);
  return () => connection.removeEventListener('message', receive);
}
function publish(id, revision, deleted = false) {
  if (typeof document !== 'undefined') { changes()?.postMessage({ id, revision, deleted }); document.dispatchEvent(new Event('rpen-storage-changed')); }
}
export function projectConflict(id, expectedRevision, actualRevision) {
  return storageError({ name: 'ProjectConflictError', projectId: id, expectedRevision, actualRevision,
    message: t('library.sa32940f') });
}

export function storeProject(project) {
  const previous = projectWrites.get(project.id) ?? Promise.resolve();
  const operation = previous.catch(() => {}).then(async () => {
    let revision;
    if (nativeStorage) {
      await nativeReady(); assertChart(project.chart);
      const thumbnail = await projectThumbnail(project);
      revision = (await nativeWrite('projects', project.id, { ...project, thumbnail }, { expectedRevision: project.storageRevision ?? null })).revision;
    } else revision = typeof Worker === 'undefined' ? await storeProjectDirect(project)
      : await transferProject(new Worker(new URL('./library-worker.mjs', import.meta.url), { type: 'module' }), project);
    project.storageRevision = revision; publish(project.id, revision); return project;
  });
  projectWrites.set(project.id, operation);
  const release = () => { if (projectWrites.get(project.id) === operation) projectWrites.delete(project.id); };
  operation.then(release, release);
  return operation;
}

// Compare and write atomically; serializing stale snapshots alone cannot prevent lost updates.
export async function storeProjectDirect(project) {
  if (nativeStorage) return storeProject(project);
  assertChart(project.chart);
  const thumbnail = await projectThumbnail(project), connection = await libraryDatabase();
  return new Promise((resolve, reject) => {
    const transaction = connection.transaction(['projects', 'summaries', 'revisions'], 'readwrite', { durability: 'strict' });
    const versions = transaction.objectStore('revisions'), expected = project.storageRevision ?? null;
    const request = versions.get(project.id); let failure, revision;
    request.onsuccess = () => {
      try {
        const actual = request.result?.revision ?? null;
        if (actual !== expected) throw projectConflict(project.id, expected, actual);
        revision = crypto.randomUUID(); const stored = { ...project, storageRevision: revision };
        transaction.objectStore('projects').put(stored);
        transaction.objectStore('summaries').put(projectSummary(stored, thumbnail));
        versions.put({ id: project.id, revision });
      } catch (error) { failure = error; transaction.abort(); }
    };
    transaction.oncomplete = () => { connection.close(); resolve(revision); };
    transaction.onabort = transaction.onerror = () => { connection.close(); reject(failure ?? transaction.error ?? new Error(t('library.secdb1a9'))); };
  });
}
export async function deleteProject(id, expectedRevision = null) {
  if (nativeStorage) { await nativeReady(); await nativeStorage.call('remove', 'projects', id, expectedRevision); publish(id, null, true); return; }
  const connection = await libraryDatabase();
  await new Promise((resolve, reject) => {
    const transaction = connection.transaction(['projects', 'summaries', 'revisions'], 'readwrite', { durability: 'strict' });
    const versions = transaction.objectStore('revisions'), request = versions.get(id); let failure;
    request.onsuccess = () => {
      const actual = request.result?.revision ?? null;
      if (actual !== expectedRevision) { failure = projectConflict(id, expectedRevision, actual); transaction.abort(); return; }
      transaction.objectStore('projects').delete(id); transaction.objectStore('summaries').delete(id);
      // Tombstones prevent an old window from resurrecting a deleted legacy project.
      versions.put({ id, revision: crypto.randomUUID(), deleted: true });
    };
    transaction.oncomplete = () => { connection.close(); resolve(); };
    transaction.onabort = transaction.onerror = () => { connection.close(); reject(failure ?? transaction.error ?? new Error(t('library.s7840cbe'))); };
  });
  publish(id, null, true);
}
export function projectSummary(project, thumbnail) {
  return { version: 2, id: project.id, storageRevision: project.storageRevision ?? null, name: project.chart.META.name ?? project.chartName,
      chartName: project.chartName, identifier: project.identifier ?? project.info?.Path ?? project.chart?.META?.id ?? '', source: project.source, imported: project.imported, bytes: project.bytes,
      // Empty means "ungrouped"; the name is localized only when displayed.
      updated: project.updated ?? project.imported, group: project.group ?? project.info?.Group ?? '',
      pinned: Boolean(project.pinned), archived: Boolean(project.archived), level: project.chart.META.level ?? '', charter: project.chart.META.charter ?? '',
      thumbnail, composer: project.chart.META.composer ?? '', lines: project.chart.judgeLineList?.length ?? 0,
      notes: (project.chart.judgeLineList ?? []).reduce((sum, line) => sum + (line.notes?.length ?? 0), 0) };
}
export const updateSummary = summary => nativeStorage ? Promise.resolve() : access(['summaries', 'revisions'], 'readwrite', transaction => {
  const request = transaction.objectStore('revisions').get(summary.id);
  request.onsuccess = () => { if ((request.result?.revision ?? null) === (summary.storageRevision ?? null) && !request.result?.deleted) transaction.objectStore('summaries').put(summary); };
});
export const listProjects = () => nativeStorage ? nativeList('projects') : access(['summaries'], 'readonly', transaction => transaction.objectStore('summaries').getAll());
export async function readProject(id) {
  if (nativeStorage) {
    const project = await nativeRead('projects', id);
    if (project?.assets) project.assets = await Promise.all(project.assets.map(async ([name, value]) => [name, await nativeAssetBytes(value)]));
    return project;
  }
  const project = await access(['projects'], 'readonly', transaction => transaction.objectStore('projects').get(id));
  if (project?.assets) {
    const assets = [];
    for (const [name, value] of project.assets) assets.push([name, value instanceof Blob ? new Uint8Array(await value.arrayBuffer()) : value]);
    project.assets = assets;
  }
  return project;
}
export const readProjectRevision = async id => { if (nativeStorage) { await nativeReady(); return nativeStorage.call('readRevision', id); } return access(['revisions'], 'readonly', transaction => transaction.objectStore('revisions').get(id)); };
const readPreference = async key => nativeStorage ? (await nativeRead('preferences', key))?.value : access(['preferences'], 'readonly', transaction => transaction.objectStore('preferences').get(key));
const writePreference = async (key, value) => { if (nativeStorage) { await nativeReady(); return nativeWrite('preferences', key, { id: key, value }); } return access(['preferences'], 'readwrite', transaction => transaction.objectStore('preferences').put(value, key)); };
export const readPreferences = () => readPreference('current');
export const storePreferences = preferences => writePreference('current', preferences);
export const readClipboardHistory = () => readPreference('clipboard-history');
export const storeClipboardHistory = entries => writePreference('clipboard-history', entries);
