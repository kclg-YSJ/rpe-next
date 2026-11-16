export function registerPwa() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
  const register = () => {
    const script = new URL('../../sw.js', import.meta.url);
    navigator.serviceWorker.register(script, { updateViaCache: 'none' }).catch(() => {
      // Service workers are unavailable over insecure origins or in restricted contexts.
    });
  };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
