import test from 'node:test';
import assert from 'node:assert/strict';
import { saveSnapshot } from '../src/platform/recovery.ts';
import { createChart } from '../src/core/chart.ts';
import { snapshotParts, applySnapshotPart } from '../src/platform/recovery-transfer.ts';
import type { SnapshotPart } from '../src/platform/recovery-transfer.ts';
import type { TestContext } from 'node:test';

/** The fake Worker the recovery transfer is pointed at in these tests. */
interface FakeWorker {
  url: URL;
  options: { type?: string };
  terminated: boolean;
  messages: ({ kind?: string; bytes?: Uint8Array } & Record<string, unknown>)[];
  metadata?: { viewState: { lineIndex: number } };
  chart?: unknown;
  onmessage: (event: { data: { ok?: boolean; message?: string; ready?: boolean } }) => void;
  onerror: (event: { message: string }) => void;
  onmessageerror: () => void;
  postMessage(data: Record<string, unknown>, transfer?: Transferable[]): void;
  terminate(): void;
}

function workers(context: TestContext, postMessage?: (this: FakeWorker, copy: Record<string, unknown>) => void): FakeWorker[] {
  const jobs: FakeWorker[] = [];
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  context.after(() => { if (previous) Object.defineProperty(globalThis, 'Worker', previous); else delete (globalThis as { Worker?: typeof Worker }).Worker; });
  globalThis.Worker = class {
    url: URL; options: { type?: string }; terminated: boolean; messages: ({ kind?: string; bytes?: Uint8Array } & Record<string, unknown>)[]; metadata?: { viewState: { lineIndex: number } }; chart?: unknown;
    onmessage!: FakeWorker['onmessage']; onerror!: FakeWorker['onerror']; onmessageerror!: FakeWorker['onmessageerror'];
    constructor(url: URL, options: { type?: string }) {
      this.url = url; this.options = options; this.terminated = false; this.messages = []; jobs.push(this);
      queueMicrotask(() => this.onmessage({ data: { ready: true } }));
    }
    postMessage(data: Record<string, unknown>, transfer?: Transferable[]): void {
      const copy = structuredClone(data, { transfer }); this.messages.push(copy);
      if (postMessage) { postMessage.call(this, copy); return; }
      if (copy.kind === 'begin') this.metadata = copy as unknown as { viewState: { lineIndex: number } };
      if (copy.kind === 'chart') this.chart = applySnapshotPart(this.chart, copy.part as SnapshotPart);
      if (copy.kind !== 'commit') queueMicrotask(() => this.onmessage({ data: { ok: true } }));
    }
    terminate(): void { this.terminated = true; }
  } as unknown as typeof Worker;
  return jobs;
}

test('恢复备份交给后台并保留调用时的谱面、素材和视图', async context => {
  const jobs = workers(context); const chart = createChart();
  const assets: [string, Uint8Array][] = [['music.ogg', new Uint8Array([1, 2])]];
  const saving = saveSnapshot('project', 'chart.json', chart, assets, 3, { lineIndex: 2 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(jobs.length, 1); const worker = jobs[0]!;
  assert.ok(worker.url.pathname.endsWith('/recovery-worker.ts'));
  assert.equal(worker.options.type, 'module'); assert.equal(worker.terminated, false);
  assert.deepEqual(worker.chart, chart);
  assert.deepEqual([...worker.messages.find(message => message.kind === 'asset')!.bytes!], [1, 2]); assert.equal(worker.metadata!.viewState.lineIndex, 2);
  worker.onmessage({ data: { ok: true } }); await saving;
  assert.equal(worker.terminated, true);
});

test('后台备份写入、通信与启动失败均会向调用方报告且清理 Worker', async context => {
  const jobs = workers(context);
  for (const fail of [
    (worker: FakeWorker) => worker.onmessage({ data: { ok: false, message: 'quota exceeded' } }),
    (worker: FakeWorker) => worker.onerror({ message: 'worker failed' }),
    (worker: FakeWorker) => worker.onmessageerror(),
  ]) {
    const saving = saveSnapshot('project', 'chart.json', createChart(), []);
    await new Promise(resolve => setImmediate(resolve));
    const worker = jobs.at(-1)!; fail(worker);
    await assert.rejects(saving); assert.equal(worker.terminated, true);
  }
});

test('无法传入后台的数据不挂起备份', async context => {
  const jobs = workers(context, function () { throw new Error('cannot send'); });
  await assert.rejects(saveSnapshot('project', 'chart.json', createChart(), []), /cannot send/);
  assert.equal(jobs[0]!.terminated, true);
});

test('分批重组保留未知字段、整体轨迹和长数组，素材原缓冲区不被转移', async context => {
  const chart = createChart();
  (chart as unknown as Record<string, unknown>).extra = { list: Array.from({ length: 1000 }, (_, id) => ({ id, startTime: [id, 0, 1], vars: { nested: [{ text: '中文' }] } })), color: [0, 127, 255], empty: [] };
  let restored: unknown; for (const part of snapshotParts(chart)) restored = applySnapshotPart(restored, structuredClone(part));
  assert.deepEqual(restored, chart);
  const jobs = workers(context); const bytes = new Uint8Array(3 * 1024 * 1024 + 1); bytes[bytes.length - 1] = 255;
  const saving = saveSnapshot('project', 'chart.json', chart, [['music.ogg', bytes]]);
  await new Promise(resolve => setImmediate(resolve));
  const chunks = jobs[0]!.messages.filter(message => message.kind === 'asset');
  assert.equal(chunks.length, 4); assert.ok(chunks.every(chunk => chunk.bytes!.length <= 1024 * 1024));
  assert.equal(bytes.byteLength, 3 * 1024 * 1024 + 1); assert.equal(bytes.at(-1), 255);
  jobs[0]!.onmessage({ data: { ok: true } }); await saving;
});
