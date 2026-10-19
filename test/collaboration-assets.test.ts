import test from 'node:test';
import assert from 'node:assert/strict';
import { sendCollaborationAsset } from '../src/platform/collaboration-assets.ts';

/**
 * One `asset` frame as `sendCollaborationAsset` builds it.
 *
 * Declared as a type alias rather than an interface on purpose: `AssetTransport.sendAsset` takes a
 * `Record<string, unknown>`, and only a type alias gets the implicit index signature that lets this
 * frame satisfy it. This records the fields the assertions read off the captured frames.
 */
type AssetFrame = {
  type: string;
  name: string;
  hash: string;
  transfer: string;
  index: number;
  total: number;
  data: string;
};

test('大素材最多四块在途，等待下载确认才补块，乱序确认不改变文件顺序', async () => {
  const bytes = Uint8Array.from({ length: 2 * 1024 * 1024 + 7 }, (_, index) => index % 251);
  const chunks: AssetFrame[] = []; const pending: Array<(value?: unknown) => void> = []; let maximum = 0; const progress: number[] = [];
  const transport = { assetDelivery: true, sendAsset(message: AssetFrame) {
    chunks.push(message);
    return new Promise(resolve => { pending.push(resolve); maximum = Math.max(maximum, pending.length); });
  } };
  const sending = sendCollaborationAsset(transport, 'music.ogg', bytes, 'a'.repeat(64), (sent: number) => progress.push(sent));
  assert.equal(chunks.length, 4); await Promise.resolve(); assert.equal(chunks.length, 4);
  while (pending.length) { pending.pop()!(); await Promise.resolve(); await Promise.resolve(); }
  await sending;
  assert.equal(maximum, 4); assert.equal(progress.at(-1), bytes.length);
  assert.deepEqual(Buffer.concat(chunks.sort((left, right) => left.index - right.index).map(chunk => Buffer.from(chunk.data, 'base64'))), Buffer.from(bytes));
});

test('素材传输失败后不再派发新块，等待其他在途块收尾并报告错误', async () => {
  let sent = 0;
  const transport = { assetDelivery: true, async sendAsset() { sent++; throw new Error('连接中断'); } };
  await assert.rejects(sendCollaborationAsset(transport, 'cover.png', new Uint8Array(4 * 1024 * 1024), 'a'.repeat(64)), /连接中断/);
  assert.equal(sent, 4);
});

test('旧服务器保留小块格式和串行背压，不发送新控制消息', async () => {
  const messages: AssetFrame[] = []; const transport = { assetDelivery: false, async sendAsset(message: AssetFrame) { messages.push(message); } };
  await sendCollaborationAsset(transport, 'cover.png', new Uint8Array(100000), 'a'.repeat(64));
  assert.equal(messages.length, 3); assert.ok(messages.every(message => message.data.length <= 65536));
});
