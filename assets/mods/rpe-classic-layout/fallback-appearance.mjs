import { setEditorCanvasSkin } from '@rpen/ui/editor-skin-canvas.mjs';
import { resolveEditorSkin } from '@rpen/core/editor-skin.mjs';

export function installFallbackAppearance(api) {
  const classic=JSON.parse(api.package.text('classic-canvas.json'));
  const marked=new Set(),selector='.inspector > section,dialog,.timeline-context-menu,.line-switcher,#performance-monitor,#speed-curve-panel,#animation-curve-editor,#shader-code-window,.event-value-scale-mode,.event-scale-axis-input';
  let active=false,queued=false,disposed=false;
  const mark=()=>{
    queued=false;if(!active||disposed)return;
    for(const node of marked)if(!node.isConnected||node.matches('[data-panel=chart],[data-rc-property]')){node.removeAttribute('data-rc-native-surface');marked.delete(node);}
    for(const node of document.querySelectorAll(selector)){
      if(node.matches('[data-panel=chart],[data-rc-property]')||marked.has(node))continue;
      node.setAttribute('data-rc-native-surface','');marked.add(node);
    }
  };
  const observer=new MutationObserver(mutations=>{
    if(!active||queued||!mutations.some(m=>m.type==='attributes'||(m.target===document.body||m.target.matches?.('.inspector,.stage'))&&[...m.addedNodes].some(n=>n.nodeType===1&&(n.matches(selector)||n.querySelector(selector)))))return;
    queued=true;queueMicrotask(mark);
  });
  observer.observe(document.body,{childList:true});
  observer.observe(document.querySelector('.stage'),{childList:true});
  observer.observe(document.querySelector('.inspector'),{childList:true,subtree:true,attributes:true,attributeFilter:['data-rc-property']});
  api.dispose(()=>{disposed=true;observer.disconnect();for(const node of marked)node.removeAttribute('data-rc-native-surface');marked.clear();});
  return enabled=>{
    active=enabled;
    if(active)mark();else{for(const node of marked)node.removeAttribute('data-rc-native-surface');marked.clear();}
    const prepared=api.editor.editorSkins.runtime.prepared;
    if(prepared?.record.skin.id!=='rpe-classic')return;
    const config=enabled?resolveEditorSkin({...prepared.record.skin,canvas:classic},{parameters:Object.fromEntries(Object.keys(prepared.record.skin.parameters??{}).map(key=>[key,prepared.record.skin.tokens['param-'+key]]))}).canvas:prepared.record.skin.canvas;
    setEditorCanvasSkin(config,prepared.fonts.get(config?.font)??'',prepared.fonts);
  };
}
