/**
 * The hashing worker: it announces readiness, then answers each message with the SHA-256 of the
 * bytes it received. The main thread watches for the `ready` and `digest-start` phases, which is how
 * the desktop smoke test proves the worker actually ran rather than falling back to inline hashing.
 */
interface HashWorkerScope {
  onmessage: ((event: MessageEvent<ArrayBuffer>) => void) | null;
  postMessage(message: unknown): void;
}

const scope = self as unknown as HashWorkerScope;

scope.postMessage({ phase: 'ready' });
scope.onmessage = async event => {
  try {
    scope.postMessage({ phase: 'digest-start' });
    const digest = await crypto.subtle.digest('SHA-256', event.data);
    const hash = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
    scope.postMessage({ hash });
  } catch (error) { scope.postMessage({ error: (error as Error).message || '素材校验失败' }); }
};
