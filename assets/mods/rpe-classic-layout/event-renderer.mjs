import { beatValue } from '@rpen/core/beat.mjs';
import { selectedEventGroups, eventDisplayIndex } from '@rpen/ui/event-display-index.mjs';
import { eventKey, eventListAt } from '@rpen/application/event-commands.mjs';
import { shaderEventLanes } from '@rpen/core/shader-events.mjs';
import { drawClassicEventCurve as drawEventCurve, drawClassicEventCurveBatch as drawEventCurveBatch, createClassicCurveCache } from './event-curves.mjs';
import { prepareCanvas } from '@rpen/ui/timeline.mjs';
import { DEFAULT_EDITOR_PREFERENCES } from '@rpen/core/default-settings.mjs';
import { clipboardStart, projectClipboard } from '@rpen/application/clipboard.mjs';
import { clipboardBeat } from '@rpen/ui/clipboard-preview.mjs';
import { EventValueScale } from '@rpen/ui/event-value-scale.mjs';

const format = value => typeof value === 'number' ? String(Math.round(value * 1000) / 1000) : String(value ?? '');
const emptyEvents=Object.freeze([]),emptySelection=new Set();

// Single-line traversal adapted from the host's Timeline.drawEvents. Reuse its
// indexes, easing, clipboard, decorators, interaction and judgement. Draw the
// classic appearance directly, without intercepting every canvas command.
export async function installEventPainter(api, state) {
  const source = api.editor.timeline;
  api.patch(EventValueScale.prototype,'drawSnap',previous=>function(context,width,height){
    return previous.call(this,context,width,state.active?this.timeline.eventsCanvas.clientHeight:height);
  });
  const bitmap = await createImageBitmap(new Blob([api.package.bytes('images/event.png')],{type:'image/png'}));
  const tints = new Map(), shaderCache = new WeakMap();
  const tinted = color => {
    if (color === '#ffffff') return bitmap;
    if (!tints.has(color)) {
      const image = document.createElement('canvas'); image.width = bitmap.width; image.height = bitmap.height;
      const context = image.getContext('2d'); context.drawImage(bitmap, 0, 0);
      context.globalCompositeOperation = 'multiply'; context.fillStyle = color; context.fillRect(0, 0, image.width, image.height);
      context.globalCompositeOperation = 'destination-in'; context.drawImage(bitmap, 0, 0);
      tints.set(color, image);
    }
    return tints.get(color);
  };
  const ghost=(context,x,top,width,height,color='#ffffff',alpha=.42)=>{
    context.save();context.globalAlpha=alpha;context.drawImage(tinted(color),x,top,width,Math.max(2*state.scale,height));context.restore();
  };
  const clipboard=(timeline,context,width,height)=>{
    const session=timeline.getSession();
    if(session.multiLineActive&&!session.multiLineIndices.length||session.clipboardVisible===false||timeline.bulkPreview||timeline.pendingHold||timeline.eventInteraction.pending)return;
    const target=timeline.clipboardPointer?timeline.lineIndexAt(timeline.clipboardPointer.x,width,'events'):session.lineIndex;
    const projected=projectClipboard(session,clipboardBeat(timeline),{...timeline.clipboardMode,targetLineIndex:target});
    if(!projected.notes.length&&!projected.events.length)return;
    for(const [i,{type,event}]of projected.events.entries()){
      const lineIndex=projected.eventLines?.[i]??session.lineIndex,channel=timeline.eventTypes.indexOf(type);if(channel<0)continue;
      const vertical=beat=>session.multiLineActive&&session.multiLineMode==='events'?timeline.verticalForLine(beat,lineIndex,height):timeline.eventVertical(beat,type);
      const top=vertical(beatValue(event.endTime)),bottom=vertical(beatValue(event.startTime));if(bottom<0||top>height)continue;
      const panelWidth=timeline.panelWidth(width,'events'),offset=timeline.panelIndex(lineIndex,'events')*timeline.panelStride(width,'events')-timeline.multiLineViewportOffset(width,'events'),bounds=timeline.eventColumnBounds(channel,panelWidth);
      ghost(context,offset+bounds.x,Math.min(top,bottom),bounds.width,Math.abs(bottom-top),Math.abs(bottom-top)<1e-7?'#ff0000':event.inst?'#6464ff':'#ffffff',.175);
    }
    context.save();context.globalAlpha=.7;context.strokeStyle='#ff5cab';context.lineWidth=1;const y=timeline.vertical(clipboardStart(session));context.beginPath();context.moveTo(0,y);context.lineTo(width,y);context.stroke();context.restore();
  };
  for(const timeline of [source,api.editor.globalEvents?.timeline].filter(Boolean)) {
  const canvas=timeline.eventsCanvas,global=timeline!==source;
  const curveCache=createClassicCurveCache();let curveChart,curveTempo;
  api.dispose(()=>curveCache.clear());
  api.patch(timeline.eventInteraction,'draw',previous=>function(context,width){
    if(!state.active||timeline.noteView)return previous.call(this,context,width);
    const pending=this.pending;if(!pending)return;
    const channel=timeline.eventTypes.indexOf(pending.type);if(channel<0)return;
    const end=timeline.eventCursor?timeline.eventBeatAt(timeline.eventCursor.y,pending.type,true):pending.beat;
    let valid=true;try{this.createEvent(timeline.getSession(),pending.type,pending.beat,end,undefined,pending.lineIndex,pending.inst,true);}catch{valid=false;}
    const session=timeline.getSession(),lineIndex=timeline.lineIndexAt(timeline.eventCursor?.x??0,width,'events');
    const vertical=beat=>session.multiLineActive&&session.multiLineMode==='events'?timeline.verticalForLine(beat,lineIndex,canvas.clientHeight):timeline.eventVertical(beat,pending.type);
    const first=vertical(pending.beat),last=vertical(end),panelWidth=timeline.panelWidth(width,'events'),offset=timeline.panelIndex(lineIndex,'events')*timeline.panelStride(width,'events')-timeline.multiLineViewportOffset(width,'events'),bounds=timeline.eventColumnBounds(channel,panelWidth);
    ghost(context,offset+bounds.x,Math.min(first,last),bounds.width,Math.abs(last-first),valid?pending.inst?'#6464ff':'#ffffff':'#ff0000',valid?.5:.65);
  });
  api.patch(timeline, 'drawEvents', previous => function(playBeat) {
    if (!state.active || this.noteView) return previous.call(this, playBeat);
    this.syncMultiLineChrome('events', canvas.clientWidth);
    const drawingCanvas=this.eventsCanvas;
    const { context: skinContext, width, height } = prepareCanvas(drawingCanvas);
    const context = drawingCanvas.getContext('2d'), session = this.getSession(), s = state.scale;
    if(curveChart!==session.chart||curveTempo!==this.tempo){curveChart=session.chart;curveTempo=this.tempo;curveCache.clear();}
    const multi=session.multiLineActive&&session.multiLineMode==='events';
    if(multi)this.drawMultiLineGrid(skinContext,width,height,playBeat);else this.grid(context, width, height, playBeat);
    clipboard(this, skinContext, width, height);
    this.eventRects = [];
    const alpha = Math.max(0, Math.min(1, (this.eventOpacity ?? DEFAULT_EDITOR_PREFERENCES.eventOpacity ?? .25) * (175 / 255 / (DEFAULT_EDITOR_PREFERENCES.eventOpacity ?? .25))));
    const curveWidth = (state.eventCurveWidth??4.5)*s, labels = [],types=this.eventTypes,baseline=this.baseline(height),physicalScale=this.scale*s,curveTransform=context.getTransform();
    const layout=multi?this.multiLineLayout(width,'events'):null;
    const panels=multi?Array.from({length:layout.last-layout.first},(_,i)=>layout.first+i):[0];
    for(const panel of panels){
    const lineIndex=multi?layout.indices[panel]:session.lineIndex,panelWidth=multi?layout.panelWidth:width,offset=multi?panel*layout.stride-layout.offset:0;
    const line=session.chart.judgeLineList?.[lineIndex],layer=global?session.line?.extended??{}:this.extended?{...line?.extended,paintEvents:eventListAt(session,lineIndex,'paintEvents')}:line?.eventLayers?.[this.layer]??{};
    const selection=multi?session.multiEventSelection?.get(lineIndex)??emptySelection:session.eventSelection;
    const factor=global?this.factor:this.factorForLine(lineIndex),originSeconds=this.tempo.seconds(this.origin,factor);
    const vertical=beat=>baseline-(this.tempo.seconds(beat,factor)-originSeconds)*physicalScale;
    const firstBeat=this.tempo.beat(originSeconds+(baseline-height)/physicalScale,factor),lastBeat=this.tempo.beat(originSeconds+baseline/physicalScale,factor);
    const displays=types.map(type=>eventDisplayIndex(this,layer[type]??emptyEvents,session.chart));
    if(!multi){this.eventDisplays=displays;this.eventIndexes=displays.map(d=>d.index);this.chainRanges=displays.map(d=>d.ranges);this.indexedLayer=session.chart;this.eventIndexKey=`${lineIndex}:${this.extended}:${this.layer}`;}
    for (const [channel, type] of types.entries()) {
      const bounds=this.eventColumnBounds(channel,panelWidth),channelWidth=bounds.channelWidth,left=bounds.left+offset,barX=bounds.x+offset,barWidth=bounds.width;
      const center = barX + barWidth / 2;
      context.strokeStyle = '#666600'; context.lineWidth = Math.max(1, s); context.beginPath(); context.moveTo(center, 0); context.lineTo(center, this.baseline(height)); context.stroke();
      const display=displays[channel],ranges=display.ranges,entries=display.index.query(firstBeat,lastBeat),scaleRange=this.eventValueScale?.range(type,lineIndex);
      const curveX=scaleRange?barX:left,curveSpan=scaleRange?barWidth:channelWidth;
      if(type==='paintEvents'){
        // Retain the host's overlapping shader lanes and their names. Only the
        // surrounding column/grid uses the classic layout.
        const events=layer.paintEvents??emptyEvents;
        if(!shaderCache.has(events))shaderCache.set(events,shaderEventLanes(events));
        const view=Object.create(this);view.shaderLanes=shaderCache.get(events);view.eventRects=[];
        view.eventVertical=vertical;view.getSession=()=>({...session,eventSelection:selection});
        context.save();context.translate(offset,0);try{this.drawShaderEvents.call(view,skinContext,entries,channel,panelWidth,height);}finally{context.restore();}
        for(const rect of view.eventRects)this.eventRects.push({...rect,x:rect.x+offset,...(multi?{lineIndex}:{})});
        if(!multi)this.shaderLanes=view.shaderLanes;
        continue;
      }
      const selectedGroups = selectedEventGroups(selection, type, ranges);
      const seamlessGroups = new Set(), curveBatches = new Map(), visibleGroups = new Set(),groupSpans=new Map();
      if (this.seamlessEvents) for (const entry of entries) {
        const group = ranges.get(entry.index);
        if (group?.entries.length > 1 && !selectedGroups.has(group) && !display.unmergeable.has(group)) seamlessGroups.add(group);
      }
      for (const entry of entries) {
        const top = vertical(entry.end), bottom = vertical(entry.start);
        const rect = {x:barX,y:Math.max(0,top),width:barWidth,height:Math.max(2,Math.min(height,bottom)-Math.max(0,top)),index:entry.index,type};
        if(multi)rect.lineIndex=lineIndex;
        this.eventRects.push(rect);
        const event = entry.item, group = ranges.get(entry.index), merged = seamlessGroups.has(group);
        const selected = selection.size>0&&selection.has(eventKey(type, entry.index));
        const hooked = event.inst === true || Number(event.inst) === 1;
        const first = merged ? group.entries[0].event : event, last = merged ? group.entries.at(-1).event : event;
        let span=merged?groupSpans.get(group):null;
        if(merged&&!span){span={top:vertical(beatValue(last.endTime)),bottom:vertical(beatValue(first.startTime))};groupSpans.set(group,span);}
        const imageTop = span?span.top:top;
        const imageBottom = span?span.bottom:bottom;
        const zero = Math.abs(imageBottom-imageTop)<1e-7;
        let color = selected ? hooked ? '#00ff64' : '#00ff00' : hooked ? '#6464ff' : '#ffffff';
        if (Number(event.linkgroup ?? 0)>0) color=selected?'#ffd700':'#ffff00';
        if (zero) color='#ff0000';
        if(event.trajectory)this.drawTrajectoryEvent(skinContext,rect,event);
        context.save();context.beginPath();context.rect(rect.x,rect.y,rect.width,rect.height);context.clip();
        this.decorateEvent?.(skinContext,rect,event,selected);
        context.globalAlpha=alpha;context.drawImage(tinted(color),rect.x,Math.min(imageTop,imageBottom),rect.width,zero?3*s:Math.abs(imageBottom-imageTop));context.globalAlpha=1;
        context.restore();
        if(this.drawEventCurves!==false&&!event.trajectory&&channelWidth>=(this.eventCurveThreshold??24)*s){
          if(merged){if(!curveBatches.has(group))curveBatches.set(group,[]);curveBatches.get(group).push({event,range:scaleRange??group,startY:bottom,endY:top});}
          else{
            context.strokeStyle=hooked?'#b8f2ff':'#ff8000';
            const cap=context.lineCap; context.lineCap='round';
            drawEventCurve(context,event,scaleRange??group,{x:curveX,width:curveSpan},bottom,top,{lineWidth:curveWidth,padding:scaleRange?6:6*s,drawConstant:Boolean(scaleRange),cache:curveCache,transform:curveTransform});context.lineCap=cap;
          }
        }
        const identity=group??event;
        if(!visibleGroups.has(identity)){
          visibleGroups.add(identity);
          labels.push({x:rect.x+rect.width/2,width:rect.width,type,
            top:group?vertical(beatValue(group.entries.at(-1).event.endTime)):top,
            bottom:group?vertical(beatValue(group.entries[0].event.startTime)):bottom,
            high:group&&Number.isFinite(group.max)?group.max:last.end,
            low:group&&Number.isFinite(group.min)?group.min:first.start});
        }
      }
      context.strokeStyle='#ff8000';const cap=context.lineCap;context.lineCap='round';
      for(const [group,batch]of curveBatches){
        const top=Math.max(0,vertical(beatValue(group.entries.at(-1).event.endTime)));
        const bottom=Math.min(height,vertical(beatValue(group.entries[0].event.startTime)));
        drawEventCurveBatch(context,batch,{x:curveX,y:top,width:curveSpan,height:Math.max(2,bottom-top)},{lineWidth:curveWidth,padding:scaleRange?6:6*s,drawConstant:Boolean(scaleRange),cache:curveCache,transform:curveTransform});
      }
      context.lineCap=cap;context.lineWidth=1;
    }
    }
    const drag=this.eventInteraction.drag;
    if(drag?.kind==='rectangle'){
      if(!this.marqueeOverlay){const start=this.rectangleStart(drag);context.fillStyle='#ffcc4430';context.strokeStyle='#ffdd77';context.fillRect(start.x,start.y,drag.current.x-start.x,drag.current.y-start.y);context.strokeRect(start.x,start.y,drag.current.x-start.x,drag.current.y-start.y);}
    }else if(drag?.kind==='stroke'){
      context.strokeStyle='#80ffff';context.beginPath();drag.points.forEach((p,i)=>i?context.lineTo(p.x,p.y):context.moveTo(p.x,p.y));context.stroke();
    }else if(drag&&['move','startTime','endTime'].includes(drag.kind)&&
      (Math.hypot(drag.current.x-drag.start.x,drag.current.y-drag.start.y)>4*s || drag.originSeconds!=null&&Math.abs(this.tempo.seconds(this.origin,this.factorForLine(drag.lineIndex??session.lineIndex))-drag.originSeconds)>1e-8)){
      for(const rect of this.eventInteraction.previewRectangles(this.eventRects,width)){
        const lineIndex=rect.lineIndex??session.lineIndex,selection=multi?session.multiEventSelection?.get(lineIndex):session.eventSelection;
        if(!selection?.has(eventKey(rect.type,rect.index)))continue;
        const line=session.chart.judgeLineList[lineIndex],layer=global?session.line.extended:this.extended?{...line.extended,paintEvents:eventListAt(session,lineIndex,'paintEvents')}:line.eventLayers?.[this.layer]??{};
        const event=this.eventInteraction.previewEvent(layer[rect.type][rect.index]);
        const vertical=beat=>multi?this.verticalForLine(beat,lineIndex,height):this.eventVertical(beat,rect.type);
        const top=vertical(beatValue(event.endTime)),bottom=vertical(beatValue(event.startTime));
        ghost(context,rect.x,Math.min(top,bottom),rect.width,Math.abs(bottom-top),event.inst?'#6464ff':'#ffffff',.4);
        if(this.drawEventCurves!==false&&!event.trajectory){
          const bounds=this.eventColumnBounds(this.eventTypes.indexOf(rect.type),this.panelWidth(width,'events'));
          context.strokeStyle=event.inst?'#b8f2ff':'#ff8000';
          const scaleRange=this.eventValueScale?.range(rect.type,lineIndex),range=scaleRange??eventDisplayIndex(this,layer[rect.type]??[],session.chart).ranges.get(rect.index);
          drawEventCurve(context,event,range,{x:scaleRange?rect.x:rect.x-(bounds.x-bounds.left),y:Math.max(0,Math.min(top,bottom)),width:scaleRange?bounds.width:bounds.channelWidth,height:Math.max(2,Math.abs(bottom-top))},bottom,top,{lineWidth:curveWidth,padding:scaleRange?6:6*s,drawConstant:Boolean(scaleRange)});
        }
      }
    }
    this.eventInteraction.draw(skinContext,width);this.eventValueScale?.draw(skinContext,width,this.baseline(height));if(multi)this.drawMultiLineBeatLabels(skinContext,width,height,'events');this.drawJudgement(skinContext,width,height,playBeat,'events');
    const inset=20*900/1080*s;
    context.save();context.font=`${25*(this.eventValueFontSize??13)/13*s}px RPE, sans-serif`;context.textAlign='center';context.textBaseline='middle';
    for(const item of labels){
      if(item.width<(this.eventValueThreshold??30)*.8*s)continue;
      const value=v=>global&&this.formatEventValue?this.formatEventValue(v,item.type):format(v);
      context.fillStyle=item.top<inset?'#00ff00':'#ffffff';context.fillText(value(item.high),item.x,Math.max(inset,item.top),Math.max(1,item.width*1.75));
      if(item.bottom-item.top>35*s){context.fillStyle=item.bottom>height-inset?'#ffff00':'#ffffff';context.fillText(value(item.low),item.x,Math.min(height-inset,item.bottom),Math.max(1,item.width*1.75));}
    }
    context.restore();
  });
  }
  api.dispose(()=>{bitmap.close();tints.clear();});
}
