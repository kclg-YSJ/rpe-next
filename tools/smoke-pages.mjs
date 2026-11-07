import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { parse } from '../src/core/vendor/acorn.mjs';
import { AgentSourceIndex } from '../src/core/agent-source.mjs';

const root = new URL('../dist/', import.meta.url);
const entries = await readdir(root, { recursive: true, withFileTypes: true });
const site = new URL('https://example.com/rpe-next/');
const names = new Set(entries.filter(entry => entry.isFile()).map(entry => relative(fileURLToPath(root), join(entry.parentPath, entry.name)).replaceAll('\\', '/')));
assert.ok(names.has('LICENSE') && names.has('NOTICE') && names.has('.nojekyll'));
for(const protocol of ['EDITOR-SKIN','MOD','GLOBAL-EVENTS','AI-AGENT'])assert.ok(names.has(`protocols/${protocol}-PROTOCOL.zh-CN.md`));
assert.ok(names.has('protocols/CHART-VERSION-CONTROL.zh-CN.md'));
assert.ok(names.has('protocols/AUDIO-SEPARATION.zh-CN.md'));
assert.ok(names.has('protocols/ANIMATION-CURVES-PROTOCOL.zh-CN.md'));
assert.ok(names.has('protocols/VIDEO-RENDER.zh-CN.md'));
assert.ok(names.has('schemas/animation-curve-v1.schema.json'));
assert.ok(names.has('schemas/video-render-settings-v1.schema.json'));
assert.ok(names.has('schemas/shader-library-v1.schema.json'));
assert.ok(names.has('schemas/trajectory-v1.schema.json'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const pitchManifest = JSON.parse(await readFile(new URL('assets/vendor/basic-pitch/UPSTREAM.json', root), 'utf8'));
for (const [name, entry] of Object.entries(pitchManifest.files)) {
  assert.ok(!name.includes('\\'), 'vendor manifest paths must work on every platform');
  const path = 'assets/vendor/basic-pitch/' + name; assert.ok(names.has(path), path);
  assert.equal(hash(await readFile(new URL(path, root))), entry.sha256, path);
}
const videoManifest = JSON.parse(await readFile(new URL('assets/vendor/mediabunny/UPSTREAM.json', root), 'utf8'));
assert.equal(hash(await readFile(new URL('assets/vendor/mediabunny/mediabunny.min.mjs', root))), videoManifest.bundleSHA256);
const sourceBundle = JSON.parse(await readFile(new URL('assets/agent-source.json', root), 'utf8'));
const sourceIndex = new AgentSourceIndex(sourceBundle);
for (const file of sourceBundle.files) if (names.has(file.path)) assert.equal(file.text, await readFile(new URL(file.path, root), 'utf8'), 'source snapshot: ' + file.path);
assert.ok((await sourceIndex.query({ action: 'search', query: 'trajectoryChart', path: 'src/application/' })).total > 0);
assert.ok(!sourceBundle.files.some(file => file.path.startsWith('.local-tools/') || file.path.endsWith('DESKTOP-STORAGE.zh-CN.md') || file.path.endsWith('OFFICIAL-IMPORT.zh-CN.md')));
const mods=JSON.parse(await readFile(new URL('assets/mods/index.json',root),'utf8'));
assert.deepEqual(mods.map(mod=>mod.directory),['sky-dodge','pixel-miner','spatial-camera','rpen-mod-market','rpe-classic-layout']);
for (const name of names) assert.match(name, /^(?:index\.html|styles\.css|LICENSE|NOTICE|protocols\/(?:(?:EDITOR-SKIN|MOD|GLOBAL-EVENTS|AI-AGENT|ANIMATION-CURVES)-PROTOCOL|CHART-VERSION-CONTROL|AUDIO-SEPARATION|VIDEO-RENDER)\.zh-CN\.md|schemas\/(?:mod-(?:v1\.schema\.json|api-v1\.d\.ts)|editor-skin-(?:v1\.schema|components\.v1)\.json|animation-curve-v1\.schema\.json|video-render-settings-v1\.schema\.json|(?:shader-library|trajectory)-v1\.schema\.json)|\.nojekyll|assets\/.+|src\/(?:core|application|platform|ui|locales)\/.+|src\/i18n\.mjs)$/);
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
