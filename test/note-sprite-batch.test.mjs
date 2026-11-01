import test from 'node:test';
import assert from 'node:assert/strict';
import { NoteSpriteBatch, holdBatchWithinBudget } from '../src/ui/note-sprite-batch.mjs';
import { RpeSkin } from '../src/ui/skin.mjs';
import { ResourceNoteSkin } from '../src/ui/resource-note-skin.mjs';
import { parseNoteSkin } from '../src/core/note-skin.mjs';
import { noteSkinFixture } from './fixtures/note-skin.mjs';

test('音符批次保留图集裁切、左右上下反射、矩阵次序和逐层透明度，save/restore 不共享变换', () => {
  const batch = new NoteSpriteBatch(); batch.matrix = [1, 0, 0, 1, 0, 0]; batch.width = batch.height = 1000;
  batch.globalAlpha = .4; batch.fillStyle = '#ffffff'; batch.textureWidth = 200; batch.textureHeight = 400; batch.used = 0;
  batch.image = () => ({ layer: 2, width: 1, height: 1 });
  batch.translate(100, 200); batch.save(); batch.scale(-1, -1); batch.globalAlpha = .6;
  batch.drawImage({}, 20, 40, 100, 80, -50, -10, 100, 20);
  assert.deepEqual([...batch.vertices.slice(0, 9)].map(v => Math.round(v * 1000) / 1000), [150, 210, .1, .1, 2, 1, 1, 1, .6]);
  assert.deepEqual([...batch.vertices.slice(9, 13)].map(v => Math.round(v * 1000) / 1000), [50, 210, .6, .1]);
  batch.restore(); assert.deepEqual(batch.matrix, [1, 0, 0, 1, 100, 200]); assert.equal(batch.globalAlpha, .4);
  batch.transform(0, 1, -1, 0, 10, 20); batch.drawImage({}, 0, 0, 10, 20);
  assert.deepEqual([...batch.vertices.slice(54, 56)], [110, 220]); assert.deepEqual([...batch.vertices.slice(63, 65)], [110, 230]);
  batch.matrix = [1, 0, 0, 1, 0, 0]; batch.drawImage({}, 50, 60, -10, -20);
  assert.deepEqual([...batch.vertices.slice(108, 112)], [40, 40, 0, 0]);
  assert.deepEqual([...batch.vertices.slice(117, 121)], [50, 40, 1, 0]);
});

test('音符批次剔除完全离屏的贴图，缓冲满后依序提交，顶点内存不会按音符数量无限增长', () => {
  const batch = new NoteSpriteBatch(); batch.matrix = [1, 0, 0, 1, 0, 0]; batch.width = batch.height = 100;
  batch.globalAlpha = 1; batch.used = 0; const buffer = batch.vertices; let submitted = 0;
  batch.flush = () => { submitted += batch.used / 54; batch.used = 0; };
  batch.quad(200, 200, 10, 10, null, [1, 1, 1]); assert.equal(batch.used, 0);
  for (let i = 0; i < 20000; i++) batch.quad(0, 0, 10, 10, null, [1, 1, 1]);
  assert.equal(submitted + batch.used / 54, 20000); assert.equal(batch.vertices, buffer);
});

test('自定义音符绘制与重复 Hold 身体保留原绘制路径，标准皮肤可使用批量绘制', () => {
  const skin = new RpeSkin(() => {}); assert.equal(skin.noteBatchCompatible, true);
  const record = parseNoteSkin(noteSkinFixture()), pack = new ResourceNoteSkin(record, new Map(), (_, source) => source);
  skin.setResourcePack(pack); assert.equal(skin.noteBatchCompatible, true);
  pack.setInfo({ ...record.info, holdRepeat: true }); assert.equal(skin.noteBatchCompatible, false);
  pack.setInfo(record.info); assert.equal(skin.noteBatchCompatible, true);
  const hold = pack.hold; pack.hold = (...args) => hold.apply(pack, args); assert.equal(skin.noteBatchCompatible, false);
  pack.hold = hold; const head = skin.head; skin.head = (...args) => head.apply(skin, args); assert.equal(skin.noteBatchCompatible, false);
});

test('大量短 Hold 使用批量绘制，长身体覆盖面积过大时保留原路径，窗口变化重新估算负载', () => {
  const record = parseNoteSkin(noteSkinFixture()), pack = new ResourceNoteSkin(record, new Map([['hold.png', { width: 160 }], ['hold_mh.png', { width: 160 }]]), (_, source) => source);
  const entries = Array.from({ length: 7000 }, () => ({ note: { type: 2, speed: 1, size: 1 }, start: 0, startFloor: 0, endFloor: 0 })), visible = new Map([[0, entries]]), states = [{ floor: 0 }];
  assert.equal(holdBatchWithinBudget(visible, states, 1, 200, 1, 1350, 900, pack), true);
  for (const entry of entries) entry.endFloor = 500;
  assert.equal(holdBatchWithinBudget(visible, states, 1, 200, 1, 1350, 900, pack), false);
  assert.equal(holdBatchWithinBudget(visible, states, 1, 20, 1, 1350, 900, pack), true);
});
