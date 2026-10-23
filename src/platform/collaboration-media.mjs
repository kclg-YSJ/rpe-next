import { MediaDiagnostics, mediaErrorCode } from './media-diagnostics.mjs';
import { verifyLocalMediaRoute } from './collaboration-local-media.mjs';
import { t } from '../i18n.mjs';

const hex = bytes => [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');

export async function digestBytes(input, signal = new AbortController().signal, trace = () => {}) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  signal.throwIfAborted();
  trace('hash-capabilities', { bytes: bytes.byteLength, worker: typeof Worker === 'function', subtle: Boolean(globalThis.crypto?.subtle), secure: globalThis.isSecureContext === true });
  if (typeof Worker === 'function' && typeof URL === 'function') {
    let worker;
    try { worker = new Worker(new URL('./collaboration-hash-worker.mjs', import.meta.url), { type: 'module' }); trace('hash-worker-created'); }
    catch (error) { trace('hash-worker-unavailable', { error: mediaErrorCode(error) }); }
    if (worker) {
      try {
        trace('hash-copy-start'); const copy = bytes.slice(); trace('hash-copy-complete', { bytes: copy.byteLength });
        return await new Promise((resolve, reject) => {
          let settled = false;
          const finish = (callback, value) => { if (settled) return; settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort); worker.terminate(); callback(value); };
          const abort = () => finish(reject, signal.reason ?? new DOMException(t('collaboration-media.sf2878ae'), 'AbortError'));
          const timer = setTimeout(() => { trace('hash-worker-timeout'); finish(reject, new DOMException(t('collaboration-media.s082bbe3'), 'TimeoutError')); }, 120000);
          worker.onmessage = event => {
            if (['ready', 'digest-start'].includes(event.data?.phase)) { trace(`hash-worker-${event.data.phase}`); return; }
            if (event.data?.error) { finish(reject, new Error(event.data.error)); return; }
            if (!/^[0-9a-f]{64}$/.test(event.data?.hash)) { finish(reject, new Error(t('collaboration-media.s0ae2cbe'))); return; }
            trace('hash-worker-complete'); finish(resolve, event.data.hash);
          };
          worker.onerror = event => { trace('hash-worker-error'); finish(reject, new Error(t('collaboration-media.s0a67fc5'))); event.preventDefault?.(); };
          worker.onmessageerror = () => finish(reject, new Error(t('collaboration-media.s06b5a75')));
          signal.addEventListener('abort', abort, { once: true });
          if (signal.aborted) { abort(); return; }
          try { worker.postMessage(copy, [copy.buffer]); trace('hash-worker-posted'); }
          catch (error) { finish(reject, error); }
        });
      } catch (error) {
        worker.terminate();
        if (signal.aborted || error.name === 'TimeoutError') throw error;
        trace('hash-worker-fallback', { error: mediaErrorCode(error) });
      }
    }
  }
  trace('hash-native-start');
  const digest = await new Promise((resolve, reject) => {
    const finish = (callback, value) => { clearTimeout(timer); signal.removeEventListener('abort', abort); callback(value); };
    const abort = () => finish(reject, signal.reason ?? new DOMException(t('collaboration-media.sf2878ae'), 'AbortError'));
    const timer = setTimeout(() => { trace('hash-native-timeout'); finish(reject, new DOMException(t('collaboration-media.s082bbe3'), 'TimeoutError')); }, 120000);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    Promise.resolve().then(() => crypto.subtle.digest('SHA-256', bytes)).then(value => finish(resolve, value), error => finish(reject, error));
  });
  signal.throwIfAborted();
  trace('hash-native-complete');
  return hex(new Uint8Array(digest));
}

async function parallelJobs(jobs, run, signal, concurrency = 4) {
  let next = 0; let failure;
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
    while (!failure && next < jobs.length) {
      const job = jobs[next++];
      try { signal.throwIfAborted(); await run(job); } catch (error) { failure ??= error; }
    }
  }));
  if (failure) throw failure;
}

export class CollaborationMedia extends EventTarget {
  constructor({ request = globalThis.fetch.bind(globalThis), uploadStallMilliseconds = 15000 } = {}) {
    super(); this.request = request; this.received = new Map(); this.uploadStallMilliseconds = uploadStallMilliseconds;
    this.diagnostics = new MediaDiagnostics((phase, details) => this.trace(phase, details));
  }
  trace(phase, details = {}) { this.dispatchEvent(new CustomEvent('diagnostic', { detail: { phase, ...details } })); }
  async hash(bytes, signal, details = {}) {
    const end = this.diagnostics.start('hash', { bytes: bytes.byteLength, ...details });
    try {
      const value = await digestBytes(bytes, signal, (stage, fields = {}) => this.trace(`media-${stage}`, { ...details, ...fields }));
      end(); return value;
    } catch (error) { end(signal?.aborted ? 'cancelled' : 'failed', { error: mediaErrorCode(error) }); throw error; }
  }
  configure(server, room, token, socketUpload = null, localHint = null, socketResume = null) {
    this.close(); this.received.clear();
    const url = new URL(server); url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
    url.pathname = `/collab/media/${encodeURIComponent(room)}/`; url.search = ''; url.hash = '';
    this.base = url; this.token = token; this.socketUpload = socketUpload; this.socketResume = socketResume;
    this.localRoute = ['127.0.0.1', 'localhost'].includes(url.hostname);
    const controller = new AbortController(); this.routeController = controller;
    const original = url.href;
    this.routeReady = this.localRoute || !localHint ? Promise.resolve() : verifyLocalMediaRoute(url, localHint, (...args) => this.request(...args), controller.signal).then(local => {
      if (controller.signal.aborted || this.base?.href !== original) return;
      if (local) { this.base = local; this.localRoute = true; }
      this.trace('media-local-route', { verified: Boolean(local) });
    }).catch(error => { if (!controller.signal.aborted) this.trace('media-local-route', { verified: false, error: mediaErrorCode(error) }); });
  }
  progress(detail) { this.dispatchEvent(new CustomEvent('progress', { detail })); }
  async fetch(path, options, signal, attempts = 3, timeoutMilliseconds = 60000) {
    for (let attempt = 0; attempt < attempts; attempt++) {
      signal.throwIfAborted();
      const timeout = AbortSignal.timeout(timeoutMilliseconds);
      const route = path.split('/')[0];
      const endpoint = ['prepare', 'upload', 'commit', 'file'].includes(route) ? route : 'unknown';
      const end = this.diagnostics.start('request', { endpoint, attempt: attempt + 1, bytes: options?.body?.byteLength ?? 0 });
      try {
        const response = await this.request(new URL(path, this.base), { ...options, signal: AbortSignal.any([signal, timeout]), credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', cache: 'no-store', headers: { ...options?.headers, Authorization: `Bearer ${this.token}` } });
        this.trace('media-response-headers', { endpoint, attempt: attempt + 1, status: response.status });
        if (!response.ok) {
          const error = new Error((await response.json().catch(() => null))?.error ?? t('collaboration-media.s7ef7aea', { p0: response.status })); error.status = response.status; throw error;
        }
        const result = options?.binary ? new Uint8Array(await response.arrayBuffer()) : await response.json();
        end('complete', { status: response.status }); return result;
      } catch (error) {
        end(signal.aborted ? 'cancelled' : 'failed', { error: mediaErrorCode(error), status: error.status, timedOut: timeout.aborted });
        if (signal.aborted || attempt === attempts - 1 || error.status && ![429, 500, 502, 503, 504].includes(error.status)) throw error;
        this.trace('media-request-retry', { endpoint, nextAttempt: attempt + 2 });
        await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
      }
    }
  }
  async publish(assets) {
    this.upload?.abort(); const controller = new AbortController(); this.upload = controller;
    const signal = controller.signal; const files = [];
    const end = this.diagnostics.start('publish', { files: assets.length });
    try {
      for (const [name, bytes] of assets) {
        signal.throwIfAborted(); this.progress({ phase: 'hash', name });
        const fileIndex = files.length;
        files.push({ name, bytes, size: bytes.length, hash: await this.hash(bytes, signal, { direction: 'upload', fileIndex, kind: /\.(png|jpe?g|webp|gif)$/i.test(name) ? 'image' : 'audio' }) });
      }
      await this.routeReady; signal.throwIfAborted();
      this.progress({ phase: 'prepare' });
      const prepare = await this.fetch('prepare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files: files.map(({ name, size, hash }) => ({ name, size, hash })) }) }, signal);
      if (!/^[0-9a-f]{32}$/.test(prepare.id) || prepare.chunkSize !== 1024 * 1024 || !Array.isArray(prepare.missing) || prepare.missing.length > files.length) throw new Error(t('collaboration-media.sab4b1b7'));
      const unique = new Map(files.map(file => [file.hash, file])); const jobs = [];
      for (const hash of prepare.missing) {
        const file = unique.get(hash); if (!file) throw new Error(t('collaboration-media.s2ffa13e'));
        for (let index = 0; index < Math.ceil(file.size / prepare.chunkSize); index++) jobs.push({ file, index });
      }
      let sent = 0; const total = prepare.missing.reduce((sum, hash) => sum + unique.get(hash).size, 0); const started = performance.now();
      this.trace('media-upload-plan', { chunks: jobs.length, bytes: total, files: files.length, concurrency: 4 });
      this.progress({ phase: 'upload', bytes: 0, total, seconds: 0 });
      const remaining = new Set(jobs); const httpController = new AbortController();
      const httpSignal = AbortSignal.any([signal, httpController.signal]); let stallTimer;
      const arm = () => {
        clearTimeout(stallTimer);
        stallTimer = setTimeout(() => httpController.abort(new DOMException(t('collaboration-media.s5fb9556'), 'TimeoutError')), this.uploadStallMilliseconds);
      };
      const confirm = (job, bytes, channel) => {
        remaining.delete(job); sent += bytes.length;
        this.progress({ phase: 'upload', name: job.file.name, bytes: sent, total, channel, seconds: (performance.now() - started) / 1000 });
      };
      const receiving = event => {
        const progress = event.detail;
        if (httpSignal.aborted || progress.upload !== prepare.id || progress.channel !== 'http' || progress.phase !== 'receiving') return;
        const file = files[progress.fileIndex];
        const job = jobs.find(job => job.file.hash === file?.hash && job.index === progress.index);
        if (!job || !remaining.has(job) || !Number.isSafeInteger(progress.bytes) || progress.bytes <= (job.received ?? 0) || progress.bytes > Math.min(prepare.chunkSize, file.size - progress.index * prepare.chunkSize)) return;
        job.received = progress.bytes; arm();
        const received = sent + [...remaining].reduce((sum, job) => sum + (job.received ?? 0), 0);
        this.progress({ phase: 'upload-stream', name: file.name, bytes: received, total, channel: this.localRoute ? 'local' : 'http', seconds: (performance.now() - started) / 1000 });
      };
      try {
        this.addEventListener('server-progress', receiving);
        if (jobs.length) arm();
        await parallelJobs(jobs, async job => {
          const { file, index } = job; const bytes = file.bytes.subarray(index * prepare.chunkSize, (index + 1) * prepare.chunkSize);
          try {
            const result = await this.fetch(`upload/${prepare.id}/${file.hash}/${index}`, { method: 'PUT', body: bytes }, httpSignal, 1, 300000);
            if (result.received !== bytes.length) throw new Error(t('collaboration-media.s982aa41'));
            confirm(job, bytes, this.localRoute ? 'local' : 'http'); arm();
          } catch (error) { httpController.abort(error); throw error; }
        }, httpSignal);
      } catch (error) {
        signal.throwIfAborted();
        const cause = httpController.signal.reason ?? error;
        if (cause.status && ![429, 500, 502, 503, 504].includes(cause.status)) throw cause;
        clearTimeout(stallTimer);
        if (!this.socketUpload) throw new Error(t('collaboration-media.sb61d301'));
        this.trace('media-upload-fallback', { remainingChunks: remaining.size, confirmedBytes: sent, error: mediaErrorCode(cause) });
        this.progress({ phase: 'upload-fallback', bytes: sent, total });
        if (this.socketResume) {
          const result = await this.socketResume(prepare.id, signal);
          if (!Array.isArray(result.completed) || result.completed.length > jobs.length) throw new Error(t('collaboration-media.s2ce2aa0'));
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
            const result = await this.socketUpload({ upload: prepare.id, hash: file.hash, index, bytes }, signal);
            if (result.received !== bytes.length) throw new Error(t('collaboration-media.s982aa41'));
            confirm(job, bytes, 'socket'); finish();
          } catch (failure) { finish(signal.aborted ? 'cancelled' : 'failed', { error: mediaErrorCode(failure) }); throw failure; }
        }, signal, 2);
      } finally { clearTimeout(stallTimer); this.removeEventListener('server-progress', receiving); }
      this.progress({ phase: 'commit', bytes: sent, total });
      const manifest = await this.fetch(`commit/${prepare.id}`, { method: 'POST' }, signal);
      this.progress({ phase: 'published', count: files.length, skippedBytes: files.reduce((sum, file) => sum + file.size, 0) - total });
      end();
      return manifest;
    } catch (error) { end(signal.aborted ? 'cancelled' : 'failed', { error: mediaErrorCode(error) }); throw error; }
    finally { if (this.upload === controller) this.upload = null; }
  }
  async receive(manifest, install) {
    this.download?.abort(); const controller = new AbortController(); this.download = controller;
    const signal = controller.signal;
    try {
      await this.routeReady; signal.throwIfAborted();
      if (!manifest || !/^[0-9a-f]{32}$/.test(manifest.id) || manifest.chunkSize !== 1024 * 1024 || !Array.isArray(manifest.files) || manifest.files.length > 512) throw new Error(t('collaboration-media.sb682de0'));
      for (const file of manifest.files) {
        if (!file || !/^[0-9a-f]{64}$/.test(file.hash) || typeof file.name !== 'string' || file.name.length > 256 || /(^[/\\]|(^|[/\\])\.\.([/\\]|$)|:)/.test(file.name) || !/\.(png|jpe?g|webp|gif|ogg|mp3|wav|flac|m4a)$/i.test(file.name) || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > 128 * 1024 * 1024) throw new Error(t('collaboration-media.sb682de0'));
      }
      if (manifest.files.reduce((sum, file) => sum + file.size, 0) > 512 * 1024 * 1024) throw new Error(t('collaboration-media.s8b2f997'));
      for (const file of [...manifest.files].sort((left, right) => left.size - right.size)) {
        if (this.received.get(file.name) === file.hash) continue;
        signal.throwIfAborted(); const bytes = new Uint8Array(file.size); let received = 0; const started = performance.now();
        const jobs = Array.from({ length: Math.ceil(file.size / manifest.chunkSize) }, (_, index) => index);
        await parallelJobs(jobs, async index => {
          const part = await this.fetch(`file/${manifest.id}/${file.hash}/${index}`, { method: 'GET', binary: true }, signal);
          const expected = Math.min(manifest.chunkSize, file.size - index * manifest.chunkSize);
          if (part.length !== expected) throw new Error(t('collaboration-media.s7853877'));
          bytes.set(part, index * manifest.chunkSize); received += part.length;
          this.progress({ phase: 'download', name: file.name, bytes: received, total: file.size, channel: this.localRoute ? 'local' : 'http', seconds: (performance.now() - started) / 1000 });
        }, signal);
        this.progress({ phase: 'verify', name: file.name, bytes: file.size, total: file.size, seconds: (performance.now() - started) / 1000 });
        if (await this.hash(bytes, signal, { direction: 'download', fileIndex: manifest.files.indexOf(file), kind: /\.(png|jpe?g|webp|gif)$/i.test(file.name) ? 'image' : 'audio' }) !== file.hash) { this.trace('media-hash-mismatch'); throw new Error(t('collaboration-media.sf216ee0')); }
        signal.throwIfAborted(); const installed = this.diagnostics.start('install', { fileIndex: manifest.files.indexOf(file), bytes: file.size });
        try { await install(file.name, bytes); signal.throwIfAborted(); this.received.set(file.name, file.hash); installed(); }
        catch (error) { installed('failed', { error: mediaErrorCode(error) }); throw error; }
      }
      this.progress({ phase: 'received', count: manifest.files.length });
    } catch (error) { if (!signal.aborted) throw error; }
    finally { if (this.download === controller) this.download = null; }
  }
  stopReceiving() { this.download?.abort(); this.download = null; }
  close() { this.upload?.abort(); this.upload = null; this.stopReceiving(); this.routeController?.abort(); this.routeReady = null; this.localRoute = false; this.token = null; this.base = null; this.socketUpload = null; this.socketResume = null; }
}
