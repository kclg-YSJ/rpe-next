import { TimelineActivity } from '@rpen/core/timeline-activity.mjs';

// One-second moving windows from the host's existing start-time indexes. No
// chart cloning, per-note objects or per-frame chart scan is introduced.
function movingCounts(times, bins, duration) {
  const delta = new Float64Array(bins + 1), result = new Uint32Array(bins), unit = duration / bins;
  for (const seconds of times ?? []) {
    if (!Number.isFinite(seconds) || seconds + .5 < 0 || seconds - .5 > duration) continue;
    const first = Math.max(0, Math.ceil((seconds - .5) / unit - .5));
    const last = Math.min(bins - 1, Math.floor((seconds + .5) / unit - .5));
    if (first <= last) { delta[first]++; delta[last + 1]--; }
  }
  let total = 0; for (let i = 0; i < bins; i++) { total += delta[i]; result[i] = total; }
  return result;
}

export function installDensity(api, state) {
  let previous = null, processed = null;
  api.patch(TimelineActivity.prototype, 'density', original => function(lineIndex, layer, extended, duration, height) {
    const base = original.call(this, lineIndex, layer, extended, duration, height);
    if (!state.active || api.editor.session.largeDocument || this.chart !== api.editor.chart) return base;
    if (previous === base) return processed;
    const line = this.lines[lineIndex], bins = base.bins;
    const noteBins = movingCounts(line?.activity.notes, bins, duration);
    const eventTimes = extended ? line?.activity.special.times ?? [] : line?.activity.layers[layer]?.times ?? [];
    const eventBins = movingCounts(eventTimes, bins, duration);
    if (extended) {
      const shaderBins = movingCounts(line?.shaderTimes, bins, duration);
      for (let i=0;i<bins;i++) eventBins[i] += shaderBins[i];
    }
    let maximum = 1; for (let i=0;i<bins;i++) maximum = Math.max(maximum,noteBins[i],eventBins[i]);
    previous = base; processed = {key:base.key,bins,noteBins,eventBins,maximum}; return processed;
  });
  const canvas = document.querySelector('#note-density'), contexts = new WeakMap(), pictures = new WeakMap();
  const recolor = source => {
    if (pictures.has(source)) return pictures.get(source);
    if (!source?.getContext || !(source.width > 0 && source.height > 0)) return source;
    const input = source.getContext('2d'), data = input.getImageData(0,0,source.width,source.height);
    for (let i=0;i<data.data.length;i+=4) {
      const alpha = data.data[i+3]/255;
      data.data[i] = 204; data.data[i+1] = 178; data.data[i+2] = 0;
      data.data[i+3] = Math.round(alpha * alpha * 255);
    }
    const output = document.createElement('canvas'); output.width=source.width; output.height=source.height;
    output.getContext('2d').putImageData(data,0,0); pictures.set(source,output); return output;
  };
  api.patch(canvas,'getContext', original => function(type,...args) {
    const context = original.call(this,type,...args); if(type!=='2d'||!context)return context;
    if(!contexts.has(context)) {
      const methods = new Map();
      contexts.set(context,new Proxy(context,{
        get(target,key) {
          const value=Reflect.get(target,key,target); if(typeof value!=='function')return value;
          if(!methods.has(key)) methods.set(key,(...values)=>{
            if(key==='drawImage'&&state.active) values[0]=recolor(values[0]);
            return value.apply(target,values);
          });
          return methods.get(key);
        },
        set(target,key,value){return Reflect.set(target,key,value,target);}
      }));
    }
    return contexts.get(context);
  });
  api.dispose(()=>{previous=null;processed=null;});
}
