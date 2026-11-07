import { SKIN_ID, layoutScale, canUseClassic, installGeometry } from './geometry.mjs';
import { ClassicInterface } from './interface.mjs';
import { installEventPainter } from './event-painter.mjs';
import { installDensity } from './density.mjs';
import { installAudioGeometry } from './audio-geometry.mjs';
import { installModeGeometry } from './mode-geometry.mjs';
import { installPropertyPanels } from './property-panels.mjs';
import { installFallbackAppearance } from './fallback-appearance.mjs';
import { installBatchPanels } from './batch-panels.mjs';
import { installTimelineSurfaces } from './timeline-surfaces.mjs';
import { installDisplaySettings } from './display-settings.mjs';
import { installMultiNoteRenderer } from './multi-note-renderer.mjs';
import { classicCompatibility, compatibilityNotice } from './compatibility.mjs';
import { installSelectionEscape } from './selection-escape.mjs';

export async function activate(api) {
  const editor = api.editor, root = document.documentElement;
  const incompatible=classicCompatibility(api);
  if(incompatible){api.notify(compatibilityNotice(incompatible),'warning');return;}
  const state = { active:false, scale:1, bypass:false, toolbarPage:0, homePage:0 };
  let ui = null, lastSize = '', closed = false,scheduled=0,measureTimer=0,lastSignal=[],lastPrepared=null,warned=false;
  api.style(api.package.text('layout.css'));
  installGeometry(api, state);
  installModeGeometry(api, state);
  installAudioGeometry(api, state);
  installDensity(api, state);
  await installEventPainter(api, state);
  installTimelineSurfaces(api,state);
  installMultiNoteRenderer(api,state);
  installSelectionEscape(api,state);
  const displaySettings=installDisplaySettings(api,state);
  const properties=installPropertyPanels(api,state);
  const batches=installBatchPanels(api,state);
  const appearance=installFallbackAppearance(api);
  let wasHome=editor.home;

  function measureNativeWidth(){
    if(!state.active)return;
    root.removeAttribute('data-rpe-classic-active');
    try{state.nativeNoteWidth=editor.timeline.notesCanvas.clientWidth;}finally{root.setAttribute('data-rpe-classic-active','true');}
    editor.invalidate();
  }
  function resize() {
    if (!state.active) return;
    const size = `${innerWidth},${innerHeight},${editor.timeline.notesOnly}`; if (size === lastSize) return;
    const initial=!lastSize,viewChanged=state.notesOnly!==editor.timeline.notesOnly;lastSize = size;state.notesOnly=editor.timeline.notesOnly;
    const scale = layoutScale(innerWidth, innerHeight);if(state.nativeNoteWidth)state.nativeNoteWidth*=scale/state.scale;state.scale = scale;
    root.style.setProperty('--rc-s', String(scale));
    root.style.setProperty('--rc-left', Math.max(0,(innerWidth-1920*scale)/2)+'px');
    root.style.setProperty('--rc-top', Math.max(0,(innerHeight-1080*scale)/2)+'px');
    clearTimeout(measureTimer);if(initial||viewChanged)measureNativeWidth();else measureTimer=setTimeout(measureNativeWidth,120);
    editor.invalidate();
  }
  function leave(relocating=false) {
    if (!state.active && !ui) return;
    state.active = false; root.removeAttribute('data-rpe-classic-active');
    clearTimeout(measureTimer);
    state.surfaces?.hide();displaySettings();
    properties.restore();
    batches.restore();
    ui?.destroy(); ui = null;
    appearance(false);
    if(!relocating&&editor.editorSkins.runtime.prepared?.record.skin.id===SKIN_ID)editor.editorSkins.runtime.sync();
    for (const name of ['--rc-s','--rc-left','--rc-top']) root.style.removeProperty(name);
    lastSize = '';lastPrepared=null; editor.invalidate();
  }
  function fail(detail){state.blocked=detail;leave();if(!warned){warned=true;api.notify(compatibilityNotice(detail),'warning');}}
  function sync() {
    if (closed) return;
    if(editor.home!==wasHome){
      wasHome=editor.home;
      if(wasHome&&root.dataset.editorSkin===SKIN_ID){const settings=document.querySelector('#settings-modal');if(settings?.open)settings.close();}
    }
    const wanted = root.dataset.editorSkin === SKIN_ID && api.settings.get('classic-layout') && !state.bypass && !state.blocked && canUseClassic(editor);
    if (!wanted) { leave(); return; }
    if (!state.active) {
      state.active = true; root.setAttribute('data-rpe-classic-active','true'); resize();
      displaySettings();
      appearance(true);
      try { ui = new ClassicInterface(api, state,requestSync); } catch (error) { fail(error.message);return; }
      properties.sync();
      batches.sync();
      editor.editorSkins.runtime.sync();
      editor.invalidate();
    }
    if(!ui?.ready()){fail('interface nodes');return;}
    const prepared=editor.editorSkins.runtime.prepared;
    if(prepared!==lastPrepared){lastPrepared=prepared;appearance(true);}
    try{resize();ui.sync();}catch(error){fail(error.message);}
  }
  function requestSync(){if(closed||scheduled)return;scheduled=requestAnimationFrame(()=>{scheduled=0;sync();});}
  function frame(){
    if(closed)return;
    const session=editor.session,key=[root.dataset.editorSkin,editor.editorSkins.runtime.prepared,editor.home,editor.hasDocument,editor.activePane,editor.preview.visible,session,session.chart,session.lineIndex,session.multiLineActive,session.multiLineMode,editor.timeline.notesOnly,editor.noiseEditor.active,editor.noiseEditor.selected,editor.globalEvents.active,editor.globalEvents.geometry,editor.directPlacement.active,state.propertyHeaders?.notes,state.propertyHeaders?.events,state.batchHeader,innerWidth,innerHeight];
    if(key.length===lastSignal.length&&key.every((value,index)=>value===lastSignal[index])&&(!ui||ui.ready()))return;
    lastSignal=key;requestSync();
  }
  api.hook('ui:before-relocate', payload => {
    if (!state.active || !ui?.owner.owns(payload.node)) return;
    if (payload.reason==='skin-restore'||root.dataset.editorSkin !== SKIN_ID) leave(true); else payload.cancel = true;
  });
  api.listen(document, 'rpen-editor-skin-changed',requestSync);
  api.listen(document,'input',requestSync);api.listen(document,'change',requestSync);
  api.listen(window,'scroll',requestSync,{capture:true,passive:true});
  api.listen(window, 'resize',()=>{resize();requestSync();});
  api.on('editor:state',requestSync);
  api.onFrame(frame);
  api.settings.onChange(({key}) => { if(key==='classic-layout'){state.blocked='';warned=false;state.bypass = false;}requestSync(); });
  api.commands.register({id:'toggle-native-layout', title:'RPE Classic / Inkline', setting:'native-layout-key', run() { state.bypass = !state.bypass; sync(); }});
  const observer = new MutationObserver(requestSync);
  observer.observe(root, {attributes:true,attributeFilter:['data-editor-skin','data-mod-editing-locked']});
  api.dispose(() => { closed = true;cancelAnimationFrame(scheduled);clearTimeout(measureTimer);observer.disconnect(); leave(); state.urls?.clear(); });
  sync();
}
