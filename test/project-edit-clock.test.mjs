import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectEditClock, chartEditSeconds } from '../src/platform/project-edit-clock.mjs';
import { createChart } from '../src/core/chart.mjs';
import { createChartExport, openFiles, packageEntries } from '../src/platform/files.mjs';
import { parseInfo } from '../src/platform/legacy-text.mjs';
import { readZip } from '../src/platform/archive.mjs';

const storage=()=>{const values=new Map(),writes=[];return{values,writes,getItem:key=>values.get(key)??null,setItem:(key,value)=>{values.set(key,value);writes.push([key,value]);}};};

test('总编辑时间跨重开和重启累计，谱面之间独立，不因撤销、旧版本或旧快照而回退',()=>{
  const disk=storage(),clock=new ProjectEditClock(disk),chart=createChart();chart.rpeNextEditTime=100;
  assert.equal(clock.attach('one',chart,{},0),100);clock.tick(0,true);assert.equal(clock.tick(1000,true),101);clock.checkpoint();
  assert.equal(clock.attach('two',createChart(),{},2000),0);clock.tick(2000,true);clock.tick(4000,true);clock.checkpoint();
  assert.equal(clock.attach('one',chart,{},5000),101);
  const reopened=new ProjectEditClock(disk);assert.equal(reopened.attach('one',createChart(),{},6000),101);
  assert.equal(reopened.attach('two',createChart(),{},7000),2);assert.equal(chart.rpeNextEditTime,100,'time ticks must not mutate chart history');
});

test('主页、隐藏页面与离线间隔不计时，30秒内不重复写盘，保存携带累计秒数',()=>{
  const disk=storage(),clock=new ProjectEditClock(disk),chart=createChart();clock.attach('chart',chart,{},0);clock.tick(0,true);
  for(let i=1;i<300;i++)clock.tick(i*100,true);assert.equal(disk.writes.length,0);clock.tick(30000,true);assert.equal(disk.writes.length,1);
  clock.tick(31000,false);clock.tick(91000,true);assert.ok(Math.abs(clock.total-30)<1e-9);clock.tick(92000,true);assert.ok(Math.abs(clock.total-31)<1e-9);
  const saved=clock.snapshot(chart);assert.ok(Math.abs(saved.rpeNextEditTime-31)<1e-9);assert.equal(chart.rpeNextEditTime,undefined);assert.equal(clock.snapshot(saved).rpeNextEditTime,saved.rpeNextEditTime);
});

test('兼容旧 RPE EditTime 和旧 chartTime，非法时间不注入计时器',()=>{
  assert.equal(chartEditSeconds({chartTime:12,rpeNextEditTime:30},{EditTime:'25.5'}),30);assert.equal(chartEditSeconds({}, {EditTime:'50.25'}),50.25);
  assert.equal(chartEditSeconds({chartTime:-5,rpeNextEditTime:Infinity},{EditTime:'NaN'}),0);
});

test('JSON和PEZ导出往返保留总编辑时间，info.txt写EditTime，旧包导入读取已有时间',async()=>{
  const chart=createChart();chart.rpeNextEditTime=3600.5;
  for(const compatibility of ['next','rpe'])for(const format of ['json','pez']){
    const output=createChartExport(chart,new Map(),'chart.json',{format,compatibility});
    const entries=format==='pez'?await readZip(await output.blob.arrayBuffer()):null;
    const text=entries?new TextDecoder().decode(entries.get('chart.json')):await output.blob.text();assert.equal(JSON.parse(text).rpeNextEditTime,3600.5);
    if(entries)assert.equal(parseInfo(new TextDecoder().decode(entries.get('info.txt'))).EditTime,'3600.5');
  }
  const source=createChart(),files=[{name:'chart.json',arrayBuffer:async()=>new TextEncoder().encode(JSON.stringify(source)).buffer},{name:'info.txt',arrayBuffer:async()=>new TextEncoder().encode('#\nChart: chart.json\nEditTime: 125.75\n').buffer}];
  const imported=await openFiles(files);assert.equal(imported.candidates[0].chart.rpeNextEditTime,125.75);
});
