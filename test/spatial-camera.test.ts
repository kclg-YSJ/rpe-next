import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore the built-in mod is still a JavaScript module in this mid-merge tree
import { PlaneCamera, cameraBasis, DEFAULT_POSE, DEFAULT_FOV, orbitPose, poseValues, valueDraft } from '../assets/mods/spatial-camera/camera.mjs';
import { previewViewport } from '../src/core/editor-display.ts';
import { pickGuide } from '../src/core/preview-guides.ts';
import type { LineGuide } from '../src/core/preview-guides.ts';
// @ts-ignore see above
import { cameraFollowsChart, withCameraFollow } from '../assets/mods/spatial-camera/settings.mjs';
// @ts-ignore see above
import { observerCamera, screenAxisDelta, lookAtOrigin, cameraFrustum } from '../assets/mods/spatial-camera/scene.mjs';
import { createChart, serializeChart, parseChart } from '../src/core/chart.ts';

const view=(width: number=1000,height: number=700,divisor: number=1,ratio: number=1.5)=>{const viewport=previewViewport(width,height,ratio);return{width,height,viewport,scale:viewport.scale/divisor};};
const near=(actual: number,expected: number,tolerance: number=1e-7): void=>assert.ok(Math.abs(actual-expected)<tolerance,`${actual} != ${expected}`);

test('摄像机跟随选项属于各谱面，默认关闭且随有来源的全局数据保存',()=>{
  const a=createChart(),b=createChart(),manifest={id:'spatial-camera',name:'三维摄像机',author:'rpe-next',version:'1.0.0'};
  const changed=withCameraFollow(a,manifest,true);assert.equal(cameraFollowsChart(changed),true);assert.equal(cameraFollowsChart(a),false);assert.equal(cameraFollowsChart(b),false);assert.equal(withCameraFollow(a,manifest,false),a);
  const parsed=parseChart(serializeChart(changed));assert.equal(cameraFollowsChart(parsed),true);assert.equal(parsed.globalEvents!.types['spatial-camera/lens'].source.id,manifest.id);assert.deepEqual(parsed.globalEvents!.types['spatial-camera/lens'].columns.fov.events,[]);assert.ok(parsed.META.RPEVersion>=240);
  assert.equal(cameraFollowsChart(withCameraFollow(parsed,manifest,false)),false);assert.equal(cameraFollowsChart(parsed),true);
});

test('三维编辑器的观察相机、轴拖动和朝向谱面中心均使用独立的空间坐标',()=>{
  const observer=observerCamera({yaw:-35,pitch:-24,distance:2450,target:[0,0,350]},800,500);assert.ok(observer.project({x:0,y:0,z:350}));
  near(screenAxisDelta(20,10,{x:10,y:10},{x:110,y:60},200),40);
  for(const source of [{...DEFAULT_POSE,x:500,y:100},{...DEFAULT_POSE,z:-1000,x:-400}]){const pose=lookAtOrigin(source),camera=new PlaneCamera(pose,view()),center=camera.project({x:0,y:0,z:0});near(center.x,500);near(center.y,350);const shape=cameraFrustum(pose);assert.equal(shape.corners.length,4);for(const corner of shape.corners)near(camera.cameraPoint(corner).depth,260);}
});

test('摄像机默认透视与原平面完全同坐标，保持缩放与不同预览比例',()=>{
  for(const shape of [[1000,700,1,1.5],[800,1000,1.4,.5625],[900,500,.7,2.4]] as [number,number,number,number][]){
    const frame=view(...shape),camera=new PlaneCamera(DEFAULT_POSE,frame);
    for(const point of [{x:0,y:0},{x:400,y:200},{x:-700,y:-480}]){const target=camera.project(point);near(target.x,frame.width/2+point.x*frame.scale);near(target.y,frame.height/2-point.y*frame.scale);const inverse=camera.planeAt(target.x,target.y);near(inverse.x,point.x);near(inverse.y,point.y);}
  }
});

test('自由位置、朝向、距离与焦距使用同一投影，环绕位置始终看向原点',()=>{
  const frame=view(),origin={x:0,y:0};const normal=new PlaneCamera(DEFAULT_POSE,frame).project({x:200,y:0});
  const closer=new PlaneCamera({...DEFAULT_POSE,z:500},frame).project({x:200,y:0});near(closer.x-frame.width/2,(normal.x-frame.width/2)*2);
  const shifted=new PlaneCamera({...DEFAULT_POSE,x:100,y:50},frame).project(origin);near(shifted.x,frame.width/2-100*frame.scale);near(shifted.y,frame.height/2+50*frame.scale);
  const rolled=new PlaneCamera({...DEFAULT_POSE,roll:90},frame).project({x:200,y:0});near(rolled.x,frame.width/2);near(rolled.y,frame.height/2+200*frame.scale);
  for(const yaw of [-55,-20,0,40])for(const pitch of [-40,0,25]){const camera=new PlaneCamera(orbitPose(yaw,pitch),frame),center=camera.project(origin);near(center.x,frame.width/2);near(center.y,frame.height/2);const point={x:123,y:-67},target=camera.project(point),inverse=camera.planeAt(target.x,target.y);near(inverse.x,point.x);near(inverse.y,point.y);}
  const wide=new PlaneCamera({...DEFAULT_POSE,fov:DEFAULT_FOV+20},frame).project({x:200,y:0});assert.ok(wide.x<normal.x);
});

test('相机旋转基底正交归一，近远裁剪在投影前完成，后向相机不会显示背后几何',()=>{
  const basis=cameraBasis({yaw:28,pitch:-37,roll:19}),vectors=Object.values(basis) as number[][];for(const vector of vectors)near(Math.hypot(...vector),1);for(let a=0;a<3;a++)for(let b=a+1;b<3;b++)near(vectors[a].reduce((sum,value,index)=>sum+value*vectors[b][index],0),0);
  const camera=new PlaneCamera({...DEFAULT_POSE,yaw:80,z:50},view()),points=camera.clip([{x:-1000,y:-20},{x:1000,y:-20},{x:1000,y:20},{x:-1000,y:20}]);assert.ok(points.length>=3);for(const point of points)assert.ok(camera.cameraPoint(point).depth>=camera.near-1e-8);
  for(const point of points)assert.ok(camera.project(point));
  const back=new PlaneCamera({...DEFAULT_POSE,yaw:180},view());assert.equal(back.project({x:0,y:0}),null);assert.equal(back.bounds(),null);
});

test('摄像机的精确二维路径与投影同坐标，并保留线段及跨近裁面多边形',()=>{
  const raw={width:2000,height:1400,center:{x:3500,y:-800}},frame=view();
  for(const pose of [{...DEFAULT_POSE,x:3500,y:-800,z:1300,roll:31},{...DEFAULT_POSE,z:-1000,yaw:180,roll:-20}]){
    const camera=new PlaneCamera(pose,frame),m=camera.affine(raw);assert.ok(m);
    for(const point of [{x:3500,y:-800},{x:-200,y:300}]){const x=raw.width/2+point.x-raw.center.x,y=raw.height/2-point.y+raw.center.y,p=camera.project(point);near(m[0]*x+m[2]*y+m[4],p.x);near(m[1]*x+m[3]*y+m[5],p.y);}
  }
  const camera=new PlaneCamera({...DEFAULT_POSE,yaw:80,z:50},frame);assert.equal(camera.affine(raw),null);const segment=camera.clip([{x:-1000,y:0},{x:1000,y:0}]);assert.equal(segment.length,2);for(const point of segment)assert.ok(camera.project(point));const inside=[{x:0,y:0},{x:50,y:0}];assert.equal(camera.clip(inside),inside);
});

test('透视判定线命中使用非对称端点，标记仍可位于真正的线中心',()=>{
  const guide={index:2,x:140,y:100,rotation:0,halfWidth:150,segment:[{x:100,y:100},{x:400,y:100}]} as unknown as LineGuide;
  assert.equal(pickGuide([guide],{x:390,y:103},-1),2);assert.equal(pickGuide([guide],{x:70,y:100},-1),null);
});

test('世界捕获窗口跟随远处摄像机，近地平线仍使用有限预算',()=>{
  const camera=new PlaneCamera({...DEFAULT_POSE,x:10000,y:-4000,z:1600},view()),bounds=camera.bounds();assert.ok(bounds.left<10000&&bounds.left+bounds.width>10000);assert.ok(bounds.bottom<-4000&&bounds.bottom+bounds.height>-4000);
  for(const pose of [{...DEFAULT_POSE,pitch:89},{...DEFAULT_POSE,yaw:88},orbitPose(30,-40)]){const bounds=new PlaneCamera(pose,view()).bounds();if(bounds){assert.ok(Object.values(bounds).filter(value=>typeof value==='number').every(Number.isFinite));assert.ok(bounds.width<=80000&&bounds.height<=80000);}}
  const reverse=new PlaneCamera({...DEFAULT_POSE,z:-1000,yaw:180},view()),point={x:120,y:80},projected=reverse.project(point),inverse=reverse.planeAt(projected.x,projected.y);near(inverse.x,point.x);near(inverse.y,point.y);
  assert.equal(poseValues({z:-100000,fov:999}).z,-50000);assert.equal(poseValues({z:-1,fov:999}).fov,150);
});

test('摄像机拖拽草稿只修改目标事件和钩定端点，原谱和其他数据不变',()=>{
  const source={globalEvents:{version:1,types:{'spatial-camera/rotation':{source:{id:'spatial-camera'},columns:{yaw:{events:[{startTime:[0,0,1],endTime:[2,0,1],start:0,end:20,inst:1}]},pitch:{events:[]}}}}},judgeLineList:[]};const before=structuredClone(source);
  const draft=valueDraft(source,'spatial-camera/rotation','yaw',0,'end',42);assert.equal(draft.globalEvents.types['spatial-camera/rotation'].columns.yaw.events[0].start,42);assert.equal(draft.globalEvents.types['spatial-camera/rotation'].columns.yaw.events[0].end,42);assert.equal(draft.judgeLineList,source.judgeLineList);assert.equal(draft.globalEvents.types['spatial-camera/rotation'].columns.pitch,source.globalEvents.types['spatial-camera/rotation'].columns.pitch);assert.deepEqual(source,before);assert.throws(()=>valueDraft(source,'spatial-camera/position','x',0,'start',1),/不存在/);
});
