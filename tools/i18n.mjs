// Maintenance helpers for the locale files.
//   node tools/i18n.mjs check          validate catalogs (default)
//   node tools/i18n.mjs report         coverage per source file
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const localeDirectory = join(root, 'src', 'locales');

export async function loadCatalogs() {
  const files = (await readdir(localeDirectory)).filter(name => name.endsWith('.mjs'));
  const catalogs = new Map();
  for (const name of files) {
    const module = await import(new URL(`../src/locales/${name}`, import.meta.url));
    const catalog = module.default ?? {};
    catalogs.set(catalog.locale ?? name.replace(/\.mjs$/, ''), { ...catalog, file: name });
  }
  return catalogs;
}

const placeholders = template => new Set([...String(template).matchAll(/\{(\w+)\}/g)].map(match => match[1]));

export async function checkCatalogs({ reference = 'zh-CN', verbose = false } = {}) {
  const catalogs = await loadCatalogs();
  const problems = [];
  if (!catalogs.has(reference)) problems.push(`Missing reference catalog "${reference}"`);
  const registered = await import(new URL('../src/core/locales.mjs', import.meta.url));
  const registeredLocales = new Set(registered.BUILTIN_LOCALES.map(catalog => catalog.locale));
  for (const locale of catalogs.keys()) if (!registeredLocales.has(locale)) problems.push(`${locale}: not listed in src/core/locales.mjs`);
  for (const locale of registeredLocales) if (!catalogs.has(locale)) problems.push(`${locale}: listed in src/core/locales.mjs but has no catalog file`);
  const base = catalogs.get(reference);
  const fallbacks = [];
  if (base) {
    for (const [locale, catalog] of catalogs) {
      if (locale === reference) continue;
      for (const [key, template] of Object.entries(catalog.messages)) {
        const expected = base.messages[key];
        if (expected === undefined) { problems.push(`${locale}: unknown key ${key}`); continue; }
        const wanted = placeholders(expected), actual = placeholders(template);
        for (const name of wanted) if (!actual.has(name)) problems.push(`${locale}: ${key} is missing {${name}}`);
        for (const name of actual) if (!wanted.has(name)) problems.push(`${locale}: ${key} has extra {${name}}`);
      }
      for (const key of Object.keys(base.messages)) {
        if (catalog.messages[key] !== undefined) continue;
        if (base.messages[key].includes('{')) continue;
        fallbacks.push(`${locale}: ${key}`);
      }
    }
  }
  if (verbose) for (const line of fallbacks) console.log(`  fallback ${line}`);
  if (problems.length) throw new Error(`Locale check failed with ${problems.length} problem(s):\n  ${problems.join('\n  ')}`);
  return { catalogs, fallbacks };
}

export function translationReport(catalog, keys) {
  const missing = keys.filter(key => catalog.messages[key] === undefined);
  const percent = keys.length ? (100 * (keys.length - missing.length) / keys.length) : 100;
  return { missing, percent };
}

async function walk(directory, output = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'vendor') continue;
    const full = join(directory, entry.name);
    if (entry.isDirectory()) await walk(full, output);
    else if (entry.name.endsWith('.mjs') && !entry.name.startsWith('i18n')) output.push(full);
  }
  return output;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const command = process.argv[2] ?? 'check';
  if (command === 'check') {
    const { catalogs, fallbacks } = await checkCatalogs({ verbose: process.argv.includes('--verbose') });
    for (const [locale, catalog] of catalogs) console.log(`${locale}: ${Object.keys(catalog.messages).length} messages (src/locales/${catalog.file})`);
    if (fallbacks.length) console.log(`${fallbacks.length} keys fall back to the reference language (run with --verbose to list them).`);
    console.log('Locale catalogs are consistent.');
  } else if (command === 'report') {
    const files = await walk(join(root, 'src'));
    const rows = [];
    for (const file of files) {
      const text = await readFile(file, 'utf8');
      const keys = [...text.matchAll(/(?<![.\w$])t\(\s*'([\w.-]+)'/g)].map(match => match[1]);
      if (keys.length) rows.push({ file: relative(root, file).replaceAll('\\', '/'), keys: [...new Set(keys)] });
    }
    for (const [locale, catalog] of await loadCatalogs()) {
      const all = rows.flatMap(row => row.keys);
      const { percent } = translationReport(catalog, all);
      console.log(`\n${locale}: ${percent.toFixed(1)}% of ${new Set(all).size} keys`);
      for (const { file, keys } of rows) {
        const { percent: filePercent, missing } = translationReport(catalog, keys);
        if (missing.length) console.log(`  ${filePercent.toFixed(0).padStart(3)}%  ${file} (${missing.length}/${keys.length})`);
      }
    }
  } else throw new Error(`Unknown command: ${command}`);
}
