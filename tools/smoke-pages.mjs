import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const root = new URL('../dist/', import.meta.url);
const entries = await readdir(root, { recursive: true, withFileTypes: true });
const site = new URL('https://example.com/rpe-next/');
const names = new Set(entries.filter(entry => entry.isFile()).map(entry => relative(fileURLToPath(root), join(entry.parentPath, entry.name)).replaceAll('\\', '/')));
assert.ok(names.has('index.html'), 'index.html is missing from the Pages artifact');
assert.ok(names.has('LICENSE') && names.has('NOTICE') && names.has('.nojekyll'), 'licence files or the Pages marker are missing');
for (const protocol of ['EDITOR-SKIN', 'MOD', 'GLOBAL-EVENTS']) assert.ok(names.has(`protocols/${protocol}-PROTOCOL.zh-CN.md`), `${protocol} protocol is missing`);
const mods = JSON.parse(await readFile(new URL('assets/mods/index.json', root), 'utf8'));
assert.deepEqual(mods.map(mod => mod.directory), ['sky-dodge', 'pixel-miner', 'spatial-camera']);
for (const name of names) assert.match(name, /^(?:index\.html|LICENSE|NOTICE|\.nojekyll|protocols\/.+\.md|schemas\/.+|assets\/.+)$/);
function checkReference(reference, file) {
  if (/^(?:[a-z]+:)?\/\//i.test(reference) || reference.startsWith('data:') || reference.startsWith('#')) return;
  const resolved = new URL(reference, new URL(file, site));
  assert.ok(resolved.href.startsWith(site.href), `${file}: reference escapes site: ${reference}`);
  assert.ok(names.has(decodeURIComponent(resolved.href.slice(site.href.length))), `${file}: missing resource: ${reference}`);
}
for (const name of names) {
  if (name.startsWith('protocols/') && name.endsWith('.md')) {
    const source = await readFile(new URL(name, root), 'utf8');
    for (const match of source.matchAll(/\]\(([^\s)#]+)(?:#[^)]*)?\)/g)) if (!/^[a-z]+:/i.test(match[1])) checkReference(match[1], name);
  }
  if (!/\.(?:html|css)$/.test(name)) continue;
  const source = await readFile(new URL(name, root), 'utf8');
  const expressions = name.endsWith('.html') ? [/(?:src|href)="([^"#]+)"/g] : [/url\(['"]?([^'"\)]+)['"]?\)/g];
  for (const expression of expressions) for (const match of source.matchAll(expression)) checkReference(match[1], name);
}
// assetUrl() is the single runtime entry point for textures, hitsounds, shaders and easing
// pictures, so the base has to reach the helper itself: Vite rebasing the HTML and CSS links would
// not cover it. Minified output concatenates the base literal directly with `assets/`, so require
// the two to be adjacent rather than merely present somewhere in a ~340 kB bundle.
const bundles = [...names].filter(name => /^assets\/.+\.js$/.test(name));
assert.ok(bundles.length, 'no JavaScript bundle was emitted');
const codes = await Promise.all(bundles.map(name => readFile(new URL(name, root), 'utf8')));
const carriesBase = codes.some(code => /\/rpe-next\/[\s\S]{0,120}?assets\//.test(code));
assert.ok(carriesBase, 'the Pages build did not compile the /rpe-next/ base into the asset helper');
console.log(`Pages artifact verified: ${names.size} allowed files; HTML and CSS references stay under /rpe-next/.`);
