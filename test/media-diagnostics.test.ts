import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { CollaborationMedia, digestBytes } from '../src/platform/collaboration-media.ts';
import { MediaDiagnostics } from '../src/platform/media-diagnostics.ts';
import { CollaborationTransport } from '../src/platform/collaboration-transport.ts';

/**
 * One diagnostic log line as the tests read it back.
 *
 * `MediaDiagnostics` and `CollaborationMedia` are still untyped `.mjs` modules, so the members the
 * assertions touch are declared here rather than imported from a declaration that does not exist
 * yet. Every field is optional because each test only inspects the ones its own stage emits.
 */
interface DiagnosticEntry {
  phase?: string;
  stage?: string;
  endpoint?: string;
  status?: number;
  error?: string;
}

test('等待阶段每十秒记录一次，可在完成前导出活跃阶段，完成后停止', context => {
  context.mock.timers.enable({ apis: ['setInterval'] });
  const entries: DiagnosticEntry[] = []; const diagnostics = new MediaDiagnostics((phase: string, details: Record<string, unknown>) => entries.push({ phase, ...details }));
  const end = diagnostics.start('hash', { bytes: 100, fileIndex: 1, kind: 'image' });
  assert.equal(diagnostics.snapshot()[0].stage, 'hash');
  context.mock.timers.tick(20000); assert.equal(entries.filter(entry => entry.phase === 'media-hash-waiting').length, 2);
  end(); context.mock.timers.tick(10000); end();
  assert.equal(entries.length, 4); assert.deepEqual(diagnostics.snapshot(), []);
});

test('校验完成后等待 prepare 响应不再显示校验，日志不泄露名称地址凭据与哈希', async () => {
  const bytes = Uint8Array.of(1, 2, 3); const hash = createHash('sha256').update(bytes).digest('hex');
  const manifest = { id: 'a'.repeat(32), chunkSize: 1048576, missing: [hash] };
  const transport = new CollaborationTransport(); const media = transport.media; const stages: string[] = [];
  let finishPrepare!: () => void;
  media.configure('wss://private-host.example/collab', 'private-room', 'private-token');
  media.addEventListener('progress', (event: Event) => { stages.push((event as CustomEvent<{ phase: string }>).detail.phase); });
  const preparing = new Promise<void>(resolve => {
    media.request = async (url: URL) => {
      if (url.pathname.endsWith('prepare')) return new Promise(done => { finishPrepare = () => done(Response.json(manifest)); resolve(); });
      return Response.json({ received: bytes.length });
    };
  });
  const publishing = media.publish([['private-cover.png', bytes]]);
  await preparing;
  assert.equal(stages.at(-1), 'prepare');
  assert.ok(media.diagnostics.snapshot().some((entry: DiagnosticEntry) => entry.endpoint === 'prepare'));
  assert.ok(!media.diagnostics.snapshot().some((entry: DiagnosticEntry) => entry.stage === 'hash'));
  finishPrepare(); await publishing;
  assert.deepEqual(media.diagnostics.snapshot(), []);
  const output = JSON.stringify(transport.diagnostics);
  for (const secret of ['private-cover', 'private-host', 'private-room', 'private-token', hash]) assert.ok(!output.includes(secret));
  for (const phase of ['media-hash-start', 'media-hash-complete', 'media-request-start', 'media-response-headers', 'media-request-complete', 'media-publish-complete']) assert.ok(output.includes(phase));
  media.close();
});

test('请求失败、重试和最终状态可定位，错误消息不直接写入日志', async () => {
  const media = new CollaborationMedia({ request: async () => Response.json({ error: 'secret-server-path' }, { status: 403 }) });
  const entries: DiagnosticEntry[] = []; media.addEventListener('diagnostic', (event: Event) => { entries.push((event as CustomEvent<DiagnosticEntry>).detail); });
  media.configure('wss://example.com/collab', 'room', 'secret');
  await assert.rejects(media.publish([['image.png', Uint8Array.of(1)]]), /secret-server-path/);
  assert.ok(entries.some(entry => entry.phase === 'media-request-failed' && entry.status === 403));
  assert.ok(entries.some(entry => entry.phase === 'media-publish-failed'));
  assert.ok(!JSON.stringify(entries).includes('secret')); assert.deepEqual(media.diagnostics.snapshot(), []);
  media.close();
});

test('Worker 握手和摘要阶段单独记录，不把就绪消息误当作校验结果', async context => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Worker'); let terminated = 0;
  /**
   * The `Worker` double this test installs globally.
   *
   * The real `Worker` carries a much wider surface; the module only posts a buffer and assigns
   * `onmessage`, so that partial shape is declared here and bridged through `unknown` once, rather
   * than asserting the class into `typeof Worker`.
   */
  class FakeWorker {
    onmessage?: (event: { data: Record<string, unknown> }) => void;
    postMessage(bytes: Uint8Array): void {
      queueMicrotask(() => {
        this.onmessage!({ data: { phase: 'ready' } }); this.onmessage!({ data: { phase: 'digest-start' } });
        this.onmessage!({ data: { hash: createHash('sha256').update(bytes).digest('hex') } });
      });
    }
    terminate(): void { terminated++; }
  }
  const workerConstructor: unknown = FakeWorker;
  globalThis.Worker = workerConstructor as typeof Worker;
  context.after(() => { if (descriptor) Object.defineProperty(globalThis, 'Worker', descriptor); else Reflect.deleteProperty(globalThis, 'Worker'); });
  const entries: string[] = []; const bytes = Uint8Array.of(4, 5, 6);
  assert.equal(await digestBytes(bytes, undefined, (phase: string) => entries.push(phase)), createHash('sha256').update(bytes).digest('hex'));
  assert.equal(terminated, 1);
  for (const phase of ['hash-copy-start', 'hash-copy-complete', 'hash-worker-posted', 'hash-worker-ready', 'hash-worker-digest-start', 'hash-worker-complete']) assert.ok(entries.includes(phase));
  assert.equal(bytes.length, 3);
});

test('Worker 卡住超时会写入失败阶段并清理活跃任务', async context => {
  context.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  // The module only calls `postMessage`/`terminate`; the stand-in is bridged in this one place.
  const stalled: unknown = class { postMessage() {} terminate() {} };
  globalThis.Worker = stalled as typeof Worker;
  context.after(() => { if (descriptor) Object.defineProperty(globalThis, 'Worker', descriptor); else Reflect.deleteProperty(globalThis, 'Worker'); });
  const media = new CollaborationMedia(); const entries: DiagnosticEntry[] = []; media.addEventListener('diagnostic', (event: Event) => { entries.push((event as CustomEvent<DiagnosticEntry>).detail); });
  const rejected = assert.rejects(media.hash(Uint8Array.of(1), undefined), (error: unknown) => (error as { name?: string }).name === 'TimeoutError');
  context.mock.timers.tick(120000); await rejected;
  assert.ok(entries.some(entry => entry.phase === 'media-hash-worker-timeout'));
  assert.ok(entries.some(entry => entry.phase === 'media-hash-failed' && entry.error === 'TimeoutError'));
  assert.deepEqual(media.diagnostics.snapshot(), []);
});
