import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { installEditorCapture } = createRequire(import.meta.url)('../desktop/editor-capture.cjs');
const { bitmapFormat, capturePixels, validateFence, matchesFence } = createRequire(import.meta.url)('../desktop/editor-capture-pixels.cjs');
import { createEditorCapture } from '../src/platform/editor-capture.mjs';

test('whole editor capture preserves physical pixels, bounds requests and restores throttling', async () => {
  let handler, captures = 0, release;
  const changes = [], bytes = Buffer.alloc(32); bytes.writeUInt32BE(2109, 16); bytes.writeUInt32BE(1317, 20);
  const frame = { url: 'rpe://app/index.html' };
  const contents = { mainFrame: frame, getBackgroundThrottling: () => true, setBackgroundThrottling: value => changes.push(value), isDestroyed: () => false,
    async capturePage(rect, options) {
      captures++; assert.equal(rect, undefined); assert.deepEqual(options, { stayHidden: true, stayAwake: true });
      await new Promise(resolve => { release = resolve; });
      return { isEmpty: () => false, toPNG: () => bytes };
    }
  };
  const end = installEditorCapture({ ipcMain: { handle(_name, fn) { handler = fn; } }, window: () => ({ webContents: contents }), origin: 'rpe://app' });
  const event = { sender: contents, senderFrame: frame };
  assert.equal((await handler({ sender: {}, senderFrame: frame }, 'begin')).ok, false);
  assert.equal((await handler({ ...event, senderFrame: { url: frame.url } }, 'begin')).ok, false);
  assert.equal(captures, 0);
  const id = (await handler(event, 'begin')).result.id;
  assert.equal((await handler(event, 'begin')).ok, false);
  assert.equal((await handler(event, 'frame', 'wrong')).ok, false);
  const capture = handler(event, 'frame', id);
  assert.equal((await handler(event, 'frame', id)).ok, false); release();
  const image = await capture;
  assert.equal(image.ok, true); assert.equal(image.result.width, 2109); assert.equal(image.result.height, 1317); assert.equal(image.result.bytes, bytes);
  assert.equal(captures, 1);
  assert.equal((await handler(event, 'end', id)).ok, true); end();
  assert.deepEqual(changes, [false, true]);
  assert.equal((await handler(event, 'frame', id)).ok, false);
});

test('native pixel order is probed, with lossless PNG fallback for unknown formats', () => {
  assert.equal(bitmapFormat({ createFromBuffer: () => ({ toBitmap: () => Buffer.from([0, 0, 255, 255]) }) }), 'BGRA');
  assert.equal(bitmapFormat({ createFromBuffer: () => ({ toBitmap: () => Buffer.from([255, 0, 0, 255]) }) }), 'RGBA');
  assert.equal(bitmapFormat({ createFromBuffer: () => ({ toBitmap: () => Buffer.from([1, 2, 3, 4]) }) }), null);
  const bytes = Buffer.from([30, 20, 10, 255, 60, 50, 40, 255]); let pngs = 0;
  const png = Buffer.alloc(32); png.writeUInt32BE(2, 16); png.writeUInt32BE(1, 20);
  const image = { getSize: () => ({ width: 2, height: 1 }), getScaleFactors: () => [1], toBitmap: () => bytes, toPNG() { pngs++; return png; } };
  const raw = capturePixels(image, 'BGRA'); assert.equal(raw.bytes, bytes); assert.equal(raw.width, 2); assert.equal(raw.stride, 8); assert.equal(pngs, 0);
  assert.equal(capturePixels(image, null).format, 'png'); assert.equal(pngs, 1);
  image.getSize = () => ({ width: 1, height: 1 });
  assert.equal(capturePixels(image, 'BGRA').format, 'png'); assert.equal(pngs, 2);
  image.getSize = () => ({ width: 65536, height: 65536 });
  assert.throws(() => capturePixels(image, 'BGRA'), /预算/);
});

test('frame fence accepts only the requested frame, including fractional DPI and marker wrap', () => {
  const width = 165, height = 30, bytes = Buffer.alloc(width * height * 4);
  for (const code of [0x5a6, 0x5ff, 0x500]) {
    bytes.fill(32);
    const fence = { x: 3, y: 2, width: 33, height: 3, viewportWidth: 110, viewportHeight: 20, code };
    validateFence(fence);
    for (let bit = 0; bit < 11; bit++) {
      const x = Math.floor((fence.x + (bit + .5) * 3) * 1.5), y = Math.floor((fence.y + 1.5) * 1.5);
      bytes[(y * width + x) * 4] = code & (1 << bit) ? 223 : 33;
    }
    assert.equal(matchesFence(bytes, width, height, fence), true);
    assert.equal(matchesFence(bytes, width, height, { ...fence, code: code ^ 1 }), false);
  }
  assert.throws(() => validateFence({ x: -1, y: 0, width: 33, height: 3, viewportWidth: 100, viewportHeight: 10, code: 0 }), /范围/);
  assert.throws(() => validateFence({ x: 0, y: 0, width: Infinity, height: 3, viewportWidth: 100, viewportHeight: 10, code: 0 }), /无效/);
});

test('capture retries stale compositor surfaces without returning or buffering the old frame', async () => {
  let handler, captures = 0;
  const width = 33, height = 3, fence = { x: 0, y: 0, width, height, viewportWidth: width, viewportHeight: height, code: 0x5a6 };
  const pixels = code => { const bytes = Buffer.alloc(width * height * 4, 32); for (let bit = 0; bit < 11; bit++) for (let y = 0; y < height; y++) for (let x = bit * 3; x < bit * 3 + 3; x++) bytes.fill(code & (1 << bit) ? 224 : 32, (y * width + x) * 4, (y * width + x) * 4 + 3); return bytes; };
  const frame = { url: 'rpe://app/index.html' }, contents = { mainFrame: frame, getBackgroundThrottling: () => true, setBackgroundThrottling() {}, isDestroyed: () => false,
    async capturePage() { const data = pixels(++captures === 1 ? fence.code - 1 : fence.code); return { isEmpty: () => false, getSize: () => ({ width, height }), getScaleFactors: () => [1], toBitmap: () => data, toPNG() { throw Error('raw capture must not compress PNG'); } }; }
  };
  const end = installEditorCapture({ ipcMain: { handle(_name, fn) { handler = fn; } }, window: () => ({ webContents: contents }), origin: 'rpe://app', nativeImage: { createFromBuffer: () => ({ toBitmap: () => Buffer.from([0, 0, 255, 255]) }) } });
  const event = { sender: contents, senderFrame: frame }, id = (await handler(event, 'begin', { raw: true })).result.id;
  const result = await handler(event, 'frame', { id, fence });
  assert.equal(result.ok, true); assert.equal(captures, 2); assert.equal(matchesFence(result.result.bytes, width, height, fence), true); end();
});

test('transferred frame transport validates origin and request, keeps one frame in flight, removes its listener', async () => {
  const saved = new Map(['window', 'location', 'VideoFrame', 'rpenEditorCapture'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const listeners = new Map(), calls = [], bytes = new Uint8Array(8);
  const window = { addEventListener(type, listener) { listeners.set(type, listener); }, removeEventListener(type, listener) { assert.equal(listeners.get(type), listener); listeners.delete(type); } };
  const origin = 'rpe://app'; let request;
  try {
    globalThis.window = window; globalThis.location = { origin }; globalThis.VideoFrame = function () {};
    globalThis.rpenEditorCapture = { version: 1,
      async call(action, value) { calls.push([action, value]); return action === 'begin' ? { ok: true, result: { id: 'test-token', fence: true } } : { ok: true }; },
      requestFrame(requestId, value) { request = { requestId, value }; }
    };
    assert.equal(listeners.size, 0);
    const capture = await createEditorCapture(); assert.equal(capture.supportsFence, true);
    const pending = capture.frame({ code: 123 });
    await assert.rejects(capture.frame(), /像素/);
    assert.deepEqual(request.value, { id: 'test-token', fence: { code: 123 } });
    const result = { ok: true, result: { width: 2, height: 1, format: 'BGRA', stride: 8, bytes } };
    listeners.get('message')({ source: window, origin: 'https://other.invalid', data: { type: 'rpen-editor-capture-frame', requestId: request.requestId, result } });
    assert.equal(listeners.size, 1);
    listeners.get('message')({ source: window, origin, data: { type: 'rpen-editor-capture-frame', requestId: request.requestId, result } });
    const frame = await pending; assert.equal(frame.bytes, bytes); frame.close(); assert.equal(frame.bytes, null);
    assert.doesNotThrow(() => listeners.get('message')({ source: window, origin, data: { type: 'rpen-editor-capture-frame' } }));
    await capture.dispose(); await capture.dispose(); assert.equal(listeners.size, 0); assert.equal(calls.filter(([action]) => action === 'end').length, 1);
  } finally {
    for (const [key, descriptor] of saved) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  }
});
