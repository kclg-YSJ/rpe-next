// Checks that every `t('…')` key used in `src` exists in the reference
// catalog, and that index.html markup keys resolve too.
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILTIN_LOCALES } from '../src/core/locales.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const reference = BUILTIN_LOCALES[0];
const messages = reference.messages;

const files = [];
const walk = async directory => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'vendor') continue;
    const full = join(directory, entry.name);
    if (entry.isDirectory()) await walk(full);
    else if (entry.name.endsWith('.mjs') && entry.name !== 'i18n.mjs' && !entry.name.startsWith('i18n-')) files.push(full);
  }
};
await walk(join(root, 'src'));
files.push(join(root, 'index.html'));

const missing = new Map();
for (const file of files) {
  const text = await readFile(file, 'utf8');
  const keys = [...text.matchAll(/(?<![.\w$])t\(\s*'([\w.-]+)'/g)].map(match => match[1]);
  const markup = [...text.matchAll(/data-i18n(?:-title|-aria-label|-placeholder|-alt)?="([\w.-]+)"/g)].map(match => match[1]);
  for (const key of [...keys, ...markup]) if (!(key in messages)) {
    const name = relative(root, file).replaceAll('\\', '/');
    if (!missing.has(name)) missing.set(name, new Set());
    missing.get(name).add(key);
  }
}
if (!missing.size) { console.log(`All ${Object.keys(messages).length} keys resolve.`); process.exit(0); }
let total = 0;
for (const [file, keys] of missing) { total += keys.size; console.log(`${file}: ${keys.size} missing (${[...keys].slice(0, 4).join(', ')})`); }
console.log(`missing ${total} keys`);
process.exitCode = 1;
