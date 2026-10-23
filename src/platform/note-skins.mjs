import { openDatabase, ensureStore } from './storage.mjs';
import { readZip, writeZip } from './archive.mjs';
import { parseNoteSkin, serializeNoteSkinInfo, NOTE_SKIN_LIMITS } from '../core/note-skin.mjs';
import { assetUrl } from '../core/asset-url.mjs';
import { nativeStorage, nativePackages } from './native.mjs';
import { t } from '../i18n.mjs';

async function access(mode, action) {
  const database = await openDatabase('rpe-next-note-skins', 1, (connection, transaction) => ensureStore(connection, transaction, 'packages', { keyPath: 'id' }));
  return new Promise((resolve,reject) => {
    const transaction = database.transaction('packages',mode); let request;
    try {request=action(transaction.objectStore('packages'));} catch(error) {database.close();reject(error);return;}
    transaction.oncomplete=()=>{database.close();resolve(request.result);};
    transaction.onabort=transaction.onerror=()=>{database.close();reject(transaction.error??new Error(t('note-skins.s9edc07c')));};
  });
}
export const readNoteSkins = () => nativeStorage ? nativePackages('note-skins', 'read') : access('readonly',store=>store.getAll());
export const storeNoteSkin = record => { const stored = {id:record.id,files:[...record.files],originalFiles:[...(record.originalFiles??record.files)],imported:Date.now()}; return nativeStorage ? nativePackages('note-skins', 'write', stored.id, stored) : access('readwrite',store=>store.put(stored)); };
export const deleteNoteSkin = id => nativeStorage ? nativePackages('note-skins', 'delete', id) : access('readwrite',store=>store.delete(id));
export const exportNoteSkin = record => writeZip(record.files);

export async function decodeNoteSkinSounds(record,context) {
  return new Map(await Promise.all([...record.sounds].map(async ([type,bytes])=>{
    let timer;
    try {
      const buffer=await Promise.race([context.decodeAudioData(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)),new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(new Error(t('note-skins.s36e604f'))),20000);})]);
      if(buffer.duration>120)throw new Error(t('note-skins.s70082a8'));
      return [type,buffer];
    } catch(error) {throw new Error(t('note-skins.sa93480a', { p0: type, p1: error.message }));}
    finally {clearTimeout(timer);}
  })));
}

export function updateNoteSkin(record, info, replacements = new Map()) {
  const files = new Map(record.files);
  for (const [name,bytes] of replacements) bytes ? files.set(name,bytes) : files.delete(name);
  files.set('info.yml',new TextEncoder().encode(serializeNoteSkinInfo(info)));
  return {...parseNoteSkin(files,record.id),originalFiles:record.originalFiles??record.files,builtin:record.builtin};
}

export async function importNoteSkin(files, directory = false) {
  let entries;
  if (!directory) {
    const file=files[0]; if (!file || file.size>NOTE_SKIN_LIMITS.bytes+1024*1024) throw new Error(t('note-skins.s85028f4'));
    entries=await readZip(await file.arrayBuffer(),{maxFiles:NOTE_SKIN_LIMITS.files,maxBytes:NOTE_SKIN_LIMITS.bytes,maxFileBytes:NOTE_SKIN_LIMITS.fileBytes});
  } else {
    const selected=[...files];
    if(selected.length>NOTE_SKIN_LIMITS.files || selected.some(file=>file.size>NOTE_SKIN_LIMITS.fileBytes) || selected.reduce((sum,file)=>sum+file.size,0)>NOTE_SKIN_LIMITS.bytes) throw new Error(t('note-skins.s7b834c6'));
    entries=new Map(await Promise.all(selected.map(async file=>[file.webkitRelativePath||file.name,new Uint8Array(await file.arrayBuffer())])));
  }
  const record=parseNoteSkin(entries);
  // Identity is independent of filesystem paths and remains stable after parameter edits.
  const ordered=new Map([...record.files].sort(([a],[b])=>a<b?-1:a>b?1:0));
  const digest=await crypto.subtle.digest('SHA-256',await writeZip(ordered).arrayBuffer());
  record.id='pack-'+[...new Uint8Array(digest)].slice(0,12).map(byte=>byte.toString(16).padStart(2,'0')).join('');
  record.originalFiles=record.files;
  return record;
}

export async function builtinNoteSkins() {
  const response=await fetch(assetUrl('note-skins/index.json')); if(!response.ok) throw new Error(t('note-skins.s10cf901'));
  const list=await response.json(); if(!Array.isArray(list)) throw new Error(t('note-skins.sab42917'));
  return Promise.all(list.map(async entry=>{
    if(!entry || !/^[a-z0-9-]+$/.test(entry.directory) || !Array.isArray(entry.files) || entry.files.length>NOTE_SKIN_LIMITS.files) throw new Error(t('note-skins.sfe07f89'));
    const files=new Map(await Promise.all(entry.files.map(async name=>{
      if(typeof name!=='string'||name.startsWith('/')||name.includes('..')||name.includes('\\')) throw new Error(t('note-skins.s42f3060'));
      const result=await fetch(assetUrl(`note-skins/${entry.directory}/${name}`));if(!result.ok)throw new Error(t('note-skins.sa98a6e9'));
      return [name,new Uint8Array(await result.arrayBuffer())];
    })));
    const record=parseNoteSkin(files,'builtin-'+entry.directory);return {...record,builtin:true,originalFiles:record.files};
  }));
}
