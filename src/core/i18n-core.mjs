// Locale-agnostic text engine, loaded directly by core modules so registration
// always shares one instance. Adding a language only needs a file in
// `src/locales/` plus one entry in `src/core/locales.mjs`; no other code has to
// change. Modules import `t` for UI strings; chart data and stored project
// names stay locale-independent.

export const FALLBACK_LOCALE = 'zh-CN';

const catalogs = new Map();
const listeners = new Set();
let active = FALLBACK_LOCALE;
let activeBase = FALLBACK_LOCALE;
let activeInfo = { locale: FALLBACK_LOCALE, label: FALLBACK_LOCALE, messages: {} };
const formatters = new Map();

export function normalizeLocale(value) {
  const text = String(value ?? '').trim().replace(/_/g, '-');
  if (!text) return '';
  const [language, region] = text.split('-');
  return region ? `${language.toLowerCase()}-${region.toUpperCase()}` : language.toLowerCase();
}

export function baseLocale(value) {
  return normalizeLocale(value).split('-')[0];
}

export function registerCatalog(info) {
  if (!info || !info.locale) throw new Error('Locale catalog requires a locale id');
  const locale = normalizeLocale(info.locale);
  const messages = Object.freeze({ ...(info.messages ?? {}) });
  const extras = Object.freeze(info.extras ?? {});
  const entry = { locale, label: String(info.label ?? locale), messages, extras };
  catalogs.set(locale, entry);
  if (locale === active) applyCatalog(entry);
  return entry;
}

function applyCatalog(entry) {
  active = entry.locale;
  activeBase = baseLocale(entry.locale);
  activeInfo = entry;
  emit('locale');
}

export function availableLocales() {
  return [...catalogs.values()].map(({ locale, label }) => ({ locale, label }));
}

export function currentLocale() {
  return { locale: active, base: activeBase, label: activeInfo.label };
}

export function setLocale(value) {
  const requested = normalizeLocale(value);
  const match = catalogs.get(requested)
    ?? [...catalogs.keys()].find(locale => baseLocale(locale) === baseLocale(requested))
    ?? catalogs.get(FALLBACK_LOCALE)
    ?? [...catalogs.values()][0];
  if (!match) return currentLocale();
  if (match.locale !== active) applyCatalog(match);
  return currentLocale();
}

export function message(locale, key, parameters) {
  const entry = catalogs.get(normalizeLocale(locale));
  if (!entry) return undefined;
  const template = entry.messages[key];
  return template === undefined ? undefined : interpolate(template, parameters);
}

export function hasMessage(key, locale = active) {
  return catalogs.get(normalizeLocale(locale))?.messages[key] !== undefined;
}

export function catalogExtras(locale = active, name) {
  const entry = catalogs.get(normalizeLocale(locale));
  if (!entry) return undefined;
  return name === undefined ? entry.extras : entry.extras[name];
}

// Counted strings use CLDR plural categories (`foo.one`, `foo.other`, …) with
// an optional plain `foo` as fallback. Languages that do not know a category
// fall back to `other`, so a new locale only has to translate the categories
// listed for it in `messages` (zh-CN keeps just `foo.other`).
function pluralTemplate(messages, base, count) {
  if (!messages) return undefined;
  const category = pluralText(active, count);
  for (const candidate of [`${base}.${category}`, `${base}.other`, base]) {
    if (messages[candidate] !== undefined) return messages[candidate];
  }
  return undefined;
}

export function translate(key, parameters) {
  const activeMessages = catalogs.get(active)?.messages;
  const fallbackMessages = catalogs.get(FALLBACK_LOCALE)?.messages;
  let template = activeMessages?.[key];
  if (template === undefined && parameters && Object.hasOwn(parameters, 'count')) template = pluralTemplate(activeMessages, key, parameters.count);
  if (template === undefined && key.includes('.count')) template = pluralTemplate(activeMessages, key.split('.')[0], parameters?.count ?? 0);
  if (template === undefined) template = fallbackMessages?.[key];
  if (template === undefined && parameters && Object.hasOwn(parameters, 'count')) template = pluralTemplate(fallbackMessages, key, parameters.count);
  if (template === undefined) return String(key);
  return interpolate(template, parameters);
}

function formatter(Base, options) {
  const key = `${Base.name}:${JSON.stringify(options ?? null)}`;
  if (!formatters.has(key)) {
    try { formatters.set(key, new Base(active, options)); }
    catch { formatters.set(key, new Base(FALLBACK_LOCALE, options)); }
  }
  return formatters.get(key);
}

function interpolationValue(value) {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return formatter(Intl.ListFormat, { style: 'long', type: 'conjunction' }).format(value.map(String));
  if (typeof value === 'number') return String(value);
  if (value instanceof Date) return formatter(Intl.DateTimeFormat, { dateStyle: 'medium', timeStyle: 'short' }).format(value);
  return String(value);
}

export function numberText(value, options) {
  if (!Number.isFinite(value)) return String(value);
  return formatter(Intl.NumberFormat, options).format(value);
}

export function dateText(value, options) {
  return formatter(Intl.DateTimeFormat, options).format(value);
}

export function pluralText(locale, category) {
  try { return new Intl.PluralRules(normalizeLocale(locale)).select(Number(category)); }
  catch { return 'other'; }
}

function interpolate(template, parameters) {
  if (!parameters) return template;
  return String(template).replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(parameters, name) ? interpolationValue(parameters[name]) : match);
}

// Picks a value out of a per-locale map such as
// `{ 'zh-CN': '谱面', 'en-US': 'Chart' }`. Plain strings pass through, so skin
// packages keep working without localization. Order: exact tag, base language,
// the reference language, then the first entry the map provides.
export function localizedValue(value, fallbackLocale = FALLBACK_LOCALE) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  const entries = Object.entries(value).filter(([, text]) => typeof text === 'string');
  if (!entries.length) return undefined;
  const lookup = tag => {
    const wanted = normalizeLocale(tag);
    return entries.find(([key]) => normalizeLocale(key) === wanted)?.[1]
      ?? entries.find(([key]) => baseLocale(key) === baseLocale(wanted))?.[1];
  };
  return lookup(active) ?? lookup(fallbackLocale) ?? entries[0][1];
}

export function isLocalizedMap(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && Object.entries(value).every(([key, text]) => /^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$/.test(key) && typeof text === 'string');
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(reason) {
  for (const listener of [...listeners]) {
    try { listener(currentLocale(), reason); } catch { /* a broken listener must not break others */ }
  }
}

// Preferred-locale order used for file-system matching (hotkey templates and
// other localized text snippets). Recorded settings locales come first, then
// the browser preference, then the active UI language.
function preferenceOrder() {
  const order = [];
  const add = value => {
    const normalized = normalizeLocale(value);
    if (!normalized) return;
    for (const candidate of [normalized, baseLocale(normalized)]) if (!order.includes(candidate)) order.push(candidate);
  };
  const options = globalThis.__rpenLocaleOptions;
  if (Array.isArray(options)) for (const option of options) add(option);
  const browser = typeof navigator === 'object' ? navigator.language : '';
  add(browser);
  add(active);
  return order;
}

// Translate a key found in external files (such as a migrated `Hotkey.txt`).
// `fileLocales` lists the languages those files are written in. Values written
// in the active language win, then recorded/user preferences, then the file
// locales, then fallback. Matching ignores case and surrounding whitespace.
export function translateExternal(text, fileLocales = [FALLBACK_LOCALE]) {
  const needle = String(text ?? '').trim();
  if (!needle) return text;
  const lower = needle.toLocaleLowerCase();
  const order = [];
  const add = locale => { const normalized = normalizeLocale(locale); if (normalized && !order.includes(normalized)) order.push(normalized); };
  add(active);
  for (const locale of preferenceOrder()) add(locale);
  for (const locale of fileLocales) { add(locale); add(FALLBACK_LOCALE); break; }
  for (const entry of catalogs.values()) add(entry.locale);
  for (const locale of order) {
    const messages = catalogs.get(locale)?.messages;
    if (!messages) continue;
    for (const [key, template] of Object.entries(messages)) {
      if (String(template).trim().toLocaleLowerCase() === lower) return translate(key);
    }
  }
  return text;
}
