import { Readable } from 'node:stream';

const redirectCodes = new Set([301, 302, 303, 307, 308]);
function responseHeaders(source = {}) {
  const result = new Headers();
  for (const [name, values] of Object.entries(source)) for (const value of Array.isArray(values) ? values : [values]) if (value !== undefined) result.append(name, String(value));
  return result;
}

// Electron net.fetch rejects redirect:"manual" instead of returning the 3xx
// response. Surface that response using ClientRequest's redirect event, so
// trustedUpdateFetch can validate every hop before making the next request.
// ClientRequest uses Chromium's session network stack and system proxy.
export function createUpdateFetcher(net) {
  return (url, options = {}) => new Promise((accept, reject) => {
    let request, response, settled = false;
    const signal = options.signal;
    const abortReason = () => signal?.reason ?? new DOMException('Aborted', 'AbortError');
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const fail = error => { if (settled) return; settled = true; cleanup(); reject(error); };
    const abort = () => {
      const reason = abortReason();
      if (!settled) fail(reason);
      response?.destroy(reason); request?.abort();
    };
    if (signal?.aborted) { fail(abortReason()); return; }
    try {
      request = net.request({ url: String(url), method: 'GET', redirect: 'manual', useSessionCookies: false, credentials: 'omit' });
      request.setHeader('Cache-Control', 'no-cache, no-store');
      request.setHeader('Pragma', 'no-cache');
      for (const [name, value] of new Headers(options.headers)) request.setHeader(name, value);
      request.on('error', error => { if (!settled) fail(error); else response?.destroy(error); });
      request.on('redirect', (status, method, address, headers) => {
        if (settled) return;
        try {
          if (!redirectCodes.has(status) || !address) throw Object.assign(Error('Invalid update redirect'), { code: 'UPDATE_REDIRECT' });
          const values = responseHeaders(headers); values.set('location', address);
          const result = new Response(null, { status, headers: values });
          settled = true; cleanup(); accept(result);
        } catch (error) { fail(error); }
        // Never follow automatically. The caller validates the destination and
        // creates a fresh, credential-free request if it is trusted.
        request.abort();
      });
      request.on('response', incoming => {
        if (settled) { incoming.destroy(); return; }
        response = incoming;
        incoming.once('end', cleanup); incoming.once('close', cleanup); incoming.once('error', cleanup);
        try {
          const noBody = [204, 205, 304].includes(incoming.statusCode);
          const body = noBody ? null : Readable.toWeb(incoming);
          const result = new Response(body, { status: incoming.statusCode, headers: responseHeaders(incoming.headers) });
          settled = true; accept(result); if (noBody) incoming.resume();
        } catch (error) { fail(error); incoming.destroy(); request.abort(); }
      });
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) { abort(); return; }
      request.end();
    } catch (error) { fail(error); request?.abort(); }
  });
}
