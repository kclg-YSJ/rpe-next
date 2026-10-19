import { mkdtemp, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ManifestFile, MediaManifest } from '../src/platform/collaboration-media.ts';

const chunkSize = 1024 * 1024;
const roomLimit = 512 * 1024 * 1024;
const storageLimit = 2 * 1024 * 1024 * 1024;
const validHash = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const fail = (message: string, status = 400): Error & { status: number } => Object.assign(new Error(message), { status });
const json = (response: ServerResponse, value: unknown): void => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(value)); };

/** The slice of a collaboration socket the store writes progress to. */
export interface MediaSocket {
  readyState: number;
  send(data: string): void;
}

/** The slice of a room member the store reads and updates. */
export interface MediaMember {
  id: string;
  socket?: MediaSocket | null;
  mediaToken?: string;
  mediaRequests?: number;
  receiveAssets?: boolean;
}

/** The slice of a room the store routes requests for. */
export interface MediaRoom {
  id: string;
  host: string;
  members: Map<string, MediaMember>;
  touched: number;
}

/** The `media-upload` message the socket channel carries. */
export interface SocketUploadMessage {
  upload: string;
  hash: string;
  index: number;
  data: string;
}

interface UploadProgress {
  phase: string;
  channel: 'socket' | 'http';
  index: number;
  bytes: number;
  total: number;
}

type Diagnostic = (entry: Record<string, unknown>) => void;
type UploadProgressReport = (member: MediaMember, progress: UploadProgress & { upload: string; fileIndex: number }) => void;
type Publish = (room: MediaRoom, manifest: MediaManifest) => void;

interface StoreOptions {
  onDiagnostic?: Diagnostic;
  onUploadProgress?: UploadProgressReport;
}

interface WritingChunk {
  abort: () => void;
  finished: Promise<void>;
  channel: 'socket' | 'http';
}

interface PendingFile {
  size: number;
  chunks: Set<number>;
  writing: Map<number, WritingChunk>;
}

interface PendingUpload {
  id: string;
  reserved: number;
  files: ManifestFile[];
  uploads: Map<string, PendingFile>;
}

interface RoomState {
  cached: Map<string, number>;
  current: MediaManifest | null;
  pending: PendingUpload | null;
  busy: boolean;
  reserved?: number;
}

interface PreparedFile {
  name: string;
  hash: string;
  size: number;
}

interface PreparedBody {
  files?: unknown;
}

async function body(request: IncomingMessage, limit: number, progress: (size: number) => void = () => {}): Promise<Buffer> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) {
    const bytes = chunk as Buffer;
    size += bytes.length;
    if (size > limit) throw fail('请求数据过大', 413);
    chunks.push(bytes);
    progress(size);
  }
  return Buffer.concat(chunks);
}

export class CollaborationAssetStore {
  root: string;
  rooms: Map<string, RoomState>;
  tasks: Set<Promise<unknown>>;
  active: number;
  closed: boolean;
  onDiagnostic: Diagnostic;
  onUploadProgress: UploadProgressReport;

  static async create(options: StoreOptions): Promise<CollaborationAssetStore> { return new CollaborationAssetStore(await mkdtemp(join(tmpdir(), 'rpe-next-media-')), options); }
  constructor(root: string, { onDiagnostic = () => {}, onUploadProgress = () => {} }: StoreOptions = {}) {
    this.root = root; this.rooms = new Map(); this.tasks = new Set(); this.active = 0; this.closed = false;
    this.onDiagnostic = onDiagnostic; this.onUploadProgress = onUploadProgress;
  }
  manifest(room: string): MediaManifest | null { return this.rooms.get(room)?.current ?? null; }
  async writeUpload(room: MediaRoom, member: MediaMember, id: string, hash: string, index: number, read: (expected: number, progress: (received: number) => void) => Promise<Buffer>, abort: () => void, channel: 'socket' | 'http'): Promise<{ received: number }> {
    const state = this.rooms.get(room.id); const pending = state?.pending;
    if (!pending || pending.id !== id || state.busy) throw fail('素材上传已过期或正在提交', 409);
    const file = pending.uploads.get(hash);
    if (!file || !Number.isInteger(index) || index < 0 || index >= Math.ceil(file.size / chunkSize)) throw fail('素材块无效');
    const previous = file.writing.get(index);
    if (previous) {
      if (channel !== 'socket' || previous.channel !== 'http') throw fail('素材块仍在写入', 409);
      previous.abort(); await previous.finished;
    }
    if (state.pending !== pending || state.busy || file.writing.has(index)) throw fail('素材上传已变更', 409);
    const expected = Math.min(chunkSize, file.size - index * chunkSize);
    let finish!: () => void; const finished = new Promise<void>(resolve => { finish = resolve; });
    const writer: WritingChunk = { abort, finished, channel };
    file.writing.set(index, writer);
    let reported = -1; let reportedAt = 0;
    const report = (phase: string, bytes: number): void => {
      const details: UploadProgress = { phase, channel, index, bytes, total: expected };
      this.onDiagnostic({ ...details, phase: `media-upload-${phase}` });
      this.onUploadProgress(member, { ...details, upload: id, fileIndex: pending.files.findIndex(entry => entry.hash === hash) });
    };
    report('accepted', 0);
    try {
      const bytes = await read(expected, received => {
        if (reported < 0 || received === expected || received - reported >= 65536 && Date.now() - reportedAt >= 500) {
          reported = received; reportedAt = Date.now(); report('receiving', received);
        }
      });
      if (bytes.length !== expected) throw fail('素材块长度不正确');
      if (state.pending !== pending) throw fail('素材上传已被替换', 409);
      report('writing', bytes.length);
      const target = join(this.root, room.id, pending.id, `${hash}.${index}`);
      await writeFile(`${target}.tmp`, bytes, { mode: 0o600 }); await rename(`${target}.tmp`, target); file.chunks.add(index);
      report('stored', bytes.length); return { received: bytes.length };
    } catch (error) { report('failed', 0); throw error; }
    finally { file.writing.delete(index); finish(); }
  }
  async uploadSocket(room: MediaRoom, member: MediaMember, message: SocketUploadMessage): Promise<{ received: number }> {
    if (member.id !== room.host || member.socket?.readyState !== 1) throw fail('仅在线房主可发布素材', 403);
    if (!/^[0-9a-f]{32}$/.test(message.upload) || !validHash(message.hash) || typeof message.data !== 'string' || message.data.length > 4 * Math.ceil(chunkSize / 3) || message.data.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(message.data)) throw fail('素材块无效');
    if (this.closed || this.active >= 32 || (member.mediaRequests ?? 0) >= 6) throw fail('素材请求繁忙，请稍后重试', 429);
    this.active++; member.mediaRequests = (member.mediaRequests ?? 0) + 1;
    const task = this.writeUpload(room, member, message.upload, message.hash, message.index, async () => Buffer.from(message.data, 'base64'), () => {}, 'socket');
    this.tasks.add(task);
    try { return await task; }
    finally { this.tasks.delete(task); this.active--; member.mediaRequests--; }
  }
  async resumeUpload(room: MediaRoom, member: MediaMember, id: string): Promise<{ completed: { hash: string; index: number }[] }> {
    if (member.id !== room.host || member.socket?.readyState !== 1) throw fail('仅在线房主可发布素材', 403);
    const state = this.rooms.get(room.id); const pending = state?.pending;
    if (this.closed || !pending || pending.id !== id || state.busy) throw fail('素材上传已过期或正在提交', 409);
    const writers = [...pending.uploads.values()].flatMap(file => [...file.writing.values()].filter(writer => writer.channel === 'http'));
    for (const writer of writers) writer.abort();
    await Promise.all(writers.map(writer => writer.finished));
    if (state.pending !== pending || state.busy) throw fail('素材上传已变更', 409);
    const completed = [...pending.uploads].flatMap(([hash, file]) => [...file.chunks].map(index => ({ hash, index })));
    this.onDiagnostic({ phase: 'media-upload-resumed', cancelledRequests: writers.length, completedChunks: completed.length });
    return { completed };
  }
  async handle(request: IncomingMessage, response: ServerResponse, rooms: Map<string, MediaRoom>, publish: Publish): Promise<boolean> {
    if (!request.url?.startsWith('/collab/media/')) return false;
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    response.setHeader('Access-Control-Max-Age', '600');
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return true; }
    const task = this.route(request, response, rooms, publish);
    this.tasks.add(task);
    try { await task; }
    catch (error) {
      const failure = error as Error & { status?: number };
      if (!response.headersSent) { response.statusCode = failure.status ?? 500; json(response, { error: failure.status ? failure.message : '素材服务暂不可用，请重试' }); }
      else response.destroy();
    } finally { this.tasks.delete(task); }
    return true;
  }
  async route(request: IncomingMessage, response: ServerResponse, rooms: Map<string, MediaRoom>, publish: Publish): Promise<void> {
    const path = (request.url ?? '').split('?')[0]!.split('/');
    const room = rooms.get(path[3] ?? '');
    const authorization = request.headers.authorization;
    const member = room && [...room.members.values()].find(entry => entry.mediaToken && authorization === `Bearer ${entry.mediaToken}` && entry.socket?.readyState === 1);
    if (!room || !member) throw fail('素材访问未授权或连接已断开', 403);
    if (this.closed || this.active >= 32 || (member.mediaRequests ?? 0) >= 6) throw fail('素材请求繁忙，请稍后重试', 429);
    this.active++; member.mediaRequests = (member.mediaRequests ?? 0) + 1; room.touched = Date.now();
    try {
      if (request.method === 'GET' && path[4] === 'file' && path.length === 8) {
        const current = this.manifest(room.id); const hash = path[6] ?? ''; const index = Number(path[7]);
        const file = current?.id === path[5] ? current.files.find(entry => entry.hash === hash) : undefined;
        if (!file || !Number.isInteger(index) || index < 0 || index >= Math.ceil(file.size / chunkSize)) throw fail('素材不存在或已更新', 404);
        const bytes = Buffer.alloc(Math.min(chunkSize, file.size - index * chunkSize));
        const handle = await open(join(this.root, room.id, `${hash}.bin`), 'r');
        try { const result = await handle.read(bytes, 0, bytes.length, index * chunkSize); if (result.bytesRead !== bytes.length) throw fail('素材读取不完整', 500); }
        finally { await handle.close(); }
        response.setHeader('Content-Type', 'application/octet-stream'); response.setHeader('Content-Length', bytes.length);
        await new Promise<void>(resolve => { response.once('close', resolve); response.end(bytes, () => resolve()); }); return;
      }
      if (member.id !== room.host) throw fail('仅房主可发布素材', 403);
      let state = this.rooms.get(room.id);
      if (request.method === 'POST' && path[4] === 'prepare' && path.length === 5) {
        const parsed = JSON.parse((await body(request, 256 * 1024)).toString()) as PreparedBody;
        const files = parsed.files;
        if (!Array.isArray(files) || files.length > 512) throw fail('素材列表无效');
        const entries = files as unknown[];
        const names = new Set<string>(); const hashes = new Map<string, number>();
        for (const entry of entries) {
          const file = entry as Partial<PreparedFile> | null;
          if (!file || typeof file.name !== 'string' || file.name.length > 256 || /(^[/\\]|(^|[/\\])\.\.([/\\]|$)|:)/.test(file.name) || !/\.(png|jpe?g|webp|gif|ogg|mp3|wav|flac|m4a)$/i.test(file.name) || !validHash(file.hash) || typeof file.size !== 'number' || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > 128 * 1024 * 1024 || names.has(file.name)) throw fail('素材名称、大小或校验值无效');
          if (hashes.has(file.hash) && hashes.get(file.hash) !== file.size) throw fail('素材大小不一致');
          names.add(file.name); hashes.set(file.hash, file.size);
        }
        if ([...hashes.values()].reduce((sum, size) => sum + size, 0) > roomLimit) throw fail('一组素材最多 512 MiB');
        if (state?.busy || state?.pending && [...state.pending.uploads.values()].some(file => file.writing.size)) throw fail('上一组素材仍在处理中', 409);
        if (!state) { state = { cached: new Map(), current: null, pending: null, busy: true }; this.rooms.set(room.id, state); }
        else state.busy = true;
        const owner = state;
        try {
          const reserved = [...this.rooms.values()].reduce((sum, entry) => sum + [...entry.cached.values()].reduce((total, size) => total + size, 0) + (entry === owner ? 0 : entry.reserved ?? 0), 0);
          const missing = [...hashes].filter(([hash, size]) => owner.cached.get(hash) !== size);
          const bytes = missing.reduce((sum, [, size]) => sum + size, 0);
          if (reserved + bytes > storageLimit) throw fail('服务器素材暂存空间已满，请减少素材后重试', 507);
          owner.reserved = bytes;
          if (owner.pending) await rm(join(this.root, room.id, owner.pending.id), { recursive: true, force: true });
          const id = randomBytes(16).toString('hex');
          const pendingFiles: ManifestFile[] = entries.map(entry => { const file = entry as PreparedFile; return { name: file.name, hash: file.hash, size: file.size }; });
          const pending: PendingUpload = { id, reserved: bytes, files: pendingFiles, uploads: new Map(missing.map(([hash, size]) => [hash, { size, chunks: new Set<number>(), writing: new Map<number, WritingChunk>() }])) };
          owner.pending = pending;
          await mkdir(join(this.root, room.id, id), { recursive: true, mode: 0o700 });
          json(response, { id, chunkSize, missing: missing.map(([hash]) => hash) }); return;
        } finally { owner.busy = false; }
      }
      if (request.method === 'POST' && path[4] === 'commit' && state?.current?.id === path[5]) { publish(room, state.current); json(response, state.current); return; }
      const pending = state?.pending;
      if (!state || !pending || pending.id !== path[5] || state.busy) throw fail('素材上传已过期或正在提交', 409);
      if (request.method === 'PUT' && path[4] === 'upload' && path.length === 8) {
        request.setTimeout(30000, () => request.destroy());
        try {
          const result = await this.writeUpload(room, member, path[5] ?? '', path[6] ?? '', Number(path[7]), (expected, progress) => body(request, expected, progress), () => request.destroy(), 'http');
          json(response, result); return;
        } finally { request.setTimeout(0); }
      }
      if (request.method === 'POST' && path[4] === 'commit' && path.length === 6) {
        for (const file of pending.uploads.values()) if (file.writing.size || file.chunks.size !== Math.ceil(file.size / chunkSize)) throw fail('素材尚未上传完整', 409);
        state.busy = true;
        const owner = state;
        try {
          for (const [hash, file] of pending.uploads) {
            const target = join(this.root, room.id, `${hash}.bin`); const temporary = join(this.root, room.id, pending.id, `${hash}.tmp`);
            const handle = await open(temporary, 'w', 0o600); const digest = createHash('sha256');
            try {
              for (let index = 0; index < file.chunks.size; index++) {
                const bytes = await readFile(join(this.root, room.id, pending.id, `${hash}.${index}`)); digest.update(bytes); await handle.writeFile(bytes);
              }
            } finally { await handle.close(); }
            if (digest.digest('hex') !== hash) throw fail('素材校验失败，请重新发送');
            await rename(temporary, target); owner.cached.set(hash, file.size);
          }
          const current: MediaManifest = { id: pending.id, files: pending.files, chunkSize };
          owner.current = current; owner.pending = null; owner.reserved = 0;
          await rm(join(this.root, room.id, pending.id), { recursive: true, force: true });
          const retained = new Set(current.files.map(file => file.hash));
          for (const hash of owner.cached.keys()) if (!retained.has(hash)) {
            try { await rm(join(this.root, room.id, `${hash}.bin`), { force: true }); owner.cached.delete(hash); } catch {}
          }
          publish(room, current); json(response, current); return;
        } finally { owner.busy = false; }
      }
      throw fail('素材接口不存在', 404);
    } finally { this.active--; member.mediaRequests--; }
  }
  async remove(room: string): Promise<void> { this.rooms.delete(room); await rm(join(this.root, room), { recursive: true, force: true }); }
  async close(): Promise<void> { this.closed = true; await Promise.allSettled([...this.tasks]); await rm(this.root, { recursive: true, force: true }); this.rooms.clear(); }
}
