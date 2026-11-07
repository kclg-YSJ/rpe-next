import { beatValue } from '@rpen/core/beat.mjs';
import { noteIsAbove } from '@rpen/core/chart.mjs';
import { NOTE_COLORS } from '@rpen/ui/timeline.mjs';
import { EditorNotePainter } from '@rpen/ui/editor-note-painter.mjs';
import { originalEditorContext } from '@rpen/ui/editor-skin-canvas.mjs';

const emptySelection=new Set();

export function installMultiNoteRenderer(api,state){
  const timeline=api.editor.timeline,paddingPainter=new EditorNotePainter();
  api.patch(timeline,'drawMultiLineNotes',previous=>function(context,width,height){
    if(!state.active||this.noteView)return previous.call(this,context,width,height);
    const session=this.getSession(),indices=session.targetLineIndices,layout=this.multiLineLayout(width,'notes');
    const panelWidth=layout.panelWidth,stride=layout.stride,offset=layout.offset,merge=session.multiLineMerge&&indices.length>1;
    const noteCanvasWidth=this.notesCanvas.clientWidth,notePanelWidth=this.panelWidth(noteCanvasWidth,'notes'),noteStride=this.panelStride(noteCanvasWidth,'notes'),noteOffset=this.multiLineViewportOffset(noteCanvasWidth,'notes');
    const renderScale=this.renderNoteScale,heightWidth=68*renderScale,horizontalScale=this.horizontalScale(),cameraX=this.cameraX??0,baseline=this.baseline(height),physicalScale=this.scale*state.scale;
    const skin=this.skin,raw=originalEditorContext(context),geometry=paddingPainter.begin(skin,raw,width,height),bleed=state.noteBleed??{left:0,right:0};
    const passes=[];let count=0;
    context.save();
    for(let panel=0;panel<indices.length;panel++){
      const lineIndex=indices[panel],line=session.chart.judgeLineList[lineIndex],noteLeft=(session.multiLineMerge?0:panel)*noteStride-noteOffset;
      this.refreshIndex(lineIndex);const display=this.noteIndexes.get(lineIndex).index,left=(session.multiLineMerge?0:panel)*stride-offset;
      if(!merge&&geometry){const margin=geometry.horizontalPadding(heightWidth*display.maxSize)+4;if(left+panelWidth+margin < -bleed.left||left-margin > width+bleed.right)continue;}
      const [bottomBeat,topBeat]=this.beatRangeForLine(lineIndex,height),selection=session.multiLineSelection?.get(lineIndex)??emptySelection,moving=this.drag?.lineIndex===lineIndex&&!this.bulkPreview;
      let entries=display.inSourceOrder(bottomBeat,topBeat);
      if(moving&&selection.size){const visible=new Map(entries.map(entry=>[entry.index,entry]));for(const index of selection)if(!visible.has(index)&&line?.notes?.[index])visible.set(index,{index,item:line.notes[index]});entries=[...visible.values()].sort((first,second)=>first.index-second.index);}
      count+=entries.length;passes.push({lineIndex,left,noteLeft,bottomBeat,topBeat,selection,moving,entries});
    }
    for(const {lineIndex,left,noteLeft,bottomBeat,topBeat,selection,moving,entries}of passes){
      const factor=this.factorForLine(lineIndex),originSeconds=this.tempo.seconds(this.origin,factor);
      for(const entry of entries){
        const sourceNote=entry.item,selected=selection.size>0&&selection.has(entry.index),note=selected&&moving?this.movedNote(sourceNote):sourceNote;
        const beat=note===sourceNote&&entry.beat!==undefined?entry.beat:beatValue(note.startTime),endBeat=note===sourceNote&&entry.endBeat!==undefined?entry.endBeat:beatValue(note.endTime);
        if(Math.max(beat,endBeat)<bottomBeat||Math.min(beat,endBeat)>topBeat)continue;
        const highlight=this.highlight!==false&&this.simultaneous?.has(sourceNote),baseWidth=heightWidth*Math.abs(note.size??1),noteWidth=baseWidth*(skin?.noteScale?.(highlight)??1);
        const horizontal=noteLeft+notePanelWidth/2+(note.positionX-cameraX)*horizontalScale;
        if(horizontal+noteWidth/2<left||horizontal-noteWidth/2>left+panelWidth)continue;
        const vertical=baseline-(this.tempo.seconds(beat,factor)-originSeconds)*physicalScale,endVertical=baseline-(this.tempo.seconds(endBeat,factor)-originSeconds)*physicalScale;
        context.globalAlpha=note.isFake ? .45 : noteIsAbove(note)?1:.7;context.fillStyle=NOTE_COLORS[note.type]??'#b8c8ff';
        const prepared=merge&&count>512&&geometry?.draw(raw,note.type,horizontal,vertical,endVertical,baseWidth,highlight,note.tint??note.color,5*renderScale,heightWidth);
        const textured=prepared||(note.type===2?skin?.hold(context,horizontal,vertical,endVertical,baseWidth,highlight,true,note.tint??note.color,heightWidth):skin?.head(context,note.type,horizontal,vertical,baseWidth,highlight,note.tint??note.color,5*renderScale,heightWidth));
        if(!textured&&note.type===2){const alpha=context.globalAlpha;context.globalAlpha=alpha*.45;context.fillRect(horizontal-noteWidth/2,Math.min(vertical,endVertical),noteWidth,Math.abs(vertical-endVertical));context.globalAlpha=alpha;}
        if(!textured)context.fillRect(horizontal-noteWidth/2,vertical-4*renderScale,noteWidth,8*renderScale);
        if(selected){context.strokeStyle='#fff';context.lineWidth=2;context.strokeRect(horizontal-noteWidth/2-3,vertical-4*renderScale-3,noteWidth+6,8*renderScale+6);context.lineWidth=1;}
        if(merge){context.fillStyle='#f0d887';context.font='14px RPE, sans-serif';context.textAlign='center';context.fillText(String(lineIndex),horizontal,vertical+18);context.textAlign='left';}
      }
    }
    context.globalAlpha=1;context.restore();
  });
}
