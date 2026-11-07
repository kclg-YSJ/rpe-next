import test from 'node:test';
import assert from 'node:assert/strict';
import { BuiltinSkinLayout } from '../src/ui/builtin-skin-layout.mjs';

function fixture(context,{skin='default',safe=false}={}){
  const previous=globalThis.document;globalThis.document=new EventTarget();context.after(()=>{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;});
  const previousStorage=globalThis.localStorage,storage=new Map();globalThis.localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};context.after(()=>{if(previousStorage===undefined)delete globalThis.localStorage;else globalThis.localStorage=previousStorage;});
  const loaded=new Map(),calls=[];
  const skins={current:skin,ready:Promise.resolve(),records:new Map([['rpe-classic',{builtin:true,skin:{skinVersion:'0.2.5'}}]]),async use(id){this.current=id;document.dispatchEvent(new Event('rpen-editor-skin-changed'));}};
  const manager={ready:Promise.resolve(),safe,editor:{editorSkins:skins},errors:new Map(),records:new Map([['rpe-classic-layout',{builtin:true,manifest:{version:'0.2.5'}}]]),notify:message=>calls.push(message),runtime:{loaded,async unload(id){calls.push('unload');loaded.delete(id);}},async enable(id,persist,chain,transient){calls.push({id,persist,transient});loaded.set(id,{});}};
  manager.skinLayout=new BuiltinSkinLayout(manager);manager.skinLayout.start();
  return{manager,skins,calls,layout:manager.skinLayout,storage};
}

test('配套布局随皮肤自动启停，不修改普通模组启用列表，手动停用持续有效',async context=>{
  const {manager,skins,calls,layout}=fixture(context);await layout.ready;assert.equal(calls.length,0);
  await skins.use('rpe-classic');await layout.pending;assert.equal(manager.runtime.loaded.size,1);assert.equal(calls[0].transient,true);
  await skins.use('inkline');await layout.pending;assert.equal(manager.runtime.loaded.size,0);
  await skins.use('rpe-classic');await layout.pending;layout.disabled();await layout.schedule();assert.equal(manager.runtime.loaded.size,0);
  await layout.schedule();assert.equal(manager.runtime.loaded.size,0);
  await layout.prepare('rpe-classic-layout');await layout.schedule();assert.equal(manager.runtime.loaded.size,1);
});

test('手动停用在重开后保持，显式启用可恢复',async context=>{
  const {manager,layout,storage}=fixture(context,{skin:'rpe-classic'});await layout.ready;layout.disabled();await layout.schedule();
  assert.equal(storage.get('rpe-next-classic-layout-disabled-v1'),'true');
  const reopened=new BuiltinSkinLayout(manager);reopened.start();await reopened.ready;assert.equal(manager.runtime.loaded.size,0);
  await reopened.prepare('rpe-classic-layout');await reopened.schedule();assert.equal(manager.runtime.loaded.size,1);assert.equal(storage.size,0);
});

test('安全模式不自动执行，版本不一致有提示，加载期间换肤会卸载过期布局',async context=>{
  const {manager,skins,layout,calls}=fixture(context,{skin:'rpe-classic',safe:true});await layout.ready;assert.equal(manager.runtime.loaded.size,0);
  await layout.prepare('rpe-classic-layout');await layout.schedule();assert.equal(manager.runtime.loaded.size,1);
  await skins.use('inkline');await layout.pending;skins.records.get('rpe-classic').skin.skinVersion='bad';
  await skins.use('rpe-classic');await layout.pending;assert.equal(manager.runtime.loaded.size,0);assert.ok(manager.errors.has('rpe-classic-layout'));
  const notices=calls.filter(value=>typeof value==='string'&&value!=='unload').length;await layout.schedule();assert.equal(calls.filter(value=>typeof value==='string'&&value!=='unload').length,notices);
  skins.records.get('rpe-classic').skin.skinVersion='0.2.5';
  manager.enable=async id=>{await skins.use('default');manager.runtime.loaded.set(id,{});};await layout.schedule();assert.equal(manager.runtime.loaded.size,0);
});
