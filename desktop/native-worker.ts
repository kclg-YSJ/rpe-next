import { parentPort, workerData } from 'node:worker_threads';
import { NativeStore } from './native-store.ts';
import type { NativeRecordData } from './native-store.ts';

interface WorkerRequest { id: number; method: string; args?: unknown[] }

type StoreDispatch = Record<string, (...args: unknown[]) => Promise<unknown>>;

const store = await new NativeStore((workerData as { root: string }).root).init();
const dispatch = store as unknown as StoreDispatch;
let queue: Promise<void> = Promise.resolve();
parentPort!.on('message', (message: WorkerRequest) => {
  queue = queue.then(async () => {
    try {
      let result: unknown;
      const { method, args = [] } = message;
      if (method === 'setLocalPreference') {
        const [key, value] = args;
        if (typeof key !== 'string' || key.length > 1024 || value !== null && (typeof value !== 'string' || value.length > 16 * 1024 ** 2)) throw Error('设置值无效');
        const record: NativeRecordData = (await store.read('preferences', 'ui-settings'))?.data ?? { id: 'ui-settings', values: {} };
        const values = record.values ?? (record.values = {});
        if (value === null) delete values[key]; else Object.defineProperty(values, key, { value, writable: true, enumerable: true, configurable: true });
        const token = await store.begin('preferences', 'ui-settings');
        try { store.part(token, { path: [], value: record }); result = await store.commit(token); } catch (error) { await store.abort(token); throw error; }
      } else if (method === 'listDrafts') result = store.list('drafts').map(entry => entry.data).filter(entry => args[0] == null || entry.projectId === args[0]).sort((a, b) => b.updated! - a.updated!);
      else if (method === 'readRevision') { const head = await store.head('projects', args[0] as string); result = head ? { id: head.id, revision: head.revision, deleted: head.deleted } : null; }
      else if (method === 'assetFolder') result = await dispatch[method]!.apply(store, args);
      else if (['begin', 'part', 'parts', 'binaryBegin', 'binaryChunk', 'commit', 'abort', 'blob', 'read', 'list', 'remove', 'restore', 'purge', 'collect', 'status', 'rebuild', 'copyTo', 'migrationDone', 'markMigration', 'projectFolder', 'close'].includes(method)) result = await dispatch[method]!.apply(store, args);
      else throw Error('不支持的存储操作');
      parentPort!.postMessage({ id: message.id, ok: true, result });
    } catch (error) {
      const failure = (error instanceof Error ? error : new Error(String(error))) as Error & { code?: string; projectId?: string; expectedRevision?: string | null; actualRevision?: string | null };
      parentPort!.postMessage({ id: message.id, ok: false, error: { name: failure.code === 'ENOSPC' ? 'QuotaExceededError' : failure.name, message: failure.message, code: failure.code, projectId: failure.projectId, expectedRevision: failure.expectedRevision, actualRevision: failure.actualRevision } });
    }
  });
});
parentPort!.postMessage({ ready: true });
