import test from 'node:test';
import assert from 'node:assert/strict';
import { createChart,createLine,createEvent,serializeChart,parseChart } from '../src/core/chart.mjs';
import { legacyChart } from '../src/platform/files.mjs';
import { TempoMap } from '../src/core/tempo.mjs';
import { SceneRuntime } from '../src/core/scene.mjs';
import { TransformScene } from '../src/core/transform-scene.mjs';
import { SpatialTracks,SpatialCamera,spatialSources } from '../src/core/spatial-track.mjs';
import { snapSamplePoint,snapSampleAngle,snapConstrainedPoint,normalizeSampling } from '../src/core/sampling-grid.mjs';
import { changeSpatialPosition,changeSpatialSource,ensureSpatialProperty,splitSpatialEvent,insertSpatialNode,deleteSpatialNode,spatialSourceValue } from '../src/application/spatial-edit.mjs';
import { EventTrack } from '../src/core/events.mjs';
import { createTrajectoryEvent,expandTrajectory } from '../src/application/trajectory-commands.mjs';
import { trajectoryEventValue } from '../src/core/curve-trajectory.mjs';
import { displayNumber,displayPosition,spatialBoundaryFade,spatialGhostTimes } from '../src/ui/spatial-display.mjs';
import { clipSpatialSprite } from '../src/core/spatial-sprite.mjs';
const close=(a,b,epsilon=1e-5)=>assert.ok(Math.abs(a-b)<epsilon,`${a} != ${b}`);
const fixture=()=>{const chart=createChart();return{chart,tempo:new TempoMap(chart.BPMList)};};

test('吸附按轴仲裁，接近才吸附，远离后自由移动',()=>{
  const settings=normalizeSampling(),targets=[{id:'line',x:103,y:68}];
  const first=snapSamplePoint({x:104,y:52},{settings,targets});assert.equal(first.x,103);assert.equal(first.y,52);
  assert.equal(snapSamplePoint({x:114,y:52},{settings,targets,previous:first}).x,103);
  assert.equal(snapSamplePoint({x:118,y:52},{settings,targets,previous:first}).x,118);
  const grid=snapSamplePoint({x:196,y:145},{settings,targets:[]});assert.equal(grid.x,200);assert.equal(grid.y,145);
  assert.equal(snapSamplePoint({x:211,y:145},{settings,previous:grid}).x,200);
  assert.equal(snapSamplePoint({x:214,y:145},{settings,previous:grid}).x,214);
  close(snapSampleAngle(37,{settings,targets:[]}).angle,37);
  close(snapSampleAngle(31,{settings,targets:[]}).angle,30);
  const free=snapSamplePoint({x:104,y:52},{settings,targets,free:true});assert.equal(free.x,104);assert.equal(free.y,52);
  close(snapSampleAngle(371,{settings,targets:[{id:'angle',rotation:10}]}).angle,370);
});
test('变换专用运行时与普通场景父子、多层、倍率求值一致，完全不读取音符',()=>{
  const{chart,tempo}=fixture();chart.judgeLineList.push(createLine());const child=chart.judgeLineList[1];child.father=0;child.bpmfactor=2;child.eventLayers[0].moveXEvents=[createEvent(10,80,0,4)];chart.judgeLineList[0].eventLayers[0].rotateEvents=[createEvent(30,80,0,8)];
  const full=new SceneRuntime();full.compile(chart,tempo);const expected=full.sample(1.2,{x:.8,y:1});
  Object.defineProperty(child,'notes',{get(){throw Error('must not read notes');}});
  const light=new TransformScene();light.compile(chart,tempo);const actual=light.sample(1.2,{x:.8,y:1});for(let i=0;i<2;i++)for(const key of ['x','y','rotation','alpha','scaleX','scaleY'])close(actual[i][key],expected[i][key]);
});
test('单轴吸附只选择沿实际可移动轴可达的约束，不显示不能达到的双轴对齐',()=>{
  const settings=normalizeSampling(),point=snapConstrainedPoint({x:104,y:200},{x:0,y:0},{x:1,y:0},{settings,targets:[{id:'unreachable',y:200},{id:'reachable',x:103}],scale:1});
  assert.equal(point.x,103);assert.equal(point.y,0);assert.equal(point.guides.length,1);assert.equal(point.guides[0].id,'reachable');
  const diagonal=snapConstrainedPoint({x:104,y:104},{x:0,y:0},{x:1,y:1},{settings,targets:[{id:'target',x:103,y:200}]});close(diagonal.x,103);close(diagonal.y,103);
});
test('三维投影和时间面反投影互逆，包括过渡中、过去与未来',()=>{
  for(const progress of [0,.2,1])for(const beat of [-4,0,16])for(const tilt of [0,25,60]){const camera=new SpatialCamera(1000,700,{progress,tilt}),point={x:250,y:-130},projected=camera.project(point,beat,0,.6),back=camera.unproject(projected,beat,0,.6);close(back.x,point.x);close(back.y,point.y);}
});
test('空间显示保留一位小数但不改变原始坐标，边界连续淡出',()=>{
  const p={x:1.234567,y:-.001};assert.equal(displayPosition(p),'(1.2, 0.0)');assert.equal(p.x,1.234567);assert.equal(displayNumber(-.04),'0.0');
  assert.equal(spatialBoundaryFade(0,0,4,16),1);assert.equal(spatialBoundaryFade(-4,0,4,16),0);assert.equal(spatialBoundaryFade(16,0,4,16),0);
  for(const beat of [-3.9,15.9])assert.ok(spatialBoundaryFade(beat,0,4,16)>0&&spatialBoundaryFade(beat,0,4,16)<.1);
  const camera=new SpatialCamera(1000,700);assert.ok(camera.sizeAt(p,-3,0)>camera.sizeAt(p,0,0));assert.ok(camera.sizeAt(p,0,0)>camera.sizeAt(p,12,0));
});
test('连续虚影覆盖整个时间范围，采样相位稳定且数量有界',()=>{
  const options={past:4,future:16},a=spatialGhostTimes(10,options),b=spatialGhostTimes(10.01,options);assert.ok(a.length>150&&a.length<=193);
  assert.ok(a[0].beat>=6&&a[0].beat<6.2);assert.ok(a.at(-1).beat<=26&&a.at(-1).beat>25.8);assert.ok(a.filter(p=>b.some(q=>q.beat===p.beat)).length>180);
  const wide=spatialGhostTimes(10,{past:32,future:128});assert.ok(wide.length<=193);
});
test('跨越时间面边界的Hold和旋转音符按纹理坐标裁切，不泄漏到边框外',()=>{
  const bounds={left:-1,right:1,bottom:-1,top:1},quad=[{x:-2,y:0,u:0,v:0},{x:0,y:2,u:1,v:0},{x:2,y:0,u:1,v:1},{x:0,y:-2,u:0,v:1}];
  const clipped=clipSpatialSprite(quad,bounds);assert.ok(clipped.length>=4);assert.ok(clipped.every(p=>p.x>=-1&&p.x<=1&&p.y>=-1&&p.y<=1&&p.u>=0&&p.u<=1&&p.v>=0&&p.v<=1));
  const outside=quad.map(p=>({...p,x:p.x+10}));assert.equal(clipSpatialSprite(outside,bounds).length,0);
});
test('节点来源保留多属性多层，跳变两侧不被连成真实运动',()=>{
  const{chart,tempo}=fixture();chart.judgeLineList[0].eventLayers[0].moveXEvents=[createEvent(0,100,0,4),createEvent(500,600,4,8)];const tracks=new SpatialTracks();tracks.compile(chart,tempo);const block=tracks.block(0,0,8);const nodes=block.nodes.filter(n=>n.beat===4);assert.ok(nodes.some(n=>Math.abs(n.x-100)<1e-3));assert.ok(nodes.some(n=>Math.abs(n.x-500)<1e-3));assert.ok(!block.points.some(([a,b])=>a.x<101&&b.x>499));
});
test('透明度曲线内部的短暂可见峰值不因首尾透明而被裁掉',()=>{
  const{chart,tempo}=fixture();chart.judgeLineList[0].eventLayers[0].alphaEvents=[{...createEvent(-1,-1,0,.5),customEasing:{sourceStart:-1,sourceEnd:1,domain:[0,.9],curve:{version:1,name:'',nodes:[{x:0,y:0,mode:'linear'},{x:.1,y:0,mode:'linear'},{x:.11,y:2,mode:'linear'},{x:.12,y:0,mode:'linear'},{x:.99,y:0,mode:'linear'},{x:1,y:1,mode:'linear'}]}}}];
  const tracks=new SpatialTracks();tracks.compile(chart,tempo);const block=tracks.block(0,0,.5);assert.ok(block.points.some(([a,b])=>a.alpha>0||b.alpha>0));
});
test('连续端点修改只改当前线当前层，父线坐标反算与原事件一致',()=>{
  const{chart,tempo}=fixture();chart.judgeLineList.push(createLine());const child=chart.judgeLineList[1];child.father=0;chart.judgeLineList[0].eventLayers[0].rotateEvents=[createEvent(45)];child.eventLayers[0].moveXEvents=[createEvent(0,100,0,4),createEvent(100,200,4,8)];child.eventLayers[0].moveYEvents=[createEvent(0,80,0,4),createEvent(80,0,4,8)];
  const sources=spatialSources(child,1,tempo).filter(s=>s.beat===4&&s.field==='end'&&['moveXEvents','moveYEvents'].includes(s.type));const scene=new TransformScene();scene.compile(chart,tempo);const state=scene.sampler(tempo.seconds(4)-1e-8)(1);const next=changeSpatialPosition(chart,tempo,sources,{x:state.x+30,y:state.y+40},{x:1,y:1},{continuous:true});scene.compile(next,tempo);const result=scene.sampler(tempo.seconds(4))(1);close(result.x,state.x+30,1e-3);close(result.y,state.y+40,1e-3);assert.equal(next.judgeLineList[0],chart.judgeLineList[0]);
});
test('Bézier与标准缓动切分保留原曲线而不是重置成线性',()=>{
  const{tempo}=fixture();for(const event of [{...createEvent(20,120,0,8),easingType:5},{...createEvent(20,120,0,8),bezier:1,bezierPoints:[.1,-.2,.7,1.4]}]){const parts=splitSpatialEvent(event,3,tempo,1),before=new EventTrack([event],tempo),after=new EventTrack(parts,tempo);for(let i=0;i<=100;i++)close(before.value(i/25),after.value(i/25),1e-4);}
});
test('整体轨迹分界可再次编辑、原生求值和碎事件导出一致',()=>{
  const{chart,tempo}=fixture(),event=createTrajectoryEvent({xExpression:'300*cos(2*pi*t)',yExpression:'100*sin(2*pi*t)'},[0,0,1],[8,0,1],128);const parts=splitSpatialEvent(event,3,tempo,1);
  for(let i=0;i<=50;i++)close(trajectoryEventValue(parts[0],i/50),trajectoryEventValue(event,i/50*3/8));
  chart.judgeLineList[0].eventLayers[0].moveXEvents=parts;const source=spatialSources(chart.judgeLineList[0],0,tempo).find(s=>s.beat===3&&s.axis==='y'&&s.field==='start');const value=spatialSourceValue(source);const next=changeSpatialSource(chart,tempo,source,{value:value+50});const edited=next.judgeLineList[0].eventLayers[0].moveXEvents[1];close(trajectoryEventValue(edited,0,'y'),value+50);close(trajectoryEventValue(edited,1,'y'),trajectoryEventValue(parts[1],1,'y'));
  const expanded=expandTrajectory(edited,tempo,1,{simplify:false});const track=new EventTrack(expanded.get('moveYEvents'),tempo);for(let i=0;i<=50;i++)close(track.value(tempo.seconds(3+i/50*5)),trajectoryEventValue(edited,i/50,'y'),.2);
});
test('缺少某属性时建立正时长事件；过期来源、零时长和重叠时间修改拒绝',()=>{
  const{chart,tempo}=fixture(),node={lineIndex:0,beat:4};const prepared=ensureSpatialProperty(chart,tempo,node,'scaleXEvents');assert.ok(prepared.source.event.endTime[0]>prepared.source.event.startTime[0]);
  const source=spatialSources(chart.judgeLineList[0],0,tempo).find(s=>s.type==='moveXEvents'&&s.field==='end');assert.throws(()=>changeSpatialSource(chart,tempo,{...source,event:{}},{value:3}));assert.throws(()=>changeSpatialSource(chart,tempo,source,{time:0}));
});
test('尾节点缺少另一轴事件时补在同一侧，可编辑且保留小数精度',()=>{
  const{chart,tempo}=fixture();chart.judgeLineList[0].eventLayers[0].moveXEvents=[createEvent(0,100,0,4),createEvent(100,200,4,8)];
  const x=spatialSources(chart.judgeLineList[0],0,tempo).find(s=>s.type==='moveXEvents'&&s.field==='end'&&s.beat===4),prepared=ensureSpatialProperty(chart,tempo,{lineIndex:0,beat:4,field:'end'},'moveYEvents');
  assert.equal(prepared.source.field,'end');assert.equal(tempo.beat(tempo.seconds(prepared.source.event.endTime)),4);
  const next=changeSpatialPosition(prepared.chart,tempo,[x,prepared.source],{x:123.456789,y:45.678912},{x:1,y:1},{continuous:true});
  const scene=new TransformScene();scene.compile(next,tempo);const state=scene.sampler(tempo.seconds(4)-1e-8)(0);close(state.x,123.456789,1e-6);close(state.y,45.678912,1e-6);
  assert.notEqual(next.judgeLineList[0].eventLayers[0].moveXEvents[0].end,123.5);
});
test('编辑后的轨迹原生保存重开不丢失，RPE兼容导出包含裁切与端点修改',()=>{
  const{chart,tempo}=fixture(),event=createTrajectoryEvent({xExpression:'300*cos(2*pi*t)',yExpression:'100*sin(2*pi*t)'},[0,0,1],[8,0,1],512);chart.judgeLineList[0].eventLayers[0].moveXEvents=[event];
  const split=insertSpatialNode(chart,tempo,{lineIndex:0,layer:0,type:'moveXEvents',beat:3}),source=spatialSources(split.judgeLineList[0],0,tempo).find(s=>s.beat===3&&s.field==='start'&&s.axis==='y'),edited=changeSpatialSource(split,tempo,source,{value:spatialSourceValue(source)+50});
  const reopened=parseChart(serializeChart(edited));assert.equal(reopened.META.RPEVersion,251);const legacy=legacyChart(reopened,{simplify:false,segments:512}),a=new SceneRuntime(),b=new SceneRuntime();a.compile(reopened,tempo);b.compile(legacy,tempo);for(let i=0;i<=100;i++){const first=a.sample(i/25)[0],second=b.sample(i/25)[0];close(first.x,second.x,.05);close(first.y,second.y,.05);}
});
test('删除中间节点连接前后区间，XY绑定同行另一轴一并处理',()=>{
  const{chart,tempo}=fixture();for(const type of ['moveXEvents','moveYEvents'])chart.judgeLineList[0].eventLayers[0][type]=[createEvent(0,100,0,4),createEvent(100,200,4,8)];const source=spatialSources(chart.judgeLineList[0],0,tempo).find(s=>s.type==='moveXEvents'&&s.field==='start'&&s.beat===4);const next=deleteSpatialNode(chart,source,{xyBinding:true});for(const type of ['moveXEvents','moveYEvents']){assert.equal(next.judgeLineList[0].eventLayers[0][type].length,1);assert.equal(next.judgeLineList[0].eventLayers[0][type][0].end,200);}
});
