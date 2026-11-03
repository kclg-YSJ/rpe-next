import test from 'node:test';
import assert from 'node:assert/strict';
import { NoiseSkinRenderer } from '../src/ui/noise-skin-renderer.mjs';

// The overlay path is opt-in and only used by the render studio: it must copy the
// untouched scene, keep only the changed pixels and never clear the playfield.
test('overlay 模式不清屏，保留未改动的场景并复用场景副本', () => {
  const events = [], textures = [], sampled = [];
  const capture = { width: 0, height: 0, getContext() { assert.fail('overlay 不应重新取捕获上下文'); } };
  const instance = { targets: new Map(), history: new Map(), screens: [{ texture: 'screen-a' }, { texture: 'screen-b' }], passes: [], resources: [] };
  const gl = {};
  for (const method of ['disable', 'colorMask', 'bindTexture', 'pixelStorei', 'texSubImage2D', 'drawArrays']) gl[method] = () => {};
  const cleared = [];
  const context = { canvas: { width: 64 }, save() {}, restore() {}, clearRect() { cleared.push('playfield'); }, drawImage() { events.push('draw'); } };
  const renderer = Object.assign(Object.create(NoiseSkinRenderer.prototype), {
    overlay: true, gl, canvas: { width: 64, height: 64 }, capture, maximum: 1024, errors: new Set(),
    cutout: { position: 0, uniforms: new Map() },
    captureContext: { clearRect() {}, drawImage() {} },
    skin: () => ({ definition: { parameters: [] } }),
    instance: () => instance, geometryMask() {}, bind(program) { events.push(program === this.cutout ? 'cutout' : 'bind'); },
    texture(width, height) { const target = { id: 'texture-' + textures.length, width, height }; textures.push(target); return target; },
    blit(source, target) { events.push(target === instance.scene ? 'scene-copy' : 'blit'); },
    sampler(program, name, target) { sampled.push([name, target]); return 1; },
    clear() { events.push('clear'); },
    destroy() {},
  });
  const layer = { skin: 'shader/Test', parameters: {} }, viewport = { left: 0, top: 0, width: 64, height: 64 };
  assert.equal(renderer.render(context, layer, new Map(), [], 0, viewport, 1, 64, 64), true);
  assert.equal(renderer.render(context, layer, new Map(), [], 0.1, viewport, 1, 64, 64), true);

  // One scene copy, reused on the second frame; the playfield is never cleared.
  assert.equal(textures.length, 1);
  assert.equal(events.filter(event => event === 'scene-copy').length, 2);
  assert.equal(events.filter(event => event === 'cutout').length, 2);
  assert.equal(cleared.length, 0);
  assert.deepEqual(sampled.filter(([name]) => name === 'sceneTexture').map(([, target]) => target), [instance.scene, instance.scene]);
  assert.deepEqual(events.filter(event => event === 'draw').length, 2);
});
