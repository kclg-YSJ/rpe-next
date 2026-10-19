import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, readdir, utimes, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NativeStore } from '../desktop/native-store.ts';
import type { BinaryRef, CommitResult, NativeEnvelope, NativeRecordData } from '../desktop/native-store.ts';
import { NativeService } from '../desktop/native-service.ts';
import { createChart } from '../src/core/chart.ts';
import { snapshotParts } from '../src/platform/recovery-transfer.ts';
import type { SnapshotBinary } from '../src/platform/recovery-transfer.ts';
import { spawnSync } from 'node:child_process';

interface ProjectData {
  id: string;
  chart: ReturnType<typeof createChart>;
  chartName: string;
  imported: number;
  assets: [string, Uint8Array][];
  unknown: unknown;
  assetFolders?: string[];
  storageRevision?: string;
  [key: string]: unknown;
}

async function write(store: NativeStore, kind: string, data: NativeRecordData, options: Record<string, unknown> = {}): Promise<CommitResult> {
  const token = await store.begin(kind, data.id, options), binaries: SnapshotBinary[] = [];
  try {
    for (const part of snapshotParts(data, [], binaries)) store.part(token, part);
    for (const { path, value } of binaries) {
      const bytes = value instanceof Blob ? new Uint8Array(await value.arrayBuffer()) : value instanceof Uint8Array ? value : new Uint8Array(value as ArrayBuffer);
      const entry = await store.binaryBegin(token, { path, length: bytes.length, kind: value instanceof Blob ? 'blob' : 'bytes', type: value instanceof Blob ? value.type : '' });
      if (!entry.existing) for (let offset = 0; offset < bytes.length; offset += 1024 ** 2) await store.binaryChunk(token, entry.index, offset, bytes.slice(offset, offset + 1024 ** 2));
    }
    return await store.commit(token);
  } catch (error) { await store.abort(token); throw error; }
}

async function fixture(run: (store: NativeStore, root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'rpen-native-')); let store: NativeStore | undefined;
  try { store = await new NativeStore(join(root, 'library')).init(); await run(store, root); }
  finally { await store?.close(); await rm(root, { recursive: true, force: true }); }
}

type ProjectEnvelope = { data: ProjectData; binaries: BinaryRef[] };
const readProject = async (store: NativeStore, id: string): Promise<ProjectEnvelope> => { const envelope = await store.read('projects', id); assert.ok(envelope); return envelope as unknown as ProjectEnvelope; };
const headOf = async (store: NativeStore, id: string) => { const head = await store.head('projects', id); assert.ok(head); return head; };
const project = (id = 'project'): ProjectData => ({
  id, chart: createChart(), chartName: 'chart.json', imported: Date.now(),
  assets: [['song', new Uint8Array([1, 2, 3])]], unknown: { extension: 42 },
});

test('native storage preserves unknown chart data, deduplicates blobs and rejects stale saves', () => fixture(async store => {
  const data = project(); const first = await write(store, 'projects', data);
  const read = await readProject(store, data.id);
  assert.equal((read.data.unknown as { extension: number }).extension, 42);
  assert.equal(read.binaries.length, 1);
  assert.deepEqual(await store.blob(read.binaries[0]!.hash!, 0, 3), new Uint8Array([1, 2, 3]));
  await write(store, 'projects', data, { expectedRevision: first.revision });
  assert.equal((await store.status()).blobs, 1);
  await assert.rejects(write(store, 'projects', data, { expectedRevision: first.revision }), { name: 'ProjectConflictError' });
  assert.equal(store.operations.size, 0);
}));

test('native save interruption preserves committed version and rebuilds missing index', () => fixture(async (store, root) => {
  const data = project(); const first = await write(store, 'projects', data);
  store.fault = phase => { if (phase === 'before-head') throw Error('simulated interruption'); };
  await assert.rejects(write(store, 'projects', { ...data, chart: { ...data.chart, META: { ...data.chart.META, name: 'lost' } } }, { expectedRevision: first.revision }), /interruption/);
  assert.equal((await readProject(store, data.id)).data.storageRevision, first.revision);
  await store.close(); await rm(join(store.root, 'index.sqlite'));
  const reopened = await new NativeStore(store.root).init();
  try { assert.equal(reopened.list('projects')[0].data.storageRevision, first.revision); } finally { await reopened.close(); }
}));

test('native trash restore, permanent deletion, retained references and independent backups', () => fixture(async (store, root) => {
  const data = project(), saved = await write(store, 'projects', data);
  await store.remove('projects', data.id, saved.revision);
  assert.equal(await store.read('projects', data.id), null);
  assert.equal(store.list('projects', true).length, 1);
  await store.collect(); assert.equal((await store.status()).blobs, 1);
  const trashRevision = (await headOf(store, data.id)).revision;
  await store.restore(data.id, trashRevision);
  assert.ok(await readProject(store, data.id));
  await store.copyTo(join(root, 'backup'));
  const backup = await new NativeStore(join(root, 'backup')).init();
  try { assert.deepEqual((await readProject(backup, data.id)).data.chart, data.chart); } finally { await backup.close(); }
  await store.remove('projects', data.id, (await headOf(store, data.id)).revision);
  await store.purge(data.id, (await headOf(store, data.id)).revision);
  await assert.rejects(write(store, 'projects', data), { name: 'ProjectConflictError' });
  assert.equal((await store.collect()).removed, 1);
  assert.equal((await readdir(join(root, 'backup', 'blobs'))).length, 1);
}));

test('native migration is verified, resumable, never replaces newer native data', () => fixture(async store => {
  const data = project(); await write(store, 'projects', data, { migration: true });
  await store.markMigration('old/projects', 'projects', data.id);
  assert.equal(await store.migrationDone('old/projects', 'projects', data.id), true);
  const skipped = await write(store, 'projects', { ...data, unknown: 'old' }, { migration: true });
  assert.equal(skipped.skipped, true); assert.equal(((await readProject(store, data.id)).data.unknown as { extension: number }).extension, 42);
  const ref = (await readProject(store, data.id)).binaries[0]!;
  await writeFile(join(store.root, 'blobs', ref.hash!), new Uint8Array([0, 0, 0]));
  await assert.rejects(store.markMigration('other', 'projects', data.id), /校验失败/);
}));

test('native storage refuses inherited paths, concurrent ownership and nested backup destinations', () => fixture(async store => {
  await assert.rejects(new NativeStore(store.root).init(), { name: 'StorageBusyError' });
  // A failed competing initialization must not release the first store lock.
  assert.ok(await readFile(join(store.root, '.owner.lock')));
  const token = await store.begin('preferences', '../../outside');
  store.part(token, { path: [], value: {} });
  assert.throws(() => store.part(token, { path: ['__proto__', 'polluted'], value: true }), /路径不存在/);
  assert.equal(({} as Record<string, unknown>).polluted, undefined); await store.abort(token);
  await assert.rejects(store.copyTo(join(store.root, 'nested')), /内部/);
}));

test('native project folders resolve only saved live projects inside the library', () => fixture(async store => {
  await assert.rejects(store.projectFolder('missing'), /尚未保存/);
  const data = project('../../outside'), saved = await write(store, 'projects', data);
  const path = await store.projectFolder(data.id);
  assert.equal(path, store.directory('projects', data.id));
  assert.ok(await readFile(join(path, 'HEAD.json')));
  await store.remove('projects', data.id, saved.revision);
  await assert.rejects(store.projectFolder(data.id), /已被删除/);
}));

test('native image paths open named independent copies and preserve empty folders and user edits', () => fixture(async (store, root) => {
  const data = project('asset-paths'); data.assetFolders = ['pictures/empty'];
  data.assets = [['pictures/a.png', new Uint8Array([1, 2, 3])], ['pictures/sub/b.png', new Uint8Array([4, 5])],
    ['shader/Ocean/main.glsl', new Uint8Array([6])], ['shader/Ocean/hidden.png', new Uint8Array([7])]];
  const saved = await write(store, 'projects', data);
  const folder = await store.assetFolder(data.id, 'pictures', true);
  assert.equal(await store.assetFolder(data.id, 'pictures/a.png', false), folder);
  assert.deepEqual([...await readFile(join(folder, 'a.png'))], [1, 2, 3]);
  assert.deepEqual(await readdir(await store.assetFolder(data.id, 'pictures/empty', true)), []);
  await writeFile(join(folder, 'a.png'), new Uint8Array([99]));
  await store.assetFolder(data.id, 'pictures/a.png');
  assert.deepEqual([...await readFile(join(folder, 'a.png'))], [99]);
  const envelope = await readProject(store, data.id), ref = envelope.binaries.find((entry: { path: (string | number)[] }) => entry.path[1] === 0)!;
  assert.deepEqual([...await readFile(join(store.root, 'blobs', ref.hash!))], [1, 2, 3]);
  await assert.rejects(store.assetFolder(data.id, 'shader/Ocean/hidden.png'), /找不到/);
  await assert.rejects(store.assetFolder(data.id, '../escape', true), /无效/);
  await store.copyTo(join(root, 'backup-without-views'));
  assert.ok(!(await readdir(join(root, 'backup-without-views'))).includes('asset-views'));
  const next = await write(store, 'projects', { ...data, assets: [['pictures/a.png', new Uint8Array([8])]] }, { expectedRevision: saved.revision });
  assert.notEqual(await store.assetFolder(data.id, 'pictures/a.png'), folder);
  assert.deepEqual([...await readFile(join(await store.assetFolder(data.id, 'pictures/a.png'), 'a.png'))], [8]);
  await store.remove('projects', data.id, next.revision);
  await assert.rejects(store.assetFolder(data.id, 'pictures/a.png'), /已被删除/);
}));

test('native named image view refuses directory links', () => fixture(async (store, root) => {
  const data = project('image-link'); data.assets = [['a.png', new Uint8Array([1])]];
  await write(store, 'projects', data);
  const outside = join(root, 'outside'); await mkdir(outside);
  await symlink(outside, join(store.root, 'asset-views'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(store.assetFolder(data.id, 'a.png'), /无效链接/);
  assert.deepEqual(await readdir(outside), []);
}));

test('native batched parts preserve order and reject inherited paths or invalid batch size', () => fixture(async store => {
  const token = await store.begin('preferences', 'batch');
  store.parts(token, [{ path: [], value: { id: 'batch' } }, { path: ['list'], length: 2 }, { path: ['list'], offset: 0, values: [{ x: 1 }, { x: 2 }] }]);
  await store.commit(token);
  assert.deepEqual((await store.read('preferences', 'batch'))!.data.list, [{ x: 1 }, { x: 2 }]);
  const invalid = await store.begin('preferences', 'invalid');
  assert.throws(() => store.parts(invalid, new Array(129)), /批次无效/);
  assert.throws(() => store.parts(invalid, [{ path: [], value: {} }, { path: ['__proto__', 'polluted'], value: true }]), /路径不存在/);
  assert.equal(({} as Record<string, unknown>).polluted, undefined); await store.abort(invalid);
}));

test('native cleanup keeps media referenced by old versions, drafts and imported packages', () => fixture(async store => {
  const data = project(), first = await write(store, 'projects', data);
  await write(store, 'projects', { ...data, assets: [] }, { expectedRevision: first.revision });
  assert.equal((await store.collect()).removed, 0);
  const deleted = await headOf(store, data.id); await store.remove('projects', data.id, deleted.revision);
  await store.purge(data.id, (await headOf(store, data.id)).revision);
  await write(store, 'drafts', { ...data, id: 'draft', projectId: data.id });
  await write(store, 'mods', { id: 'package', files: [['asset', new Uint8Array([1, 2, 3])]] });
  assert.equal((await store.collect()).removed, 0);
  await store.remove('drafts', 'draft'); assert.equal((await store.collect()).removed, 0);
  await store.remove('mods', 'package'); assert.equal((await store.collect()).removed, 1);
}));

test('native committed save still succeeds if optional old-version cleanup fails', () => fixture(async store => {
  store.trimRevisions = async () => { throw Error('cleanup sharing violation'); };
  const result = await write(store, 'projects', project());
  assert.equal((await store.read('projects', 'project'))!.data.storageRevision, result.revision);
  assert.match((await store.status()).warnings.join(' '), /保存已完成/);
}));

test('native corrupt SQLite index and damaged HEAD recover from canonical files', () => fixture(async store => {
  const data = project(), first = await write(store, 'projects', data);
  await write(store, 'projects', { ...data, unknown: 'new' }, { expectedRevision: first.revision });
  const directory = store.directory('projects', data.id); await store.close();
  await writeFile(join(store.root, 'index.sqlite'), 'broken index'); await writeFile(join(directory, 'HEAD.json'), '{}');
  const reopened = await new NativeStore(store.root).init();
  try {
    assert.equal((await reopened.read('projects', data.id))!.data.storageRevision, first.revision);
    assert.equal(reopened.list('projects').length, 1);
    assert.equal((await readdir(store.root)).filter(name => name.startsWith('index.sqlite.corrupt-')).length, 1);
  } finally { await reopened.close(); }
}));

test('native worker drains queued preference writes before closing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rpen-worker-')); let service: NativeService | undefined;
  try {
    service = new NativeService(root); await service.ready;
    const writes = Array.from({ length: 12 }, (_, index) => service!.call('setLocalPreference', 'key-' + index, 'value-' + index));
    const closed = service.close(); await Promise.all(writes); await closed;
    service = new NativeService(root); await service.ready;
    const values = (await service.call<NativeEnvelope>('read', 'preferences', 'ui-settings')).data.values as Record<string, string>;
    assert.equal(Object.keys(values).length, 12); assert.equal(values['key-11'], 'value-11');
  } finally { await service?.close(); await rm(root, { recursive: true, force: true }); }
});

test('native interrupted lock creation is recoverable after the startup grace period', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rpen-lock-')); let store: NativeStore | undefined;
  try {
    await writeFile(join(root, '.owner.lock'), '');
    await assert.rejects(new NativeStore(root).init(), { name: 'StorageBusyError' });
    const old = new Date(Date.now() - 60000); await utimes(join(root, '.owner.lock'), old, old);
    store = await new NativeStore(root).init(); assert.ok(await store.status());
  } finally { await store?.close(); await rm(root, { recursive: true, force: true }); }
});

test('native UI preference failures retain dirty values and can retry before exit', () => {
  const module = new URL('../src/platform/local-preferences.ts', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    globalThis.document = new EventTarget(); let errors = 0, blocked = true; const stored = {};
    document.addEventListener('rpen-preference-error', () => errors++);
    globalThis.rpenDesktopStorage = { version: 1, call: async (method, ...args) => {
      if (method === 'legacyMigrationPending') return { ok: true, result: false };
      if (method === 'read') return { ok: true, result: { data: { values: {} } } };
      if (method === 'setLocalPreference') {
        if (blocked) return { ok: false, error: { name: 'QuotaExceededError', message: 'disk full' } };
        if (args[1] === null) delete stored[args[0]]; else stored[args[0]] = args[1];
        return { ok: true };
      }
      throw Error(method);
    } };
    const { initializeLocalPreferences, localPreferences, flushLocalPreferences } = await import(${JSON.stringify(module)});
    await initializeLocalPreferences(); localPreferences.setItem('test', 'retained');
    await assert.rejects(flushLocalPreferences(), { name: 'QuotaExceededError' });
    assert.equal(localPreferences.getItem('test'), 'retained');
    blocked = false; await flushLocalPreferences(); assert.equal(stored.test, 'retained'); assert.ok(errors > 0);
    localPreferences.removeItem('test'); await flushLocalPreferences(); assert.equal(stored.test, undefined);
  `], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
});
