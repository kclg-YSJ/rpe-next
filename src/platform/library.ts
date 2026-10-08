import { projectThumbnail } from './thumbnail.ts';
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
}

/** The denormalized record the chart library lists, kept in step with its project. */
export interface ProjectSummary {
  version: number;
  id: string;
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

/** The object stores this module owns. */
type StoreName = 'projects' | 'summaries' | 'preferences';

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('rpe-next-library', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('projects', { keyPath: 'id' });
      request.result.createObjectStore('summaries', { keyPath: 'id' });
      request.result.createObjectStore('preferences');
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

/**
 * Runs `action` inside one transaction and settles on its completion.
 *
 * IndexedDB reports success per-request but commits per-transaction, so the connection is only
 * released once the whole transaction finishes; resolving early would let a later read observe a
 * half-applied write.
 */
async function access<T>(stores: StoreName[], mode: IDBTransactionMode, action: (transaction: IDBTransaction) => IDBRequest<T> | undefined): Promise<T | undefined> {
  const connection = await database();
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

/** The reply the background worker posts back once it has written (or failed to write) a project. */
interface WorkerReply {
  ok: boolean;
  message?: string;
}

/**
 * The in-flight write chain per project id.
 *
 * Saves of the same document must not overlap, so each entry is the tail promise of that project's
 * chain and the entry is dropped once the chain drains.
 */
const projectWrites = new Map<string, Promise<void>>();

/**
 * Saves a project, queued behind any write already in flight for the same project.
 *
 * A rejected predecessor is swallowed rather than chained, so one failed save does not fail every
 * later save of the same project; the returned promise still reports this save's own outcome.
 */
export function storeProject(project: StoredProject): Promise<void> {
  const previous: Promise<void> = projectWrites.get(project.id) ?? Promise.resolve();
  const operation: Promise<void> = previous.catch(() => {}).then(() => writeProject(project));
  projectWrites.set(project.id, operation);
  const release = (): void => { if (projectWrites.get(project.id) === operation) projectWrites.delete(project.id); };
  operation.then(release, release);
  return operation;
}

/** Runs the save in a worker when the platform has one, and on this thread when it does not. */
async function writeProject(project: StoredProject): Promise<void> {
  if (typeof Worker === 'undefined') return storeProjectDirect(project);
  return new Promise<void>((resolve, reject) => {
    const worker = new Worker(new URL('./library-worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<WorkerReply>) => { worker.terminate(); event.data.ok ? resolve() : reject(new Error(event.data.message)); };
    worker.onerror = event => { worker.terminate(); reject(new Error(event.message || '后台保存失败，请重试')); };
    worker.onmessageerror = () => { worker.terminate(); reject(new Error('后台保存数据无法读取')); };
    try { worker.postMessage(project); }
    catch (error) { worker.terminate(); reject(error); }
  });
}

/** Saves a project and refreshes its summary, rendering a new thumbnail on the way. */
export async function storeProjectDirect(project: StoredProject): Promise<void> {
  const thumbnail = await projectThumbnail(project);
  await access(['projects', 'summaries'], 'readwrite', transaction => {
    transaction.objectStore('projects').put(project);
    return transaction.objectStore('summaries').put(projectSummary(project, thumbnail)) as IDBRequest<unknown> as IDBRequest<void>;
  });
}

/** Derives the listable summary from a project and its freshly rendered thumbnail. */
export function projectSummary(project: StoredProject, thumbnail: Blob | null): ProjectSummary {
  return { version: 2, id: project.id, name: project.chart.META.name ?? project.chartName,
      chartName: project.chartName, identifier: project.identifier ?? project.info?.Path ?? (project.chart?.META?.id as string | undefined) ?? '', source: project.source, imported: project.imported, bytes: project.bytes,
      updated: project.updated ?? project.imported, group: project.group ?? project.info?.Group ?? '未分组',
      pinned: Boolean(project.pinned), archived: Boolean(project.archived), level: project.chart.META.level ?? '', charter: project.chart.META.charter ?? '',
      thumbnail, composer: project.chart.META.composer ?? '', lines: project.chart.judgeLineList?.length ?? 0,
      notes: (project.chart.judgeLineList ?? []).reduce((sum, line) => sum + (line.notes?.length ?? 0), 0) };
}

export const updateSummary = (summary: ProjectSummary): Promise<unknown> => access(['summaries'], 'readwrite', transaction => transaction.objectStore('summaries').put(summary) as IDBRequest<unknown>);
export const listProjects = (): Promise<ProjectSummary[] | undefined> => access<ProjectSummary[]>(['summaries'], 'readonly', transaction => transaction.objectStore('summaries').getAll());
export const readProject = (id: string): Promise<StoredProject | undefined> => access<StoredProject>(['projects'], 'readonly', transaction => transaction.objectStore('projects').get(id));
export const readPreferences = (): Promise<unknown> => access(['preferences'], 'readonly', transaction => transaction.objectStore('preferences').get('current'));
export const storePreferences = (preferences: unknown): Promise<unknown> => access(['preferences'], 'readwrite', transaction => transaction.objectStore('preferences').put(preferences, 'current'));
export const readClipboardHistory = (): Promise<unknown> => access(['preferences'], 'readonly', transaction => transaction.objectStore('preferences').get('clipboard-history'));
export const storeClipboardHistory = (entries: unknown): Promise<unknown> => access(['preferences'], 'readwrite', transaction => transaction.objectStore('preferences').put(entries, 'clipboard-history'));
