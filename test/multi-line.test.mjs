import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorSession } from '../src/application/session.mjs';
import { createChart, createLine, createNote, createEvent, EVENT_TYPES } from '../src/core/chart.mjs';
import { insertEvent, placedEvent, eventListAt, transformEvents } from '../src/application/event-commands.mjs';
import { copyObjects, pasteObjects, deleteObjects, projectClipboard } from '../src/application/clipboard.mjs';
import { parseLineExpression, formatLineExpression, compileLineExpression } from '../src/application/multi-line-edit.mjs';
import { LineActivityIndex } from '../src/core/line-activity.mjs';
import { LineOverviewIndex } from '../src/core/line-overview.mjs';
import { TempoMap } from '../src/core/tempo.mjs';
import { shaderEvents } from '../src/core/shader-events.mjs';
import { normalizeEditorPreferences } from '../src/platform/editor-preferences.mjs';
import { lineFeatureLabels } from '../src/core/line-groups.mjs';
import { Timeline } from '../src/ui/timeline.mjs';

function sessionWithLines(count = 3) {
  const chart = createChart(); chart.judgeLineList = Array.from({ length: count }, (_, index) => createLine(`Line ${index + 1}`));
  return new EditorSession(chart);
}

function canvas() { return { clientWidth: 500, clientHeight: 600, style: {}, addEventListener() {}, focus() {}, setPointerCapture() {}, getBoundingClientRect() { return { left: 0, top: 0, width: 500, height: 600 }; }, getContext() { return { }; } }; }

test('多线模式保持去重排序并在关闭时保留集合', () => {
  const session = sessionWithLines();
  session.setMultiLineEnabled(true); session.addMultiLine(2); session.addMultiLine(1); session.addMultiLine(2);
  assert.deepEqual(session.multiLineIndices, [0, 1, 2]);
  session.removeMultiLine(0); assert.deepEqual(session.multiLineIndices, [1, 2]);
  session.setMultiLineEnabled(false); assert.equal(session.multiLineActive, false); assert.deepEqual(session.multiLineIndices, [1, 2]);
});

test('多线表达式支持分组名并在完整分组时优先显示分组名', () => {
  const session = sessionWithLines(4); session.chart.judgeLineGroup = ['Default', 'Verse'];
  session.chart.judgeLineList[1].Group = 1; session.chart.judgeLineList[2].Group = 1;
  assert.deepEqual(parseLineExpression('Verse 0', 4, session.chart), [0, 1, 2]);
  assert.equal(formatLineExpression([0, 1, 2], session.chart), 'Verse 0');
});

test('all大小写不敏感并可与线号和组名混用，覆盖全部线时显示all', () => {
  const session = sessionWithLines(4); session.chart.judgeLineGroup = ['Default', 'Verse']; session.chart.judgeLineList[2].Group = 1;
  for (const text of ['all', 'ALL', 'aLl', '0 ALL Verse']) assert.deepEqual(parseLineExpression(text, 4, session.chart), [0, 1, 2, 3]);
  assert.deepEqual(parseLineExpression('all', 0), []); assert.equal(formatLineExpression([0, 1, 2, 3], session.chart), 'all');
  assert.throws(() => parseLineExpression('"all"', 4, session.chart));
});

test('判定线列表标出非默认父线、绑定 UI、zOrder 和贴图', () => {
  assert.deepEqual(lineFeatureLabels({ father: 0, attachUI: 'name', zOrder: 2, Texture: 'custom.png' }), ['父线=0', 'UI=name', 'Z=2', '贴图=custom.png']);
  assert.deepEqual(lineFeatureLabels({ father: -1, zOrder: 0, Texture: 'line.png' }), []);
});

test('多线边界按钮按循环线组添加，音符可迁移到指定线', () => {
  const session = sessionWithLines(); session.setMultiLineEnabled(true); session.multiLineIndices = [0];
  session.addPreviousMultiLine(); assert.deepEqual(session.multiLineIndices, [0, 2]);
  session.addNextMultiLine(); assert.deepEqual(session.multiLineIndices, [0, 1, 2]);
  session.setMultiLineEnabled(false); session.insertNotes([createNote(1, 1, 0)]); session.selection = new Set([0]); session.moveSelectionToLine(2);
  assert.equal(session.lineIndex, 2); assert.equal(session.chart.judgeLineList[0].notes.length, 0);
});

test('多线音符并列显示并按所属线编辑', () => {
  const session = sessionWithLines(); session.setMultiLineEnabled(true); session.addMultiLine(1); session.addMultiLine(2);
  session.insertNotes([createNote(1, 2, 10)]);
  assert.deepEqual(session.chart.judgeLineList.map(line => line.notes.length), [1, 0, 0]);
  session.transformSelection('镜像', note => ({ ...note, positionX: -note.positionX }));
  assert.equal(session.chart.judgeLineList[0].notes[0].positionX, -10);
  session.selectLine(1); session.insertNotes([createNote(1, 2, 20)]);
  assert.deepEqual(session.chart.judgeLineList.map(line => line.notes.length), [1, 1, 0]);
  session.selection = new Set([0]);
  session.deleteSelection(); assert.deepEqual(session.chart.judgeLineList.map(line => line.notes.length), [1, 0, 0]);
  session.travel('undo'); assert.deepEqual(session.chart.judgeLineList.map(line => line.notes.length), [1, 1, 0]);
});

test('多线音符编辑按所属线处理，不依赖当前线', () => {
  const session = sessionWithLines(3);
  session.chart.judgeLineList[1].notes = [createNote(1, 2, 10)];
  session.chart.judgeLineList[1].numOfNotes = 1;
  session.setMultiLineEnabled(true);
  session.multiLineIndices = [0, 1];
  session.multiLineSelection = new Map([[1, new Set([0])]]);
  session.selection.clear();
  session.transformSelection('镜像非当前线音符', note => ({ ...note, positionX: -note.positionX }));
  assert.equal(session.chart.judgeLineList[0].notes.length, 0);
  assert.equal(session.chart.judgeLineList[1].notes[0].positionX, -10);
  session.deleteSelection();
  assert.equal(session.chart.judgeLineList[1].notes.length, 0);
});

test('多线事件放置和批量变换保留每条线独立数组', () => {
  const session = sessionWithLines(); session.setMultiLineEnabled(true, 'events'); session.addMultiLine(1);
  const event = placedEvent(session, 'moveXEvents', 2, 3); insertEvent(session, 'moveXEvents', event);
  assert.equal(eventListAt(session, 0, 'moveXEvents').length, 2);
  assert.equal(eventListAt(session, 1, 'moveXEvents').length, 1);
  session.selectLine(1);
  const second = placedEvent(session, 'moveXEvents', 4, 5); insertEvent(session, 'moveXEvents', second);
  session.eventSelection = new Set(['moveXEvents:1']);
  transformEvents(session, '调整', current => ({ ...current, start: current.start + 5, end: current.end + 5 }));
  assert.equal(eventListAt(session, 0, 'moveXEvents')[0].start, 0);
  assert.equal(eventListAt(session, 1, 'moveXEvents')[0].start, 0);
  assert.equal(eventListAt(session, 1, 'moveXEvents')[1].start, 5);
});

test('多线事件删除撤销恢复选择不丢失谱面引用', () => {
  const session = sessionWithLines(2); session.setMultiLineEnabled(true, 'events'); session.addMultiLine(1);
  insertEvent(session, 'moveXEvents', placedEvent(session, 'moveXEvents', 2, 3));
  session.selectLine(1); insertEvent(session, 'moveXEvents', placedEvent(session, 'moveXEvents', 4, 5));
  session.multiEventSelection = new Map([[1, new Set(['moveXEvents:0'])]]);
  session.eventSelection = new Set(['moveXEvents:0']);
  const before = eventListAt(session, 1, 'moveXEvents').length;
  deleteObjects(session); assert.equal(eventListAt(session, 1, 'moveXEvents').length, before - 1);
  session.travel('undo');
  assert.equal(eventListAt(session, 1, 'moveXEvents').length, before);
  assert.deepEqual([...session.multiEventSelection.get(1)], ['moveXEvents:0']);
});

test('多线剪贴板复制粘贴和删除一次提交', () => {
  const session = sessionWithLines(); session.setMultiLineEnabled(true); session.addMultiLine(1);
  session.insertNotes([createNote(1, 1, 0)]); copyObjects(session); session.selection = new Set([0]);
  pasteObjects(session, 4); assert.deepEqual(session.chart.judgeLineList.map(line => line.notes.length), [2, 0, 0]);
  deleteObjects(session); assert.deepEqual(session.chart.judgeLineList.map(line => line.notes.length), [1, 0, 0]);
});

test('多线剪贴板保留来源线并按目标面板映射相对线号', () => {
  const session = sessionWithLines();
  session.chart.judgeLineList[1].notes = [createNote(1, 1, 100)];
  session.chart.judgeLineList[2].notes = [createNote(1, 2, -100)];
  session.multiLineEnabled = true; session.multiLineMode = 'notes'; session.multiLineIndices = [1, 2];
  session.multiLineSelection = new Map([[1, new Set([0])], [2, new Set([0])]]);
  copyObjects(session);
  assert.deepEqual(session.clipboardNoteLines, [1, 2]);
  const projected = projectClipboard(session, 4, { targetLineIndex: 0 });
  assert.deepEqual(projected.noteLines, [0, 1]);
  pasteObjects(session, 4, { targetLineIndex: 0 });
  assert.equal(session.chart.judgeLineList[0].notes.length, 1);
  assert.equal(session.chart.judgeLineList[1].notes.length, 2);
  assert.deepEqual([...session.multiLineSelection.get(0)], [0]);
  assert.deepEqual([...session.multiLineSelection.get(1)], [1]);
});

test('多线线号表达式支持空格和闭区间并拒绝反向范围', () => {
  assert.deepEqual(parseLineExpression('0 2:4 4 8', 10), [0, 2, 3, 4, 8]);
  assert.equal(formatLineExpression([4, 2, 3, 2]), '2:4');
  assert.throws(() => parseLineExpression('4:2', 10), /范围无效/);
  assert.deepEqual(parseLineExpression('-1 0 99', 3), [0]);
});

test('多线事件和音符共享单线宽度，仍可保留事件显式覆盖', () => {
  const session = sessionWithLines(2); session.setMultiLineEnabled(true, 'events'); session.addMultiLine(1);
  const timeline = new Timeline(canvas(), canvas(), () => session, () => {}, () => {}); timeline.multiLineWidth = 320;
  assert.equal(timeline.panelWidth(500, 'notes'), 320);
  assert.equal(timeline.panelWidth(500, 'events'), 320);
  timeline.multiLineEventWidth = 180; assert.equal(timeline.panelWidth(500, 'events'), 320);
});

test('动态词元不区分大小写，和线号、范围、分组取并集，脱离视野时不静默忽略', () => {
  const chart=createChart();chart.judgeLineList=Array.from({length:6},()=>createLine());chart.judgeLineGroup=['Default','Verse'];chart.judgeLineList[5].Group=1;
  assert.deepEqual(compileLineExpression('0 2:3 Verse @NOTES @Events @notes',6,chart),{indices:[0,2,3,5],dynamic:['notes','events']});
  assert.deepEqual(parseLineExpression('0 @notes @events',6,chart,{notes:[1,2],events:[2,4]}),[0,1,2,4]);
  assert.throws(()=>parseLineExpression('@notes',6,chart),/当前时间视野/);
});

test('动态活动索引和 Ctrl+滚轮的筛选语义相同，覆盖 Hold、倍率、层和 shader', () => {
  const chart=createChart(),tempo=new TempoMap([{bpm:120,startTime:[0,0,1]},{bpm:180,startTime:[4,0,1]}]);
  chart.judgeLineList=Array.from({length:12},(_,i)=>{
    const line=createLine();line.bpmfactor=[.5,1,2][i%3];line.notes=[createNote(2,i,0,i+5),createNote(1,i+8,0)];
    line.eventLayers=[{moveXEvents:[createEvent(0,1,i/2,i/2+2)]},{moveYEvents:[createEvent(0,1,i+2,i+6)]}];
    line.extended={textEvents:[createEvent('a','b',i+1,i+3)],paintEvents:[{...createEvent(0,0,i+5,i+8),shader:'bloom'}]};return line;
  });
  const activity=new LineActivityIndex();
  for(const extended of [false,true])for(const layer of [0,1])for(let start=-1;start<16;start+=.25)for(const kind of ['notes','events']){
    const end=start+1.75;
    const expected=chart.judgeLineList.flatMap((line,i)=>new LineOverviewIndex(line,tempo,extended?shaderEvents(chart,i):[],layer,extended).matches(start,end,kind==='notes',kind==='events')?[i]:[]);
    assert.deepEqual(activity.query(chart,tempo,start,end,kind,layer,extended),expected);
  }
  const first=activity.query(chart,tempo,0,.05,'notes');assert.equal(activity.query(chart,tempo,.01,.04,'notes'),first);
});

test('动态线号持续刷新、允许空结果、拖拽冻结、手动改选结束动态筛选且撤销可恢复', () => {
  const session=sessionWithLines(3),timeline=new Timeline(canvas(),canvas(),()=>session,()=>{},()=>{});let start=0,end=1;
  session.chart.judgeLineList[1].notes=[createNote(1,4,0)];session.chart.judgeLineList[2].notes=[createNote(1,12,0)];
  timeline.currentLineActivity=()=>({chart:session.chart,tempo:timeline.tempo,start,end,layer:0,extended:false});
  timeline.setMultiLineExpression('@notes');session.setMultiLineEnabled(true,'events');
  assert.equal(session.multiLineActive,true);assert.deepEqual(session.multiLineIndices,[]);assert.equal(timeline.panelCount('events'),0);assert.equal(timeline.lineIndexAt(100,500,'events'),-1);
  timeline.eventCursor={x:10,y:200};assert.equal(timeline.eventInteraction.place(),false);
  session.clipboard=[createNote(1,1,0)];assert.equal(pasteObjects(session,2,{targetLineIndex:-1}),false);session.clipboard=[];
  start=1.5;end=2.5;assert.equal(timeline.refreshMultiLineExpression(),true);assert.deepEqual(session.multiLineIndices,[1]);assert.equal(timeline.lineIndexAt(100,500,'events'),1);
  const stable=session.multiLineIndices;assert.equal(timeline.refreshMultiLineExpression(),false);assert.equal(session.multiLineIndices,stable);
  timeline.eventInteraction.drag={kind:'move'};start=5.5;end=6.5;assert.equal(timeline.refreshMultiLineExpression(),false);assert.deepEqual(session.multiLineIndices,[1]);
  timeline.eventInteraction.drag=null;assert.equal(timeline.refreshMultiLineExpression(),true);assert.deepEqual(session.multiLineIndices,[2]);
  session.addMultiLine(0);timeline.refreshMultiLineExpression();assert.equal(session.multiLineExpression,'');assert.deepEqual(session.multiLineIndices,[0,2]);
  timeline.setMultiLineExpression('@notes');const line=session.chart.judgeLineList[2];
  session.commit('删除音符',{...session.chart,judgeLineList:session.chart.judgeLineList.map((item,i)=>i===2?{...item,notes:[]}:item)});timeline.refreshMultiLineExpression();assert.deepEqual(session.multiLineIndices,[]);
  session.travel('undo');timeline.refreshMultiLineExpression();assert.deepEqual(session.multiLineIndices,[2]);assert.equal(session.chart.judgeLineList[2],line);
  session.multiLineIndices=[0];timeline.refreshMultiLineExpression();assert.equal(session.multiLineExpression,'');
});

test('动态索引稳定播放不重建、不重复查询谱面物件，事件栏展示偏好能持久化', () => {
  const chart=createChart(),tempo=new TempoMap(chart.BPMList);chart.judgeLineList[0].notes=[createNote(2,0,0,1000)];
  const index=new LineActivityIndex();index.query(chart,tempo,1,2,'notes');const track=index.track(chart,tempo,'notes',0,false);
  track.index.query=()=>assert.fail('相同活动区间不重新查询');
  for(let time=1.01;time<2;time+=.01)assert.deepEqual(index.query(chart,tempo,time,time+1,'notes'),[0]);
  assert.deepEqual(normalizeEditorPreferences({multiLineEventVisibility:{moveXEvents:false,speedEvents:true,bogus:false,textEvents:'no'}}).multiLineEventVisibility,{moveXEvents:false,speedEvents:true});
});
