import { fitTextMask } from './text-fit.mjs';
self.onmessage = event => {
  try { const result = fitTextMask(event.data); self.postMessage({ result }, [result.covered.buffer]); }
  catch (error) { self.postMessage({ error: error.message }); }
};
