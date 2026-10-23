import { t } from '../i18n.mjs';
self.postMessage({ phase: 'ready' });
self.onmessage = async event => {
  try {
    self.postMessage({ phase: 'digest-start' });
    const digest = await crypto.subtle.digest('SHA-256', event.data);
    const hash = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
    self.postMessage({ hash });
  } catch (error) { self.postMessage({ error: error.message || t('collaboration-hash-worker.sa71bb40') }); }
};
