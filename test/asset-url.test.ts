import test from 'node:test';
import assert from 'node:assert/strict';
import { assetUrl } from '../src/core/asset-url.ts';

// Outside a bundle (plain Node, which is what this test runs in) import.meta.env does not exist,
// so the module falls back to the domain root. The subdirectory build is covered separately by
// tools/smoke-pages.mjs against the real dist/ output.
test('内置资源以站点根目录为基准，未打包时回退到域名根路径', () => {
  for (const path of ['rpe/Texture/Tap2.png', 'rpe/shaders/grayscale.glsl', 'rpe/SE/tap.ogg', 'easing/1.svg']) {
    assert.equal(assetUrl(path), `/assets/${path}`);
  }
});
