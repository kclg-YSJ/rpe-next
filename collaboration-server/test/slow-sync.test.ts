import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket, WebSocketServer } from 'ws';
import type { RawData } from 'ws';
import type { AddressInfo } from 'node:net';
import { startCollaborationServer } from '../server.ts';
import { createChart } from '../../src/core/chart.ts';
import { EditorSession } from '../../src/application/session.ts';
import { CollaborationClient } from '../../src/application/collaboration-client.ts';
import { CollaborationTransport } from '../../src/platform/collaboration-transport.ts';

test('6.6 MB 谱面双向限速且不回 Pong 时，数据及分片确认仍保持连接存活', { timeout: 90000 }, async context => {
  const diagnostics: { phase?: string }[] = []; const service = await startCollaborationServer({ port: 0, onDiagnostic: entry => diagnostics.push(entry) });
  context.after(() => service.close());
  const proxy = new WebSocketServer({ port: 0 }); await new Promise<void>(resolve => proxy.once('listening', () => resolve()));
  const upstreams: WebSocket[] = []; const timers: ReturnType<typeof setInterval>[] = [];
  context.after(async () => { for (const timer of timers) clearInterval(timer); for (const socket of [...proxy.clients, ...upstreams]) socket.terminate(); await new Promise<void>(resolve => proxy.close(() => resolve())); });
  proxy.on('connection', frontend => {
    const backend = new WebSocket(`ws://127.0.0.1:${service.port}/collab`, { autoPong: false }); upstreams.push(backend);
    const upload: RawData[] = []; const download: RawData[] = [];
    frontend.on('message', data => { if ((JSON.parse(String(data)) as { type?: unknown }).type === '$rpeAck') backend.send(data, { binary: false }); else upload.push(data); });
    backend.on('message', data => { if ((JSON.parse(String(data)) as { type?: unknown }).type === '$rpeAck') frontend.send(data, { binary: false }); else download.push(data); });
    const drain = (target: WebSocket, queue: RawData[]): void => { const next = queue.shift(); if (target.readyState === WebSocket.OPEN && next !== undefined) target.send(next, { binary: false }); };
    timers.push(setInterval(() => { drain(backend, upload); drain(frontend, download); }, 22));
    frontend.on('close', () => backend.close()); backend.on('close', () => frontend.close()); backend.on('error', () => {});
  });
  const chart = createChart(); chart.META.song = 'music.ogg'; chart.META.background = 'cover.png'; chart.testPayload = 'x'.repeat(6600000);
  const session = new EditorSession(chart); const transport = new CollaborationTransport(); const failures: string[] = [];
  const connect = transport.connect.bind(transport); transport.connect = (url: string, hello: Record<string, unknown>) => connect(url, { ...hello, acceptOwnChart: false });
  const client = new CollaborationClient(transport, { session: () => session, receiveChart: chart => { session.history.document = chart; }, notify: (message, level) => { if (level === 'error') failures.push(message); } });
  context.after(() => client.leave());
  const started = Date.now();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('限速建房超时：' + failures.join('；'))), 80000);
    const listener = () => {
      if (client.ready) { clearTimeout(timer); client.removeEventListener('change', listener); resolve(); }
      else if (failures.length) { clearTimeout(timer); client.removeEventListener('change', listener); reject(new Error(failures.join('；'))); }
    };
    client.addEventListener('change', listener);
    client.connect(`ws://127.0.0.1:${(proxy.address() as AddressInfo).port}/collab`, { name: 'Slow connection' });
  });
  assert.ok(Date.now() - started > 30000);
  assert.equal((session.chart as unknown as { testPayload: string }).testPayload.length, 6600000);
  assert.equal(session.chart.META.song, 'music.ogg'); assert.deepEqual(failures, []);
  assert.ok(!diagnostics.some((entry: { phase?: string }) => ['sync-timeout', 'heartbeat-timeout'].includes(entry.phase ?? '')));
  assert.ok(!transport.diagnostics.some(entry => entry.phase === 'sync-timeout' || entry.phase === 'socket-close'));
});
