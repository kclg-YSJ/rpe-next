// Persists the interface language choice. Unset means "follow the browser /
// legacy RPE settings"; an explicit choice survives restarts in every host.
import { DEFAULT_LANGUAGE, RPE_LANGUAGE_TAGS } from '../core/locales.mjs';
import { localPreferences } from './local-preferences.mjs';

export const LOCALE_STORAGE_KEY = 'rpe-next-locale-v1';

// Returns the language recorded for the editor: an explicit choice first, then
// the language of migrated RPE settings, or an empty string when unset.
export function readLocalePreference(storage = localPreferences) {
  try {
    const stored = storage.getItem(LOCALE_STORAGE_KEY);
    if (stored) return String(stored);
  } catch { /* storage unavailable (private mode, quota) */ }
  return '';
}

export function writeLocalePreference(locale, storage = localPreferences) {
  try {
    if (locale) storage.setItem(LOCALE_STORAGE_KEY, String(locale));
    else storage.removeItem(LOCALE_STORAGE_KEY);
  } catch { /* ignore: the UI still switches for this session */ }
  // Mirrored locally so the next launch can pick the language up synchronously,
  // before the desktop preference store has finished loading.
  try {
    if (locale) globalThis.localStorage?.setItem(LOCALE_STORAGE_KEY, String(locale));
    else globalThis.localStorage?.removeItem(LOCALE_STORAGE_KEY);
  } catch { /* storage unavailable */ }
}

// Languages of the legacy RPE configuration the user migrated. The original
// editor stored a folder name (e.g. `Chinese`), so map known names to tags.
export function localeCandidates(settings = {}) {
  const candidates = [];
  const language = settings?.language;
  if (typeof language === 'string' && language.trim()) candidates.push(RPE_LANGUAGE_TAGS[language] ?? language);
  for (const entry of Array.isArray(settings?.languages) ? settings.languages : []) {
    if (typeof entry === 'string') candidates.push(entry);
    else if (entry && typeof entry === 'object' && entry.enabled !== false && entry.name) candidates.push(entry.name);
  }
  return candidates.map(candidate => RPE_LANGUAGE_TAGS[candidate] ?? candidate).filter(Boolean);
}

export function preferredLocales({ stored = '', settings = {}, browser = globalThis.navigator?.language } = {}) {
  const order = [];
  const add = value => {
    if (!value) return;
    const text = String(value);
    for (const candidate of [text, text.split('-')[0]]) if (candidate && !order.includes(candidate)) order.push(candidate);
  };
  add(stored);
  for (const candidate of localeCandidates(settings)) add(candidate);
  add(browser);
  add(DEFAULT_LANGUAGE);
  return order;
}
