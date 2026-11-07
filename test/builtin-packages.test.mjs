import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { builtinEditorSkins, exportEditorSkin } from '../src/platform/editor-skins.mjs';
import { builtinMods } from '../src/platform/mods.mjs';
import { builtinPackageFiles, loadBuiltinPackage } from '../src/platform/builtin-packages.mjs';
import { readZip } from '../src/platform/archive.mjs';
import { parseEditorSkin } from '../src/core/editor-skin.mjs';

test('经典皮肤和布局按需读取，共享资源不重复读取，导出仍是完整标准包', async context => {
  const requests=[];
  context.mock.method(globalThis,'fetch',async url=>{requests.push(url);return new Response(await readFile(new URL(url)));});
  const skins=await builtinEditorSkins(),mods=await builtinMods();
  const skin=skins.find(record=>record.skin.id==='rpe-classic'),mod=mods.find(record=>record.manifest.id==='rpe-classic-layout');
  assert.equal(skin.deferred,true);assert.equal(mod.deferred,true);
  assert.equal(requests.some(url=>url.includes('/rpe-classic/skin.json')||url.includes('/rpe-classic-layout/')),false);
  const before=requests.length;
  const [a,b]=await Promise.all([loadBuiltinPackage(skin),loadBuiltinPackage(skin)]);
  assert.equal(a,b);assert.equal(skin.deferred,false);
  assert.ok(requests.length>before);
  assert.equal(requests.filter(url=>url.endsWith('/inkline/fonts/ui.woff')).length,1);
  assert.equal(skin.files.get('fonts/ui.woff'),skins[0].files.get('fonts/ui.woff'));
  const portable=await readZip(await exportEditorSkin(skin).arrayBuffer());
  assert.equal(parseEditorSkin(portable).skin.id,'rpe-classic');
  assert.ok(portable.get('fonts/ui.woff').length>2e6);assert.ok(portable.has('LICENSE-OFL.txt'));
  await loadBuiltinPackage(mod);assert.equal(mod.deferred,false);assert.ok(mod.files.has('README.md'));
});

test('内置资源共享拒绝越界和重复目标，失败后允许重试',async context=>{
  let calls=0;
  context.mock.method(globalThis,'fetch',async()=>new Response(++calls===1?'missing':'ok',{status:calls===1?404:200}));
  const cache=new Map(),entry={directory:'example',files:['a.txt']};
  await assert.rejects(builtinPackageFiles('mods',entry,cache));
  assert.equal(new TextDecoder().decode((await builtinPackageFiles('mods',entry,cache)).get('a.txt')),'ok');
  for(const shared of [{'a.txt':'x.txt'},{'../x':'x'},{x:'../x'},{x:'https://example.com/a'}])await assert.rejects(builtinPackageFiles('mods',{...entry,shared},cache));
});
