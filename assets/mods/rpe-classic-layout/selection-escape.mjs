import { shortcutMatches, shortcutReleased } from '@rpen/core/preferences.mjs';
import { isTextEntry, usesNativeTextShortcut } from '@rpen/ui/keyboard.mjs';

const selected=session=>Boolean(session.selection.size||session.eventSelection.size||session.multiLineActive&&[...session.multiLineSelection.values(),...session.multiEventSelection.values()].some(values=>values.size)||session.largeDocument?.selectedCount);
const clear=session=>{
  session.selection.clear();session.eventSelection.clear();
  session.multiLineSelection?.clear();session.multiEventSelection?.clear();session.multiSelectionIntent=null;
};

export function installSelectionEscape(api,state){
  const editor=api.editor;let cancelling=false;
  api.listen(window,'blur',()=>{cancelling=false;});
  api.hook('input:before',payload=>{
    const event=payload.event;
    if(event.type==='keyup'&&shortcutReleased(event,editor.preferences.hotkeys.Esc)){cancelling=false;return;}
    if(!state.active||payload.handled||event.type!=='keydown'||usesNativeTextShortcut(event)||isTextEntry(event.target)||!shortcutMatches(event,editor.preferences.hotkeys.Esc))return;
    if(cancelling){payload.handled=true;return;}
    if(editor.home||!editor.hasDocument||document.querySelector('dialog[open],:popover-open:not(#key-display-overlay)')||editor.speedCurve?.active||editor.eventSampler?.active||editor.noiseEditor?.sampleMode||editor.spatialTool?.enabled||editor.batchControls?.active||editor.timeline.eventValueScale)return;
    const noise=editor.noiseEditor,global=editor.globalEvents;
    if(noise.active&&!editor.preview.visible){
      payload.handled=true;if(event.repeat)return;
      const hadSelection=noise.selection.size>0;cancelling=hadSelection;
      noise.cancelGesture();noise.selection.clear();noise.event=null;noise.pending=null;
      if(!hadSelection)noise.clipboard=null;
      noise.activate('noise');noise.render();editor.invalidate();return;
    }
    if(global.active){
      const session=global.document.editor;
      if(!session.eventSelection.size){document.querySelector('#clear-clipboard')?.click();return;}
      payload.handled=true;if(event.repeat)return;
      cancelling=true;
      global.timeline.cancelPlacement();session.eventSelection.clear();session.notify();editor.invalidate();return;
    }
    const session=editor.session;
    if(!selected(session)){if(!editor.directPlacement.active)document.querySelector('#clear-clipboard')?.click();return;}
    payload.handled=true;if(event.repeat)return;
    cancelling=true;
    clear(session);editor.timeline.cancelPlacement();session.notify();editor.invalidate();
  });
}
