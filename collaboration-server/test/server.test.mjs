import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket, WebSocketServer } from 'ws';
import { startCollaborationServer } from '../server.mjs';
import { createChart, createNote } from '../../src/core/chart.ts';
import { identifyChart, chartChanges, COLLAB_ID } from '../../src/core/collaboration.ts';
import { CollaborationTransport } from '../../src/platform/collaboration-transport.ts';
import { CollaborationClient } from '../../src/application/collaboration-client.ts';
import { EditorSession } from '../../src/application/session.ts';
import { CollaborationMessageReader } from '../../src/core/collaboration-wire.ts';

async function peer(port) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/collab`); const inbox = []; const waiters = [];
  const reader = new CollaborationMessageReader(receipt => socket.send(JSON.stringify(receipt)));
  socket.on('message', data => { const message = reader.read(String(data)); if (!message) return; const index = waiters.findIndex(entry => entry.predicate(message)); if (index >= 0) { const [waiter] = waiters.splice(index, 1); clearTimeout(waiter.timer); waiter.resolve(message); } else inbox.push(message); });
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  return { socket, send: message => socket.send(JSON.stringify(message)), wait: (type, predicate = () => true) => {
    const matches = message => message.type === type && predicate(message); const index = inbox.findIndex(matches); if (index >= 0) return Promise.resolve(inbox.splice(index, 1)[0]);
    return new Promise((resolve, reject) => { const entry = { predicate: matches, resolve, timer: setTimeout(() => { waiters.splice(waiters.indexOf(entry), 1); reject(new Error(`等待 ${type} 超时`)); }, 4000) }; waiters.push(entry); });
  } };
}

test('真实双客户端：邀请批准、对象锁、并行编辑、重复消息、聊天与重连', async context => {
  const service = await startCollaborationServer({ port: 0 }); context.after(() => service.close());
  const host = await peer(service.port); const guest = await peer(service.port); context.after(() => { host.socket.terminate(); guest.socket.terminate(); });
  const chart = createChart(); chart.judgeLineList[0].notes = [createNote(1, 1, 0), createNote(4, 2, 50)]; const base = identifyChart(chart);
  host.send({ type: 'create', chart: base, profile: { name: '房主', color: '#ff9900' } }); const welcome = await host.wait('welcome');
  guest.send({ type: 'join', room: welcome.room, token: welcome.invite, profile: { name: '伙伴' } }); await guest.wait('waiting');
  const request = await host.wait('request'); host.send({ type: 'approve', request: request.request, allow: true }); const joined = await guest.wait('welcome');
  host.send({ type: 'locks', ids: [base.judgeLineList[0].notes[0][COLLAB_ID]] }); await host.wait('lock-result');
  const blocked = structuredClone(base); blocked.judgeLineList[0].notes[0].positionX = 80;
  guest.send({ type: 'edit', operation: 'blocked', changes: chartChanges(base, blocked) }); assert.match((await guest.wait('rejected')).message, /编辑中/);
  const first = structuredClone(base); first.judgeLineList[0].notes[0].positionX = 100;
  const second = structuredClone(base); second.judgeLineList[0].notes[1].positionX = 200;
  host.send({ type: 'edit', operation: 'host-edit', label: '移动', changes: chartChanges(base, first) });
  guest.send({ type: 'edit', operation: 'guest-edit', label: '移动', changes: chartChanges(base, second) });
  await host.wait('edit', message => message.operation === 'guest-edit'); await guest.wait('edit', message => message.operation === 'host-edit');
  assert.deepEqual(service.rooms.get(welcome.room).chart.judgeLineList[0].notes.map(note => note.positionX), [100, 200]);
  guest.send({ type: 'edit', operation: 'guest-edit', changes: chartChanges(base, second) }); await guest.wait('receipt'); assert.equal(service.rooms.get(welcome.room).revision, 2);
  guest.send({ type: 'chat', text: '<script>alert(1)</script>' }); assert.equal((await host.wait('chat')).item.text, '<script>alert(1)</script>');
  guest.send({ type: 'asset', name: '../secret', data: 'x' }); assert.match((await guest.wait('error')).message, /仅房主/);
  guest.socket.terminate(); const resumed = await peer(service.port); context.after(() => resumed.socket.terminate());
  resumed.send({ type: 'join', room: welcome.room, token: welcome.invite, resume: joined.resume }); const state = await resumed.wait('welcome');
  assert.equal(state.id, joined.id); assert.equal(state.revision, 2); assert.equal(state.chart.judgeLineList[0].notes[1].positionX, 200);
});

test('创建密钥与错误邀请被拒绝，健康接口不暴露房间', async context => {
  const service = await startCollaborationServer({ port: 0, creationKey: 'test-only' }); context.after(() => service.close());
  const client = await peer(service.port); context.after(() => client.socket.terminate());
  client.send({ type: 'create', chart: identifyChart(createChart()), profile: {} }); assert.match((await client.wait('error')).message, /密钥/);
  client.send({ type: 'join', room: 'invalid', token: 'invalid' }); assert.match((await client.wait('error')).message, /邀请/);
  const health = await fetch(`http://127.0.0.1:${service.port}/health`).then(response => response.json()); assert.equal(health.protocol, 1); assert.equal(health.rooms, undefined);
});

test('既没有 Pong 也没有有效数据的连接仍由心跳清理', async context => {
  context.mock.timers.enable({ apis: ['setInterval'] });
  const diagnostics = [];
  const service = await startCollaborationServer({ port: 0, onDiagnostic: entry => diagnostics.push(entry) }); context.after(() => service.close());
  const socket = new WebSocket(`ws://127.0.0.1:${service.port}/collab`, { autoPong: false }); context.after(() => socket.terminate());
  await new Promise(resolve => socket.once('open', resolve));
  const closed = new Promise(resolve => socket.once('close', resolve));
  context.mock.timers.tick(30000);
  assert.equal(await closed, 1006);
  assert.ok(diagnostics.some(entry => entry.phase === 'heartbeat-timeout'));
});

test('有音乐曲绘的大谱面经 64 KiB 帧限制代理建房，持续同步时批准第三人', async context => {
  const diagnostics = []; const service = await startCollaborationServer({ port: 0, onDiagnostic: entry => diagnostics.push(entry) }); context.after(() => service.close());
  const proxy = new WebSocketServer({ port: 0 }); await new Promise(resolve => proxy.once('listening', resolve));
  const upstreams = []; let largestFrame = 0;
  context.after(async () => { for (const socket of [...proxy.clients, ...upstreams]) socket.terminate(); await new Promise(resolve => proxy.close(resolve)); });
  proxy.on('connection', frontend => {
    const backend = new WebSocket(`ws://127.0.0.1:${service.port}/collab`); upstreams.push(backend); const pending = [];
    const forward = (target, data) => { largestFrame = Math.max(largestFrame, data.length); if (data.length > 65536) target.terminate(); else if (target.readyState === WebSocket.OPEN) target.send(data, { binary: false }); };
    frontend.on('message', data => backend.readyState === WebSocket.CONNECTING ? pending.push(data) : forward(backend, data));
    backend.on('open', () => { for (const data of pending) forward(backend, data); });
    backend.on('message', data => forward(frontend, data));
    frontend.on('close', () => backend.close()); backend.on('close', () => frontend.close()); backend.on('error', () => {});
  });
  const notices = [];
  const make = chart => {
    const session = new EditorSession(chart); const transport = new CollaborationTransport();
    const client = new CollaborationClient(transport, { session: () => session, receiveChart: chart => { session.history.document = chart; }, notify: (message, level) => { if (level !== 'success') notices.push(message); } });
    context.after(() => client.leave()); return { client, session, transport };
  };
  const wait = (client, predicate) => new Promise((resolve, reject) => {
    if (predicate()) { resolve(); return; }
    const listener = () => { if (predicate()) { clearTimeout(timer); client.removeEventListener('change', listener); resolve(); } };
    const timer = setTimeout(() => { client.removeEventListener('change', listener); reject(new Error('三人同步超时：' + notices.join('；'))); }, 10000);
    client.addEventListener('change', listener);
  });
  const chart = createChart(); chart.META.song = '测试音乐.ogg'; chart.META.background = '测试曲绘.png'; chart.META.offset = 650;
  chart.judgeLineList[0].notes = Array.from({ length: 3000 }, (_, index) => createNote(1, index / 4, 0));
  const host = make(chart); const second = make(createChart()); const third = make(createChart());
  const address = `ws://127.0.0.1:${proxy.address().port}/collab`;
  host.client.connect(address, { name: 'Host' }); await wait(host.client, () => host.client.ready);
  second.client.connect(address, { name: 'Second' }, { room: host.client.room, token: host.client.token });
  await wait(host.client, () => host.client.requests.length === 1); host.client.approve(host.client.requests[0].request, true); await wait(second.client, () => second.client.ready);
  const movement = setInterval(() => second.transport.presence({ type: 'presence', seconds: 42, line: 0, cursor: null }), 20); context.after(() => clearInterval(movement));
  third.client.connect(address, { name: 'Third' }, { room: host.client.room, token: host.client.token });
  await wait(host.client, () => host.client.requests.length === 1); host.client.approve(host.client.requests[0].request, true); await wait(third.client, () => third.client.ready);
  await wait(host.client, () => host.client.members.length === 3);
  assert.deepEqual(third.session.chart, host.session.chart); assert.equal(third.session.chart.META.song, chart.META.song);
  assert.equal(host.session.chart.META.background, chart.META.background); assert.ok(largestFrame <= 65536);
  assert.deepEqual(notices, []);
  const log = JSON.stringify([...host.transport.diagnostics, ...diagnostics]);
  assert.ok(log.includes('create')); assert.ok(!log.includes(host.client.token)); assert.ok(!log.includes('测试音乐')); assert.ok(!log.includes(address));
  clearInterval(movement);
});

test('编辑器客户端端到端：并行修改、独立撤销重做、断线恢复及素材传输', async context => {
  const service = await startCollaborationServer({ port: 0 }); context.after(() => service.close());
  const base = createChart(); base.judgeLineList[0].notes = [createNote(1, 1, 0), createNote(4, 2, 50)];
  const problems = [];
  const make = chart => {
    const session = new EditorSession(chart); const transport = new CollaborationTransport();
    const client = new CollaborationClient(transport, { session: () => session, receiveChart: chart => { session.history.document = chart; }, notify: (message, level) => { if (level !== 'success') problems.push(message); } });
    context.after(() => client.leave()); return { session, transport, client };
  };
  const host = make(base); const guest = make(createChart());
  const wait = (client, predicate) => new Promise((resolve, reject) => {
    if (predicate()) { resolve(); return; }
    const listener = () => { if (predicate()) { clearTimeout(timer); client.removeEventListener('change', listener); resolve(); } };
    const timer = setTimeout(() => { client.removeEventListener('change', listener); reject(new Error('客户端同步超时：' + problems.join('；'))); }, 6000);
    client.addEventListener('change', listener);
  });
  const server = `ws://127.0.0.1:${service.port}/collab`;
  host.client.connect(server, { name: 'Host' }); await wait(host.client, () => host.client.ready);
  guest.client.connect(server, { name: 'Guest' }, { room: host.client.room, token: host.client.token });
  await wait(host.client, () => host.client.requests.length > 0); host.client.approve(host.client.requests[0].request, true); await wait(guest.client, () => guest.client.ready);
  host.session.selection.add(0); guest.session.selection.add(1);
  host.session.transformSelection('房主移动', note => ({ ...note, positionX: 150 }));
  guest.session.transformSelection('伙伴移动', note => ({ ...note, positionX: -150 }));
  await wait(host.client, () => host.client.revision === 2); await wait(guest.client, () => guest.client.revision === 2);
  assert.deepEqual(host.session.chart, guest.session.chart); assert.deepEqual(host.session.notes.map(note => note.positionX), [150, -150]);
  host.session.travel('undo'); await wait(guest.client, () => guest.client.revision === 3);
  assert.deepEqual(guest.session.notes.map(note => note.positionX), [0, -150]);
  await wait(host.client, () => host.client.revision === 3); host.session.travel('redo'); await wait(guest.client, () => guest.client.revision === 4);
  assert.deepEqual(guest.session.notes.map(note => note.positionX), [150, -150]);
  const originalId = guest.client.id; guest.transport.socket.close();
  await wait(guest.client, () => !guest.transport.connected); await wait(guest.client, () => guest.client.ready);
  assert.equal(guest.client.id, originalId); assert.deepEqual(guest.session.chart, host.session.chart);
  const asset = new Promise(resolve => guest.client.addEventListener('asset', event => resolve(event.detail), { once: true }));
  host.transport.send({ type: 'asset', name: 'test.png', hash: 'a'.repeat(64), index: 0, total: 1, data: 'YWJj' });
  assert.equal((await asset).name, 'test.png');
  assert.deepEqual(problems, []);
});
