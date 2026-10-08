import test from 'node:test';
import assert from 'node:assert/strict';
import { CollaborationMessageReader, CollaborationMessageSender, CollaborationSyncDeadline, encodeCollaborationMessage } from '../src/core/collaboration-wire.ts';
import type { FragmentAck, MessageSocket, SendProgress, WireMessage } from '../src/core/collaboration-wire.ts';

/**
 * Acknowledge one fragment with the two fields the sender actually reads.
 *
 * `FragmentAck` is declared against the whole record `CollaborationMessageReader` emits, `type`
 * included, while `CollaborationMessageSender.acknowledge` only compares `id` and `received` and
 * returns early for anything else. The tests acknowledge with those two fields alone, so the partial
 * record is bridged through `unknown` in this one documented place rather than by inventing a `type`
 * the test never sent.
 */
function acknowledge(sender: CollaborationMessageSender, message: { id: number; received: number }): void {
  const open: unknown = message;
  sender.acknowledge(open as FragmentAck);
}

test('同步持续有进展时跨过旧的 15/30 秒限制；结束后取消计时', context => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const timeouts: Array<'idle' | 'total'> = []; const deadline = new CollaborationSyncDeadline(reason => timeouts.push(reason));
  deadline.start();
  for (let index = 0; index < 8; index++) { context.mock.timers.tick(20000); deadline.progress(); }
  assert.deepEqual(timeouts, []); deadline.stop(); context.mock.timers.tick(600000); assert.deepEqual(timeouts, []);
});

test('同步连续空闲超过一分钟仍会超时，不允许小流量无限延长总时限', context => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const timeouts: Array<'idle' | 'total'> = []; const deadline = new CollaborationSyncDeadline(reason => timeouts.push(reason));
  deadline.start(); context.mock.timers.tick(60000); assert.deepEqual(timeouts, ['idle']);
  deadline.start();
  for (let index = 0; index < 20; index++) { context.mock.timers.tick(30000); deadline.progress(); }
  assert.deepEqual(timeouts, ['idle', 'total']);
});

test('大谱面 Unicode、转义内容分片后完整恢复，每帧小于 64 KiB', () => {
  const message = { type: 'create', chart: { META: { song: '音乐.ogg', background: '曲绘.png' }, data: ('😀音符\\\n"').repeat(20000) } };
  const frames = encodeCollaborationMessage(message); const reader = new CollaborationMessageReader();
  assert.ok(frames.length > 10);
  for (const frame of frames) assert.ok(Buffer.byteLength(frame) < 65536);
  const result = frames.map(frame => reader.read(frame));
  assert.ok(result.slice(0, -1).every(message => message === null));
  assert.deepEqual(result.at(-1), message); assert.equal(reader.parts.length, 0);
});

test('拒绝乱序、超大分片和不同消息交错，普通小消息仍兼容', () => {
  const reader = new CollaborationMessageReader();
  assert.deepEqual(reader.read('{"type":"ping"}'), { type: 'ping' });
  assert.throws(() => reader.read(JSON.stringify({ type: '$rpeFrame', index: 1, total: 2, data: '{}' })), /无效/);
  assert.throws(() => reader.read(JSON.stringify({ type: '$rpeFrame', index: 0, total: 1, data: 'a'.repeat(9000) })), /无效/);
  reader.read(JSON.stringify({ type: '$rpeFrame', index: 0, total: 2, data: '{' }));
  assert.throws(() => reader.read('{"type":"ping"}'), /中断/);
});

test('发送队列等待底层缓冲排空，不丢分片或让后续消息插入当前消息', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const frames: string[] = []; const socket: MessageSocket = { readyState: 1, bufferedAmount: 600000, send(frame) { frames.push(frame); } };
  const sender = new CollaborationMessageSender(socket);
  const chart = { type: 'create', data: 'x'.repeat(100000) }; sender.send(chart); sender.send({ type: 'presence', seconds: 42 });
  assert.equal(frames.length, 0); socket.bufferedAmount = 0; context.mock.timers.tick(8);
  const reader = new CollaborationMessageReader(receipt => sender.acknowledge(receipt)); const messages: WireMessage[] = [];
  for (const frame of frames) { const message = reader.read(frame); if (message) messages.push(message); }
  assert.deepEqual(messages, [chart, { type: 'presence', seconds: 42 }]); assert.equal(sender.bytes, 0);
  sender.close();
});

test('对端未确认时最多发送 16 片，进度使用对端确认值，重复确认不扩大发送窗口', () => {
  const frames: string[] = []; const progress: SendProgress[] = [];
  const socket: MessageSocket = { readyState: 1, bufferedAmount: 0, send(frame) { frames.push(frame); } };
  const sender = new CollaborationMessageSender(socket, () => {}, value => progress.push(value));
  sender.send({ type: 'create', data: 'x'.repeat(600000) });
  // `assert.deepEqual` is an assertion function, so the bare empty literal would narrow `progress`
  // to `never[]`; the empty expectation is bound with its own annotation instead.
  const noProgress: SendProgress[] = [];
  assert.equal(frames.length, 16); assert.deepEqual(progress, noProgress);
  const id: number = JSON.parse(frames[0]).id;
  assert.throws(() => acknowledge(sender, { id, received: 17 }), /无效/);
  acknowledge(sender, { id, received: 8 }); assert.equal(frames.length, 24); assert.equal(progress.at(-1)!.sent, 8);
  acknowledge(sender, { id, received: 8 }); assert.equal(frames.length, 24);
  const reader = new CollaborationMessageReader(); reader.read(frames[0]);
  assert.equal(reader.read(JSON.stringify({ type: '$rpeAck', id: 99, received: 1 }))!.type, '$rpeAck');
  assert.equal(reader.parts.length, 1);
  sender.close();
});

test('连续确认后扩大窗口但不超过 128 片，异步发送在完整确认后结束', async () => {
  const frames: string[] = []; const socket: MessageSocket = { readyState: 1, bufferedAmount: 0, send(frame) { frames.push(frame); } };
  const sender = new CollaborationMessageSender(socket); let finished = false;
  const sent = sender.sendAsync({ type: 'asset', data: 'x'.repeat(4000000) }).then(() => { finished = true; });
  const id: number = JSON.parse(frames[0]).id;
  acknowledge(sender, { id, received: 16 }); assert.equal(frames.length, 48);
  acknowledge(sender, { id, received: 48 }); assert.equal(frames.length, 112);
  acknowledge(sender, { id, received: 112 }); assert.equal(frames.length, 240);
  acknowledge(sender, { id, received: 240 }); assert.equal(frames.length, 368);
  assert.equal(finished, false);
  const reader = new CollaborationMessageReader(receipt => sender.acknowledge(receipt));
  for (const frame of frames) reader.read(frame);
  await sent; assert.equal(finished, true); assert.equal(sender.bytes, 0); sender.close();
});

test('连接关闭会终止等待中的异步素材发送', async () => {
  const sender = new CollaborationMessageSender({ readyState: 1, bufferedAmount: 0, send() {} });
  const pending = sender.sendAsync({ type: 'asset', data: 'x'.repeat(40000) });
  sender.close(); await assert.rejects(pending, /关闭/);
});

test('慢素材阻塞时状态消息只保留最新值，恢复后不会倾倒数百条过期状态', () => {
  const frames: string[] = []; const sender = new CollaborationMessageSender({ readyState: 1, bufferedAmount: 0, send(frame) { frames.push(frame); } });
  const upload = { type: 'media-upload', data: 'x'.repeat(1400000) }; sender.send(upload);
  for (let index = 0; index < 600; index++) {
    sender.send({ type: 'presence', seconds: index }); sender.send({ type: 'ping', time: index }); sender.send({ type: 'locks', ids: [index] });
  }
  assert.equal(sender.queue.length, 4);
  const messages: WireMessage[] = []; const reader = new CollaborationMessageReader(receipt => sender.acknowledge(receipt));
  for (const frame of frames) { const message = reader.read(frame); if (message) messages.push(message); }
  assert.deepEqual(messages, [upload, { type: 'presence', seconds: 599 }, { type: 'ping', time: 599 }, { type: 'locks', ids: [599] }]);
  assert.equal(sender.bytes, 0); sender.close();
});

test('合并状态不会丢失其他人的光标，也不会跨编辑操作合并选中锁', () => {
  const sender = new CollaborationMessageSender({ readyState: 1, bufferedAmount: 0, send() {} });
  sender.send({ type: 'media-upload', data: 'x'.repeat(1400000) });
  sender.send({ type: 'presence', id: 'first', seconds: 1 }); sender.send({ type: 'presence', id: 'second', seconds: 2 });
  sender.send({ type: 'presence', id: 'first', seconds: 3 });
  sender.send({ type: 'locks', ids: ['before'] }); sender.send({ type: 'edit', operation: 'kept' }); sender.send({ type: 'locks', ids: ['after'] });
  assert.equal(sender.queue.length, 6);
  assert.equal(sender.queue.filter(entry => entry.type === 'edit').length, 1); sender.close();
});
