// Lists catalog entries whose value still contains Chinese, which usually means
// a translation pass was missed. Untranslated keys fall back at runtime, so this
// is a quality check rather than a correctness one.
//   node tools/i18n-audit.mjs [locale]
import { availableLocales } from '../src/i18n.mjs';

const locale = process.argv[2] ?? 'en-US';
const messages = (await import(`../src/locales/${locale}.mjs`)).default.messages;
const rows = Object.entries(messages).filter(([, value]) => /[\u4e00-\u9fff]/.test(value));
const known = availableLocales().map(entry => entry.locale);
console.log(`${rows.length} entries still contain Chinese in ${locale} (available: ${known.join(', ')})`);
for (const [key, value] of rows) console.log(`${key}|${value.replace(/\n/g, ' ')}`);
