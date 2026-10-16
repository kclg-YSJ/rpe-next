import test from 'node:test';
import assert from 'node:assert/strict';
import { pcmWave } from '../src/platform/pcm-wave.ts';

/**
 * A stand-in for the `AudioBuffer` the encoder reads.
 *
 * Only `length`, `numberOfChannels`, `sampleRate` and `getChannelData` are ever touched, so the test
 * supplies those four and skips the `AudioBuffer` members (`duration`, `copyFromChannel`, the
 * `AudioBufferOptions` constructor) that a real buffer declares.
 */
function pcmSource(length: number, numberOfChannels: number, sampleRate: number, channels: Float32Array[]): AudioBuffer {
  const double = { length, numberOfChannels, sampleRate, getChannelData: (channel: number) => channels[channel] };
  return double as unknown as AudioBuffer;
}

test('PCM 缓存保留采样率、声道顺序和浮点采样值，跨分片连续', async () => {
  const length = 65539;
  const left = Float32Array.from({ length }, (_, index) => Math.sin(index / 100));
  const right = Float32Array.from(left, value => -value * 0.5);
  const wave = await pcmWave(pcmSource(length, 2, 44100, [left, right]));
  assert.ok(wave);
  assert.equal(wave.type, 'audio/wav');
  const bytes = await wave.arrayBuffer(); const view = new DataView(bytes);
  assert.equal(bytes.byteLength, 44 + length * 8);
  assert.equal(view.getUint32(4, true), bytes.byteLength - 8);
  assert.equal(view.getUint16(20, true), 3);
  assert.equal(view.getUint16(22, true), 2);
  assert.equal(view.getUint32(24, true), 44100);
  assert.equal(view.getUint32(40, true), length * 8);
  for (let frame = 0; frame < length; frame++) {
    assert.equal(view.getFloat32(44 + frame * 8, true), left[frame]);
    assert.equal(view.getFloat32(48 + frame * 8, true), right[frame]);
  }
});

test('PCM 缓存转换会让出主线程，并可在切换音乐后取消', async () => {
  let cancelled = false;
  setTimeout(() => { cancelled = true; }, 0);
  const wave = await pcmWave(pcmSource(65537, 1, 48000, [new Float32Array(65537)]), () => cancelled);
  assert.equal(wave, null);
});

test('PCM 缓存可以在音频开头加入精确的静音帧', async () => {
  const wave = await pcmWave(pcmSource(2, 1, 4, [new Float32Array([0.25, -0.5])]), () => false, 0.5);
  // `pcmWave` returns `null` only when `cancelled` reports true, which the stub above never does.
  const view = new DataView(await wave!.arrayBuffer());
  assert.equal(view.getUint32(40, true), 16);
  assert.equal(view.getFloat32(44, true), 0);
  assert.equal(view.getFloat32(48, true), 0);
  assert.equal(view.getFloat32(52, true), 0.25);
  assert.equal(view.getFloat32(56, true), -0.5);
});
