# Basic Pitch inference assets

Spotify Basic Pitch 1.0.1 and TensorFlow.js 4.22.0 are distributed under Apache-2.0. The package includes the upstream Basic Pitch graph model and weights, an ESM runtime bundle, and the TensorFlow.js single-thread WASM and SIMD binaries. Source versions, provenance and checksums are recorded in `UPSTREAM.json`; licenses and bundled copyright notices are retained alongside these files.

The runtime is built from `@spotify/basic-pitch/esm/inference.js`, `@tensorflow/tfjs` and `@tensorflow/tfjs-backend-wasm` with esbuild 0.25.12 (browser, ESM, ES2022, minified, linked legal comments). The pinned TensorFlow.js alias is shared by all imports. The unmodified upstream Basic Pitch inference source is also included as `inference.upstream.js`. TensorFlow.js 4.22.0 is used to avoid the older WASM Fill kernel's dtype failure observed with this model.

RPEN loads the runtime and model only in a dedicated module Worker when the user requests pitch analysis. No remote model service, audio upload, MIDI dependency, WebGL backend or thread pool is used by this feature. The Worker wraps each upstream `evaluateModel` call in an explicit tensor scope and terminates on completion, cancellation or source changes. The application-specific dominant-pitch selection, time mapping, caching and display code lives in `src/core/audio-pitch.mjs`, `src/application/audio-pitch.mjs`, `src/platform/audio-pitch-worker.mjs` and `src/ui/audio-pitch.mjs`.

Upstream sources:

- https://github.com/spotify/basic-pitch-ts
- https://github.com/spotify/basic-pitch
- https://github.com/tensorflow/tfjs/tree/tfjs-v4.22.0

This is an analysis aid: polyphonic activations are reduced to one prominent pitch per frame. Uncertain/unpitched sections remain blank; voice separation artifacts and model estimation errors can affect the result.
