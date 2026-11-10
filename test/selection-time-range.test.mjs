import test from 'node:test';
import assert from 'node:assert/strict';
import { selectionTimeRange } from '../src/application/selection-time-range.mjs';
import { drawSelectionRange, SELECTION_RANGE_COLOR, CLIPBOARD_RANGE_COLOR } from '../src/ui/selection-range-strip.mjs';
import { clipboardTimeRange } from '../src/application/clipboard-time-range.mjs';
import { copyObjects } from '../src/application/clipboard.mjs';
import { ClipboardHistory } from '../src/application/clipboard-history.mjs';
import { EditorSession } from '../src/application/session.mjs';
import { createChart, createLine, createNote, createEvent } from '../src/core/chart.mjs';
import { TempoMap } from '../src/core/tempo.mjs';
import { DEFAULT_EDITOR_PREFERENCES } from '../src/core/default-settings.mjs';
import { DEFAULT_HOTKEYS, shortcutAction } from '../src/core/preferences.mjs';
import { readEditorPreferences, writeEditorPreferences } from '../src/platform/editor-preferences.mjs';
import { usesNativeTextShortcut } from '../src/ui/keyboard.mjs';

test('选择范围包含 Hold 尾部、各线倍率及事件，按原版分别描绿框且不更改选择', () => {
  const chart=createChart();chart.BPMList=[{bpm:120,startTime:[0,0,1]},{bpm:240,startTime:[4,0,1]}];chart.judgeLineList=[createLine(),createLine()];
  chart.judgeLineList[0].notes=[createNote(2,1,0,8)];chart.judgeLineList[1].bpmfactor=2;chart.judgeLineList[1].notes=[createNote(1,6,0)];chart.judgeLineList[1].eventLayers[0].moveXEvents=[createEvent(0,10,2,3)];
  const session=new EditorSession(chart),tempo=new TempoMap(chart.BPMList);session.multiLineEnabled=true;session.multiLineIndices=[1,0];session.multiLineMode='notes';session.multiLineSelection=new Map([[0,new Set([0])],[1,new Set([0])]]);
  let range=selectionTimeRange(session,tempo);assert.deepEqual(range,{start:.5,end:5,count:2,ranges:[{start:.5,end:3},{start:5,end:5}]});
  session.multiLineMode='events';session.selection=new Set([0]);session.multiLineSelection.clear();session.multiEventSelection=new Map([[1,new Set(['moveXEvents:0'])]]);
  range=selectionTimeRange(session,tempo);assert.equal(range.count,2);assert.equal(range.end,3);assert.deepEqual(range.ranges,[{start:.5,end:3},{start:2,end:3}]);
  const rectangles=[],context={save(){},restore(){},strokeRect(...args){rectangles.push(args);}};drawSelectionRange(context,24,600,6,range);
  assert.deepEqual(rectangles,[[.75,298.5,22.5,253],[.75,298.5,22.5,103]]);assert.equal(context.strokeStyle,SELECTION_RANGE_COLOR);
  session.selection.clear();session.multiEventSelection.clear();assert.equal(selectionTimeRange(session,tempo),null);
});

test('剪贴板粉框按复制内容原时间显示，包含 Hold 尾部，缓存不重复扫描且清空后消失',()=>{
  const session=new EditorSession(),tempo=new TempoMap(session.chart.BPMList);
  session.line.notes=[createNote(2,2,0,5),createNote(1,7,0)];session.selection=new Set([0,1]);session.eventSelection=new Set(['moveXEvents:0']);copyObjects(session);
  const range=clipboardTimeRange(session,tempo);assert.deepEqual(range,{start:0,end:3.5});
  const original=tempo.seconds;tempo.seconds=()=>assert.fail('unchanged clipboard must not be scanned on each frame');
  for(let frame=0;frame<100;frame++)assert.equal(clipboardTimeRange(session,tempo),range);tempo.seconds=original;
  session.selection.clear();session.eventSelection.clear();session.clipboardVisible=false;assert.equal(clipboardTimeRange(session,tempo),range,'hiding the paste ghost does not clear the clipboard range');
  const context={save(){},restore(){},strokeRect(){}};drawSelectionRange(context,24,600,6,range,CLIPBOARD_RANGE_COLOR);assert.equal(context.strokeStyle,'#ffb3cc');
  const history=new ClipboardHistory();history.remember(session);const id=history.entries[0].id;history.clearCurrent(session);assert.equal(clipboardTimeRange(session,tempo),null);
  history.use(session,id);assert.deepEqual(clipboardTimeRange(session,tempo),range);
});

test('磁盘剪贴板粉框采用完整选择摘要，跨线复制使用各自倍率',()=>{
  const chart=createChart();chart.judgeLineList.push(createLine());chart.judgeLineList[1].bpmfactor=2;
  const session=new EditorSession(chart),tempo=new TempoMap(chart.BPMList);session.clipboard=[createNote(1,1,0),createNote(2,2,0,4)];session.clipboardNoteLines=[0,1];
  assert.deepEqual(clipboardTimeRange(session,tempo),{start:.5,end:4});
  session.clipboard=[{...createNote(1,1,0),_rpenLargeClipboard:{total:50000000}}];session.clipboardBounds={start:.5,end:1000};
  assert.deepEqual(clipboardTimeRange(session,tempo),{start:.5,end:1000});
});

test('磁盘选择使用完整摘要，不遍历已加载音符；范围裁到历史条并保留单点可见性', () => {
  const session=new EditorSession();session.largeDocument={logicalSelection:{total:50000000,firstSeconds:-1,lastSeconds:100}};
  session.selectedNoteEntries=()=>assert.fail('logical selection must not scan loaded notes');
  const range=selectionTimeRange(session,new TempoMap(session.chart.BPMList));assert.equal(range.count,50000000);assert.equal(range.start,-1);assert.equal(range.end,100);
  const rectangles=[],context={save(){},restore(){},strokeRect(...args){rectangles.push(args);}};drawSelectionRange(context,24,600,60,range);drawSelectionRange(context,24,600,60,{start:2,end:2});
  assert.deepEqual(rectangles,[[.75,.75,22.5,598.5],[.75,578.5,22.5,3]]);
});

test('额外按键删除默认开启并持久化，仅放宽所选物件删除且仍要求绑定中的键', () => {
  assert.equal(DEFAULT_EDITOR_PREFERENCES.deleteWithExtraKeys,true);
  const preferences={hotkeys:DEFAULT_HOTKEYS},event={key:'Delete',ctrlKey:true,altKey:true,shiftKey:true};
  assert.equal(shortcutAction(event,preferences,'notes',{hasSelection:true,deleteWithExtraKeys:true}),'Delete');
  assert.equal(shortcutAction(event,preferences,'notes',{hasSelection:true,deleteWithExtraKeys:false}),undefined);
  assert.equal(shortcutAction(event,preferences,'notes',{hasSelection:false,deleteWithExtraKeys:true}),undefined);
  assert.equal(shortcutAction({...event,key:'d'},preferences,'events',{hasSelection:true,deleteWithExtraKeys:true}),'QuickDelete');
  const custom={hotkeys:{...DEFAULT_HOTKEYS,Delete:'LEFTCTRL&K',QuickDelete:''}};
  assert.equal(shortcutAction({key:'k',shiftKey:true},custom,'notes',{hasSelection:true,deleteWithExtraKeys:true}),undefined);
  assert.equal(shortcutAction({key:'k',ctrlKey:true,shiftKey:true},custom,'notes',{hasSelection:true,deleteWithExtraKeys:true}),'Delete');
  assert.equal(shortcutAction({key:'v',ctrlKey:true,shiftKey:true},preferences,'notes',{hasSelection:true,deleteWithExtraKeys:true}),'KeepTimePaste');
  for(const deleteWithExtraKeys of [true,false]){let json;const storage={setItem(key,value){json=value;},getItem(){return json;}};writeEditorPreferences({deleteWithExtraKeys},storage);assert.deepEqual(readEditorPreferences(storage),{deleteWithExtraKeys});}
  for(const type of ['text','number']) assert.equal(usesNativeTextShortcut({...event,target:{closest:selector=>selector==='input'?{type}:null}}),true);
});
