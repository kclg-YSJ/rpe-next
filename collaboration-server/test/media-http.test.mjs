import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import { startCollaborationServer } from '../server.mjs';
import { createChart } from '../../src/core/chart.ts';
import { EditorSession } from '../../src/application/session.ts';
import { CollaborationClient } from '../../src/application/collaboration-client.ts';
import { CollaborationTransport } from '../../src/platform/collaboration-transport.ts';

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function until(predicate) {
  const started = Date.now();
  while (!predicate()) { if (Date.now() - started > 10000) throw new Error('联机素材测试超时'); await wait(10); }
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function room(context) {
  const service = await startCollaborationServer({ port: 0 }); const failures = []; const clients = [];
  context.after(async () => { for (const peer of clients) peer.client.leave(); await service.close(); });
  const address = `ws://127.0.0.1:${service.port}/collab`;
  const make = () => {
    const transport = new CollaborationTransport(); const session = new EditorSession(createChart());
    const client = new CollaborationClient(transport, { session: () => session, receiveChart: chart => { session.history.document = chart; }, notify: (message, level) => { if (level === 'error') failures.push(message); } });
    const received = new Map(); const manifests = [];
    let welcome;
    transport.addEventListener('message', event => { if (event.detail.type === 'welcome') welcome = event.detail; });
    client.addEventListener('asset-manifest', event => {
      manifests.push(event.detail);
      transport.media.receive(event.detail, async (name, bytes) => received.set(name, bytes)).catch(error => failures.push(error.message));
    });
    const peer = { client, transport, received, manifests, get welcome() { return welcome; } }; clients.push(peer); return peer;
  };
  const host = make(); host.client.connect(address, { name: 'Host' }); await until(() => host.client.ready);
  const join = async (enabled = false) => {
    const peer = make(); peer.transport.subscribeAssets(enabled);
    peer.client.connect(address, { name: 'Guest' }, { room: host.client.room, token: host.client.token });
    await until(() => host.client.requests.length); host.client.approve(host.client.requests[0].request, true); await until(() => peer.client.ready); return peer;
  };
  return { service, host, join, failures };
}

test('无人接收也能发布；晚加入勾选自动补收、更新整组、复用相同文件与断线后的授权隔离', { timeout: 20000 }, async context => {
  const { host, join, failures } = await room(context);
  const audio = randomBytes(3 * 1024 * 1024 + 13); const cover = randomBytes(1024 * 1024 + 19);
  const published = await host.transport.media.publish([['song.ogg', audio], ['cover.png', cover]]);
  const guest = await join(false); await wait(50); assert.equal(guest.manifests.length, 0);
  guest.transport.subscribeAssets(true); await until(() => guest.received.size === 2 || failures.length);
  assert.deepEqual(failures, []); assert.equal(hash(guest.received.get('song.ogg')), hash(audio)); assert.equal(hash(guest.received.get('cover.png')), hash(cover));
  assert.equal(guest.manifests[0].id, published.id);
  const upload = []; host.transport.media.addEventListener('progress', event => upload.push(event.detail));
  const replacement = randomBytes(100000);
  const next = await host.transport.media.publish([['song.ogg', audio], ['cover.png', replacement]]);
  await until(() => guest.received.get('cover.png')?.length === replacement.length);
  assert.equal(hash(guest.received.get('cover.png')), hash(replacement));
  assert.equal(upload.filter(entry => entry.phase === 'upload').at(-1).total, replacement.length);
  const third = await join(true); await until(() => third.received.size === 2);
  assert.equal(third.manifests[0].id, next.id); assert.equal(hash(third.received.get('cover.png')), hash(replacement));
  const url = new URL(`file/${next.id}/${hash(audio)}/0`, guest.transport.media.base); const credential = guest.transport.media.token;
  assert.equal((await fetch(url)).status, 403);
  assert.equal((await fetch(new URL('prepare', guest.transport.media.base), { method: 'POST', headers: { Authorization: `Bearer ${credential}` }, body: '{}' })).status, 403);
  assert.equal((await fetch(url, { method: 'OPTIONS', headers: { Origin: 'https://example.com', 'Access-Control-Request-Headers': 'authorization' } })).status, 204);
  guest.client.leave(); await wait(20);
  assert.equal((await fetch(url, { headers: { Authorization: `Bearer ${credential}` } })).status, 403);
  assert.deepEqual(failures, []);
});

test('高时延下实际四路二进制并发，慢成员不阻塞房主发布或另一成员下载', { timeout: 20000 }, async context => {
  const { host, join, failures } = await room(context);
  const bytes = randomBytes(8 * 1024 * 1024); let inFlight = 0; let peak = 0;
  host.transport.media.request = async (...args) => {
    inFlight++; peak = Math.max(peak, inFlight);
    try { await wait(120); return await fetch(...args); } finally { inFlight--; }
  };
  const slow = await join(true); const fast = await join(true);
  slow.transport.media.request = async (...args) => { await wait(800); return fetch(...args); };
  const started = performance.now(); await host.transport.media.publish([['large.ogg', bytes]]); const uploadMilliseconds = performance.now() - started;
  await until(() => fast.received.size === 1 || failures.length); const fastMilliseconds = performance.now() - started;
  assert.equal(peak, 4); assert.equal(slow.received.size, 0);
  assert.equal(hash(fast.received.get('large.ogg')), hash(bytes));
  await until(() => slow.received.size === 1 || failures.length); assert.equal(hash(slow.received.get('large.ogg')), hash(bytes));
  assert.deepEqual(failures, []);
  context.diagnostic(JSON.stringify({ bytes: bytes.length, simulatedRequestLatencyMs: 120, concurrentRequests: peak, uploadMilliseconds: Math.round(uploadMilliseconds), fastMemberMilliseconds: Math.round(fastMilliseconds), slowMemberMilliseconds: Math.round(performance.now() - started) }));
});

test('不完整上传与错误哈希不会覆盖最近已发布的素材组', async context => {
  const { host, join } = await room(context); const media = host.transport.media; const signal = new AbortController().signal;
  const previous = await media.publish([['cover.png', Uint8Array.of(1, 2, 3)]]);
  const invalidHash = 'a'.repeat(64);
  const pending = await media.fetch('prepare', { method: 'POST', body: JSON.stringify({ files: [{ name: 'cover.png', hash: invalidHash, size: 3 }] }) }, signal);
  await assert.rejects(media.fetch(`commit/${pending.id}`, { method: 'POST' }, signal), /尚未上传完整/);
  await media.fetch(`upload/${pending.id}/${invalidHash}/0`, { method: 'PUT', body: Uint8Array.of(4, 5, 6) }, signal);
  await assert.rejects(media.fetch(`commit/${pending.id}`, { method: 'POST' }, signal), /校验失败/);
  const guest = await join(true); await until(() => guest.received.size === 1);
  assert.equal(guest.manifests[0].id, previous.id); assert.deepEqual(guest.received.get('cover.png'), Uint8Array.of(1, 2, 3));
});

for (const stalledStage of ['before-body', 'partial-body', 'after-store']) {
  test(`真实 HTTP 代理阻塞 ${stalledStage} 时自动切换联机通道，晚加入仍可补收完整素材`, { timeout: 20000 }, async context => {
    const { service, host, join, failures } = await room(context);
    const upstreams = []; let stalled = 0;
    const proxy = createServer((request, response) => {
      const uploading = request.method === 'PUT';
      if (uploading) stalled++;
      if (uploading && stalledStage === 'before-body') { request.resume(); return; }
      const upstream = httpRequest({ hostname: '127.0.0.1', port: service.port, path: request.url, method: request.method, headers: request.headers }, incoming => {
        if (uploading) incoming.resume();
        else { response.writeHead(incoming.statusCode, incoming.headers); incoming.pipe(response); }
      });
      upstreams.push(upstream); upstream.on('error', () => response.destroy());
      request.on('error', () => {});
      if (uploading && stalledStage === 'partial-body') { request.once('data', bytes => upstream.write(bytes.subarray(0, 4096))); request.resume(); }
      else request.pipe(upstream);
    });
    await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
    context.after(async () => { for (const upstream of upstreams) upstream.destroy(); proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve)); });
    const media = host.transport.media; media.base.port = String(proxy.address().port); media.uploadStallMilliseconds = 500;
    const audio = randomBytes(4 * 1024 * 1024 + 27); const image = randomBytes(436409); const asset = randomBytes(54493);
    const stages = []; media.addEventListener('progress', event => stages.push(event.detail.phase));
    const started = performance.now();
    const published = await media.publish([['private-music.ogg', audio], ['private-cover.png', image], ['private-texture.png', asset]]);
    assert.equal(stalled, 4); assert.ok(stages.includes('upload-fallback')); assert.ok(stages.includes('upload-transfer'));
    if (stalledStage === 'after-store') assert.equal(host.transport.diagnostics.filter(entry => entry.phase === 'media-socket-upload-start').length, 3, '已被服务器保存的四块不得再次发送');
    assert.equal(media.diagnostics.snapshot().length, 0); assert.equal(host.transport.mediaReceipts.size, 0);
    const guest = await join(true); await until(() => guest.received.size === 3 || failures.length);
    assert.deepEqual(failures, []); assert.equal(guest.manifests[0].id, published.id);
    assert.equal(hash(guest.received.get('private-music.ogg')), hash(audio));
    assert.equal(hash(guest.received.get('private-cover.png')), hash(image));
    assert.equal(hash(guest.received.get('private-texture.png')), hash(asset));
    const diagnostics = JSON.stringify(host.transport.diagnostics);
    assert.ok(diagnostics.includes('media-server-stored'));
    if (stalledStage !== 'before-body') assert.ok(host.transport.diagnostics.some(entry => entry.phase === 'media-server-receiving' && entry.channel === 'http'));
    if (stalledStage === 'partial-body') assert.ok(host.transport.diagnostics.some(entry => entry.phase === 'media-server-failed' && entry.channel === 'http'));
    for (const privateValue of ['private-music', 'private-cover', 'private-texture', media.token, hash(audio), media.base.href]) assert.ok(!diagnostics.includes(privateValue));
    context.diagnostic(JSON.stringify({ stalledStage, milliseconds: Math.round(performance.now() - started), bytes: audio.length + image.length + asset.length }));
  });
}

test('备用上传只允许房主操作，错误内容也必须通过服务器最终哈希校验', async context => {
  const { host, join } = await room(context); const guest = await join(false);
  const media = host.transport.media; const signal = new AbortController().signal;
  const original = Uint8Array.of(1, 2, 3); const digest = hash(original);
  const pending = await media.fetch('prepare', { method: 'POST', body: JSON.stringify({ files: [{ name: 'cover.png', hash: digest, size: 3 }] }) }, signal);
  const chunk = { upload: pending.id, hash: digest, index: 0, bytes: original };
  await assert.rejects(guest.transport.uploadMediaChunk(chunk, signal), /房主/);
  await assert.rejects(guest.transport.requestMediaUpload({ type: 'media-upload-resume', upload: pending.id }, signal), /房主/);
  await host.transport.uploadMediaChunk({ ...chunk, bytes: Uint8Array.of(4, 5, 6) }, signal);
  await assert.rejects(media.fetch(`commit/${pending.id}`, { method: 'POST' }, signal), /校验失败/);
  await host.transport.uploadMediaChunk(chunk, signal);
  await media.fetch(`commit/${pending.id}`, { method: 'POST' }, signal);
  guest.transport.subscribeAssets(true); await until(() => guest.received.size === 1);
  assert.deepEqual(guest.received.get('cover.png'), original);
});

test('公网建房的同机房主经验证直传，接收成员仍沿公网代理下载且无本机探测', { timeout: 15000 }, async context => {
  const { service, host, join, failures } = await room(context); const guest = await join(true);
  assert.ok(host.welcome.mediaLocal); assert.equal(guest.welcome.mediaLocal, undefined);
  let downloads = 0;
  const proxy = createServer((request, response) => {
    if (request.url.includes('/file/')) downloads++;
    const upstream = httpRequest({ hostname: '127.0.0.1', port: service.port, path: request.url, method: request.method, headers: request.headers }, incoming => { response.writeHead(incoming.statusCode, incoming.headers); incoming.pipe(response); });
    upstream.on('error', () => response.destroy()); request.pipe(upstream);
  });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  context.after(async () => { proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve)); });
  const guestBase = new URL(guest.transport.media.base); guestBase.port = String(proxy.address().port);
  guest.transport.media.base = guestBase; guest.transport.media.localRoute = false;
  const media = host.transport.media;
  media.request = async (url, options) => { assert.equal(url.hostname, '127.0.0.1', '房主素材不得绕行公网'); return fetch(url, options); };
  media.configure('wss://public-tunnel.example/collab', host.client.room, host.welcome.mediaToken, null, host.welcome.mediaLocal);
  const audio = randomBytes(6386962); const cover = randomBytes(436409); const texture = randomBytes(54493);
  const started = performance.now();
  await media.publish([['song.ogg', audio], ['cover.png', cover], ['texture.png', texture]]);
  const uploadMilliseconds = Math.round(performance.now() - started);
  await until(() => guest.received.size === 3 || failures.length);
  assert.equal(media.localRoute, true); assert.ok(downloads >= 9);
  assert.equal(guest.transport.media.base.href, guestBase.href); assert.equal(guest.transport.media.localRoute, false);
  assert.equal(hash(guest.received.get('song.ogg')), hash(audio)); assert.equal(hash(guest.received.get('cover.png')), hash(cover)); assert.equal(hash(guest.received.get('texture.png')), hash(texture));
  assert.deepEqual(failures, []);
  const diagnostics = JSON.stringify(host.transport.diagnostics); assert.ok(!diagnostics.includes(host.welcome.mediaLocal.proof)); assert.ok(!diagnostics.includes(host.welcome.mediaToken));
  context.diagnostic(JSON.stringify({ bytes: audio.length + cover.length + texture.length, verifiedLocalUploadMilliseconds: uploadMilliseconds, remoteProxyDownloadRequests: downloads }));
});

test('备用大素材后释放鼠标、时间与锁状态不会触发限流通知，编辑消息不丢失', { timeout: 10000 }, async context => {
  const { service, host, failures } = await room(context); const media = host.transport.media; const signal = new AbortController().signal;
  const bytes = randomBytes(1024 * 1024); const digest = hash(bytes);
  const pending = await media.fetch('prepare', { method: 'POST', body: JSON.stringify({ files: [{ name: 'song.ogg', hash: digest, size: bytes.length }] }) }, signal);
  const socket = host.transport.sender.socket; let blocked = true;
  host.transport.sender.socket = { get readyState() { return socket.readyState; }, get bufferedAmount() { return blocked ? 600000 : socket.bufferedAmount; }, send(frame) { socket.send(frame); } };
  const uploading = host.transport.uploadMediaChunk({ upload: pending.id, hash: digest, index: 0, bytes }, signal);
  for (let index = 0; index < 600; index++) {
    host.transport.send({ type: 'presence', seconds: index, line: 0 });
    host.transport.send({ type: 'ping', time: Date.now() }); host.transport.send({ type: 'locks', ids: [] });
  }
  host.client.commit('队列中的修改', { ...host.client.session.chart, META: { ...host.client.session.chart.META, name: 'kept' } });
  assert.equal(host.transport.sender.queue.length, 5); blocked = false; host.transport.sender.pump();
  await uploading; await until(() => host.client.queue.length === 0); await wait(100);
  assert.deepEqual(failures, []); assert.equal(service.rooms.get(host.client.room).members.get(host.client.id).presence.seconds, 599);
  assert.equal(service.rooms.get(host.client.room).chart.META.name, 'kept');
  await media.fetch(`commit/${pending.id}`, { method: 'POST' }, signal);
});
