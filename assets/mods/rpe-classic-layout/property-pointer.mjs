// Delay a plain blank press until it becomes a drag. This keeps the selected
// object's inspector alive without pinning a stale form after deletion/Esc.
export function installPropertyPointer(api, state) {
  const editor=api.editor,timeline=editor.timeline,pending=new Map();
  const release=entry=>{if(entry.canvas.hasPointerCapture?.(entry.event.pointerId))entry.canvas.releasePointerCapture(entry.event.pointerId);};
  const reset=()=>{for(const entry of pending.values())release(entry);pending.clear();};
  for(const [target,canvas,area]of [[timeline,timeline.notesCanvas,'notes'],[timeline.eventInteraction,timeline.eventsCanvas,'events']]){
    api.patch(target,'down',previous=>function(event){
      const eligible=state.active&&state.propertyHeaders?.[editor.activePane]&&event.button===0&&!event.ctrlKey&&!event.shiftKey&&!event.altKey&&
        !timeline.tool&&!timeline.noteView&&!timeline.pendingHold&&!timeline.eventInteraction.pending&&!timeline.drag&&!timeline.eventInteraction.drag&&
        !editor.noiseEditor?.active&&!editor.globalEvents?.active&&!editor.eventSampler?.active&&!editor.directPlacement?.active;
      const point=eligible?timeline.point(event,canvas):null;
      if(!eligible||this.hit(point))return previous.call(this,event);
      event.preventDefault();canvas.focus({preventScroll:true});canvas.setPointerCapture(event.pointerId);
      pending.set(target,{event,point,canvas,chart:editor.session.chart,pane:editor.activePane,start:()=>previous.call(this,event)});
      if(area==='notes'){timeline.cursor=point;timeline.cursorLineIndex=timeline.lineIndexAt(point.x,canvas.clientWidth,'notes');}
      else timeline.eventCursor=point;
      timeline.hoverArea=area;timeline.clipboardPointer=point;timeline.changed();
    });
    const beginDrag=(event,entry)=>{
      if(!entry||event.pointerId!==entry.event.pointerId)return false;
      if(!state.active||editor.session.chart!==entry.chart||editor.activePane!==entry.pane){pending.delete(target);release(entry);return false;}
      const point=timeline.point(event,canvas);
      if(Math.hypot(point.x-entry.point.x,point.y-entry.point.y)<=3)return false;
      pending.delete(target);entry.start();return true;
    };
    api.patch(target,'move',previous=>function(event){
      const entry=pending.get(target);if(entry)beginDrag(event,entry);
      return previous.call(this,event);
    });
    api.patch(target,'up',previous=>function(event){
      const entry=pending.get(target);
      if(entry&&event.pointerId===entry.event.pointerId&&!beginDrag(event,entry)){
        pending.delete(target);release(entry);timeline.changed();return;
      }
      return previous.call(this,event);
    });
    api.listen(canvas,'pointercancel',()=>{const entry=pending.get(target);if(entry){pending.delete(target);release(entry);}});
  }
  api.listen(window,'blur',reset);
  api.listen(window,'keydown',event=>{if(event.key==='Escape')reset();},{capture:true});
  api.dispose(reset);
  return reset;
}
