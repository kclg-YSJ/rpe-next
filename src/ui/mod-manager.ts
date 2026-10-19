import { localPreferences } from '../platform/local-preferences.ts';
import { MOD_API_VERSION,parseModPackage,modSettingValue } from '../core/mod-package.ts';
import { ModRuntime,shortcutFromEvent,formatShortcut } from './mod-runtime.ts';
import { builtinMods,readMods,storeMod,deleteMod,importMod,exportMod } from '../platform/mods.ts';
import { download } from '../platform/files.ts';
import { installModApi } from './mod-api.ts';
import type { ModCommand, ModEditor, ModManifest, ModRecord, ModSettings } from './mod-runtime.ts';
import type { ModHost } from './mod-api.ts';

interface ModManagerOptions { notify: (message: string, level?: string) => void; invalidate: () => void }
interface StoredMod { id: string; files: [string, Uint8Array][] }
interface ModUnloadDetail { id: string; reason: string; error?: string }

const ENABLED='rpe-next-mod-enabled-v1',OPTIONS='rpe-next-mod-options-v1',BOOT='rpe-next-mod-boot-v1';
const read=<T>(key:string,fallback:T):T=>{try{return (JSON.parse(localPreferences.getItem(key)??'null')??fallback) as T;}catch{return fallback;}};
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
const errorMessage=(error:unknown):string=>error instanceof Error?error.message:String(error);
const errorStack=(error:unknown):string=>error instanceof Error?error.stack??error.message:String(error);
const text=<K extends keyof HTMLElementTagNameMap>(tag:K,value:string,className=''):HTMLElementTagNameMap[K]=>{const node=document.createElement(tag);node.textContent=value;node.className=className;return node;};
const button=(value:string,run:()=>void):HTMLButtonElement=>{const node=document.createElement('button');node.type='button';node.textContent=value;node.onclick=run;return node;};
export class ModManager {
  editor: ModEditor;
  notify: (message: string, level?: string) => void;
  invalidate: () => void;
  records: Map<string, ModRecord>;
  errors: Map<string, string>;
  options: Record<string, ModSettings>;
  desired: Set<string>;
  selected: string | null;
  busy: boolean;
  runtime: ModRuntime;
  ready!: Promise<void>;
  dialog!: HTMLDialogElement;
  warning!: HTMLDialogElement;
  file!: HTMLInputElement;
  directory!: HTMLInputElement;
  banner!: HTMLElement;
  list!: HTMLElement;
  details!: HTMLElement;
  message!: HTMLElement;
  safe: boolean;
  warningResolve: ((accepted: boolean) => void) | null;

  constructor(editor: ModEditor, {notify,invalidate}: ModManagerOptions) {
    this.editor=editor;this.notify=notify;this.invalidate=invalidate;this.records=new Map();this.errors=new Map();const options=read<unknown>(OPTIONS,{});this.options=Object.assign(Object.create(null) as ModSettings,object(options)?options:{}) as Record<string, ModSettings>;const enabled=read<unknown>(ENABLED,[]);this.desired=new Set(Array.isArray(enabled)?enabled as string[]:[]);this.selected=null;this.busy=false;this.safe=false;this.warningResolve=null;
    this.runtime=new ModRuntime({editor,notify,invalidate,changed:()=>this.updateStatus()});this.runtime.emergency=()=>this.disableAll(true);this.runtime.installInput();
    this.render();document.querySelector<HTMLButtonElement>('#mods-open')!.onclick=()=>this.open();document.querySelector<HTMLButtonElement>('#mods-status')!.onclick=()=>this.open();
    const host: ModHost={apiVersion:MOD_API_VERSION,editor,runtime:this.runtime,manager:this,resolveModule:(...args:Parameters<ModRuntime['resolveModule']>)=>this.runtime.resolveModule(...args),disableAll:()=>this.disableAll(true)};Object.assign(window,{rpenMods:host});installModApi(host);this.ready=this.load();
  }
  async load(): Promise<void> {
    this.runtime.events.addEventListener('mod:unloaded',event=>{const {id,reason,error}=(event as CustomEvent<ModUnloadDetail>).detail;if(reason==='error'){this.errors.set(id,error??'');this.desired.delete(id);this.persist();this.notify('模组 '+id+' 连续出错，已自动禁用。','warning');if(this.dialog.open)this.renderList();}const loaded=[...this.runtime.loaded.values()].filter(state=>state.record.manifest.dependencies.includes(id));for(const state of loaded)this.disable(state.id).catch(error=>this.notify(errorMessage(error),'error'));});
    try{
      for(const record of await builtinMods() as ModRecord[])this.records.set(record.manifest.id,record);
      for(const stored of await readMods() as StoredMod[])try{const record=parseModPackage(new Map(stored.files)) as ModRecord;if(!this.records.has(record.manifest.id))this.records.set(record.manifest.id,record);}catch(error){this.errors.set(stored.id,errorMessage(error));}
      const safe=new URL(location.href).searchParams.get('mods')==='off';const interrupted=read<{id:string;time:number}|null>(BOOT,null);
      if(safe||interrupted){this.safe=true;this.banner.textContent=safe?'恢复启动：本次启动不装载任何模组。':'上次装载模组时未完成，已跳过自动装载。请检查后逐个启用。';this.notify(this.banner.textContent,'warning');localPreferences.removeItem(BOOT);}
      else {for(const id of [...this.desired])if(this.records.has(id))try{await this.enable(id,false);}catch(error){this.desired.delete(id);this.errors.set(id,errorMessage(error));this.notify(`模组 ${id} 未能装载：${errorMessage(error)}`,'error');}else this.desired.delete(id);this.persist();}
      this.updateStatus();this.renderList();
    }catch(error){this.banner.textContent='模组目录读取失败：'+errorMessage(error);this.notify(this.banner.textContent,'warning');}
  }
  render(): void {
    this.dialog=document.createElement('dialog');this.dialog.id='mod-manager';this.dialog.className='mod-manager';this.dialog.dataset.modInteractive='true';
    const heading=document.createElement('div');heading.className='mod-manager-heading';heading.append(text('h2','模组管理器'),button('关闭',()=>this.dialog.close()));
    const actions=document.createElement('div');actions.className='mod-manager-toolbar';
    this.file=document.createElement('input');this.file.type='file';this.file.accept='.rpenmod,.zip';this.file.hidden=true;this.file.setAttribute('aria-label','导入模组包');this.file.onchange=()=>this.importFiles(this.file.files);
    this.directory=document.createElement('input');this.directory.type='file';this.directory.webkitdirectory=true;this.directory.multiple=true;this.directory.hidden=true;this.directory.setAttribute('aria-label','导入模组目录');this.directory.onchange=()=>this.importFiles(this.directory.files,true);
    actions.append(button('导入模组包',()=>this.file.click()),button('导入文件夹',()=>this.directory.click()),button('禁用全部模组',()=>this.disableAll()),button('协议与 API',()=>this.showProtocol()));
    this.banner=text('p','模组可更改编辑器行为与谱面结构；启用前请保存谱面。','hint');
    const body=document.createElement('div');body.className='mod-manager-body';this.list=document.createElement('div');this.list.className='mod-manager-list';this.list.setAttribute('aria-label','已安装模组');this.details=document.createElement('div');this.details.className='mod-manager-details';body.append(this.list,this.details);
    this.message=text('p','内置模组和导入模组均需手动启用。启用状态与参数保存在本机。','hint');this.message.setAttribute('role','status');
    this.dialog.append(heading,actions,this.banner,body,this.message,this.file,this.directory);document.body.append(this.dialog);
    this.dialog.addEventListener('cancel',event=>{if(event.target===this.dialog){event.preventDefault();this.dialog.close();}});
    this.dialog.addEventListener('dragover',event=>event.preventDefault());this.dialog.addEventListener('drop',event=>{event.preventDefault();this.importFiles((event as DragEvent).dataTransfer!.files);});
    this.warning=document.createElement('dialog');this.warning.id='mod-import-warning';this.warning.dataset.modInteractive='true';this.warning.className='mod-import-warning';document.body.append(this.warning);
    this.warning.addEventListener('cancel',event=>{if(event.target===this.warning){event.preventDefault();this.finishWarning(false);}});
  }
  async open(): Promise<void> {await this.ready;this.renderList();if(!this.dialog.open)this.dialog.showModal();}
  renderList(): void {
    if(!this.selected||!this.records.has(this.selected))this.selected=this.records.keys().next().value??null;
    this.list.replaceChildren();for(const [id,record]of this.records){const active=this.runtime.loaded.has(id);const node=button('',()=>{this.selected=id;this.renderList();});node.className='mod-card';node.dataset.modId=id;node.setAttribute('aria-pressed',String(this.selected===id));node.append(text('strong',record.manifest.name),text('span',`${record.builtin?'内置':'导入'} · ${record.manifest.version} · ${record.manifest.author}`),text('small',active?'已装载':this.errors.has(id)?'装载失败':'已禁用'));this.list.append(node);}
    this.renderDetails();
  }
  renderDetails(): void {
    this.details.replaceChildren();const record=this.selected?this.records.get(this.selected):undefined;if(!record){this.details.append(text('p','尚无模组'));return;}const {manifest}=record;const active=this.runtime.loaded.get(manifest.id);
    this.details.append(text('h3',manifest.name),text('p',manifest.description),text('p',`${manifest.id} · v${manifest.version} · API ${manifest.api} · ${manifest.author}`,'hint'));
    const actions=document.createElement('div');actions.className='mod-manager-toolbar';const toggle=button(active?'禁用模组':'启用模组',()=>this.toggle(manifest.id));toggle.className=active?'':'primary';toggle.disabled=this.busy;actions.append(toggle,button('导出模组',()=>download(exportMod(record),manifest.id+'.rpenmod')));
    if(!record.builtin)actions.append(button('删除模组',()=>this.remove(manifest.id)));this.details.append(actions);
    if(this.errors.has(manifest.id))this.details.append(text('pre',this.errors.get(manifest.id)??'','mod-error'));
    if(manifest.dependencies.length)this.details.append(text('p','依赖：'+manifest.dependencies.join('、'),'hint'));if(manifest.conflicts.length)this.details.append(text('p','冲突：'+manifest.conflicts.join('、'),'hint'));
    const settings=this.settingsFor(record);
    if(Object.keys(manifest.settings).length)this.details.append(button('恢复默认参数',async()=>{for(const [key,definition]of Object.entries(manifest.settings))await this.setSetting(manifest.id,key,structuredClone(definition.default));this.renderDetails();}));
    for(const [key,definition]of Object.entries(manifest.settings)){
      const row=document.createElement('label');row.className='field';row.append(text('span',definition.label));let control: HTMLInputElement | HTMLSelectElement;
      if(definition.type==='select'){const select=document.createElement('select');for(const [value,label]of Object.entries(definition.options))select.append(new Option(label,value));select.value=String(settings[key]??'');control=select;}
      else{const input=document.createElement('input');input.type=definition.type==='boolean'?'checkbox':definition.type==='shortcut'?'text':definition.type;input.value=String(settings[key]??'');if(definition.type==='boolean')input.checked=Boolean(settings[key]);if(definition.type==='number'){input.min=String(definition.min);input.max=String(definition.max);input.step=definition.step===undefined?'any':String(definition.step);}control=input;}
      control.dataset.modSetting=key;control.setAttribute('aria-label',definition.label);row.append(control);this.details.append(row);
      const save=async (value: unknown): Promise<void>=>{try{await this.setSetting(manifest.id,key,value);control.setCustomValidity('');this.message.textContent='模组设置已保存。';}catch(error){const message=errorMessage(error);control.setCustomValidity(message);this.message.textContent=message;}};
      if(definition.type==='shortcut'&&control instanceof HTMLInputElement){control.readOnly=true;control.value=formatShortcut(String(settings[key]??''));control.title='点击后按下组合键，Backspace 清除';control.onkeydown=event=>{event.preventDefault();event.stopPropagation();const value=event.key==='Backspace'?'':shortcutFromEvent(event);if(value!==null){save(value);control.value=formatShortcut(value);}};}
      else control.onchange=()=>save(control instanceof HTMLInputElement&&control.type==='checkbox'?control.checked:control instanceof HTMLInputElement&&control.type==='number'?Number(control.value):control.value);
      if(definition.description)this.details.append(text('p',definition.description,'hint'));
    }
    if(active){const commands=[...this.runtime.commands.values()].filter((command: ModCommand)=>command.owner===manifest.id);if(commands.length){this.details.append(text('h4','操作'));for(const command of commands)this.details.append(button(command.title??command.id,()=>{this.dialog.close();command.run();}));}this.details.append(text('p',`运行中 · 错误 ${active.errors} 次`,'hint'));}
    const source=document.createElement('details');source.append(text('summary','包内文件与源码'));const code=document.createElement('pre');code.className='mod-source';code.textContent=[...record.files].filter(([name])=>/\.(json|m?js|css|md)$/.test(name)).map(([name,bytes])=>`— ${name} —\n${new TextDecoder().decode(bytes).slice(0,100000)}`).join('\n\n');source.append(code);this.details.append(source);
  }
  settingsFor(record: ModRecord): ModSettings {const id=record.manifest.id;if(!Object.hasOwn(this.options,id)||!object(this.options[id]))this.options[id]=Object.create(null) as ModSettings;const values=this.options[id];for(const [key,definition]of Object.entries(record.manifest.settings)){try{if(!Object.hasOwn(values,key))throw Error();modSettingValue(definition,values[key],key);}catch{values[key]=structuredClone(definition.default);}}return values;}
  async setSetting(id: string,key: string,value: unknown): Promise<void> {const record=this.records.get(id);if(!record)throw Error('模组不存在');modSettingValue(Object.hasOwn(record.manifest.settings,key)?record.manifest.settings[key]:null,value,key);this.settingsFor(record)[key]=value;localPreferences.setItem(OPTIONS,JSON.stringify(this.options));const state=this.runtime.loaded.get(id);if(state){state.settings=this.options[id];this.runtime.emit('settings:'+id,{key,value});}}
  persist(): void {localPreferences.setItem(ENABLED,JSON.stringify([...this.desired]));localPreferences.setItem(OPTIONS,JSON.stringify(this.options));}
  async enable(id: string,persist=true,chain=new Set<string>()): Promise<void> {
    if(this.runtime.loaded.has(id)){await this.runtime.loaded.get(id)!.promise;return;}if(chain.has(id))throw Error('模组依赖循环：'+[...chain,id].join(' → '));const record=this.records.get(id);if(!record)throw Error('缺少依赖模组：'+id);chain.add(id);
    const checkConflicts=()=>{for(const conflict of record.manifest.conflicts)if(this.runtime.loaded.has(conflict))throw Error('与已启用模组冲突：'+conflict);for(const state of this.runtime.loaded.values())if(state.record.manifest.conflicts.includes(id))throw Error('与已启用模组冲突：'+state.id);};checkConflicts();
    for(const dependency of record.manifest.dependencies)await this.enable(dependency,persist,new Set(chain));
    checkConflicts();
    localPreferences.setItem(BOOT,JSON.stringify({id,time:Date.now()}));
    try{const state=await this.runtime.load(record,this.settingsFor(record),(key,value)=>this.setSetting(id,key,value));if(state?.status==='loaded'&&this.runtime.loaded.get(id)===state){this.errors.delete(id);this.desired.add(id);if(persist)this.persist();}}
    finally{localPreferences.removeItem(BOOT);}this.updateStatus();
  }
  async disable(id: string): Promise<void> {for(const state of [...this.runtime.loaded.values()])if(state.record.manifest.dependencies.includes(id))await this.disable(state.id);await this.runtime.unload(id);this.desired.delete(id);this.persist();this.updateStatus();}
  async toggle(id: string): Promise<void> {if(this.busy)return;this.busy=true;try{if(this.runtime.loaded.has(id))await this.disable(id);else await this.enable(id);this.message.textContent=this.runtime.loaded.has(id)?'模组已装载。':'模组已禁用，受管理的资源已清理。';}catch(error){this.errors.set(id,errorStack(error));this.notify(errorMessage(error),'error');}finally{this.busy=false;this.renderList();}}
  async disableAll(emergency=false): Promise<void> {this.desired.clear();this.persist();for(const id of [...this.runtime.loaded.keys()].reverse())await this.runtime.unload(id);localPreferences.removeItem(BOOT);this.updateStatus();if(this.dialog.open)this.renderList();if(emergency)this.notify('已禁用全部模组。若界面仍异常，请重新载入。','warning');}
  updateStatus(): void {const count=[...this.runtime.loaded.values()].filter(state=>state.status==='loaded').length;const node=document.querySelector<HTMLElement>('#mods-status')!;node.hidden=count===0;node.textContent=`已装载 ${count} 个模组`;node.title='点击管理模组 · Ctrl+Alt+Shift+F11 禁用全部';this.invalidate();}
  async review(record: ModRecord): Promise<boolean> {
    this.warning.replaceChildren(text('h2','导入外部模组'),text('p',`${record.manifest.name} · ${record.manifest.version} · ${record.manifest.author}`),text('p','外部模组会在编辑器中执行代码，可读取、修改或删除当前浏览器存储或桌面谱面库中的谱面与设置，并可能通过网络发送数据。它也可以改变界面、谱面结构与编辑语义，产生未知效果。'),text('p','编辑器作者不对外部模组产生的后果承担责任。建议仅从可信来源下载，并在导入前阅读源码或使用 AI 检查；这不能保证模组安全。建议先备份谱面。'));
    const label=document.createElement('label');label.className='mod-consent';const consent=document.createElement('input');consent.type='checkbox';label.append(consent,'我理解外部模组拥有完整编辑器权限，并接受导入风险');this.warning.append(label);
    const source=document.createElement('details');source.append(text('summary','查看代码'));const pre=text('pre',[...record.files].filter(([path])=>/\.(m?js|json)$/.test(path)).map(([path,bytes])=>path+'\n'+new TextDecoder().decode(bytes).slice(0,100000)).join('\n\n'),'mod-source');source.append(pre);this.warning.append(source);
    const actions=document.createElement('div');actions.className='modal-actions';const accept=button('确认导入（默认禁用）',()=>this.finishWarning(true));accept.disabled=true;consent.onchange=()=>accept.disabled=!consent.checked;actions.append(button('取消',()=>this.finishWarning(false)),accept);this.warning.append(actions);this.warning.showModal();return new Promise<boolean>(resolve=>{this.warningResolve=resolve;});
  }
  finishWarning(accepted: boolean): void {this.warning.close();this.warningResolve?.(accepted);this.warningResolve=null;}
  async importFiles(files: FileList | null,directory=false): Promise<void> {if(!files?.length||this.busy)return;this.busy=true;try{const record=await importMod(files,directory) as ModRecord;if(this.records.get(record.manifest.id)?.builtin)throw Error('不能覆盖内置模组 id');if(!await this.review(record))return;if(this.records.has(record.manifest.id)&&!confirm('替换已安装模组？替换后将处于禁用状态。'))return;await this.disable(record.manifest.id);await storeMod(record);this.records.set(record.manifest.id,record);this.selected=record.manifest.id;this.message.textContent='模组已导入，尚未启用。';this.renderList();}catch(error){this.notify(errorMessage(error),'error');this.message.textContent=errorMessage(error);}finally{this.file.value='';this.directory.value='';this.busy=false;this.renderList();}}
  async remove(id: string): Promise<void> {if(!confirm('删除模组及其参数？'))return;await this.disable(id);await deleteMod(id);delete this.options[id];localPreferences.removeItem('rpe-next-mod-data:'+id);this.records.delete(id);this.persist();this.renderList();}
  showProtocol(): void {this.details.replaceChildren(text('h3','模组协议 API 1'),text('p','每个包包含 mod.json 和入口 ES 模块，入口导出 activate(api)。支持 package 内多文件导入、完整编辑器对象、提交谱面、事件钩子、界面挂载、预览叠加、快捷键与自动清理。'),text('p','模组运行于编辑器页面，没有权限沙箱。无法保证任意直接改写都可卸载还原；优先使用 api.patch / api.dispose，异常时禁用并重新载入。'));
    const pre=text('pre',JSON.stringify({protocol:'rpen-mod',api:1,id:'example-mod',name:'示例',version:'1.0.0',author:'作者',description:'说明',entry:'main.ts'},null,2)+'\n\nexport function activate(api) {\n  api.commands.register({ id: "hello", title: "问好", shortcut: "F7", run: () => api.notify("Hello") });\n  return () => {};\n}','mod-source');this.details.append(pre,text('p','完整协议：protocols/MOD-PROTOCOL.zh-CN.md · API：window.rpenMods.editor · 恢复启动：?mods=off','hint'));
    const actions=document.createElement('div');actions.className='mod-manager-toolbar';for(const [label,path]of [['下载完整协议','protocols/MOD-PROTOCOL.zh-CN.md'],['下载全局事件协议','protocols/GLOBAL-EVENTS-PROTOCOL.zh-CN.md'],['下载 API 声明','schemas/mod-api-v1.d.ts'],['下载清单 Schema','schemas/mod-v1.schema.json']])actions.append(button(label,async()=>{try{const response=await fetch(new URL('../../'+path,import.meta.url));if(!response.ok)throw Error('文档读取失败');download(await response.blob(),path.split('/').at(-1)!);}catch(error){this.notify(errorMessage(error),'error');}}));this.details.append(actions);
  }
}
