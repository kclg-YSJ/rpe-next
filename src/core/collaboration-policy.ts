/**
 * The Content-Security-Policy `connect-src` list the desktop shell and the dev server hand to the
 * renderer: the collaboration transport may open a WebSocket to the host it was given, and media
 * transfers additionally use the local and tunneled media routes listed here.
 *
 * Extra origins are opt-in through `RPE_MEDIA_ORIGINS`, and each is rejected unless it is a bare
 * HTTP(S) origin — no credentials, query, fragment, path or wildcard — so a typo cannot silently
 * widen the policy to somewhere unexpected.
 */
export function collaborationConnectSources(additionalOrigins = ''): string {
  const sources = new Set(["'self'", 'ws:', 'wss:', 'http://127.0.0.1:*/collab/media/', 'http://localhost:*/collab/media/', 'https://*.trycloudflare.com/collab/media/']);
  for (const value of additionalOrigins.split(/[\s,]+/).filter(Boolean)) {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/' || url.hostname.includes('*')) throw new Error('RPE_MEDIA_ORIGINS 只能填写明确的 HTTP/HTTPS 源地址');
    sources.add(`${url.origin}/collab/media/`);
  }
  return [...sources].join(' ');
}
