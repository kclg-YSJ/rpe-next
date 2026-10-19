import type { ArchiveEntries } from './archive.ts';
import type { Chart } from '../core/types.ts';
import { transferSnapshot } from './recovery-transfer.ts';
import { openDatabase, ensureStore } from './storage.ts';
import { nativeStorage, nativeReady, nativeWrite, nativeRead, nativeAssetBytes } from './native.ts';

// Autosave storage. Drafts hold a full snapshot of the document plus its assets so a crashed tab can
// be restored, while a separate `summaries` store keeps just the fields the recovery list needs.
// That split keeps the list cheap to load without deserialising every snapshot's assets.

/** A saved autosave snapshot. */
export interface Draft {
  id: string;
  projectId?: string;
  name: string;
  chart: Chart;
  assets?: ArchiveEntries | [string, Uint8Array][];
  /** Scroll position and selection, restored alongside the document. */
  viewState?: Record<string, unknown>;
  updated: number;
}

/** The lightweight index entry for a draft. */
export interface DraftSummary {
  id: string;
  projectId?: string;
  name: string;
  title: string;
  updated: number;
}

function database(): Promise<IDBDatabase> {
  return openDatabase('rpe-next-recovery', 2, (connection, transaction, oldVersion) => {
    const drafts = ensureStore(connection, transaction!, 'drafts', { keyPath: 'id' });
    const summaries = ensureStore(connection, transaction!, 'summaries', { keyPath: 'id' });
    if (!summaries.indexNames.contains('projectId')) summaries.createIndex('projectId', 'projectId');
    // Upgrading from v1 keeps existing drafts; the summaries index is rebuilt from them because
    // v1 had no summaries store, so the cursor backfills every draft already on disk.
    if (oldVersion >= 2) return;
    const cursor = drafts.openCursor();
    cursor.onsuccess = () => { if (cursor.result) { summaries.put(summary(cursor.result.value as Draft)); cursor.result.continue(); } };
  });
}

function summary(draft: Draft): DraftSummary {
  return { id: draft.id, projectId: draft.projectId, name: draft.name, title: draft.chart.META.name ?? draft.name, updated: draft.updated };
}

/** A request-like value whose `result` is settled when the transaction completes. */
interface RequestResult<T> { result: T }

async function transaction<T>(stores: string[], mode: IDBTransactionMode, action: (operation: IDBTransaction) => RequestResult<T>): Promise<T> {
  const connection = await database();
  return new Promise<T>((resolve, reject) => {
    const operation = connection.transaction(stores, mode, mode === 'readwrite' ? { durability: 'strict' } : undefined);
    let request: RequestResult<T>;
    try { request = action(operation); } catch (error) { operation.abort(); connection.close(); reject(error); return; }
    operation.oncomplete = () => { connection.close(); resolve(request.result); };
    operation.onerror = () => { connection.close(); reject(operation.error); };
    operation.onabort = () => { connection.close(); reject(operation.error ?? new Error('恢复存储已中止')); };
  });
}

export function saveDraft(id: string, name: string, chart: Chart): Promise<unknown> {
  const draft: Draft = { id, name, chart, updated: Date.now() };
  if (nativeStorage) return nativeReady().then(() => nativeWrite('drafts', id, draft));
  return transaction(['drafts', 'summaries'], 'readwrite', operation => {
    operation.objectStore('summaries').put(summary(draft));
    return operation.objectStore('drafts').put(draft);
  });
}

/**
 * Writes a snapshot and prunes older ones for the same project.
 *
 * The write is handed to a worker so a large snapshot's serialisation does not stall the editor;
 * `saveSnapshotDirect` is the same work inline, used where workers are unavailable and as the
 * worker's own entry point. The oldest snapshots are deleted in the same transaction as the new
 * write, so the retention limit can never be exceeded even if the write is interrupted. `limit - 1`
 * is removed because the snapshot being added counts toward the limit.
 */
export function saveSnapshot(projectId: string | undefined, name: string, chart: Chart, assets: ArchiveEntries | [string, Uint8Array][] | undefined, limit = 10, viewState: Record<string, unknown> = {}): Promise<void> {
  if (nativeStorage) { const id = crypto.randomUUID(); return nativeReady().then(() => nativeWrite('drafts', id, { id, projectId, name, chart, assets, viewState, updated: Date.now() }, { limit })).then(() => undefined); }
  if (typeof Worker === 'undefined') return saveSnapshotDirect(projectId, name, chart, assets, limit, viewState);
  try {
    const worker = new Worker(new URL('./recovery-worker.ts', import.meta.url), { type: 'module' });
    return transferSnapshot(worker, [projectId, name, chart, assets ? [...assets] : [], limit, viewState]).then(() => undefined);
  } catch (error) { return Promise.reject(error); }
}

export async function saveSnapshotDirect(projectId: string | undefined, name: string, chart: Chart, assets: ArchiveEntries | [string, Uint8Array][] | undefined, limit = 10, viewState: Record<string, unknown> = {}): Promise<void> {
  if (nativeStorage) return saveSnapshot(projectId, name, chart, assets, limit, viewState);
  const connection = await database();
  return new Promise<void>((resolve, reject) => {
    const operation = connection.transaction(['drafts', 'summaries'], 'readwrite', { durability: 'strict' }); const store = operation.objectStore('drafts');
    const summaries = operation.objectStore('summaries');
    const request = summaries.index('projectId').getAll(projectId) as IDBRequest<DraftSummary[]>;
    request.onsuccess = () => {
      const previous = request.result.sort((left, right) => right.updated - left.updated);
      for (const draft of previous.slice(Math.max(0, limit - 1))) { store.delete(draft.id); summaries.delete(draft.id); }
      const draft: Draft = { id: crypto.randomUUID(), projectId, name, chart, assets, viewState, updated: Date.now() };
      store.put(draft); summaries.put(summary(draft));
    };
    operation.oncomplete = () => { connection.close(); resolve(); };
    operation.onabort = operation.onerror = () => { connection.close(); reject(operation.error ?? new Error('恢复备份写入已中止')); };
  });
}

/** Lists draft summaries, newest first, optionally limited to one project. */
export async function listDrafts(projectId: string | null = null): Promise<DraftSummary[]> {
  if (nativeStorage) { await nativeReady(); return nativeStorage.call<DraftSummary[]>('listDrafts', projectId); }
  const drafts = await transaction<DraftSummary[]>(['summaries'], 'readonly', operation => (projectId == null
    ? operation.objectStore('summaries').getAll()
    : operation.objectStore('summaries').index('projectId').getAll(projectId)) as IDBRequest<DraftSummary[]>);
  return drafts.sort((left, right) => right.updated - left.updated);
}

export const readDraft = async (id: string): Promise<Draft | undefined> => {
  if (!nativeStorage) return transaction<Draft>(['drafts'], 'readonly', operation => operation.objectStore('drafts').get(id) as IDBRequest<Draft>);
  const draft = await nativeRead<Draft>('drafts', id);
  if (draft?.assets) { const assets = draft.assets as unknown as [string, Uint8Array | Blob][]; draft.assets = await Promise.all(assets.map(async ([name, value]) => [name, await nativeAssetBytes(value) as Uint8Array])) as [string, Uint8Array][]; }
  return draft ?? undefined;
};

export const deleteDraft = async (id: string): Promise<unknown> => {
  if (nativeStorage) { await nativeReady(); return nativeStorage.call('remove', 'drafts', id); }
  return transaction<undefined>(['drafts', 'summaries'], 'readwrite', operation => {
    operation.objectStore('summaries').delete(id); return operation.objectStore('drafts').delete(id);
  });
};

export async function deleteProjectDrafts(projectId: string): Promise<number | void> {
  const drafts = await listDrafts(projectId);
  if (!drafts.length) return;
  if (nativeStorage) { for (const draft of drafts) await deleteDraft(draft.id); return; }
  return transaction<number>(['drafts', 'summaries'], 'readwrite', operation => {
    for (const draft of drafts) { operation.objectStore('summaries').delete(draft.id); operation.objectStore('drafts').delete(draft.id); }
    return { result: drafts.length };
  });
}
