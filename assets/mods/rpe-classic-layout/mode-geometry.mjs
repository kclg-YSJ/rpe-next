import { installGeometry } from './geometry.mjs';

// Legacy routines also use scale and judgementOffset directly. Give only those
// synchronous routines a physical view. Writes forward to their real owner;
// preferences and native session callbacks continue to see the logical values.
function physicalView(timeline, state, offset) {
  const target = Object.create(timeline);
  Object.defineProperties(target, {
    scale: {configurable:true,get:()=>timeline.scale*state.scale},
    judgementOffset: {configurable:true,get:()=>offset?offset():timeline.viewHeight()-timeline.baseline()}
  });
  for (const key of ['baseline','vertical','verticalForLine','timeAt','beatAt','rectangleStart','rectangleTimes','horizontalScale']) {
    target[key] = (...args)=>timeline[key](...args);
  }
  const proxy=new Proxy(target,{set(_target,key,value,receiver){
    // Native background transactions can create Object.create(this) snapshots.
    // Their overrides belong to that snapshot, never to the live timeline.
    if(receiver!==proxy)return Reflect.defineProperty(receiver,key,{value,writable:true,enumerable:true,configurable:true});
    return Reflect.set(timeline,key,value,timeline);
  }});
  return proxy;
}

export function installModeGeometry(api,state) {
  const source=api.editor.timeline,global=api.editor.globalEvents;
  if(global?.timeline)installGeometry(api,state,global.timeline,{global:true});
  const views=new WeakMap();
  const view=timeline=>{
    if(!views.has(timeline))views.set(timeline,physicalView(timeline,state));
    return views.get(timeline);
  };
  // Batch controls convert pointer positions independently of the timeline's
  // drag handlers. Give them the same physical scale as the displayed grid.
  const controls=api.editor.batchControls;
  if(controls){
    const physicalControls=Object.create(controls);
    Object.defineProperty(physicalControls,'timeline',{value:view(source)});
    api.patch(controls,'snappedPointerBeat',previous=>function(...args){
      return previous.apply(state.active&&!source.noteView?physicalControls:this,args);
    });
  }
  for(const timeline of [source,global?.timeline].filter(Boolean)){
    const applies=()=>state.active&&!timeline.noteView;
    for(const key of ['movedNote','move','up','updateRectangle','autoScroll','gridForLine','drawMultiLineBeatLabels','drawMultiLineEvents']){
      api.patch(timeline,key,previous=>function(...args){return previous.apply(applies()&&(this===timeline||this===view(timeline))?view(timeline):this,args);});
    }
    const interaction=timeline.eventInteraction,target=Object.create(interaction);
    Object.defineProperty(target,'timeline',{value:view(timeline)});
    const physicalInteraction=new Proxy(target,{set(_target,key,value){return Reflect.set(interaction,key,value,interaction);}});
    for(const key of ['previewEvent','delta','move','up'])api.patch(interaction,key,previous=>function(...args){return previous.apply(applies()?physicalInteraction:this,args);});
  }
  const noise=api.editor.noiseEditor;
  if(noise?.getContext){
    let last=null,adapted=null;const noiseViews=new WeakMap();
    api.patch(noise,'getContext',previous=>function(...args){
      const context=previous.apply(this,args);
      if(!state.active)return context;
      if(context!==last){
        last=context;const source=context.timeline;
        if(!noiseViews.has(source))noiseViews.set(source,physicalView(source,state,()=>source.judgementOffset*(100*900/1080/92)*state.scale));
        adapted={...context,timeline:noiseViews.get(source)};
      }
      return adapted;
    });
    api.patch(noise,'layout',previous=>function(){
      if(!state.active)return previous.call(this);
      if(this.drawingLayout)return this.drawingLayout;
      const {width,height}=this.canvas.getBoundingClientRect(),split=width*600/1262.4,eventLeft=split+62.4*state.scale;
      return {width,height,split,eventLeft,eventWidth:Math.max(1,(width-eventLeft)/6)};
    });
  }
  state.physicalTimeline=view;
}
