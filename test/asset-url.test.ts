import test from 'node:test';
import assert from 'node:assert/strict';
import { assetUrl } from '../src/core/asset-url.ts';

test('内置资源在根目录与 GitHub Pages 子目录保持正确地址', () => {
  for (const prefix of ['', '/rpe-next']) {
    const origin = `https://example.com${prefix}`;
    for (const path of ['rpe/Texture/Tap2.png', 'rpe/shaders/grayscale.glsl', 'rpe/SE/tap.ogg', 'easing/1.svg']) {
      assert.equal(assetUrl(path, `${origin}/src/core/asset-url.ts`), `${origin}/assets/${path}`);
    }
  }
});
