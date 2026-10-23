import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { parse } from '../src/core/vendor/acorn.mjs';

const root = new URL('../dist/', import.meta.url);
const entries = await readdir(root, { recursive: true, withFileTypes: true });
const site = new URL('https://example.com/rpe-next/');
const names = new Set(entries.filter(entry => entry.isFile()).map(entry => relative(fileURLToPath(root), join(entry.parentPath, entry.name)).replaceAll('\\', '/')));
assert.ok(names.has('LICENSE') && names.has('NOTICE') && names.has('.nojekyll'));
for(const protocol of ['EDITOR-SKIN','MOD','GLOBAL-EVENTS'])assert.ok(names.has(`protocols/${protocol}-PROTOCOL.zh-CN.md`));
assert.ok(names.has('protocols/CHART-VERSION-CONTROL.zh-CN.md'));
const mods=JSON.parse(await readFile(new URL('assets/mods/index.json',root),'utf8'));
assert.deepEqual(mods.map(mod=>mod.directory),['sky-dodge','pixel-miner','spatial-camera']);
for (const name of names) assert.match(name, /^(?:index\.html|styles\.css|LICENSE|NOTICE|protocols\/(?:(?:EDITOR-SKIN|MOD|GLOBAL-EVENTS)-PROTOCOL|CHART-VERSION-CONTROL)\.zh-CN\.md|schemas\/(?:mod-(?:v1\.schema\.json|api-v1\.d\.ts)|editor-skin-(?:v1\.schema|components\.v1)\.json)|\.nojekyll|assets\/.+|src\/(?:core|application|platform|ui|locales)\/.+|src\/i18n\.mjs)$/);
function checkReference(reference, file) {
  const resolved = new URL(reference, new URL(file, site));
  assert.ok(resolved.href.startsWith(site.href), `${file}: reference escapes site: ${reference}`);
  assert.ok(names.has(decodeURIComponent(resolved.href.slice(site.href.length))), `${file}: missing resource: ${reference}`);
}
for (const name of names) {
  if(name.startsWith('protocols/')&&name.endsWith('.md')){
    const source=await readFile(new URL(name,root),'utf8');
    for(const match of source.matchAll(/\]\(([^\s)#]+)(?:#[^)]*)?\)/g))if(!/^[a-z]+:/i.test(match[1]))checkReference(match[1],name);
  }
  if (!/\.(mjs|html|css)$/.test(name)) continue;
  const source = await readFile(new URL(name, root), 'utf8');
  if(name.endsWith('.mjs')){
    const ast=parse(source,{ecmaVersion:'latest',sourceType:'module'});
    for(const node of ast.body)if(['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration'].includes(node.type)&&node.source){const specifier=node.source.value;const reference=specifier==='@rpen/api'?'src/ui/mod-api.mjs':specifier.startsWith('@rpen/')?'src/'+specifier.slice(6):null;if(reference)checkReference('./'+reference,'index.html');else checkReference(specifier,name);}continue;
  }
  const expressions = name.endsWith('.html') ? [/(?:src|href)="([^"#]+)"/g] : [/url\(['"]?([^'"\)]+)['"]?\)/g];
  for (const expression of expressions) for (const match of source.matchAll(expression)) checkReference(match[1], name);
}
console.log(`Pages artifact verified: ${names.size} allowed files; module, HTML and CSS references stay under /rpe-next/.`);
