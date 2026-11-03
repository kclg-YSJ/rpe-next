import { RenderStudio } from './studio.mjs';
import { localPreferences } from '../../platform/local-preferences.mjs';
import { cancelValueDrag } from '../draggable-value.mjs';

// This is an application module. It does not register a mod, a hotkey, card
// actions, DOM observers or a second public entry point.
export function createRenderStudio(editor, { notify, drawOverlays } = {}) {
  let studio;
  const host = {
    editor, notify, drawOverlays,
    storage: {
      read(fallback) { try { return JSON.parse(localPreferences.getItem('rpen-render-studio-v1') ?? 'null') ?? fallback; } catch { return fallback; } },
      write(value) { localPreferences.setItem('rpen-render-studio-v1', JSON.stringify(value)); }
    },
    mount(root) { root.dataset.renderInteractive='true';document.body.append(root);root.showModal(); },
    listen(target,type,callback,options) { target.addEventListener(type,callback,options);return()=>target.removeEventListener(type,callback,options); },
    hook(name,callback) {
      if(name!=='input:before')return()=>{};
      const listener=event=>{if(!studio?.isOpen)return;const payload={event,handled:false};callback(payload);if(payload.handled){event.preventDefault();event.stopImmediatePropagation();}};
      window.addEventListener('keydown',listener,true);return()=>window.removeEventListener('keydown',listener,true);
    },
    lockEditing() {
      cancelValueDrag();
      const root=studio.root,previous=document.activeElement;
      const nodes=[...document.body.children].filter(node=>node!==root&&node.tagName!=='SCRIPT'&&node.tagName!=='STYLE');
      const saved=nodes.map(node=>[node,node.inert]);for(const node of nodes)node.inert=true;
      const stop=event=>event.stopPropagation();root.addEventListener('keydown',stop);root.addEventListener('keyup',stop);
      let released=false;return()=>{if(released)return;released=true;for(const [node,inert]of saved)node.inert=inert;root.removeEventListener('keydown',stop);root.removeEventListener('keyup',stop);if(previous?.isConnected&&!previous.closest('[inert]'))previous.focus({preventScroll:true});};
    }
  };
  studio=new RenderStudio(host);return studio;
}
