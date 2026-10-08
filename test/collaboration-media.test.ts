import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { CollaborationMedia } from '../src/platform/collaboration-media.ts';
import type { SocketUpload } from '../src/platform/collaboration-media.ts';

/**
 * The options `CollaborationMedia` hands its `request` collaborator.
 *
 * `request` is declared as `(url: URL, init?: RequestInit) => Promise<Response>`, but the doubles
 * below read this module's own members — `headers`/`credentials`/`redirect`/`signal`/`method`/`body`
 * off the options bag. `headers` and `signal` are required here because every double reads
 * `Authorization` off `headers` and calls `signal.addEventListener` directly, exactly as the module
 * builds them (`RequestInit` makes both optional and admits a null signal).
 */
type MediaRequestOptions = RequestInit & { headers: Record<string, string>; signal: AbortSignal };

/**
 * `request` declares the DOM's `RequestInit`; the doubles here accept the narrower
 * `MediaRequestOptions` above, so the function is bridged through `unknown` in this one place
 * rather than widening every double's parameter and re-narrowing it inside.
 */
function mediaRequest(double: unknown): (url: URL, init?: RequestInit) => Promise<Response> {
  const bridged: (url: URL, init?: RequestInit) => Promise<Response> = double as (url: URL, init?: RequestInit) => Promise<Response>;
  return bridged;
}

/**
 * `configure` declares a real `SocketUpload` — it takes the chunk and an `AbortSignal` and resolves
 * with the server's `{ received }` confirmation. The doubles below only count whether the WebSocket
 * fallback was reached at all, so the partial is bridged through `unknown` in this one place.
 */
function socketUpload(double: unknown): SocketUpload {
  const bridged: SocketUpload = double as SocketUpload;
  return bridged;
}

const bytes = Uint8Array.of(1, 2, 3, 4);
const manifest = { id: 'a'.repeat(32), chunkSize: 1024 * 1024, files: [{ name: 'cover.png', size: bytes.length, hash: createHash('sha256').update(bytes).digest('hex') }] };

test('默认请求在上传和下载时保留浏览器 fetch 要求的全局调用对象', async context => {
  const requests: Array<string | undefined> = [];
  context.mock.method(globalThis, 'fetch', async function (this: unknown, url: URL, options: RequestInit) {
    if (this !== globalThis) throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
    requests.push(options.method);
    if (url.pathname.endsWith('/prepare')) return Response.json({ id: manifest.id, chunkSize: manifest.chunkSize, missing: [manifest.files[0].hash] });
    if (url.pathname.includes('/upload/')) return Response.json({ received: bytes.length });
    if (url.pathname.includes('/commit/')) return Response.json(manifest);
    return new Response(bytes);
  });
  const media = new CollaborationMedia();
  context.after(() => media.close());
  media.configure('wss://example.com/collab', 'room', 'test-secret');
  await media.publish([['cover.png', bytes]]);
  let installed = false;
  await media.receive(manifest, async (name: string, received: Uint8Array) => { assert.equal(name, 'cover.png'); assert.deepEqual(received, bytes); installed = true; });
  assert.equal(installed, true); assert.deepEqual(requests, ['POST', 'PUT', 'POST', 'GET']);
});

test('HTTP 素材只将令牌放入认证头，临时下载失败重试且不重复安装相同文件', async () => {
  let requests = 0; let installed = 0;
  const media = new CollaborationMedia({ request: mediaRequest(async (url: URL, options: MediaRequestOptions) => {
    requests++; assert.equal(url.protocol, 'https:'); assert.ok(!url.href.includes('test-secret'));
    assert.equal(options.headers.Authorization, 'Bearer test-secret'); assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
    return requests === 1 ? new Response('{}', { status: 503 }) : new Response(bytes);
  }) });
  media.configure('wss://example.com/collab', 'room', 'test-secret');
  await media.receive(manifest, async (name: string, received: Uint8Array) => { installed++; assert.deepEqual(received, bytes); });
  await media.receive(manifest, async () => { installed++; });
  assert.equal(requests, 2); assert.equal(installed, 1); media.close();
});

test('取消接收会中止在途下载，取消的数据不会安装，之后可以重新接收', async () => {
  let requested!: () => void; const started = new Promise<void>(resolve => { requested = resolve; }); let installed = 0;
  const media = new CollaborationMedia({ request: mediaRequest((url: URL, options: MediaRequestOptions) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }); requested();
  })) });
  media.configure('ws://localhost/collab', 'room', 'test-secret');
  const downloading = media.receive(manifest, async () => { installed++; });
  await started; media.stopReceiving(); await downloading; assert.equal(installed, 0);
  media.request = async () => new Response(bytes);
  await media.receive(manifest, async () => { installed++; }); assert.equal(installed, 1); media.close();
});

test('非法清单及损坏下载不会写入项目', async () => {
  let installed = 0; const media = new CollaborationMedia({ request: async () => new Response(Uint8Array.of(9, 9, 9, 9)) });
  media.configure('ws://localhost/collab', 'room', 'test-secret');
  await assert.rejects(media.receive({ ...manifest, files: [{ ...manifest.files[0], name: '../cover.png' }] }, async () => { installed++; }), /清单无效/);
  await assert.rejects(media.receive(manifest, async () => { installed++; }), /校验失败/);
  assert.equal(installed, 0); media.close();
});

test('取消卡住的上传会清理全部请求且不会启动备用上传', async context => {
  let notifyStarted!: () => void; const started = new Promise<void>(resolve => { notifyStarted = resolve; }); let fallback = 0; let aborted = 0;
  const media = new CollaborationMedia({ request: mediaRequest(async (url: URL, options: MediaRequestOptions) => {
    if (url.pathname.endsWith('/prepare')) return Response.json({ id: manifest.id, chunkSize: manifest.chunkSize, missing: [manifest.files[0].hash] });
    return new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => { aborted++; reject(options.signal.reason); }, { once: true }); notifyStarted();
    });
  }) });
  context.after(() => media.close());
  media.configure('wss://example.com/collab', 'room', 'secret', socketUpload(async () => { fallback++; }));
  const publishing = media.publish([['cover.png', bytes]]); const cancelled = assert.rejects(publishing, (error: unknown) => (error as { name?: string }).name === 'AbortError');
  await started; media.close(); await cancelled;
  assert.equal(aborted, 1); assert.equal(fallback, 0); assert.deepEqual(media.diagnostics.snapshot(), []);
});

test('旧服务器上传停滞时明确提示更新备用通道，不再反复等待三轮超时', async context => {
  const media = new CollaborationMedia({ uploadStallMilliseconds: 30, request: mediaRequest(async (url: URL, options: MediaRequestOptions) => {
    if (url.pathname.endsWith('/prepare')) return Response.json({ id: manifest.id, chunkSize: manifest.chunkSize, missing: [manifest.files[0].hash] });
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
  }) });
  context.after(() => media.close()); media.configure('wss://example.com/collab', 'room', 'secret');
  await assert.rejects(media.publish([['cover.png', bytes]]), /更新协作服务器/);
  assert.deepEqual(media.diagnostics.snapshot(), []);
});

test('分片仍在被服务器接收时延长等待并显示实收进度，不因尚未整块保存就重传', async context => {
  const input = new Uint8Array(65536); const digest = createHash('sha256').update(input).digest('hex'); let fallback = 0;
  const phases: string[] = [];
  const media = new CollaborationMedia({ uploadStallMilliseconds: 200, request: mediaRequest(async (url: URL, options: MediaRequestOptions) => {
    if (url.pathname.endsWith('/prepare')) return Response.json({ id: manifest.id, chunkSize: manifest.chunkSize, missing: [digest] });
    if (url.pathname.includes('/upload/')) {
      return new Promise((resolve, reject) => {
        let received = 0;
        const abort = () => { clearInterval(timer); reject(options.signal.reason); };
        const timer = setInterval(() => {
          received = Math.min(input.length, received + 8192);
          media.dispatchEvent(new CustomEvent('server-progress', { detail: { upload: manifest.id, channel: 'http', phase: 'receiving', fileIndex: 0, index: 0, bytes: received } }));
          if (received === input.length) { clearInterval(timer); options.signal.removeEventListener('abort', abort); resolve(Response.json({ received })); }
        }, 50);
        options.signal.addEventListener('abort', abort, { once: true });
      });
    }
    return Response.json({});
  }) });
  context.after(() => media.close());
  media.addEventListener('progress', (event: Event) => { phases.push((event as CustomEvent<{ phase: string }>).detail.phase); });
  media.configure('wss://example.com/collab', 'room', 'secret', socketUpload(async () => { fallback++; }));
  await media.publish([['song.ogg', input]]);
  assert.equal(fallback, 0); assert.ok(phases.includes('upload-stream')); assert.equal(phases.at(-1), 'published');
});
