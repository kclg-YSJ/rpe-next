import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { digestBytes } from '../src/platform/collaboration-media.ts';

test('素材哈希在无 Worker 的环境仍正确，并支持 Uint8Array 视图', async () => {
  const source = Uint8Array.from({ length: 100003 }, (_, index) => index % 251);
  const view = source.subarray(17, 90000);
  const expected = createHash('sha256').update(view).digest('hex');
  assert.equal(await digestBytes(view), expected);
});

test('素材哈希收到取消信号后不会继续完成', async () => {
  const controller = new AbortController(); controller.abort(new Error('cancelled'));
  await assert.rejects(digestBytes(new Uint8Array([1, 2, 3]), controller.signal), /cancelled/);
});
