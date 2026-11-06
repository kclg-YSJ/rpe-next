import { eventListAt, chartWithEventLists as withLists, transformedEventLists, eventKey, splitEvent } from './event-commands.mjs';
import { expandXyEntries } from './xy-binding.mjs';
import { TransformScene } from '../core/transform-scene.mjs';
import { beatValue, fromNumber } from '../core/beat.mjs';
import { createEvent } from '../core/chart.mjs';
import { EventTrack } from '../core/events.mjs';
import { cropCustomEvent, rebaseCustomEventValues, assertEventEasing } from '../core/event-easing.mjs';
import { t } from '../i18n.mjs';
import { trajectoryEventValue } from '../core/curve-trajectory.mjs';
export function spatialSourceValue(source){return source.event.trajectory?trajectoryEventValue(source.event,source.field==='start'?0:1,source.axis??'x'):source.event[source.field];}

const list=(chart,s)=>eventListAt({chart,eventLayer:s.layer},s.lineIndex,s.type);
function chartWithEventLists(chart,line,layer,updates){updates=new Map([...updates].map(([type,events])=>[type,events.map(e=>e.trajectory?{...e,start:trajectoryEventValue(e,0),end:trajectoryEventValue(e,1)}:e)]));const result=withLists(chart,line,layer,updates);let version=0;for(const events of updates.values())for(const event of events){if(event.trajectory&&(event.trajectory.domain||event.trajectory.offsets))version=251;else if(event.customEasing)version=Math.max(version,250);}return version>Number(chart.META.RPEVersion??0)?{...result,META:{...result.META,RPEVersion:version}}:result;}
export function spatialEvent(chart,s){const event=list(chart,s)[s.index];if(!event || event!==s.event)throw Error(t('spatial.stale'));return event;}
export function changeSpatialEasing(chart,source,transform){
  const event=spatialEvent(chart,source);
  if(event.trajectory)throw Error(t('spatial.easingTrajectory'));
  if(beatValue(event.endTime)<=beatValue(event.startTime))throw Error(t('spatial.easingDuration'));
  const keys=['start','end','easingType','easingLeft','easingRight','bezier','bezierPoints','customEasing'],changed=transform(event),next={...event};
  for(const key of keys){if(Object.hasOwn(changed,key))next[key]=changed[key];else delete next[key];}
  if(!Number.isInteger(next.easingType??1)||(next.easingType??1)<1||(next.easingType??1)>29)throw Error(t('spatial.invalid'));
  for(const[key,fallback]of[['easingLeft',0],['easingRight',1]]){const value=next[key]??fallback;if(!Number.isFinite(value)||value<0||value>1)throw Error(t('spatial.easingBoundary'));}
  if(next.bezier&&(!Array.isArray(next.bezierPoints)||next.bezierPoints.length!==4||!next.bezierPoints.every(Number.isFinite)))throw Error(t('spatial.easingBezier'));
  assertEventEasing(next);
  if(keys.every(key=>JSON.stringify(next[key])===JSON.stringify(event[key])))return chart;
  const updates=transformedEventLists({chart,eventLayer:source.layer},source.lineIndex,new Set([eventKey(source.type,source.index)]),()=>next);
  return chartWithEventLists(chart,source.lineIndex,source.layer,updates);
}
export function ensureSpatialProperty(chart,tempo,node,type,layer=0){
  const factor=chart.judgeLineList[node.lineIndex].bpmfactor??1,local=tempo.beat(tempo.seconds(node.beat),factor),source={lineIndex:node.lineIndex,layer,type},events=list(chart,source);
  const trajectory=['moveXEvents','moveYEvents','rotateEvents'].includes(type)?list(chart,{...source,type:'moveXEvents'}).findIndex(e=>e.trajectory&&beatValue(e.startTime)<=local&&beatValue(e.endTime)>=local):-1;
  if(trajectory>=0){const event=list(chart,{...source,type:'moveXEvents'})[trajectory];const field=Math.abs(beatValue(event.startTime)-local)<1e-8?'start':Math.abs(beatValue(event.endTime)-local)<1e-8?'end':null;if(field)return{chart,source:{...source,type:'moveXEvents',index:trajectory,event,field,axis:{moveXEvents:'x',moveYEvents:'y',rotateEvents:'rotation'}[type],beat:node.beat}};}
  let field=node.field==='end'?'end':'start',index=events.findIndex(e=>Math.abs(beatValue(e[field==='start'?'startTime':'endTime'])-local)<1e-8);
  if(index<0&&!node.field){field='end';index=events.findIndex(e=>Math.abs(beatValue(e.endTime)-local)<1e-8);}
  if(index<0){if(!node.field)field='start';const split=insertSpatialNode(chart,tempo,{...source,beat:node.beat});if(split){chart=split;index=list(chart,source).findIndex(e=>Math.abs(beatValue(e[field==='start'?'startTime':'endTime'])-local)<1e-8);}
    else{const start=field==='end'?Math.max(...events.map(e=>beatValue(e.endTime)).filter(t=>t<local),local-1):local,end=field==='end'?local:Math.min(...events.map(e=>beatValue(e.startTime)).filter(t=>t>local),local+1),fallback=type==='textEvents'?'':type.startsWith('scale')?1:type==='alphaEvents'?255:0,value=new EventTrack(events,tempo,factor,fallback).value(tempo.seconds(node.beat)-(field==='end'?1e-8:0));const event=createEvent(value,value,start,end);chart=chartWithEventLists(chart,source.lineIndex,layer,new Map([[type,[...events,event]]]));index=events.length;}
  }
  return{chart,source:{...source,index,event:list(chart,source)[index],field,beat:node.beat}};
}
export function changeSpatialSource(chart,tempo,source,{value,time},{continuous=true,xyBinding=false}={}){
  const event=spatialEvent(chart,source),temporary={chart,eventLayer:source.layer,xyBinding};
  if(value!==undefined && (source.type==='textEvents'?typeof value!=='string':!Number.isFinite(value)))throw Error(t('spatial.invalid'));
  const timing=source.field==='start'?'startTime':'endTime';
  const transform=current=>{const next={...current};if(value!==undefined){if(current.trajectory){const axis=source.axis??'x',[a,b]=current.trajectory.domain??[0,1],offset=current.trajectory.offsets?.[axis]??[0,0],u=source.field==='start'?a:b,other=source.field==='start'?b:a,delta=value-spatialSourceValue(source),slope=delta/(u-other);next.trajectory={...current.trajectory,offsets:{...current.trajectory.offsets,[axis]:[offset[0]-slope*other,offset[1]+slope*(1-other)]}};}else{next[source.field]=value;if(next.inst)next.start=next.end=value;}}if(time!==undefined){if(!Number.isFinite(time))throw Error(t('spatial.invalid'));next[timing]=fromNumber(tempo.beat(tempo.seconds(time),chart.judgeLineList[source.lineIndex].bpmfactor??1));if(beatValue(next.endTime)<=beatValue(next.startTime))throw Error(t('spatial.duration'));}return next;};
  const selection=new Set([eventKey(source.type,source.index)]);
  if(continuous && (value!==undefined||time!==undefined) && !event.inst && !event.trajectory){const opposite=source.field==='start'?'end':'start',field=opposite==='start'?'startTime':'endTime';list(chart,source).forEach((other,index)=>{if(index!==source.index&&beatValue(other[field])===beatValue(event[timing])&&other[opposite]===event[source.field])selection.add(eventKey(source.type,index));});}
  const updates=transformedEventLists(temporary,source.lineIndex,selection,(current,type)=>{
    if(current===event)return transform(current);
    const opposite=source.field==='start'?'end':'start';return{...current,...(value!==undefined?{[opposite]:value,...(current.inst?{start:value,end:value}:{})}:{}),...(time!==undefined?{[opposite==='start'?'startTime':'endTime']:fromNumber(tempo.beat(tempo.seconds(time),chart.judgeLineList[source.lineIndex].bpmfactor??1))}:{})};
  },{xyTiming:time!==undefined});
  if(time!==undefined){const next=updates.get(source.type)[source.index],a=beatValue(next.startTime),b=beatValue(next.endTime);for(const [otherIndex,other] of list(chart,source).entries()){if(selection.has(eventKey(source.type,otherIndex)))continue;const c=beatValue(other.startTime),d=beatValue(other.endTime);if(a<d&&b>c&&!(beatValue(event.startTime)<d&&beatValue(event.endTime)>c))throw Error(t('spatial.overlap'));}}
  if(time!==undefined)for(const events of updates.values())for(const next of events)if(beatValue(next.endTime)<beatValue(next.startTime))throw Error(t('spatial.duration'));
  let result=chartWithEventLists(chart,source.lineIndex,source.layer,updates);
  if(continuous&&value!==undefined&&event.trajectory&&!event.inst){const opposite=source.field==='start'?'end':'start',at=beatValue(event[timing]);for(const[index,other]of list(chart,source).entries()){if(index===source.index||!other.trajectory||beatValue(other[opposite==='start'?'startTime':'endTime'])!==at)continue;const adjacent={...source,index,event:other,field:opposite};if(Math.abs(spatialSourceValue(adjacent)-spatialSourceValue(source))>1e-6)continue;const current={...adjacent,event:list(result,adjacent)[index]};result=changeSpatialSource(result,tempo,current,{value},{continuous:false,xyBinding:false});}}
  return result;
}
export function changeSpatialPosition(chart,tempo,sources,point,scale,options){
  if(!sources.length)throw Error(t('spatial.noMovement'));
  const scene=new TransformScene(),sample=current=>{scene.compile(current,tempo);return scene.sampler(tempo.seconds(sources[0].beat)-(sources[0].field==='end'?1e-8:0),scale)(sources[0].lineIndex);},base=sample(chart);
  const axes=sources.slice(0,2).map(source=>{const value=spatialSourceValue({...source,event:spatialEvent(chart,source)}),probe=sample(changeSpatialSource(chart,tempo,source,{value:value+1},options));return{source,value,x:probe.x-base.x,y:probe.y-base.y};});
  const dx=point.x-base.x,dy=point.y-base.y;let changes;
  if(axes.length===2){const[a,b]=axes,det=a.x*b.y-b.x*a.y;if(Math.abs(det)<1e-10)throw Error(t('spatial.singular'));changes=[(dx*b.y-dy*b.x)/det,(a.x*dy-a.y*dx)/det];}
  else{const a=axes[0],length=a.x*a.x+a.y*a.y;if(length<1e-10)throw Error(t('spatial.singular'));changes=[(dx*a.x+dy*a.y)/length];}
  let next=chart;for(let i=0;i<axes.length;i++){const axis=axes[i],source={...axis.source,event:list(next,axis.source)[axis.source.index]};next=changeSpatialSource(next,tempo,source,{value:axis.value+changes[i]},options);}return next;
}
export function splitSpatialEvent(event,beat,tempo,factor){
  const a=tempo.seconds(event.startTime,factor),b=tempo.seconds(event.endTime,factor),p=(tempo.seconds(beat,factor)-a)/(b-a);
  if(!(p>0&&p<1))throw Error(t('spatial.duration'));
  if(event.trajectory){const[a,b]=event.trajectory.domain??[0,1],middle=a+(b-a)*p;return[{...event,endTime:fromNumber(beat),trajectory:{...event.trajectory,domain:[a,middle]}},{...event,startTime:fromNumber(beat),trajectory:{...event.trajectory,domain:[middle,b]}}];}
  if(event.bezier){const[x1,y1,x2,y2]=event.bezierPoints;if(x1<0||x1>1||x2<0||x2>1)throw Error(t('spatial.bezier'));event={...event,bezier:0,customEasing:{curve:{version:1,name:'',nodes:[{x:0,y:0,mode:'corner',out:[x1,y1]},{x:1,y:1,mode:'corner',in:[x2,y2]}]}}};}
  if(event.customEasing)return[cropCustomEvent(event,0,p,event.startTime,fromNumber(beat)),cropCustomEvent(event,p,1,fromNumber(beat),event.endTime)];
  if(typeof event.start==='string'){const value=new EventTrack([event],tempo,factor).value(tempo.seconds(beat,factor));return[{...event,endTime:fromNumber(beat),end:value},{...event,startTime:fromNumber(beat),start:value}];}
  return splitEvent(event,beat,tempo,factor);
}
export function insertSpatialNode(chart,tempo,{lineIndex,layer,type,beat,inst=false}){
  const factor=chart.judgeLineList[lineIndex]?.bpmfactor??1,local=tempo.beat(tempo.seconds(beat),factor),source={lineIndex,layer,type},events=list(chart,source);
  const index=events.findIndex(event=>beatValue(event.startTime)<local&&beatValue(event.endTime)>local);
  if(index<0)return null;
  let parts=splitSpatialEvent(events[index],local,tempo,factor);if(inst)parts[1]={...parts[1],inst:1,end:parts[1].start,customEasing:undefined};
  return chartWithEventLists(chart,lineIndex,layer,new Map([[type,[...events.slice(0,index),...parts,...events.slice(index+1)]]]));
}
export function placeSpatialSpan(chart,tempo,{lineIndex,layer,type,first,second,firstValue,secondValue,inst=false}){
  if(Math.abs(second-first)<1e-8)throw Error(t('spatial.duration'));if(second<first){[first,second]=[second,first];[firstValue,secondValue]=[secondValue,firstValue];}
  const factor=chart.judgeLineList[lineIndex].bpmfactor??1,a=tempo.beat(tempo.seconds(first),factor),b=tempo.beat(tempo.seconds(second),factor),events=list(chart,{lineIndex,layer,type});
  if(events.some(e=>a<beatValue(e.endTime)&&b>beatValue(e.startTime)))throw Error(t('spatial.overlap'));
  const event={...createEvent(firstValue,inst?firstValue:secondValue,a,b),inst:Number(inst)};return chartWithEventLists(chart,lineIndex,layer,new Map([[type,[...events,event]]]));
}
export function deleteSpatialNode(chart,source,{whole=false,xyBinding=false}={}){
  const event=spatialEvent(chart,source),entries=(xyBinding?expandXyEntries(chart,source.layer,[source]):[source]).map(entry=>({...source,...entry,layer:source.layer}));let result=chart;
  for(const entry of entries){const events=[...list(result,entry)],index=events.indexOf(entry.event);if(index<0)continue;
    const field=source.field==='start'?'endTime':'startTime',at=beatValue(entry.event[source.field==='start'?'startTime':'endTime']);const adjacent=whole?-1:events.findIndex((e,i)=>i!==index&&beatValue(e[field])===at);
    if(adjacent>=0){const left=source.field==='start'?events[adjacent]:entry.event,right=source.field==='start'?entry.event:events[adjacent];
      let merged={...left,endTime:[...right.endTime],end:right.end};if(left.trajectory&&right.trajectory&&JSON.stringify(left.trajectory.options)===JSON.stringify(right.trajectory.options)&&JSON.stringify(left.trajectory.offsets)===JSON.stringify(right.trajectory.offsets)){merged.trajectory={...left.trajectory,domain:[left.trajectory.domain?.[0]??0,right.trajectory.domain?.[1]??1]};}else if(left.customEasing&&right.customEasing&&JSON.stringify(left.customEasing.curve)===JSON.stringify(right.customEasing.curve)&&left.customEasing.sourceStart===right.customEasing.sourceStart&&left.customEasing.sourceEnd===right.customEasing.sourceEnd){merged.customEasing={...left.customEasing,domain:[left.customEasing.domain?.[0]??0,right.customEasing.domain?.[1]??1]};}else if(left.trajectory||right.trajectory){throw Error(t('spatial.mergeTrajectory'));}else if(left.customEasing){merged=rebaseCustomEventValues(left,merged);}if(merged.inst)merged.end=merged.start;
      const remove=new Set([index,adjacent]);result=chartWithEventLists(result,entry.lineIndex,source.layer,new Map([[entry.type,[...events.filter((_,i)=>!remove.has(i)),merged]]]));
    }else result=chartWithEventLists(result,entry.lineIndex,source.layer,new Map([[entry.type,events.filter((_,i)=>i!==index)]]));
  }return result;
}
