import { TransformScene } from './transform-scene.mjs';
import { beatValue, upperBound } from './beat.mjs';
import { trajectoryHasRotation } from './curve-trajectory.mjs';
export const SPATIAL_TYPES = ['moveXEvents','moveYEvents','rotateEvents','alphaEvents','scaleXEvents','scaleYEvents','textEvents'];
export function spatialSources(line,lineIndex,tempo) {
  const result=[];
  const add=(type,events,layer)=>events?.forEach((event,index)=>{for(const field of ['start','end']){const time=event[field==='start'?'startTime':'endTime'];const seconds=tempo.seconds(time,line.bpmfactor??1);for(const axis of event.trajectory?['x','y',...(trajectoryHasRotation(event.trajectory.options)?['rotation']:[])]:[null])result.push({lineIndex,layer,type,index,field,event,axis,seconds,beat:tempo.beat(seconds)});}});
  for(const [layer,tracks] of (line.eventLayers??[]).entries()) for(const type of SPATIAL_TYPES.slice(0,4))add(type,tracks?.[type],layer);
  for(const type of SPATIAL_TYPES.slice(4))add(type,line.extended?.[type],0);
  return result.sort((a,b)=>a.beat-b.beat||Number(a.field==='start')-Number(b.field==='start'));
}
function spatialCuts(line,sources,tempo){
  const times=new Set(sources.map(source=>source.beat)),events=new Set([...sources.map(source=>source.event),...(line.extended?.colorEvents??[])]),factor=line.bpmfactor??1;
  for(const event of events){const start=tempo.seconds(event.startTime,factor),end=tempo.seconds(event.endTime,factor);times.add(tempo.beat(start));times.add(tempo.beat(end));const custom=event.customEasing;if(!custom)continue;const[a,b]=custom.domain??[0,1];for(const node of custom.curve.nodes)if(node.x>a&&node.x<b)times.add(tempo.beat(start+(end-start)*(node.x-a)/(b-a)));}
  return [...times].sort((a,b)=>a-b);
}
export class SpatialTracks {
  constructor(){this.scene=new TransformScene();this.cache=new WeakMap();this.blocks=new Map();}
  compile(chart,tempo,scale={x:1,y:1}) {
    const reset=this.tempo!==tempo||this.scale?.x!==scale.x||this.scale?.y!==scale.y;
    if(this.tempo!==tempo)this.cache=new WeakMap();
    if(reset)this.blocks.clear();
    if(this.chart===chart&&this.tempo===tempo&&this.scale?.x===scale.x&&this.scale?.y===scale.y)return;
    const previous=this.chart?.judgeLineList??[],oldSources=this.sources??[],oldCuts=this.cuts??[],nextCuts=[],changed=new Set();
    this.chart=chart;this.tempo=tempo;this.scale=scale;this.scene.compile(chart,tempo);
    this.sources=chart.judgeLineList.map((line,index)=>{const old=previous[index],same=!reset&&old&&old.eventLayers===line.eventLayers&&old.extended===line.extended&&old.bpmfactor===line.bpmfactor;if(!same||old.father!==line.father||old.rotateWithFather!==line.rotateWithFather)changed.add(index);if(same){nextCuts[index]=oldCuts[index];return oldSources[index];}let entry=this.cache.get(line);if(!entry||entry.index!==index){const sources=spatialSources(line,index,tempo);entry={index,sources,cuts:spatialCuts(line,sources,tempo)};this.cache.set(line,entry);}nextCuts[index]=entry.cuts;return entry.sources;});this.cuts=nextCuts;
    if(!reset&&changed.size){for(let index=0;index<chart.judgeLineList.length;index++){let parent=index;const visited=new Set();while(parent>=0&&!visited.has(parent)){if(changed.has(parent)){changed.add(index);break;}visited.add(parent);parent=Number(chart.judgeLineList[parent]?.father??-1);}}for(const key of this.blocks.keys())if(changed.has(Number(key.split(':')[0])))this.blocks.delete(key);}
    this.versions=chart.judgeLineList.map((_,index)=>(this.versions?.[index]??0)+(reset||changed.has(index)?1:0));if(reset||changed.size)this.revision=(this.revision??0)+1;
  }
  state(line,beat,side='start'){let seconds=this.tempo.seconds(beat);if(side==='end')seconds-=1e-8;return this.scene.sampler(seconds,this.scale)(line);}
  block(lineIndex,first,last,error=.7,options){const task=this.buildBlock(lineIndex,first,last,error,options);let step;do{step=task.next();}while(!step.done);return step.value;}
  *buildBlock(lineIndex,first,last,error=.7,{includeTransparent=false}={}){
    const key=`${lineIndex}:${first}:${last}:${error}:${includeTransparent}`;if(this.blocks.has(key))return this.blocks.get(key);
    const sources=this.sources[lineIndex],cuts=new Set([first,last]);let start=Math.max(0,upperBound(sources,first,s=>s.beat)-1);while(start>0&&sources[start-1].beat>=first)start--;
    const collect=index=>{const times=this.cuts[index]??[];for(let i=upperBound(times,first,value=>value);i<times.length&&times[i]<last;i++)cuts.add(times[i]);};
    collect(lineIndex);let parent=Number(this.chart.judgeLineList[lineIndex]?.father??-1),visited=new Set([lineIndex]);while(parent>=0&&!visited.has(parent)&&visited.size<=this.sources.length){visited.add(parent);collect(parent);parent=Number(this.chart.judgeLineList[parent]?.father??-1);}
    const points=[],ordered=[...cuts].sort((a,b)=>a-b);
    const sample=(b,side)=>({beat:b,...this.state(lineIndex,b,side)});
    let work=0;
    for(let index=0;index<ordered.length-1;index++){
      const stack=[[sample(ordered[index],'start'),sample(ordered[index+1],'end'),0]];
      while(stack.length){
        const[a,b,depth]=stack.pop(),mid=sample((a.beat+b.beat)/2),q1=sample((a.beat*3+b.beat)/4),q3=sample((a.beat+b.beat*3)/4);
        const deviation=(point,k)=>Math.max(Math.hypot(point.x-(a.x+(b.x-a.x)*k),point.y-(a.y+(b.y-a.y)*k)),Math.abs(point.alpha-(a.alpha+(b.alpha-a.alpha)*k))/8,...point.color.map((value,axis)=>Math.abs(value-(a.color[axis]+(b.color[axis]-a.color[axis])*k))/8));
        const visible=Math.max(a.alpha,b.alpha,mid.alpha,q1.alpha,q3.alpha)>0;
        if(depth<9&&(deviation(mid,.5)>error||deviation(q1,.25)>error||deviation(q3,.75)>error||b.beat-a.beat>1))stack.push([mid,b,depth+1],[a,mid,depth+1]);
        else if(visible||includeTransparent)points.push([a,b]);
        if(++work%32===0)yield;
      }
    }
    const nodes=[];
    for(let i=start;i<sources.length&&sources[i].beat<=last;i++){if(++work%32===0)yield;const source=sources[i];if(source.beat<first)continue;const state={...this.state(lineIndex,source.beat,source.field)};if(source.type==='textEvents'){const factor=this.chart.judgeLineList[lineIndex].bpmfactor??1;state.text=this.scene.lines[lineIndex].extended.textEvents.sample({event:source.event,start:this.tempo.seconds(source.event.startTime,factor),end:this.tempo.seconds(source.event.endTime,factor)},source.seconds);}const previous=nodes.at(-1);if(previous&&Math.abs(previous.beat-source.beat)<1e-8&&Math.hypot(previous.x-state.x,previous.y-state.y)<1e-4&&Math.abs(previous.rotation-state.rotation)<1e-4&&Math.abs(previous.alpha-state.alpha)<1e-4&&Math.abs(previous.scaleX-state.scaleX)<1e-4&&Math.abs(previous.scaleY-state.scaleY)<1e-4&&previous.text===state.text){previous.sources.push(source);}else nodes.push({...state,beat:source.beat,lineIndex,sources:[source]});}
    const result={points,nodes,lineIndex,generation:this.versions?.[lineIndex]};if(this.blocks.size>=512)this.blocks.delete(this.blocks.keys().next().value);this.blocks.set(key,result);return result;
  }
  dispose(){this.blocks.clear();this.cache=new WeakMap();this.scene=new TransformScene();this.chart=null;this.sources=[];this.cuts=[];}
}

export class SpatialCamera {
  constructor(width,height,{tilt=25,size=.7,depth=180,past=2,progress=1}={}){this.width=width;this.height=height;this.cx=width/2;this.cy=height*(.5+.1*progress);this.angle=tilt*Math.PI/180*progress;this.s=Math.sin(this.angle);this.c=Math.cos(this.angle);this.depth=depth*progress;this.distance=Math.max(1000,height*1.8,past*depth*2);this.focal=this.distance*(1+(size-1)*progress);}
  sizeAt(point,beat,current,scale=1) { const p=this.project(point,beat,current,scale);return p?Math.max(.05,Math.min(6,this.distance/p.depth)):0; }
  project(point,beat,current,scale=1,result={}){const x=point.x*scale,y=point.y*scale,z=(beat-current)*this.depth,d=this.distance+z*this.c-y*this.s;if(d<=1)return null;result.x=this.cx+x*this.focal/d;result.y=this.cy-(y*this.c+z*this.s)*this.focal/d;result.depth=d;return result;}
  unproject(point,beat,current,scale=1){const z=(beat-current)*this.depth,u=point.x-this.cx,v=this.cy-point.y,den=this.focal*this.c+v*this.s;if(Math.abs(den)<1e-8)return null;const y=(v*(this.distance+z*this.c)-this.focal*z*this.s)/den,d=this.distance+z*this.c-y*this.s;if(d<=1)return null;return{x:u*d/this.focal/scale,y:y/scale};}
  matrix(delta=0){const q=this.s/this.distance,k=this.focal/this.distance,w=this.width,h=this.height,cx=this.cx,cy=this.cy,z=delta*this.depth,base=1+z*this.c/this.distance;return`matrix3d(${[k,0,0,0,cx*q,k*this.c+cy*q,0,q,0,0,1,0,cx*(base-q*h/2)-k*w/2,cy*(base-q*h/2)-k*this.c*h/2-k*z*this.s,0,base-q*h/2].join(',')})`;}
}
