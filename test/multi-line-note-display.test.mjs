import test from 'node:test';
import assert from 'node:assert/strict';
import { NoteDisplayIndex } from '../src/core/note-display-index.mjs';
import { EditorNotePainter } from '../src/ui/editor-note-painter.mjs';
import { ResourceNoteSkin } from '../src/ui/resource-note-skin.mjs';
import { RpeSkin } from '../src/ui/skin.mjs';
import { createNote, createChart, createLine } from '../src/core/chart.mjs';
import { EditorSession } from '../src/application/session.mjs';
import { Timeline } from '../src/ui/timeline.mjs';
import { TempoMap } from '../src/core/tempo.mjs';

function context() {
  const calls=[];const result={calls,globalAlpha:1};
  for(const method of ['save','restore','translate','scale','drawImage'])result[method]=(...args)=>calls.push({method,args});
  return result;
}

test('多线音符索引保留原数组绘制次序、跨屏 Hold 和相同拍的首尾边界',()=>{
  const notes=[createNote(1,5,0),createNote(2,0,0,8),createNote(1,3,0),createNote(2,3,0,3)];
  const index=new NoteDisplayIndex(notes);
  assert.deepEqual(index.inSourceOrder(3,5).map(entry=>entry.index),[0,1,2,3]);
  const stable=index.inSourceOrder(3.1,4.9);assert.deepEqual(stable.map(entry=>entry.index),[1]);
  index.query=()=>assert.fail('活动集合未变化时不重新查询或排序');assert.equal(index.inSourceOrder(3.2,4.8),stable);
  const backwards=new NoteDisplayIndex([createNote(2,8,0,2)]);assert.deepEqual(backwards.inSourceOrder(3,4).map(entry=>entry.index),[0]);
});

test('音符显示索引在编辑、撤销和列表长度变化后刷新',()=>{
  const session=new EditorSession(),canvas={style:{},clientWidth:600,clientHeight:600,addEventListener(){}};
  const timeline=new Timeline(canvas,canvas,()=>session,()=>{},()=>{});timeline.refreshIndex();const first=timeline.noteIndexes.get(0).index;
  session.insertNotes([createNote(1,4,0)]);timeline.refreshIndex();const next=timeline.noteIndexes.get(0).index;assert.notEqual(first,next);assert.equal(next.inSourceOrder(4,4).length,1);
  session.travel('undo');timeline.refreshIndex();assert.equal(timeline.noteIndexes.get(0).index.entries.length,0);
  session.chart.judgeLineList[0].notes.push(createNote(1,2,0));timeline.refreshIndex();assert.equal(timeline.noteIndexes.get(0).index.inSourceOrder(2,2).length,1);
  session.history.document={...session.chart,judgeLineList:[createLine(),createLine()]};timeline.refreshIndex(1);assert.equal(timeline.noteIndexes.has(0),false,'new chart releases stale note arrays');
});

test('音符秒数缓存跟随 BPM 和所属线倍率，不逐帧重复转换拍数',()=>{
  const tempo=new TempoMap([{bpm:120,startTime:[0,0,1]},{bpm:180,startTime:[4,0,1]}]),index=new NoteDisplayIndex([createNote(2,2,0,8)]);
  index.timeMapping(tempo,2);const entry=index.entries[0];assert.equal(entry.seconds,tempo.seconds(2,2));assert.equal(entry.endSeconds,tempo.seconds(8,2));
  const seconds=tempo.seconds;tempo.seconds=()=>assert.fail('不重复换算');index.timeMapping(tempo,2);tempo.seconds=seconds;
  index.timeMapping(tempo,.5);assert.equal(entry.seconds,tempo.seconds(2,.5));
  const next=new TempoMap([{bpm:90,startTime:[0,0,1]}]);index.timeMapping(next,.5);assert.equal(entry.endSeconds,next.seconds(8,.5));
});

test('预备皮肤布局保留原生图集采样、零长度和紧凑头尾，重复音符复用布局',()=>{
  const picture={naturalWidth:40,naturalHeight:200};let sources=0;
  const pack={info:{holdAtlas:[20,30],holdAtlasMH:[25,35],holdCompact:true},noteScale:highlight=>highlight?1.3:1,source:()=>{sources++;return picture;}};
  const skin={resourcePack:pack,noteBatchCompatible:true},painter=new EditorNotePainter();
  for(const highlight of[false,true])for(const length of[0,.25,70]){
    const expected=context(),actual=context();painter.begin(skin,actual,600,600);
    ResourceNoteSkin.prototype.hold.call(pack,expected,200,300,300-length,80,highlight,true,[255,255,255],60);
    assert.equal(painter.draw(actual,2,200,300,300-length,80,highlight,[255,255,255],5,60),true);assert.deepEqual(actual.calls,expected.calls);
  }
  const calls=sources,target=context();painter.draw(target,2,200,300,230,80,true,[255,255,255],5,60);assert.equal(sources,calls);
  assert.equal(painter.draw(target,2,200,200,300,80,false,null,5,60),false,'reverse textures retain the native path');
});

test('默认皮肤的着色 Canvas 仍按原图宽高绘制，屏幕外头尾不提交且大音符不被截断',()=>{
  const image=(width,height)=>({naturalWidth:width,naturalHeight:height}),skin=new RpeSkin(()=>{});
  skin.images=new Map([['Hold3',image(40,100)],['HoldHead',image(60,20)],['HoldEnd',image(50,15)],['Tap2',image(70,20)]]);
  skin.tinted=name=>{const original=skin.images.get(name);return original?{width:original.naturalWidth,height:original.naturalHeight}:null;};
  for(const color of[[255,255,255],[40,180,210]]){
    const expected=context(),actual=context(),painter=new EditorNotePainter();painter.begin(skin,actual,600,600);
    skin.hold(expected,200,300,230,80,false,true,color,60);painter.draw(actual,2,200,300,230,80,false,color,5,60);assert.deepEqual(actual.calls,expected.calls);
    const headExpected=context(),headActual=context();skin.head(headExpected,1,200,300,80,false,color,5,60);painter.draw(headActual,1,200,300,0,80,false,color,5,60);assert.deepEqual(headActual.calls,headExpected.calls);
  }
  const target=context(),painter=new EditorNotePainter();painter.begin(skin,target,600,600);painter.draw(target,2,200,2000,-2000,80,false,null,5,60);
  assert.equal(target.calls.filter(call=>call.method==='drawImage').length,1,'visible body survives, wholly offscreen caps are omitted');
  target.calls.length=0;painter.draw(target,1,-500,300,0,2000,false,null,5,60);assert.ok(target.calls.some(call=>call.method==='drawImage'),'oversized sprite can overlap the viewport from outside');
  assert.equal(painter.begin({...skin,noteBatchCompatible:false},target,600,600),null);
});

test('多线索引只处理可见对象，同时保留从可见区外拖入的选中音符',()=>{
  const chart=createChart();chart.judgeLineList=[createLine(),createLine()];chart.judgeLineList[0].notes=[createNote(1,100,0),createNote(1,1,0)];
  const session=new EditorSession(chart);session.multiLineIndices=[0,1];session.setMultiLineEnabled(true,'notes');session.multiLineSelection.set(0,new Set([0]));
  const calls=[],ctx=new Proxy({save(){},restore(){}},{get:(target,key)=>target[key]??(()=>{})}),canvas={style:{},clientWidth:600,clientHeight:600,addEventListener(){}};
  const timeline=new Timeline(canvas,canvas,()=>session,()=>{},()=>{});timeline.skin={head:(context,type,x,y)=>{calls.push(y);return true;},noteScale:()=>1};timeline.origin=0;
  timeline.drawMultiLineNotes(ctx,600,600);assert.equal(calls.length,1);
  timeline.drag={kind:'move',lineIndex:0};timeline.movedNote=note=>({...note,startTime:[1,0,1],endTime:[1,0,1]});calls.length=0;
  timeline.drawMultiLineNotes(ctx,600,600);assert.equal(calls.length,2);
});
