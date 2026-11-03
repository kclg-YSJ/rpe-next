export function checkRenderAbort(signal) {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException('Render cancelled', 'AbortError');
}
export async function renderAwait(promise, signal) {
  checkRenderAbort(signal);
  if (!signal) return promise;
  let abort;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      abort = () => reject(signal.reason instanceof Error ? signal.reason : new DOMException('Render cancelled', 'AbortError'));
      signal.addEventListener('abort', abort, { once: true });
    })]);
  } finally { signal.removeEventListener('abort', abort); }
}
export const renderYield = signal => renderAwait(typeof globalThis.scheduler?.yield === 'function'
  ? globalThis.scheduler.yield() : new Promise(resolve => setTimeout(resolve, 0)), signal);
export function renderFramePlan(duration, fps) {
  if (!Number.isFinite(duration) || duration <= 0 || duration > 12 * 3600 || !Number.isFinite(fps) || fps <= 0) throw new RangeError('Invalid render interval');
  return { frames: Math.max(1, Math.ceil(duration * fps - 1e-9)), frameDuration: 1 / fps, duration };
}
