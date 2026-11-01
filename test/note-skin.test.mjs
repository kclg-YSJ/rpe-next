import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNoteSkin, parseNoteSkinInfo, serializeNoteSkinInfo, noteSkinColor, noteSkinFrame, holdSkinLayout, NOTE_SKIN_DEFAULTS } from '../src/core/note-skin.mjs';
import { importNoteSkin, exportNoteSkin, updateNoteSkin, decodeNoteSkinSounds } from '../src/platform/note-skins.mjs';
import { writeZip, readZip } from '../src/platform/archive.mjs';
import { ResourceNoteSkin } from '../src/ui/resource-note-skin.mjs';
import { NoteSkins } from '../src/ui/note-skins.mjs';
import { RpeSkin } from '../src/ui/skin.mjs';
import { HitSounds } from '../src/platform/hitsounds.mjs';
import { createChart, createNote } from '../src/core/chart.mjs';
import { TempoMap } from '../src/core/tempo.mjs';
import { noteSkinFixture, encodeSkin, pngHeader } from './fixtures/note-skin.mjs';

test('音符包按 YAML 规范读取必需贴图、默认参数、十六进制颜色及多行说明',()=>{
  const record=parseNoteSkin(noteSkinFixture('description: |\n  line one\n  中文 😀\ncolorPerfect: 0xff123456\n'));
  assert.equal(record.info.description,'line one\n中文 😀\n');assert.equal(record.info.colorPerfect,0xff123456);assert.equal(record.sounds.size,0);
  for(const [key,value] of Object.entries(NOTE_SKIN_DEFAULTS))if(key!=='description'&&key!=='colorPerfect')assert.deepEqual(record.info[key],value);
  assert.deepEqual(parseNoteSkinInfo(serializeNoteSkinInfo(record.info)),record.info);
  assert.deepEqual(noteSkinColor(0x80123456),{rgb:[18,52,86],alpha:128/255});assert.deepEqual(noteSkinColor(0x123456),{rgb:[18,52,86],alpha:1});
});

test('皮肤包支持单层包装目录、大小写文件名与 ZIP/目录往返，内容身份不受文件顺序影响',async()=>{
  const files=noteSkinFixture();files.set('click.ogg',new Uint8Array([1,2,3]));files.set('ending.ogg',new Uint8Array([4,5]));
  const archive=writeZip(new Map([...files].map(([name,bytes])=>['Example/'+name.toUpperCase(),bytes])));
  const record=await importNoteSkin([new File([archive],'example.zip')]);assert.equal(record.sounds.size,1);assert.equal(record.warnings.length,1);
  const reversed=await importNoteSkin([new File([writeZip(new Map([...files].reverse()))],'reverse.zip')]);assert.equal(record.id,reversed.id);
  const directory=await importNoteSkin([...files].map(([name,bytes])=>({name,webkitRelativePath:'Folder/'+name,size:bytes.length,arrayBuffer:async()=>bytes.buffer})),true);
  assert.equal(record.id,directory.id);assert.deepEqual(await readZip(await exportNoteSkin(record).arrayBuffer()),files);
  const edited=updateNoteSkin(record,{...record.info,hitFxScale:1.8,holdRepeat:true});assert.equal(edited.id,record.id);assert.equal(edited.originalFiles,record.files);
  assert.equal(parseNoteSkin(edited.files).info.hitFxScale,1.8);assert.deepEqual(edited.files.get('click.ogg'),files.get('click.ogg'));
});

test('拒绝错误 YAML、缺图、越界图集、危险路径、异常尺寸及非法参数，不执行 YAML 自定义标签',()=>{
  for(const yaml of ['name: [','name: A\nname: B','!!js/function function(){}','[1, 2]'])assert.throws(()=>parseNoteSkinInfo(yaml));
  for(const suffix of ['hitFxScale: -1','holdRepeat: yes','colorPerfect: 0x100000000','holdAtlas: [200, 200]','hitFx: [0, 5]','hitFx: [100, 200]'])assert.throws(()=>parseNoteSkin(noteSkinFixture(suffix)));
  const missing=noteSkinFixture();missing.delete('drag_mh.png');assert.throws(()=>parseNoteSkin(missing),/drag_mh/);
  const broken=noteSkinFixture();broken.set('click.png',encodeSkin('<svg/>'));assert.throws(()=>parseNoteSkin(broken),/PNG/);
  for(const path of ['../escape','C:/user','a\\b','/root'])assert.throws(()=>parseNoteSkin(new Map([...noteSkinFixture(),[path,new Uint8Array()]])),/路径/);
  const huge=noteSkinFixture();huge.set('click.png',pngHeader(20000,20000));assert.throws(()=>parseNoteSkin(huge),/尺寸/);
  const duplicate=noteSkinFixture();duplicate.set('CLICK.PNG',duplicate.get('click.png'));assert.throws(()=>parseNoteSkin(duplicate),/重复/);
  const recursive=parseNoteSkin(noteSkinFixture('ignored: &a [*a]\n'));assert.ok(!Object.hasOwn(recursive.info,'ignored'));
});

test('打击图集逐行选帧且时长严格遵循包配置，Hold 图集首尾与紧凑锚点可独立设置',()=>{
  const info=parseNoteSkin(noteSkinFixture('hitFxDuration: 0.8')).info;
  assert.equal(noteSkinFrame(info,-1),null);assert.deepEqual(noteSkinFrame(info,0.25),{index:5,column:1,row:1});assert.equal(noteSkinFrame(info,0.8),null);
  const standard=holdSkinLayout(info,{width:160,height:300},false,100,-100,80);assert.equal(standard.headHeight,9);assert.equal(standard.tailHeight,6);assert.equal(standard.headY,0);assert.equal(standard.tailY,-206);
  const compact=holdSkinLayout({...info,holdCompact:true},{width:160,height:300},true,100,300,80);assert.equal(compact.direction,-1);assert.equal(compact.headY,-5.5);assert.equal(compact.tailY,-204);assert.equal(compact.bodyPixels,262);
  for(const direction of [1,-1]) {
    assert.equal(holdSkinLayout(info,{width:160,height:300},false,0,0,80,80,direction).direction,direction);
    assert.equal(holdSkinLayout(info,{width:160,height:300},false,100,-100,80,80,direction).direction,1);
    assert.equal(holdSkinLayout(info,{width:160,height:300},false,100,300,80,80,direction).direction,-1);
  }
});

function drawContext(){const calls=[];return new Proxy({calls,globalAlpha:1},{get(target,key){return target[key]??((...args)=>calls.push([key,...args]));}});}
test('Phira Hold 从同一图片分别裁切尾、身体、头；keepHead、compact、普通与高亮图集生效',()=>{
  const record=parseNoteSkin(noteSkinFixture());const image={naturalWidth:160,naturalHeight:300};const runtime=new ResourceNoteSkin(record,new Map([['hold.png',image],['hold_mh.png',image]]),(name,source)=>source);
  let context=drawContext();runtime.hold(context,50,200,20,80,false,false);let images=context.calls.filter(call=>call[0]==='drawImage');assert.equal(images.length,2);assert.deepEqual(images[0].slice(2,6),[0,12,160,270]);
  runtime.info={...runtime.info,holdKeepHead:true,holdCompact:true};context=drawContext();runtime.hold(context,50,200,20,80,true,false);images=context.calls.filter(call=>call[0]==='drawImage');assert.equal(images.length,3);assert.equal(images[2][7],-5.5);assert.equal(images[1][7],-184);
  const skin=new RpeSkin(()=>{});skin.setResourcePack(runtime);assert.equal(skin.hitLifetime,0.5);assert.equal(skin.hold(drawContext(),0,100,0,50),true);skin.setResourcePack(null);assert.equal(runtime.images.size,0);
});

test('导入皮肤的零长度 Hold 头尾不互相遮挡，keepHead 不使判定后的零长度长条保留头',()=>{
  const record=parseNoteSkin(noteSkinFixture()), image={naturalWidth:160,naturalHeight:300};
  const runtime=new ResourceNoteSkin(record,new Map([['hold.png',image],['hold_mh.png',image]]),(_,source)=>source);
  const skin=new RpeSkin(()=>{});skin.setResourcePack(runtime);
  for(const holdCompact of [false,true])for(const holdKeepHead of [false,true])for(const highlight of [false,true])for(const showHead of [false,true])for(const direction of [1,-1]) {
    runtime.info={...record.info,holdCompact,holdKeepHead};const context=drawContext();skin.hold(context,50,200,200,80,highlight,showHead,undefined,80,direction);
    assert.deepEqual(context.calls.find(call=>call[0]==='scale'),['scale',1,direction]);
    const images=context.calls.filter(call=>call[0]==='drawImage'),[tailPixels,headPixels]=runtime.info[highlight?'holdAtlasMH':'holdAtlas'];
    assert.equal(images.length,showHead?2:1);assert.deepEqual(images[0].slice(2,6),[0,0,160,tailPixels]);
    assert.equal(images[0][7]+images[0][9],0);
    if(showHead){assert.deepEqual(images[1].slice(2,6),[0,300-headPixels,160,headPixels]);assert.equal(images[1][7],0);}
  }
});

test('图集参数变化会清除帧和重复身体缓存，时长或颜色修改不影响已有图像缓存',()=>{
  const record=parseNoteSkin(noteSkinFixture());const runtime=new ResourceNoteSkin(record,new Map(),(name,source)=>source);
  runtime.crops.set('frame',{});runtime.setInfo({...runtime.info,hitFxDuration:0.8});assert.equal(runtime.crops.size,1);
  runtime.setInfo({...runtime.info,hitFx:[2,8]});assert.equal(runtime.crops.size,0);
  runtime.crops.set('body',{});runtime.setInfo({...runtime.info,holdAtlas:[20,24]});assert.equal(runtime.crops.size,0);
  runtime.crops.set('body-mh',{});runtime.setInfo({...runtime.info,holdAtlasMH:[30,40]});assert.equal(runtime.crops.size,0);
});

function withFrameCanvases(run) {
  const previous=globalThis.document,canvases=[];
  globalThis.document={createElement(name){assert.equal(name,'canvas');const context=drawContext(),canvas={width:0,height:0,getContext:()=>context};canvases.push(canvas);return canvas;}};
  try {run(canvases);} finally {if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
}

test('70 帧打击动画跨预览和循环复用完整缓存，不重复裁切染色或占用共享音符缓存',()=>withFrameCanvases(canvases=>{
  const record=parseNoteSkin(noteSkinFixture('hitFxDuration: 0.65\nhideParticles: true'));record.info.hitFx=[7,10];
  const runtime=new ResourceNoteSkin(record,new Map([['hit_fx.png',{naturalWidth:2509,naturalHeight:3585}]]),()=>assert.fail('打击动画不应生成共享临时染色源'));
  const contexts=[drawContext(),drawContext()],draw=(index,color)=>runtime.drawHit(contexts[index%2],{age:(index+.5)/70*.65,x:0,y:0,size:100,color});
  for(let pass=0;pass<4;pass++)for(let index=0;index<70;index++)draw(index);
  assert.equal(canvases.length,70);assert.equal(runtime.hitFrames.size,70);assert.equal(runtime.hitFrameBytes,70*359*359*4);
  assert.equal(runtime.crops.size,0);
  draw(4,[100.1,200.2,255]);draw(4,[100.2,200.1,255]);assert.equal(canvases.length,71,'相同渲染颜色应复用同一帧');
  runtime.setInfo({...runtime.info,hitFxDuration:1,holdAtlas:[14,18]});assert.equal(runtime.hitFrames.size,71);
  runtime.setInfo({...runtime.info,hitFx:[5,14]});assert.equal(runtime.hitFrames.size,0);assert.equal(runtime.hitFrameBytes,0);
  runtime.drawHit(contexts[0],{age:.1,x:0,y:0,size:100});runtime.dispose();assert.equal(runtime.hitFrames.size,0);assert.equal(runtime.hitFrameBytes,0);
}));

test('打击帧按像素预算限制缓存，最近使用的帧在淘汰时保留',()=>withFrameCanvases(canvases=>{
  const record=parseNoteSkin(noteSkinFixture('hitFxDuration: 1\nhideParticles: true'));record.info.hitFx=[7,10];
  const runtime=new ResourceNoteSkin(record,new Map([['hit_fx.png',{naturalWidth:512*7,naturalHeight:512*10}]]),()=>assert.fail());
  const context=drawContext(),draw=index=>runtime.drawHit(context,{age:(index+.5)/70,x:0,y:0,size:100});
  for(let index=0;index<64;index++)draw(index);
  draw(0);draw(64);
  const allocated=canvases.length;draw(0);assert.equal(canvases.length,allocated);draw(1);assert.equal(canvases.length,allocated+1);
  assert.equal(runtime.hitFrames.size,64);assert.equal(runtime.hitFrameBytes,64*1024*1024);
}));

test('可选皮肤音效解码失败明确报错，切换保留谱面自定义音效且跨谱面仍使用选中的皮肤',async()=>{
  const record=parseNoteSkin(new Map([...noteSkinFixture(),['click.ogg',new Uint8Array([1,2,3])]]));
  const decoded={duration:0.08};const buffers=await decodeNoteSkinSounds(record,{decodeAudioData:async()=>decoded});assert.equal(buffers.get('tap'),decoded);
  await assert.rejects(decodeNoteSkinSounds(record,{decodeAudioData:async()=>{throw Error('invalid');}}),/tap.*invalid/);
  const sounds=new HitSounds({});const custom={};sounds.buffers.set('custom.ogg',custom);sounds.setSoundPack(buffers);assert.equal(sounds.buffers.get('custom.ogg'),custom);
  sounds.setProject({judgeLineList:[]},new Map(),'chart.json');assert.equal(sounds.skinBuffers.get('tap'),decoded);sounds.setSoundPack();assert.equal(sounds.skinBuffers.size,0);
});

test('播放调度同时使用皮肤音效、缺省回退和谱面自定义音效，恢复默认后取消旧声源',()=>{
  const chart=createChart();chart.judgeLineList[0].notes=[createNote(1,2,0),createNote(4,2,0),{...createNote(3,2,0),hitsound:'custom.ogg'}];
  const sources=[];const transport={playing:true,time:0.95,rate:1,playRevision:1,context:{currentTime:10,createBufferSource(){const source={connect(){},disconnect(){},start(){sources.push(this);},stop(){this.stopped=true;}};return source;}}};
  const sounds=new HitSounds(transport);sounds.gain={};const tap={id:'default-tap'},drag={id:'default-drag'},custom={id:'custom'},packTap={id:'pack-tap'};
  for(const [name,buffer] of [['tap',tap],['drag',drag],['custom.ogg',custom]])sounds.buffers.set(name,buffer);
  sounds.setSoundPack(new Map([['tap',packTap]]));sounds.tick(chart,new TempoMap(chart.BPMList));assert.deepEqual(sources.map(source=>source.buffer),[packTap,drag,custom]);
  sounds.setSoundPack();assert.ok(sources.every(source=>source.stopped));sounds.tick(chart,sounds.tempo);assert.deepEqual(sources.slice(3).map(source=>source.buffer),[tap,drag,custom]);
});

test('皮肤预览在宽、窄、高画布和不同像素密度下保持音符头尾与方形特效的原始宽高比',()=>{
  const previous=globalThis.devicePixelRatio;
  try {
    for(const ratio of [1,1.5,2])for(const [width,height]of [[1000,248],[420,248],[280,350],[680,100]]){
      globalThis.devicePixelRatio=ratio;const drawings=[];const stack=[];let transform={x:1,y:1};
      const context=new Proxy({globalAlpha:1,
        setTransform(x,b,c,y){transform={x,y};},save(){stack.push({...transform});},restore(){transform=stack.pop();},
        scale(x,y){transform={x:transform.x*x,y:transform.y*y};},
        drawImage(image,...args){const target=args.slice(-4);drawings.push({image,width:Math.abs(target[2]*transform.x),height:Math.abs(target[3]*transform.y)});},
      },{get(target,key){return target[key]??(()=>{});}});
      const manager=Object.create(NoteSkins.prototype);manager.canvas={clientWidth:width,clientHeight:height,width:0,height:0,getContext:()=>context};
      const skin=new RpeSkin(()=>{});skin.tinted=name=>skin.images.get(name);manager.previewSkin=skin;
      for(const name of ['Tap2','Tap2HL','Drag2','DragHL','Flick2','Flick2HL','HoldHead','HoldHeadHL','HoldEnd','img-7'])skin.images.set(name,{name,naturalWidth:100,naturalHeight:name.startsWith('img-')?100:name.startsWith('Drag')?3:25});
      skin.images.set('Hold3',{name:'body',naturalWidth:100,naturalHeight:10});
      manager.drawDemo(0.1);
      const spriteDrawings=drawings.filter(entry=>entry.image.name!=='body');assert.ok(spriteDrawings.some(entry=>entry.image.name==='img-7'));
      for(const entry of spriteDrawings)assert.ok(Math.abs(entry.width/entry.height-entry.image.naturalWidth/entry.image.naturalHeight)<1e-10,`${entry.image.name} distorted at ${width}x${height}, DPR ${ratio}`);
      assert.equal(manager.canvas.width,Math.round(width*ratio));assert.equal(manager.canvas.height,Math.round(height*ratio));
    }
  } finally {if(previous===undefined)delete globalThis.devicePixelRatio;else globalThis.devicePixelRatio=previous;}
});
