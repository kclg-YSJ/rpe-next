import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { storageError, storageFailure, storageStatus, requestPersistence } from '../src/platform/storage.ts';
import type { StorageErrorData } from '../src/platform/storage.ts';
import { ManualSaveQueue } from '../src/application/manual-save.ts';
import { transferProject, applySnapshotPart } from '../src/platform/recovery-transfer.ts';
import type { TransferWorker } from '../src/platform/recovery-transfer.ts';
import { createChart } from '../src/core/chart.ts';
import { openFiles } from '../src/platform/files.ts';
import { readZip, writeZip, writeBlobZip, inspectZip, crc32 } from '../src/platform/archive.ts';

test('持久化申请区分不支持、拒绝、已有保护；用量保留未知状态', async () => {
  assert.equal(await requestPersistence({} as StorageManager), null);
  let requests = 0;
  const manager = { persisted: async () => true, persist: async () => { requests++; return false; }, estimate: async () => ({ usage: 123, quota: 456 }) } as unknown as StorageManager;
  assert.equal(await requestPersistence(manager), true); assert.equal(requests, 0);
  assert.deepEqual(await storageStatus(manager), { supported: true, persistent: true, usage: 123, quota: 456 });
  manager.persisted = async () => false; assert.equal(await requestPersistence(manager), false); assert.equal(requests, 1);
});

test('存储错误跨线程保留类型及冲突版本，配额提示指导导出且不误判其他错误', () => {
  const error = storageError({ name: 'ProjectConflictError', message: 'changed', projectId: 'id', actualRevision: 'new', expectedRevision: 'old' } as unknown as StorageErrorData);
  assert.equal(error.name, 'ProjectConflictError'); assert.equal(error.actualRevision, 'new');
  assert.match(storageFailure(storageError({ name: 'QuotaExceededError', message: 'full' })), /导出.*空间/);
  assert.equal(storageFailure(error), 'changed'); assert.match(storageFailure({ name: 'VersionError' }), /更新/);
});

test('手动保存途中再保存会写入新快照，沿用首个项目标识及最新版本且失败不标记成功', async () => {
  interface SaveProject { id: string; chart: { value: number }; storageRevision: string | null }
  let document = { value: 1 }, finish!: () => void;
  const completed: number[] = [], writes: SaveProject[] = [];
  const queue = new ManualSaveQueue<SaveProject>(async project => {
    writes.push({ ...project });
    if (writes.length === 1) await new Promise<void>(resolve => { finish = resolve; });
    project.storageRevision = 'rev-' + writes.length;
  }, callback => queueMicrotask(callback));
  const owner = {}, capture = (): { document: { value: number }; project: SaveProject } =>
    ({ document, project: { id: 'new-' + document.value, chart: document, storageRevision: null } });
  const saving = queue.save(owner, capture, snapshot => completed.push(snapshot.document.value));
  await new Promise(resolve => setImmediate(resolve)); document = { value: 2 };
  assert.equal(queue.save(owner, capture, snapshot => completed.push(snapshot.document.value)), saving);
  finish(); await saving;
  assert.deepEqual(completed, [1, 2]); assert.equal(writes[1]!.chart.value, 2); assert.equal(writes[1]!.id, writes[0]!.id); assert.equal(writes[1]!.storageRevision, 'rev-1');
});

test('谱面库分批传送完整数据、未知字段和素材，不转移原缓冲区并保留后台错误类型', async () => {
  const chart = createChart(); (chart as unknown as Record<string, unknown>)['x-extra'] = { rows: Array.from({ length: 1000 }, (_, index) => ({ index, points: [{ x: index }] })) };
  const bytes = new Uint8Array(3 * 1024 ** 2 + 1); bytes[bytes.length - 1] = 77;
  interface SnapshotMessage { kind: string; bytes?: Uint8Array; project?: { custom?: string; chart?: unknown; assets?: unknown } }
  const messages: SnapshotMessage[] = []; let restored: unknown, terminated = false;
  const worker: TransferWorker = {
    onmessage: null, onerror: null, onmessageerror: null,
    postMessage(value, transfer) {
      const data = structuredClone(value, { transfer: transfer ?? [] });
      messages.push(data as SnapshotMessage);
      if (data.kind === 'chart') restored = applySnapshotPart(restored, data.part);
      queueMicrotask(() => this.onmessage?.({ data: { ok: true, result: data.kind === 'commit' ? 'revision' : undefined } } as MessageEvent));
    },
    terminate() { terminated = true; },
  };
  const saving = transferProject(worker, { id: 'id', chart, assets: [['music.ogg', bytes]], custom: 'kept' } as unknown as Parameters<typeof transferProject>[1]);
  queueMicrotask(() => worker.onmessage?.({ data: { ready: true } } as MessageEvent));
  assert.equal(await saving, 'revision'); assert.equal(terminated, true); assert.deepEqual(restored, chart); assert.equal(bytes.at(-1), 77);
  assert.equal(messages.filter(message => message.kind === 'asset').length, 4); assert.ok(messages.filter(message => message.kind === 'asset').every(message => (message.bytes?.length ?? 0) <= 1024 ** 2));
  assert.equal(messages[0]?.project?.custom, 'kept'); assert.equal(messages[0]?.project?.chart, undefined); assert.equal(messages[0]?.project?.assets, undefined);
  const failing: TransferWorker = {
    onmessage: null, onerror: null, onmessageerror: null,
    postMessage() { queueMicrotask(() => this.onmessage?.({ data: { ok: false, name: 'QuotaExceededError', message: 'disk full' } } as MessageEvent)); },
    terminate() {},
  };
  const fail = transferProject(failing, { chart, assets: [] });
  queueMicrotask(() => failing.onmessage?.({ data: { ready: true } } as MessageEvent));
  await assert.rejects(fail, { name: 'QuotaExceededError' });
});

test('Blob 谱面库备份可完整解压，嵌套 PEZ 素材和 CRC 均可还原', async () => {
  const pez = writeZip(new Map([['chart.json', new TextEncoder().encode(JSON.stringify(createChart()))], ['music.ogg', new Uint8Array([0, 1, 2])]]));
  const archive = await writeBlobZip(new Map<string, Uint8Array | Blob>([['0001-test.pez', pez], ['library-backup.json', new TextEncoder().encode('{"version":1}')]]));
  const files = await readZip(await archive.arrayBuffer()), inner = await readZip(files.get('0001-test.pez')!);
  assert.deepEqual(inner.get('music.ogg'), new Uint8Array([0, 1, 2])); assert.equal(inspectZip(await archive.arrayBuffer()).count, 2);
});

test('大谱面包先确认再解压，拒绝不会调用解压器，虚假小尺寸仍被拒绝', async () => {
  const plain = new TextEncoder().encode(JSON.stringify(createChart())), compressed = new Uint8Array(deflateRawSync(plain));
  const buffer = await writeZip(new Map([['chart.json', compressed]])).arrayBuffer(), view = new DataView(buffer), directory = view.getUint32(buffer.byteLength - 6, true);
  view.setUint16(8, 8, true); view.setUint16(directory + 10, 8, true); view.setUint32(14, crc32(plain), true); view.setUint32(directory + 16, crc32(plain), true);
  for (const offset of [22, directory + 24]) view.setUint32(offset, 600 * 1024 ** 2, true);
  const file = new File([buffer], 'large.pez'); let confirmations = 0;
  await assert.rejects(openFiles([file]), { name: 'ArchiveLimitError' });
  await assert.rejects(openFiles([file], { confirmLargeArchive: info => { confirmations++; assert.equal(info.largestFile, 600 * 1024 ** 2); return false; } }), { name: 'ArchiveLimitError' });
  assert.equal(confirmations, 1);
  for (const offset of [22, directory + 24]) view.setUint32(offset, plain.length, true);
  assert.equal((await openFiles([new File([buffer], 'normal.pez')]))!.candidates.length, 1);
  for (const offset of [22, directory + 24]) view.setUint32(offset, 2, true);
  await assert.rejects(readZip(buffer), /大小与目录不一致/);
});
