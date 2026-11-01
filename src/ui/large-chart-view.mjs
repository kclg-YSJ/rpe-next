import { CountedNoteBatch } from './counted-note-batch.mjs';
import { fromNumber } from '../core/beat.mjs';
import { createNote } from '../core/chart.mjs';
import { IntervalIndex } from '../core/interval-index.mjs';
import { SceneRuntime } from '../core/scene.mjs';

export class LargeChartView {
  constructor(owner){this.owner=owner;this.cache=new Map();this.generation=0;this.counter={scoreAt:(seconds,delta)=>this.scoreAt(seconds,delta)};}
  set(value){this.buffer=value;this.generation++;}
  contains(seconds){return this.buffer&&seconds>=this.buffer.seconds&&seconds<=this.buffer.end;}
  scoreAt(seconds,delta=0){const b=this.buffer;if(!b)return{combo:0,score:0};let combo=b.combo;for(let i=0;i<b.completions.length;i+=2){if(b.completions[i]>=seconds)break;combo=b.completions[i+1];}combo=Math.max(0,Math.min(this.owner.summary.realNotes,combo+delta));return{combo,score:Math.round(combo/Math.max(1,this.owner.summary.realNotes)*1000000)};}
  prepare(preview,chart,tempo){
    if(preview.largePageChart!==chart){preview.largePageChart=chart;preview.largeHeader={...chart,judgeLineList:chart.judgeLineList.map(line=>({...line,notes:[]}))};}
    const header=preview.largeHeader;
    if(preview.scene.largeOwner!==this){preview.scene=new SceneRuntime();preview.scene.largeOwner=this;preview.noteBatch=new CountedNoteBatch();}
    preview.scene.compile(header,tempo);preview.completionTimes=this.counter;
    const key=`${this.generation}:${this.owner.pageGeneration}:${this.owner.revision}`;
    if(preview.largeGeneration===key&&preview.largePreparedChart===chart)return;preview.largeGeneration=key;preview.largePreparedChart=chart;preview.noteDraft.chart=null;
    const entries=header.judgeLineList.map(()=>[]),b=this.buffer,used=new Set(),simultaneous=new Set(),counts=new Map();
    const extras=new Map(b?.extras??[]);
    if(b)for(let offset=0,index=0;offset<b.notes.length;offset+=b.stride,index++){
      const row=b.notes,id=row[offset+13],line=row[offset],count=row[offset+9];used.add(id);
      let entry=this.cache.get(id);
      if(!entry||entry.revision!==this.owner.revision){
        const note=extras.has(index)?JSON.parse(extras.get(index)):createNote(row[offset+1],row[offset+14],row[offset+4],row[offset+15]);
        Object.assign(note,{type:row[offset+1],startTime:fromNumber(row[offset+14]),endTime:fromNumber(row[offset+15]),positionX:row[offset+4],above:row[offset+5]?1:row[offset+1]===2?0:2,isFake:row[offset+6],speed:row[offset+7],size:row[offset+8],yOffset:row[offset+16],visibleTime:row[offset+17],alpha:row[offset+18]});
        note._rpenLargeRef={id,count};entry={note,start:row[offset+2],end:row[offset+3],startFloor:row[offset+10],endFloor:row[offset+11],floor:row[offset+10]+row[offset+16],tail:row[offset+11]+row[offset+16],multiplicity:count,revision:this.owner.revision};this.cache.set(id,entry);
      }
      const pageIndex=this.owner.locations.get(id);entry.index=pageIndex?.line===line?pageIndex.index:-1;
      if(entry.index>=0)entry.note._rpenLargeRef.selected=chart.judgeLineList[line]?.notes[entry.index]?._rpenLargeRef.selected;
      const runtime=preview.scene.lines[line];entry.startFloor=runtime.floor(entry.start);entry.endFloor=runtime.floor(entry.end);entry.floor=entry.startFloor+(entry.note.yOffset??0);entry.tail=entry.endFloor+(entry.note.yOffset??0);
      entries[line].push(entry);if(row[offset+12])simultaneous.add(entry.note);const tick=Math.round(entry.start*1e6);counts.set(tick,(counts.get(tick)??0)+count);
    }
    for(const id of this.cache.keys())if(!used.has(id))this.cache.delete(id);
    for(let line=0;line<entries.length;line++){
      const runtime=preview.scene.lines[line],list=entries[line],notes=[];
      // Page indices stay compatible with the ordinary drag-preview machinery.
      let next=chart.judgeLineList[line]?.notes?.length??0;
      for(const entry of list){if(entry.index<0)entry.index=next++;notes[entry.index]=entry;}
      runtime.notes=notes;runtime.hitTimes=[...list].sort((a,b)=>a.start-b.start);
      runtime.holdIndex=new IntervalIndex(list.filter(e=>e.note.type===2),e=>e.start,e=>e.end);
      runtime.minSpeed=list.reduce((v,e)=>Math.min(v,Math.abs(e.note.speed)||1),1);
      const visible=[];runtime.visibleNotes=(seconds,state)=>{
        let n=0;if(state.alpha>=0&&this.contains(seconds))for(const entry of list)if(entry.end>=seconds&&entry.start-seconds<=(entry.note.visibleTime??999999)&&!(runtime.line.isCover===1&&entry.note.speed!==0&&(entry.note.type===2?entry.tail:entry.floor)<state.floor))visible[n++]=entry;
        visible.length=n;return visible;
      };
    }
    preview.simultaneous=simultaneous;preview.simultaneousCounts=counts;
  }
  dispose(){this.cache.clear();this.buffer=null;}
}
