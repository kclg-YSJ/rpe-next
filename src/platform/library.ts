import { projectThumbnail } from './thumbnail.ts';
import { openDatabase, ensureStore, storageError } from './storage.ts';
import { transferProject } from './recovery-transfer.ts';
import { assertChart } from '../core/chart.ts';
import { nativeStorage, nativeReady, nativeWrite, nativeRead, nativeList, nativeAssetBytes } from './native.ts';
import type { Chart } from '../core/types.ts';

/**
 * A saved chart project: the document plus every asset that travels with it.
 *
 * `assets` is written straight into IndexedDB as `[name, bytes]` pairs, so the declared type is the
 * serialisable form rather than a live `Map`.
 */
export interface StoredProject {
  id: string;
  chart: Chart;
  chartName: string;
  assets: [string, Uint8Array][];
  /** Key/value pairs from the original RPE `info.txt`, when the project came from one. */
  info?: Record<string, string>;
  identifier?: string;
  source?: string;
  imported?: number;
  updated?: number;
  group?: string;
  pinned?: boolean;
  archived?: boolean;
  bytes?: number;
  /**
   * The folder names the assets were imported from, and the editor scroll position.
   *
   * Both are written by `save()` and read back when a project is reopened, so they are part of the
   * stored record even though the library's own listing never looks at them. They are optional
   * because a record saved by an older build, or a draft the recovery path supplies, carries neither.
   */
  assetFolders?: string[];
  viewState?: { lineIndex?: number };
  /**
   * The revision this record was read at.
   *
   * Writes compare it against the stored revision so two windows cannot silently overwrite each
   * other; `null` means "not read from the library yet", which is the state of a new project.
   */
  storageRevision?: string | null;
}

/** The denormalized record the chart library lists, kept in step with its project. */
export interface ProjectSummary {
  version: number;
  id: string;
  storageRevision: string | null;
  name: string;
  chartName: string;
  identifier: string;
  source?: string;
  imported?: number;
  bytes?: number;
  updated?: number;
  group: string;
  pinned: boolean;
  archived: boolean;
  level: string;
  charter: string;
  thumbnail: Blob | null;
  composer: string;
  lines: number;
  notes: number;
}

/** The revision record that guards a project against concurrent writes. */
export interface ProjectRevision {
  id: string;
  revision: string | null;
  /** Set on the tombstone left behind by {@link deleteProject}. */
  deleted?: boolean;
}

/** A library change broadcast to other windows. */
export interface LibraryChange {
  id: string;
  revision: string | null;
  deleted: boolean;
}

/** The object stores this module owns. */
type StoreName = 'projects' | 'summaries' | 'preferences' | 'revisions';

export const libraryDatabase = (): Promise<IDBDatabase> => openDatabase('rpe-next-library', 2, (connection, transaction) => {
  for (const name of ['projects', 'summaries', 'revisions']) ensureStore(connection, transaction!, name, { keyPath: 'id' });
  ensureStore(connection, transaction!, 'preferences');
});

/**
 * Runs `action` inside one transaction and settles on its completion.
 *
 * IndexedDB reports success per-request but commits per-transaction, so the connection is only
 * released once the whole transaction finishes; resolving early would let a later read observe a
 * half-applied write.
 */
async function access<T>(stores: StoreName[], mode: IDBTransactionMode, action: (transaction: IDBTransaction) => IDBRequest<T> | undefined): Promise<T | undefined> {
  const connection = await libraryDatabase();
  return new Promise<T | undefined>((resolve, reject) => {
    const transaction = connection.transaction(stores, mode, mode === 'readwrite' ? { durability: 'strict' } : undefined);
    let result: IDBRequest<T> | undefined;
    try { result = action(transaction); }
    catch (error) { transaction.abort(); connection.close(); reject(error); return; }
    transaction.oncomplete = () => { connection.close(); resolve(result?.result); };
    transaction.onerror = () => { connection.close(); reject(transaction.error); };
    transaction.onabort = () => { connection.close(); reject(transaction.error ?? new Error('存储事务已取消')); };
  });
}

/**
 * The in-flight write chain per project id.
 *
 * Saves of the same document must not overlap, so each entry is the tail promise of that project's
 * chain and the entry is dropped once the chain drains.
 */
const projectWrites = new Map<string, Promise<StoredProject>>();

let channel: BroadcastChannel | null | undefined;
function changes(): BroadcastChannel | null {
  return channel ??= typeof BroadcastChannel === 'function' ? new BroadcastChannel('rpe-next-library-v2') : null;
}

/** Subscribes to saves and deletions made by other windows; returns the unsubscribe function. */
export function subscribeLibrary(callback: (change: LibraryChange) => void): () => void {
  const connection = changes(); if (!connection) return () => {};
  const receive = (event: MessageEvent<LibraryChange>): void => callback(event.data);
  connection.addEventListener('message', receive);
  return () => connection.removeEventListener('message', receive);
}

function publish(id: string, revision: string | null, deleted = false): void {
  if (typeof document !== 'undefined') { changes()?.postMessage({ id, revision, deleted }); document.dispatchEvent(new Event('rpen-storage-changed')); }
}

/** The typed error a stale write raises, preserving the revisions the caller can report. */
export function projectConflict(id: string, expectedRevision: string | null, actualRevision: string | null): Error {
  return storageError({ name: 'ProjectConflictError', projectId: id, expectedRevision: expectedRevision as unknown as number, actualRevision: actualRevision as unknown as number,
    message: '此项目已被其他窗口修改或删除，已阻止覆盖。当前编辑仍保留，可导出 PEZ 或另存为新项目。' });
}

/**
 * Saves a project, queued behind any write already in flight for the same project.
 *
 * A rejected predecessor is swallowed rather than chained, so one failed save does not fail every
 * later save of the same project; the returned promise still reports this save's own outcome.
 */
export function storeProject(project: StoredProject): Promise<StoredProject> {
  const previous: Promise<StoredProject> = projectWrites.get(project.id) ?? Promise.resolve(project);
  const operation: Promise<StoredProject> = previous.catch(() => {}).then(async () => {
    let revision: string;
    if (nativeStorage) {
      await nativeReady(); assertChart(project.chart);
      const thumbnail = await projectThumbnail(project);
      revision = (await nativeWrite('projects', project.id, { ...project, thumbnail }, { expectedRevision: project.storageRevision ?? null })).revision;
    } else revision = typeof Worker === 'undefined' ? await storeProjectDirect(project) as string
      : await transferProject(new Worker(new URL('./library-worker.ts', import.meta.url), { type: 'module' }), project) as string;
    project.storageRevision = revision; publish(project.id, revision); return project;
  });
  projectWrites.set(project.id, operation);
  const release = (): void => { if (projectWrites.get(project.id) === operation) projectWrites.delete(project.id); };
  operation.then(release, release);
  return operation;
}

// Compare and write atomically; serializing stale snapshots alone cannot prevent lost updates.
export async function storeProjectDirect(project: StoredProject): Promise<string | StoredProject> {
  if (nativeStorage) return storeProject(project);
  assertChart(project.chart);
  const thumbnail = await projectThumbnail(project), connection = await libraryDatabase();
  return new Promise<string>((resolve, reject) => {
    const transaction = connection.transaction(['projects', 'summaries', 'revisions'], 'readwrite', { durability: 'strict' });
    const versions = transaction.objectStore('revisions'), expected = project.storageRevision ?? null;
    const request = versions.get(project.id) as IDBRequest<ProjectRevision | undefined>; let failure: Error | undefined, revision: string | undefined;
    request.onsuccess = () => {
      try {
        const actual = request.result?.revision ?? null;
        if (actual !== expected) throw projectConflict(project.id, expected, actual);
        revision = crypto.randomUUID(); const stored = { ...project, storageRevision: revision };
        transaction.objectStore('projects').put(stored);
        transaction.objectStore('summaries').put(projectSummary(stored, thumbnail));
        versions.put({ id: project.id, revision });
      } catch (error) { failure = error as Error; transaction.abort(); }
    };
    transaction.oncomplete = () => { connection.close(); resolve(revision!); };
    transaction.onabort = transaction.onerror = () => { connection.close(); reject(failure ?? transaction.error ?? new Error('存储事务已取消')); };
  });
}

/** Deletes a project and its summary, leaving a tombstone so an old window cannot resurrect it. */
export async function deleteProject(id: string, expectedRevision: string | null = null): Promise<void> {
  if (nativeStorage) { await nativeReady(); await nativeStorage.call('remove', 'projects', id, expectedRevision); publish(id, null, true); return; }
  const connection = await libraryDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = connection.transaction(['projects', 'summaries', 'revisions'], 'readwrite', { durability: 'strict' });
    const versions = transaction.objectStore('revisions'), request = versions.get(id) as IDBRequest<ProjectRevision | undefined>; let failure: Error | undefined;
    request.onsuccess = () => {
      const actual = request.result?.revision ?? null;
      if (actual !== expectedRevision) { failure = projectConflict(id, expectedRevision, actual); transaction.abort(); return; }
      transaction.objectStore('projects').delete(id); transaction.objectStore('summaries').delete(id);
      // Tombstones prevent an old window from resurrecting a deleted legacy project.
      versions.put({ id, revision: crypto.randomUUID(), deleted: true });
    };
    transaction.oncomplete = () => { connection.close(); resolve(); };
    transaction.onabort = transaction.onerror = () => { connection.close(); reject(failure ?? transaction.error ?? new Error('删除未完成')); };
  });
  publish(id, null, true);
}

/** Derives the listable summary from a project and its freshly rendered thumbnail. */
export function projectSummary(project: StoredProject, thumbnail: Blob | null): ProjectSummary {
  return { version: 2, id: project.id, storageRevision: project.storageRevision ?? null, name: project.chart.META.name ?? project.chartName,
      chartName: project.chartName, identifier: project.identifier ?? project.info?.Path ?? (project.chart?.META?.id as string | undefined) ?? '', source: project.source, imported: project.imported, bytes: project.bytes,
      updated: project.updated ?? project.imported, group: project.group ?? project.info?.Group ?? '未分组',
      pinned: Boolean(project.pinned), archived: Boolean(project.archived), level: project.chart.META.level ?? '', charter: project.chart.META.charter ?? '',
      thumbnail, composer: project.chart.META.composer ?? '', lines: project.chart.judgeLineList?.length ?? 0,
      notes: (project.chart.judgeLineList ?? []).reduce((sum, line) => sum + (line.notes?.length ?? 0), 0) };
}

export const updateSummary = (summary: ProjectSummary): Promise<unknown> => nativeStorage ? Promise.resolve() : access<unknown>(['summaries', 'revisions'], 'readwrite', transaction => {
  const request = transaction.objectStore('revisions').get(summary.id) as IDBRequest<ProjectRevision | undefined>;
  request.onsuccess = () => { if ((request.result?.revision ?? null) === (summary.storageRevision ?? null) && !request.result?.deleted) transaction.objectStore('summaries').put(summary); };
  return undefined;
});

export const listProjects = (): Promise<ProjectSummary[] | undefined> => nativeStorage ? nativeList<ProjectSummary>('projects') : access<ProjectSummary[]>(['summaries'], 'readonly', transaction => transaction.objectStore('summaries').getAll());

export async function readProject(id: string): Promise<StoredProject | undefined> {
  if (nativeStorage) {
    const project = await nativeRead<StoredProject>('projects', id);
    if (project?.assets) {
      const assets = project.assets as unknown as [string, Uint8Array | Blob][];
      project.assets = await Promise.all(assets.map(async ([name, value]) => [name, await nativeAssetBytes(value) as Uint8Array]));
    }
    return project ?? undefined;
  }
  const project = await access<StoredProject>(['projects'], 'readonly', transaction => transaction.objectStore('projects').get(id));
  if (project?.assets) {
    const assets: [string, Uint8Array][] = [];
    for (const [name, value] of project.assets) assets.push([name, value instanceof Blob ? new Uint8Array(await value.arrayBuffer()) : value]);
    project.assets = assets;
  }
  return project;
}

export const readProjectRevision = async (id: string): Promise<ProjectRevision | undefined> => {
  if (nativeStorage) { await nativeReady(); return (await nativeStorage.call<{ id: string; revision: string; deleted: boolean } | null>('readRevision', id)) ?? undefined; }
  return access<ProjectRevision>(['revisions'], 'readonly', transaction => transaction.objectStore('revisions').get(id));
};

const readPreference = async (key: string): Promise<unknown> => nativeStorage ? (await nativeRead<{ value: unknown }>('preferences', key))?.value : access<unknown>(['preferences'], 'readonly', transaction => transaction.objectStore('preferences').get(key));
const writePreference = async (key: string, value: unknown): Promise<unknown> => { if (nativeStorage) { await nativeReady(); return nativeWrite('preferences', key, { id: key, value }); } return access<IDBValidKey>(['preferences'], 'readwrite', transaction => transaction.objectStore('preferences').put(value, key)); };

export const readPreferences = (): Promise<unknown> => readPreference('current');
export const storePreferences = (preferences: unknown): Promise<unknown> => writePreference('current', preferences);
export const readClipboardHistory = (): Promise<unknown> => readPreference('clipboard-history');
export const storeClipboardHistory = (entries: unknown): Promise<unknown> => writePreference('clipboard-history', entries);
