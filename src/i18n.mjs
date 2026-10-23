// UI-side translation entry point used by every module. The engine lives in
// `core/i18n-core.mjs` and is always reached through that single path so the
// catalog registry is shared with core modules that produce error messages.
import { translate, translateExternal } from './core/i18n-core.mjs';
import { BUILTIN_LOCALES } from './core/locales.mjs';

export * from './core/i18n-core.mjs';
export { BUILTIN_LOCALES };

export const t = translate;
export const te = translateExternal;
