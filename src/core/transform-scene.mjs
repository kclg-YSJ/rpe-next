import { SceneRuntime, LineRuntime } from './scene.mjs';
import { EventTrack } from './events.mjs';
import { trajectoryHasRotation } from './curve-trajectory.mjs';

// Share the ordinary evaluator and parent resolution; never construct note or speed indexes.
class TransformLine {
  constructor(line, tempo) {
    this.line = line; const factor = line.bpmfactor ?? 1;
    this.tracks = Object.fromEntries(['moveXEvents','moveYEvents','rotateEvents','alphaEvents'].map(type => [type, (line.eventLayers ?? []).map(layer => {
      const virtual = ['moveYEvents','rotateEvents'].includes(type) ? (layer?.moveXEvents ?? []).filter(e => e.trajectory && (type !== 'rotateEvents' || trajectoryHasRotation(e.trajectory.options))).map(e => ({ ...e, trajectoryAxis: type === 'moveYEvents' ? 'y' : 'rotation' })) : [];
      return new EventTrack([...(layer?.[type] ?? []), ...virtual], tempo, factor);
    })]));
    const color = line.attachUI || line.extended?.textEvents?.length || line.Texture && line.Texture !== 'line.png' ? [255,255,255] : [241,216,148];
    this.extended = Object.fromEntries(Object.entries({scaleXEvents:1,scaleYEvents:1,colorEvents:color,textEvents:'',inclineEvents:0}).map(([type,fallback]) => [type,new EventTrack(line.extended?.[type],tempo,factor,fallback)]));
  }
  floor() { return 0; }
  value(...args) { return LineRuntime.prototype.value.apply(this,args); }
  state(...args) { return LineRuntime.prototype.state.apply(this,args); }
}
export class TransformScene extends SceneRuntime {
  constructor(){super();this.samples=new Map();}
  compile(chart,tempo) {
    if (this.chart === chart && this.tempo === tempo) return;
    this.samples.clear();
    if (this.tempo !== tempo) this.cache = new WeakMap();
    const previous=this.lines,oldTempo=this.tempo;this.chart=chart; this.tempo=tempo;
    this.lines=(chart.judgeLineList ?? []).map((line,index) => {const old=previous?.[index];if(oldTempo===tempo&&old&&old.line.eventLayers===line.eventLayers&&old.line.extended===line.extended&&old.line.bpmfactor===line.bpmfactor&&old.line.Texture===line.Texture&&old.line.attachUI===line.attachUI){if(old.line===line)return old;const runtime=Object.assign(Object.create(TransformLine.prototype),{line,tracks:old.tracks,extended:old.extended});this.cache.set(line,runtime);return runtime;}if(!this.cache.has(line)) this.cache.set(line,new TransformLine(line,tempo));return this.cache.get(line); });
  }
  sampler(seconds,scale={x:1,y:1}) {
    const key=`${seconds}:${scale.x}:${scale.y}`;let sample=this.samples.get(key);if(sample)return sample;
    sample=super.sampler(seconds,scale);const limit=Math.max(8,Math.min(256,Math.floor(32000/Math.max(1,this.lines.length))));if(this.samples.size>=limit)this.samples.delete(this.samples.keys().next().value);this.samples.set(key,sample);return sample;
  }
}
