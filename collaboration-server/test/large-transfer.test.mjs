import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { WebSocket } from 'ws';
import { startCollaborationServer } from '../server.mjs';
import { createChart, createNote } from '../../src/core/chart.ts';
import { identifyChart } from '../../src/core/collaboration.ts';
import { EditorSession } from '../../src/application/session.ts';
import { CollaborationClient } from '../../src/application/collaboration-client.ts';
import { CollaborationTransport } from '../../src/platform/collaboration-transport.ts';
import { CollaborationPanel } from '../../src/ui/collaboration.ts';
import { assetBase64, sendCollaborationAsset } from '../../src/platform/collaboration-assets.ts';

const checksum = bytes => createHash('sha256').update(bytes).digest('hex');
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function until(predicate) {
  const started = Date.now();
  while (!predicate()) { if (Date.now() - started > 15000) throw new Error('等待联机状态超时'); await delay(10); }
}

test('大谱面与 8 MiB 高熵素材：压缩、免回传、四块背压、下载完整性和旧路径对比', { timeout: 45000 }, async context => {
  const chart = createChart(); chart.META.song = 'test.ogg'; chart.META.background = 'test.png';
  chart.judgeLineList[0].notes = Array.from({ length: 20000 }, (_, index) => createNote(index % 4 + 1, index / 4, index % 1350 - 675));
  const source = identifyChart(chart);
  const assets = new Map([['test.ogg', randomBytes(6 * 1024 * 1024)], ['test.png', randomBytes(2 * 1024 * 1024)]]);
  const previousSocket = globalThis.WebSocket;
  context.after(() => { globalThis.WebSocket = previousSocket; });
  const run = async optimized => {
    globalThis.WebSocket = class extends WebSocket { constructor(url) { super(url, { perMessageDeflate: optimized }); } };
    const diagnostics = []; const service = await startCollaborationServer({ port: 0, onDiagnostic: entry => diagnostics.push(entry) });
    const clients = []; const errors = [];
    const make = chart => {
      const session = new EditorSession(chart); const transport = new CollaborationTransport();
      if (!optimized) {
        const connect = transport.connect.bind(transport);
        transport.connect = (url, hello) => { connect(url, { ...hello, acceptOwnChart: false }); transport.sender.maximumWindow = 16; };
      }
      const client = new CollaborationClient(transport, { session: () => session, receiveChart: chart => { session.history.document = chart; }, notify: (message, level) => { if (level === 'error') errors.push(message); } });
      clients.push(client); return { client, transport, session };
    };
    try {
      const host = make(source); const guest = make(createChart()); guest.transport.subscribeAssets(true);
      const address = `ws://127.0.0.1:${service.port}/collab`;
      const creationStarted = performance.now(); host.client.connect(address, { name: 'Host' }); await until(() => host.client.ready);
      const createdMilliseconds = performance.now() - creationStarted;
      const chartUploadBytes = host.transport.socket._socket.bytesWritten;
      const hostDownloadBytes = host.transport.socket._socket.bytesRead;
      const joinStarted = performance.now(); guest.client.connect(address, { name: 'Guest' }, { room: host.client.room, token: host.client.token });
      await until(() => host.client.requests.length); host.client.approve(host.client.requests[0].request, true); await until(() => guest.client.ready);
      const joinedMilliseconds = performance.now() - joinStarted;
      assert.deepEqual(guest.session.chart, host.session.chart);
      const guestDownloadBytes = guest.transport.socket._socket.bytesRead;
      if (optimized) {
        assert.match(host.transport.socket.extensions, /permessage-deflate/);
        assert.ok(diagnostics.find(entry => entry.phase === 'welcome-queued').chartAccepted);
        assert.ok(hostDownloadBytes < 100000);
      }
      const received = new Map(); const receiver = Object.create(CollaborationPanel.prototype);
      receiver.acceptAssets = { checked: true }; receiver.client = guest.client; receiver.transfers = new Map(); receiver.assetStatus = {};
      receiver.notify = () => {}; receiver.receiveAsset = async (name, bytes) => received.set(name, bytes);
      guest.client.addEventListener('asset', event => receiver.asset(event.detail).catch(error => errors.push(error.message)));
      const sentBefore = host.transport.socket._socket.bytesWritten; const receivedBefore = guest.transport.socket._socket.bytesRead;
      const started = performance.now(); let peakQueued = 0;
      const monitor = setInterval(() => { for (const member of service.rooms.get(host.client.room).members.values()) peakQueued = Math.max(peakQueued, member.socket?.sender.bytes ?? 0); }, 2);
      try {
        for (const [name, bytes] of assets) {
          const digest = checksum(bytes);
          if (optimized) await sendCollaborationAsset(host.transport, name, bytes, digest);
          else {
            const total = Math.ceil(bytes.length / 49152);
            for (let index = 0; index < total; index++) {
              host.transport.send({ type: 'asset', name, hash: digest, index, total, data: assetBase64(bytes.subarray(index * 49152, (index + 1) * 49152)) });
              await delay(40);
            }
          }
          await until(() => received.has(name) || errors.length); assert.deepEqual(errors, []);
          assert.equal(checksum(received.get(name)), digest);
        }
      } finally { clearInterval(monitor); }
      const assetMilliseconds = performance.now() - started;
      const assetUploadBytes = host.transport.socket._socket.bytesWritten - sentBefore;
      const assetDownloadBytes = guest.transport.socket._socket.bytesRead - receivedBefore;
      assert.ok(peakQueued < 4 * 1024 * 1024);
      if (optimized) {
        guest.transport.subscribeAssets(false);
        await until(() => service.rooms.get(host.client.room).members.get(guest.client.id).receiveAssets === false);
        await assert.rejects(sendCollaborationAsset(host.transport, 'test.png', assets.get('test.png'), checksum(assets.get('test.png'))), /没有已开启/);
      }
      assert.deepEqual(errors, []);
      return { createdMilliseconds: Math.round(createdMilliseconds), joinedMilliseconds: Math.round(joinedMilliseconds), chartUploadBytes, hostDownloadBytes, guestDownloadBytes,
        assetMilliseconds: Math.round(assetMilliseconds), assetUploadBytes, assetDownloadBytes, peakQueued };
    } finally { for (const client of clients) client.leave(); await service.close(); }
  };
  const legacy = await run(false); const optimized = await run(true);
  context.diagnostic(JSON.stringify({ chartJsonBytes: Buffer.byteLength(JSON.stringify(source)), assetBytes: 8 * 1024 * 1024, legacy, optimized }));
  assert.ok(optimized.chartUploadBytes < legacy.chartUploadBytes * 0.4);
  assert.ok(optimized.guestDownloadBytes < legacy.guestDownloadBytes * 0.4);
  assert.ok(optimized.assetDownloadBytes < legacy.assetDownloadBytes);
});
