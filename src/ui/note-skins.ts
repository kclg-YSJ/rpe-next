import { parseNoteSkin, noteSkinInfo, NOTE_SKIN_IMAGES, NOTE_SKIN_SOUNDS, NOTE_SKIN_LIMITS } from '../core/note-skin.ts';
import { localPreferences } from '../platform/local-preferences.ts';
import { builtinNoteSkins, readNoteSkins, storeNoteSkin, deleteNoteSkin, importNoteSkin, exportNoteSkin, updateNoteSkin, decodeNoteSkinSounds } from '../platform/note-skins.ts';
import { ResourceNoteSkin } from './resource-note-skin.ts';
import { RpeSkin } from './skin.ts';
import { assetUrl } from '../core/asset-url.ts';
import { download } from '../platform/files.ts';
import { hitFrame } from '../core/visual-constants.ts';
import type { NoteType } from '../core/types.ts';
import type { NoteSkinRecord } from './resource-note-skin.ts';
import type { ResourceNoteSkin as ResourceNoteSkinContract } from './skin.ts';

interface StoredNoteSkin { id: string; files: [string, Uint8Array][]; originalFiles?: [string, Uint8Array][] }
interface NoteSkinsOptions {
  skin: RpeSkin;
  hitSounds: HitSoundsLike;
  audio: AudioLike;
  notify: (message: string, level?: string) => void;
  invalidate: () => void;
  pause: () => void;
  settings: SettingsDialogLike;
}
interface HitSoundsLike {
  setSoundPack(sounds?: Map<string, AudioBuffer>): void;
  prepare(): Promise<void> | void;
  buffers: Map<string, AudioBuffer>;
  volume: number;
}
interface AudioLike { ensureContext(): unknown }
interface SettingsDialogLike { open: boolean; close(): void; showModal(): void }
type PreviewResourcePack = ResourceNoteSkinContract & { info: NoteSkinRecord['info']; setInfo(info: NoteSkinRecord['info']): void };

const ACTIVE_KEY='rpe-next-note-skin-v1';
const action=(text:string,run:()=>void,className=''):HTMLButtonElement=>{const node=document.createElement('button');node.type='button';node.textContent=text;node.className=className;node.onclick=run;return node;};
const text=<K extends keyof HTMLElementTagNameMap>(tag:K,value:string,className=''):HTMLElementTagNameMap[K]=>{const node=document.createElement(tag);node.textContent=value;node.className=className;return node;};
const title=(record:NoteSkinRecord|null|undefined):string=>record?record.info.name+(record.info.author?` (${record.info.author})`:''):'默认音符皮肤';
const errorMessage=(error:unknown):string=>error instanceof Error?error.message:String(error);
const parseSkin=parseNoteSkin as unknown as (source: Map<string, Uint8Array>, id?: string | null) => NoteSkinRecord;

export class NoteSkins {
  host: HTMLElement;
  skin: RpeSkin;
  hitSounds: HitSoundsLike;
  audio: AudioLike;
  notify: (message: string, level?: string) => void;
  invalidate: () => void;
  pause: () => void;
  settings: SettingsDialogLike;
  records: Map<string, NoteSkinRecord>;
  modifications: WeakMap<NoteSkinRecord, boolean>;
  current: string;
  selected: string;
  cardUrls: string[];
  generation: number;
  applying: boolean;
  demoPlaying: boolean;
  summary!: HTMLElement;
  ready!: Promise<void>;
  dialog!: HTMLDialogElement;
  zip!: HTMLInputElement;
  directory!: HTMLInputElement;
  gallery!: HTMLElement;
  detail!: HTMLElement;
  selectedTitle!: HTMLElement;
  animationButton!: HTMLButtonElement;
  goodButton!: HTMLButtonElement;
  backgroundButton!: HTMLButtonElement;
  canvas!: HTMLCanvasElement;
  form!: HTMLElement;
  materials!: HTMLDetailsElement;
  message!: HTMLElement;
  applyButton!: HTMLButtonElement;
  exportButton!: HTMLButtonElement;
  resetButton!: HTMLButtonElement;
  deleteButton!: HTMLButtonElement;
  previewSkin: RpeSkin | null;
  frame: number;
  draft: NoteSkinRecord | null;
  valid: boolean;
  modified: boolean;
  controls: Map<string, HTMLInputElement | HTMLTextAreaElement>;
  demoGood: boolean;
  demoLight: boolean;
  demoTime: number;
  soundSource: AudioBufferSourceNode | null;
  toolGeneration?: number;
  toolUrls?: string[];

  constructor(host: HTMLElement, {skin,hitSounds,audio,notify,invalidate,pause,settings}: NoteSkinsOptions) {
    this.host=host;this.skin=skin;this.hitSounds=hitSounds;this.audio=audio;this.notify=notify;this.invalidate=invalidate;this.pause=pause;this.settings=settings;
    this.records=new Map();this.modifications=new WeakMap();this.current='default';this.selected='default';this.cardUrls=[];this.generation=0;this.applying=false;this.demoPlaying=true;
    this.previewSkin=null;this.frame=0;this.draft=null;this.valid=false;this.modified=false;this.controls=new Map();this.demoGood=false;this.demoLight=false;this.demoTime=0;this.soundSource=null;
    host.append(text('h3','音符皮肤与音效'),text('p','统一管理音符、打击音效与打击特效。皮肤保存在本机，不随谱面分享。','hint'));
    this.summary=text('span','默认音符皮肤');const entry=action('管理音符皮肤',()=>this.open());entry.id='note-skins-open';host.append(entry,this.summary);
    this.renderDialog();this.ready=this.load();
  }
  async load(): Promise<void> {
    try {
      for(const record of await builtinNoteSkins() as unknown as NoteSkinRecord[])this.records.set(record.id,record);
      for(const stored of await readNoteSkins() as StoredNoteSkin[]) {
        try {
          if(!/^(?:pack-[a-f0-9]{24}|builtin-[a-z0-9-]+)$/.test(stored.id))throw new Error('标识无效');
          const builtin=this.records.get(stored.id);if(stored.id.startsWith('builtin-')&&!builtin)continue;
          const record=parseSkin(new Map(stored.files),stored.id);
          record.builtin=Boolean(builtin);record.originalFiles=builtin?.files??new Map(stored.originalFiles??stored.files);this.records.set(record.id,record);
        } catch(error) {this.notify('已跳过损坏的音符皮肤：'+errorMessage(error),'warning');}
      }
      const id=localPreferences.getItem(ACTIVE_KEY)??'default';
      if(id!=='default'&&!this.records.has(id)) {localPreferences.removeItem(ACTIVE_KEY);this.notify('找不到已保存的音符皮肤，已使用默认皮肤。','warning');}
      else if(id!=='default')await this.activate(id,false);
    } catch(error) {this.notify('音符皮肤读取失败，继续使用默认皮肤：'+errorMessage(error),'warning');}
    this.summary.textContent=title(this.records.get(this.current));
  }
  renderDialog(): void {
    this.dialog=document.createElement('dialog');this.dialog.id='note-skin-modal';this.dialog.className='note-skin-manager';
    const heading=document.createElement('div');heading.className='note-skin-heading';heading.append(text('h2','音符皮肤与音效'),action('返回设置',()=>this.close()));
    const toolbar=document.createElement('div');toolbar.className='note-skin-toolbar';
    this.zip=document.createElement('input');this.zip.type='file';this.zip.accept='.zip';this.zip.hidden=true;this.zip.setAttribute('aria-label','导入音符皮肤包');this.zip.onchange=()=>this.importFiles(this.zip.files);
    this.directory=document.createElement('input');this.directory.type='file';this.directory.webkitdirectory=true;this.directory.multiple=true;this.directory.hidden=true;this.directory.setAttribute('aria-label','导入音符皮肤文件夹');this.directory.onchange=()=>this.importFiles(this.directory.files,true);
    toolbar.append(action('导入 ZIP 皮肤包',()=>this.zip.click()),action('导入文件夹',()=>this.directory.click()),text('span','Phira / prpr 资源包 · info.yml','hint'));
    const body=document.createElement('div');body.className='note-skin-body';this.gallery=document.createElement('div');this.gallery.className='note-skin-gallery';this.gallery.setAttribute('aria-label','音符皮肤列表');
    this.detail=document.createElement('div');this.detail.className='note-skin-detail';
    const previewHeader=document.createElement('div');previewHeader.className='note-skin-preview-heading';this.selectedTitle=text('h3','');
    this.animationButton=action('暂停动画',()=>{this.demoPlaying=!this.demoPlaying;this.animationButton.textContent=this.demoPlaying?'暂停动画':'播放动画';});
    this.goodButton=action('Perfect 色',()=>{this.demoGood=!this.demoGood;this.goodButton.textContent=this.demoGood?'Good 色':'Perfect 色';});previewHeader.append(this.selectedTitle,this.animationButton,this.goodButton);
    this.backgroundButton=action('深色背景',()=>{this.demoLight=!this.demoLight;this.backgroundButton.textContent=this.demoLight?'浅色背景':'深色背景';this.dialog.classList.toggle('preview-light',this.demoLight);});previewHeader.append(this.backgroundButton);
    this.canvas=document.createElement('canvas');this.canvas.className='note-skin-preview';this.canvas.setAttribute('aria-label','普通音符、等时高亮、Hold 与打击特效预览');
    this.form=document.createElement('div');this.form.className='note-skin-form';this.form.addEventListener('input',()=>this.updateDraft());
    this.materials=document.createElement('details');this.materials.className='note-skin-materials';this.materials.append(text('summary','贴图与音效文件'));
    this.detail.append(previewHeader,this.canvas,this.form,this.materials);body.append(this.gallery,this.detail);
    const footer=document.createElement('div');footer.className='note-skin-footer';this.message=text('p','选择皮肤即可查看，点击“应用此皮肤”后切换。','hint');this.message.setAttribute('role','status');
    this.applyButton=action('应用此皮肤',()=>this.apply(),'primary');this.applyButton.id='note-skin-apply';this.exportButton=action('导出 ZIP',()=>{if(this.draft)download(exportNoteSkin(this.draft),this.safeFilename()+'.zip');});
    this.resetButton=action('恢复原始参数与素材',()=>this.reset());this.deleteButton=action('删除',()=>this.remove());
    const actions=document.createElement('div');actions.className='note-skin-toolbar';actions.append(this.resetButton,this.exportButton,this.deleteButton,this.applyButton);footer.append(this.message,actions);
    this.dialog.append(heading,toolbar,body,footer,this.zip,this.directory);document.body.append(this.dialog);
    this.dialog.addEventListener('cancel',event=>{if(event.target!==this.dialog)return;event.preventDefault();this.close();});
    this.dialog.addEventListener('close',()=>{cancelAnimationFrame(this.frame);this.stopSound();this.previewSkin?.resourcePack?.dispose();this.previewSkin=null;this.clearCardUrls();if(!this.settings.open)this.settings.showModal();});
    this.dialog.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();event.stopPropagation();this.apply();}});
    this.dialog.addEventListener('dragover',event=>{event.preventDefault();});this.dialog.addEventListener('drop',event=>{event.preventDefault();if(event.dataTransfer!.files.length)this.importFiles(event.dataTransfer!.files);});
  }
  safeFilename(): string {return (this.draft?.info.name??'note-skin').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').slice(0,80)||'note-skin';}
  error(error: unknown): void {const message=errorMessage(error);this.message.textContent=message;this.message.classList.add('error');this.notify(message,'error');}
  clearCardUrls(): void {for(const url of this.cardUrls)URL.revokeObjectURL(url);this.cardUrls=[];}
  renderCards(): void {
    this.clearCardUrls();this.gallery.replaceChildren();
    const entries: [string, NoteSkinRecord | null][] = [['default', null], ...this.records];
    for(const [id,record] of entries) {
      const card=action('',()=>this.select(id),'note-skin-card');card.dataset.noteSkin=id;card.setAttribute('aria-pressed',String(id===this.selected));
      const images=document.createElement('div');images.className='note-skin-card-images';
      for(const [file,builtin] of [['click.png','Tap2'],['drag.png','Drag2'],['flick.png','Flick2']]) {
        const image=document.createElement('img');image.alt=file.slice(0,-4);image.loading='lazy';
        if(record){const url=URL.createObjectURL(new Blob([record.files.get(file)! as BlobPart],{type:'image/png'}));this.cardUrls.push(url);image.src=url;}else image.src=assetUrl(`rpe/Texture/${builtin}.png`);
        images.append(image);
      }
      let modified=record&&this.modifications.get(record);
      if(record&&modified===undefined){
        modified=Boolean(record.originalFiles&&(record.files.size!==record.originalFiles.size||[...record.files].some(([name,bytes])=>{
          const original=record.originalFiles!.get(name);return !original||bytes.length!==original.length||bytes.some((value,index)=>value!==original[index]);
        })));this.modifications.set(record,modified);
      }
      const state=[id===this.current?'已应用':record?.builtin||id==='default'?'内置':'已导入',...(modified?['已修改']:[])].join(' · ');
      card.append(images,text('strong',record?.info.name??'默认音符皮肤'),text('span',record?.info.author??'编辑器内置'),text('small',state));this.gallery.append(card);
    }
  }
  async open(): Promise<void> {await this.ready;this.pause();this.settings.close();this.dialog.showModal();this.renderCards();await this.select(this.current,true);this.animate();}
  close(force=false): void {if(this.applying)return;if(!force&&this.modified&&!confirm('尚未应用的皮肤修改将被放弃，返回设置？'))return;this.generation++;this.modified=false;this.dialog.close();}
  async select(id: string,force=false): Promise<boolean> {
    if(this.applying)return false;if(!force&&this.modified&&!confirm('放弃尚未应用的皮肤修改并选择另一套皮肤？'))return false;
    const generation=++this.generation;this.selected=id;this.modified=false;this.draft=this.records.get(id)??null;this.valid=true;this.message.classList.remove('error');
    this.previewSkin?.resourcePack?.dispose();this.previewSkin=null;this.stopSound();this.renderCards();this.selectedTitle.textContent=title(this.draft);this.renderForm();this.renderMaterials();this.updateButtons();
    this.message.textContent=id===this.current?'正在使用这套皮肤。':'正在准备预览…';
    try {
      if(this.draft) {
        const previewSkin=new RpeSkin(()=>{});const runtime=await ResourceNoteSkin.prepare(this.draft,previewSkin.tintedSource.bind(previewSkin));
        if(generation!==this.generation){runtime.dispose();return false;}previewSkin.setResourcePack(runtime);this.previewSkin=previewSkin;
      } else this.previewSkin=this.skin.resourcePack?Object.assign(new RpeSkin(()=>{}),{images:this.skin.images}):this.skin;
      if(generation!==this.generation)return false;
      this.message.textContent=(id===this.current?'正在使用这套皮肤。':'仅预览，点击“应用此皮肤”后切换。')+(this.draft?.warnings.join('；')??'');
      this.updateButtons();return true;
    } catch(error){if(generation===this.generation){this.valid=false;this.error(error);this.updateButtons();}return false;}
  }
  field(host: HTMLElement,label: string,key: string,type: string,value: unknown,min?: number,max?: number,step?: number): HTMLInputElement | HTMLTextAreaElement {
    const row=document.createElement('label');row.className='field';row.append(text('span',label));const input=document.createElement(type==='textarea'?'textarea':'input');
    if(type!=='textarea'&&input instanceof HTMLInputElement)input.type=type;
    const fieldName='note-skin-'+key.replace('.','-');input.dataset.noteSkinField=key;input.dataset.noteSkinType=type;input.dataset.rpenField=fieldName;row.dataset.rpenField=fieldName;input.setAttribute('aria-label',label);
    if(type==='checkbox'&&input instanceof HTMLInputElement)input.checked=Boolean(value);else input.value=String(value??'');
    if(min!==undefined&&input instanceof HTMLInputElement)input.min=String(min);if(max!==undefined&&input instanceof HTMLInputElement)input.max=String(max);if(step!==undefined&&input instanceof HTMLInputElement)input.step=String(step);
    row.append(input);host.append(row);return input;
  }
  renderForm(): void {
    this.form.replaceChildren();this.controls=new Map();
    if(!this.draft){this.form.append(text('p','沿用编辑器当前的默认音符、音效和特效。普通音符与等时高亮均可在上方预览。','hint'));return;}
    const add=(host:HTMLElement,label:string,key:string,type:string,min?:number,max?:number,step?:number):void=>{this.controls.set(key,this.field(host,label,key,type,this.draft!.info[key],min,max,step));};
    add(this.form,'名称','name','text');add(this.form,'作者','author','text');add(this.form,'说明','description','textarea');
    const group=(label:string):HTMLDetailsElement=>{const details=document.createElement('details');details.open=true;details.append(text('summary',label));this.form.append(details);return details;};
    const hold=group('Hold 图集与显示');
    for(const [key,label] of [['holdAtlas','普通 Hold'],['holdAtlasMH','等时高亮 Hold']] as const) for(const [index,part] of ['尾部高度（px）','头部高度（px）'].entries()) this.controls.set(key+'.'+index,this.field(hold,label+' '+part,key+'.'+index,'number',(this.draft.info[key] as [number,number])[index],0,65535,1));
    for(const [key,label] of [['holdKeepHead','触线后保留 Hold 头部'],['holdRepeat','重复平铺 Hold 身体'],['holdCompact','Hold 头尾中心与端点对齐']] as const)add(hold,label,key,'checkbox');
    const fx=group('打击动画');
    for(const [index,label] of ['横向帧数','纵向帧数'].entries())this.controls.set('hitFx.'+index,this.field(fx,label,'hitFx.'+index,'number',this.draft.info.hitFx[index],1,10240,1));
    add(fx,'持续时间（秒）','hitFxDuration','number',0.01,120,0.01);add(fx,'缩放比例','hitFxScale','number',0.01,64,0.01);
    for(const [key,label] of [['hitFxRotate','跟随音符旋转'],['hitFxTinted','依照判定颜色着色'],['hideParticles','隐藏方形粒子']] as const)add(fx,label,key,'checkbox');
    const colors=group('判定颜色');
    for(const [key,label] of [['colorPerfect','Perfect'],['colorGood','Good']] as const)this.controls.set(key,this.field(colors,label+'（RGB / ARGB）',key,'text','0x'+(this.draft.info[key] as number).toString(16).padStart(8,'0')));
    colors.append(text('p','支持 0xRRGGBB 或 0xAARRGGBB。编辑器采用 Perfect 预览，谱面自己的颜色事件仍然优先。','hint'));
  }
  updateDraft(): void {
    if(!this.draft)return;const source=structuredClone(this.draft.info);let invalid=false;
    for(const [key,control] of this.controls){control.setCustomValidity('');const type=control.dataset.noteSkinType??control.type;const value=type==='checkbox'&&control instanceof HTMLInputElement?control.checked:type==='number'?Number(control.value):control.value;
      if(type==='number'&&control instanceof HTMLInputElement){
        const validation=control.type==='number'?control:control.cloneNode() as HTMLInputElement;if(validation!==control){validation.type='number';validation.value=control.value;}
        if(!control.value.trim()||!Number.isFinite(value)||!validation.checkValidity()){control.setCustomValidity('请填写有效数值');invalid=true;}
      }
      const record=source as unknown as Record<string, unknown>;
      if(key.includes('.')){const [field,index]=key.split('.');(record[field] as unknown[])[Number(index)]=value;}else record[key]=value;
    }
    try {if(invalid)throw new Error('请先修正无效的数值。');this.draft=updateNoteSkin(this.draft,noteSkinInfo(source)) as unknown as NoteSkinRecord;if(this.previewSkin?.resourcePack)(this.previewSkin.resourcePack as PreviewResourcePack).setInfo(this.draft.info);
      this.valid=true;this.modified=true;this.selectedTitle.textContent=title(this.draft)+' · 未应用';this.message.classList.remove('error');this.message.textContent='预览已更新，应用后保存修改。';}
    catch(error){this.valid=false;const message=errorMessage(error);this.message.textContent=message;this.message.classList.add('error');}
    this.updateButtons();
  }
  updateButtons(): void {this.applyButton.disabled=this.applying||!this.valid||!this.previewSkin;this.exportButton.disabled=this.applying||!this.valid||!this.draft;this.deleteButton.disabled=this.applying||!this.draft||Boolean(this.draft.builtin);this.resetButton.disabled=this.applying||!this.draft;this.gallery.inert=this.applying;this.detail.inert=this.applying;}
  renderMaterials(): void {
    const open=this.materials.open;this.materials.replaceChildren(text('summary','贴图与音效文件'));this.materials.open=open;
    if(!this.draft){this.materials.append(text('p','默认素材由编辑器提供。','hint'));}
    else for(const name of [...NOTE_SKIN_IMAGES,...Object.values(NOTE_SKIN_SOUNDS)]) {
      const row=document.createElement('div');row.className='note-skin-material-row';row.append(text('span',name),text('small',this.draft.files.has(name)?`${(this.draft.files.get(name)!.length/1024).toFixed(1)} KiB`:'使用默认音效'));
      const input=document.createElement('input');input.type='file';input.accept=name.endsWith('.png')?'image/png':'.ogg';input.hidden=true;input.setAttribute('aria-label','替换 '+name);input.onchange=()=>this.replaceFile(name,input.files?.[0]);
      row.append(action('替换',()=>input.click()),input);
      if(name.endsWith('.ogg'))row.append(action('试听',()=>this.audition(Object.keys(NOTE_SKIN_SOUNDS).find(key=>(NOTE_SKIN_SOUNDS as Record<string,string>)[key]===name))));
      if(name.endsWith('.ogg')&&this.draft.files.has(name))row.append(action('用默认',()=>this.replaceFile(name,null)));
      this.materials.append(row);
    }
    const sounds=document.createElement('div');sounds.className='note-skin-toolbar';for(const [key,label] of [['tap','Tap / Hold'],['drag','Drag'],['flick','Flick']] as const)sounds.append(action('试听 '+label,()=>this.audition(key)));
    this.materials.append(sounds);
  }
  async replaceFile(name: string,file: File | null | undefined): Promise<void> {
    if(!this.draft||this.applying||file===undefined)return;
    const generation=this.generation;let runtime: ResourceNoteSkin | undefined;
    try {
      if(file&&file.size>NOTE_SKIN_LIMITS.fileBytes)throw new Error('素材文件过大');
      const next=updateNoteSkin(this.draft,this.draft.info,new Map([[name,file?new Uint8Array(await file.arrayBuffer()):null]])) as unknown as NoteSkinRecord;
      const preview=new RpeSkin(()=>{});runtime=await ResourceNoteSkin.prepare(next,preview.tintedSource.bind(preview));
      if(file&&name.endsWith('.ogg'))await decodeNoteSkinSounds(next,this.audio.ensureContext());
      if(generation!==this.generation||!this.dialog.open){runtime.dispose();return;}
      this.previewSkin?.resourcePack?.dispose();preview.setResourcePack(runtime);this.previewSkin=preview;this.draft=next;this.modified=true;this.valid=true;this.renderMaterials();this.message.textContent='素材已替换，仅影响预览；应用后保存。';this.updateButtons();
    } catch(error){runtime?.dispose();if(generation===this.generation)this.error(error);}
  }
  async importFiles(files: FileList | null,directory=false): Promise<void> {
    if(!files?.length||this.applying)return;
    try {
      const record=await importNoteSkin(files,directory) as unknown as NoteSkinRecord;const preview=new RpeSkin(()=>{});const runtime=await ResourceNoteSkin.prepare(record,preview.tintedSource.bind(preview));
      try{await decodeNoteSkinSounds(record,this.audio.ensureContext());}finally{runtime.dispose();}
      const existing=this.records.get(record.id);if(existing&&!confirm('这套皮肤已导入，重新导入将恢复包内参数。继续？'))return;
      if(this.modified&&!confirm('导入将放弃当前未应用的皮肤修改，继续？'))return;
      await storeNoteSkin(record);this.records.set(record.id,record);await this.select(record.id,true);this.message.textContent='皮肤已导入，点击“应用此皮肤”后切换。';
    }catch(error){this.error(error);}finally{this.zip.value='';this.directory.value='';}
  }
  async activate(id: string,persist=true,record: NoteSkinRecord | null=this.records.get(id)??null,beforeActivate:()=>Promise<void>=async()=>{}): Promise<void> {
    if(id==='default'){this.skin.setResourcePack(null);this.hitSounds.setSoundPack();}
    else {
      if(!record)throw new Error('音符皮肤不存在');
      const runtime=await ResourceNoteSkin.prepare(record,this.skin.tintedSource.bind(this.skin));
      try {const sounds=await decodeNoteSkinSounds(record,this.audio.ensureContext()) as Map<string, AudioBuffer>;await beforeActivate();this.skin.setResourcePack(runtime);this.hitSounds.setSoundPack(sounds);}
      catch(error){runtime.dispose();throw error;}
    }
    this.current=id;if(persist)localPreferences.setItem(ACTIVE_KEY,id);this.summary.textContent=title(record);this.updateToolImages();this.invalidate();document.dispatchEvent(new CustomEvent('rpen-note-skin-changed',{detail:{id}}));
  }
  updateToolImages(): void {
    const generation=this.toolGeneration=(this.toolGeneration??0)+1;
    for(const url of this.toolUrls??[])URL.revokeObjectURL(url);this.toolUrls=[];
    for(const image of document.querySelectorAll<HTMLImageElement>('[data-tool] > img')){
      image.dataset.defaultNoteSrc??=image.getAttribute('src')??'';const type=Number(image.parentElement!.dataset.tool) as NoteType;const picture=this.skin.noteImage(type)!;
      if(!this.skin.resourcePack){image.src=image.dataset.defaultNoteSrc??'';continue;}
      const canvas=document.createElement('canvas');canvas.width=160;canvas.height=56;const context=canvas.getContext('2d')!;
      const ratio=type===2?(this.skin.resourcePack as PreviewResourcePack).info.holdAtlas[1]/(picture.naturalWidth??1):(picture.naturalHeight??0)/(picture.naturalWidth??1);
      const width=Math.min(150,48/Math.max(0.01,ratio));this.skin.head(context,type,80,28,width);canvas.toBlob(blob=>{
        if(!blob||generation!==this.toolGeneration)return;const url=URL.createObjectURL(blob);this.toolUrls!.push(url);image.src=url;
      });
    }
  }
  async apply(): Promise<void> {
    if(this.applying||!this.valid||!this.previewSkin)return;this.applying=true;this.updateButtons();
    try{const record=this.draft;await this.activate(this.selected,true,record,async()=>{if(record)await storeNoteSkin(record);});if(record)this.records.set(record.id,record);this.modified=false;this.renderCards();this.message.classList.remove('error');this.message.textContent='已应用并保存，下次启动自动恢复。';this.notify('已切换音符皮肤：'+title(record),'success');}
    catch(error){this.error(error);}finally{this.applying=false;this.updateButtons();}
  }
  async reset(): Promise<void> {
    if(!this.draft||!confirm('恢复这套皮肤的原始参数和素材？应用后保存。'))return;
    try{const original=this.draft.originalFiles??this.draft.files;const restored={...parseSkin(original,this.selected),originalFiles:original,builtin:this.draft.builtin};
      await this.select(this.selected,true);this.draft=restored;this.modified=true;this.renderForm();this.renderMaterials();
      const preview=new RpeSkin(()=>{});preview.setResourcePack(await ResourceNoteSkin.prepare(restored,preview.tintedSource.bind(preview)));this.previewSkin?.resourcePack?.dispose();this.previewSkin=preview;this.message.textContent='已恢复原始参数与素材，应用后保存。';this.valid=true;this.updateButtons();
    }catch(error){this.error(error);}
  }
  async remove(): Promise<void> {
    const record=this.records.get(this.selected);if(!record||record.builtin||!confirm(`删除音符皮肤“${record.info.name}”？`))return;
    try{if(this.current===record.id)await this.activate('default');await deleteNoteSkin(record.id);this.records.delete(record.id);await this.select(this.current,true);}catch(error){this.error(error);}
  }
  stopSound(): void {if(this.soundSource){try{this.soundSource.stop();}catch{}this.soundSource.disconnect();this.soundSource=null;}}
  async audition(type: string | undefined): Promise<void> {
    try{this.stopSound();const context=this.audio.ensureContext() as AudioContext;await context.resume();let buffer: AudioBuffer | undefined;
      if(this.draft){const sounds=await decodeNoteSkinSounds(this.draft,context) as Map<string, AudioBuffer>;buffer=type===undefined?undefined:sounds.get(type);}
      if(!buffer){await this.hitSounds.prepare();buffer=type===undefined?undefined:this.hitSounds.buffers.get(type);}
      if(!buffer)throw new Error('无法读取默认打击音效');
      if(!this.dialog.open)return;const source=context.createBufferSource();source.buffer=buffer;const gain=context.createGain();gain.gain.value=this.hitSounds.volume;gain.connect(context.destination);source.connect(gain);source.onended=()=>{source.disconnect();gain.disconnect();if(this.soundSource===source)this.soundSource=null;};this.soundSource=source;source.start();
    }catch(error){this.error(error);}
  }
  animate(): void {
    cancelAnimationFrame(this.frame);const render=(now:number):void=>{if(!this.dialog.open)return;if(this.demoPlaying)this.demoTime=now/1000;this.drawDemo(this.demoTime??0);this.frame=requestAnimationFrame(render);};this.frame=requestAnimationFrame(render);
  }
  drawDemo(time: number): void {
    const skin=this.previewSkin;if(!skin)return;const ratio=globalThis.devicePixelRatio||1;const width=Math.max(1,this.canvas.clientWidth);const height=Math.max(1,this.canvas.clientHeight);
    if(this.canvas.width!==Math.round(width*ratio)||this.canvas.height!==Math.round(height*ratio)){this.canvas.width=Math.round(width*ratio);this.canvas.height=Math.round(height*ratio);}
    const ctx=this.canvas.getContext('2d')!;ctx.setTransform(this.canvas.width/width,0,0,this.canvas.height/height,0,0);ctx.clearRect(0,0,width,height);ctx.fillStyle=this.demoLight?'#d8dde6':'#20242b';ctx.fillRect(0,0,width,height);
    const scale=Math.min(width/680,height/250);ctx.save();ctx.translate((width-680*scale)/2,(height-250*scale)/2);ctx.scale(scale,scale);ctx.fillStyle=this.demoLight?'#252a35':'#edf0f5';ctx.font='12px sans-serif';ctx.fillText('普通',12,57);ctx.fillText('等时高亮',12,127);ctx.fillText('Hold',400,25);ctx.fillText('打击特效',540,25);
    for(const [x,type,label] of [[125,1,'Tap'],[225,4,'Drag'],[325,3,'Flick']] as [number,NoteType,string][]){skin.head(ctx,type,x,55,80,false,undefined,0);skin.head(ctx,type,x,125,80,true,undefined,0);ctx.fillStyle=this.demoLight?'#4d5563':'#afb7c4';ctx.fillText(label,x-20,182);}
    skin.hold(ctx,430,195,45,52,false,true);skin.hold(ctx,480,195,45,52,true,true);
    const duration=skin.hitLifetime??0.5;const age=time%(duration+0.35);const hit={age,x:590,y:112,size:135,rotation:Math.PI/4,seed:9,good:this.demoGood};if(!skin.drawHit(ctx,hit as Parameters<typeof skin.drawHit>[1])){
      const frame=hitFrame(age);const picture=frame&&skin.tinted('img-'+frame,[255,236,160]);if(picture)ctx.drawImage(picture as CanvasImageSource,522.5,44.5,135,135);
    }
    const color=this.demoGood?this.draft?.info.colorGood:this.draft?.info.colorPerfect;ctx.fillStyle=color===undefined?'#f1d894':'#'+(color&0xffffff).toString(16).padStart(6,'0');ctx.fillRect(80,208,560,2);ctx.restore();
  }
}

