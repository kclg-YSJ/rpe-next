import test from 'node:test';
import assert from 'node:assert/strict';
import { SpatialLineStateStore,spatialLineState } from '../src/platform/spatial-line-state.mjs';
import { MultiLineStateStore } from '../src/platform/multi-line-state.mjs';
import { EditorSession } from '../src/application/session.mjs';
import { createChart,createLine,createEvent } from '../src/core/chart.mjs';
import { SpatialTracks } from '../src/core/spatial-track.mjs';
import { TempoMap } from '../src/core/tempo.mjs';

const makeSession=(count=5)=>{const chart=createChart();chart.judgeLineList=Array.from({length:count},()=>createLine());return new EditorSession(chart);};
const storage=()=>{const values=new Map(),writes=[];return{values,writes,getItem:key=>values.get(key)??null,setItem:(key,value)=>{values.set(key,value);writes.push([key,value]);}};};
test('空间列表默认关闭，与多线列表、模式和合并状态完全独立',()=>{
  const disk=storage(),session=makeSession(),multi=new MultiLineStateStore(disk),spatial=new SpatialLineStateStore(disk);multi.attach(session,'A');spatial.attach(session,'A');
  assert.deepEqual(spatialLineState(session),{enabled:false,indices:[],expression:''});session.setMultiLineEnabled(true,'events');session.addMultiLine(3);session.setMultiLineMerge(false);const original=[...session.multiLineIndices];
  session.spatialLineState={enabled:true,indices:[1,4],expression:''};spatial.capture();assert.deepEqual(session.multiLineIndices,original);assert.equal(session.multiLineMode,'events');assert.equal(session.multiLineMerge,false);
  session.clearMultiLines();assert.deepEqual(spatialLineState(session),{enabled:true,indices:[1,4],expression:''});assert.equal(session.history.dirty,false);
  assert.ok([...disk.values.keys()].some(key=>key.includes('spatial-lines')));assert.ok([...disk.values.keys()].some(key=>key.includes('multi-line')));
});
test('空间列表按谱面保存，首次保存更换项目ID、重开和副本回退均保留独立状态',()=>{
  const disk=storage(),store=new SpatialLineStateStore(disk),a=makeSession();store.attach(a,'new');a.spatialLineState={enabled:true,indices:[1,3],expression:''};store.capture();store.rekey('A');
  const b=makeSession();store.attach(b,'B');b.spatialLineState={enabled:false,indices:[2,4],expression:''};store.capture();store.detach();
  const reopened=makeSession();store.attach(reopened,'A',{enabled:false,indices:[0]});assert.deepEqual(spatialLineState(reopened),{enabled:true,indices:[1,3],expression:''});
  store.attach(makeSession(),'B');assert.deepEqual(spatialLineState(store.session),{enabled:false,indices:[2,4],expression:''});store.attach(makeSession(),'copy',{enabled:true,indices:[1,3]});assert.deepEqual(store.session.spatialLineState.indices,[1,3]);
});
test('空列表、表达式与开关可恢复，动态结果不逐帧写盘，普通谱面修改不重复写盘',()=>{
  const disk=storage(),store=new SpatialLineStateStore(disk),session=makeSession();store.attach(session,'A',{enabled:true,indices:[1],expression:'@notes'});const writes=disk.writes.length;
  session.spatialLineState.indices=[2,4];session.notify();session.spatialLineState.indices=[];session.notify();assert.equal(disk.writes.length,writes);
  session.spatialLineState={enabled:true,indices:[],expression:''};session.notify();store.detach();store.attach(makeSession(),'A');assert.deepEqual(spatialLineState(store.session),{enabled:true,indices:[],expression:''});
  const stable=disk.writes.length;store.session.notify();store.session.notify();assert.equal(disk.writes.length,stable);
});
test('损坏数据、无效表达式、线数缩减和存储失败不破坏编辑会话',()=>{
  const disk=storage();disk.values.set('rpe-next-project-spatial-lines-v1:bad','{broken');const store=new SpatialLineStateStore(disk),session=makeSession(3);store.attach(session,'bad',{enabled:true,indices:[1,2,99,-1,1],expression:'missing-group'});assert.deepEqual(spatialLineState(session),{enabled:true,indices:[1,2],expression:''});
  session.history.document={...session.chart,judgeLineList:session.chart.judgeLineList.slice(0,2)};session.notify();assert.deepEqual(session.spatialLineState.indices,[1]);
  const errors=[],failed=new SpatialLineStateStore({getItem:()=>null,setItem(){throw Error('quota');}},e=>errors.push(e.message));failed.attach(makeSession(),'bad');failed.session.spatialLineState={enabled:true,indices:[2],expression:''};failed.capture();assert.deepEqual(failed.session.spatialLineState.indices,[2]);assert.ok(errors.includes('quota'));assert.equal(failed.session.history.dirty,false);
});
test('强制曲线不透明时包含原本完全透明的区间，关闭后仍沿用原缓存和事件值',()=>{
  const chart=createChart(),line=chart.judgeLineList[0];line.eventLayers[0].alphaEvents=[createEvent(0,0,0,16)];const snapshot=JSON.stringify(chart),tempo=new TempoMap(chart.BPMList),tracks=new SpatialTracks();tracks.compile(chart,tempo);
  const hidden=tracks.block(0,0,4),opaque=tracks.block(0,0,4,.7,{includeTransparent:true});assert.equal(hidden.points.length,0);assert.ok(opaque.points.length>0);assert.ok(opaque.points.every(pair=>pair.every(point=>point.alpha===0)));assert.equal(tracks.block(0,0,4),hidden);assert.equal(JSON.stringify(chart),snapshot);
});
