import test from 'node:test';
import assert from 'node:assert/strict';
import { FrameLimiter, validFpsLimit } from '../src/core/frame-timing.ts';
import { migratePreferences } from '../src/core/preferences.ts';
import { readEditorPreferences, writeEditorPreferences } from '../src/platform/editor-preferences.ts';

test('帧率默认无上限，支持大于 10 的有限数和原设置迁移', () => {
  assert.equal(migratePreferences().settings.fpsLimit, 0);
  for (const value of [0, 10.01, 59.94, 60, 165, 360, 1000, Number.MAX_VALUE]) {
    assert.ok(validFpsLimit(value));
    assert.equal(migratePreferences(JSON.stringify({ FpsLimit: value })).settings.fpsLimit, value);
    let saved: string | null = null;
    const storage = { setItem: (key: string, text: string) => { saved = text; }, getItem: () => saved };
    writeEditorPreferences({ fpsLimit: value }, storage);
    assert.equal(readEditorPreferences(storage).fpsLimit, value);
  }
  for (const value of [10, 1, -1, NaN, Infinity, null, '', '60', undefined]) assert.equal(validFpsLimit(value), false);
});

test('限帧保留累计余量，不因刷新周期和时间戳抖动错误降为半速', () => {
  for (const refresh of [60, 144, 165]) for (const limit of [0, 10.1, 30, 59.94, 60, 120, 144, 165, 240, Number.MAX_VALUE]) {
    const limiter = new FrameLimiter(); let frames = 0;
    for (let tick = 0; tick < refresh * 10; tick++) {
      const timestamp = tick * 1000 / refresh + (tick % 2 ? 0.02 : 0);
      if (limiter.shouldRender(timestamp, limit)) frames++;
    }
    const expected = Math.min(refresh, limit || refresh) * 10;
    assert.ok(Math.abs(frames - expected) <= 1.1, `${refresh} Hz / ${limit} FPS: ${frames} vs ${expected}`);
  }
});

test('切换限帧立即生效，长时间闲置后不补画积压帧', () => {
  const limiter = new FrameLimiter();
  assert.equal(limiter.shouldRender(0, 30), true);
  assert.equal(limiter.shouldRender(16, 30), false);
  assert.equal(limiter.shouldRender(17, 0), true);
  assert.equal(limiter.shouldRender(18, 60), true);
  assert.equal(limiter.shouldRender(19, 60), false);
  assert.equal(limiter.shouldRender(60000, 60), true);
  assert.equal(limiter.shouldRender(60000, 60), false);
  assert.equal(limiter.shouldRender(60017, 60), true);
});
