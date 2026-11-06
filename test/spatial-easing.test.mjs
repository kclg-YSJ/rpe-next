import test from 'node:test';
import assert from 'node:assert/strict';
import { createChart,createLine,createEvent,parseChart,serializeChart } from '../src/core/chart.mjs';
import { EditorSession } from '../src/application/session.mjs';
import { changeSpatialEasing } from '../src/application/spatial-edit.mjs';
import { spatialSources,SpatialTracks } from '../src/core/spatial-track.mjs';
import { TempoMap } from '../src/core/tempo.mjs';
import { EventTrack } from '../src/core/events.mjs';
import { withStandardEasing,withCustomEasing,cropCustomEvent } from '../src/core/event-easing.mjs';
import { previewCurveEvent } from '../src/application/animation-curve-preview.mjs';
import { legacyChart } from '../src/platform/files.mjs';

const curve={version:1,name:'test',nodes:[{x:0,y:0,mode:'corner',out:[.3,0]},{x:1,y:1,mode:'corner',in:[.7,.1]}]};
const make=()=>{const chart=createChart();chart.judgeLineList.push(createLine());const line=chart.judgeLineList[1];line.bpmfactor=2;line.eventLayers.push({...createLine().eventLayers[0]});line.eventLayers[1].moveXEvents=[{...createEvent(0,200,0,8),'x-unknown':{keep:true}},createEvent(200,400,8,16)];return{chart,tempo:new TempoMap(chart.BPMList)};};
const sourceAt=(chart,tempo,field='end',index=0)=>spatialSources(chart.judgeLineList[1],1,tempo).find(s=>s.layer===1&&s.type==='moveXEvents'&&s.index===index&&s.field===field);
test('空间首尾节点编辑同一来源缓动，不改变线号、层、相邻段及未知字段',()=>{
  for(const field of ['start','end']){const{chart,tempo}=make(),source=sourceAt(chart,tempo,field),next=changeSpatialEasing(chart,source,event=>withStandardEasing(event,5));
    const before=chart.judgeLineList[1],line=next.judgeLineList[1],event=line.eventLayers[1].moveXEvents[0];assert.equal(next.judgeLineList[0],chart.judgeLineList[0]);assert.equal(line.eventLayers[0],before.eventLayers[0]);assert.equal(line.eventLayers[1].moveYEvents,before.eventLayers[1].moveYEvents);assert.equal(line.eventLayers[1].moveXEvents[1],before.eventLayers[1].moveXEvents[1]);
    assert.deepEqual(event.startTime,[0,0,1]);assert.deepEqual(event.endTime,[8,0,1]);assert.deepEqual(event['x-unknown'],{keep:true});assert.equal(event.start,0);assert.equal(event.end,200);assert.equal(event.easingType,5);
    const track=new EventTrack([event],tempo,2);assert.equal(track.value(tempo.seconds(4,2)),50);assert.equal(chart.judgeLineList[1].eventLayers[1].moveXEvents[0].easingType,1);
  }
});
test('空间缓动事务一步撤销重做，动态轨迹缓存随事件变化而更新',()=>{
  const{chart,tempo}=make(),session=new EditorSession(chart),tracks=new SpatialTracks();tracks.compile(session.chart,tempo);const beat=tempo.beat(tempo.seconds(4,2)),before=tracks.state(1,beat).x;
  const next=changeSpatialEasing(session.chart,sourceAt(session.chart,tempo),event=>withStandardEasing(event,5));session.commit('easing',next);tracks.compile(session.chart,tempo);assert.ok(Math.abs(tracks.state(1,beat).x-before)>40);assert.equal(session.history.undoStack.length,1);
  session.travel('undo');assert.equal(session.chart.judgeLineList[1].eventLayers[1].moveXEvents[0].easingType,1);session.travel('redo');assert.equal(session.chart.judgeLineList[1].eventLayers[1].moveXEvents[0].easingType,5);
});
test('自定义曲线、裁切、Bézier及标准缓动切换保留数据和持久化语义',()=>{
  const{chart,tempo}=make(),source=sourceAt(chart,tempo);const custom=changeSpatialEasing(chart,source,event=>withCustomEasing(event,curve));assert.equal(custom.META.RPEVersion,250);
  const event=custom.judgeLineList[1].eventLayers[1].moveXEvents[0],cropped=cropCustomEvent(event,.25,.75,[2,0,1],[6,0,1]),cropChart={...custom,judgeLineList:custom.judgeLineList.map((line,index)=>index===1?{...line,eventLayers:line.eventLayers.map((layer,index)=>index===1?{...layer,moveXEvents:[cropped]}:layer)}:line)};
  const preview=changeSpatialEasing(cropChart,sourceAt(cropChart,tempo),event=>previewCurveEvent(event,{...curve,name:'changed'}));assert.equal(preview.judgeLineList[1].eventLayers[1].moveXEvents[0].customEasing.curve.name,'changed');assert.equal(cropChart.judgeLineList[1].eventLayers[1].moveXEvents[0].customEasing.curve.name,'test');
  const standard=changeSpatialEasing(cropChart,sourceAt(cropChart,tempo),event=>withStandardEasing(event,4)),standardEvent=standard.judgeLineList[1].eventLayers[1].moveXEvents[0];assert.equal(standardEvent.customEasing,undefined);assert.equal(standardEvent.start,cropped.start);assert.equal(standardEvent.end,cropped.end);
  const bezier=changeSpatialEasing(standard,sourceAt(standard,tempo),event=>({...event,bezier:1,bezierPoints:[.1,-.3,.7,1.2]})),reopened=parseChart(serializeChart(bezier));assert.deepEqual(reopened.judgeLineList[1].eventLayers[1].moveXEvents[0].bezierPoints,[.1,-.3,.7,1.2]);
  const exported=legacyChart(parseChart(serializeChart(custom)),{segments:128,simplify:false});assert.ok(exported.judgeLineList[1].eventLayers[1].moveXEvents.length>2);
});
test('缓动只沿原绑定组联动，不因XY绑定或相邻连续节点改变另一轴',()=>{
  const{chart,tempo}=make(),layer=chart.judgeLineList[1].eventLayers[1];layer.moveXEvents=layer.moveXEvents.map(event=>({...event,linkgroup:3}));layer.moveYEvents=[{...createEvent(0,100,0,8),linkgroup:3}];
  const next=changeSpatialEasing(chart,sourceAt(chart,tempo),event=>withStandardEasing(event,9));assert.ok(next.judgeLineList[1].eventLayers[1].moveXEvents.every(event=>event.easingType===9));assert.equal(next.judgeLineList[1].eventLayers[1].moveYEvents,layer.moveYEvents);
});
test('扩展缩放与文字事件也可编辑缓动；过期、零时长、公式轨迹和非法参数拒绝',()=>{
  const{chart,tempo}=make(),line=chart.judgeLineList[1];line.extended.scaleXEvents=[createEvent(1,2,0,8)];line.extended.textEvents=[{...createEvent(0,1,0,8),start:'',end:'abc'}];
  for(const type of ['scaleXEvents','textEvents']){const source=spatialSources(line,1,tempo).find(s=>s.type===type);const next=changeSpatialEasing(chart,source,event=>withStandardEasing(event,4));assert.equal(next.judgeLineList[1].extended[type][0].easingType,4);}
  const source=sourceAt(chart,tempo);assert.throws(()=>changeSpatialEasing(chart,{...source,event:{}},event=>event));assert.throws(()=>changeSpatialEasing(chart,source,event=>withStandardEasing(event,99)));assert.throws(()=>changeSpatialEasing(chart,source,event=>({...event,easingLeft:-.1})));assert.throws(()=>changeSpatialEasing(chart,source,event=>({...event,bezier:1,bezierPoints:[0,1]})));
  line.eventLayers[1].moveXEvents=[createEvent(0,1,2,2)];assert.throws(()=>changeSpatialEasing(chart,sourceAt(chart,tempo),event=>withStandardEasing(event,5)),/时间/);
  line.eventLayers[1].moveXEvents=[{...createEvent(0,1,0,8),trajectory:{options:{xExpression:'t',yExpression:'t'}}}];assert.throws(()=>changeSpatialEasing(chart,sourceAt(chart,tempo),event=>withStandardEasing(event,5)),/轨迹/);
});
