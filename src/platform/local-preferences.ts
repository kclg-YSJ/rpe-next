import { nativeStorage, nativeReady, nativeWrite } from './native.ts';
import type { NativeEnvelope } from './native.ts';

const values = new Map<string, string>();
const pending = new Set<Promise<unknown>>();
const dirty = new Map<string, { value: string | null }>();

export async function initializeLocalPreferences(): Promise<void> {
  if (!nativeStorage) return;
  await nativeReady();
  const record = await nativeStorage.call<NativeEnvelope | null>('read', 'preferences', 'ui-settings');
  if (record) {
    const stored = record.data.values as Record<string, unknown> | undefined;
    for (const [key, value] of Object.entries(stored ?? {})) if (typeof value === 'string') values.set(key, value);
  } else {
    await nativeWrite('preferences', 'ui-settings', { id: 'ui-settings', values: Object.fromEntries(values) });
  }
}

function update(key: string, value: string | null): void {
  if (value === null) values.delete(key); else values.set(key, value);
  const entry = { value }; dirty.set(key, entry);
  send(key, entry).catch(() => {});
}
function send(key: string, entry: { value: string | null }): Promise<unknown> {
  const task = nativeStorage!.call('setLocalPreference', key, entry.value);
  pending.add(task);
  task.then(() => {
    if (dirty.get(key) === entry) dirty.delete(key);
  }, (error: unknown) => {
    document.dispatchEvent(new CustomEvent('rpen-preference-error', { detail: error }));
  }).finally(() => pending.delete(task));
  return task;
}

// Reads stay synchronous for the UI; only the storage worker writes to disk.
export const localPreferences = {
  getItem(key: string): string | null { return nativeStorage ? values.get(String(key)) ?? null : globalThis.localStorage?.getItem(key) ?? null; },
  setItem(key: string, value: string): void { if (nativeStorage) update(String(key), String(value)); else globalThis.localStorage?.setItem(key, value); },
  removeItem(key: string): void { if (nativeStorage) update(String(key), null); else globalThis.localStorage?.removeItem(key); },
};
export async function flushLocalPreferences(): Promise<void> {
  while (pending.size) await Promise.allSettled([...pending]);
  for (const [key, entry] of [...dirty]) await send(key, entry);
  while (pending.size) await Promise.allSettled([...pending]);
}
