import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { createChart, createEvent, createNote } from '../src/core/chart.mjs';
import { TempoMap } from '../src/core/tempo.mjs';
import { chartRange, rangeEndAtOffset } from '../src/application/render-project.mjs';
import { mixRenderPcm } from '../src/core/render-audio-mix.mjs';
import { renderFramePlan, renderAwait } from '../src/core/render-task.mjs';
import { normalizeSettings } from '../src/core/render-settings.mjs';
import { createRenderAudioTrack } from '../src/platform/render-audio.mjs';
import { renderFrames } from '../src/application/render-frames.mjs';

const { RenderOutputService } = createRequire(import.meta.url)('../desktop/render-output.cjs');
const buffer = (samples, sampleRate=10) => ({sampleRate,numberOfChannels:1,length:samples.length,duration:samples.length/sampleRate,getChannelData:()=>Float32Array.from(samples)});

test('渲染打击固定在谱面秒，正负音乐偏移与区间裁剪不改变判定位置', () => {
  const hit=buffer([.25,.25]),music=buffer([0,0,0,0,.5,.5]);
  for(const offset of [-.2,0,.2]){
    const pcm=mixRenderPcm({start:.2,frames:6,sampleRate:10,music:[],hits:[{time:.4,sound:'tap'}],hitBuffers:new Map([['tap',hit]]),offset});
    assert.equal(pcm[2],.25);assert.equal(pcm[1],0);
  }
  assert.equal(mixRenderPcm({start:0,frames:6,sampleRate:10,music:[{buffer:music,timestamp:0}],hits:[],hitBuffers:new Map(),offset:.2})[2],.5);
});
test('渲染混音不在 8192 次后截断，分组数量与跨块尾音保持', () => {
  const hit=buffer([1,1,1]),hits=Array.from({length:8200},()=>({time:0,sound:'tap'}));
  const sounds=new Map([['tap',hit]]);
  assert.equal(mixRenderPcm({start:0,frames:1,sampleRate:10,hits,hitBuffers:sounds})[0],8200);
  assert.equal(mixRenderPcm({start:0,frames:1,sampleRate:10,hits:[{time:0,sound:'tap',count:50000000}],hitBuffers:sounds})[0],50000000);
  assert.equal(mixRenderPcm({start:.2,frames:2,sampleRate:10,hits:[{time:0,sound:'tap'}],hitBuffers:sounds})[0],1);
});
test('自动时长采用音乐或声明时长，音乐缺省时包含特殊事件', () => {
  const chart=createChart(),tempo=new TempoMap(chart.BPMList);
  chart.judgeLineList[0].extended.scaleXEvents=[createEvent(0,1,0,200)];
  assert.ok(chartRange(chart,tempo).end>=100);
  chart.judgeLineList[0].eventLayers[0].moveXEvents=[createEvent(0,1,0,1000000)];
  assert.equal(chartRange(chart,tempo,180).end,180);
  chart.META.offset=1000;const range=chartRange(chart,tempo,180);assert.equal(range.end,179);assert.equal(rangeEndAtOffset(range,-1000),181);
  chart.META.duration=20;assert.equal(chartRange(chart,tempo,180).end,20);
});
test('渲染参数限制、皮肤冲突策略及非整帧区间', () => {
  assert.equal(normalizeSettings({}).skinPolicy,'render');assert.equal(normalizeSettings({skinPolicy:'skin'}).skinPolicy,'skin');
  assert.ok(normalizeSettings({start:Infinity,end:1e50}).end<=43200);
  const plan=renderFramePlan(1.1,24);assert.equal(plan.frames,27);assert.ok(plan.duration-26*plan.frameDuration>0);
  assert.throws(()=>renderFramePlan(Infinity,60));assert.throws(()=>renderFramePlan(43201,60));
});
test('分块混音在连续、跳转和重播时不会重复叠加尾音', async () => {
  const sounds=new Map([['tap',buffer([1,1,1])]]);sounds.ensure=async()=>{};
  const project={assertCurrent(){},readHits:async(start,end)=>[{time:0,sound:'tap'}].filter(h=>h.time>=start&&h.time<end)};
  const track=createRenderAudioTrack(project,{start:0,musicVolume:0,hitVolume:1,hitSounds:true,sampleRate:10},sounds);
  const first=await track.read(0,1),second=await track.read(.1,1),replay=await track.read(0,1);
  assert.equal(first[0],1);assert.equal(second[0],1);assert.equal(replay[0],1);
});
test('取消会及时结束等待，过期异步结果不会继续任务', async () => {
  const controller=new AbortController(),never=new Promise(()=>{});
  const waiting=renderAwait(never,controller.signal);controller.abort();await assert.rejects(waiting,{name:'AbortError'});
});
test('绘制只提前一帧，送帧先同步捕获且始终等待编码背压', async () => {
  const captured=[],drawn=[];let canvas=-1,encoding=0,maximum=0,release,overlap=false;
  await renderFrames({frames:6,frameDuration:1/60,duration:.1,
    drawFrame:(_time,index)=>{canvas=index;drawn.push(index);if(encoding){overlap=true;release();}},
    submitFrame:()=>{captured.push(canvas);encoding++;maximum=Math.max(maximum,encoding);return new Promise(resolve=>{release=()=>{encoding--;resolve();};if(captured.length===6)queueMicrotask(release);});},
  });
  assert.equal(overlap,true);assert.equal(maximum,1);assert.deepEqual(captured,[0,1,2,3,4,5]);assert.deepEqual(drawn,captured);
});
test('不支持同步快照的平台逐帧等待，末帧时长和全部时间戳不变', async () => {
  const records=[];let busy=false;
  await renderFrames({frames:3,frameDuration:.1,duration:.25,pipeline:false,
    drawFrame:()=>assert.equal(busy,false),
    submitFrame:async(time,duration)=>{busy=true;records.push([time,duration]);await Promise.resolve();busy=false;},
  });
  assert.equal(records.length,3);assert.equal(records[2][0],.2);assert.ok(Math.abs(records[2][1]-.05)<1e-9);
});
test('界面刷新按墙钟限频，所有输出帧保留并显示首尾进度', async () => {
  let time=0,draws=0;const shown=[],progress=[];
  await renderFrames({frames:20,frameDuration:1/60,duration:20/60,now:()=>time,yieldTask:async()=>{},
    drawFrame:()=>{draws++;time+=10;},submitFrame:()=>{},
    onFrame:frame=>shown.push(frame.index),onProgress:frame=>progress.push(frame.frame),
  });
  assert.equal(draws,20);assert.equal(shown[0],0);assert.equal(shown.at(-1),19);assert.ok(shown.length<6);assert.equal(progress.at(-1),20);
});
test('编码失败或取消停止后续送帧，不产生未处理的提前绘制异常', async () => {
  const expected=Error('encoder failed'),submitted=[];
  await assert.rejects(renderFrames({frames:10,frameDuration:.1,duration:1,
    drawFrame:(_time,index)=>{if(index===1)throw Error('next draw failed');},
    submitFrame:time=>{submitted.push(time);return Promise.reject(expected);},
  }),error=>error===expected);
  assert.deepEqual(submitted,[0]);
  const controller=new AbortController();let count=0;
  await assert.rejects(renderFrames({frames:10,frameDuration:.1,duration:1,signal:controller.signal,
    drawFrame:()=>{},submitFrame:()=>{count++;controller.abort();return Promise.resolve();},
  }),{name:'AbortError'});assert.equal(count,1);
});
test('编码器失败会取消并收回等待磁盘数据的提前绘制', async () => {
  let failEncoder,cancelled=false;
  const encoderFailure=Error('output failed');
  await assert.rejects(renderFrames({frames:3,frameDuration:.1,duration:.3,
    drawFrame:async(_time,index,_frames,signal)=>{
      if(!index)return;
      failEncoder(encoderFailure);
      try { await renderAwait(new Promise(()=>{}),signal); }
      finally { cancelled=signal.aborted; }
    },
    submitFrame:()=>new Promise((_,reject)=>{failEncoder=reject;}),
  }),error=>error===encoderFailure);
  assert.equal(cancelled,true);
});
test('桌面视频输出支持回填、提交与失败保留旧文件；token 不跨窗口使用', async () => {
  const parent=resolve('.local-tools');await mkdir(parent,{recursive:true});const root=await mkdtemp(join(parent,'render-test-'));
  const target=join(root,'原有视频.mp4');await writeFile(target,'old');const service=new RenderOutputService(async()=>target);
  try {
    let file=await service.call(1,'begin',{name:'测试.mp4'});
    await service.call(1,'write',{id:file.id,position:0,data:new Uint8Array([1,2,3])});
    await assert.rejects(service.call(2,'write',{id:file.id,position:0,data:new Uint8Array([5])}));
    await service.call(1,'abort',{id:file.id});assert.equal(await readFile(target,'utf8'),'old');
    file=await service.call(1,'begin',{name:'测试.mp4'});await service.call(1,'write',{id:file.id,position:0,data:new Uint8Array([1,2,3])});await service.call(1,'write',{id:file.id,position:0,data:new Uint8Array([9])});
    await service.call(1,'close',{id:file.id});assert.equal(await readFile(target,'utf8'),'old');const result=await service.call(1,'commit',{id:file.id});assert.equal(result.status,'saved');assert.deepEqual([...await readFile(target)],[9,2,3]);
    assert.deepEqual(await readdir(root),['原有视频.mp4']);await assert.rejects(service.call(1,'begin',{name:'../bad.mp4'}));
  } finally {await service.dispose();assert.ok(root.startsWith(parent));await rm(root,{recursive:true,force:true});}
});

test('打开输出目录仅接受本窗口最近成功保存的 token，取消不产生结果且清理后失效', async () => {
  const parent=resolve('.local-tools');await mkdir(parent,{recursive:true});const root=await mkdtemp(join(parent,'render-folder-test-'));
  const target=join(root,'导出 视频.mp4'),opened=[];
  const service=new RenderOutputService(async()=>target,{openFolder:async folder=>opened.push(folder)});
  const begin=()=>service.call(1,'begin',{name:'视频.mp4'});
  const commit=async file=>{await service.call(1,'write',{id:file.id,position:0,data:new Uint8Array([1])});return service.call(1,'commit',{id:file.id});};
  try {
    const file=await begin();
    await assert.rejects(service.call(1,'openFolder',{id:file.id}));
    const saved=await commit(file);
    await assert.rejects(service.call(2,'openFolder',{id:saved.id}));
    await assert.rejects(service.call(1,'openFolder',{id:'forged',path:target}));
    assert.equal(await service.call(1,'openFolder',{id:saved.id,path:'ignored'}),true);
    assert.deepEqual(opened,[root]);
    const aborted=await begin();await service.call(1,'abort',{id:aborted.id});
    await assert.rejects(service.call(1,'openFolder',{id:aborted.id}));
    assert.equal(await service.call(1,'openFolder',{id:saved.id}),true);
    const latest=await commit(await begin());
    await assert.rejects(service.call(1,'openFolder',{id:saved.id}));
    assert.equal(service.completed.size,1);
    assert.equal(await service.call(1,'openFolder',{id:latest.id}),true);
    await service.dispose(1);assert.equal(service.completed.size,0);
    await assert.rejects(service.call(1,'openFolder',{id:latest.id}));
  } finally {await service.dispose();await rm(root,{recursive:true,force:true});}
});

test('打开视频目录的系统错误向上传递，不改变已保存的视频', async () => {
  const parent=resolve('.local-tools');await mkdir(parent,{recursive:true});const root=await mkdtemp(join(parent,'render-folder-error-'));
  const target=join(root,'视频.mp4'),failure=Error('Folder access denied');
  const service=new RenderOutputService(async()=>target,{openFolder:async()=>{throw failure;}});
  try {
    const file=await service.call(1,'begin',{name:'视频.mp4'});
    await service.call(1,'write',{id:file.id,position:0,data:new Uint8Array([9])});
    const saved=await service.call(1,'commit',{id:file.id});
    await assert.rejects(service.call(1,'openFolder',{id:saved.id}),error=>error===failure);
    assert.deepEqual([...await readFile(target)],[9]);
    await service.dispose();assert.equal(service.completed.size,0);
  } finally {await service.dispose();await rm(root,{recursive:true,force:true});}
});
