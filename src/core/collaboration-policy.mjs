import { t } from '../i18n.mjs';
export function collaborationConnectSources(additionalOrigins = '') {
  const sources = new Set(["'self'", 'ws:', 'wss:', 'http://127.0.0.1:*/collab/media/', 'http://localhost:*/collab/media/', 'https://*.trycloudflare.com/collab/media/']);
  for (const value of additionalOrigins.split(/[\s,]+/).filter(Boolean)) {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/' || url.hostname.includes('*')) throw new Error(t('collaboration-policy.s45d9ae6'));
    sources.add(`${url.origin}/collab/media/`);
  }
  return [...sources].join(' ');
}
