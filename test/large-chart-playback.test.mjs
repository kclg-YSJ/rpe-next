import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { EditorPlayback } from '../src/application/playback.mjs';
import { LargeChartHitSounds } from '../src/platform/large-chart-hitsounds.mjs';
import { HitSounds } from '../src/platform/hitsounds.mjs';

test('buffering retains playback intent across stale reads, and manual pause or seek cancels it', async () => {
  const audio = { playing: true, time: 10, pause() { this.playing=false; }, async play() { this.playing=true; }, seek(value) { this.time=value; } };
  const playback = new EditorPlayback(audio,{stop(){}},()=>{});
  playback.waitForData(); const request = playback.request;
  assert.equal(audio.playing,false); assert.ok(playback.buffering);
  // An obsolete read simply does not resume; it cannot erase the stored intent.
  playback.waitForData(); assert.equal(playback.request,request);
  await playback.resumeWhenReady(); assert.equal(audio.playing,true); assert.equal(playback.buffering,null);
  playback.waitForData(); playback.pause(); await playback.resumeWhenReady(); assert.equal(audio.playing,false);
  audio.playing=true; playback.waitForData(); playback.seek(50); await playback.resumeWhenReady(); assert.equal(audio.playing,false); assert.equal(audio.time,50);
  audio.playing=true; playback.waitForData(); await playback.toggle({}); assert.equal(playback.buffering,null); assert.equal(audio.playing,false);
});

test('a cancelled asynchronous resume cannot restart music after a user pause', async () => {
  let release; const delayed = new Promise(resolve=>{release=resolve;});
  const audio={playing:true,pause(){this.playing=false;},async play(){await delayed;this.playing=true;}};
  const playback=new EditorPlayback(audio,{stop(){}},()=>{}); playback.waitForData();
  const resume=playback.resumeWhenReady(); playback.pause(); release(); await resume;
  assert.equal(audio.playing,false); assert.equal(playback.buffering,null);
});

test('streamed weighted impulses preserve coincident multiplicity and appended fractional frames', async () => {
  let Processor;
  const context={currentFrame:0,AudioWorkletProcessor:class{constructor(){this.port={};}},registerProcessor(name,value){Processor=value;}};
  runInNewContext(await readFile(new URL('../src/platform/hitsound-impulses.mjs',import.meta.url),'utf8'),context);
  const generator=new Processor({processorOptions:{frames:new Float64Array([1.5]),weights:new Float64Array([10000000])}});
  generator.port.onmessage({data:{frames:new Float64Array([128.25]),weights:new Float64Array([4])}});
  const first=new Float32Array(128); generator.process([],[[first]]);
  assert.equal(first[1],5000000); assert.equal(first[2],5000000);
  context.currentFrame=128;const second=new Float32Array(128);generator.process([],[[second]]);
  assert.equal(second[0],3); assert.equal(second[1],1); assert.equal(generator.blocks.length,0);
});

test('hitsound windows survive buffer pause/resume and schedule full counts only once', async context => {
  const original=globalThis.AudioWorkletNode,generators=[];
  globalThis.AudioWorkletNode=class{
    constructor(context,name,options){this.options=options;this.messages=[];this.port={postMessage:value=>this.messages.push(value)};generators.push(this);}
    connect(){}disconnect(){}
  };
  context.after(()=>{globalThis.AudioWorkletNode=original;});
  const audioContext={currentTime:0,sampleRate:48000,createConvolver:()=>({connect(){},disconnect(){}})};
  const audio={playing:true,clockReady:true,context:audioContext,time:0,rate:1,playRevision:1};
  const sounds=new HitSounds(audio); sounds.gain={};sounds.workletContext=audioContext;
  const buffer={sampleRate:48000};sounds.buffers.set('tap',buffer);
  const document={revision:0,summary:{id:'chart'},session:{lineIndex:0}};
  const stream=new LargeChartHitSounds(document,sounds,async()=>({entries:[{time:.1,kind:'tap',sound:'tap',count:10000000},{time:.4,kind:'tap',sound:'tap',count:2}]}));
  await stream.ensure(0);stream.tick(0);
  assert.equal(generators.length,1);assert.equal(generators[0].options.processorOptions.weights[0],10000000);
  stream.tick(.05);assert.equal(generators[0].messages.length,0);
  stream.tick(.2);assert.equal(generators[0].messages.length,1);assert.equal(generators[0].messages[0].weights[0],2);
  sounds.stop();audio.playRevision++;assert.equal(stream.contains(.2),true,'prepared data is independent of playback source generation');
  stream.tick(.2);assert.equal(generators.length,2);assert.equal(generators[1].options.processorOptions.weights[0],2);
});
