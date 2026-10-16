const fromHex = (value: string): Uint8Array => Uint8Array.from(value.match(/../g) ?? [], part => parseInt(part, 16));

/** The host's local-route hint, as advertised over the wire. */
export interface LocalMediaHint {
  port?: unknown;
  proof?: unknown;
}

/**
 * Probes the host's loopback media route and verifies the host really controls it.
 *
 * The host signs a fresh nonce with a proof key it shares over the collaboration channel, so a
 * machine that merely happens to listen on that port cannot impersonate the route. Anything
 * unexpected — a malformed hint, a non-OK response, a bad signature — returns `null`, which the
 * caller treats as "no local route, use the tunnel".
 */
export async function verifyLocalMediaRoute(base: string | URL, hint: LocalMediaHint | null | undefined, request: (url: URL, init: RequestInit) => Promise<Response>, signal: AbortSignal): Promise<URL | null> {
  if (!Number.isInteger(hint?.port) || Number(hint?.port) < 1 || Number(hint?.port) > 65535 || typeof hint?.proof !== 'string' || !/^[0-9a-f]{64}$/.test(hint.proof)) return null;
  const nonce = crypto.randomUUID().replaceAll('-', '');
  const local = new URL(base); local.protocol = 'http:'; local.hostname = '127.0.0.1'; local.port = String(hint.port);
  const response = await request(new URL(`/collab/media/local/${nonce}`, local), {
    method: 'GET', signal: AbortSignal.any([signal, AbortSignal.timeout(1500)]),
    credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', cache: 'no-store'
  });
  if (!response.ok) return null;
  // The probe response is the host's own JSON; the signature field is validated before use.
  const result: unknown = await response.json();
  const record: Record<string, unknown> = result !== null && typeof result === 'object' ? result as Record<string, unknown> : {};
  if (typeof record.signature !== 'string' || !/^[0-9a-f]{64}$/.test(record.signature)) return null;
  // A `Uint8Array` is a valid `BufferSource` at runtime, but its default `ArrayBufferLike` backing is
  // not assignable to the DOM's `BufferSource`, which excludes `SharedArrayBuffer`. These bytes come
  // from a hex literal, so the backing is always plain — the same gap `images.ts` and `hitsounds.ts`
  // close on the binding.
  const proof = fromHex(hint.proof) as BufferSource;
  const signature = fromHex(record.signature) as BufferSource;
  const key = await crypto.subtle.importKey('raw', proof, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify('HMAC', key, signature, new TextEncoder().encode(nonce));
  signal.throwIfAborted();
  return valid ? local : null;
}
