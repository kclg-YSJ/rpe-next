import { dominantPitches, PITCH_FRAME_RATE } from '../core/audio-pitch.mjs';
let runtime, model;
async function load() {
  if (model) return;
  runtime = await import('../../assets/vendor/basic-pitch/runtime.mjs');
  const { tf, setWasmPaths, BasicPitch } = runtime;
  // Keep inference off the rendering GPU and avoid spawning a thread pool.
  tf.env().set('WASM_HAS_MULTITHREAD_SUPPORT', false);
  setWasmPaths(new URL('../../assets/vendor/basic-pitch/', import.meta.url).href);
  if (!await tf.setBackend('wasm')) throw Error('pitch-wasm');
  await tf.ready(); model = new BasicPitch(new URL('../../assets/vendor/basic-pitch/model/model.json', import.meta.url).href);
  await model.model;
}
self.onmessage = async ({ data }) => {
  try {
    await load();
    if (data.action === 'load') { self.postMessage({ id: data.id }); return; }
    const { tf } = runtime, count = Math.ceil(data.samples.length / 22050 * PITCH_FRAME_RATE);
    const pitches = new Float32Array(count).fill(NaN), confidence = new Uint8Array(count); let batch = 0;
    const started = performance.now(); tf.engine().startScope();
    try {
      await model.evaluateModel(data.samples, (frames, _onsets, contours) => {
        const result = dominantPitches(frames, contours), first = Math.round(batch++ * (43844 - 7680) / 256);
        for (let i = 0; i < result.pitches.length && first + i < count; i++) { pitches[first + i] = result.pitches[i]; confidence[first + i] = result.confidence[i]; }
      }, () => {});
    } finally { tf.engine().endScope(); }
    self.postMessage({ id: data.id, pitches, confidence, milliseconds: performance.now() - started, tensors: tf.memory().numTensors, tensorBytes: tf.memory().numBytes, wasmBytes: tf.backend().wasm.HEAPU8.byteLength, backend: tf.getBackend() }, [pitches.buffer, confidence.buffer]);
  } catch (error) { self.postMessage({ id: data.id, error: error.message || String(error), stack: error.stack }); }
};
