// Applies the saved interface language before any other module is evaluated.
//
// Import this first from the UI entry point. It must stay synchronous: a
// top-level await would let the sibling imports listed after it evaluate while
// this module is suspended, and their label tables (`EVENT_TYPES`, pattern
// names, tooltips…) would freeze in the reference language.
//
// The choice is mirrored into localStorage because the desktop build loads its
// preferences from the native store asynchronously, after this module runs.
import { availableLocales, baseLocale, normalizeLocale, setLocale } from '../core/i18n-core.mjs';
import '../core/locales.mjs';
import { localPreferences } from './local-preferences.mjs';
import { LOCALE_STORAGE_KEY } from './locale.mjs';

function readStored() {
  try {
    const value = globalThis.localStorage?.getItem(LOCALE_STORAGE_KEY);
    if (value) return value;
  } catch { /* storage unavailable */ }
  try { return localPreferences.getItem(LOCALE_STORAGE_KEY) ?? ''; } catch { return ''; }
}

function supported(candidate) {
  const wanted = normalizeLocale(candidate);
  if (!wanted) return null;
  const locales = availableLocales();
  return locales.find(({ locale }) => locale === wanted)?.locale
    ?? locales.find(({ locale }) => baseLocale(locale) === baseLocale(wanted))?.locale
    ?? null;
}

const stored = readStored();
const browser = typeof navigator === 'object' ? (navigator.languages?.[0] ?? navigator.language ?? '') : '';
for (const candidate of [stored, browser]) {
  const locale = supported(candidate);
  if (!locale) continue;
  setLocale(locale);
  break;
}
