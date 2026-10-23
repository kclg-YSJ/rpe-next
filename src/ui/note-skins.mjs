import { localPreferences } from '../platform/local-preferences.mjs';
import { parseNoteSkin, noteSkinInfo, NOTE_SKIN_IMAGES, NOTE_SKIN_SOUNDS, NOTE_SKIN_LIMITS } from '../core/note-skin.mjs';
import { builtinNoteSkins, readNoteSkins, storeNoteSkin, deleteNoteSkin, importNoteSkin, exportNoteSkin, updateNoteSkin, decodeNoteSkinSounds } from '../platform/note-skins.mjs';
import { ResourceNoteSkin } from './resource-note-skin.mjs';
import { RpeSkin } from './skin.mjs';
import { assetUrl } from '../core/asset-url.mjs';
import { download } from '../platform/files.mjs';
import { hitFrame } from '../core/visual-constants.mjs';
import { t } from '../i18n.mjs';

const ACTIVE_KEY='rpe-next-note-skin-v1';
const action=(text,run,className='')=>{const node=document.createElement('button');node.type='button';node.textContent=text;node.className=className;node.onclick=run;return node;};
const text=(tag,value,className='')=>{const node=document.createElement(tag);node.textContent=value;node.className=className;return node;};
const title=record=>record?record.info.name+(record.info.author?` (${record.info.author})`:''):t('note-skins.s32e82dc');

export class NoteSkins {
  constructor(host,{skin,hitSounds,audio,notify,invalidate,pause,settings}) {
    Object.assign(this,{skin,hitSounds,audio,notify,invalidate,pause,settings});this.records=new Map();this.modifications=new WeakMap();this.current='default';this.selected='default';this.cardUrls=[];this.generation=0;this.applying=false;this.demoPlaying=true;
    host.append(text('h3',t('note-skins.s0c86c6b')),text('p',t('note-skins.s930653c'),'hint'));
    this.summary=text('span',t('note-skins.s32e82dc'));const entry=action(t('note-skins.s9f804bf'),()=>this.open());entry.id='note-skins-open';host.append(entry,this.summary);
    this.renderDialog();this.ready=this.load();
  }
  async load() {
    try {
      for(const record of await builtinNoteSkins())this.records.set(record.id,record);
      for(const stored of await readNoteSkins()) {
        try {
          if(!/^(?:pack-[a-f0-9]{24}|builtin-[a-z0-9-]+)$/.test(stored.id))throw new Error(t('note-skins.sad6c3a5'));
          const builtin=this.records.get(stored.id);if(stored.id.startsWith('builtin-')&&!builtin)continue;
          const record=parseNoteSkin(new Map(stored.files),stored.id);
          record.builtin=Boolean(builtin);record.originalFiles=builtin?.files??new Map(stored.originalFiles??stored.files);this.records.set(record.id,record);
        } catch(error) {this.notify(t('note-skins.sae607ad')+error.message,'warning');}
      }
      const id=localPreferences.getItem(ACTIVE_KEY)??'default';
      if(id!=='default'&&!this.records.has(id)) {localPreferences.removeItem(ACTIVE_KEY);this.notify(t('note-skins.sc1e1b9b'),'warning');}
      else if(id!=='default')await this.activate(id,false);
    } catch(error) {this.notify(t('note-skins.sc10ed5f')+error.message,'warning');}
    this.summary.textContent=title(this.records.get(this.current));
  }
  renderDialog() {
    this.dialog=document.createElement('dialog');this.dialog.id='note-skin-modal';this.dialog.className='note-skin-manager';
    const heading=document.createElement('div');heading.className='note-skin-heading';heading.append(text('h2',t('note-skins.s0c86c6b')),action(t('note-skins.sf3b1542'),()=>this.close()));
    const toolbar=document.createElement('div');toolbar.className='note-skin-toolbar';
    this.zip=document.createElement('input');this.zip.type='file';this.zip.accept='.zip';this.zip.hidden=true;this.zip.setAttribute('aria-label',t('note-skins.s81067f7'));this.zip.onchange=()=>this.importFiles(this.zip.files);
    this.directory=document.createElement('input');this.directory.type='file';this.directory.webkitdirectory=true;this.directory.multiple=true;this.directory.hidden=true;this.directory.setAttribute('aria-label',t('note-skins.s7e3bc2f'));this.directory.onchange=()=>this.importFiles(this.directory.files,true);
    toolbar.append(action(t('note-skins.s8458b3b'),()=>this.zip.click()),action(t('note-skins.s4d2d93e'),()=>this.directory.click()),text('span',t('note-skins.s9076326'),'hint'));
    const body=document.createElement('div');body.className='note-skin-body';this.gallery=document.createElement('div');this.gallery.className='note-skin-gallery';this.gallery.setAttribute('aria-label',t('note-skins.s32e0496'));
    this.detail=document.createElement('div');this.detail.className='note-skin-detail';
    const previewHeader=document.createElement('div');previewHeader.className='note-skin-preview-heading';this.selectedTitle=text('h3','');
    this.animationButton=action(t('note-skins.sf3cae90'),()=>{this.demoPlaying=!this.demoPlaying;this.animationButton.textContent=this.demoPlaying?t('note-skins.sf3cae90'):t('note-skins.sea5f119');});
    this.goodButton=action(t('note-skins.s4bc2bc9'),()=>{this.demoGood=!this.demoGood;this.goodButton.textContent=this.demoGood?t('note-skins.sf7dced8'):t('note-skins.s4bc2bc9');});previewHeader.append(this.selectedTitle,this.animationButton,this.goodButton);
    this.backgroundButton=action(t('note-skins.sa3018de'),()=>{this.demoLight=!this.demoLight;this.backgroundButton.textContent=this.demoLight?t('note-skins.s73ecf67'):t('note-skins.sa3018de');this.dialog.classList.toggle('preview-light',this.demoLight);});previewHeader.append(this.backgroundButton);
    this.canvas=document.createElement('canvas');this.canvas.className='note-skin-preview';this.canvas.setAttribute('aria-label',t('note-skins.s3ca2033'));
    this.form=document.createElement('div');this.form.className='note-skin-form';this.form.addEventListener('input',()=>this.updateDraft());
    this.materials=document.createElement('details');this.materials.className='note-skin-materials';this.materials.append(text('summary',t('note-skins.sab7a299')));
    this.detail.append(previewHeader,this.canvas,this.form,this.materials);body.append(this.gallery,this.detail);
    const footer=document.createElement('div');footer.className='note-skin-footer';this.message=text('p',t('note-skins.sfc74501'),'hint');this.message.setAttribute('role','status');
    this.applyButton=action(t('note-skins.s32df5f8'),()=>this.apply(),'primary');this.applyButton.id='note-skin-apply';this.exportButton=action(t('note-skins.sd6b10af'),()=>{if(this.draft)download(exportNoteSkin(this.draft),this.safeFilename()+'.zip');});
    this.resetButton=action(t('note-skins.s33bbd88'),()=>this.reset());this.deleteButton=action(t('note-skins.s3755f56'),()=>this.remove());
    const actions=document.createElement('div');actions.className='note-skin-toolbar';actions.append(this.resetButton,this.exportButton,this.deleteButton,this.applyButton);footer.append(this.message,actions);
    this.dialog.append(heading,toolbar,body,footer,this.zip,this.directory);document.body.append(this.dialog);
    this.dialog.addEventListener('cancel',event=>{if(event.target!==this.dialog)return;event.preventDefault();this.close();});
    this.dialog.addEventListener('close',()=>{cancelAnimationFrame(this.frame);this.stopSound();this.previewSkin?.resourcePack?.dispose();this.previewSkin=null;this.clearCardUrls();if(!this.settings.open)this.settings.showModal();});
    this.dialog.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();event.stopPropagation();this.apply();}});
    this.dialog.addEventListener('dragover',event=>{event.preventDefault();});this.dialog.addEventListener('drop',event=>{event.preventDefault();if(event.dataTransfer.files.length)this.importFiles(event.dataTransfer.files);});
  }
  safeFilename(){return (this.draft?.info.name??'note-skin').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').slice(0,80)||'note-skin';}
  error(error){this.message.textContent=error.message;this.message.classList.add('error');this.notify(error.message,'error');}
  clearCardUrls(){for(const url of this.cardUrls)URL.revokeObjectURL(url);this.cardUrls=[];}
  renderCards(){
    this.clearCardUrls();this.gallery.replaceChildren();
    for(const [id,record] of [['default',null],...this.records]) {
      const card=action('',()=>this.select(id),'note-skin-card');card.dataset.noteSkin=id;card.setAttribute('aria-pressed',String(id===this.selected));
      const images=document.createElement('div');images.className='note-skin-card-images';
      for(const [file,builtin] of [['click.png','Tap2'],['drag.png','Drag2'],['flick.png','Flick2']]) {
        const image=document.createElement('img');image.alt=file.slice(0,-4);image.loading='lazy';
        if(record){const url=URL.createObjectURL(new Blob([record.files.get(file)],{type:'image/png'}));this.cardUrls.push(url);image.src=url;}else image.src=assetUrl(`rpe/Texture/${builtin}.png`);
        images.append(image);
      }
      let modified=record&&this.modifications.get(record);
      if(record&&modified===undefined){
        modified=Boolean(record.originalFiles&&(record.files.size!==record.originalFiles.size||[...record.files].some(([name,bytes])=>{
          const original=record.originalFiles.get(name);return !original||bytes.length!==original.length||bytes.some((value,index)=>value!==original[index]);
        })));this.modifications.set(record,modified);
      }
      const state=[id===this.current?t('note-skins.sc99c695'):record?.builtin||id==='default'?t('note-skins.s09ceea7'):t('note-skins.s5c5b7cf'),...(modified?[t('note-skins.sc920e42')]:[])].join(' · ');
      card.append(images,text('strong',record?.info.name??t('note-skins.s32e82dc')),text('span',record?.info.author??t('note-skins.s5c6073a')),text('small',state));this.gallery.append(card);
    }
  }
  async open(){await this.ready;this.pause();this.settings.close();this.dialog.showModal();this.renderCards();await this.select(this.current,true);this.animate();}
  close(force=false){if(this.applying)return;if(!force&&this.modified&&!confirm(t('note-skins.s6a61366')))return;this.generation++;this.modified=false;this.dialog.close();}
  async select(id,force=false){
    if(this.applying)return false;if(!force&&this.modified&&!confirm(t('note-skins.sdb2ac61')))return false;
    const generation=++this.generation;this.selected=id;this.modified=false;this.draft=this.records.get(id)??null;this.valid=true;this.message.classList.remove('error');
    this.previewSkin?.resourcePack?.dispose();this.previewSkin=null;this.stopSound();this.renderCards();this.selectedTitle.textContent=title(this.draft);this.renderForm();this.renderMaterials();this.updateButtons();
    this.message.textContent=id===this.current?t('note-skins.s52933df'):t('note-skins.sbfbbf69');
    try {
      if(this.draft) {
        const previewSkin=new RpeSkin(()=>{});const runtime=await ResourceNoteSkin.prepare(this.draft,previewSkin.tintedSource.bind(previewSkin));
        if(generation!==this.generation){runtime.dispose();return false;}previewSkin.setResourcePack(runtime);this.previewSkin=previewSkin;
      } else this.previewSkin=this.skin.resourcePack?Object.assign(new RpeSkin(()=>{}),{images:this.skin.images}):this.skin;
      if(generation!==this.generation)return false;
      this.message.textContent=(id===this.current?t('note-skins.s52933df'):t('note-skins.scc459ad'))+(this.draft?.warnings.join('；')??'');
      this.updateButtons();return true;
    } catch(error){if(generation===this.generation){this.valid=false;this.error(error);this.updateButtons();}return false;}
  }
  field(host,label,key,type,value,min,max,step){
    const row=document.createElement('label');row.className='field';row.append(text('span',label));const input=document.createElement(type==='textarea'?'textarea':'input');
    if(type!=='textarea')input.type=type;input.dataset.noteSkinField=key;input.dataset.noteSkinType=type;input.dataset.rpenField='note-skin-'+key.replace('.','-');row.dataset.rpenField=input.dataset.rpenField;input.setAttribute('aria-label',label);
    if(type==='checkbox')input.checked=value;else input.value=value;if(min!==undefined)input.min=min;if(max!==undefined)input.max=max;if(step!==undefined)input.step=step;
    row.append(input);host.append(row);return input;
  }
  renderForm(){
    this.form.replaceChildren();this.controls=new Map();
    if(!this.draft){this.form.append(text('p',t('note-skins.sf8504a9'),'hint'));return;}
    const add=(host,label,key,type,min,max,step)=>this.controls.set(key,this.field(host,label,key,type,this.draft.info[key],min,max,step));
    add(this.form,t('note-skins.s1be7ae4'),'name','text');add(this.form,t('note-skins.s698bea5'),'author','text');add(this.form,t('note-skins.s26670dd'),'description','textarea');
    const group=label=>{const details=document.createElement('details');details.open=true;details.append(text('summary',label));this.form.append(details);return details;};
    const hold=group(t('note-skins.sa1a380a'));
    for(const [key,label] of [['holdAtlas',t('note-skins.s49e9c33')],['holdAtlasMH',t('note-skins.s35347a3')]]) for(const [index,part] of [t('note-skins.sa557e19'),t('note-skins.scb2f01b')].entries()) this.controls.set(key+'.'+index,this.field(hold,label+' '+part,key+'.'+index,'number',this.draft.info[key][index],0,65535,1));
    for(const [key,label] of [['holdKeepHead',t('note-skins.s47fe940')],['holdRepeat',t('note-skins.s371a6a0')],['holdCompact',t('note-skins.s8efd058')]])add(hold,label,key,'checkbox');
    const fx=group(t('note-skins.s17a5ccc'));
    for(const [index,label] of [t('note-skins.s2d413f8'),t('note-skins.s28d0560')].entries())this.controls.set('hitFx.'+index,this.field(fx,label,'hitFx.'+index,'number',this.draft.info.hitFx[index],1,10240,1));
    add(fx,t('note-skins.s04fea79'),'hitFxDuration','number',0.01,120,0.01);add(fx,t('note-skins.sd49e653'),'hitFxScale','number',0.01,64,0.01);
    for(const [key,label] of [['hitFxRotate',t('note-skins.sbe01f50')],['hitFxTinted',t('note-skins.s809e349')],['hideParticles',t('note-skins.sbc45d6a')]])add(fx,label,key,'checkbox');
    const colors=group(t('note-skins.s63b1c14'));
    for(const [key,label] of [['colorPerfect','Perfect'],['colorGood','Good']])this.controls.set(key,this.field(colors,label+'（RGB / ARGB）',key,'text','0x'+this.draft.info[key].toString(16).padStart(8,'0')));
    colors.append(text('p',t('note-skins.s783f3db'),'hint'));
  }
  updateDraft(){
    if(!this.draft)return;const source=structuredClone(this.draft.info);let invalid=false;
    for(const [key,control] of this.controls){control.setCustomValidity('');const type=control.dataset.noteSkinType??control.type;const value=type==='checkbox'?control.checked:type==='number'?Number(control.value):control.value;
      if(type==='number'){
        const validation=control.type==='number'?control:control.cloneNode();if(validation!==control){validation.type='number';validation.value=control.value;}
        if(!control.value.trim()||!Number.isFinite(value)||!validation.checkValidity()){control.setCustomValidity(t('note-skins.s87c1194'));invalid=true;}
      }
      if(key.includes('.')){const [field,index]=key.split('.');source[field][index]=value;}else source[key]=value;
    }
    try {if(invalid)throw new Error(t('note-skins.sd0a30b2'));this.draft=updateNoteSkin(this.draft,noteSkinInfo(source));if(this.previewSkin?.resourcePack)this.previewSkin.resourcePack.setInfo(this.draft.info);
      this.valid=true;this.modified=true;this.selectedTitle.textContent=title(this.draft)+t('note-skins.s5db8ce7');this.message.classList.remove('error');this.message.textContent=t('note-skins.s1f09d2b');}
    catch(error){this.valid=false;this.message.textContent=error.message;this.message.classList.add('error');}
    this.updateButtons();
  }
  updateButtons(){this.applyButton.disabled=this.applying||!this.valid||!this.previewSkin;this.exportButton.disabled=this.applying||!this.valid||!this.draft;this.deleteButton.disabled=this.applying||!this.draft||this.draft.builtin;this.resetButton.disabled=this.applying||!this.draft;this.gallery.inert=this.applying;this.detail.inert=this.applying;}
  renderMaterials(){
    const open=this.materials.open;this.materials.replaceChildren(text('summary',t('note-skins.sab7a299')));this.materials.open=open;
    if(!this.draft){this.materials.append(text('p',t('note-skins.sffa3e49'),'hint'));}
    else for(const name of [...NOTE_SKIN_IMAGES,...Object.values(NOTE_SKIN_SOUNDS)]) {
      const row=document.createElement('div');row.className='note-skin-material-row';row.append(text('span',name),text('small',this.draft.files.has(name)?`${(this.draft.files.get(name).length/1024).toFixed(1)} KiB`:t('note-skins.sffcfdc0')));
      const input=document.createElement('input');input.type='file';input.accept=name.endsWith('.png')?'image/png':'.ogg';input.hidden=true;input.setAttribute('aria-label',t('note-skins.sad95096')+name);input.onchange=()=>this.replaceFile(name,input.files?.[0]);
      row.append(action(t('note-skins.s855241c'),()=>input.click()),input);
      if(name.endsWith('.ogg'))row.append(action(t('note-skins.s854b122'),()=>this.audition(Object.keys(NOTE_SKIN_SOUNDS).find(key=>NOTE_SKIN_SOUNDS[key]===name))));
      if(name.endsWith('.ogg')&&this.draft.files.has(name))row.append(action(t('note-skins.se401a05'),()=>this.replaceFile(name,null)));
      this.materials.append(row);
    }
    const sounds=document.createElement('div');sounds.className='note-skin-toolbar';for(const [key,label] of [['tap','Tap / Hold'],['drag','Drag'],['flick','Flick']])sounds.append(action(t('note-skins.s6028bff')+label,()=>this.audition(key)));
    this.materials.append(sounds);
  }
  async replaceFile(name,file){
    if(!this.draft||this.applying||file===undefined)return;
    const generation=this.generation;let runtime;
    try {
      if(file&&file.size>NOTE_SKIN_LIMITS.fileBytes)throw new Error(t('note-skins.sea27847'));
      const next=updateNoteSkin(this.draft,this.draft.info,new Map([[name,file?new Uint8Array(await file.arrayBuffer()):null]]));
      const preview=new RpeSkin(()=>{});runtime=await ResourceNoteSkin.prepare(next,preview.tintedSource.bind(preview));
      if(file&&name.endsWith('.ogg'))await decodeNoteSkinSounds(next,this.audio.ensureContext());
      if(generation!==this.generation||!this.dialog.open){runtime.dispose();return;}
      this.previewSkin?.resourcePack?.dispose();preview.setResourcePack(runtime);this.previewSkin=preview;this.draft=next;this.modified=true;this.valid=true;this.renderMaterials();this.message.textContent=t('note-skins.s885fcbb');this.updateButtons();
    } catch(error){runtime?.dispose();if(generation===this.generation)this.error(error);}
  }
  async importFiles(files,directory=false){
    if(!files?.length||this.applying)return;
    try {
      const record=await importNoteSkin(files,directory);const preview=new RpeSkin(()=>{});const runtime=await ResourceNoteSkin.prepare(record,preview.tintedSource.bind(preview));
      try{await decodeNoteSkinSounds(record,this.audio.ensureContext());}finally{runtime.dispose();}
      const existing=this.records.get(record.id);if(existing&&!confirm(t('note-skins.s824c0b1')))return;
      if(this.modified&&!confirm(t('note-skins.sd47b5f6')))return;
      await storeNoteSkin(record);this.records.set(record.id,record);await this.select(record.id,true);this.message.textContent=t('note-skins.s4e8e005');
    }catch(error){this.error(error);}finally{this.zip.value='';this.directory.value='';}
  }
  async activate(id,persist=true,record=this.records.get(id),beforeActivate=async()=>{}){
    if(id==='default'){this.skin.setResourcePack(null);this.hitSounds.setSoundPack();}
    else {
      if(!record)throw new Error(t('note-skins.s942b042'));
      const runtime=await ResourceNoteSkin.prepare(record,this.skin.tintedSource.bind(this.skin));
      try {const sounds=await decodeNoteSkinSounds(record,this.audio.ensureContext());await beforeActivate();this.skin.setResourcePack(runtime);this.hitSounds.setSoundPack(sounds);}
      catch(error){runtime.dispose();throw error;}
    }
    this.current=id;if(persist)localPreferences.setItem(ACTIVE_KEY,id);this.summary.textContent=title(record);this.updateToolImages();this.invalidate();document.dispatchEvent(new CustomEvent('rpen-note-skin-changed',{detail:{id}}));
  }
  updateToolImages(){
    const generation=this.toolGeneration=(this.toolGeneration??0)+1;
    for(const url of this.toolUrls??[])URL.revokeObjectURL(url);this.toolUrls=[];
    for(const image of document.querySelectorAll('[data-tool] > img')){
      image.dataset.defaultNoteSrc??=image.getAttribute('src');const type=Number(image.parentElement.dataset.tool);const picture=this.skin.noteImage(type);
      if(!this.skin.resourcePack){image.src=image.dataset.defaultNoteSrc;continue;}
      const canvas=document.createElement('canvas');canvas.width=160;canvas.height=56;const context=canvas.getContext('2d');
      const ratio=type===2?this.skin.resourcePack.info.holdAtlas[1]/picture.naturalWidth:picture.naturalHeight/picture.naturalWidth;
      const width=Math.min(150,48/Math.max(0.01,ratio));this.skin.head(context,type,80,28,width);canvas.toBlob(blob=>{
        if(!blob||generation!==this.toolGeneration)return;const url=URL.createObjectURL(blob);this.toolUrls.push(url);image.src=url;
      });
    }
  }
  async apply(){
    if(this.applying||!this.valid||!this.previewSkin)return;this.applying=true;this.updateButtons();
    try{const record=this.draft;await this.activate(this.selected,true,record,async()=>{if(record)await storeNoteSkin(record);});if(record)this.records.set(record.id,record);this.modified=false;this.renderCards();this.message.classList.remove('error');this.message.textContent=t('note-skins.s8ba9521');this.notify(t('note-skins.sb3609b7')+title(record),'success');}
    catch(error){this.error(error);}finally{this.applying=false;this.updateButtons();}
  }
  async reset(){
    if(!this.draft||!confirm(t('note-skins.sde00735')))return;
    try{const original=this.draft.originalFiles??this.draft.files;const restored={...parseNoteSkin(original,this.selected),originalFiles:original,builtin:this.draft.builtin};
      await this.select(this.selected,true);this.draft=restored;this.modified=true;this.renderForm();this.renderMaterials();
      const preview=new RpeSkin(()=>{});preview.setResourcePack(await ResourceNoteSkin.prepare(restored,preview.tintedSource.bind(preview)));this.previewSkin?.resourcePack?.dispose();this.previewSkin=preview;this.message.textContent=t('note-skins.s13f8637');this.valid=true;this.updateButtons();
    }catch(error){this.error(error);}
  }
  async remove(){
    const record=this.records.get(this.selected);if(!record||record.builtin||!confirm(t('note-skins.sb112dd0', { p0: record.info.name })))return;
    try{if(this.current===record.id)await this.activate('default');await deleteNoteSkin(record.id);this.records.delete(record.id);await this.select(this.current,true);}catch(error){this.error(error);}
  }
  stopSound(){if(this.soundSource){try{this.soundSource.stop();}catch{}this.soundSource.disconnect();this.soundSource=null;}}
  async audition(type){
    try{this.stopSound();const context=this.audio.ensureContext();await context.resume();let buffer;
      if(this.draft){const sounds=await decodeNoteSkinSounds(this.draft,context);buffer=sounds.get(type);}
      if(!buffer){await this.hitSounds.prepare();buffer=this.hitSounds.buffers.get(type);}
      if(!buffer)throw new Error(t('note-skins.s80488c6'));
      if(!this.dialog.open)return;const source=context.createBufferSource();source.buffer=buffer;const gain=context.createGain();gain.gain.value=this.hitSounds.volume;gain.connect(context.destination);source.connect(gain);source.onended=()=>{source.disconnect();gain.disconnect();if(this.soundSource===source)this.soundSource=null;};this.soundSource=source;source.start();
    }catch(error){this.error(error);}
  }
  animate(){
    cancelAnimationFrame(this.frame);const render=now=>{if(!this.dialog.open)return;if(this.demoPlaying)this.demoTime=now/1000;this.drawDemo(this.demoTime??0);this.frame=requestAnimationFrame(render);};this.frame=requestAnimationFrame(render);
  }
  drawDemo(time){
    const skin=this.previewSkin;if(!skin)return;const ratio=globalThis.devicePixelRatio||1;const width=Math.max(1,this.canvas.clientWidth);const height=Math.max(1,this.canvas.clientHeight);
    if(this.canvas.width!==Math.round(width*ratio)||this.canvas.height!==Math.round(height*ratio)){this.canvas.width=Math.round(width*ratio);this.canvas.height=Math.round(height*ratio);}
    const ctx=this.canvas.getContext('2d');ctx.setTransform(this.canvas.width/width,0,0,this.canvas.height/height,0,0);ctx.clearRect(0,0,width,height);ctx.fillStyle=this.demoLight?'#d8dde6':'#20242b';ctx.fillRect(0,0,width,height);
    const scale=Math.min(width/680,height/250);ctx.save();ctx.translate((width-680*scale)/2,(height-250*scale)/2);ctx.scale(scale,scale);ctx.fillStyle=this.demoLight?'#252a35':'#edf0f5';ctx.font='12px sans-serif';ctx.fillText(t('note-skins.s7cda072'),12,57);ctx.fillText(t('note-skins.s3de9708'),12,127);ctx.fillText('Hold',400,25);ctx.fillText(t('note-skins.sc8bab1f'),540,25);
    for(const [x,type,label] of [[125,1,'Tap'],[225,4,'Drag'],[325,3,'Flick']]){skin.head(ctx,type,x,55,80,false,undefined,0);skin.head(ctx,type,x,125,80,true,undefined,0);ctx.fillStyle=this.demoLight?'#4d5563':'#afb7c4';ctx.fillText(label,x-20,182);}
    skin.hold(ctx,430,195,45,52,false,true);skin.hold(ctx,480,195,45,52,true,true);
    const duration=skin.hitLifetime??0.5;const age=time%(duration+0.35);if(!skin.drawHit(ctx,{age,x:590,y:112,size:135,rotation:Math.PI/4,seed:9,good:this.demoGood})){
      const frame=hitFrame(age);const picture=frame&&skin.tinted('img-'+frame,[255,236,160]);if(picture)ctx.drawImage(picture,522.5,44.5,135,135);
    }
    const color=this.demoGood?this.draft?.info.colorGood:this.draft?.info.colorPerfect;ctx.fillStyle=color===undefined?'#f1d894':'#'+(color&0xffffff).toString(16).padStart(6,'0');ctx.fillRect(80,208,560,2);ctx.restore();
  }
}
