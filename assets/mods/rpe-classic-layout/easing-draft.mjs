import { selectedEventEntries, eventListAt } from '@rpen/application/event-commands.mjs';
import { copyEventValueMemory } from '@rpen/application/event-value-memory.mjs';

export function installEasingDraft(api){
  const editor=api.editor;let draft=null,applying=false,rendering=0;
  const current=()=>draft&&editor.session===draft.session&&draft.session.chart===draft.base;
  api.hook('session:before-commit',change=>{
    if(!applying||!current()||change.session!==draft.session)return;
    change.cancel=true;draft.chart=change.chart;draft.label=change.label;draft.beforeSelection=change.beforeSelection;editor.invalidate();
  },1000);
  for(const key of ['draw','drawEvents'])api.patch(editor.timeline,key,previous=>function(...args){rendering++;try{return previous.apply(this,args);}finally{rendering--;}});
  api.patch(editor.timeline,'getSession',previous=>function(...args){
    if(!rendering||!current())return previous.apply(this,args);
    return draft.view;
  });
  api.hook('preview:before',payload=>{if(current()&&payload.chart===draft.base)payload.chart=draft.chart;});
  const finish=apply=>{
    const pending=draft,valid=current();draft=null;
    if(!pending)return;
    if(apply&&valid&&pending.chart!==pending.base){
      const before=pending.event,{lineIndex,type,index}=pending.entry,after=eventListAt({chart:pending.chart,eventLayer:pending.layer},lineIndex,type)[index];
      if(after&&JSON.stringify(before)!==JSON.stringify(after)){
        pending.session.commit(pending.label,pending.chart,pending.beforeSelection);
        if(pending.session.chart===pending.chart)copyEventValueMemory(pending.session,
          location=>eventListAt({chart:pending.base,eventLayer:pending.layer},lineIndex,location.type)[location.index],
          location=>eventListAt(pending.session,lineIndex,location.type,pending.layer)[location.index]);
      }
    }
    editor.invalidate();
  };
  const update=callback=>{
    if(draft&&!current())finish(false);
    if(!draft){
      const session=editor.session,entries=selectedEventEntries(session);if(entries.length!==1){callback();return;}
      const pending={session,base:session.chart,chart:session.chart,event:entries[0].event,entry:entries[0],layer:session.eventLayer};
      pending.view=Object.create(session);Object.defineProperty(pending.view,'chart',{get:()=>pending.chart});draft=pending;
    }
    applying=true;try{callback();}finally{applying=false;}
  };
  api.dispose(()=>finish(true));return{update,finish,get active(){return Boolean(draft);}};
}
