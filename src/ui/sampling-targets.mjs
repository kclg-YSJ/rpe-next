import { TransformScene } from '../core/transform-scene.mjs';
import { noiseRuntime } from '../core/noise-areas.mjs';
import { previewNoisePoint } from '../core/editor-display.mjs';
export class SamplingTargets {
  constructor() { this.scene=new TransformScene(); }
  get(chart,tempo,seconds,positionScale,{lineIndex=-1,areaIndex=-1,renderer}={}) {
    if(this.chart===chart&&this.tempo===tempo&&this.seconds===seconds&&this.scale?.x===positionScale.x&&this.scale?.y===positionScale.y&&this.excluded===`${lineIndex}:${areaIndex}`) return this.targets;
    this.scene.compile(chart,tempo); const sample=this.scene.sampler(seconds,positionScale), result=[];
    for(let index=0;index<this.scene.lines.length;index++){if(index===lineIndex||chart.judgeLineList[index].attachUI)continue;const state=sample(index);if(state.alpha>0)result.push({id:`line:${index}`,x:state.x,y:state.y,rotation:state.rotation});}
    for(let index=0;index<(chart.blockAreaList?.length??0);index++){if(index===areaIndex)continue;const area=chart.blockAreaList[index];const state=noiseRuntime(area,tempo).sample(seconds);if(!(state.alpha>0)||state.state==='hiddenBefore'||state.state==='hiddenAfter')continue;const points=[state.center,...state.points,...state.points.map((p,i)=>({x:(p.x+state.points[(i+1)%4].x)/2,y:(p.y+state.points[(i+1)%4].y)/2}))];points.forEach((p,i)=>{const q=previewNoisePoint(p,state,positionScale);result.push({id:`area:${index}:${i}`,x:q.x,y:q.y,rotation:state.rotation*180/Math.PI});});}
    if(renderer?.viewScale)for(const [index,hit] of (renderer.noteHitAreas??[]).entries()){if(hit.lineIndex===lineIndex)continue;for(const end of ['1','2'])result.push({id:`note:${index}:${end}`,x:(hit[`x${end}`]-renderer.canvas.clientWidth/2)/renderer.viewScale,y:(renderer.canvas.clientHeight/2-hit[`y${end}`])/renderer.viewScale});}
    result.push({id:'origin',x:0,y:0,rotation:0},{id:'lower',x:-675*positionScale.x,y:-450*positionScale.y},{id:'upper',x:675*positionScale.x,y:450*positionScale.y});
    this.chart=chart;this.tempo=tempo;this.seconds=seconds;this.scale=positionScale;this.excluded=`${lineIndex}:${areaIndex}`;return this.targets=result;
  }
}
