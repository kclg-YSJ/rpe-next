import test from 'node:test';
import assert from 'node:assert/strict';
import { TimelineStrips, drawStripDensity, drawStripHistory, drawStripMarker, TIMELINE_STRIP_COLOR } from '../src/ui/timeline-strips.mjs';
import { TimelineActivity } from '../src/core/timeline-activity.mjs';
import { createChart, createLine, createNote, createEvent } from '../src/core/chart.mjs';
import { TempoMap } from '../src/core/tempo.mjs';
import { EditorSession } from '../src/application/session.mjs';
import { copyObjects } from '../src/application/clipboard.mjs';
import { recentEditRange } from '../src/application/recent-edit-range.mjs';
import { DEFAULT_TIMELINE_STRIPS, densityWindow } from '../src/core/timeline-strip-settings.mjs';
import { normalizeEditorPreferences } from '../src/platform/editor-preferences.mjs';

function context() {
  return { fills:[],strokes:[],clears:[],transforms:[],images:0,save(){},restore(){},setTransform(...args){this.transforms.push(args);},clearRect(...args){this.clears.push(args);},drawImage(){this.images++;},
    fillRect(...rectangle){this.fills.push({rectangle,alpha:this.globalAlpha,color:this.fillStyle});},strokeRect(...rectangle){this.strokes.push({rectangle,color:this.strokeStyle});} };
}

test('密度与经典皮肤同用居中一秒窗口，多线按列表汇总，不按谱面时长放大采样量',()=>{
  const chart=createChart();chart.judgeLineList=[createLine(),createLine(),createLine()];
  for(const [i,line] of chart.judgeLineList.entries()){line.notes=[createNote(1,5+i,0),createNote(2,2+i,0,8+i),createNote(1,4+i,0)];line.eventLayers=[{moveXEvents:[createEvent(0,10,1+i,2+i)]}];}
  const tempo=new TempoMap(chart.BPMList),activity=new TimelineActivity();activity.compile(chart,tempo);
  const density=activity.density([2,0],0,false,8,240);
  const noteTimes=[1,2,2.5,2,3,3.5],eventTimes=[.5,1.5];
  for(let i=0;i<density.bins;i++){const t=(i+.5)*8/density.bins;assert.equal(density.noteBins[i],noteTimes.filter(x=>Math.abs(t-x)<=.5).length);assert.equal(density.eventBins[i],eventTimes.filter(x=>Math.abs(t-x)<=.5).length);}
  assert.equal(density.windowSeconds,1);assert.equal(activity.density([2,0],0,false,8,240),density);assert.equal(activity.density(0,0,false,1000000,10000).bins,900);
});

test('分数 DPI 清屏覆盖完整像素尺寸，内容坐标填满四舍五入后的底图，不残留旧框边缘',()=>{
  const previousDocument=globalThis.document,previousRatio=globalThis.devicePixelRatio;
  const canvas=()=>{const c=context();return{clientWidth:22,clientHeight:601,width:0,height:0,dataset:{},context:c,getContext:()=>c};};
  globalThis.document={createElement:()=>canvas()};globalThis.devicePixelRatio=1.4857142857142858;
  try{
    const left=canvas(),right=canvas(),strips=new TimelineStrips(left,right),session=new EditorSession(),tempo=new TempoMap(session.chart.BPMList),activity=new TimelineActivity();
    strips.draw(session,tempo,activity,10,3,{start:1,end:2});strips.draw(session,tempo,activity,10,3,null);
    for(const c of [left,right]) {assert.deepEqual(c.context.clears.at(-1),[0,0,33,893]);assert.deepEqual(c.context.transforms.at(-1),[33/22,0,0,893/601,0,0]);}
  }finally{globalThis.document=previousDocument;globalThis.devicePixelRatio=previousRatio;}
});

test('密度左右半栏连续填充并独立归一化，以平方透明度绘制而非稀疏横杠',()=>{
  const c=context();drawStripDensity(c,24,100,{bins:2,noteBins:[1,3],eventBins:[1,1],noteMaximum:3,eventMaximum:1});
  assert.equal(c.fills.length,4);assert.deepEqual(c.fills.map(x=>x.rectangle),[[0,50,12,50],[12,50,12,50],[0,0,12,50],[12,0,12,50]]);
  assert.deepEqual(c.fills.map(x=>x.alpha),[.1625,.65,.65,.65]);assert.ok(c.fills.every(x=>x.color===TIMELINE_STRIP_COLOR));
});

test('历史按实际来源线筛选区间，采用原版淡出；当前时间标记为白色细框',()=>{
  const c=context(),commands=[{start:1,end:2,ranges:[{lineIndex:0,start:1,end:2}],point:false},{start:2,end:4,ranges:[{lineIndex:3,start:2,end:4}],point:false},{lineIndex:0,start:3,end:3,point:true}];
  drawStripHistory(c,24,600,6,commands,[0]);assert.equal(c.fills.length,2);assert.deepEqual(c.fills[0].rectangle,[.75,398.5,22.5,103]);assert.ok(Math.abs(c.fills[0].alpha-Math.sin(Math.PI/4)*.5)<1e-12);assert.equal(c.fills[1].alpha,1);
  drawStripMarker(c,24,600,6,3);assert.deepEqual(c.strokes,[{rectangle:[.5,299,23,2],color:'#ffffff'}]);
});

test('历史范围覆盖选中 Hold 的头尾与编辑前后；删除保留原范围，非当前线按自身倍率记录',()=>{
  const chart=createChart();chart.judgeLineList.push(createLine());chart.judgeLineList[1].bpmfactor=2;chart.judgeLineList[1].notes=[createNote(2,2,0,5)];
  const session=new EditorSession(chart);session.multiLineEnabled=true;session.multiLineIndices=[1,0];session.multiLineMode='notes';session.multiLineSelection=new Map([[1,new Set([0])]]);
  session.transformSelection('移动',note=>({...note,startTime:[3,0,1],endTime:[6,0,1]}));
  assert.deepEqual(session.recentEdits[0],{label:'移动',start:2,end:6,ranges:[{lineIndex:1,start:2,end:6}],point:false});
  session.deleteSelection();assert.equal(session.recentEdits.at(-1).start,3);assert.equal(session.recentEdits.at(-1).end,6);
  session.editSeconds=8;session.commit('元数据',{...session.chart,META:{...session.chart.META,name:'edited'}});assert.equal(session.recentEdits.at(-1).start,8);assert.equal(session.recentEdits.at(-1).point,true);
});

test('历史记录只访问所选索引，不遍历未选中物件',()=>{
  const before=createChart(),chart={...before,judgeLineList:[{...before.judgeLineList[0],notes:[createNote(1,2,0),{get startTime(){assert.fail('must not scan unselected notes');}}]}]};
  before.judgeLineList[0].notes=[createNote(1,1,0),chart.judgeLineList[0].notes[1]];
  const state={lineIndex:0,eventLayer:0,selection:[0],eventSelection:[]};
  const range=recentEditRange({chart,lineIndex:0,editSeconds:0},before,state,state,'移动');assert.equal(range.start,.5);assert.equal(range.end,1);
});

test('静态时间条重复绘制复用统计与位图，隐藏时不统计；选区变化只重画范围框',()=>{
  const savedDocument=globalThis.document;
  const canvas=(width=24,height=600)=>{const c=context();return{clientWidth:width,clientHeight:height,width,height,dataset:{},getContext:()=>c,getBoundingClientRect:()=>({width,height}),context:c};};
  globalThis.document={createElement:()=>canvas()};
  try{
    const session=new EditorSession(),tempo=new TempoMap(session.chart.BPMList),activity=new TimelineActivity(),left=canvas(),right=canvas(),strips=new TimelineStrips(left,right);
    const original=activity.density.bind(activity);let scans=0;activity.density=(...args)=>{scans++;return original(...args);};
    strips.draw(session,tempo,activity,10,0,null);const raster=strips.note.canvas;
    for(let i=0;i<20;i++)strips.draw(session,tempo,activity,10,i/10,{start:1,end:2});
    assert.equal(scans,1);assert.equal(strips.note.canvas,raster);assert.equal(left.context.images,21);
    session.line.notes=[createNote(1,1,0)];session.selection=new Set([0]);copyObjects(session);strips.draw(session,tempo,activity,10,0,null);assert.equal(scans,1,'clipboard changes must not rebuild density');
    left.clientWidth=right.clientWidth=0;strips.draw(session,tempo,activity,10,0,null);assert.equal(scans,1);
  }finally{globalThis.document=savedDocument;}
});

test('两侧条可独立关闭，两者关闭不读画布、不统计；历史关闭不收集编辑区间',()=>{
  const savedDocument=globalThis.document,c=context(),canvas={clientWidth:24,clientHeight:600,dataset:{},getContext:()=>c};globalThis.document={createElement:()=>({...canvas})};
  try{
    const session=new EditorSession(),tempo=new TempoMap(session.chart.BPMList),activity=new TimelineActivity(),strips=new TimelineStrips(canvas,canvas);
    strips.options={...DEFAULT_TIMELINE_STRIPS,densityStrip:false};activity.compile=()=>assert.fail('history alone must not compile density indexes');activity.density=()=>assert.fail('disabled density must not sample');
    strips.draw(session,tempo,activity,10,0,null);assert.equal(strips.note,null);assert.ok(strips.edits);
    strips.options={...strips.options,historyStrip:false};strips.density=strips.history={get clientWidth(){assert.fail('disabled strips must not measure layout');}};strips.draw(session,tempo,activity,10,0,null);assert.equal(strips.edits,null);
    session.recordRecentEdits=false;session.line.notes=[createNote(1,1,0)];session.selection=new Set([0]);session.transformSelection('镜像',note=>({...note,positionX:20}));assert.equal(session.recentEdits.length,0);assert.equal(session.history.undoStack.length,1);
  }finally{globalThis.document=savedDocument;}
});

test('窗口长度合法限制及设置持久化，调整窗口改变密度但不增加采样格数',()=>{
  const preferences=normalizeEditorPreferences({densityStrip:false,historyStrip:true,densityStripBrightness:4,densityStripWindow:-10});assert.deepEqual(preferences,{densityStrip:false,historyStrip:true,densityStripBrightness:1,densityStripWindow:.1});
  assert.equal(densityWindow(NaN),1);assert.equal(densityWindow(100),10);
  const chart=createChart();chart.judgeLineList[0].notes=[createNote(1,3,0)];const activity=new TimelineActivity();activity.compile(chart,new TempoMap(chart.BPMList));
  const first=activity.density(0,0,false,10,600,.1),wide=activity.density(0,0,false,10,600,2);assert.equal(first.bins,wide.bins);assert.ok(wide.noteBins.reduce((a,b)=>a+b)>first.noteBins.reduce((a,b)=>a+b));
  const c=context();drawStripDensity(c,24,100,{bins:1,noteBins:[1],eventBins:[0],maximum:1},.3);assert.equal(c.fills[0].alpha,.3);
});
