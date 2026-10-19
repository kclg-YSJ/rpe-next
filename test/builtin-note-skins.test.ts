// @ts-nocheck - ported integration test with dynamic archive fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { builtinNoteSkins, updateNoteSkin, exportNoteSkin } from '../src/platform/note-skins.ts';
import { parseNoteSkin, NOTE_SKIN_IMAGES, NOTE_SKIN_SOUNDS } from '../src/core/note-skin.ts';
import { readZip } from '../src/platform/archive.ts';

async function loadBuiltins(context) {
  context.mock.method(globalThis, 'fetch', async url => new Response(await readFile(new URL(url))));
  return builtinNoteSkins();
}

test('梦之海内置音符皮肤保留包内作者、图片、打击音效与附属素材', async context => {
  const records = await loadBuiltins(context);
  const record = records.find(record => record.id === 'builtin-sea-of-dreams');
  assert.ok(record); assert.equal(record.builtin, true); assert.equal(record.originalFiles, record.files);
  assert.equal(record.info.name, 'Sea of Dreams - Neo'); assert.equal(record.info.author, '-虹之梦-');
  for (const name of [...NOTE_SKIN_IMAGES, ...Object.values(NOTE_SKIN_SOUNDS), 'BY虹之梦.png', 'ending.mp3']) assert.ok(record.files.has(name), name);
  assert.deepEqual(record.info.hitFx, [7, 10]); assert.equal(record.info.hitFxDuration, 0.65); assert.equal(record.info.hitFxScale, 1.35);
  const actual = await readdir(new URL('../assets/note-skins/sea-of-dreams/', import.meta.url));
  assert.deepEqual(actual.sort(), [...record.files.keys()].sort());
});

test('内置音符皮肤可修改参数和素材并导出，原始参数独立保留供恢复', async context => {
  const [record] = await loadBuiltins(context);
  const replacement = new Uint8Array([1, 2, 3]);
  const edited = updateNoteSkin(record, { ...record.info, hitFxScale: 1.8, holdRepeat: true }, new Map([['click.ogg', replacement]]));
  assert.equal(edited.id, record.id); assert.equal(edited.builtin, true); assert.equal(edited.originalFiles, record.files);
  assert.equal(edited.info.hitFxScale, 1.8); assert.equal(edited.info.holdRepeat, true); assert.equal(record.info.hitFxScale, 1.35);
  assert.deepEqual(edited.files.get('click.ogg'), replacement); assert.notDeepEqual(record.files.get('click.ogg'), replacement);
  const exported = parseNoteSkin(await readZip(await exportNoteSkin(edited).arrayBuffer()));
  assert.equal(exported.info.hitFxScale, 1.8); assert.equal(exported.info.author, '-虹之梦-');
  const restored = parseNoteSkin(edited.originalFiles, edited.id);
  assert.equal(restored.info.hitFxScale, 1.35); assert.equal(restored.info.holdRepeat, false);
  assert.deepEqual(restored.files.get('click.ogg'), record.files.get('click.ogg'));
});
