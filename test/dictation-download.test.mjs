import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { downloadSpeechFile } from '../desktop/dictation-download.mjs';
import { DictationService } from '../desktop/dictation.mjs';

async function fixture(context, bytes = 8 * 1024 ** 2) {
  const root = await mkdtemp(join(tmpdir(), 'rpen-dictation-download-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const data = Buffer.alloc(bytes);
  for (let index = 0; index < data.length; index++) data[index] = index % 251;
  return { root, data, path: join(root, 'speech.download'), signal: new AbortController().signal, algorithm: 'sha256', expected: createHash('sha256').update(data).digest('hex'), urls: ['https://speech.test/model'], timeout: 1000 };
}
function ranged(data, header) {
  const [start, end] = header.slice(6).split('-').map(Number);
  return new Response(data.subarray(start, end + 1), { status: 206, headers: { 'content-range': `bytes ${start}-${end}/${data.length}`, 'content-length': String(end - start + 1) } });
}

test('大模型并行分段写入且按整个文件验证，进度包含字节、速度和源', async context => {
  const options = await fixture(context), requests = [], progress = [];
  let active = 0, maximum = 0;
  const fetcher = async (url, { headers }) => {
    requests.push(headers.Range); maximum = Math.max(maximum, ++active);
    await new Promise(resolve => setTimeout(resolve, 10)); active--;
    return ranged(options.data, headers.Range);
  };
  await downloadSpeechFile({ ...options, fetcher, progress: value => progress.push(value) });
  assert.deepEqual(await readFile(options.path), options.data);
  assert.equal(requests.length, 5); assert.equal(maximum, 4);
  assert.equal(progress.at(-1).bytes, options.data.length); assert.equal(progress.at(-1).stage, 'verify');
  assert.equal(progress.at(-1).source, 'speech.test'); assert.ok(Number.isFinite(progress.at(-1).bytesPerSecond));
});

test('分段网络中断后只续传未完成部分', async context => {
  const options = await fixture(context), starts = []; let interrupted = false;
  const fetcher = async (url, { headers }) => {
    const [start, end] = headers.Range.slice(6).split('-').map(Number); starts.push(start);
    if (start === 0 && end > 0 && !interrupted) {
      interrupted = true; let sent = false;
      return new Response(new ReadableStream({ pull(controller) { if (sent) controller.error(Error('connection reset')); else { sent = true; controller.enqueue(options.data.subarray(0, 65536)); } } }), { status: 206, headers: { 'content-range': `bytes 0-${end}/${options.data.length}` } });
    }
    return ranged(options.data, headers.Range);
  };
  await downloadSpeechFile({ ...options, fetcher });
  assert.ok(starts.includes(65536)); assert.deepEqual(await readFile(options.path), options.data);
});

test('镜像不可用时选择可用源，不必等待坏连接超时', async context => {
  const options = await fixture(context, 256), urls = ['https://blocked.test/model', ...options.urls];
  const fetcher = async (url, { headers, signal }) => {
    if (url.includes('blocked')) return new Promise((resolve, reject) => { signal.addEventListener('abort', () => reject(signal.reason), { once: true }); });
    return headers.Range ? ranged(options.data, headers.Range) : new Response(options.data);
  };
  await downloadSpeechFile({ ...options, urls, fetcher });
  assert.deepEqual(await readFile(options.path), options.data);
});

test('探测响应的后台清理未结束也不阻塞正式下载', async context => {
  const options = await fixture(context, 256);
  await downloadSpeechFile({ ...options, fetcher: async (url, { headers }) => {
    if (headers.Range) return { ok: true, status: 206, headers: new Headers({ 'content-range': 'bytes 0-0/256' }), body: { cancel: () => new Promise(() => {}) } };
    return new Response(options.data);
  } });
  assert.deepEqual(await readFile(options.path), options.data);
});

test('服务器不支持分段时退回完整下载，绝不将完整响应写入每个分段', async context => {
  const options = await fixture(context); let probes = 0;
  await downloadSpeechFile({ ...options, fetcher: async (url, { headers }) => {
    if (headers.Range === 'bytes=0-0') { probes++; return ranged(options.data, headers.Range); }
    return new Response(options.data, { headers: { 'content-length': String(options.data.length) } });
  } });
  assert.equal(probes, 1); assert.deepEqual(await readFile(options.path), options.data);
});

test('等待响应或等待分片时取消均迅速结束并删除未完成文件', async context => {
  for (const waiting of ['connect', 'body']) {
    const options = await fixture(context, 256), controller = new AbortController();
    const pending = downloadSpeechFile({ ...options, signal: controller.signal, fetcher: async (url, { headers }) => {
      if (waiting === 'connect') return new Promise(() => {});
      if (headers.Range) return ranged(options.data, headers.Range);
      return new Response(new ReadableStream({ pull() { return new Promise(() => {}); } }));
    } });
    setTimeout(() => controller.abort(), 30);
    await assert.rejects(pending, error => error.name === 'AbortError');
    assert.deepEqual(await readdir(options.root), []);
  }
});

test('取消与网络流报错同时发生时不遗漏原始请求的拒绝处理', async context => {
  const options = await fixture(context, 512 * 1024), controller = new AbortController();
  let read = false;
  await assert.rejects(downloadSpeechFile({ ...options, signal: controller.signal, fetcher: async (url, { headers }) => {
    if (headers.Range) return ranged(options.data, headers.Range);
    return { ok: true, status: 200, headers: new Headers(), body: { getReader: () => ({
      closed: Promise.resolve(),
      // Trigger both failures from the same read. A zero-delay timer can run
      // after all retries on fast filesystems, before any cancellation exists.
      read: async () => { if (read) { controller.abort(); throw Error('network stream was aborted'); } read = true; return { done: false, value: options.data }; },
      cancel: async () => {},
    }) } };
  } }), error => error.name === 'AbortError');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(await readdir(options.root), []);
});

test('损坏或超出声明大小的文件被拒绝并清理，不覆盖已有文件', async context => {
  const options = await fixture(context, 256);
  await assert.rejects(downloadSpeechFile({ ...options, fetcher: async () => new Response(Buffer.alloc(256)) }), /integrity/);
  assert.deepEqual(await readdir(options.root), []);
  await assert.rejects(downloadSpeechFile({ ...options, maximum: 128, fetcher: async () => new Response(options.data) }), /size limit/);
  assert.deepEqual(await readdir(options.root), []);
  await writeFile(options.path, 'existing');
  await assert.rejects(downloadSpeechFile({ ...options, fetcher: async () => new Response(options.data) }), /EEXIST/);
  assert.equal(await readFile(options.path, 'utf8'), 'existing');
});

test('取消安装同步发布取消中，清理后状态为已取消并保留原配置', async context => {
  const options = await fixture(context, 256), events = [], config = join(options.root, 'dictation.json');
  await writeFile(config, JSON.stringify({ version: 1, root: options.root }));
  let connected;
  const connecting = new Promise(resolve => { connected = resolve; });
  const service = await new DictationService(config, { progress: value => events.push(value), fetcher: () => { connected(); return new Promise(() => {}); } }).initialize();
  const installation = service.install(options.root);
  await connecting;
  assert.deepEqual(service.cancel('install'), { cancelled: true });
  assert.equal(events.at(-1).stage, 'cancelling');
  await assert.rejects(installation, error => error.name === 'AbortError');
  const status = await service.status();
  assert.equal(status.installing, false); assert.equal(status.installation.stage, 'cancelled');
  assert.equal(status.root, options.root); assert.equal(JSON.parse(await readFile(config, 'utf8')).root, options.root);
  assert.deepEqual(await readdir(options.root), ['dictation.json']);
});
