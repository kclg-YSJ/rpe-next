import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse as parseJavaScript } from '../src/core/vendor/acorn.mjs';
import { parseModPackage,rewriteModModule,resolveModImport,modManifest,modSettingValue } from '../src/core/mod-package.mjs';
import { registerModHook,emitModHook } from '../src/core/mod-hooks.mjs';
import { ModScope,ModRuntime } from '../src/ui/mod-runtime.mjs';
import { ModManager } from '../src/ui/mod-manager.mjs';
import { importMod,exportMod } from '../src/platform/mods.mjs';
import { writeZip,readZip } from '../src/platform/archive.mjs';
import { createChart,createEvent,serializeChart,assertChart } from '../src/core/chart.mjs';
import { parseDocument } from '../src/core/formats.mjs';
import { EditorSession } from '../src/application/session.mjs';
import { noteObstacles,noiseObstacles,hitObstacles,sweepPoints } from '../assets/mods/sky-dodge/collision.mjs';
import { createRun,damage,collect,resultStats } from '../assets/mods/sky-dodge/model.mjs';
import {createInventory,reserveItem,takeItem,experienceLevel,dropPose,advanceExperienceOrb} from '../assets/mods/pixel-miner/model.mjs';
import {createSounds} from '../assets/mods/pixel-miner/sound.mjs';
const encode=value=>new TextEncoder().encode(typeof value==='string'?value:JSON.stringify(value));
const manifest=()=>({protocol:'rpen-mod',api:1,id:'example',name:'Example',version:'1.0.0',author:'Test',description:'Test package',entry:'main.mjs'});
const fixture=()=>new Map([['mod.json',encode(manifest())],['main.mjs',encode('export function activate(api) { return () => {}; }')]]);
test('模组包按清单与 ES 模块语法校验，ZIP 与文件夹可导入导出而不执行代码',async()=>{
  const files=fixture();files.set('extra.txt',encode('asset'));const archive=writeZip(new Map([...files].map(([name,data])=>['Example/'+name,data])));
  const record=await importMod([new File([archive],'test.rpenmod')]);assert.equal(record.manifest.id,'example');assert.deepEqual(await readZip(await exportMod(record).arrayBuffer()),files);
  const directory=await importMod([...files].map(([name,data])=>({name,webkitRelativePath:'Folder/'+name,size:data.length,arrayBuffer:async()=>data.buffer})),true);assert.deepEqual(directory.files,files);
  for(const mutation of [source=>source.set('../a',encode('x')),source=>source.delete('main.mjs'),source=>source.set('main.mjs',encode('export {')),source=>source.set('mod.json',encode({...manifest(),id:'Bad ID'})),source=>source.set('mod.json',encode({...manifest(),api:999}))]){const source=fixture();mutation(source);assert.throws(()=>parseModPackage(source));}
});
test('模块改写使用语法树，保留注释字符串模板，支持循环、多文件、动态导入和核心模块',()=>{
  const files=new Map([['main.mjs',encode('')],['sub/a.mjs',encode('')],['sub/b.mjs',encode('')],['data.json',encode('{}')]]);const base='https://example.com/rpe-next/';const prefix='@rpen-mod/test/';
  const resolve=(value,from)=>resolveModImport(value,from,files,prefix,base);
  const source=`// import './fake.mjs'\nconst message="import('./fake.mjs')";\nimport {a} from './a.mjs';export {b} from './b.mjs';\nconst file='./b.mjs';export const lazy=()=>import(file);const direct=import('../data.json');const url=import.meta.resolve('./a.mjs');`;
  const transformed=rewriteModModule(source,'sub/a.mjs',resolve,'test-load');parseJavaScript(transformed,{ecmaVersion:'latest',sourceType:'module'});
  assert.ok(transformed.includes("// import './fake.mjs'"));assert.ok(transformed.includes('const message="import(\'./fake.mjs\')"'));assert.ok(transformed.includes('"@rpen-mod/test/sub/b.mjs"'));assert.ok(transformed.includes('resolveModule("test-load",(file),"sub/a.mjs")'));assert.ok(transformed.includes('@rpen-mod/test/data.json'));
  assert.equal(resolve('@rpen/core/chart.mjs','main.mjs'),base+'src/core/chart.mjs');assert.equal(resolve('@rpen/api','main.mjs'),base+'src/ui/mod-api.mjs');assert.throws(()=>resolve('../../x.mjs','main.mjs'));assert.throws(()=>resolve('missing-library','main.mjs'));assert.throws(()=>resolve('./missing.mjs','main.mjs'));
});
test('设置声明校验及默认值约束，快捷键参数可清除且拒绝无效格式',()=>{
  const value={...manifest(),settings:{key:{type:'shortcut',label:'Toggle',default:'F8'},amount:{type:'number',label:'N',default:3,min:1,max:5}}};assert.equal(modManifest(value).settings.key.default,'F8');assert.equal(modSettingValue(value.settings.key,''),'');assert.throws(()=>modSettingValue(value.settings.key,'CTRL&'));assert.throws(()=>modSettingValue(value.settings.amount,6));assert.throws(()=>modManifest({...value,dependencies:['example']}));
});
test('作用域清理逆序执行、提前释放和重复卸载幂等，补丁堆栈不破坏其他模组',()=>{
  const order=[];const scope=new ModScope(error=>{throw error;});scope.defer(()=>order.push(1));const early=scope.defer(()=>order.push(2));early();scope.defer(()=>order.push(3));scope.dispose();early();scope.dispose();assert.deepEqual(order,[2,3,1]);assert.equal(scope.controller.signal.aborted,true);
  const runtime=new ModRuntime({editor:{},notify(){},invalidate(){},changed(){}});const target={value(x){return x+1;}};const original=target.value;const a=new ModScope(),b=new ModScope();runtime.patch(a,target,'value',previous=>function(x){return previous.call(this,x)*2;});runtime.patch(b,target,'value',previous=>function(x){return previous.call(this,x)+4;});assert.equal(target.value(2),10);a.dispose();assert.equal(target.value(2),7);b.dispose();assert.equal(target.value,original);
  let invoked=0;const callback=scope.wrap(()=>invoked++);callback();assert.equal(invoked,0);
});

test('嵌套与多个模组的编辑锁按引用计数恢复，保留原 inert 状态',()=>{
  const previous=globalThis.document;const root={inert:false,matches:()=>false,querySelector:()=>null};const originallyInert={inert:true,matches:()=>false,querySelector:()=>null};
  globalThis.document={querySelectorAll:()=>[root,originallyInert],documentElement:{dataset:{}}};
  try{const runtime=new ModRuntime({editor:{},notify(){},invalidate(){},changed(){}});const a=runtime.lock('a',{roots:['root']}),nested=runtime.lock('a',{roots:['root']}),b=runtime.lock('b',{roots:['root']});a();a();assert.equal(root.inert,true);nested();assert.equal(runtime.locks.has('a'),false);assert.equal(root.inert,true);b();assert.equal(root.inert,false);assert.equal(originallyInert.inert,true);assert.equal(runtime.locks.size,0);assert.equal(document.documentElement.dataset.modEditingLocked,undefined);}finally{globalThis.document=previous;}
});

test('依赖装载后重新检查双向冲突，传递依赖不会绕过主模组声明',async()=>{
  const previous=globalThis.localStorage;globalThis.localStorage={setItem(){},removeItem(){}};
  try{const records=new Map();for(const [id,dependencies,conflicts]of [['a',['b'],['c']],['b',['c'],[]],['c',[],[]]])records.set(id,{manifest:{id,dependencies,conflicts}});const loaded=new Map();const manager={records,runtime:{loaded,load:async record=>{const state={id:record.manifest.id,record,status:'loaded'};loaded.set(state.id,state);return state;}},settingsFor:()=>({}),errors:new Map(),desired:new Set(),persist(){},updateStatus(){}};manager.enable=ModManager.prototype.enable.bind(manager);await assert.rejects(manager.enable('a'),/冲突：c/);assert.equal(loaded.has('a'),false);assert.equal(loaded.has('b'),true);assert.equal(loaded.has('c'),true);}finally{globalThis.localStorage=previous;}
});
test('谱面语义钩子可改写提交、绕过透明度整形、取消提交并替换导入导出和验证',()=>{
  const session=new EditorSession();const calls=[];const before=registerModHook('session:before-commit',payload=>{payload.normalizeAlpha=false;payload.chart={...payload.chart,extension:{custom:true}};});const after=registerModHook('session:after-commit',payload=>calls.push(payload.label));
  try{const chart=createChart();chart.judgeLineList[0].eventLayers[0].alphaEvents=[createEvent(3.5,6.25,0,1)];session.commit('Mod edit',chart);assert.equal(session.chart.judgeLineList[0].eventLayers[0].alphaEvents[0].start,3.5);assert.equal(session.chart.extension.custom,true);assert.deepEqual(calls,['Mod edit']);}finally{before();after();}
  const original=session.chart;const cancel=registerModHook('session:before-commit',payload=>{payload.cancel=true;});try{session.commit('blocked',createChart());assert.equal(session.chart,original);}finally{cancel();}
  const parse=registerModHook('chart:parse',payload=>{payload.chart={custom:'format'};});try{assert.deepEqual(parseDocument('CUSTOM'),{custom:'format'});}finally{parse();}
  const serialize=registerModHook('chart:serialize',payload=>{payload.text='MOD FORMAT';});try{assert.equal(serializeChart({custom:true}),'MOD FORMAT');}finally{serialize();}
  const validate=registerModHook('chart:validate',payload=>{payload.handled=true;});try{assert.doesNotThrow(()=>assertChart({custom:true}));}finally{validate();}
});
test('噪域碰撞仅包含激活状态，反转分别在每一层合成，洞与重复反转不误判',()=>{
  const points=[{x:-50,y:-50},{x:50,y:-50},{x:50,y:50},{x:-50,y:50}];const entry=(state,invert=false,layer='default')=>({state,area:{isInvert:invert,layerId:layer},points});
  assert.equal(hitObstacles({x:100,y:100},5,[],noiseObstacles([entry('disabled'),entry('ready')],200,200,1)),false);
  assert.equal(hitObstacles({x:100,y:100},5,[],noiseObstacles([entry('active')],200,200,1)),true);
  assert.equal(hitObstacles({x:100,y:100},5,[],noiseObstacles([entry('active'),entry('active',true)],200,200,1)),false);
  assert.equal(hitObstacles({x:100,y:100},5,[],noiseObstacles([entry('active',true),entry('active',true)],200,200,1)),false);
  assert.equal(hitObstacles({x:100,y:100},5,[],noiseObstacles([entry('active',true),entry('active',true,'other')],200,200,1)),true);
  assert.equal(hitObstacles({x:48,y:100},4,[],noiseObstacles([entry('active')],200,200,1)),true);
});
test('音符四边形及 Hold 身体碰撞支持旋转，移动扫描避免快速鼠标穿过物件',()=>{
  const notes=noteObstacles([{type:2,x1:50,y1:50,x2:150,y2:150,collisionWidth:20,rotation:Math.PI/4},{polygon:[{x:10,y:10},{x:40,y:10},{x:40,y:20},{x:10,y:20}]}]);assert.equal(hitObstacles({x:100,y:100},5,notes,[]),true);assert.equal(hitObstacles({x:110,y:90},2,notes,[]),false);assert.equal(hitObstacles({x:25,y:24},5,notes,[]),true);
  assert.ok(sweepPoints({x:0,y:15},{x:100,y:15},5).some(point=>hitObstacles(point,5,notes,[])));
});

test('游戏音符边缘允许擦过，中心仍有碰撞；Hold 仅收窄，端点与原始预览几何保留',()=>{
  const polygon=[{x:-50,y:-10},{x:50,y:-10},{x:50,y:10},{x:-50,y:10}];const original=structuredClone(polygon);const [note]=noteObstacles([{polygon}]);
  assert.equal(hitObstacles({x:49,y:0},2,[note],[]),false);assert.equal(hitObstacles({x:0,y:0},2,[note],[]),true);assert.deepEqual(polygon,original);
  const hold=noteObstacles([{type:2,x1:0,y1:0,x2:0,y2:100,collisionWidth:20}]);assert.equal(hitObstacles({x:10,y:50},1,hold,[]),false);assert.equal(hitObstacles({x:0,y:100},1,hold,[]),true);
});
test('游戏伤害无敌、离开惩罚、星星连击、修复及结算统计',()=>{
  const run=createRun(4);assert.equal(run.hearts,5);assert.equal(damage(run,'hit',2.5),true);assert.equal(damage(run,'hit',2.5),false);assert.equal(damage(run,'exit',2.5),true);assert.equal(run.hearts,3);collect(run,'star');collect(run,'star');assert.equal(run.score,220);assert.equal(run.bestCombo,2);collect(run,'repair');assert.equal(run.hearts,4);assert.equal(run.repairs,1);assert.equal(resultStats(run,8).survival,4);run.elapsed=3;assert.equal(damage(run,'hit',2.5),true);
});

test('像素矿工首位固定镐，满栏不收取，放置后释放槽位，经验与高处掉落正常',()=>{
  const inventory=createInventory();assert.equal(takeItem(inventory),null);assert.equal(inventory.slots[0],'pickaxe');for(let i=1;i<=8;i++)assert.equal(reserveItem(inventory,'item-'+i),i);assert.equal(reserveItem(inventory,'overflow'),-1);inventory.selected=4;assert.equal(takeItem(inventory),'item-4');assert.equal(reserveItem(inventory,'overflow'),4);assert.deepEqual(experienceLevel(16),{level:2,progress:0});const pose=dropPose({x:200,y:10,drift:50,birth:0},3,800,1200);assert.equal(pose.landed,true);assert.ok(pose.y>1060&&pose.y<1080);assert.ok(pose.rotation>0);
});

test('模组提前输入钩子阻止普通快捷键，释放后恢复原入口',()=>{
  const runtime=new ModRuntime({editor:{},notify(){},invalidate(){},changed(){}});let shortcuts=0;runtime.shortcut=()=>{shortcuts++;return true;};const event={type:'keydown',preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;}};const off=registerModHook('input:before',input=>{input.handled=true;});try{runtime.handleInput(event);assert.equal(shortcuts,0);assert.equal(event.prevented,true);assert.equal(event.stopped,true);}finally{off();}runtime.handleInput(event);assert.equal(shortcuts,1);
});

test('像素矿工静音时不创建音频节点或恢复音频上下文',()=>{
  let contexts=0;const sounds=createSounds({audio:{ensureContext(){contexts++;throw Error('静音不能启动音频');}}},()=>0);for(const kind of ['chip','break','place','pickup','xp'])sounds.play(kind);sounds.dispose();assert.equal(contexts,0);
});

test('经验球先受重力落地并停留，再向鼠标吸收，不会在出生点立刻收取',()=>{
  const orb={x:100,y:50,vx:0,vy:-100,birth:0};const cursor={x:100,y:50};
  assert.equal(advanceExperienceOrb(orb,0,0.05,cursor,800,600),false);assert.equal(orb.phase,'fall');assert.equal(advanceExperienceOrb(orb,0.5,0.05,cursor,800,600),false);assert.ok(orb.y>50);
  assert.equal(advanceExperienceOrb(orb,1.2,0.05,{x:100,y:474},800,600),false);assert.equal(orb.phase,'rest');assert.equal(advanceExperienceOrb(orb,1.45,0.05,{x:100,y:474},800,600),false);
  let collected=false;for(let time=1.7;time<3;time+=0.05)if(advanceExperienceOrb(orb,time,0.05,cursor,800,600)){collected=true;break;}assert.equal(collected,true);assert.equal(orb.phase,'attract');
});
test('内置模组包清单可完整加载并通过语法检查',async()=>{
  const list=JSON.parse(await readFile(new URL('../assets/mods/index.json',import.meta.url),'utf8'));
  assert.deepEqual(list.map(item=>item.directory),['sky-dodge','pixel-miner','spatial-camera','rpen-mod-market','rpe-classic-layout']);
  for(const item of list){const files=new Map(await Promise.all(item.files.map(async path=>[path,new Uint8Array(await readFile(new URL(`../assets/mods/${item.directory}/${path}`,import.meta.url)))])));assert.equal(parseModPackage(files).manifest.id,item.directory);}
});
