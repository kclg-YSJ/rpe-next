import { binaryNoiseMask, fitNoiseRectangles } from './noise-fit.ts';
import type { NoiseFit } from './noise-fit.ts';

/** The raster and options the panel posts to the worker. */
interface FitRequest {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  options: { threshold?: number; polarity?: 'dark' | 'light' | 'alpha'; invert?: boolean; maxSpan?: number; merge?: boolean; trim?: boolean };
}

/** The worker scope surface this entry point uses; the DOM lib types `self` as the window. */
interface WorkerScope {
  onmessage: ((event: MessageEvent<FitRequest>) => void) | null;
  postMessage(message: { result?: NoiseFit; error?: string }): void;
}

const scope = self as unknown as WorkerScope;
scope.onmessage = ({ data }) => {
  try {
    const mask = binaryNoiseMask(data.pixels, data.width, data.height, data.options);
    const result = fitNoiseRectangles(mask, data.width, data.height, data.options);
    scope.postMessage({ result });
  } catch (error) { scope.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
