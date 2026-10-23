import { localPreferences } from '../platform/local-preferences.mjs';
import { rewriteModModule,resolveModImport,modPath,modSettingValue } from '../core/mod-package.mjs';
import { registerModHook,emitModHook } from '../core/mod-hooks.mjs';
import { parseShortcut,formatShortcut } from '../core/shortcut-spec.mjs';
import { shortcutKey,shortcutMatches } from '../core/preferences.mjs';
import { isTextEntry } from './keyboard.mjs';
import { cancelValueDrag } from './draggable-value.mjs';
import { t } from '../i18n.mjs';

export class ModScope {
  constructor(onError=console.error){this.cleanups=[];this.onError=onError;this.closed=false;this.controller=new AbortController();}
  defer(dispose){if(typeof dispose!=='function')throw Error(t('mod-runtime.s9452ef4'));const invoke=()=>{const result=dispose();if(result?.catch)result.catch(this.onError);};if(this.closed){invoke();return()=>{};}let active=true;const cleanup=()=>{if(!active)return;active=false;const index=this.cleanups.indexOf(cleanup);if(index>=0)this.cleanups.splice(index,1);invoke();};this.cleanups.push(cleanup);return cleanup;}
  wrap(callback){return(...args)=>{if(this.closed)return;try{const result=callback(...args);if(result?.catch)result.catch(this.onError);return result;}catch(error){this.onError(error);}};}
  listen(target,type,callback,options){const wrapped=this.wrap(callback);target.addEventListener(type,wrapped,options);return this.defer(()=>target.removeEventListener(type,wrapped,options));}
  dispose(){if(this.closed)return;this.closed=true;this.controller.abort();for(const cleanup of this.cleanups.splice(0).reverse())try{cleanup();}catch(error){this.onError(error);}}
}
export class ModRuntime {
  constructor({editor,notify,invalidate,changed}){Object.assign(this,{editor,notify,invalidate,changed});this.loaded=new Map();this.commands=new Map();this.frames=new Set();this.overlays=new Set();this.events=new EventTarget();this.locks=new Map();this.moduleLoads=new Map();this.baseUrl=new URL('../../',import.meta.url).href;this.patchTargets=new WeakMap();}
  async prepareModules(record){
    const loadId=record.manifest.id+'-'+crypto.randomUUID();const prefix='@rpen-mod/'+loadId+'/';const resolve=(specifier,path)=>resolveModImport(specifier,path,record.files,prefix,this.baseUrl);const imports={};const urls=[];
    try{
      for(const [path,bytes]of record.files){if(!/\.(m?js|json)$/.test(path))continue;let source=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
        if(path.endsWith('.json'))source='export default '+JSON.stringify(JSON.parse(source))+';';else source=rewriteModModule(source,path,resolve,loadId);
        const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));urls.push(url);imports[prefix+path]=url;
      }
      const map=document.createElement('script');map.type='importmap';map.textContent=JSON.stringify({imports});document.head.append(map);
      const state={loadId,prefix,record,resolve,urls,map};this.moduleLoads.set(loadId,state);return state;
    }catch(error){urls.forEach(URL.revokeObjectURL);throw error;}
  }
  resolveModule(loadId,specifier,path){const load=this.moduleLoads.get(loadId);if(!load)throw Error(t('mod-runtime.sef97df0'));return load.resolve(specifier,path);}
  load(record,settings,onSetting){
    const existing=this.loaded.get(record.manifest.id);if(existing)return existing.promise??Promise.resolve(existing);
    const promise=this.activate(record,settings,onSetting);const state=this.loaded.get(record.manifest.id);if(state)state.promise=promise;return promise;
  }
  async activate(record,settings,onSetting){
    const id=record.manifest.id;
    const scope=new ModScope(error=>this.failure(id,error));const state={id,record,scope,settings,onSetting,status:'loading',errors:0};this.loaded.set(id,state);
    try{
      const modules=await this.prepareModules(record);state.modules=modules;scope.defer(()=>{modules.urls.forEach(URL.revokeObjectURL);modules.map.remove();this.moduleLoads.delete(modules.loadId);});
      const api=this.createApi(state);state.api=api;
      // CSP allows imported package modules; packages deliberately execute with the page's authority.
      const module=await import(modules.prefix+record.manifest.entry);if(scope.closed)return;const activate=module.activate??module.default;if(typeof activate!=='function')throw Error(t('mod-runtime.sb26e4e7'));
      const cleanup=await activate(api);if(typeof cleanup==='function')scope.defer(cleanup);else if(cleanup?.dispose)scope.defer(()=>cleanup.dispose());
      if(scope.closed)return;
      state.status='loaded';this.emit('mod:loaded',{id});this.changed();this.invalidate();return state;
    }catch(error){scope.dispose();if(this.loaded.get(id)===state)this.loaded.delete(id);this.changed();if(!state.cancelled)throw error;}
  }
  async unload(id,reason='disabled'){const state=this.loaded.get(id);if(!state)return;state.cancelled=true;this.loaded.delete(id);state.scope.dispose();this.emit('mod:unloaded',{id,reason,error:state.lastError});this.changed();this.invalidate();}
  failure(id,error){const state=this.loaded.get(id);if(state){state.errors++;state.lastError=error?.stack??String(error);if(state.errors===1)this.notify(t('mod-runtime.s6cca735', { p0: id, p1: error?.message??error }),'error');if(state.errors>=5&&state.status==='loaded'){state.status='error';queueMicrotask(()=>this.unload(id,'error'));}}console.error('[mod '+id+']',error);this.changed();}
  emit(type,detail){this.events.dispatchEvent(new CustomEvent(type,{detail}));}
  tick(detail){
    if(this.loaded.size){const editor=this.editor;const state={session:editor.session,chart:editor.chart,playing:detail.playing,home:editor.home,pane:editor.activePane,lineIndex:editor.session?.lineIndex,dirty:editor.dirty};const previous=this.editorState;
      if(!previous||Object.keys(state).some(key=>state[key]!==previous[key]))this.emit('editor:state',{...state,previous});
      if(!previous||state.chart!==previous.chart||state.session!==previous.session)this.emit('editor:chart',{chart:state.chart,session:state.session});this.editorState=state;
      if(detail.musicSeconds!==this.lastTime){this.lastTime=detail.musicSeconds;this.emit('editor:time',detail);}
    }else{this.editorState=null;this.lastTime=undefined;}
    for(const entry of [...this.frames])entry.callback(detail);
  }
  draw(renderer,frame){for(const entry of [...this.overlays])if(!entry.target||entry.target===frame.target)entry.callback({...frame,renderer});}
  shortcut(event){
    if(event.isComposing||event.repeat||isTextEntry(event.target))return false;
    for(const command of [...this.commands.values()].reverse()){
      const state=this.loaded.get(command.owner);const key=command.setting?state?.settings[command.setting]:command.shortcut;
      if(!key||!shortcutMatches(event,key)||document.querySelector('dialog[open]')&&!command.allowInDialog||this.locks.size&&!this.locks.has(command.owner))continue;
      cancelValueDrag();event.preventDefault();event.stopImmediatePropagation();command.run();return true;
    }return false;
  }
  lock(owner,options={}){
    cancelValueDrag();
    const token=Symbol(owner);const releases=[];const roots=options.roots??['header nav > :not(#mods-open)','.transport','.editor-toolbar','.timeline-head','.editor-footer','.inspector','.preview-overlay','.canvases','#noise-editor-canvas','.timeline-strips','#home'];
    const nodes=new Set();const protect='#mods-open,#mods-status,[data-mod-interactive]';const collect=node=>{if(node.matches(protect))return;if(node.querySelector(protect)){for(const child of node.children)collect(child);}else nodes.add(node);};for(const selector of roots)for(const node of document.querySelectorAll(selector))collect(node);
    this.inertNodes??=new WeakMap();for(const node of nodes){let state=this.inertNodes.get(node);if(!state){state={previous:node.inert,count:0};this.inertNodes.set(node,state);}state.count++;node.inert=true;releases.push(()=>{state.count--;if(!state.count){node.inert=state.previous;this.inertNodes.delete(node);}});}
    const entry={token,reason:options.reason??owner};let tokens=this.locks.get(owner);if(!tokens){tokens=new Set();this.locks.set(owner,tokens);}tokens.add(entry);document.documentElement.dataset.modEditingLocked='true';
    let done=false;return()=>{if(done)return;done=true;releases.reverse().forEach(fn=>fn());tokens.delete(entry);if(!tokens.size)this.locks.delete(owner);if(!this.locks.size)delete document.documentElement.dataset.modEditingLocked;};
  }
  handleInput(event){
    const input=emitModHook('input:before',{event,handled:false});if(input.handled){cancelValueDrag();event.preventDefault();event.stopImmediatePropagation();return;}
    if(event.type==='keydown'&&this.shortcut(event))return;
    if(!this.locks.size)return;
    const bypass=event.target?.closest?.('[data-mod-interactive],#mod-manager,#mods-open,#mods-status,#mods-emergency');if(bypass)return;
    if(['keydown','keyup','wheel','pointerdown','pointerup','click','dblclick','contextmenu','drop','dragstart','input','change','submit'].includes(event.type)){event.preventDefault();event.stopImmediatePropagation();}
  }
  installInput(){
    if(globalThis.__rpenModInputGate)return;
    for(const type of ['keydown','keyup','wheel','pointerdown','pointerup','mousedown','mouseup','click','dblclick','contextmenu','drop','dragstart','input','change','submit'])window.addEventListener(type,event=>{
      if(type==='keydown'&&event.ctrlKey&&event.altKey&&event.shiftKey&&event.key==='F11'){event.preventDefault();event.stopImmediatePropagation();this.emergency?.();return;}this.handleInput(event);
    },{capture:true,passive:false});
  }
  patch(scope,target,key,wrapper){
    if(!target||typeof wrapper!=='function')throw Error(t('mod-runtime.s4bf7cad'));let props=this.patchTargets.get(target);if(!props){props=new Map();this.patchTargets.set(target,props);}let stack=props.get(key);
    if(!stack){const original=target[key];stack={original,entries:[],had:Object.hasOwn(target,key),descriptor:Object.getOwnPropertyDescriptor(target,key)};props.set(key,stack);}
    const entry={wrapper};stack.entries.push(entry);const rebuild=()=>{let value=stack.original;for(const item of stack.entries)value=item.wrapper(value);Object.defineProperty(target,key,{configurable:true,enumerable:stack.descriptor?.enumerable??true,writable:true,value});};try{rebuild();}catch(error){stack.entries.pop();if(!stack.entries.length)props.delete(key);throw error;}
    return scope.defer(()=>{stack.entries=stack.entries.filter(item=>item!==entry);if(stack.entries.length)rebuild();else{if(stack.had)Object.defineProperty(target,key,stack.descriptor);else delete target[key];props.delete(key);}});
  }
  createApi(state){
    const {scope,id,record}=state;const storedKey='rpe-next-mod-data:'+id;
    const api={version:1,id,manifest:record.manifest,editor:this.editor,signal:scope.controller.signal,dispose:fn=>scope.defer(fn),
      log:(...args)=>console.log('[mod '+id+']',...args),notify:(message,level='success')=>this.notify(String(message),level),
      listen:(target,type,fn,options)=>scope.listen(target,type,fn,options),
      on:(type,fn)=>scope.listen(this.events,type,event=>fn(event.detail)),emit:(type,detail)=>this.emit('mod:'+id+':'+type,detail),
      hook:(name,fn,priority=0)=>scope.defer(registerModHook(name,fn,priority,error=>this.failure(id,error))),
      onFrame:fn=>{const entry={owner:id,callback:scope.wrap(fn)};this.frames.add(entry);return scope.defer(()=>this.frames.delete(entry));},
      onPreview:(fn,options={})=>{const entry={owner:id,callback:scope.wrap(fn),target:options.target??'preview'};this.overlays.add(entry);return scope.defer(()=>this.overlays.delete(entry));},
      patch:(target,key,wrapper)=>this.patch(scope,target,key,wrapper),
      timeout:(fn,ms)=>{const timer=setTimeout(scope.wrap(fn),ms);return scope.defer(()=>clearTimeout(timer));},
      interval:(fn,ms)=>{const timer=setInterval(scope.wrap(fn),ms);return scope.defer(()=>clearInterval(timer));},
      mount:(node,parent=document.body)=>{parent.append(node);scope.defer(()=>node.remove());return node;},
      style:css=>{const sheet=document.createElement('style');sheet.textContent=css;document.head.append(sheet);scope.defer(()=>sheet.remove());return sheet;},
      settings:{get:key=>state.settings[key],set:async(key,value)=>{const definition=Object.hasOwn(record.manifest.settings,key)?record.manifest.settings[key]:null;if(!definition)throw Error(t('mod-runtime.s40f23f5')+key);modSettingValue(definition,value,key);await state.onSetting(key,value);},onChange:fn=>scope.listen(this.events,'settings:'+id,event=>fn(event.detail))},
      storage:{read:(fallback={})=>{try{return JSON.parse(localPreferences.getItem(storedKey))??structuredClone(fallback);}catch{return structuredClone(fallback);}},write:value=>localPreferences.setItem(storedKey,JSON.stringify(value)),clear:()=>localPreferences.removeItem(storedKey)},
      package:{files:()=>[...record.files.keys()],bytes:path=>record.files.get(modPath(path))?.slice()??null,
        text:path=>new TextDecoder('utf-8',{fatal:true}).decode(record.files.get(modPath(path))??new Uint8Array()),
        url:(path,type)=>{const bytes=record.files.get(modPath(path));if(!bytes)throw Error(t('mod-runtime.s16b76fa')+path);const extension=path.split('.').at(-1).toLowerCase();const mime=type??({png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',svg:'image/svg+xml',webp:'image/webp',gif:'image/gif',ogg:'audio/ogg',wav:'audio/wav',mp3:'audio/mpeg',json:'application/json',css:'text/css',woff2:'font/woff2',ttf:'font/ttf'}[extension]??'application/octet-stream');const url=URL.createObjectURL(new Blob([bytes],{type:mime}));scope.defer(()=>URL.revokeObjectURL(url));return url;},
        import:path=>import(state.modules.resolve('./'+modPath(path),'')),
      },
      commands:{register:definition=>{if(typeof definition.id!=='string'||typeof definition.run!=='function')throw Error(t('mod-runtime.s983ca62'));const key=id+':'+definition.id;if(this.commands.has(key))throw Error(t('mod-runtime.s34c4b47')+key);const command={...definition,owner:id,run:scope.wrap(definition.run)};this.commands.set(key,command);this.changed();return scope.defer(()=>{this.commands.delete(key);this.changed();});}},
      globalEvents:{
        register:definition=>{
          const wrap=definition=>Object.fromEntries(Object.entries(definition).map(([key,value])=>[key,typeof value==='function'?(...args)=>{if(scope.closed)throw Error(t('mod-runtime.sdaeeea1'));try{return value(...args);}catch(error){this.failure(id,error);throw error;}}:value]));
          return scope.defer(this.editor.globalEventRegistry.register({...wrap(definition),columns:definition.columns?.map(wrap)},
            {kind:'mod',id,name:record.manifest.name,author:record.manifest.author,version:record.manifest.version}));
        },
        list:()=>this.editor.globalEvents.document.types.map(type=>({id:type.id,name:type.name,source:{...type.source},persistent:type.persistent,readonly:type.readonly,columns:type.columns.map(column=>({id:column.id,name:column.name,valueType:column.valueType}))})),
        read:(type,column)=>this.editor.globalEvents.document.read(type.includes('/')?type:id+'/'+type,column),
        replace:(type,column,events,label=t('mod-runtime.s28fb7b2'))=>{const key=type.includes('/')?type:id+'/'+type;if(!key.startsWith(id+'/'))throw Error(t('mod-runtime.sbbd80a0'));return this.editor.globalEvents.document.apply([{type:key,column,events}],label);},
        open:()=>this.editor.openGlobalEvents(),
      },
      lockEditing:options=>scope.defer(this.lock(id,options)),
      importInternal:path=>import(new URL('src/'+modPath(path),this.baseUrl).href),
    };return api;
  }
}
export function shortcutFromEvent(event){const parts=[];if(event.ctrlKey||event.metaKey)parts.push('CTRL');if(event.altKey)parts.push('ALT');if(event.shiftKey)parts.push('SHIFT');const key=shortcutKey(event);if(!['CONTROL','SHIFT','ALT','META'].includes(key))parts.push(key);const result=parseShortcut(parts.join('&'));return result.error?null:result.value;}
export {formatShortcut};
