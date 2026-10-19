import { mkdir, open, readFile, rename, rm, readdir, lstat, realpath, cp, copyFile, link, statfs } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, basename, join, resolve, relative, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { FileHandle } from 'node:fs/promises';
import type { Chart } from '../src/core/types.ts';
import { assertChart } from '../src/core/chart.ts';
import { applySnapshotPart } from '../src/platform/recovery-transfer.ts';
import type { SnapshotPart } from '../src/platform/recovery-transfer.ts';
import { libraryImages, libraryFolders, validAssetPath, withinFolder, parentFolder } from '../src/core/asset-library.ts';

export type { SnapshotPart };

export interface NativeRecordData {
  id: string;
  chart?: Chart;
  chartName?: string;
  assets?: [string, Uint8Array][];
  assetFolders?: string[];
  values?: Record<string, unknown>;
  projectId?: string;
  storageRevision?: string;
  [key: string]: unknown;
}

export interface BinaryRef {
  path: (string | number)[];
  length: number;
  kind: string;
  type?: string;
  hash?: string;
}

export interface NativeEnvelope {
  format: string;
  version: number;
  data: NativeRecordData;
  binaries: BinaryRef[];
}

export interface NativeSummaryData {
  id: string;
  projectId?: string | undefined;
  updated?: number | undefined;
  deleted?: boolean;
  [key: string]: unknown;
}

export interface NativeSummary {
  data: NativeSummaryData;
  binaries: BinaryRef[];
}

export interface HeadRecord {
  format: string;
  version: number;
  id: string;
  revision: string;
  recordRevision: string;
  checksum: string;
  deleted: boolean;
  summary: NativeSummary;
  updated: number;
  deletedAt?: number;
  purged?: boolean;
}

export interface CommitResult {
  revision: string;
  skipped?: boolean;
}

const sha = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
const digest = async (path: string): Promise<string> => { const hash = createHash('sha256'); for await (const chunk of createReadStream(path) as AsyncIterable<Buffer>) hash.update(chunk); return hash.digest('hex'); };
const hashPattern = /^[a-f0-9]{64}$/;
const uuidPattern = /^[a-f0-9-]{36}$/;
const kinds = new Set(['projects', 'drafts', 'editor-skins', 'note-skins', 'mods', 'preferences']);
const failure = (name: string, message: string, fields: Record<string, unknown> = {}) => Object.assign(new Error(message), { name, ...fields });
const inside = (parent: string, child: string): boolean => { const path = relative(parent, child); return path === '' || !isAbsolute(path) && path !== '..' && !path.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')); };
const nodeError = (error: unknown): NodeJS.ErrnoException => error as NodeJS.ErrnoException;
const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

export async function atomicJson(path: string, data: unknown, serialized?: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), '.write-' + randomUUID()); let handle: FileHandle | null = null;
  try {
    handle = await open(temporary, 'wx'); await handle.writeFile(serialized ?? JSON.stringify(data)); await handle.sync(); await handle.close(); handle = null;
    for (let attempt = 0; ; attempt++) {
      try { await rename(temporary, path); break; }
      catch (error) {
        const code = nodeError(error).code;
        if (!code || !['EPERM', 'EBUSY', 'EACCES'].includes(code) || attempt >= 5) throw error;
        await new Promise(resolve => setTimeout(resolve, 40 * (attempt + 1)));
      }
    }
  } finally { await handle?.close(); await rm(temporary, { force: true }).catch(() => {}); }
}

async function regular(path: string): Promise<import('node:fs').Stats> { const info = await lstat(path); if (!info.isFile() || info.isSymbolicLink()) throw failure('StorageIntegrityError', '存储文件类型异常，已停止操作'); return info; }
async function json<T>(path: string): Promise<T> { await regular(path); return JSON.parse(await readFile(path, 'utf8')) as T; }
async function optional<T>(path: string): Promise<T | null> { try { return await json<T>(path); } catch (error) { if (nodeError(error).code === 'ENOENT') return null; throw error; } }

interface OperationFile {
  descriptor: BinaryRef;
  path: string;
  handle: FileHandle | null;
  hash: ReturnType<typeof createHash>;
  received: number;
}
export interface Operation {
  kind: string;
  id: string;
  options: Record<string, unknown>;
  data: NativeRecordData | undefined;
  binaries: BinaryRef[];
  files: OperationFile[];
}

export class NativeStore {
  root: string;
  fault: (phase: string, detail: { kind: string; id: string }) => unknown;
  operations: Map<string, Operation>;
  warnings: string[];
  lock: FileHandle | null = null;
  index: DatabaseSync | null = null;
  identity = '';
  constructor(root: string, { fault = () => {} }: { fault?: (phase: string, detail: { kind: string; id: string }) => unknown } = {}) { this.root = resolve(root); this.fault = fault; this.operations = new Map(); this.warnings = []; }
  async init(): Promise<this> {
    try {
      await mkdir(this.root, { recursive: true }); this.root = await realpath(this.root);
      for (const directory of ['projects', 'drafts', 'editor-skins', 'note-skins', 'mods', 'preferences', 'blobs', 'tmp', 'tombstones', 'migration']) {
        const path = join(this.root, directory); await mkdir(path, { recursive: true });
        if ((await lstat(path)).isSymbolicLink()) throw failure('StorageIntegrityError', '谱面库子目录不能是符号链接');
      }
      const lock = join(this.root, '.owner.lock');
      try { this.lock = await open(lock, 'wx'); }
      catch (error) {
        if (nodeError(error).code !== 'EEXIST') throw error;
        let previous: { pid?: unknown } | null = null;
        try { previous = await optional<{ pid?: unknown }>(lock); }
        catch (error) {
          if (!(error instanceof SyntaxError)) throw error;
          if (Date.now() - (await regular(lock)).mtimeMs < 30000) throw failure('StorageBusyError', '谱面库的启动锁尚未完成，请稍后重试');
        }
        let alive = false;
        const pid = previous?.pid;
        if (typeof pid === 'number' && Number.isInteger(pid)) try { process.kill(pid, 0); alive = true; } catch (error) { alive = nodeError(error).code === 'EPERM'; }
        if (alive) throw failure('StorageBusyError', '此谱面库正在由另一进程使用，请先关闭另一个桌面实例');
        await rm(lock, { force: true }); this.lock = await open(lock, 'wx');
      }
      await this.lock.writeFile(JSON.stringify({ pid: process.pid })); await this.lock.sync();
      const marker = await optional<{ format?: string; version?: number; id?: string }>(join(this.root, 'library.json'));
      if (marker && (marker.format !== 'rpen-native-library' || marker.version !== 1)) throw failure('VersionError', '谱面库格式不受当前编辑器支持');
      this.identity = marker?.id ?? randomUUID();
      if (!marker) await atomicJson(join(this.root, 'library.json'), { format: 'rpen-native-library', version: 1, id: this.identity });
      await this.openIndex();
      return this;
    } catch (error) { await this.close().catch(() => {}); throw error; }
  }
  directory(kind: string, id: string): string {
    if (!kinds.has(kind) || typeof id !== 'string' || !id || id.length > 2048) throw Error('无效的存储标识');
    return join(this.root, kind, sha(id));
  }
  async openIndex(): Promise<void> {
    const path = join(this.root, 'index.sqlite');
    try {
      if (await lstat(path).then(info => info.isSymbolicLink(), (error: unknown) => nodeError(error).code === 'ENOENT' ? false : Promise.reject(error))) throw Error('索引不能是符号链接');
      this.index = new DatabaseSync(path);
      const check = this.index.prepare('PRAGMA quick_check').get() as { quick_check?: string } | undefined;
      if (check?.quick_check !== 'ok') throw Error('索引校验失败');
      this.index.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,summary TEXT NOT NULL,deleted INTEGER NOT NULL,PRIMARY KEY(kind,id));');
    } catch (error) {
      this.index?.close(); this.index = null;
      if (nodeError(error).code !== 'ENOENT') await rename(path, path + '.corrupt-' + Date.now()).catch(() => {});
      await rm(path + '-wal', { force: true }); await rm(path + '-shm', { force: true });
      this.index = new DatabaseSync(path); this.index.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE records(kind TEXT NOT NULL,id TEXT NOT NULL,summary TEXT NOT NULL,deleted INTEGER NOT NULL,PRIMARY KEY(kind,id));');
      this.warnings.push('谱面库索引已从项目文件重建');
    }
    await this.rebuild();
  }
  async rebuild(): Promise<{ count: number; warnings: string[] }> {
    const rows: { kind: string; id: string; summary: string; deleted: number }[] = [];
    for (const kind of kinds) for (const entry of await readdir(join(this.root, kind), { withFileTypes: true })) {
      if (!entry.isDirectory() || !hashPattern.test(entry.name)) continue;
      try {
        const head = await this.headAt(join(this.root, kind, entry.name));
        if (head) rows.push({ kind, id: head.id, summary: JSON.stringify(head.summary), deleted: head.deleted ? 1 : 0 });
      } catch (error) { this.warnings.push('有存储记录未能读取，原文件已保留：' + errorMessage(error)); }
    }
    this.index!.exec('BEGIN IMMEDIATE');
    try { this.index!.exec('DELETE FROM records'); const insert = this.index!.prepare('INSERT INTO records VALUES(?,?,?,?)'); for (const row of rows) insert.run(row.kind, row.id, row.summary, row.deleted); this.index!.exec('COMMIT'); }
    catch (error) { this.index!.exec('ROLLBACK'); throw error; }
    return { count: rows.length, warnings: this.warnings };
  }
  async headAt(directory: string): Promise<HeadRecord | null> {
    let head: HeadRecord | null;
    const validate = (value: unknown): HeadRecord | null => {
      if (!value) return null;
      if (typeof value !== 'object') throw failure('StorageIntegrityError', '项目指针无效');
      const candidate = value as Record<string, unknown>;
      if (candidate.format !== 'rpen-native-head' || !uuidPattern.test(String(candidate.revision)) || !uuidPattern.test(String(candidate.recordRevision)) || !hashPattern.test(String(candidate.checksum)) || !candidate.summary || typeof candidate.id !== 'string') throw failure('StorageIntegrityError', '项目指针无效');
      return value as HeadRecord;
    };
    try { head = validate(await optional<unknown>(join(directory, 'HEAD.json'))); }
    catch (error) { head = validate(await optional<unknown>(join(directory, 'HEAD.previous.json'))); if (!head) throw error; this.warnings.push('已使用上一份完整项目指针'); }
    if (!head) return null;
    return head;
  }
  async head(kind: string, id: string): Promise<HeadRecord | null> {
    const head = await this.headAt(this.directory(kind, id));
    if (head && head.id !== id) throw failure('StorageIntegrityError', '项目标识不匹配');
    return head ?? (kind === 'projects' ? await optional<HeadRecord>(join(this.root, 'tombstones', sha(id) + '.json')) : null);
  }
  async read(kind: string, id: string, includeDeleted = false): Promise<NativeEnvelope | null> {
    const head = await this.head(kind, id);
    if (!head || head.deleted && !includeDeleted) return null;
    const path = join(this.directory(kind, id), 'revisions', head.recordRevision + '.json');
    if (!uuidPattern.test(head.recordRevision) || !hashPattern.test(head.checksum)) throw failure('StorageIntegrityError', '存储版本引用无效');
    await regular(path); const bytes = await readFile(path);
    if (sha(bytes) !== head.checksum) throw failure('StorageIntegrityError', '项目文件校验失败，原文件与历史版本已保留');
    const envelope = JSON.parse(bytes.toString()) as NativeEnvelope;
    if (envelope.format !== 'rpen-native-record' || envelope.version !== 1 || !Array.isArray(envelope.binaries)) throw failure('StorageIntegrityError', '存储记录格式无效');
    return envelope;
  }
  async projectFolder(id: string): Promise<string> {
    const head = await this.head('projects', id);
    if (!head || head.deleted) throw Error('此谱面尚未保存或已被删除，请先保存到谱面库');
    const directory = this.directory('projects', id), path = await realpath(directory);
    if (!inside(join(this.root, 'projects'), path) || (await lstat(directory)).isSymbolicLink()) throw failure('StorageIntegrityError', '谱面文件夹路径异常');
    return path;
  }
  async assetFolder(id: string, virtualPath: string, folder = false): Promise<string> {
    await this.projectFolder(id);
    if (typeof virtualPath !== 'string' || typeof folder !== 'boolean') throw Error('素材路径无效');
    if (virtualPath) virtualPath = validAssetPath(virtualPath); else if (!folder) throw Error('请选择图片');
    const envelope = (await this.read('projects', id))!, { data, binaries } = envelope;
    const assets = data.assets ?? [];
    const assetsMap = new Map<string, Uint8Array>(assets), images = libraryImages(assetsMap, data.chart, data.chartName);
    const folders = libraryFolders(assetsMap, data.assetFolders, data.chart, data.chartName);
    if (folder ? virtualPath && !folders.has(virtualPath) : !images.some(([path]) => path === virtualPath)) throw Error('保存的谱面中找不到此图片或文件夹，请先保存最新修改');
    const directory = folder ? virtualPath : parentFolder(virtualPath);
    const revision = data.storageRevision;
    if (typeof revision !== 'string' || !uuidPattern.test(revision)) throw failure('StorageIntegrityError', '素材查看版本无效');
    // Named, independent copies must never alias writable files to shared blobs.
    const view = join(this.root, 'asset-views', sha(id), revision, 'images');
    const ensure = async (target: string): Promise<void> => {
      if (!inside(this.root, target)) throw Error('素材路径越界');
      let current = this.root;
      for (const part of relative(this.root, target).split(/[\\/]/).filter(Boolean)) {
        current = join(current, part);
        try { await mkdir(current); } catch (error) { if (nodeError(error).code !== 'EEXIST') throw error; }
        const info = await lstat(current);
        if (!info.isDirectory() || info.isSymbolicLink() || !inside(this.root, await realpath(current))) throw failure('StorageIntegrityError', '素材查看目录包含无效链接或文件');
      }
    };
    const targetDirectory = join(view, directory); await ensure(targetDirectory);
    for (const path of folders) if (path === directory || withinFolder(path, directory)) await ensure(join(view, validAssetPath(path)));
    const descriptors = new Map<string, BinaryRef>();
    for (const entry of binaries) {
      if (entry.path.length !== 3 || entry.path[0] !== 'assets' || entry.path[2] !== 1) continue;
      const name = assets[entry.path[1] as number]?.[0];
      if (name !== undefined) descriptors.set(name, entry);
    }
    for (const [path] of images) {
      if (!withinFolder(path, directory)) continue;
      const name = validAssetPath(path), target = join(view, name); await ensure(dirname(target));
      try { await regular(target); continue; } catch (error) { if (nodeError(error).code !== 'ENOENT') throw error; }
      const descriptor = descriptors.get(path);
      if (!descriptor || typeof descriptor.hash !== 'string' || !hashPattern.test(descriptor.hash)) throw failure('StorageIntegrityError', '图片素材引用无效');
      const source = join(this.root, 'blobs', descriptor.hash);
      await regular(source);
      if (await digest(source) !== descriptor.hash) throw failure('StorageIntegrityError', '图片素材校验失败');
      // Publish complete copies only; an interrupted copy is never shown as valid.
      const temporary = join(dirname(target), '.image-' + randomUUID());
      try {
        await copyFile(source, temporary, constants.COPYFILE_EXCL);
        await link(temporary, target);
      } finally { await rm(temporary, { force: true }); }
    }
    return targetDirectory;
  }
  list(kind: string, deleted = false): NativeSummary[] { if (!kinds.has(kind)) throw Error('无效存储类型'); return (this.index!.prepare('SELECT summary FROM records WHERE kind=? AND deleted=? ORDER BY rowid DESC').all(kind, deleted ? 1 : 0) as { summary: string }[]).map(row => JSON.parse(row.summary) as NativeSummary); }
  async begin(kind: string, id: string, options: Record<string, unknown> = {}): Promise<string> {
    this.directory(kind, id); const token = randomUUID();
    this.operations.set(token, { kind, id, options, data: undefined, binaries: [], files: [] }); return token;
  }
  operation(token: string): Operation { const value = this.operations.get(token); if (!value) throw Error('存储操作已结束'); return value; }
  validatePath(root: unknown, path: (string | number)[], includeLast = false): unknown {
    if (!Array.isArray(path) || path.length > 256 || path.some(key => typeof key !== 'string' && !(Number.isSafeInteger(key) && key >= 0))) throw Error('无效数据路径');
    let parent: unknown = root;
    for (const key of includeLast ? path : path.slice(0, -1)) {
      if (!parent || typeof parent !== 'object' || !Object.hasOwn(parent, key)) throw Error('数据路径不存在');
      parent = (parent as Record<string | number, unknown>)[key];
    }
    if (!includeLast && path.length && (!parent || typeof parent !== 'object')) throw Error('数据路径无效');
    return parent;
  }
  part(token: string, part: SnapshotPart): void {
    const operation = this.operation(token), target = this.validatePath(operation.data, part.path, 'offset' in part);
    if ('length' in part && (!Number.isSafeInteger(part.length) || part.length < 0 || part.length > 10_000_000)) throw Error('数组长度无效');
    if ('offset' in part && (!Array.isArray(target) || !Array.isArray(part.values) || !Number.isSafeInteger(part.offset) || part.offset < 0 || part.offset + part.values.length > target.length)) throw Error('数组分片无效');
    operation.data = applySnapshotPart(operation.data, part) as NativeRecordData;
  }
  parts(token: string, parts: SnapshotPart[]): void {
    if (!Array.isArray(parts) || parts.length > 128) throw Error('数据分片批次无效');
    for (const part of parts) this.part(token, part);
  }
  async binaryBegin(token: string, entry: { path: (string | number)[]; length: number; kind: string; type?: unknown; hash?: string }): Promise<{ existing: true; hash: string } | { existing: false; index: number }> {
    const operation = this.operation(token);
    if (!Array.isArray(entry.path) || entry.path.length > 256 || !Number.isSafeInteger(entry.length) || entry.length < 0 || !['bytes', 'blob'].includes(entry.kind)) throw Error('素材描述无效');
    this.validatePath(operation.data, entry.path, true);
    if (!entry.path.length || operation.binaries.some(ref => JSON.stringify(ref.path) === JSON.stringify(entry.path)) || operation.files.some(file => JSON.stringify(file.descriptor.path) === JSON.stringify(entry.path))) throw Error('素材路径重复或无效');
    const descriptor: BinaryRef = { path: entry.path, length: entry.length, kind: entry.kind, type: String(entry.type ?? '').slice(0, 200) };
    const hash = entry.hash;
    if (typeof hash === 'string' && hashPattern.test(hash)) {
      const path = join(this.root, 'blobs', hash);
      if (await regular(path).then(info => info.size === entry.length, (error: unknown) => nodeError(error).code === 'ENOENT' ? false : Promise.reject(error))) {
        descriptor.hash = hash; operation.binaries.push(descriptor); return { existing: true, hash };
      }
    }
    const path = join(this.root, 'tmp', 'asset-' + randomUUID()), file: OperationFile = { descriptor, path, handle: await open(path, 'wx'), hash: createHash('sha256'), received: 0 };
    const index = operation.files.push(file) - 1;
    if (!entry.length) return this.finishBinary(operation, file).then(hash => ({ existing: true, hash }));
    return { existing: false, index };
  }
  async binaryChunk(token: string, index: number, offset: number, bytes: Uint8Array): Promise<{ hash?: string }> {
    const operation = this.operation(token), file = operation.files[index];
    if (!file?.handle || !(bytes instanceof Uint8Array) || bytes.length > 1024 ** 2 || offset !== file.received || offset + bytes.length > file.descriptor.length) throw Error('素材分片无效');
    await file.handle.writeFile(bytes); file.hash.update(bytes); file.received += bytes.length;
    return file.received === file.descriptor.length ? { hash: await this.finishBinary(operation, file) } : {};
  }
  async finishBinary(operation: Operation, file: OperationFile): Promise<string> {
    await file.handle!.sync(); await file.handle!.close(); file.handle = null;
    const hash = file.hash.digest('hex'), path = join(this.root, 'blobs', hash);
    const exists = await regular(path).then(info => info.size === file.descriptor.length, (error: unknown) => nodeError(error).code === 'ENOENT' ? false : Promise.reject(error));
    if (exists) await rm(file.path, { force: true }); else await rename(file.path, path);
    file.descriptor.hash = hash; operation.binaries.push(file.descriptor); return hash;
  }
  async blob(hash: string, offset: number, length: number): Promise<Uint8Array> {
    if (!hashPattern.test(hash) || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 0 || length > 1024 ** 2) throw Error('无效素材读取');
    const path = join(this.root, 'blobs', hash), info = await regular(path);
    if (offset > info.size) throw Error('素材读取越界');
    const file = await open(path, 'r'); try { const bytes = new Uint8Array(Math.min(length, info.size - offset)); const result = await file.read(bytes, 0, bytes.length, offset); return bytes.slice(0, result.bytesRead); } finally { await file.close(); }
  }
  summary(kind: string, data: NativeRecordData, binaries: BinaryRef[], revision: string, deleted = false): NativeSummary {
    const chart = data.chart!, info = data.info as { Path?: unknown; Group?: unknown } | undefined;
    let summary: NativeSummaryData;
    if (kind === 'projects') summary = { version: 2, id: data.id, storageRevision: revision, name: chart.META.name ?? data.chartName, chartName: data.chartName, identifier: data.identifier ?? info?.Path ?? chart.META.id ?? '', source: data.source, imported: data.imported, updated: (data.updated ?? data.imported) as number | undefined, bytes: data.bytes, group: data.group ?? info?.Group ?? '未分组', pinned: Boolean(data.pinned), archived: Boolean(data.archived), level: chart.META.level ?? '', composer: chart.META.composer ?? '', charter: chart.META.charter ?? '', lines: chart.judgeLineList.length, notes: chart.judgeLineList.reduce((sum, line) => sum + (line.notes?.length ?? 0), 0), thumbnail: null, deleted };
    else if (kind === 'drafts') summary = { id: data.id, projectId: data.projectId, name: data.name, title: chart.META.name ?? data.name, updated: data.updated as number | undefined };
    else summary = { id: data.id };
    return { data: summary, binaries: binaries.filter(entry => entry.path.length === 1 && entry.path[0] === 'thumbnail') };
  }
  async commit(token: string): Promise<CommitResult> {
    const operation = this.operation(token), { kind, id, options, data, binaries } = operation;
    if (!data || typeof data !== 'object' || operation.files.some(file => file.handle)) throw Error('存储数据不完整');
    if (['projects', 'drafts'].includes(kind)) assertChart(data.chart);
    const previous = await this.head(kind, id), expected = options.expectedRevision ?? null;
    if (kind === 'projects' && !options.migration && (previous?.revision ?? null) !== expected) throw failure('ProjectConflictError', '此项目已被修改或删除，已阻止旧版本覆盖。可导出 PEZ 或另存为新项目。', { projectId: id, expectedRevision: expected, actualRevision: previous?.revision ?? null });
    if (options.migration && previous) { await this.abort(token); return { revision: previous.revision, skipped: true }; }
    const revision = randomUUID(), directory = this.directory(kind, id);
    data.id = id; if (kind === 'projects') data.storageRevision = revision;
    const envelope = { format: 'rpen-native-record', version: 1, data, binaries }, bytes = JSON.stringify(envelope);
    const head = { format: 'rpen-native-head', version: 1, id, revision, recordRevision: revision, checksum: sha(bytes), deleted: false, summary: this.summary(kind, data, binaries, revision), updated: Date.now() };
    await mkdir(join(directory, 'revisions'), { recursive: true });
    await atomicJson(join(directory, 'revisions', revision + '.json'), envelope, bytes);
    await this.fault('after-revision', { kind, id });
    if (previous && !previous.purged) await atomicJson(join(directory, 'HEAD.previous.json'), previous);
    await this.fault('before-head', { kind, id });
    await atomicJson(join(directory, 'HEAD.json'), head);
    this.operations.delete(token);
    try { this.index!.prepare('INSERT OR REPLACE INTO records VALUES(?,?,?,0)').run(kind, id, JSON.stringify(head.summary)); }
    catch { this.warnings.push('索引更新未完成，将在重建后恢复'); await this.rebuild().catch(() => {}); }
    try {
      if (kind === 'drafts' && options.limit) await this.trimDrafts(data.projectId!, options.limit as number);
      await this.trimRevisions(directory, new Set([revision, previous?.recordRevision].filter(Boolean) as string[]));
    } catch { this.warnings.push('本次保存已完成，旧版本清理将在下次继续'); }
    return { revision };
  }
  async trimRevisions(directory: string, protectedVersions: Set<string>): Promise<void> {
    const files = await readdir(join(directory, 'revisions'));
    const entries = await Promise.all(files.filter(name => uuidPattern.test(name.slice(0, -5)) && name.endsWith('.json')).map(async name => ({ name, time: (await regular(join(directory, 'revisions', name))).mtimeMs })));
    entries.sort((a, b) => b.time - a.time);
    for (const entry of entries.slice(10)) if (!protectedVersions.has(entry.name.slice(0, -5))) await rm(join(directory, 'revisions', entry.name)).catch(() => {});
  }
  async trimDrafts(projectId: string, limit: number): Promise<void> {
    const drafts = this.list('drafts').map(entry => entry.data).filter(entry => entry.projectId === projectId).sort((a, b) => b.updated! - a.updated!);
    for (const draft of drafts.slice(Math.max(1, Math.min(100, limit)))) await this.remove('drafts', draft.id);
  }
  async abort(token: string): Promise<void> {
    const operation = this.operations.get(token); this.operations.delete(token); if (!operation) return;
    for (const file of operation.files) { await file.handle?.close().catch(() => {}); await rm(file.path, { force: true }).catch(() => {}); }
  }
  async remove(kind: string, id: string, expectedRevision?: string): Promise<void> {
    const previous = await this.head(kind, id); if (!previous) return;
    if (kind !== 'projects') { await rm(this.directory(kind, id), { recursive: true, force: true }); this.index!.prepare('DELETE FROM records WHERE kind=? AND id=?').run(kind, id); return; }
    if (previous.revision !== expectedRevision) throw failure('ProjectConflictError', '项目已改变，删除已取消，请刷新后重试', { projectId: id });
    const head: HeadRecord = { ...previous, revision: randomUUID(), deleted: true, deletedAt: Date.now() };
    head.summary = { data: { ...previous.summary.data, deleted: true, deletedAt: head.deletedAt, storageRevision: head.revision }, binaries: previous.summary.binaries };
    await atomicJson(join(this.directory(kind, id), 'HEAD.previous.json'), previous);
    await atomicJson(join(this.directory(kind, id), 'HEAD.json'), head);
    this.index!.prepare('INSERT OR REPLACE INTO records VALUES(?,?,?,1)').run(kind, id, JSON.stringify(head.summary));
  }
  async restore(id: string, revision: string): Promise<CommitResult> {
    const head = await this.head('projects', id); if (!head?.deleted || head.revision !== revision || head.purged) throw Error('回收站项目已改变或不存在');
    const envelope = await this.read('projects', id, true), token = await this.begin('projects', id, { expectedRevision: revision });
    Object.assign(this.operation(token), { data: envelope!.data, binaries: envelope!.binaries }); return this.commit(token);
  }
  async purge(id: string, revision: string): Promise<void> {
    const head = await this.head('projects', id); if (!head?.deleted || head.revision !== revision) throw Error('回收站项目已改变或不存在');
    await atomicJson(join(this.root, 'tombstones', sha(id) + '.json'), { ...head, purged: true });
    await rm(this.directory('projects', id), { recursive: true, force: true }); this.index!.prepare('DELETE FROM records WHERE kind=? AND id=?').run('projects', id);
  }
  async collect(): Promise<{ removed: number; bytes: number }> {
    if (this.operations.size) throw Error('正在保存，请保存结束后再清理');
    const referenced = new Set<string>();
    for (const kind of kinds) for (const directory of await readdir(join(this.root, kind), { withFileTypes: true })) {
      if (!directory.isDirectory() || !hashPattern.test(directory.name)) continue;
      for (const filename of await readdir(join(this.root, kind, directory.name, 'revisions'))) {
        if (!filename.endsWith('.json')) continue;
        const envelope = await json<NativeEnvelope>(join(this.root, kind, directory.name, 'revisions', filename));
        if (!Array.isArray(envelope.binaries)) throw Error('存在无法读取的历史记录，已停止素材清理');
        for (const ref of envelope.binaries) { if (typeof ref.hash !== 'string' || !hashPattern.test(ref.hash)) throw Error('素材引用异常，已停止清理'); referenced.add(ref.hash); }
      }
    }
    let removed = 0, bytes = 0;
    for (const name of await readdir(join(this.root, 'blobs'))) if (hashPattern.test(name) && !referenced.has(name)) { const path = join(this.root, 'blobs', name); bytes += (await regular(path)).size; await rm(path); removed++; }
    for (const name of await readdir(join(this.root, 'tmp'))) if (/^asset-[a-f0-9-]{36}$/.test(name)) await rm(join(this.root, 'tmp', name), { force: true });
    return { removed, bytes };
  }
  async migrationDone(source: string, kind: string, id: string): Promise<boolean> { return Boolean(await optional<Record<string, unknown>>(join(this.root, 'migration', sha(source + '\0' + kind + '\0' + id) + '.json'))); }
  async markMigration(source: string, kind: string, id: string): Promise<void> {
    const envelope = await this.read(kind, id, true);
    if (!envelope) throw Error('迁移目标不存在');
    for (const ref of envelope.binaries) {
      if (typeof ref.hash !== 'string' || !hashPattern.test(ref.hash)) throw Error('迁移素材引用无效');
      const hash = ref.hash, path = join(this.root, 'blobs', hash); if ((await regular(path)).size !== ref.length || await digest(path) !== hash) throw Error('迁移后素材校验失败');
    }
    await atomicJson(join(this.root, 'migration', sha(source + '\0' + kind + '\0' + id) + '.json'), { source, kind, id, updated: Date.now() });
  }
  async status(): Promise<{ native: boolean; root: string; identity: string; usage: number; free: number; blobs: number; projects: number; trash: number; warnings: string[] }> {
    let usage = 0, blobs = 0;
    for (const name of await readdir(join(this.root, 'blobs'))) if (hashPattern.test(name)) { usage += (await regular(join(this.root, 'blobs', name))).size; blobs++; }
    const disk = await statfs(this.root);
    return { native: true, root: this.root, identity: this.identity, usage, free: disk.bavail * disk.bsize, blobs, projects: this.list('projects').length, trash: this.list('projects', true).length, warnings: this.warnings };
  }
  async copyTo(destination: string): Promise<{ root: string }> {
    destination = resolve(destination);
    if (inside(this.root, destination) || inside(destination, this.root)) throw Error('目标位置不能在当前谱面库内部，也不能包含当前谱面库');
    if (await lstat(destination).then(() => true, (error: unknown) => nodeError(error).code === 'ENOENT' ? false : Promise.reject(error))) throw Error('目标谱面库文件夹已存在，请选择其他位置');
    if (this.operations.size) throw Error('正在保存，请保存结束后再迁移或备份');
    await mkdir(dirname(destination), { recursive: true });
    destination = join(await realpath(dirname(destination)), basename(destination));
    if (inside(this.root, destination) || inside(destination, this.root)) throw Error('目标位置不能通过链接指向当前谱面库内部或其上级');
    const staging = destination + '.partial-' + randomUUID();
    try {
      await cp(this.root, staging, { recursive: true, filter: path => !['.owner.lock', 'index.sqlite', 'index.sqlite-wal', 'index.sqlite-shm', 'tmp', 'asset-views'].includes(path.split(/[\\/]/).at(-1)!) });
      const verify = async (source: string, target: string): Promise<void> => { for (const entry of await readdir(source, { withFileTypes: true })) { if (['.owner.lock', 'index.sqlite', 'index.sqlite-wal', 'index.sqlite-shm', 'tmp', 'asset-views'].includes(entry.name)) continue; if (entry.isSymbolicLink()) throw Error('库内存在符号链接，已停止复制'); const a = join(source, entry.name), b = join(target, entry.name); if (entry.isDirectory()) await verify(a, b); else if (await digest(a) !== await digest(b)) throw Error('复制校验失败'); } };
      await verify(this.root, staging); await rename(staging, destination); return { root: destination };
    } catch (error) { await rm(staging, { recursive: true, force: true }); throw error; }
  }
  async close(): Promise<void> {
    for (const token of [...this.operations.keys()]) await this.abort(token);
    this.index?.close(); this.index = null;
    if (this.lock) { await this.lock.close(); this.lock = null; await rm(join(this.root, '.owner.lock'), { force: true }); }
  }
}
