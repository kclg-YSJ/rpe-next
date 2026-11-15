import { drawEditorJudgement } from '@rpen/ui/editor-judgement.mjs';
import { originalEditorContext } from '@rpen/ui/editor-skin-canvas.mjs';
import { DEFAULT_EDITOR_PREFERENCES } from '@rpen/core/default-settings.mjs';
import { Timeline } from '@rpen/ui/timeline.mjs';
import { paintTimelineGrid } from '@rpen/ui/timeline-grid.mjs';

export const SKIN_ID = 'rpe-classic';
export const DESIGN = Object.freeze({ width: 1920, height: 1080, top: 144, footer: 36, editor: 1350, inspector: 570, timeline: 900 });

export function layoutScale(width, height) {
  // Exact for 16:9. Other sizes contain the workbench rather than distorting it.
  return Math.max(0.1, Math.min(width / DESIGN.width, height / DESIGN.height));
}

export function canUseClassic(editor) {
  return editor.hasDocument && !editor.home;
}

export function installGeometry(api, state, timeline = api.editor.timeline, {global = false} = {}) {
  const applies = () => state.active && !timeline.noteView;
  if(!global){
    const descriptor=Object.getOwnPropertyDescriptor(timeline,'referenceNoteScale'),native=Object.getOwnPropertyDescriptor(Timeline.prototype,'referenceNoteScale')?.get;
    if(typeof native!=='function')throw Error('RPE Classic: unsupported referenceNoteScale');
    Object.defineProperty(timeline,'referenceNoteScale',{configurable:true,get(){return applies()&&!this.getSession().multiLineActive&&state.nativeNoteWidth?this.noteScale*state.nativeNoteWidth/1350*175/68:native.call(this);}});
    api.dispose(()=>{if(descriptor)Object.defineProperty(timeline,'referenceNoteScale',descriptor);else delete timeline.referenceNoteScale;});
    api.patch(timeline,'clampNoteHorizontal',previous=>function(horizontal,width,canvasWidth=this.notesCanvas.clientWidth,lineIndex=this.getSession().lineIndex){
      if(!applies()||this.getSession().multiLineActive)return previous.call(this,horizontal,width,canvasWidth,lineIndex);
      const padding=state.noteBleed??{left:0,right:0};return horizontal+width/2 < -padding.left||horizontal-width/2 > canvasWidth+padding.right?null:horizontal;
    });
  }
  api.patch(timeline, 'baseline', previous => function(height = this.viewHeight()) {
    return applies() ? height - (this.judgementOffset ?? 92) * (100 * 900 / 1080 / 92) * state.scale : previous.call(this, height);
  });
  api.patch(timeline, 'vertical', previous => function(beat, height = this.viewHeight(), side = 1) {
    if (!applies()) return previous.call(this, beat, height, side);
    return this.baseline(height) - (this.tempo.seconds(beat, this.factor) - this.tempo.seconds(this.origin, this.factor)) * this.scale * state.scale;
  });
  api.patch(timeline, 'verticalForLine', previous => function(beat, line, height = this.viewHeight(), side = 1) {
    if (!applies()) return previous.call(this, beat, line, height, side);
    const factor = this.factorForLine(line);
    return this.baseline(height) - (this.tempo.seconds(beat, factor) - this.tempo.seconds(this.origin, factor)) * this.scale * state.scale;
  });
  api.patch(timeline, 'timeAt', previous => function(y, side) {
    return applies() ? this.tempo.seconds(this.origin, this.factor) + (this.baseline() - y) / (this.scale * state.scale) : previous.call(this, y, side);
  });
  api.patch(timeline, 'rectangleStart', previous => function(drag) {
    if (!applies()) return previous.call(this, drag);
    const canvas = drag.area === 'events' ? this.eventsCanvas : this.notesCanvas;
    const scroll = drag.startWorldX === undefined ? 0 : this.multiLineViewportOffset(canvas.clientWidth, drag.area ?? 'notes');
    const factor = drag.startFactor ?? this.factor;
    return {
      x: drag.startWorldX === undefined ? drag.start.x : drag.startWorldX - scroll,
      y: drag.startSeconds === undefined ? drag.start.y : this.baseline(canvas.clientHeight) - (drag.startSeconds - this.tempo.seconds(this.origin, factor)) * this.scale * state.scale
    };
  });
  api.patch(timeline, 'rectangleTimes', previous => function(drag) {
    if (!applies()) return previous.call(this, drag);
    const factor = drag.startFactor ?? this.factor;
    const canvas = drag.area === 'events' ? this.eventsCanvas : this.notesCanvas;
    const current = this.tempo.seconds(this.origin, factor) + (this.baseline(canvas.clientHeight) - drag.current.y) / (this.scale * state.scale);
    const start = drag.startSeconds ?? this.timeAt(drag.start.y);
    // Native move/up handlers cache seconds using their unscaled layout. Update
    // that cache here too: large-document selection reads it after this method.
    drag.currentSeconds = current;
    return [this.tempo.beat(Math.min(start, current), factor) - 1e-8, this.tempo.beat(Math.max(start, current), factor) + 1e-8];
  });
  api.patch(timeline, 'eventColumnBounds', previous => function(channel, width) {
    if (!applies()) return previous.call(this, channel, width);
    if (global) {
      const bounds = previous.call(this, channel, width), barWidth = bounds.channelWidth * Math.min(1,.5*(this.eventBarWidth??DEFAULT_EDITOR_PREFERENCES.eventBarWidth)/DEFAULT_EDITOR_PREFERENCES.eventBarWidth);
      return {...bounds,x:bounds.left+(bounds.channelWidth-barWidth)/2,width:barWidth};
    }
    const channelWidth = width / Math.max(1, this.eventTypes.length), barWidth = channelWidth * Math.min(1,.5*(this.eventBarWidth??DEFAULT_EDITOR_PREFERENCES.eventBarWidth)/DEFAULT_EDITOR_PREFERENCES.eventBarWidth);
    return { channelWidth, left: channel * channelWidth, x: channel * channelWidth + (channelWidth - barWidth) / 2, width: barWidth };
  });
  api.patch(timeline, 'horizontalScale', previous => function() {
    // Keep the user's spacing factor and all continuous X coordinates. Native
    // drawing, hit testing and dragging share this mapping, including X=±675.
    return applies() ? this.panelWidth(this.notesCanvas.clientWidth, 'notes') / 1350 * (this.noteSpacing ?? 1) : previous.call(this);
  });
  api.patch(timeline, 'drawJudgement', previous => function(context, width, height, playBeat, area) {
    if (!applies()) return previous.call(this, context, width, height, playBeat, area);
    // Notes draw their vertical guides before this call and their objects after
    // it. Clear only that guide layer; objects may cross the judgement freely.
    if (area === 'notes') {
      const raw = originalEditorContext(context), bottom = Math.max(0, this.baseline(height));
      const padding=state.noteBleed??{left:0,right:0};raw.clearRect(-padding.left, bottom, width+padding.left+padding.right, Math.max(0, height - bottom));
    }
    drawEditorJudgement(context, this.judgementSegments(width, height, playBeat, area), this.judgementColor ?? '#ffffff',
      7*state.scale*(this.judgementWidth??DEFAULT_EDITOR_PREFERENCES.judgementWidth)/DEFAULT_EDITOR_PREFERENCES.judgementWidth,
      .32*(this.judgementAlpha??DEFAULT_EDITOR_PREFERENCES.judgementAlpha)/DEFAULT_EDITOR_PREFERENCES.judgementAlpha);
  });
  api.patch(timeline, 'drawMultiLineBeatLabels', previous => function(context, width, height, ...args) {
    if (!applies()) return previous.call(this, context, width, height, ...args);
    context.save(); context.beginPath(); context.rect(0, 0, width, Math.max(0, this.baseline(height))); context.clip();
    try { return previous.call(this, context, width, height, ...args); } finally { context.restore(); }
  });
  api.patch(timeline, 'grid', previous => function(context, width, height, playBeat) {
    if (!applies()) return previous.call(this, context, width, height, playBeat);
    const s = state.scale;
    context.save();
    context.beginPath(); context.rect(0, 0, width, Math.max(0, this.baseline(height))); context.clip();
    context.font = `${30 * s}px RPE, sans-serif`; const lineWidth = Math.max(.5*s, 4*(this.barWidth??3)/3*s);
    context.textAlign = 'right';
    const minor=`rgba(0,255,0,${Math.min(1,(this.barAlpha??.6)*.5)})`,major=`rgba(255,0,0,${Math.min(1,(this.barAlpha??.6)*.9)})`;
    paintTimelineGrid(context,this.gridTicks(height,undefined,{spacing:4*s,labelSpacing:32*s,pixelsPerSecond:timeline.scale*s}),{right:width,vertical:beat=>this.vertical(beat,height),colors:[minor,minor,major],spacing:4*s,widths:[lineWidth,lineWidth,lineWidth],labelColor:'#ffffff',labelX:width-7*s,labelOffset:-7*s});
    context.restore();
  });
  api.patch(timeline,'gridForLine',previous=>function(context,left,width,height,playBeat,lineIndex,showBeatLabels=true){
    if(!applies())return previous.call(this,context,left,width,height,playBeat,lineIndex,showBeatLabels);
    const s=state.scale;
    context.save();context.beginPath();context.rect(left,0,width,Math.max(0,this.baseline(height)));context.clip();
    context.font=`${30*s}px RPE, sans-serif`;const lineWidth=Math.max(.5*s,4*(this.barWidth??3)/3*s);context.textAlign='right';
    const minor=`rgba(0,255,0,${Math.min(1,(this.barAlpha??.6)*.5)})`,major=`rgba(255,0,0,${Math.min(1,(this.barAlpha??.6)*.9)})`;
    paintTimelineGrid(context,this.gridTicks(height,lineIndex,{spacing:4*s,labelSpacing:32*s,pixelsPerSecond:timeline.scale*s}),{left,right:left+width,vertical:beat=>this.verticalForLine(beat,lineIndex,height),colors:[minor,minor,major],spacing:4*s,widths:[lineWidth,lineWidth,lineWidth],labels:showBeatLabels,labelColor:'#ffffff',labelX:left+width-7*s,labelOffset:-7*s});context.restore();
  });
}
