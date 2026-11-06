import test from 'node:test';
import assert from 'node:assert/strict';
import { NoisePreview } from '../src/ui/noise-preview.mjs';
import { createChart } from '../src/core/chart.mjs';
import { createNoiseArea } from '../src/core/noise-areas.mjs';
import { TempoMap } from '../src/core/tempo.mjs';

test('皮肤剔除使用真实视口与输出像素余量，跨层独立；简单预览保留原范围', context => {
  const original=globalThis.Path2D;globalThis.Path2D=class{moveTo(){}lineTo(){}closePath(){}};
  context.after(()=>{if(original===undefined)delete globalThis.Path2D;else globalThis.Path2D=original;});
  const chart=createChart();chart.noiseAreaLayers=[{id:'default',skin:'shader/A',name:'A'},{id:'wide',skin:'shader/B',name:'B'},{id:'simple',skin:'',name:'C'}];
  const guides=[];for(const layerId of ['default','wide','simple'])for(const x of [95,115,145])guides.push({index:guides.length,area:{...createNoiseArea(),layerId},scaleX:1,scaleY:1,state:'active',points:[{x,y:-20},{x:x+4,y:-20},{x:x+4,y:20},{x,y:20}]});
  const preview=new NoisePreview(),rendered=[],simple=[],prepared=[];
  const assets=new Map();preview.getAssets=()=>assets;
  preview.gpu={prune(){},prepare(layer,input,w,h){assert.equal(input,assets);prepared.push([layer.id,w,h]);return{skin:layer.id,padding:layer.id==='default'?[20,20]:[60,60]};},render(target,layer,input,entries,seconds,viewport,scale,width,height,skin){assert.equal(skin,layer.id);rendered.push([layer.id,entries.map(entry=>entry.points[0].x)]);return true;}};
  preview.drawLayer=entries=>{simple.push(...entries.map(entry=>entry.points[0].x));return{coverage:{},material:{}};};preview.layer=()=>({canvas:{},context:{drawImage(){}}});
  // 400 CSS canvas, x=100..300 viewport, DPR=2: left/right pads are 10/30 CSS pixels.
  preview.draw({canvas:{width:800},save(){},restore(){},drawImage(){}},chart,new TempoMap(chart.BPMList),1,400,300,1,-1,{left:100,top:50,width:200,height:200},{sourceGuides:guides,pixelRatio:2});
  assert.deepEqual(prepared,[['default',400,400],['wide',400,400]]);
  // All x positions are offset from canvas centre (200 CSS pixels).
  assert.deepEqual(rendered,[['default',[95]],['wide',[95,115]]]);
  assert.deepEqual(simple,[95,115,145]);
});
