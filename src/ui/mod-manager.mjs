import { localPreferences } from '../platform/local-preferences.mjs';
import { MOD_API_VERSION,parseModPackage,modSettingValue } from '../core/mod-package.mjs';
import { ModRuntime,shortcutFromEvent,formatShortcut } from './mod-runtime.mjs';
import { builtinMods,readMods,storeMod,deleteMod,importMod,exportMod } from '../platform/mods.mjs';
import { download } from '../platform/files.mjs';
import { installModApi } from './mod-api.mjs';
import { localizedValue, t } from '../i18n.mjs';

const ENABLED='rpe-next-mod-enabled-v1',OPTIONS='rpe-next-mod-options-v1',BOOT='rpe-next-mod-boot-v1';
const read=(key,fallback)=>{try{return JSON.parse(localPreferences.getItem(key))??fallback;}catch{return fallback;}};
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const text=(tag,value,className='')=>{const node=document.createElement(tag);node.textContent=value;node.className=className;return node;};
const button=(value,run)=>{const node=document.createElement('button');node.type='button';node.textContent=value;node.onclick=run;return node;};
export class ModManager {
  constructor(editor,{notify,invalidate}){
    Object.assign(this,{editor,notify,invalidate});this.records=new Map();this.errors=new Map();const options=read(OPTIONS,{});this.options=Object.assign(Object.create(null),object(options)?options:{});this.desired=new Set(Array.isArray(read(ENABLED,[]))?read(ENABLED,[]):[]);this.selected=null;this.busy=false;
    this.runtime=new ModRuntime({editor,notify,invalidate,changed:()=>this.updateStatus()});this.runtime.emergency=()=>this.disableAll(true);this.runtime.installInput();
    this.render();document.querySelector('#mods-open').onclick=()=>this.open();document.querySelector('#mods-status').onclick=()=>this.open();
    window.rpenMods={apiVersion:MOD_API_VERSION,editor,runtime:this.runtime,manager:this,resolveModule:(...args)=>this.runtime.resolveModule(...args),disableAll:()=>this.disableAll(true)};installModApi(window.rpenMods);this.ready=this.load();
  }
  async load(){
    this.runtime.events.addEventListener('mod:unloaded',event=>{const {id,reason,error}=event.detail;if(reason==='error'){this.errors.set(id,error);this.desired.delete(id);this.persist();this.notify(t('mod-manager.s86b2076')+id+t('mod-manager.s2112669'),'warning');if(this.dialog.open)this.renderList();}const loaded=[...this.runtime.loaded.values()].filter(state=>state.record.manifest.dependencies.includes(id));for(const state of loaded)this.disable(state.id).catch(error=>this.notify(error.message,'error'));});
    try{
      for(const record of await builtinMods())this.records.set(record.manifest.id,record);
      for(const stored of await readMods())try{const record=parseModPackage(new Map(stored.files));if(!this.records.has(record.manifest.id))this.records.set(record.manifest.id,record);}catch(error){this.errors.set(stored.id,error.message);}
      const safe=new URL(location.href).searchParams.get('mods')==='off';const interrupted=read(BOOT,null);
      if(safe||interrupted){this.safe=true;this.banner.textContent=safe?t('mod-manager.se5ac3ae'):t('mod-manager.s7363c83');this.notify(this.banner.textContent,'warning');localPreferences.removeItem(BOOT);}
      else {for(const id of [...this.desired])if(this.records.has(id))try{await this.enable(id,false);}catch(error){this.desired.delete(id);this.errors.set(id,error.message);this.notify(t('mod-manager.s10851d3', { p0: id, p1: error.message }),'error');}else this.desired.delete(id);this.persist();}
      this.updateStatus();this.renderList();
    }catch(error){this.banner.textContent=t('mod-manager.s39621fa')+error.message;this.notify(this.banner.textContent,'warning');}
  }
  render(){
    this.dialog=document.createElement('dialog');this.dialog.id='mod-manager';this.dialog.className='mod-manager';this.dialog.dataset.modInteractive='true';
    const heading=document.createElement('div');heading.className='mod-manager-heading';heading.append(text('h2',t('mod-manager.s7dc54f7')),button(t('mod-manager.s6c14bd7'),()=>this.dialog.close()));
    const actions=document.createElement('div');actions.className='mod-manager-toolbar';
    this.file=document.createElement('input');this.file.type='file';this.file.accept='.rpenmod,.zip';this.file.hidden=true;this.file.setAttribute('aria-label',t('mod-manager.s2cf2437'));this.file.onchange=()=>this.importFiles(this.file.files);
    this.directory=document.createElement('input');this.directory.type='file';this.directory.webkitdirectory=true;this.directory.multiple=true;this.directory.hidden=true;this.directory.setAttribute('aria-label',t('mod-manager.s8985c65'));this.directory.onchange=()=>this.importFiles(this.directory.files,true);
    actions.append(button(t('mod-manager.s2cf2437'),()=>this.file.click()),button(t('mod-manager.s4d2d93e'),()=>this.directory.click()),button(t('mod-manager.s10887a2'),()=>this.disableAll()),button(t('mod-manager.saa7d494'),()=>this.showProtocol()));
    this.banner=text('p',t('mod-manager.s0ca0f78'),'hint');
    const body=document.createElement('div');body.className='mod-manager-body';this.list=document.createElement('div');this.list.className='mod-manager-list';this.list.setAttribute('aria-label',t('mod-manager.sfb98f13'));this.details=document.createElement('div');this.details.className='mod-manager-details';body.append(this.list,this.details);
    this.message=text('p',t('mod-manager.saad4ec0'),'hint');this.message.setAttribute('role','status');
    this.dialog.append(heading,actions,this.banner,body,this.message,this.file,this.directory);document.body.append(this.dialog);
    this.dialog.addEventListener('cancel',event=>{if(event.target===this.dialog){event.preventDefault();this.dialog.close();}});
    this.dialog.addEventListener('dragover',event=>event.preventDefault());this.dialog.addEventListener('drop',event=>{event.preventDefault();this.importFiles(event.dataTransfer.files);});
    this.warning=document.createElement('dialog');this.warning.id='mod-import-warning';this.warning.dataset.modInteractive='true';this.warning.className='mod-import-warning';document.body.append(this.warning);
    this.warning.addEventListener('cancel',event=>{if(event.target===this.warning){event.preventDefault();this.finishWarning(false);}});
  }
  async open(){await this.ready;this.renderList();if(!this.dialog.open)this.dialog.showModal();}
  renderList(){
    if(!this.selected||!this.records.has(this.selected))this.selected=this.records.keys().next().value;
    this.list.replaceChildren();for(const [id,record]of this.records){const active=this.runtime.loaded.has(id);const node=button('',()=>{this.selected=id;this.renderList();});node.className='mod-card';node.dataset.modId=id;node.setAttribute('aria-pressed',String(this.selected===id));node.append(text('strong',localizedValue(record.manifest.name)),text('span',t('mod-manager.s750c898', { p0: record.builtin?t('mod-manager.s09ceea7'):t('mod-manager.s60e2bca'), p1: record.manifest.version, p2: record.manifest.author })),text('small',active?t('mod-manager.s6ced5ae'):this.errors.has(id)?t('mod-manager.s9fb486c'):t('mod-manager.s0fe5a98')));this.list.append(node);}
    this.renderDetails();
  }
  renderDetails(){
    this.details.replaceChildren();const record=this.records.get(this.selected);if(!record){this.details.append(text('p',t('mod-manager.saf6ee2c')));return;}const {manifest}=record;const active=this.runtime.loaded.get(manifest.id);
    this.details.append(text('h3',localizedValue(manifest.name)),text('p',localizedValue(manifest.description)),text('p',`${manifest.id} · v${manifest.version} · API ${manifest.api} · ${manifest.author}`,'hint'));
    const actions=document.createElement('div');actions.className='mod-manager-toolbar';const toggle=button(active?t('mod-manager.s0880212'):t('mod-manager.sdf29e88'),()=>this.toggle(manifest.id));toggle.className=active?'':'primary';toggle.disabled=this.busy;actions.append(toggle,button(t('mod-manager.s6630c53'),()=>download(exportMod(record),manifest.id+'.rpenmod')));
    if(!record.builtin)actions.append(button(t('mod-manager.s6567e7a'),()=>this.remove(manifest.id)));this.details.append(actions);
    if(this.errors.has(manifest.id))this.details.append(text('pre',this.errors.get(manifest.id),'mod-error'));
    if(manifest.dependencies.length)this.details.append(text('p',t('mod-manager.s8b3887b')+manifest.dependencies.join('、'),'hint'));if(manifest.conflicts.length)this.details.append(text('p',t('mod-manager.s4150629')+manifest.conflicts.join('、'),'hint'));
    const settings=this.settingsFor(record);
    if(Object.keys(manifest.settings).length)this.details.append(button(t('mod-manager.s6e43199'),async()=>{for(const [key,definition]of Object.entries(manifest.settings))await this.setSetting(manifest.id,key,structuredClone(definition.default));this.renderDetails();}));
    for(const [key,definition]of Object.entries(manifest.settings)){
      const row=document.createElement('label');row.className='field';row.append(text('span',localizedValue(definition.label)));let control;
      if(definition.type==='select'){control=document.createElement('select');for(const [value,label]of Object.entries(definition.options))control.append(new Option(localizedValue(label),value));control.value=settings[key];}
      else{control=document.createElement('input');control.type=definition.type==='boolean'?'checkbox':definition.type==='shortcut'?'text':definition.type;control.value=settings[key];if(definition.type==='boolean')control.checked=settings[key];if(definition.type==='number'){control.min=definition.min;control.max=definition.max;control.step=definition.step??'any';}}
      control.dataset.modSetting=key;control.setAttribute('aria-label',localizedValue(definition.label));row.append(control);this.details.append(row);
      const save=async value=>{try{await this.setSetting(manifest.id,key,value);control.setCustomValidity('');this.message.textContent=t('mod-manager.s9fef6aa');}catch(error){control.setCustomValidity(error.message);this.message.textContent=error.message;}};
      if(definition.type==='shortcut'){control.readOnly=true;control.value=formatShortcut(settings[key]);control.title=t('mod-manager.s6c4574e');control.onkeydown=event=>{event.preventDefault();event.stopPropagation();const value=event.key==='Backspace'?'':shortcutFromEvent(event);if(value!==null){save(value);control.value=formatShortcut(value);}};}
      else control.onchange=()=>save(control.type==='checkbox'?control.checked:control.type==='number'?Number(control.value):control.value);
      if(definition.description)this.details.append(text('p',localizedValue(definition.description),'hint'));
    }
    if(active){const commands=[...this.runtime.commands.values()].filter(command=>command.owner===manifest.id);if(commands.length){this.details.append(text('h4',t('mod-manager.sf3ea6d3')));for(const command of commands)this.details.append(button(command.title??command.id,()=>{this.dialog.close();command.run();}));}this.details.append(text('p',t('mod-manager.sf54d723', { p0: active.errors }),'hint'));}
    const source=document.createElement('details');source.append(text('summary',t('mod-manager.se6c3777')));const code=document.createElement('pre');code.className='mod-source';code.textContent=[...record.files].filter(([name])=>/\.(json|m?js|css|md)$/.test(name)).map(([name,bytes])=>`— ${name} —\n${new TextDecoder().decode(bytes).slice(0,100000)}`).join('\n\n');source.append(code);this.details.append(source);
  }
  settingsFor(record){const id=record.manifest.id;if(!Object.hasOwn(this.options,id)||!object(this.options[id]))this.options[id]=Object.create(null);const values=this.options[id];for(const [key,definition]of Object.entries(record.manifest.settings)){try{if(!Object.hasOwn(values,key))throw Error();modSettingValue(definition,values[key],key);}catch{values[key]=structuredClone(definition.default);}}return values;}
  async setSetting(id,key,value){const record=this.records.get(id);if(!record)throw Error(t('mod-manager.s9898e8d'));modSettingValue(Object.hasOwn(record.manifest.settings,key)?record.manifest.settings[key]:null,value,key);this.settingsFor(record)[key]=value;localPreferences.setItem(OPTIONS,JSON.stringify(this.options));const state=this.runtime.loaded.get(id);if(state){state.settings=this.options[id];this.runtime.emit('settings:'+id,{key,value});}}
  persist(){localPreferences.setItem(ENABLED,JSON.stringify([...this.desired]));localPreferences.setItem(OPTIONS,JSON.stringify(this.options));}
  async enable(id,persist=true,chain=new Set()){
    if(this.runtime.loaded.has(id)){await this.runtime.loaded.get(id).promise;return;}if(chain.has(id))throw Error(t('mod-manager.se372ea7')+[...chain,id].join(' → '));const record=this.records.get(id);if(!record)throw Error(t('mod-manager.s274b62e')+id);chain.add(id);
    const checkConflicts=()=>{for(const conflict of record.manifest.conflicts)if(this.runtime.loaded.has(conflict))throw Error(t('mod-manager.s08f0345')+conflict);for(const state of this.runtime.loaded.values())if(state.record.manifest.conflicts.includes(id))throw Error(t('mod-manager.s08f0345')+state.id);};checkConflicts();
    for(const dependency of record.manifest.dependencies)await this.enable(dependency,persist,new Set(chain));
    checkConflicts();
    localPreferences.setItem(BOOT,JSON.stringify({id,time:Date.now()}));
    try{const state=await this.runtime.load(record,this.settingsFor(record),(key,value)=>this.setSetting(id,key,value));if(state?.status==='loaded'&&this.runtime.loaded.get(id)===state){this.errors.delete(id);this.desired.add(id);if(persist)this.persist();}}
    finally{localPreferences.removeItem(BOOT);}this.updateStatus();
  }
  async disable(id){for(const state of [...this.runtime.loaded.values()])if(state.record.manifest.dependencies.includes(id))await this.disable(state.id);await this.runtime.unload(id);this.desired.delete(id);this.persist();this.updateStatus();}
  async toggle(id){if(this.busy)return;this.busy=true;try{if(this.runtime.loaded.has(id))await this.disable(id);else await this.enable(id);this.message.textContent=this.runtime.loaded.has(id)?t('mod-manager.s5bb376d'):t('mod-manager.sbc2295f');}catch(error){this.errors.set(id,error.stack??error.message);this.notify(error.message,'error');}finally{this.busy=false;this.renderList();}}
  async disableAll(emergency=false){this.desired.clear();this.persist();for(const id of [...this.runtime.loaded.keys()].reverse())await this.runtime.unload(id);localPreferences.removeItem(BOOT);this.updateStatus();if(this.dialog.open)this.renderList();if(emergency)this.notify(t('mod-manager.sb66f83f'),'warning');}
  updateStatus(){const count=[...this.runtime.loaded.values()].filter(state=>state.status==='loaded').length;const node=document.querySelector('#mods-status');node.hidden=count===0;node.textContent=t('mod-manager.s0e1a497', { p0: count });node.title=t('mod-manager.sc43bb7d');this.invalidate();}
  async review(record){
    this.warning.replaceChildren(text('h2',t('mod-manager.se2ecae2')),text('p',`${localizedValue(record.manifest.name)} · ${record.manifest.version} · ${record.manifest.author}`),text('p',t('mod-manager.s8d616da')),text('p',t('mod-manager.sc2a5ae9')));
    const label=document.createElement('label');label.className='mod-consent';const consent=document.createElement('input');consent.type='checkbox';label.append(consent,t('mod-manager.sc56c250'));this.warning.append(label);
    const source=document.createElement('details');source.append(text('summary',t('mod-manager.s22ecfdc')));const pre=text('pre',[...record.files].filter(([path])=>/\.(m?js|json)$/.test(path)).map(([path,bytes])=>path+'\n'+new TextDecoder().decode(bytes).slice(0,100000)).join('\n\n'),'mod-source');source.append(pre);this.warning.append(source);
    const actions=document.createElement('div');actions.className='modal-actions';const accept=button(t('mod-manager.s056e307'),()=>this.finishWarning(true));accept.disabled=true;consent.onchange=()=>accept.disabled=!consent.checked;actions.append(button(t('mod-manager.s4d0b468'),()=>this.finishWarning(false)),accept);this.warning.append(actions);this.warning.showModal();return new Promise(resolve=>{this.warningResolve=resolve;});
  }
  finishWarning(accepted){this.warning.close();this.warningResolve?.(accepted);this.warningResolve=null;}
  async importFiles(files,directory=false){if(!files?.length||this.busy)return;this.busy=true;try{const record=await importMod(files,directory);if(this.records.get(record.manifest.id)?.builtin)throw Error(t('mod-manager.se2a7877'));if(!await this.review(record))return;if(this.records.has(record.manifest.id)&&!confirm(t('mod-manager.s0f1d758')))return;await this.disable(record.manifest.id);await storeMod(record);this.records.set(record.manifest.id,record);this.selected=record.manifest.id;this.message.textContent=t('mod-manager.sc774273');this.renderList();}catch(error){this.notify(error.message,'error');this.message.textContent=error.message;}finally{this.file.value='';this.directory.value='';this.busy=false;this.renderList();}}
  async remove(id){if(!confirm(t('mod-manager.s667ec6f')))return;await this.disable(id);await deleteMod(id);delete this.options[id];localPreferences.removeItem('rpe-next-mod-data:'+id);this.records.delete(id);this.persist();this.renderList();}
  showProtocol(){this.details.replaceChildren(text('h3',t('mod-manager.s6ebce19')),text('p',t('mod-manager.s656efc8')),text('p',t('mod-manager.s1b4dfbd')));
    const pre=text('pre',JSON.stringify({protocol:'rpen-mod',api:1,id:'example-mod',name:t('mod-manager.s30fd4ed'),version:'1.0.0',author:t('mod-manager.s698bea5'),description:t('mod-manager.s26670dd'),entry:'main.mjs'},null,2)+t('mod-manager.s33e5ce9'),'mod-source');this.details.append(pre,text('p',t('mod-manager.scda426f'),'hint'));
    const actions=document.createElement('div');actions.className='mod-manager-toolbar';for(const [label,path]of [[t('mod-manager.sc854009'),'protocols/MOD-PROTOCOL.zh-CN.md'],[t('mod-manager.s956acaa'),'protocols/GLOBAL-EVENTS-PROTOCOL.zh-CN.md'],[t('mod-manager.sdd30be1'),'schemas/mod-api-v1.d.ts'],[t('mod-manager.s2ae69ce'),'schemas/mod-v1.schema.json']])actions.append(button(label,async()=>{try{const response=await fetch(new URL('../../'+path,import.meta.url));if(!response.ok)throw Error(t('mod-manager.s896431a'));download(await response.blob(),path.split('/').at(-1));}catch(error){this.notify(error.message,'error');}}));this.details.append(actions);
  }
}
