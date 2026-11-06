import { SpatialTracks, SpatialCamera } from '../core/spatial-track.mjs';
import { changeSpatialSource,changeSpatialPosition,changeSpatialEasing,deleteSpatialNode,insertSpatialNode,placeSpatialSpan,spatialSourceValue,ensureSpatialProperty } from '../application/spatial-edit.mjs';
import { eventListAt, selectEvent } from '../application/event-commands.mjs';
import { previewPositionScale, previewViewport } from '../core/editor-display.mjs';
import { prepareCanvas } from './timeline.mjs';
import { samplingPreferences } from '../platform/sampling-preferences.mjs';
import { snapSamplePoint, snapSampleAngle, unwrapAngle, sampleInBasis, sampleFromBasis } from '../core/sampling-grid.mjs';
import { buildSpatialPanel } from './spatial-panel.mjs';
import { displayNumber, displayPosition, spatialBoundaryFade } from './spatial-display.mjs';
import { drawSamplingGrid } from './sampling-guides.mjs';
import { SamplingTargets } from './sampling-targets.mjs';
import { localPreferences } from '../platform/local-preferences.mjs';
import { parseBeat, formatBeat, fromNumber, beatValue } from '../core/beat.mjs';
import { t } from '../i18n.mjs';
import { SpatialGhosts } from './spatial-ghosts.mjs';
import { evaluateNumericExpression } from '../core/numeric-expression.mjs';

const RANGES={tilt:[0,65],future:[1,128],past:[0,32],size:[.3,.95],depth:[15,180],width:[.5,8],nodeSize:[2,9],fade:[.25,8]};
const DEFAULTS={tilt:25,future:16,past:2,size:.7,depth:180,width:2,nodeSize:4,notes:false,fade:1.5,animation:true,continuous:true,perspective:true,highlightPlane:true,forceOpaque:false,nodeNumbers:false,planeLines:true,planeNotes:true,planeHits:true,planeUI:true,planeNumbers:true,planeArrows:true,planeNoise:true,planeShaders:true};
const text=(tag,value,cls)=>{const n=document.createElement(tag);if(value)n.textContent=value;if(cls)n.className=cls;return n;};
const rounded=n=>Math.round(n*1000)/1000;
const isX=s=>s.axis==='x'||!s.axis&&s.type==='moveXEvents',isY=s=>s.axis==='y'||!s.axis&&s.type==='moveYEvents';
export class SpatialPreview {
  constructor(host,getContext,actions){
    this.host=host;this.getContext=getContext;Object.assign(this,actions);this.options={...DEFAULTS};
    try{const saved=JSON.parse(localPreferences.getItem('rpen-spatial-v1')||'{}');for(const key of Object.keys(DEFAULTS))if(typeof saved[key]===typeof DEFAULTS[key]&&(typeof saved[key]!=='number'||Number.isFinite(saved[key])))this.options[key]=RANGES[key]?Math.max(RANGES[key][0],Math.min(RANGES[key][1],saved[key])):saved[key];}catch{}
    this.visible=false;this.progress=0;this.target=0;this.layers=new Map();this.projectionPool=new WeakMap();this.segmentPool=[];this.renderPanel();
  }
  get context(){return this.getContext();}
  get animating(){if(!this.visible||this.suspended||!this.interactive)return false;return this.progress!==this.target||Boolean(this.jobs&&this.jobIndex<this.jobs.length)||Boolean(this.ghosts?.pending);}
  save(){localPreferences.setItem('rpen-spatial-v1',JSON.stringify(this.options));this.invalidate();}
  get interactive(){return this.context.previewVisible;}
  open(){this.activate('spatial');this.syncInspector();}
  field(parent,key,type,min,max,step){const label=text('label',null,'field'),name=text('span',t(`spatial.${key}`)),input=document.createElement('input');input.type=type;input.dataset.spatial=key;
    const output=type==='range'?text('small',String(this.options[key])):null;if(output){output.className='spatial-range-value';name.append(output);}if(type==='checkbox')input.checked=this.options[key];else{input.min=min;input.max=max;input.step=step;input.value=this.options[key];}
    input.oninput=()=>{const value=type==='checkbox'?input.checked:input.valueAsNumber;if(type!=='checkbox'&&(!Number.isFinite(value)||value<min||value>max))return;this.options[key]=value;if(output)output.textContent=String(value);this.save();if(!key.startsWith('plane'))this.geometry=null;};label.append(name,input);parent.append(label);return input;
  }
  renderPanel(){buildSpatialPanel(this);}
  lineFilterChanged(){const filter=this.lineControls?.resolve();if(filter){if(this.selected&&!filter.has(this.selected.lineIndex)||this.pending&&!filter.has(this.pending.lineIndex))this.deselect();if(this.hover&&!filter.has(this.hover.lineIndex))this.clearPointer();}this.geometry=null;this.hitNodes=[];this.hitSegments=[];this.pickIndex=null;this.invalidate();}
  lineAllowed(index){const filter=this.lineControls?.resolve();return !filter||filter.has(index);}
  setPlane(value){try{this.indicated=beatValue(parseBeat(value));this.cursor=null;this.invalidate();}catch(error){this.fail(error);}}
  resetView(){Object.assign(this.options,{tilt:25,size:.7,depth:180,past:2,perspective:true});this.renderPanel();this.save();}
  editingPlane(current){return(this.drag?this.liveSelected?.beat??this.drag.selected.beat:undefined)??this.indicated??this.pointerBeat??this.selected?.beat??current;}
  hideAll(){this.deselect();this.clearPointer();for(const renderer of this.layers.keys())this.hideRenderer(renderer);this.hitNodes=[];this.hitSegments=[];this.pickIndex=null;}
  clearPointer(){this.cursor=null;this.hover=null;this.readout=null;this.pointerBeat=null;this.pointerLocation=null;for(const layer of this.layers.values())if(layer.tooltip)layer.tooltip.hidden=true;}
  deselect(){this.cancel();this.selected=null;this.liveSelected=null;this.source=null;this.reselect=null;this.indicated=null;this.overlaps=[];if(this.overlapSelect)this.overlapSelect.hidden=true;this.syncInspector();this.invalidate();}
  selectNode(node){if(!node||!this.lineAllowed(node.lineIndex))return;
    const session=this.context.session;
    if(this.easingDraft){this.cancelEasingPreview();const sources=node.sources.map(s=>({...s,event:eventListAt({chart:session.chart,eventLayer:s.layer},s.lineIndex,s.type)[s.index]})).filter(s=>s.event);if(!sources.length)return;this.tracks.compile(session.chart,this.context.tempo,this.positionScale);node={...node,...this.tracks.state(node.lineIndex,node.beat,sources[0].field),sources};}
    this.selected=node;this.selectionChart=session.chart;this.source=node.sources.find(s=>s.layer===session.eventLayer)??node.sources[0];this.indicated=node.beat;session.lineIndex=node.lineIndex;session.eventLayer=this.source.layer;this.context.timeline.layer=this.source.layer;selectEvent(session,node.lineIndex,this.source.type,this.source.index,{replace:true});this.activate('spatial');session.notify();this.syncInspector();this.invalidate();}
  selectionReference(chart,source=this.source,trustIndex=false){
    if(!source||!chart.judgeLineList[source.lineIndex])return null;
    const list=eventListAt({chart,eventLayer:source.layer},source.lineIndex,source.type),index=trustIndex?source.index:list.indexOf(source.event),event=list[index];if(!event)return null;
    const tempo=this.context.tempo,beat=tempo.beat(tempo.seconds(event[source.field==='start'?'startTime':'endTime'],chart.judgeLineList[source.lineIndex].bpmfactor??1));
    return{lineIndex:source.lineIndex,beat,source:{...source,index,event,beat}};
  }
  hideRenderer(renderer){const layer=this.layers.get(renderer);if(layer)for(const canvas of layer.canvases){canvas.hidden=true;const ctx=canvas.getContext?.('2d');ctx?.clearRect(0,0,canvas.width,canvas.height);}if(layer?.tooltip)layer.tooltip.hidden=true;if(layer?.highlights)layer.highlights.style.display='none';for(const canvas of [renderer.canvas,renderer.shaderCanvas,renderer.overlayCanvas])if(canvas){canvas.style.transform='';canvas.style.transformOrigin='';canvas.style.zIndex=canvas===renderer.overlayCanvas?'2':canvas===renderer.shaderCanvas?'1':'';}renderer.spatialForeground=false;renderer.spatialElements=null;this.ghosts?.hide(renderer);}
  start(){if(this.visible&&this.target)return;this.selected=null;this.source=null;this.visible=true;this.target=1;this.ownerSession=this.context.session;this.tracks??=new SpatialTracks();this.targets??=new SamplingTargets();this.indicated=null;this.enable.checked=true;this.context.showPreview?.();this.epoch=performance.now();this.onBlur??=()=>{if(this.drag||this.draft){this.cancel();this.syncInspector();}};window.addEventListener('blur',this.onBlur);this.invalidate();}
  disable(immediate=false){this.cancel();this.target=0;this.enable.checked=false;this.epoch=performance.now();this.jobs=[];if(immediate||!this.options.animation||!this.interactive){this.progress=0;this.cleanup();}this.invalidate();}
  cleanup(){this.progress=this.target=0;window.removeEventListener('blur',this.onBlur);for(const [renderer,layer]of this.layers){layer.tooltip?.remove();layer.highlights?.remove();for(const canvas of layer.canvases){canvas.width=canvas.height=1;canvas.remove();}for(const canvas of [renderer.canvas,renderer.shaderCanvas,renderer.overlayCanvas])if(canvas){canvas.style.transform='';canvas.style.transformOrigin='';canvas.style.zIndex=canvas===renderer.overlayCanvas?'2':canvas===renderer.shaderCanvas?'1':'';}renderer.spatialForeground=false;renderer.spatialElements=null;}this.layers.clear();this.hitNodes=[];this.hitSegments=[];this.segmentPool=[];this.projectionPool=new WeakMap();this.lastLayer=null;this.pickIndex=null;this.pickMemo=null;this.snap=null;this.cursor=null;this.readout=null;this.overlaps=[];this.overlapSelect.hidden=true;this.tracks?.dispose();this.tracks=null;this.targets=null;this.ghosts?.dispose();this.ghosts=null;this.geometry=null;this.inputBase=null;this.selectionChart=null;this.ownerSession=null;this.liveSelected=null;this.visible=false;this.selected=null;this.source=null;this.reselect=null;this.jobs=[];this.jobIndex=0;this.syncInspector();}
  before(renderer){
    if(!this.visible)return;
    const base=this.drag?.base??(this.draft?this.inputBase:null);
    if(base&&base!==this.context.session.chart){this.deselect();this.fail(Error(t('spatial.stale')));}
    this.suspended=Boolean(this.context.sampling?.());
    const active=!this.suspended&&this.interactive;
    if(!active||!renderer.visible){this.hideRenderer(renderer);return;}
    renderer.spatialForeground=true;
    renderer.spatialElements=this.options;
    for(const [other]of this.layers)if(other!==renderer)this.hideRenderer(other);
    for(const canvas of this.layers.get(renderer)?.canvases??[])canvas.hidden=false;
  }
  surfaces(renderer){
    const parent=renderer.canvas.parentElement;let layer=this.layers.get(renderer);if(layer&&layer.parent===parent)return layer;
    if(layer){layer.tooltip?.remove();layer.highlights?.remove();for(const n of layer.canvases)n.remove();}
    const far=text('canvas',null,'spatial-layer spatial-far'),near=text('canvas',null,'spatial-layer spatial-near');const tooltip=document.createElement('output');tooltip.className='spatial-pointer-readout';tooltip.hidden=true;const highlights=document.createElementNS('http://www.w3.org/2000/svg','svg');highlights.classList.add('spatial-plane-highlights');highlights.setAttribute('aria-hidden','true');parent.append(far,near,highlights,tooltip);layer={parent,far,near,tooltip,highlights,highlightRects:[],canvases:[far,near]};this.layers.set(renderer,layer);
    const input=event=>this.pointer(event,renderer);for(const name of ['pointerdown','pointermove','pointerup','pointercancel','wheel','contextmenu','pointerleave'])near.addEventListener(name,input,{passive:false});
    return layer;
  }
  draw(renderer,chart,tempo,seconds){
    if(!this.visible||!renderer.visible||this.suspended||!this.interactive)return;if(this.context.locked?.()){this.disable(true);return;}if(this.ownerSession!==this.context.session){this.disable(true);return;}
    if(this.selected&&!this.draft&&this.selectionChart&&this.selectionChart!==this.context.session.chart){this.reselect=this.selectionReference(this.context.session.chart);this.selected=null;this.source=null;this.indicated=null;this.syncInspector();}
    const timestamp=performance.now(),amount=this.options.animation&&!matchMedia('(prefers-reduced-motion: reduce)').matches?Math.min(1,(timestamp-this.epoch)/280):1;
    if(this.progress!==this.target){this.progress=this.target?Math.min(1,this.progress+amount):Math.max(0,this.progress-amount);this.epoch=timestamp;}
    if(!this.target&&this.progress<.001){this.cleanup();return;}
    const layer=this.surfaces(renderer);layer.near.style.pointerEvents='auto';layer.far.style.zIndex='1';layer.near.style.zIndex='4';layer.tooltip.style.zIndex='8';
    const {context:far,width,height}=prepareCanvas(layer.far),{context:near}=prepareCanvas(layer.near);if(!(width>0&&height>0))return;
    const scale=renderer.viewScale??previewViewport(width,height,renderer.aspectRatio??1.5).scale/(renderer.viewDivisor??1),current=tempo.beat(seconds),camera=new SpatialCamera(width,height,{...this.options,progress:this.progress});
    layer.camera=camera;layer.current=current;layer.scale=scale;layer.renderer=renderer;layer.chart=chart;layer.tempo=tempo;
    for(const canvas of [renderer.canvas,renderer.shaderCanvas,renderer.overlayCanvas])if(canvas){canvas.style.transformOrigin='0 0';canvas.style.transform=camera.matrix();canvas.style.zIndex=canvas===renderer.overlayCanvas?'3':'2';}
    const display=this.draft??chart,positionScale=previewPositionScale(renderer.aspectRatio??1.5);this.tracks.compile(display,tempo,positionScale);this.positionScale=positionScale;
    const filter=this.lineControls.resolve();this.lineControls.sync();const filterKey=filter?[...filter].join(','):'*';if(this.selected&&filter&&!filter.has(this.selected.lineIndex))this.deselect();
    const first=Math.floor((current-this.options.past)/4)*4,last=Math.ceil((current+this.options.future)/4)*4;
    const signature=[this.tracks.revision,tempo,first,last,renderer.aspectRatio,filterKey,this.options.forceOpaque];
    if(!this.geometry||signature.some((v,i)=>v!==this.geometry.signature[i])){const old=this.geometry;this.geometry={signature,blocks:new Map()};this.jobs=[];this.jobIndex=0;for(const index of filter??display.judgeLineList.keys())for(let a=first;a<last;a+=4){const key=index+':'+a,cached=old?.blocks.get(key);if(cached&&old.signature[1]===tempo&&old.signature[4]===renderer.aspectRatio&&cached.generation===this.tracks.versions[index]&&old.signature[6]===this.options.forceOpaque)this.geometry.blocks.set(key,cached);else this.jobs.push({index,a});}}
    const until=performance.now()+4;
    while(this.jobIndex<this.jobs.length&&performance.now()<until){const job=this.jobs[this.jobIndex];job.task??=this.tracks.buildBlock(job.index,job.a,job.a+4,1/Math.max(.05,scale),{includeTransparent:this.options.forceOpaque});const step=job.task.next();if(step.done){this.geometry.blocks.set(`${job.index}:${job.a}`,step.value);job.task=null;this.jobIndex++;}}
    if(this.selected&&this.selected.beat>=current-this.options.past&&this.selected.beat<=current+this.options.future){const beat=this.drag?.selected.beat??this.selected.beat,view={projective:true,scale,screen:p=>camera.project(p,beat,current,scale)??{x:-100000,y:-100000},world:p=>camera.unproject(p,beat,current,scale)};drawSamplingGrid(near,view,{rotation:this.drag?.kind==='rotation',center:this.selected,positionScale,basis:this.dragBasis});}
    this.hitNodes=[];this.hitSegments=[];const drawnNodes=new Set();far.globalAlpha=near.globalAlpha=this.progress;this.drawTimeGrid(far,camera,current,scale,renderer.viewport);
    const project=(p,b=p.beat)=>{let result=this.projectionPool.get(p);if(!result){result={};this.projectionPool.set(p,result);}const mapping=renderer.spatialMapping,mapped=mapping?mapping.project(p,tempo.seconds(b),{width,height,scale},display,tempo):p;return mapped?camera.project(mapped,b,current,scale,result):null;};layer.project=project;const batches=new Map();let segmentIndex=0;
    const low=current-this.options.past,high=current+this.options.future,fadeAt=beat=>spatialBoundaryFade(beat,current,this.options.past,this.options.future);this.fadeAt=fadeAt;
    for(const block of this.geometry.blocks.values()){if(filter&&!filter.has(block.lineIndex))continue;const line=display.judgeLineList[block.lineIndex],pack=renderer.skin?.resourcePack?.perfectColor,packColor=pack&&(!line.Texture||line.Texture==='line.png')&&!line.attachUI&&!line.extended?.textEvents?.length&&!line.extended?.colorEvents?.length?pack:null;
      for(const[a,b]of block.points){if(b.beat<low||a.beat>high)continue;const p=project(a),q=project(b);if(!p||!q)continue;const ctx=(a.beat+b.beat)/2<current?near:far;const color=s=>{if(s.strokePack!==packColor||s.strokeOpaque!==this.options.forceOpaque||!s.stroke){s.strokePack=packColor;s.strokeOpaque=this.options.forceOpaque;s.stroke=`rgba(${(packColor?.rgb??s.color).map(v=>Math.max(0,Math.min(255,Math.round(v)))).join(',')},${this.options.forceOpaque?1:Math.max(0,Math.min(1,s.alpha/255*(packColor?.alpha??1)))})`;}return s.stroke;};const fadeA=fadeAt(a.beat),fadeB=fadeAt(b.beat);if(fadeA<=0&&fadeB<=0)continue;const ca=fadeA===1?color(a):`rgba(${(packColor?.rgb??a.color).map(Math.round).join(',')},${(this.options.forceOpaque?1:Math.max(0,Math.min(1,a.alpha/255*(packColor?.alpha??1))))*fadeA})`,cb=fadeB===1?color(b):`rgba(${(packColor?.rgb??b.color).map(Math.round).join(',')},${(this.options.forceOpaque?1:Math.max(0,Math.min(1,b.alpha/255*(packColor?.alpha??1))))*fadeB})`;const width=this.options.width*(this.options.perspective?camera.sizeAt({x:(a.x+b.x)/2,y:(a.y+b.y)/2},(a.beat+b.beat)/2,current,scale):1);if(ca!==cb){const gradient=ctx.createLinearGradient(p.x,p.y,q.x,q.y);gradient.addColorStop(0,ca);gradient.addColorStop(1,cb);ctx.strokeStyle=gradient;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.stroke();}else{const key=block.lineIndex+':'+(ctx===near?'near':'far')+':'+ca+':'+Math.round(width*20);let batch=batches.get(key);if(!batch){batch={ctx,style:ca,width,segments:[]};batches.set(key,batch);}batch.segments.push(this.segmentPool[segmentIndex]??(this.segmentPool[segmentIndex]={}));}let hit=this.segmentPool[segmentIndex];if(!hit)this.segmentPool[segmentIndex]=hit={};Object.assign(hit,{a,b,p,q,lineIndex:block.lineIndex});this.hitSegments.push(hit);segmentIndex++;}
      for(const node of block.nodes){if(node.beat<low||node.beat>high||fadeAt(node.beat)<=0)continue;const nodeKey=[node.lineIndex,node.beat,rounded(node.x),rounded(node.y),rounded(node.rotation),rounded(node.alpha),node.text].join(':');if(drawnNodes.has(nodeKey))continue;drawnNodes.add(nodeKey);const p=project(node);if(!p)continue;this.hitNodes.push({...node,screen:p,screenScale:this.options.perspective?camera.sizeAt(node,node.beat,current,scale):1,displayColor:packColor?.rgb??node.color});}
    }
    for(const batch of batches.values()){const ctx=batch.ctx;ctx.strokeStyle=batch.style;ctx.lineWidth=batch.width;ctx.beginPath();for(const{p,q}of batch.segments){ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);}ctx.stroke();}
    if(this.draft&&this.selected){const source=this.source,live=this.hitNodes.find(n=>n.lineIndex===this.selected.lineIndex&&n.sources.some(s=>s.type===source.type&&s.layer===source.layer&&s.index===source.index&&s.field===source.field&&s.axis===source.axis));if(live){this.liveSelected=live;this.syncLiveInspector(live);}}else this.liveSelected=null;
    this.editPlaneBeat=this.editingPlane(current);
    for(const node of this.hitNodes)this.drawNode(node.beat<current?near:far,node,node.screen,project,camera,current,scale);
    this.drawPlaneHighlights(layer);
    const viewport=renderer.viewport??previewViewport(width,height,renderer.aspectRatio??1.5);this.frame(near,camera,current,current,scale,viewport,'#ffffff',1);this.planeCaption(near,camera,current,current,scale,viewport,t('spatial.currentPlane'));
    const pointed=this.editPlaneBeat;if(document.activeElement!==this.planeInput)this.planeInput.value=displayNumber(pointed);if(this.cursor||this.selected||this.indicated!==null&&this.indicated!==undefined){this.frame(near,camera,pointed,current,scale,viewport,'#ffffffaa',2);this.planeCaption(near,camera,pointed,current,scale,viewport,t('spatial.editPlane')); const p=this.cursor?project(this.cursor,pointed):null;if(p){near.strokeStyle='#e7d295';near.beginPath();near.moveTo(p.x-7,p.y);near.lineTo(p.x+7,p.y);near.moveTo(p.x,p.y-7);near.lineTo(p.x,p.y+7);near.stroke();}}
    if(this.options.notes)this.drawGhosts(far,renderer,current,tempo,camera,scale);else if(this.ghosts){this.ghosts.dispose();this.ghosts=null;}
    if(this.pending){this.message.textContent=t('spatial.pending');}
    else if(this.jobIndex<this.jobs.length)this.message.textContent=t('spatial.loading');
    else if(!this.error)this.message.textContent='';this.sampling.readout.hidden=true;
    this.sampling.sync(this.drag?.kind==='rotation'||this.channel.value==='rotateEvents','');this.updateTooltip(layer);
    if(this.reselect){const old=this.reselect.source,matches=s=>s.event===old.event&&s.type===old.type&&s.layer===old.layer&&s.field===old.field&&s.axis===old.axis;const n=this.hitNodes.find(n=>n.lineIndex===this.reselect.lineIndex&&n.sources.some(matches));if(n){this.selected=n;this.source=n.sources.find(matches);this.indicated=n.beat;this.selectionChart=this.context.session.chart;this.reselect=null;this.syncInspector();}else if(this.jobIndex>=this.jobs.length)this.reselect=null;}this.lastLayer=layer;this.pickIndex=null;const pickMemo=[display,current,width,height,this.options.tilt,this.options.size,this.options.depth,this.progress];if(!this.pickMemo||pickMemo.some((v,i)=>v!==this.pickMemo[i])){this.pickMemo=pickMemo;this.pickIndex=null;}
  }
  drawTimeGrid(ctx,camera,current,scale,viewport){
    if(!viewport)return;const low=current-this.options.past,high=current+this.options.future,step=Math.max(1,Math.ceil((high-low)/14));
    ctx.save();ctx.font='11px sans-serif';
    for(let beat=Math.ceil(low/step)*step;beat<high;beat+=step){if(Math.abs(beat-current)<1e-7)continue;const fade=spatialBoundaryFade(beat,current,this.options.past,this.options.future);if(fade<=0)continue;ctx.globalAlpha=this.progress*fade*.22;this.frame(ctx,camera,beat,current,scale,viewport,'#dce4ed',1);if(Math.round(beat/step)%3===0)this.planeCaption(ctx,camera,beat,current,scale,viewport,t('spatial.beatReadout',{beat:displayNumber(beat)}));}
    ctx.restore();
  }
  planeCaption(ctx,camera,beat,current,scale,viewport,label){const point=camera.project({x:-viewport.width/2/viewport.scale,y:viewport.height/2/viewport.scale},beat,current,scale);if(!point)return;ctx.save();ctx.fillStyle='#e6e9ed';ctx.font='11px sans-serif';ctx.fillText(label,point.x+5,point.y+15);ctx.restore();}
  updateTooltip(layer){
    const tooltip=layer.tooltip;if(!this.pointerLocation||!this.cursor||!this.interactive){tooltip.hidden=true;return;}
    const value=this.liveSelected??this.cursor,beat=this.liveSelected?.beat??this.pointerBeat??layer.current;
    const lines=[t('spatial.beatReadout',{beat:displayNumber(beat)}),t('spatial.position')+' '+displayPosition(value)];
    const target=this.liveSelected??(this.hover?.lineIndex!==undefined?this.hover:null);
    if(target){const state=target.rotation!==undefined?target:this.tracks.state(target.lineIndex,beat);lines.push(t('spatial.lineNumber',{number:target.lineIndex})+' · '+t('spatial.rotation')+' '+displayNumber(state.rotation)+'°',t('spatial.alpha')+' '+displayNumber(state.alpha)+' · '+t('spatial.scalePair',{x:displayNumber(state.scaleX),y:displayNumber(state.scaleY)}));}
    tooltip.textContent=lines.join('\n');tooltip.hidden=false;
    tooltip.style.left=Math.max(6,Math.min(layer.camera.width-tooltip.offsetWidth-6,this.pointerLocation.x+16))+'px';tooltip.style.top=Math.max(38,Math.min(layer.camera.height-tooltip.offsetHeight-6,this.pointerLocation.y+18))+'px';
  }
  frame(ctx,camera,beat,current,scale,viewport,color,width){const x=viewport.width/2/viewport.scale,y=viewport.height/2/viewport.scale,p=[[-x,-y],[x,-y],[x,y],[-x,y]].map(([x,y])=>camera.project({x,y},beat,current,scale));if(p.some(v=>!v))return;ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();p.forEach((v,i)=>i?ctx.lineTo(v.x,v.y):ctx.moveTo(v.x,v.y));ctx.closePath();ctx.stroke();}
  drawNode(ctx,node,p,project,camera,current,scale){
    ctx.save();ctx.globalAlpha=this.progress*this.fadeAt(node.beat);ctx.translate(p.x,p.y);ctx.scale(node.screenScale,node.screenScale);p={x:0,y:0};
    const active=this.liveSelected??this.selected,selected=active?.lineIndex===node.lineIndex&&Math.abs(active.beat-node.beat)<1e-7&&Math.hypot(active.x-node.x,active.y-node.y)<1e-3;ctx.fillStyle=node.alpha>0?`rgb(${(node.displayColor??node.color).map(Math.round).join(',')})`:'#a3b6c0';ctx.beginPath();ctx.arc(p.x,p.y,this.options.nodeSize,0,Math.PI*2);ctx.fill();if(selected){ctx.strokeStyle='#ffffff';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(p.x,p.y,this.options.nodeSize+3,0,Math.PI*2);ctx.stroke();}
    const a=-node.rotation*Math.PI/180,dx=Math.cos(a)*16,dy=-Math.sin(a)*16;ctx.strokeStyle='#c0cad7aa';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(p.x-dx/2,p.y-dy/2-10);ctx.lineTo(p.x+dx/2,p.y+dy/2-10);ctx.stroke();ctx.fillStyle='#b9c9d7';ctx.beginPath();ctx.arc(p.x+dx/2,p.y+dy/2-10,2,0,Math.PI*2);ctx.fill();
    if(Math.abs(node.scaleX-1)>1e-5||Math.abs(node.scaleY-1)>1e-5){ctx.save();ctx.translate(p.x+14,p.y-13);ctx.rotate(-a);ctx.strokeRect(-Math.min(20,Math.abs(node.scaleX)*5),-Math.min(14,Math.abs(node.scaleY)*4),Math.min(40,Math.abs(node.scaleX)*10),Math.min(28,Math.abs(node.scaleY)*8));if(node.scaleX<0||node.scaleY<0){ctx.beginPath();ctx.moveTo(-4,0);ctx.lineTo(4,0);ctx.moveTo(0,-4);ctx.lineTo(0,4);ctx.stroke();}ctx.restore();}
    if(node.text){ctx.fillStyle='#d6dde6';ctx.font='10px sans-serif';ctx.fillText([...node.text].slice(0,14).join('')+(node.text.length>14?'…':''),p.x+8,p.y+12);}
    if(this.options.nodeNumbers){const label=String(node.lineIndex),x=p.x+this.options.nodeSize+5,y=p.y-2;ctx.font='11px sans-serif';ctx.lineWidth=3;ctx.strokeStyle='#111c';ctx.strokeText(label,x,y);ctx.fillStyle='#fff';ctx.fillText(label,x,y);}
    if(selected){for(const[key,x,y]of[['rotation',p.x+32,p.y],['alpha',p.x,p.y-32],['beat',p.x-30,p.y+24]]){ctx.strokeStyle=key==='rotation'?'#78bbdf':key==='alpha'?'#d5acd8':'#e3c277';ctx.strokeRect(x-4,y-4,8,8);}}
    ctx.restore();
  }
  drawPlaneHighlights(layer){
    const nodes=this.options.highlightPlane?this.hitNodes.filter(node=>Math.abs(node.beat-this.editPlaneBeat)<1e-6):[],svg=layer.highlights,rects=layer.highlightRects;
    svg.style.display=nodes.length?'':'none';
    const set=(node,key,value)=>{const text=String(value);if(node.getAttribute(key)!==text)node.setAttribute(key,text);};
    for(let index=0;index<nodes.length;index++){
      const node=nodes[index];let rect=rects[index];
      if(!rect){rect=document.createElementNS('http://www.w3.org/2000/svg','rect');rects.push(rect);svg.append(rect);}
      const radius=this.options.nodeSize+6;set(rect,'x',-radius);set(rect,'y',-radius);set(rect,'width',radius*2);set(rect,'height',radius*2);
      set(rect,'transform',`translate(${node.screen.x} ${node.screen.y}) scale(${node.screenScale})`);set(rect,'opacity',this.progress*this.fadeAt(node.beat));
      rect.dataset.lineIndex=node.lineIndex;rect.dataset.beat=node.beat;
    }
    while(rects.length>nodes.length)rects.pop().remove();
  }
  drawGhosts(ctx,renderer,current,tempo,camera,scale){this.ghosts??=new SpatialGhosts(()=>this.invalidate(),error=>{this.options.notes=false;this.save();this.renderPanel();this.fail(error);});try{this.ghosts.draw(renderer,tempo,current,camera,scale,this.positionScale,this.options,this.progress);}catch(error){this.options.notes=false;this.ghosts.dispose();this.ghosts=null;this.save();this.renderPanel();this.fail(error);}}
  planePoint(layer,point,beat){const p=layer.camera.unproject(point,beat,layer.current,layer.scale);if(!p)return null;const mapping=layer.renderer.spatialMapping;return mapping?mapping.unproject(p,layer.tempo.seconds(beat),{width:layer.camera.width,height:layer.camera.height,scale:layer.scale},layer.chart,layer.tempo):p;}
  sampleScale(layer,node,basis){const point=p=>{const mapped=layer.renderer.spatialMapping?.project(p,layer.tempo.seconds(node.beat),{width:layer.camera.width,height:layer.camera.height,scale:layer.scale},layer.chart,layer.tempo)??p;return layer.camera.project(mapped,node.beat,layer.current,layer.scale);};const center=point(node),result={};for(const key of ['x','y']){const axis=basis?.[key]??{x:key==='x'?1:0,y:key==='y'?1:0},p=point({x:node.x+axis.x,y:node.y+axis.y});result[key]=center&&p?Math.hypot(center.x-p.x,center.y-p.y):1;}return result;}
  pickCandidates(point,kind){if(!this.pickIndex){const cells=new Map(),put=(key,kind,value)=>{let cell=cells.get(key);if(!cell){cell={nodes:[],segments:[]};cells.set(key,cell);}cell[kind].push(value);};for(const node of this.hitNodes??[])put(Math.floor(node.screen.x/64)+':'+Math.floor(node.screen.y/64),'nodes',node);for(const segment of this.hitSegments??[]){const x0=Math.max(-1,Math.floor(Math.min(segment.p.x,segment.q.x)/64)),x1=Math.min(40,Math.floor(Math.max(segment.p.x,segment.q.x)/64)),y0=Math.max(-1,Math.floor(Math.min(segment.p.y,segment.q.y)/64)),y1=Math.min(40,Math.floor(Math.max(segment.p.y,segment.q.y)/64));for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++)put(x+':'+y,'segments',segment);}this.pickIndex=cells;}const result=new Set(),x=Math.floor(point.x/64),y=Math.floor(point.y/64);for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const item of this.pickIndex.get((x+dx)+':'+(y+dy))?.[kind]??[])result.add(item);return result;}
  nearest(point){let best=null,distance=13;for(const node of this.pickCandidates(point,'nodes')){const d=Math.hypot(node.screen.x-point.x,node.screen.y-point.y);if(d<distance){best=node;distance=d;}}return best;}
  curve(point){let best=null,distance=8;for(const segment of this.pickCandidates(point,'segments')){const dx=segment.q.x-segment.p.x,dy=segment.q.y-segment.p.y,l=dx*dx+dy*dy,f=l?Math.max(0,Math.min(1,((point.x-segment.p.x)*dx+(point.y-segment.p.y)*dy)/l)):0,d=Math.hypot(point.x-segment.p.x-dx*f,point.y-segment.p.y-dy*f);if(d<distance){distance=d;best={...segment,beat:segment.a.beat+(segment.b.beat-segment.a.beat)*f};}}return best;}
  pointer(event,renderer){
    if(!this.visible||!this.interactive||this.suspended||this.context.locked?.())return;const layer=this.layers.get(renderer),rect=layer.near.getBoundingClientRect(),point={x:event.clientX-rect.left,y:event.clientY-rect.top};
    if(event.type==='pointerleave'&&!this.drag){this.clearPointer();this.invalidate();return;}
    this.pointerLocation=point;
    if(event.type==='contextmenu'){event.preventDefault();return;}
    if(event.type==='wheel'){if(event.altKey){event.preventDefault();event.stopPropagation();this.indicated=(this.indicated??layer.current)+(event.deltaY>0?1:-1)/this.context.timeline.division;this.cursor=this.planePoint(layer,point,this.indicated);this.pointerBeat=this.indicated;this.hover=null;this.updateTooltip(layer);this.invalidate();}return;}
    if(event.type==='pointercancel'){this.cancel();return;}
    if(event.type==='pointerup'){if(this.drag){layer.near.releasePointerCapture?.(event.pointerId);this.commitDraft();this.drag=null;this.syncInspector();}return;}
    const node=this.nearest(point),curve=!node?this.curve(point):null;
    if(!this.drag){
      this.hover=node??curve;const beat=node?.beat??curve?.beat??this.indicated??layer.current;
      this.pointerBeat=node?node.beat:Math.round(beat*this.context.timeline.division)/this.context.timeline.division;
      this.cursor=this.planePoint(layer,point,this.pointerBeat);
      if(curve){const state=this.tracks.state(curve.lineIndex,this.pointerBeat);this.cursor={x:state.x,y:state.y};}
    }
    if(event.type==='pointerdown'&&event.button===0){event.preventDefault();event.stopPropagation();let kind='position';const selected=this.selected;if(selected){const p=layer.project(selected,selected.beat),s=selected.screenScale??1;if(p){if(Math.hypot(point.x-p.x-32*s,point.y-p.y)<10)kind='rotation';else if(Math.hypot(point.x-p.x,point.y-p.y+32*s)<10)kind='alpha';else if(Math.hypot(point.x-p.x+30*s,point.y-p.y-24*s)<10)kind='beat';}}
      if(node){this.overlaps=this.hitNodes.filter(n=>Math.hypot(n.screen.x-point.x,n.screen.y-point.y)<13);this.overlapSelect.hidden=this.overlaps.length<2;this.overlapSelect.replaceChildren(...this.overlaps.map((n,i)=>new Option(t('spatial.lineBeat',{number:n.lineIndex,beat:displayNumber(n.beat)})+' · '+this.sourceLabel(n.sources[0]),i)));this.overlapSelect.value=this.overlaps.indexOf(node);this.selectNode(node);}
      else if(kind==='position'){this.deselect();return;}
      if(this.selected){this.pause();this.snap=this.localSnap=null;this.drag={kind,start:point,base:this.context.session.chart,selected:this.selected,source:this.source,pointerId:event.pointerId,world:this.planePoint(layer,point,this.selected.beat)};layer.near.setPointerCapture(event.pointerId);}
    }else if(event.type==='pointermove'&&this.drag){if(Math.hypot(point.x-this.drag.start.x,point.y-this.drag.start.y)<3&&!this.drag.moved)return;this.drag.moved=true;this.updateDrag(point,layer,event);}
    this.invalidate();
  }
  preparePosition(base,node){let chart=base;const sources=[];for(const type of ['moveXEvents','moveYEvents']){const existing=node.sources.find(s=>s.layer===(this.source?.layer??this.context.session.eventLayer)&&(type==='moveXEvents'?isX(s):isY(s)));if(existing&&eventListAt({chart,eventLayer:existing.layer},existing.lineIndex,existing.type)[existing.index]===existing.event)sources.push(existing);else{const prepared=ensureSpatialProperty(chart,this.context.tempo,{...node,field:this.source?.field},type,this.source?.layer??this.context.session.eventLayer);chart=prepared.chart;sources.push(prepared.source);}}return{chart,sources};}
  property(base,node,type){const existing=node.sources.find(s=>s.type===type&&(!s.axis||s.axis==='rotation'&&type==='rotateEvents'));if(existing)return{chart:base,source:existing};return ensureSpatialProperty(base,this.context.tempo,{...node,field:this.source?.field},type,this.source?.layer??this.context.session.eventLayer);}
  optionsForEdit(){return{continuous:this.options.continuous,xyBinding:this.context.session.xyBinding};}
  updateDrag(point,layer,event){try{const{base,selected,source,kind,start}=this.drag,tempo=this.context.tempo;let next;
    if(kind==='position'){
      let world=this.planePoint(layer,point,selected.beat);if(!world||!this.drag.world)throw Error(t('spatial.singular'));
      world={x:selected.x+world.x-this.drag.world.x,y:selected.y+world.y-this.drag.world.y};
      const settings=samplingPreferences(),targets=this.targets.get(base,tempo,tempo.seconds(selected.beat),this.positionScale,{lineIndex:selected.lineIndex}),prepared=this.preparePosition(base,selected),options={settings:{...settings,stepX:settings.stepX*this.positionScale.x,stepY:settings.stepY*this.positionScale.y},targets,scale:this.sampleScale(layer,selected),previous:this.snap,origin:selected,free:event.altKey};
      if(settings.coordinates==='local'){
        const line=base.judgeLineList[selected.lineIndex],parent=Number(line.father??-1),state=parent>=0?this.tracks.scene.sampler(tempo.seconds(selected.beat),this.positionScale)(parent):null,angle=-(state?.rotation??0)*Math.PI/180;
        const x={x:this.positionScale.x*Math.cos(angle),y:this.positionScale.x*Math.sin(angle)},y={x:-this.positionScale.y*Math.sin(angle),y:this.positionScale.y*Math.cos(angle)},values=prepared.sources.map(spatialSourceValue),basis={x,y,origin:{x:selected.x-x.x*values[0]-y.x*values[1],y:selected.y-x.y*values[0]-y.y*values[1]}};
        this.dragBasis=basis;const local=sampleInBasis(world,basis);const localTargets=targets.map(target=>({...target,...sampleInBasis(target,basis)}));const snapped=snapSamplePoint(local,{...options,settings,targets:localTargets,scale:this.sampleScale(layer,selected,basis),previous:this.localSnap});this.localSnap=snapped;this.snap={...sampleFromBasis(snapped,basis),guides:snapped.guides,basis};
      }else{this.dragBasis=null;this.snap=snapSamplePoint(world,options);}
      next=changeSpatialPosition(prepared.chart,tempo,prepared.sources,this.snap,this.positionScale,this.optionsForEdit());
    }
    else if(kind==='beat'){next=changeSpatialSource(base,tempo,source,{time:Math.round((selected.beat+(start.y-point.y)/Math.max(10,this.options.depth))*this.context.timeline.division)/this.context.timeline.division},this.optionsForEdit());}
    else{const type=kind==='rotation'?'rotateEvents':'alphaEvents',prepared=this.property(base,selected,type),s=prepared.source;let value=spatialSourceValue(s)+(kind==='rotation'?(point.x-start.x):start.y-point.y);if(kind==='rotation'){const center=layer.project(selected,selected.beat);const angle=Math.atan2(point.y-center.y,point.x-center.x)*180/Math.PI,begin=Math.atan2(start.y-center.y,start.x-center.x)*180/Math.PI;this.drag.angleDelta=unwrapAngle(angle-begin,this.drag.angleDelta??0);const snapped=snapSampleAngle(selected.rotation+this.drag.angleDelta,{settings:samplingPreferences(),targets:this.targets.get(base,tempo,tempo.seconds(selected.beat),this.positionScale,{lineIndex:selected.lineIndex}),free:event.altKey});value=spatialSourceValue(s)+snapped.angle-selected.rotation;}next=changeSpatialSource(prepared.chart,tempo,s,{value},this.optionsForEdit());}
    this.draft=next;this.previewDraft(next);this.error=null;this.message.classList.remove('error');
  }catch(error){this.fail(error);}}
  previewDraft(chart){this.context.session.liveEventEdit=true;this.geometry=null;this.invalidate();}
  previewEasing(source,transform){
    if(!this.lineAllowed(source.lineIndex))throw Error(t('spatial.lineExcluded'));
    if(this.drag||this.draft&&!this.easingDraft)throw Error(t('spatial.stale'));
    const chart=changeSpatialEasing(this.context.session.chart,source,transform);this.inputBase=this.context.session.chart;this.easingDraft=true;this.draft=chart;this.previewDraft(chart);
  }
  cancelEasingPreview(){if(!this.easingDraft)return;this.easingDraft=false;this.draft=null;this.inputBase=null;this.liveSelected=null;this.context.session.liveEventEdit=false;this.geometry=null;this.invalidate();}
  editEasing(source,transform){
    if(!this.lineAllowed(source.lineIndex))throw Error(t('spatial.lineExcluded'));
    if(this.drag||this.draft&&!this.easingDraft)throw Error(t('spatial.stale'));
    const session=this.context.session,chart=changeSpatialEasing(session.chart,source,transform);this.cancelEasingPreview();
    if(chart===session.chart)return;
    const scroll=this.host.closest('.inspector'),top=scroll?.scrollTop;
    if(session.commit(t('spatial.easingChanged'),chart)===false)throw Error(t('animation-curve.applyRejected'));
    this.reselect=this.selectionReference(session.chart,source,true);this.source=this.reselect?.source??null;
    if(this.selected){this.selected={...this.selected,sources:this.selected.sources.map(s=>({...s,event:eventListAt({chart:session.chart,eventLayer:s.layer},s.lineIndex,s.type)[s.index]}))};this.source=this.selected.sources.find(s=>s.event===this.reselect?.source.event&&s.field===source.field&&s.axis===source.axis)??this.source;}
    this.liveSelected=null;this.inputBase=null;this.inputValid=true;this.selectionChart=session.chart;this.error=null;this.message.classList.remove('error');this.geometry=null;this.syncInspector();if(scroll)scroll.scrollTop=top;this.invalidate();
  }
  commitDraft(){if(!this.draft)return;const base=this.drag?.base??this.inputBase,chart=this.draft;this.draft=null;this.context.session.liveEventEdit=false;if(base!==this.context.session.chart){this.fail(Error(t('spatial.stale')));return;}this.reselect=this.selectionReference(chart,this.source,true);this.context.session.commit(t('spatial.editLabel'),chart);this.selected=null;this.source=null;this.liveSelected=null;this.selectionChart=this.context.session.chart;}
  cancel(){if(this.drag?.pointerId!==undefined)for(const layer of this.layers.values())if(layer.near.hasPointerCapture?.(this.drag.pointerId))layer.near.releasePointerCapture(this.drag.pointerId);this.draft=null;this.easingDraft=false;this.drag=null;this.dragBasis=null;this.pending=null;this.inputBase=null;this.context.session.liveEventEdit=false;this.geometry=null;this.invalidate();}
  fail(error){if(this.error!==error.message){this.error=error.message;this.message.textContent=error.message;this.message.classList.add('error');}this.invalidate();}
  sourceLabel(source){const key=source.axis?{x:'x',y:'y',rotation:'rotation'}[source.axis]:{moveXEvents:'x',moveYEvents:'y',rotateEvents:'rotation',alphaEvents:'alpha',scaleXEvents:'scaleX',scaleYEvents:'scaleY',textEvents:'text'}[source.type];return t('spatial.'+key);}
  syncLiveInspector(node){for(const[key,input]of this.inputs){if(document.activeElement===input)continue;input.dataset.exactValue=key==='beat'?formatBeat(fromNumber(node.beat)):String(node[key]);input.value=key==='beat'?formatBeat(fromNumber(node.beat)):key==='text'?node.text:displayNumber(node[key]);}}
  syncInspector(rebuild=true){const enabled=Boolean(this.selected);this.nodeForm.hidden=!this.selected;this.sourceSelect.hidden=!this.selected;this.owner.textContent=this.selected?t('spatial.lineBeat',{number:this.selected.lineIndex,beat:displayNumber(this.selected.beat)}):t('spatial.select');
    if(this.selected&&rebuild){this.sourceSelect.replaceChildren(...this.selected.sources.map((s,index)=>new Option(`${t('spatial.eventLayer',{number:s.layer})} · ${this.sourceLabel(s)} · ${t(s.field==='start'?'sampling.start':'sampling.end')}`,index)));this.sourceSelect.value=this.selected.sources.indexOf(this.source);}
    for(const[key,input]of this.inputs){input.disabled=!enabled;if(document.activeElement===input)continue;if(this.selected){const value=this.selected[key];input.dataset.exactValue=key==='beat'?formatBeat(fromNumber(this.selected.beat)):String(value);input.value=key==='beat'?formatBeat(fromNumber(this.selected.beat)):key==='text'?value:displayNumber(value);}}
    this.easing?.sync();
  }
  editInput(key,input){if(!this.selected||!this.lineAllowed(this.selected.lineIndex))return;try{this.inputBase??=this.context.session.chart;const base=this.inputBase,tempo=this.context.tempo,value=key==='text'?input.value:key==='beat'?beatValue(parseBeat(input.value)):evaluateNumericExpression(input.value);if(typeof value==='number'&&(!Number.isFinite(value)||input.value.trim()===''))return;let next;
    if(key==='x'||key==='y'){const point={x:this.selected.x,y:this.selected.y,[key]:value};const prepared=this.preparePosition(base,this.selected);next=changeSpatialPosition(prepared.chart,tempo,prepared.sources,point,this.positionScale,this.optionsForEdit());}
    else if(key==='beat')next=changeSpatialSource(base,tempo,this.source,{time:value},this.optionsForEdit());
    else{const type={rotation:'rotateEvents',alpha:'alphaEvents',scaleX:'scaleXEvents',scaleY:'scaleYEvents',text:'textEvents'}[key],prepared=this.property(base,this.selected,type),source=prepared.source;const original=this.selected[key],raw=spatialSourceValue(source);next=changeSpatialSource(prepared.chart,tempo,source,{value:key==='text'?value:raw+value-original},this.optionsForEdit());}
    this.draft=next;this.previewDraft(next);this.inputValid=true;this.error=null;this.message.classList.remove('error');input.setCustomValidity('');
  }catch(error){this.inputValid=false;input.setCustomValidity(error.message);this.fail(error);}}
  applyInput(){if(this.inputValid===false){this.cancel();this.syncInspector();return;}this.commitDraft();this.inputBase=null;this.syncInspector();}
  remove(whole=false){if(!this.source||!this.lineAllowed(this.source.lineIndex))return;try{const chart=deleteSpatialNode(this.context.session.chart,this.source,{whole,xyBinding:this.context.session.xyBinding});this.deselect();this.context.session.commit(t('spatial.delete'),chart);}catch(error){this.fail(error);}}
  action(action,event){if(!this.visible||!this.interactive||this.suspended)return false;if(action==='Esc'){this.deselect();return true;}if(['Undo','Redo'].includes(action)&&(this.drag||this.pending||this.draft)){this.cancel();return true;}if(['Delete','QuickDelete'].includes(action)&&this.source){this.remove();return true;}if(!['AddTap','AddEvent'].includes(action))return false;try{const{session,tempo,timeline}=this.context,beat=this.pointerBeat;if(!Number.isFinite(beat)||!this.cursor)throw Error(t('spatial.pointFirst'));const type=this.channel.value==='position'?'moveXEvents':this.channel.value,types=this.channel.value==='position'?['moveXEvents','moveYEvents']:[type],lineIndex=this.hover?.lineIndex??session.lineIndex,layer=timeline.layer;
    if(!this.lineAllowed(this.pending?.lineIndex??lineIndex))throw Error(t('spatial.lineExcluded'));
    if(!this.pending){let chart=session.chart,inserted=false;for(const type of types){const next=insertSpatialNode(chart,tempo,{lineIndex,layer,type,beat,inst:action==='AddTap'});if(next){chart=next;inserted=true;}}if(inserted){if(this.channel.value==='position'){const node={lineIndex,beat};const sx=ensureSpatialProperty(chart,tempo,node,'moveXEvents',layer);const sy=ensureSpatialProperty(sx.chart,tempo,node,'moveYEvents',layer);chart=changeSpatialPosition(sy.chart,tempo,[sx.source,sy.source],this.cursor,this.positionScale,this.optionsForEdit());}session.commit(t('spatial.add'),chart);this.geometry=null;return true;}this.pending={lineIndex,layer,types,beat,point:{...this.cursor},inst:action==='AddTap',base:session.chart};this.invalidate();return true;}
    const pending=this.pending;if(pending.base!==session.chart)throw Error(t('spatial.stale'));let chart=session.chart;
    for(const type of pending.types){const value=(p,key)=>key==='moveXEvents'?p.x/(this.positionScale?.x??1):key==='moveYEvents'?p.y/(this.positionScale?.y??1):key==='textEvents'?'':key.startsWith('scale')?1:key==='alphaEvents'?255:0;chart=placeSpatialSpan(chart,tempo,{lineIndex:pending.lineIndex,layer:pending.layer,type,first:pending.beat,second:beat,firstValue:value(pending.point,type),secondValue:value(this.cursor,type),inst:pending.inst});}
    if(pending.types.includes('moveXEvents')&&pending.types.includes('moveYEvents')){
      const forward=beat>pending.beat,first=forward?pending.point:this.cursor,last=forward?this.cursor:pending.point,firstBeat=Math.min(beat,pending.beat),lastBeat=Math.max(beat,pending.beat);
      for(const[field,target,time]of pending.inst?[['start',first,firstBeat]]:[['start',first,firstBeat],['end',last,lastBeat]]){const sources=pending.types.map(type=>{const events=eventListAt({chart,eventLayer:pending.layer},pending.lineIndex,type),index=events.length-1;return{lineIndex:pending.lineIndex,layer:pending.layer,type,index,event:events[index],field,beat:time};});chart=changeSpatialPosition(chart,tempo,sources,target,this.positionScale,{...this.optionsForEdit(),continuous:false});}
    }
    session.commit(t('spatial.add'),chart);this.pending=null;this.geometry=null;return true;
  }catch(error){this.fail(error);return true;}}
}
