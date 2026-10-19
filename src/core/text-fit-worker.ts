import { fitTextMask } from './text-fit.ts';
import type { TextFitRequest } from './text-fit.ts';

/**
 * The slice of a dedicated worker's global scope this file uses.
 *
 * Declared here because the project's `lib` is the DOM set, where `self` is a `Window` whose
 * `postMessage` takes a `targetOrigin` rather than a transfer list.
 */
interface TextFitWorkerScope {
  onmessage: ((event: MessageEvent<TextFitRequest>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

const worker = self as unknown as TextFitWorkerScope;
worker.onmessage = (event: MessageEvent<TextFitRequest>): void => {
  try { const result = fitTextMask(event.data); worker.postMessage({ result }, [result.covered.buffer]); }
  catch (error) { worker.postMessage({ error: (error as Error).message }); }
};
