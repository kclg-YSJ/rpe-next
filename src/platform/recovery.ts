import type { ArchiveEntries } from './archive.ts';
import type { Chart } from '../core/types.ts';

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
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('rpe-next-recovery', 2);
    request.onupgradeneeded = () => {
      const connection = request.result;
      // Upgrading from v1 keeps existing drafts; the summaries index is rebuilt from them because
      // v1 had no summaries store, so the cursor backfills every draft already on disk.
      const drafts = connection.objectStoreNames.contains('drafts') ? request.transaction!.objectStore('drafts') : connection.createObjectStore('drafts', { keyPath: 'id' });
      const summaries = connection.createObjectStore('summaries', { keyPath: 'id' });
      summaries.createIndex('projectId', 'projectId');
      const cursor = drafts.openCursor();
      cursor.onsuccess = () => { if (cursor.result) { summaries.put(summary(cursor.result.value as Draft)); cursor.result.continue(); } };
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function summary(draft: Draft): DraftSummary {
  return { id: draft.id, projectId: draft.projectId, name: draft.name, title: draft.chart.META.name ?? draft.name, updated: draft.updated };
}

async function transaction<T>(stores: string[], mode: IDBTransactionMode, action: (operation: IDBTransaction) => IDBRequest<T>): Promise<T> {
  const connection = await database();
  return new Promise<T>((resolve, reject) => {
    const operation = connection.transaction(stores, mode);
    const request = action(operation);
    operation.oncomplete = () => { connection.close(); resolve(request.result); };
    operation.onerror = () => { connection.close(); reject(operation.error); };
    operation.onabort = () => { connection.close(); reject(operation.error ?? new Error('恢复存储已中止')); };
  });
}

export function saveDraft(id: string, name: string, chart: Chart): Promise<unknown> {
  const draft: Draft = { id, name, chart, updated: Date.now() };
  return transaction(['drafts', 'summaries'], 'readwrite', operation => {
    operation.objectStore('summaries').put(summary(draft));
    return operation.objectStore('drafts').put(draft) as IDBRequest<unknown>;
  });
}

/**
 * Writes a snapshot and prunes older ones for the same project.
 *
 * The oldest snapshots are deleted in the same transaction as the new write, so the retention limit
 * can never be exceeded even if the write is interrupted. `limit - 1` is removed because the
 * snapshot being added counts toward the limit.
 */
export async function saveSnapshot(projectId: string | undefined, name: string, chart: Chart, assets: ArchiveEntries | undefined, limit = 10, viewState: Record<string, unknown> = {}): Promise<void> {
  const connection = await database();
  return new Promise<void>((resolve, reject) => {
    const operation = connection.transaction(['drafts', 'summaries'], 'readwrite'); const store = operation.objectStore('drafts');
    const summaries = operation.objectStore('summaries');
    const request = summaries.index('projectId').getAll(projectId) as IDBRequest<DraftSummary[]>;
    request.onsuccess = () => {
      const previous = request.result.sort((left, right) => right.updated - left.updated);
      for (const draft of previous.slice(Math.max(0, limit - 1))) { store.delete(draft.id); summaries.delete(draft.id); }
      const draft: Draft = { id: crypto.randomUUID(), projectId, name, chart, assets, viewState, updated: Date.now() };
      store.put(draft); summaries.put(summary(draft));
    };
    operation.oncomplete = () => { connection.close(); resolve(); };
    operation.onabort = operation.onerror = () => { connection.close(); reject(operation.error); };
  });
}

/** Lists draft summaries, newest first, optionally limited to one project. */
export async function listDrafts(projectId: string | null = null): Promise<DraftSummary[]> {
  const drafts = await transaction<DraftSummary[]>(['summaries'], 'readonly', operation => (projectId == null
    ? operation.objectStore('summaries').getAll()
    : operation.objectStore('summaries').index('projectId').getAll(projectId)) as IDBRequest<DraftSummary[]>);
  return drafts.sort((left, right) => right.updated - left.updated);
}

export const readDraft = (id: string): Promise<Draft | undefined> => transaction<Draft>(['drafts'], 'readonly', operation => operation.objectStore('drafts').get(id) as IDBRequest<Draft>);
