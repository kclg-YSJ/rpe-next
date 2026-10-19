import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNoteSkin, parseNoteSkinInfo, serializeNoteSkinInfo, noteSkinColor, noteSkinFrame, holdSkinLayout, NOTE_SKIN_DEFAULTS } from '../src/core/note-skin.ts';
import { importNoteSkin, exportNoteSkin, updateNoteSkin, decodeNoteSkinSounds } from '../src/platform/note-skins.ts';
import { writeZip, readZip } from '../src/platform/archive.ts';
import { ResourceNoteSkin } from '../src/ui/resource-note-skin.ts';
import { NoteSkins } from '../src/ui/note-skins.ts';
import { RpeSkin } from '../src/ui/skin.ts';
import { HitSounds } from '../src/platform/hitsounds.ts';
import { createChart, createNote } from '../src/core/chart.ts';
import { TempoMap } from '../src/core/tempo.ts';
import { noteSkinFixture, encodeSkin, pngHeader } from './fixtures/note-skin.ts';
import type { Chart } from '../src/core/types.ts';
import type { NoteSkinInfo, NoteSkinRecord } from '../src/ui/resource-note-skin.ts';
type SkinImageValue = Parameters<RpeSkin['images']['set']>[1];
interface SkinPicture { name?: string; naturalWidth: number; naturalHeight: number }
interface DrawCall { [index: number]: unknown; length: number; slice(start?: number, end?: number): unknown[] }
interface DrawContext extends CanvasRenderingContext2D { calls: DrawCall[] }
interface TransformState { x: number; y: number }
interface DrawingRecord { image: SkinPicture; width: number; height: number }
interface RuntimeNoteSkin {
  info: NoteSkinInfo;
  images: Map<string, SkinPicture>;
  crops: Map<string, unknown>;
  setInfo(info: NoteSkinInfo): void;
  hold(context: CanvasRenderingContext2D, x: number, head: number, tail: number, width: number, highlight?: boolean, showHead?: boolean, color?: unknown): boolean;
}
interface FakeAudioSource { buffer?: AudioBuffer; stopped?: boolean; connect(): void; disconnect(): void; start(): void; stop(): void }
type RuntimeNoteSkinConstructor = new (record: NoteSkinRecord, images: Map<string, SkinPicture>, tintSource: (name: string, source: SkinPicture) => SkinPicture) => RuntimeNoteSkin;
const NoteSkinRuntime = ResourceNoteSkin as unknown as RuntimeNoteSkinConstructor;

test('音符包按 YAML 规范读取必需贴图、默认参数、十六进制颜色及多行说明',()=>{
  const record=parseNoteSkin(noteSkinFixture('description: |\n  line one\n  中文 😀\ncolorPerfect: 0xff123456\n'));
  assert.equal(record.info.description,'line one\n中文 😀\n');assert.equal(record.info.colorPerfect,0xff123456);assert.equal(record.sounds.size,0);
  for(const [key,value] of Object.entries(NOTE_SKIN_DEFAULTS) as [keyof typeof NOTE_SKIN_DEFAULTS, string | number | boolean][])if(key!=='description'&&key!=='colorPerfect')assert.deepEqual(record.info[key],value);
  assert.deepEqual(parseNoteSkinInfo(serializeNoteSkinInfo(record.info)),record.info);
  assert.deepEqual(noteSkinColor(0x80123456),{rgb:[18,52,86],alpha:128/255});assert.deepEqual(noteSkinColor(0x123456),{rgb:[18,52,86],alpha:1});
});

test('皮肤包支持单层包装目录、大小写文件名与 ZIP/目录往返，内容身份不受文件顺序影响',async()=>{
  const files=noteSkinFixture();files.set('click.ogg',new Uint8Array([1,2,3]));files.set('ending.ogg',new Uint8Array([4,5]));
  const archive=writeZip(new Map([...files].map(([name,bytes]): [string, Uint8Array] => ['Example/'+name.toUpperCase(),bytes])));
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
  for(const path of ['../escape','C:/user','a\\b','/root'])assert.throws(()=>parseNoteSkin(new Map<string, Uint8Array>([...noteSkinFixture(),[path,new Uint8Array()]])),/路径/);
  const huge=noteSkinFixture();huge.set('click.png',pngHeader(20000,20000));assert.throws(()=>parseNoteSkin(huge),/尺寸/);
  const duplicate=noteSkinFixture();duplicate.set('CLICK.PNG',duplicate.get('click.png')!);assert.throws(()=>parseNoteSkin(duplicate),/重复/);
  const recursive=parseNoteSkin(noteSkinFixture('ignored: &a [*a]\n'));assert.ok(!Object.hasOwn(recursive.info,'ignored'));
});

test('打击图集逐行选帧且时长严格遵循包配置，Hold 图集首尾与紧凑锚点可独立设置',()=>{
  const info=parseNoteSkin(noteSkinFixture('hitFxDuration: 0.8')).info;
  assert.equal(noteSkinFrame(info,-1),null);assert.deepEqual(noteSkinFrame(info,0.25),{index:5,column:1,row:1});assert.equal(noteSkinFrame(info,0.8),null);
  const standard=holdSkinLayout(info,{width:160,height:300},false,100,-100,80);assert.equal(standard.headHeight,9);assert.equal(standard.tailHeight,6);assert.equal(standard.headY,0);assert.equal(standard.tailY,-206);
  const compact=holdSkinLayout({...info,holdCompact:true},{width:160,height:300},true,100,300,80);assert.equal(compact.direction,-1);assert.equal(compact.headY,-5.5);assert.equal(compact.tailY,-204);assert.equal(compact.bodyPixels,262);
});

function drawContext(): DrawContext {
  const calls: DrawCall[] = [];
  return new Proxy({calls,globalAlpha:1},{get(target,key){return (target as unknown as Record<string | symbol, unknown>)[key]??((...args: unknown[])=>{calls.push([key,...args]);});}}) as unknown as DrawContext;
}
test('Phira Hold 从同一图片分别裁切尾、身体、头；keepHead、compact、普通与高亮图集生效',()=>{
  const record=parseNoteSkin(noteSkinFixture());const image={naturalWidth:160,naturalHeight:300};const runtime=new NoteSkinRuntime(record as unknown as NoteSkinRecord,new Map([['hold.png',image],['hold_mh.png',image]]),(name: string,source: SkinPicture): SkinPicture => source);
  let context=drawContext();runtime.hold(context,50,200,20,80,false,false);let images=context.calls.filter(call=>call[0]==='drawImage');assert.equal(images.length,2);assert.deepEqual(images[0].slice(2,6),[0,12,160,270]);
  runtime.info={...runtime.info,holdKeepHead:true,holdCompact:true};context=drawContext();runtime.hold(context,50,200,20,80,true,false);images=context.calls.filter(call=>call[0]==='drawImage');assert.equal(images.length,3);assert.equal(images[2][7],-5.5);assert.equal(images[1][7],-184);
  const skin=new RpeSkin(()=>{});skin.setResourcePack(runtime as unknown as Parameters<typeof skin.setResourcePack>[0]);assert.equal(skin.hitLifetime,0.5);assert.equal(skin.hold(drawContext(),0,100,0,50),true);skin.setResourcePack(null);assert.equal(runtime.images.size,0);
});

test('图集参数变化会清除帧和重复身体缓存，时长或颜色修改不影响已有图像缓存',()=>{
  const record=parseNoteSkin(noteSkinFixture());const runtime=new NoteSkinRuntime(record as unknown as NoteSkinRecord,new Map(),(name: string,source: SkinPicture): SkinPicture => source);
  runtime.crops.set('frame',{});runtime.setInfo({...runtime.info,hitFxDuration:0.8});assert.equal(runtime.crops.size,1);
  runtime.setInfo({...runtime.info,hitFx:[2,8]});assert.equal(runtime.crops.size,0);
  runtime.crops.set('body',{});runtime.setInfo({...runtime.info,holdAtlas:[20,24]});assert.equal(runtime.crops.size,0);
  runtime.crops.set('body-mh',{});runtime.setInfo({...runtime.info,holdAtlasMH:[30,40]});assert.equal(runtime.crops.size,0);
});

interface CanvasStub { width: number; height: number; getContext(): DrawContext }
function withFrameCanvases(run: (canvases: CanvasStub[]) => void) {
  const previous = globalThis.document, canvases: CanvasStub[] = [];
  globalThis.document = { createElement(name: string) { assert.equal(name, 'canvas'); const context = drawContext(), canvas = { width: 0, height: 0, getContext: () => context }; canvases.push(canvas); return canvas; } } as unknown as Document;
  try { run(canvases); } finally { if (previous === undefined) Reflect.deleteProperty(globalThis, 'document'); else globalThis.document = previous; }
}

test('70 帧打击动画跨预览和循环复用完整缓存，不重复裁切染色或占用共享音符缓存',()=>withFrameCanvases(canvases=>{
  const record=parseNoteSkin(noteSkinFixture('hitFxDuration: 0.65\nhideParticles: true')) as unknown as NoteSkinRecord;record.info.hitFx=[7,10];
  const runtime=new ResourceNoteSkin(record,new Map([['hit_fx.png',{naturalWidth:2509,naturalHeight:3585}]]) as unknown as Map<string, HTMLImageElement>,()=>assert.fail('打击动画不应生成共享临时染色源'));
  const contexts=[drawContext(),drawContext()],draw=(index: number,color?: [number, number, number])=>runtime.drawHit(contexts[index%2],{age:(index+.5)/70*.65,x:0,y:0,size:100,color});
  for(let pass=0;pass<4;pass++)for(let index=0;index<70;index++)draw(index);
  assert.equal(canvases.length,70);assert.equal(runtime.hitFrames.size,70);assert.equal(runtime.hitFrameBytes,70*359*359*4);
  assert.equal(runtime.crops.size,0);
  draw(4,[100.1,200.2,255]);draw(4,[100.2,200.1,255]);assert.equal(canvases.length,71,'相同渲染颜色应复用同一帧');
  runtime.setInfo({...runtime.info,hitFxDuration:1,holdAtlas:[14,18]});assert.equal(runtime.hitFrames.size,71);
  runtime.setInfo({...runtime.info,hitFx:[5,14]});assert.equal(runtime.hitFrames.size,0);assert.equal(runtime.hitFrameBytes,0);
  runtime.drawHit(contexts[0],{age:.1,x:0,y:0,size:100});runtime.dispose();assert.equal(runtime.hitFrames.size,0);assert.equal(runtime.hitFrameBytes,0);
}));

test('打击帧按像素预算限制缓存，最近使用的帧在淘汰时保留',()=>withFrameCanvases(canvases=>{
  const record=parseNoteSkin(noteSkinFixture('hitFxDuration: 1\nhideParticles: true')) as unknown as NoteSkinRecord;record.info.hitFx=[7,10];
  const runtime=new ResourceNoteSkin(record,new Map([['hit_fx.png',{naturalWidth:512*7,naturalHeight:512*10}]]) as unknown as Map<string, HTMLImageElement>,()=>assert.fail());
  const context=drawContext(),draw=(index: number)=>runtime.drawHit(context,{age:(index+.5)/70,x:0,y:0,size:100});
  for(let index=0;index<64;index++)draw(index);
  draw(0);draw(64);
  const allocated=canvases.length;draw(0);assert.equal(canvases.length,allocated);draw(1);assert.equal(canvases.length,allocated+1);
  assert.equal(runtime.hitFrames.size,64);assert.equal(runtime.hitFrameBytes,64*1024*1024);
}));

test('可选皮肤音效解码失败明确报错，切换保留谱面自定义音效且跨谱面仍使用选中的皮肤',async()=>{
  const record=parseNoteSkin(new Map([...noteSkinFixture(),['click.ogg',new Uint8Array([1,2,3])]]));
  const decoded={duration:0.08};const buffers=await decodeNoteSkinSounds(record,{decodeAudioData:async()=>decoded});assert.equal(buffers.get('tap'),decoded);
  await assert.rejects(decodeNoteSkinSounds(record,{decodeAudioData:async()=>{throw Error('invalid');}}),/tap.*invalid/);
  const sounds=new HitSounds({} as unknown as ConstructorParameters<typeof HitSounds>[0]);const custom={} as AudioBuffer;sounds.buffers.set('custom.ogg',custom);sounds.setSoundPack(buffers as unknown as Map<string, AudioBuffer>);assert.equal(sounds.buffers.get('custom.ogg'),custom);
  sounds.setProject({judgeLineList:[]} as unknown as Chart,new Map(),'chart.json');assert.equal(sounds.skinBuffers.get('tap'),decoded);sounds.setSoundPack();assert.equal(sounds.skinBuffers.size,0);
});

test('播放调度同时使用皮肤音效、缺省回退和谱面自定义音效，恢复默认后取消旧声源',()=>{
  const chart=createChart();chart.judgeLineList[0].notes=[createNote(1,2,0),createNote(4,2,0),{...createNote(3,2,0),hitsound:'custom.ogg'}];
  const sources: FakeAudioSource[]=[];const transport={playing:true,time:0.95,rate:1,playRevision:1,context:{currentTime:10,createBufferSource(){const source: FakeAudioSource={connect(){},disconnect(){},start(){sources.push(this);},stop(){this.stopped=true;}};return source;}}} as unknown as ConstructorParameters<typeof HitSounds>[0];
  const sounds=new HitSounds(transport);sounds.gain={} as GainNode;const tap={id:'default-tap'} as unknown as AudioBuffer,drag={id:'default-drag'} as unknown as AudioBuffer,custom={id:'custom'} as unknown as AudioBuffer,packTap={id:'pack-tap'} as unknown as AudioBuffer;
  for(const [name,buffer] of [['tap',tap],['drag',drag],['custom.ogg',custom]] as [string, AudioBuffer][])sounds.buffers.set(name,buffer);
  sounds.setSoundPack(new Map([['tap',packTap]]));sounds.tick(chart,new TempoMap(chart.BPMList));assert.deepEqual(sources.map(source=>source.buffer),[packTap,drag,custom]);
  sounds.setSoundPack();assert.ok(sources.every(source=>source.stopped));sounds.tick(chart,sounds.tempo!);assert.deepEqual(sources.slice(3).map(source=>source.buffer),[tap,drag,custom]);
});

test('皮肤预览在宽、窄、高画布和不同像素密度下保持音符头尾与方形特效的原始宽高比',()=>{
  const previous=globalThis.devicePixelRatio;
  try {
    for(const ratio of [1,1.5,2])for(const [width,height]of [[1000,248],[420,248],[280,350],[680,100]]){
      globalThis.devicePixelRatio=ratio;const drawings: DrawingRecord[]=[];const stack: TransformState[]=[];let transform: TransformState={x:1,y:1};
      const context=new Proxy({globalAlpha:1,
        setTransform(x: number,b: number,c: number,y: number){transform={x,y};},save(){stack.push({...transform});},restore(){transform=stack.pop()!;},
        scale(x: number,y: number){transform={x:transform.x*x,y:transform.y*y};},
        drawImage(image: SkinPicture,...args: number[]){const target=args.slice(-4);drawings.push({image,width:Math.abs(target[2]*transform.x),height:Math.abs(target[3]*transform.y)});},
      },{get(target,key){return (target as unknown as Record<string | symbol, unknown>)[key]??(()=>{});}}) as unknown as CanvasRenderingContext2D;
      const manager=Object.create(NoteSkins.prototype);manager.canvas={clientWidth:width,clientHeight:height,width:0,height:0,getContext:()=>context};
      const skin=new RpeSkin(()=>{});skin.tinted=((name: string)=>skin.images.get(name)) as unknown as typeof skin.tinted;manager.previewSkin=skin;
      for(const name of ['Tap2','Tap2HL','Drag2','DragHL','Flick2','Flick2HL','HoldHead','HoldHeadHL','HoldEnd','img-7'])skin.images.set(name,{name,naturalWidth:100,naturalHeight:name.startsWith('img-')?100:name.startsWith('Drag')?3:25} as unknown as SkinImageValue);
      skin.images.set('Hold3',{name:'body',naturalWidth:100,naturalHeight:10} as unknown as SkinImageValue);
      manager.drawDemo(0.1);
      const spriteDrawings=drawings.filter(entry=>entry.image.name!=='body');assert.ok(spriteDrawings.some(entry=>entry.image.name==='img-7'));
      for(const entry of spriteDrawings)assert.ok(Math.abs(entry.width/entry.height-entry.image.naturalWidth/entry.image.naturalHeight)<1e-10,`${entry.image.name} distorted at ${width}x${height}, DPR ${ratio}`);
      assert.equal(manager.canvas.width,Math.round(width*ratio));assert.equal(manager.canvas.height,Math.round(height*ratio));
    }
  } finally {if(previous===undefined)delete (globalThis as { devicePixelRatio?: number }).devicePixelRatio;else globalThis.devicePixelRatio=previous;}
});
