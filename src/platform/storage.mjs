import { t } from '../i18n.mjs';
export function storageError(data, fallback = t('storage.sc6a19cd')) {
  const error = new Error(data?.message || fallback);
  error.name = data?.name || 'Error';
  for (const key of ['projectId', 'expectedRevision', 'actualRevision']) if (data?.[key] !== undefined) error[key] = data[key];
  return error;
}

export function storageFailure(error) {
  if (error?.name === 'QuotaExceededError' || /quota.*(?:exceed|full)|disk.*full/i.test(error?.message ?? '')) return t('storage.s206c0cb');
  if (error?.name === 'VersionError') return t('storage.s95fed41');
  return error?.message || String(error);
}

export function ensureStore(connection, transaction, name, options) {
  return connection.objectStoreNames.contains(name) ? transaction.objectStore(name) : connection.createObjectStore(name, options);
}

export function openDatabase(name, version, upgrade, { blockedTimeout = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    let expired = false, timer;
    const request = indexedDB.open(name, version);
    request.onupgradeneeded = event => {
      try { upgrade(request.result, request.transaction, event.oldVersion); }
      catch (error) { request.transaction.abort(); reject(error); }
    };
    request.onblocked = () => {
      if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('rpen-storage-blocked', { detail: { name } }));
      timer ??= setTimeout(() => { expired = true; reject(storageError({ name: 'StorageBlockedError', message: t('storage.sbf19bb7') })); }, blockedTimeout);
    };
    request.onerror = () => { clearTimeout(timer); reject(request.error); };
    request.onsuccess = () => {
      clearTimeout(timer);
      const connection = request.result;
      connection.onversionchange = () => connection.close();
      if (expired) connection.close(); else resolve(connection);
    };
  });
}

export async function storageStatus(manager = globalThis.navigator?.storage) {
  if (nativeStorage) { await nativeReady(); return { supported: true, persistent: true, ...await nativeStorage.call('status') }; }
  if (!manager) return { supported: false, persistent: null, usage: null, quota: null };
  const [persistent, estimate] = await Promise.all([manager.persisted?.() ?? null, manager.estimate?.() ?? {}]);
  return { supported: true, persistent, usage: estimate.usage ?? null, quota: estimate.quota ?? null };
}

export async function requestPersistence(manager = globalThis.navigator?.storage) {
  if (nativeStorage) return true;
  if (!manager?.persist) return null;
  if (await manager.persisted?.()) return true;
  return manager.persist();
}
import { nativeStorage, nativeReady } from './native.mjs';
