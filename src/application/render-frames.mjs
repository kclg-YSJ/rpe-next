import { checkRenderAbort, renderAwait, renderYield } from '../core/render-task.mjs';

// submitFrame must synchronously snapshot the canvas, as CanvasSource.add does.
// Only drawing may run ahead; a second submission always awaits backpressure.
// Environments without a synchronous frame snapshot use the sequential path.
export async function renderFrames({ frames, frameDuration, duration, drawFrame, submitFrame, beforeFrame,
  onFrame, onProgress, signal, pipeline = true, now = () => performance.now(), yieldTask = renderYield }) {
  const drawingController = new AbortController();
  const cancelDrawing = () => drawingController.abort(signal?.reason);
  if (signal?.aborted) cancelDrawing(); else signal?.addEventListener('abort', cancelDrawing, { once: true });
  const settled = callback => Promise.resolve().then(() => { checkRenderAbort(signal); return callback(); })
    .then(value => ({ value }), error => ({ error }));
  const read = async task => { const result = await renderAwait(task, signal); if ('error' in result) throw result.error; return result.value; };
  const draw = index => settled(() => { checkRenderAbort(drawingController.signal); return drawFrame(index * frameDuration, index, frames, drawingController.signal); });
  let drawing = draw(0), lastUi = -Infinity, lastYield = now();
  try { for (let index = 0; index < frames; index++) {
    await read(drawing); checkRenderAbort(signal);
    const time = index * frameDuration, frameSeconds = Math.min(frameDuration, duration - time);
    await beforeFrame?.(time, index); checkRenderAbort(signal);
    // Call directly, before the next draw can mutate the canvas. Its promise is
    // observed immediately even if an interface callback or future draw fails.
    let submitted;
    try { submitted = Promise.resolve(submitFrame(time, frameSeconds)).then(value => ({ value }), error => ({ error })); }
    catch (error) { throw error; }
    const timestamp = now(), updateUi = index === 0 || index === frames - 1 || timestamp - lastUi >= 100;
    if (updateUi) { onFrame?.({ time, index, frames, duration }); lastUi = timestamp; }
    if (pipeline && index + 1 < frames) drawing = draw(index + 1);
    await read(submitted); checkRenderAbort(signal);
    if (updateUi) onProgress?.({ frame: index + 1, frames, progress: (index + 1) / frames });
    if (index + 1 < frames && now() - lastYield >= 32) { await yieldTask(signal); lastYield = now(); }
    if (!pipeline && index + 1 < frames) drawing = draw(index + 1);
  } } finally {
    drawingController.abort(); signal?.removeEventListener('abort', cancelDrawing);
    // Observe the final draw even when cancellation ends the submission first.
    // The renderer uses the drawing signal to discard delayed disk/asset work.
    await drawing;
  }
}
