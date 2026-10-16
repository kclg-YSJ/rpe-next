import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyLocalMediaRoute } from '../src/platform/collaboration-local-media.ts';
import { CollaborationMedia } from '../src/platform/collaboration-media.ts';

const proof = 'ab'.repeat(32);
const signature = (nonce: string): string => createHmac('sha256', Buffer.from(proof, 'hex')).update(nonce).digest('hex');

test('本机探测仅访问公布的回环端口，不携带凭据，验证 HMAC 后才采用本地素材地址', async () => {
  const controller = new AbortController(); let requests = 0;
  const route = await verifyLocalMediaRoute(new URL('https://remote.example/collab/media/room/'), { port: 4182, proof }, async (url: URL, options: RequestInit) => {
    requests++; assert.equal(url.origin, 'http://127.0.0.1:4182'); assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
    assert.equal(options.headers, undefined); assert.ok(!url.href.includes(proof));
    return Response.json({ signature: signature(url.pathname.split('/').at(-1)!) });
  }, controller.signal);
  assert.equal(requests, 1); assert.equal(route!.href, 'http://127.0.0.1:4182/collab/media/room/');
});

test('错误服务、重放响应或无效端口均不切换地址', async () => {
  const signal = new AbortController().signal;
  const base = new URL('https://remote.example/collab/media/room/');
  assert.equal(await verifyLocalMediaRoute(base, { port: 4182, proof }, async () => Response.json({ signature: signature('old-nonce') }), signal), null);
  assert.equal(await verifyLocalMediaRoute(base, { port: 4182, proof }, async () => new Response('', { status: 404 }), signal), null);
  for (const port of [0, -1, 65536, '4182']) assert.equal(await verifyLocalMediaRoute(base, { port, proof }, () => { throw new Error('不应探测'); }, signal), null);
  assert.equal(base.hostname, 'remote.example');
});

test('本机服务不可用不阻断公网传输，迟到的探测不能覆盖重连后的地址', async context => {
  const media = new CollaborationMedia({ request: async () => { throw new TypeError('connection refused'); } }); context.after(() => media.close());
  media.configure('wss://remote.example/collab', 'room', 'secret', null, { port: 4182, proof }); await media.routeReady;
  assert.equal(media.base!.hostname, 'remote.example'); assert.equal(media.localRoute, false);
  let complete!: () => void;
  media.request = (url: URL) => new Promise(resolve => { complete = () => resolve(Response.json({ signature: signature(url.pathname.split('/').at(-1)!) })); });
  media.configure('wss://remote.example/collab', 'room', 'secret', null, { port: 4182, proof }); const probing = media.routeReady;
  media.configure('wss://another.example/collab', 'other-room', 'another-secret'); complete(); await probing;
  assert.equal(media.base!.hostname, 'another.example');
});
