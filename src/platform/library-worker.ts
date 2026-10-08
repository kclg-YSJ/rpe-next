import { storeProjectDirect } from './library.ts';
import type { StoredProject } from './library.ts';

/**
 * The background-save worker. It receives one project per message and reports success or the
 * failure message, so the page can reject the caller's promise with the same text it would have
 * produced had the write happened inline.
 */
interface WorkerScope {
  onmessage: ((event: MessageEvent<StoredProject>) => void) | null;
  postMessage(message: unknown): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = async ({ data }) => {
  try { await storeProjectDirect(data); scope.postMessage({ ok: true }); }
  catch (error) { scope.postMessage({ ok: false, message: (error as Error).message }); }
};
