import { MediaDiagnostics, mediaErrorCode } from './media-diagnostics.ts';
import { verifyLocalMediaRoute } from './collaboration-local-media.ts';
import type { LocalMediaHint } from './collaboration-local-media.ts';

const hex = (bytes: Uint8Array): string => [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');

/** The `name` of a thrown value; DOM exceptions carry their code here. */
const errorName = (error: unknown): string => error !== null && typeof error === 'object' && typeof (error as { name?: unknown }).name === 'string' ? (error as { name: string }).name : '';

/** The HTTP status a failed request attached, when it attached one. */
const statusOf = (error: unknown): number | undefined => error !== null && typeof error === 'object' ? (error as { status?: number }).status : undefined;

/** The server's `error` field, when the response body carries one. */
const serverError = (payload: unknown): string | undefined => payload !== null && typeof payload === 'object' && typeof (payload as { error?: unknown }).error === 'string' ? (payload as { error: string }).error : undefined;

/** An error carrying the HTTP status that produced it. */
interface MediaHttpError extends Error { status?: number }

/** A request as this module issues it; `binary` asks `fetch` to return the raw body. */
interface MediaRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  binary?: boolean;
}

/** One asset being published. */
export interface UploadFile { name: string; bytes: Uint8Array; size: number; hash: string }

/** One chunk of one asset. `received` tracks the server's partial confirmation during a fallback. */
interface UploadJob { file: UploadFile; index: number; received?: number }

/** The server's reply to `prepare`. */
interface PrepareResponse { id: string; chunkSize: number; missing: string[] }

/** The server's reply to a chunk upload. */
interface ChunkResponse { received: number }

/** One entry of a published asset manifest. */
export interface ManifestFile { hash: string; name: string; size: number }

/** A published asset group. */
export interface MediaManifest { id: string; chunkSize: number; files: ManifestFile[] }

/** The server's reply to a resume query. */
interface ResumeResponse { completed: { hash: string; index: number }[] }

/** A `server-progress` event for a chunk being written to disk. */
interface ServerProgress { upload: string; channel: string; phase: string; fileIndex: number; index: number; bytes: number }

/** Uploads one chunk over the WebSocket fallback channel. */
export type SocketUpload = (chunk: { upload: string; hash: string; index: number; bytes: Uint8Array }, signal: AbortSignal) => Promise<ChunkResponse>;
/** Asks the server which chunks of a stalled upload it already holds. */
export type SocketResume = (upload: string, signal: AbortSignal) => Promise<ResumeResponse>;

/**
 * Hashes bytes with SHA-256.
 *
 * A worker is preferred so a large asset does not block the frame; every worker failure except an
 * abort or the 120-second timeout falls back to `crypto.subtle` on the main thread, and the trace
 * records which path ran, because the desktop smoke test asserts on those phase names.
 */
export async function digestBytes(input: Uint8Array | ArrayBuffer, signal: AbortSignal = new AbortController().signal, trace: (stage: string, details?: Record<string, unknown>) => void = () => {}): Promise<string> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  signal.throwIfAborted();
  trace('hash-capabilities', { bytes: bytes.byteLength, worker: typeof Worker === 'function', subtle: Boolean(globalThis.crypto?.subtle), secure: globalThis.isSecureContext === true });
  if (typeof Worker === 'function' && typeof URL === 'function') {
    let worker: Worker | undefined;
    try { worker = new Worker(new URL('./collaboration-hash-worker.ts', import.meta.url), { type: 'module' }); trace('hash-worker-created'); }
    catch (error) { trace('hash-worker-unavailable', { error: mediaErrorCode(error) }); }
    if (worker) {
      try {
        trace('hash-copy-start'); const copy = bytes.slice(); trace('hash-copy-complete', { bytes: copy.byteLength });
        return await new Promise<string>((resolve, reject) => {
          let settled = false;
          // `finish` takes the failure first and the value second, so both `resolve` and `reject` can
          // share one guarded exit that always clears the timer, the abort listener and the worker.
          const finish = (error: unknown, value?: string): void => { if (settled) return; settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort); worker!.terminate(); if (error) reject(error); else resolve(value!); };
          const abort = (): void => finish(signal.reason ?? new DOMException('操作已取消', 'AbortError'));
          const timer = setTimeout(() => { trace('hash-worker-timeout'); finish(new DOMException('素材校验超过 120 秒，请重试', 'TimeoutError')); }, 120000);
          worker!.onmessage = event => {
            const data: { phase?: string; error?: string; hash?: string } | null = event.data;
            if (data?.phase && ['ready', 'digest-start'].includes(data.phase)) { trace(`hash-worker-${data.phase}`); return; }
            if (data?.error) { finish(new Error(data.error)); return; }
            if (!/^[0-9a-f]{64}$/.test(data?.hash ?? '')) { finish(new Error('后台校验结果无效')); return; }
            trace('hash-worker-complete'); finish(null, data!.hash);
          };
          worker!.onerror = event => { trace('hash-worker-error'); finish(new Error('后台素材校验失败')); event.preventDefault?.(); };
          worker!.onmessageerror = () => finish(new Error('后台校验消息无效'));
          signal.addEventListener('abort', abort, { once: true });
          if (signal.aborted) { abort(); return; }
          try { worker!.postMessage(copy, [copy.buffer]); trace('hash-worker-posted'); }
          catch (error) { finish(error); }
        });
      } catch (error) {
        worker.terminate();
        if (signal.aborted || errorName(error) === 'TimeoutError') throw error;
        trace('hash-worker-fallback', { error: mediaErrorCode(error) });
      }
    }
  }
  trace('hash-native-start');
  const digest = await new Promise<ArrayBuffer>((resolve, reject) => {
    const finish = (error: unknown, value?: ArrayBuffer): void => { clearTimeout(timer); signal.removeEventListener('abort', abort); if (error) reject(error); else resolve(value!); };
    const abort = (): void => finish(signal.reason ?? new DOMException('操作已取消', 'AbortError'));
    const timer = setTimeout(() => { trace('hash-native-timeout'); finish(new DOMException('素材校验超过 120 秒，请重试', 'TimeoutError')); }, 120000);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    // See `images.ts`: a `Uint8Array` is a valid `BufferSource` at runtime, but `ArrayBufferLike`
    // admits `SharedArrayBuffer`, which the DOM type excludes. These bytes come from a file or a
    // download, so the backing is always a plain buffer.
    const source = bytes as BufferSource;
    Promise.resolve().then(() => crypto.subtle.digest('SHA-256', source)).then(value => finish(null, value), error => finish(error));
  });
  signal.throwIfAborted();
  trace('hash-native-complete');
  return hex(new Uint8Array(digest));
}

/** Runs `jobs` with bounded concurrency, stopping at the first failure and rethrowing it. */
async function parallelJobs<T>(jobs: T[], run: (job: T) => Promise<void>, signal: AbortSignal, concurrency = 4): Promise<void> {
  let next = 0; let failure: unknown;
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
    while (!failure && next < jobs.length) {
      const job = jobs[next++];
      try { signal.throwIfAborted(); await run(job); } catch (error) { failure ??= error; }
    }
  }));
  if (failure) throw failure;
}

/**
 * Moves chart media between peers through the collaboration server.
 *
 * Publishing hashes each asset, asks the server which blobs it is missing, uploads only the missing
 * chunks, and commits; a stalled HTTP upload falls back to the WebSocket channel, resuming from the
 * server's own list of stored chunks. Receiving validates the manifest before allocating anything and
 * verifies every downloaded file against its advertised hash before installing it.
 */
export class CollaborationMedia extends EventTarget {
  request: (url: URL, init?: RequestInit) => Promise<Response>;
  received: Map<string, string>;
  uploadStallMilliseconds: number;
  diagnostics: MediaDiagnostics;
  base: URL | null;
  token: string | null;
  socketUpload: SocketUpload | null;
  socketResume: SocketResume | null;
  localRoute: boolean;
  routeController: AbortController | null;
  routeReady: Promise<void> | null;
  upload: AbortController | null;
  download: AbortController | null;

  constructor({ request = globalThis.fetch.bind(globalThis), uploadStallMilliseconds = 15000 }: { request?: (url: URL, init?: RequestInit) => Promise<Response>; uploadStallMilliseconds?: number } = {}) {
    super(); this.request = request; this.received = new Map(); this.uploadStallMilliseconds = uploadStallMilliseconds;
    this.base = null; this.token = null; this.socketUpload = null; this.socketResume = null;
    this.localRoute = false; this.routeController = null; this.routeReady = null; this.upload = null; this.download = null;
    this.diagnostics = new MediaDiagnostics((phase, details) => this.trace(phase, details));
  }
  trace(phase: string, details: Record<string, unknown> = {}): void { this.dispatchEvent(new CustomEvent('diagnostic', { detail: { phase, ...details } })); }
  async hash(bytes: Uint8Array, signal: AbortSignal | undefined, details: Record<string, unknown> = {}): Promise<string> {
    const end = this.diagnostics.start('hash', { bytes: bytes.byteLength, ...details });
    try {
      const value = await digestBytes(bytes, signal, (stage, fields = {}) => this.trace(`media-${stage}`, { ...details, ...fields }));
      end(); return value;
    } catch (error) { end(signal?.aborted ? 'cancelled' : 'failed', { error: mediaErrorCode(error) }); throw error; }
  }
  configure(server: string, room: string, token: string, socketUpload: SocketUpload | null = null, localHint: LocalMediaHint | null = null, socketResume: SocketResume | null = null): void {
    this.close(); this.received.clear();
    const url = new URL(server); url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
    url.pathname = `/collab/media/${encodeURIComponent(room)}/`; url.search = ''; url.hash = '';
    this.base = url; this.token = token; this.socketUpload = socketUpload; this.socketResume = socketResume;
    this.localRoute = ['127.0.0.1', 'localhost'].includes(url.hostname);
    const controller = new AbortController(); this.routeController = controller;
    const original = url.href;
    this.routeReady = this.localRoute || !localHint ? Promise.resolve() : verifyLocalMediaRoute(url, localHint, (target, init) => this.request(target, init), controller.signal).then(local => {
      if (controller.signal.aborted || this.base?.href !== original) return;
      if (local) { this.base = local; this.localRoute = true; }
      this.trace('media-local-route', { verified: Boolean(local) });
    }).catch(error => { if (!controller.signal.aborted) this.trace('media-local-route', { verified: false, error: mediaErrorCode(error) }); });
  }
  progress(detail: Record<string, unknown>): void { this.dispatchEvent(new CustomEvent('progress', { detail })); }
  /**
   * Issues one media request, retrying transient failures.
   *
   * `T` names the body the caller expects; the caller is responsible for validating it, exactly as the
   * upstream JavaScript did — the checks are at each call site, not here.
   */
  async fetch<T = Record<string, unknown>>(path: string, options: MediaRequestOptions | undefined, signal: AbortSignal, attempts = 3, timeoutMilliseconds = 60000): Promise<T> {
    for (let attempt = 0; attempt < attempts; attempt++) {
      signal.throwIfAborted();
      const timeout = AbortSignal.timeout(timeoutMilliseconds);
      const route = path.split('/')[0];
      const endpoint = ['prepare', 'upload', 'commit', 'file'].includes(route) ? route : 'unknown';
      const bodyBytes = options?.body && typeof options.body !== 'string' ? options.body.byteLength : 0;
      const end = this.diagnostics.start('request', { endpoint, attempt: attempt + 1, bytes: bodyBytes });
      try {
        // `options` is spread verbatim, exactly as upstream did — including this module's own `binary`
        // flag, which `fetch` ignores. The body is a `Uint8Array`, which the DOM's `BodyInit` accepts
        // at runtime but whose `ArrayBufferLike` backing it excludes — the same gap `images.ts` closes.
        const requestInit: RequestInit = { ...options, body: options?.body as BodyInit | undefined, signal: AbortSignal.any([signal, timeout]), credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', cache: 'no-store', headers: { ...options?.headers, Authorization: `Bearer ${this.token}` } };
        const response = await this.request(new URL(path, this.base!), requestInit);
        this.trace('media-response-headers', { endpoint, attempt: attempt + 1, status: response.status });
        if (!response.ok) {
          const payload: unknown = await response.json().catch(() => null);
          const error: MediaHttpError = Object.assign(new Error(serverError(payload) ?? `素材请求失败（${response.status}）`), { status: response.status }); throw error;
        }
        // `binary` callers expect a `Uint8Array` view, not the raw `ArrayBuffer`, so the wrap is kept.
        const result: T = options?.binary ? new Uint8Array(await response.arrayBuffer()) as T : await response.json() as T;
        end('complete', { status: response.status }); return result;
      } catch (error) {
        const status = statusOf(error);
        end(signal.aborted ? 'cancelled' : 'failed', { error: mediaErrorCode(error), status, timedOut: timeout.aborted });
        if (signal.aborted || attempt === attempts - 1 || (status && ![429, 500, 502, 503, 504].includes(status))) throw error;
        this.trace('media-request-retry', { endpoint, nextAttempt: attempt + 2 });
        await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
      }
    }
    throw new Error('素材请求重试已用尽');
  }
  async publish(assets: [string, Uint8Array][]): Promise<MediaManifest> {
    this.upload?.abort(); const controller = new AbortController(); this.upload = controller;
    const signal = controller.signal; const files: UploadFile[] = [];
    const end = this.diagnostics.start('publish', { files: assets.length });
    try {
      for (const [name, bytes] of assets) {
        signal.throwIfAborted(); this.progress({ phase: 'hash', name });
        const fileIndex = files.length;
        files.push({ name, bytes, size: bytes.length, hash: await this.hash(bytes, signal, { direction: 'upload', fileIndex, kind: /\.(png|jpe?g|webp|gif)$/i.test(name) ? 'image' : 'audio' }) });
      }
      await this.routeReady; signal.throwIfAborted();
      this.progress({ phase: 'prepare' });
      const prepare = await this.fetch<PrepareResponse>('prepare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files: files.map(({ name, size, hash }) => ({ name, size, hash })) }) }, signal);
      if (!/^[0-9a-f]{32}$/.test(prepare.id) || prepare.chunkSize !== 1024 * 1024 || !Array.isArray(prepare.missing) || prepare.missing.length > files.length) throw new Error('服务器素材上传参数无效');
      const unique = new Map(files.map(file => [file.hash, file])); const jobs: UploadJob[] = [];
      for (const hash of prepare.missing) {
        // The server only lists hashes it was just sent, so the lookup cannot miss.
        const file = unique.get(hash)!; if (!file) throw new Error('服务器素材列表无效');
        for (let index = 0; index < Math.ceil(file.size / prepare.chunkSize); index++) jobs.push({ file, index });
      }
      let sent = 0; const total = prepare.missing.reduce((sum, hash) => sum + unique.get(hash)!.size, 0); const started = performance.now();
      this.trace('media-upload-plan', { chunks: jobs.length, bytes: total, files: files.length, concurrency: 4 });
      this.progress({ phase: 'upload', bytes: 0, total, seconds: 0 });
      const remaining = new Set(jobs); const httpController = new AbortController();
      const httpSignal = AbortSignal.any([signal, httpController.signal]); let stallTimer: ReturnType<typeof setTimeout> | undefined;
      const arm = (): void => {
        clearTimeout(stallTimer);
        stallTimer = setTimeout(() => httpController.abort(new DOMException('HTTP 上传连续 15 秒没有分片确认', 'TimeoutError')), this.uploadStallMilliseconds);
      };
      const confirm = (job: UploadJob, bytes: Uint8Array, channel: string): void => {
        remaining.delete(job); sent += bytes.length;
        this.progress({ phase: 'upload', name: job.file.name, bytes: sent, total, channel, seconds: (performance.now() - started) / 1000 });
      };
      const receiving = (event: Event): void => {
        const progress = (event as CustomEvent<ServerProgress>).detail;
        if (httpSignal.aborted || progress.upload !== prepare.id || progress.channel !== 'http' || progress.phase !== 'receiving') return;
        const file = files[progress.fileIndex];
        const job = jobs.find(job => job.file.hash === file?.hash && job.index === progress.index);
        // `file` exists whenever `job` does: every job was built from `files`.
        if (!job || !remaining.has(job) || !Number.isSafeInteger(progress.bytes) || progress.bytes <= (job.received ?? 0) || progress.bytes > Math.min(prepare.chunkSize, file!.size - progress.index * prepare.chunkSize)) return;
        job.received = progress.bytes; arm();
        const received = sent + [...remaining].reduce((sum, job) => sum + (job.received ?? 0), 0);
        this.progress({ phase: 'upload-stream', name: file!.name, bytes: received, total, channel: this.localRoute ? 'local' : 'http', seconds: (performance.now() - started) / 1000 });
      };
      try {
        this.addEventListener('server-progress', receiving);
        if (jobs.length) arm();
        await parallelJobs(jobs, async job => {
          const { file, index } = job; const bytes = file.bytes.subarray(index * prepare.chunkSize, (index + 1) * prepare.chunkSize);
          try {
            const result = await this.fetch<ChunkResponse>(`upload/${prepare.id}/${file.hash}/${index}`, { method: 'PUT', body: bytes }, httpSignal, 1, 300000);
            if (result.received !== bytes.length) throw new Error('服务器分片确认长度不正确');
            confirm(job, bytes, this.localRoute ? 'local' : 'http'); arm();
          } catch (error) { httpController.abort(error); throw error; }
        }, httpSignal);
      } catch (error) {
        signal.throwIfAborted();
        const cause: unknown = httpController.signal.reason ?? error;
        const causeStatus = statusOf(cause);
        if (causeStatus && ![429, 500, 502, 503, 504].includes(causeStatus)) throw cause;
        clearTimeout(stallTimer);
        if (!this.socketUpload) throw new Error('HTTP 素材上传没有完成，请更新协作服务器以启用备用上传通道后重试');
        this.trace('media-upload-fallback', { remainingChunks: remaining.size, confirmedBytes: sent, error: mediaErrorCode(cause) });
        this.progress({ phase: 'upload-fallback', bytes: sent, total });
        if (this.socketResume) {
          const result = await this.socketResume(prepare.id, signal);
          if (!Array.isArray(result.completed) || result.completed.length > jobs.length) throw new Error('服务器续传清单无效');
          const completed = new Set(result.completed.map(part => `${part.hash}:${part.index}`));
          for (const job of remaining) if (completed.has(`${job.file.hash}:${job.index}`)) {
            const bytes = job.file.bytes.subarray(job.index * prepare.chunkSize, (job.index + 1) * prepare.chunkSize);
            confirm(job, bytes, 'socket');
          }
          this.trace('media-upload-resumed', { remainingChunks: remaining.size, confirmedBytes: sent });
        }
        await parallelJobs([...remaining], async job => {
          const { file, index } = job; const bytes = file.bytes.subarray(index * prepare.chunkSize, (index + 1) * prepare.chunkSize);
          const finish = this.diagnostics.start('socket-upload', { index, bytes: bytes.length });
          try {
            const result = await this.socketUpload!({ upload: prepare.id, hash: file.hash, index, bytes }, signal);
            if (result.received !== bytes.length) throw new Error('服务器分片确认长度不正确');
            confirm(job, bytes, 'socket'); finish();
          } catch (failure) { finish(signal.aborted ? 'cancelled' : 'failed', { error: mediaErrorCode(failure) }); throw failure; }
        }, signal, 2);
      } finally { clearTimeout(stallTimer); this.removeEventListener('server-progress', receiving); }
      this.progress({ phase: 'commit', bytes: sent, total });
      const manifest = await this.fetch<MediaManifest>(`commit/${prepare.id}`, { method: 'POST' }, signal);
      this.progress({ phase: 'published', count: files.length, skippedBytes: files.reduce((sum, file) => sum + file.size, 0) - total });
      end();
      return manifest;
    } catch (error) { end(signal.aborted ? 'cancelled' : 'failed', { error: mediaErrorCode(error) }); throw error; }
    finally { if (this.upload === controller) this.upload = null; }
  }
  async receive(manifest: MediaManifest, install: (name: string, bytes: Uint8Array) => Promise<void>): Promise<void> {
    this.download?.abort(); const controller = new AbortController(); this.download = controller;
    const signal = controller.signal;
    try {
      await this.routeReady; signal.throwIfAborted();
      if (!manifest || !/^[0-9a-f]{32}$/.test(manifest.id) || manifest.chunkSize !== 1024 * 1024 || !Array.isArray(manifest.files) || manifest.files.length > 512) throw new Error('素材清单无效');
      for (const file of manifest.files) {
        if (!file || !/^[0-9a-f]{64}$/.test(file.hash) || typeof file.name !== 'string' || file.name.length > 256 || /(^[/\\]|(^|[/\\])\.\.([/\\]|$)|:)/.test(file.name) || !/\.(png|jpe?g|webp|gif|ogg|mp3|wav|flac|m4a)$/i.test(file.name) || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > 128 * 1024 * 1024) throw new Error('素材清单无效');
      }
      if (manifest.files.reduce((sum, file) => sum + file.size, 0) > 512 * 1024 * 1024) throw new Error('素材组超过 512 MiB');
      for (const file of [...manifest.files].sort((left, right) => left.size - right.size)) {
        if (this.received.get(file.name) === file.hash) continue;
        signal.throwIfAborted(); const bytes = new Uint8Array(file.size); let received = 0; const started = performance.now();
        const jobs = Array.from({ length: Math.ceil(file.size / manifest.chunkSize) }, (_, index) => index);
        await parallelJobs(jobs, async index => {
          const part = await this.fetch<Uint8Array>(`file/${manifest.id}/${file.hash}/${index}`, { method: 'GET', binary: true }, signal);
          const expected = Math.min(manifest.chunkSize, file.size - index * manifest.chunkSize);
          if (part.length !== expected) throw new Error('素材下载长度不正确');
          bytes.set(part, index * manifest.chunkSize); received += part.length;
          this.progress({ phase: 'download', name: file.name, bytes: received, total: file.size, channel: this.localRoute ? 'local' : 'http', seconds: (performance.now() - started) / 1000 });
        }, signal);
        this.progress({ phase: 'verify', name: file.name, bytes: file.size, total: file.size, seconds: (performance.now() - started) / 1000 });
        if (await this.hash(bytes, signal, { direction: 'download', fileIndex: manifest.files.indexOf(file), kind: /\.(png|jpe?g|webp|gif)$/i.test(file.name) ? 'image' : 'audio' }) !== file.hash) { this.trace('media-hash-mismatch'); throw new Error('素材校验失败，请重新勾选接收以重试'); }
        signal.throwIfAborted(); const installed = this.diagnostics.start('install', { fileIndex: manifest.files.indexOf(file), bytes: file.size });
        try { await install(file.name, bytes); signal.throwIfAborted(); this.received.set(file.name, file.hash); installed(); }
        catch (error) { installed('failed', { error: mediaErrorCode(error) }); throw error; }
      }
      this.progress({ phase: 'received', count: manifest.files.length });
    } catch (error) { if (!signal.aborted) throw error; }
    finally { if (this.download === controller) this.download = null; }
  }
  stopReceiving(): void { this.download?.abort(); this.download = null; }
  close(): void { this.upload?.abort(); this.upload = null; this.stopReceiving(); this.routeController?.abort(); this.routeReady = null; this.localRoute = false; this.token = null; this.base = null; this.socketUpload = null; this.socketResume = null; }
}
