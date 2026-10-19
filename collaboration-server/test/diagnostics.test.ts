import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDiagnostics } from '../diagnostics.ts';

test('诊断日志跨启动追加，按大小保留有限轮换文件', async context => {
  const directory = await mkdtemp(join(tmpdir(), 'rpen-diagnostics-')); context.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'test.log'), first = createDiagnostics(path, { maxBytes: 200 });
  first.write({ phase: 'first' }); await first.flush();
  const second = createDiagnostics(path, { maxBytes: 200 }); second.write({ phase: 'second' }); await second.flush();
  assert.match(await readFile(path, 'utf8'), /first/); assert.match(await readFile(path, 'utf8'), /second/);
  for (let index = 0; index < 25; index++) { second.write({ phase: 'more', index }); await second.flush(); }
  const files = await readdir(directory); assert.ok(files.length <= 4); assert.ok(files.includes('test.log.3'));
  const lines = (await Promise.all(files.map(file => readFile(join(directory, file), 'utf8')))).flatMap(text => text.trim().split('\n').map((line): unknown => JSON.parse(line) as unknown)) as unknown as { index?: number; time?: string }[];
  assert.ok(lines.some((line: { index?: number }) => line.index === 24)); assert.ok(lines.every((line: { time?: string }) => line.time));
});
