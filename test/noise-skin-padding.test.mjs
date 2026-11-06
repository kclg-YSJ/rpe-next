import test from 'node:test';
import assert from 'node:assert/strict';
import { noisePadding, noiseTargetFrame, paddedNoiseShader } from '../src/core/noise-skin-padding.mjs';
import { parseNoiseSkin } from '../src/core/noise-skin.mjs';
import { readFile } from 'node:fs/promises';

test('屏外余量按原逻辑分辨率计算，各目标扩出整数像素且保留采样格点', () => {
  assert.deepEqual(noisePadding(undefined,1920,1080),[32,32]);
  assert.deepEqual(noisePadding({pixels:32,screenWidth:.071,screenHeight:.071},1920,1080),[169,109]);
  const frame=noiseTargetFrame(1920,1080,240,135,[169,109]);
  assert.deepEqual(frame.padding,[22,14]); assert.deepEqual(frame.size,[284,163]);
  assert.deepEqual(frame.logicalSize,[240,135]);
  for(const x of [-10,0,42,239,250]) assert.ok(Math.abs((frame.sampleRect[0]+(x+.5)/240*frame.sampleRect[2])*frame.size[0]-(x+.5+22))<1e-10);
  assert.deepEqual(noiseTargetFrame(400,300,50,37,[0,0]).sampleRect,[0,0,1,1]);
});

test('GLSL 适配保留除法、外部图片采样、宏和局部参数作用域', () => {
  const source=`precision highp float;
varying highp vec2 uv;
uniform sampler2D screenTexture;
#define READ(s,p) texture2D(s,p)
vec4 readTex(sampler2D source,vec2 p){return READ(source,p / 2.0);}
vec4 f(vec2 screenTexture);
vec4 f(vec2 screenTexture){return vec4(screenTexture,0,1);}
void main(){vec4 c=readTex(screenTexture,uv);{vec2 screenTexture=vec2(0);c+=f(screenTexture);}gl_FragColor=c+READ(screenTexture,uv);}`;
  const result=paddedNoiseShader(source);
  assert.ok(result.includes('p / 2.0')); assert.ok(result.includes('#define READ(s,p) texture2D(s,p)'));
  assert.match(result,/sampler2D rpenGuardSampler_source, highp vec4 rpenGuardRect_source/);
  assert.match(result,/#undef screenTexture\s+vec4 f\(vec2 screenTexture\)/);
  assert.match(result,/vec2\s+#undef screenTexture\s+screenTexture=vec2/);
  assert.match(result,/uv=rpenGuardFragment\(\).xy\/rpenGuardLogicalSize/);
});

test('皮肤余量缺省兼容旧配置，普通与低性能通道可独立设置并拒绝无界配置', () => {
  const main='uniform float touchReleaseDuration; // %0.1% 0..1\nvoid main(){gl_FragColor=vec4(0);}';
  const parse=padding=>parseNoiseSkin(new Map([['main.glsl',main],['config.json',JSON.stringify({version:1,targets:{},passes:[{shader:'main.glsl',output:'$screen'}],padding,lowPerformance:{padding:0,passes:[{shader:'main.glsl',output:'$screen'}]}})]]));
  assert.equal(parse(undefined).normal.padding,32); assert.equal(parse({pixels:64,screen:false,geometryOnly:true}).low.padding,0);
  for(const invalid of [-1,Infinity,'32',null,[],{pixels:2049},{screenWidth:2},{geometryOnly:1},{screen:'no'},{unknown:1}]) assert.throws(()=>parse(invalid),/padding/);
});

test('旧谱面内置皮肤副本按内容兼容扩边，不修改资源，也不误替换用户编辑过的副本', async () => {
  const catalog=JSON.parse(await readFile(new URL('../assets/noise-skins/index.json',import.meta.url),'utf8'));
  for(const skin of catalog){
    const files=new Map(await Promise.all(skin.files.map(async path=>[path,new Uint8Array(await readFile(new URL('../assets/noise-skins/'+skin.name+'/'+path,import.meta.url)))])));
    const config=JSON.parse(new TextDecoder().decode(files.get('config.json')));delete config.padding;
    files.set('config.json',JSON.stringify(config));
    if(skin.name==='Ocean'){
      files.set('main.glsl',new TextDecoder().decode(files.get('main.glsl')).replace('vec2 shapeUV=uv+waveUV;','vec2 shapeUV=clamp(uv+waveUV,vec2(0.0),vec2(1.0));'));
      files.set('edgeBand.glsl',new TextDecoder().decode(files.get('edgeBand.glsl')).replace('texture2D(composeRT, uv + d)','texture2D(composeRT, clamp(uv + d, vec2(0.0), vec2(1.0)))'));
    }
    const before=[...files].map(([name,value])=>[name,typeof value==='string'?value:value.slice()]);
    const parsed=parseNoiseSkin(files);
    assert.equal(parsed.normal.padding.geometryOnly,true);assert.equal(parsed.normal.padding.screenWidth,.071);
    if(parsed.low)assert.deepEqual(parsed.low.padding,parsed.normal.padding);
    assert.deepEqual([...files],before);
    if(skin.name==='Ocean')assert.ok(parsed.sources.get('main.glsl').includes('vec2 shapeUV=uv+waveUV;'));
    files.set('main.glsl',(typeof files.get('main.glsl')==='string'?files.get('main.glsl'):new TextDecoder().decode(files.get('main.glsl')))+'\n// custom edit');
    assert.equal(parseNoiseSkin(files).normal.padding,32);
  }
});
