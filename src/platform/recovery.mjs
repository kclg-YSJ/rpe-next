import { transferSnapshot } from './recovery-transfer.mjs';
import { openDatabase, ensureStore } from './storage.mjs';
import { nativeStorage, nativeReady, nativeWrite, nativeRead, nativeAssetBytes } from './native.mjs';
import { t } from '../i18n.mjs';

function database() {
  return openDatabase('rpe-next-recovery', 2, (connection, transaction, oldVersion) => {
    const drafts = ensureStore(connection, transaction, 'drafts', { keyPath: 'id' });
    const summaries = ensureStore(connection, transaction, 'summaries', { keyPath: 'id' });
    if (!summaries.indexNames.contains('projectId')) summaries.createIndex('projectId', 'projectId');
    if (oldVersion >= 2) return;
    const cursor = drafts.openCursor();
    cursor.onsuccess = () => { if (cursor.result) { summaries.put(summary(cursor.result.value)); cursor.result.continue(); } };
  });
}

function summary(draft) {
  return { id: draft.id, projectId: draft.projectId, name: draft.name, title: draft.chart.META.name ?? draft.name, updated: draft.updated };
}

async function transaction(stores, mode, action) {
  const connection = await database();
  return new Promise((resolve, reject) => {
    const operation = connection.transaction(stores, mode, mode === 'readwrite' ? { durability: 'strict' } : undefined);
    let request;
    try { request = action(operation); } catch (error) { operation.abort(); connection.close(); reject(error); return; }
    operation.oncomplete = () => { connection.close(); resolve(request.result); };
    operation.onerror = () => { connection.close(); reject(operation.error); };
    operation.onabort = () => { connection.close(); reject(operation.error ?? new Error(t('recovery.s1f4b4f2'))); };
  });
}

export function saveDraft(id, name, chart) {
  const draft = { id, name, chart, updated: Date.now() };
  if (nativeStorage) return nativeReady().then(() => nativeWrite('drafts', id, draft));
  return transaction(['drafts', 'summaries'], 'readwrite', operation => {
    operation.objectStore('summaries').put(summary(draft));
    return operation.objectStore('drafts').put(draft);
  });
}

export function saveSnapshot(projectId, name, chart, assets, limit = 10, viewState = {}) {
  if (nativeStorage) { const id = crypto.randomUUID(); return nativeReady().then(() => nativeWrite('drafts', id, { id, projectId, name, chart, assets, viewState, updated: Date.now() }, { limit })); }
  if (typeof Worker === 'undefined') return saveSnapshotDirect(projectId, name, chart, assets, limit, viewState);
  try {
    const worker = new Worker(new URL('./recovery-worker.mjs', import.meta.url), { type: 'module' });
    return transferSnapshot(worker, [projectId, name, chart, assets, limit, viewState]);
  } catch (error) { return Promise.reject(error); }
}

export async function saveSnapshotDirect(projectId, name, chart, assets, limit = 10, viewState = {}) {
  if (nativeStorage) return saveSnapshot(projectId, name, chart, assets, limit, viewState);
  const connection = await database();
  return new Promise((resolve, reject) => {
    const operation = connection.transaction(['drafts', 'summaries'], 'readwrite', { durability: 'strict' }); const store = operation.objectStore('drafts');
    const summaries = operation.objectStore('summaries');
    const request = summaries.index('projectId').getAll(projectId);
    request.onsuccess = () => {
      const previous = request.result.sort((left, right) => right.updated - left.updated);
      for (const draft of previous.slice(Math.max(0, limit - 1))) { store.delete(draft.id); summaries.delete(draft.id); }
      const draft = { id: crypto.randomUUID(), projectId, name, chart, assets, viewState, updated: Date.now() };
      store.put(draft); summaries.put(summary(draft));
    };
    operation.oncomplete = () => { connection.close(); resolve(); };
    operation.onabort = operation.onerror = () => { connection.close(); reject(operation.error ?? new Error(t('recovery.s4483306'))); };
  });
}

export async function listDrafts(projectId = null) {
  if (nativeStorage) { await nativeReady(); return nativeStorage.call('listDrafts', projectId); }
  const drafts = await transaction(['summaries'], 'readonly', operation => projectId == null
    ? operation.objectStore('summaries').getAll()
    : operation.objectStore('summaries').index('projectId').getAll(projectId));
  return drafts.sort((left, right) => right.updated - left.updated);
}

export const readDraft = async id => {
  if (!nativeStorage) return transaction(['drafts'], 'readonly', operation => operation.objectStore('drafts').get(id));
  const draft = await nativeRead('drafts', id);
  if (draft?.assets) draft.assets = await Promise.all(draft.assets.map(async ([name, value]) => [name, await nativeAssetBytes(value)]));
  return draft;
};
export const deleteDraft = async id => { if (nativeStorage) { await nativeReady(); return nativeStorage.call('remove', 'drafts', id); } return transaction(['drafts', 'summaries'], 'readwrite', operation => {
  operation.objectStore('summaries').delete(id); return operation.objectStore('drafts').delete(id);
}); };
export async function deleteProjectDrafts(projectId) {
  const drafts = await listDrafts(projectId);
  if (!drafts.length) return;
  if (nativeStorage) { for (const draft of drafts) await deleteDraft(draft.id); return; }
  return transaction(['drafts', 'summaries'], 'readwrite', operation => {
    for (const draft of drafts) { operation.objectStore('summaries').delete(draft.id); operation.objectStore('drafts').delete(draft.id); }
    return { result: drafts.length };
  });
}
