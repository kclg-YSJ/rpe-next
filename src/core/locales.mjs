// Adding a language = add `src/locales/<tag>.mjs` and one line to the import
// list. Keeping one file on disk for core modules that write error messages,
// and reloading it from the UI wrapper (`/src/i18n.mjs`), matters: some hosts
// resolve the same file through different specifiers, and re-evaluating the
// engine would split the registry into two isolated instances.
// The import list is static so the same files load in the browser, Electron and
// Node tests. `settingsLanguage` is the packaged name used on disk.
import zhCN from '../locales/zh-CN.mjs';
import enUS from '../locales/en-US.mjs';
import { registerCatalog } from './i18n-core.mjs';

export const BUILTIN_LOCALES = [zhCN, enUS];
for (const catalog of BUILTIN_LOCALES) registerCatalog(catalog);

// Legacy RPE stores its own interface language; it maps onto the locale tag
// used by the application (the value equals the folder name shipped in
// `assets/lang` for the original editor).
export const RPE_LANGUAGE_TAGS = {
  Chinese: 'zh-CN',
  English: 'en-US',
};

export const DEFAULT_LANGUAGE = 'zh-CN';
