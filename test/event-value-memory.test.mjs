import test from 'node:test';
import assert from 'node:assert/strict';
import { EVENT_VALUE_MEMORY_LIMIT, rememberEventValueChange, copyEventValueMemory, withEventLock, hasEventValueMemory } from '../src/application/event-value-memory.mjs';
import { EditorSession } from '../src/application/session.mjs';
import { createChart, createLine, createEvent, serializeChart } from '../src/core/chart.mjs';
import { transformEvents, toggleSingleEventLock, eventListAt } from '../src/application/event-commands.mjs';
import { captureSelection, editCapturedSelection, commitSelectionEdit } from '../src/application/batch-edit.mjs';
import { GlobalEventDocument } from '../src/application/global-events.mjs';
import { GlobalEventRegistry, registerPlaceholderGlobalEvent } from '../src/core/global-events.mjs';
import { NoiseAreaEditor } from '../src/ui/noise-area.mjs';
import { createNoiseArea, createNoiseEvent, withNoiseAreas } from '../src/core/noise-areas.mjs';

function fixture(multi = false, type = 'moveXEvents') {
  const chart = createChart(); chart.judgeLineList.push(createLine());
  const session = new EditorSession(chart), line = multi ? 1 : 0;
  const values = type === 'textEvents' ? ['a', 'b'] : type === 'colorEvents' ? [[10,20,30],[40,50,60]] : [10,20];
  if (type === 'textEvents' || type === 'colorEvents') session.chart.judgeLineList[line].extended[type] = [createEvent(...values, 1, 2)];
  else session.chart.judgeLineList[line].eventLayers[0][type] = [createEvent(...values, 1, 2)];
  session.focus = 'events';
  if (multi) { session.multiLineEnabled = true; session.multiLineMode = 'events'; session.multiLineIndices = [0,1]; session.multiEventSelection = new Map([[1,new Set([`${type}:0`])]]); }
  else session.eventSelection = new Set([`${type}:0`]);
  return { session, read: () => eventListAt(session, line, type)[0] };
}

test('钩定采用最近实际修改的端点，普通和非当前线快捷键一致；撤销重做保留原事件', () => {
  for (const multi of [false, true]) {
    const { session, read } = fixture(multi);
    transformEvents(session, '尾值', event => ({ ...event, end: 99 }), { valueField: 'end' });
    const edited = read(); toggleSingleEventLock(session);
    assert.deepEqual([read().start,read().end,read().inst], [99,99,1]);
    session.travel('undo'); assert.equal(read(),edited);
    session.travel('redo'); assert.deepEqual([read().start,read().end], [99,99]);
    session.travel('undo');
    transformEvents(session, '首值', event => ({ ...event, start: 25 }), { valueField: 'start' });
    toggleSingleEventLock(session); assert.deepEqual([read().start,read().end], [25,25]);
    assert.equal(session.chart.judgeLineList[multi?0:1].eventLayers[0].moveXEvents[0].start,0);
  }
});

test('只改时间/缓动、重新选中、无改值确认和批量时间拖动不会覆盖最近端点', () => {
  const { session, read } = fixture();
  transformEvents(session, '尾值', event => ({ ...event, end: 90 }), { valueField: 'end' });
  transformEvents(session, '只确认首值', event => ({ ...event, start: event.start }), { valueField: 'start' });
  transformEvents(session, '缓动', event => ({ ...event, easingType: 5 }));
  const result = editCapturedSelection(captureSelection(session), { event: event => ({ ...event, startTime:[2,0,1], endTime:[3,0,1] }) });
  commitSelectionEdit(session, result, '时间拖动');
  session.eventSelection = new Set(['moveXEvents:0']);
  toggleSingleEventLock(session); assert.deepEqual([read().start,read().end], [90,90]);
});

test('特殊事件的文字/颜色采用最近端点，拷贝隔离原数组，默认仍以首值为准', () => {
  for (const type of ['textEvents','colorEvents']) {
    const { session, read } = fixture(false,type), next = type==='textEvents'?'changed':[70,80,90];
    transformEvents(session,'尾值',event=>({...event,end:next}),{valueField:'end'});
    toggleSingleEventLock(session); assert.deepEqual(read().start,next); assert.deepEqual(read().end,next);
    if(Array.isArray(next)){assert.notEqual(read().start,read().end);assert.notEqual(read().start,next);}
  }
  const { session,read } = fixture(); toggleSingleEventLock(session); assert.deepEqual([read().start,read().end],[10,10]);
});

test('记录不进文件，不跨会话或误用于重排后的其他事件；旧记录有固定上限', () => {
  const owner = {}, base=createEvent(10,20), edited={...base,end:99};
  rememberEventValueChange(owner,base,edited,'end',{type:'moveXEvents',index:0,base:{private:true}});
  assert.equal(withEventLock(owner,edited,true).start,99);
  assert.equal(withEventLock({},edited,true).start,10);
  assert.equal(withEventLock(owner,{...edited},true).start,10);
  for(let i=0;i<EVENT_VALUE_MEMORY_LIMIT;i++)rememberEventValueChange(owner,base,{...base,end:1000+i},'end',{index:i});
  assert.equal(withEventLock(owner,edited,true).start,10);
  const {session,read}=fixture();transformEvents(session,'尾值',e=>({...e,end:99}),{valueField:'end'});
  const text=serializeChart(session.chart); assert.doesNotMatch(text,/valueMemory|lastField|recentValue|private/);
  assert.equal(hasEventValueMemory(new EditorSession(session.chart)),false);
  assert.equal(withEventLock(new EditorSession(session.chart),read(),true).start,10);
});

test('列克隆只访问最多32个记录位置，无整列遍历，也不读取谱面或建立计时器', () => {
  const owner = { get chart(){throw Error('Must not inspect the chart');} }, before=[], after=[];
  for(let index=0;index<EVENT_VALUE_MEMORY_LIMIT;index++){
    const source=createEvent(1,2),event={...source,end:100+index};before[index]=event;after[index]=structuredClone(event);
    rememberEventValueChange(owner,source,event,'end',{type:'moveXEvents',index});
  }
  let reads=0,writes=0;
  copyEventValueMemory(owner,({index})=>{reads++;return before[index];},({index})=>{writes++;return after[index];});
  assert.ok(reads<=EVENT_VALUE_MEMORY_LIMIT);assert.ok(writes<=EVENT_VALUE_MEMORY_LIMIT);
  for(let index=0;index<EVENT_VALUE_MEMORY_LIMIT;index++)assert.equal(withEventLock(owner,after[index],true).start,100+index);
});

test('全局列克隆和编辑其他事件不会丢掉已编辑端点，撤销不写入模板或其他会话', () => {
  const registry=new GlobalEventRegistry();registerPlaceholderGlobalEvent(registry);const session=new EditorSession(),document=new GlobalEventDocument(registry,()=>session);
  document.apply([{type:'rpen/placeholder',column:'value',events:[createEvent(1,2,0,1),createEvent(3,4,2,3)]}]);
  const key=document.columns[0].key,editor=document.editor,read=index=>eventListAt(editor,0,key)[index];
  editor.eventSelection=new Set([`${key}:0`]);transformEvents(editor,'尾值',e=>({...e,end:88}),{valueField:'end'});
  editor.eventSelection=new Set([`${key}:1`]);transformEvents(editor,'另一个事件',e=>({...e,start:9}),{valueField:'start'});
  editor.eventSelection=new Set([`${key}:0`]);toggleSingleEventLock(editor);assert.deepEqual([read(0).start,read(0).end],[88,88]);
  session.travel('undo');assert.deepEqual([read(0).start,read(0).end],[1,88]);
});

test('噪域端点记录跟随合法草稿，编辑其他事件不会覆盖，非法输入不记入且钩定可撤销',()=>{
  const area=createNoiseArea(0,8);area.moveXEvents=[createNoiseEvent(10,20,0,2),createNoiseEvent(30,40,2,4)];
  const session=new EditorSession(withNoiseAreas(createChart(),[area])),errors=[];
  const editor=Object.assign(Object.create(NoiseAreaEditor.prototype),{getContext:()=>({session}),selected:0,event:{type:'moveXEvents',index:0},render(){},invalidate(){},commit:(label,chart)=>session.commit(label,chart),report:error=>errors.push(error)});
  editor.edit(area=>{area.moveXEvents[0].end=99;return area;},true,'end');
  editor.event={type:'moveXEvents',index:1};editor.edit(area=>{area.moveXEvents[1].start=77;return area;},true,'start');
  editor.event={type:'moveXEvents',index:0};
  assert.equal(editor.edit(area=>{area.moveXEvents[0].start=NaN;return area;},false,'start'),false);
  assert.equal(withEventLock(session,editor.area().moveXEvents[0],true).start,99);
  editor.edit(area=>{area.moveXEvents[0]=withEventLock(session,editor.area().moveXEvents[0],true);return area;});
  assert.deepEqual([editor.area().moveXEvents[0].start,editor.area().moveXEvents[0].end],[99,99]);
  session.travel('undo');assert.deepEqual([editor.area().moveXEvents[0].start,editor.area().moveXEvents[0].end],[10,99]);
  assert.deepEqual(errors,[]);
});
