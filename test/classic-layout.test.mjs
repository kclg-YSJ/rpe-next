import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EditorSession } from '../src/application/session.mjs';
import { Timeline } from '../src/ui/timeline.mjs';
import { BatchControls } from '../src/ui/batch-controls.mjs';
import { TempoMap } from '../src/core/tempo.mjs';
import { createEvent } from '../src/core/chart.mjs';
import { transformEvents } from '../src/application/event-commands.mjs';
import { withEventLock } from '../src/application/event-value-memory.mjs';
import { registerModHook } from '../src/core/mod-hooks.mjs';

// Match the host's @rpen import root while importing the real bundled modules.
async function moduleUrl(name,imports={}){
  let source=await readFile(new URL('../assets/mods/rpe-classic-layout/'+name,import.meta.url),'utf8');
  source=source.replace(/from '([^']+)'/g,(all,id)=>imports[id]?`from ${JSON.stringify(imports[id])}`:id.startsWith('@rpen/')?`from ${JSON.stringify(new URL('../src/'+id.slice(6),import.meta.url).href)}`:all);
  return 'data:text/javascript,'+encodeURIComponent(source);
}
const {installGeometry}=await import(await moduleUrl('geometry.mjs'));
const {installModeGeometry}=await import(await moduleUrl('mode-geometry.mjs',{'./geometry.mjs':await moduleUrl('geometry.mjs')}));
const {installEasingDraft}=await import(await moduleUrl('easing-draft.mjs'));
function apiFor(editor){const cleanups=[];return{editor,patch(target,key,wrap){const descriptor=Object.getOwnPropertyDescriptor(target,key);target[key]=wrap(target[key]);cleanups.push(()=>{if(descriptor)Object.defineProperty(target,key,descriptor);else delete target[key];});},hook(name,callback,priority){cleanups.push(registerModHook(name,callback,priority));},dispose(fn){cleanups.push(fn);},close(){for(const fn of cleanups.reverse())fn();}};}

test('经典布局所有控制球的时间换算与实际网格一致，停用恢复本体映射',()=>{
  const session=new EditorSession(),canvas={clientHeight:900,clientWidth:675};
  const timeline=Object.assign(Object.create(Timeline.prototype),{notesCanvas:canvas,eventsCanvas:canvas,getSession:()=>session,eventInteraction:{},tempo:new TempoMap(session.chart.BPMList),scale:180,division:4,origin:0});
  const controls={timeline,snappedPointerBeat:BatchControls.prototype.snappedPointerBeat},original=controls.snappedPointerBeat;
  const api=apiFor({timeline,batchControls:controls}),state={active:true,scale:.75};
  installGeometry(api,state);installModeGeometry(api,state);
  assert.equal(timeline.vertical(2)-timeline.vertical(3),67.5);
  assert.equal(controls.snappedPointerBeat({y:300-67.5},canvas,0)-controls.snappedPointerBeat({y:300},canvas,0),1);
  state.scale=1;assert.equal(controls.snappedPointerBeat({y:210},canvas,0)-controls.snappedPointerBeat({y:300},canvas,0),1);
  api.close();assert.equal(controls.snappedPointerBeat,original);
});

test('经典缓动草稿提交保留尾值记忆，一次撤销；取消不改数据或端点记忆',()=>{
  const session=new EditorSession();session.line.eventLayers[0].moveXEvents=[createEvent(10,20,2,3)];session.eventSelection=new Set(['moveXEvents:0']);
  const editor={session,timeline:{draw(){},drawEvents(){},getSession:()=>session},invalidate(){}},api=apiFor(editor),draft=installEasingDraft(api);
  try{
    transformEvents(session,'end',event=>({...event,end:99}),{valueField:'end'});
    const before=session.chart,count=session.history.undoStack.length;
    draft.update(()=>transformEvents(session,'easing',event=>({...event,easingType:5})));
    assert.equal(session.chart,before);draft.finish(true);
    let event=session.line.eventLayers[0].moveXEvents[0];assert.equal(event.easingType,5);assert.equal(withEventLock(session,event,true).start,99);assert.equal(session.history.undoStack.length,count+1);
    const saved=session.chart;draft.update(()=>transformEvents(session,'easing',event=>({...event,easingType:9})));draft.finish(false);
    assert.equal(session.chart,saved);event=session.line.eventLayers[0].moveXEvents[0];assert.equal(withEventLock(session,event,true).start,99);
    session.travel('undo');assert.equal(session.line.eventLayers[0].moveXEvents[0].easingType,1);assert.equal(withEventLock(session,session.line.eventLayers[0].moveXEvents[0],true).start,99);
  }finally{api.close();}
});
