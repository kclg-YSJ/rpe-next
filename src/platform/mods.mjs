import { openDatabase, ensureStore } from './storage.mjs';
import { readZip,writeZip } from './archive.mjs';
import { MOD_LIMITS,parseModPackage } from '../core/mod-package.mjs';
import { assetUrl } from '../core/asset-url.mjs';
import { nativeStorage, nativePackages } from './native.mjs';
import { t } from '../i18n.mjs';

async function access(mode,action){const database=await openDatabase('rpe-next-mods',1,(connection,transaction)=>ensureStore(connection,transaction,'packages',{keyPath:'id'}));return new Promise((resolve,reject)=>{const transaction=database.transaction('packages',mode);let request;try{request=action(transaction.objectStore('packages'));}catch(error){database.close();reject(error);return;}transaction.oncomplete=()=>{database.close();resolve(request.result);};transaction.onabort=transaction.onerror=()=>{database.close();reject(transaction.error??new Error(t('mods.s3054e0e')));};});}
export const readMods=()=>nativeStorage?nativePackages('mods','read'):access('readonly',store=>store.getAll());
export const storeMod=record=>{const stored={id:record.manifest.id,files:[...record.files],imported:Date.now()};return nativeStorage?nativePackages('mods','write',stored.id,stored):access('readwrite',store=>store.put(stored));};
export const deleteMod=id=>nativeStorage?nativePackages('mods','delete',id):access('readwrite',store=>store.delete(id));
export const exportMod=record=>writeZip(record.files);
export async function importMod(files,directory=false){
  let entries;if(directory){const list=[...files];if(list.length>MOD_LIMITS.files||list.some(file=>file.size>MOD_LIMITS.fileBytes)||list.reduce((sum,file)=>sum+file.size,0)>MOD_LIMITS.bytes)throw Error(t('mods.s1225b7b'));entries=new Map(await Promise.all(list.map(async file=>[file.webkitRelativePath||file.name,new Uint8Array(await file.arrayBuffer())])));}
  else {const file=files[0];if(!file||file.size>MOD_LIMITS.bytes+1024*1024)throw Error(t('mods.s7a4223d'));entries=await readZip(await file.arrayBuffer(),{maxFiles:MOD_LIMITS.files,maxBytes:MOD_LIMITS.bytes,maxFileBytes:MOD_LIMITS.fileBytes});}
  return parseModPackage(entries);
}
export async function builtinMods(){
  const response=await fetch(assetUrl('mods/index.json'));if(!response.ok)throw Error(t('mods.sd477bc7'));const list=await response.json();
  if(!Array.isArray(list))throw Error(t('mods.sca48f1b'));
  return Promise.all(list.map(async entry=>{if(!entry||!/^[a-z][a-z0-9-]*$/.test(entry.directory)||!Array.isArray(entry.files))throw Error(t('mods.s9653619'));const files=new Map(await Promise.all(entry.files.map(async path=>{if(typeof path!=='string'||path.includes('..')||path.startsWith('/'))throw Error(t('mods.se1cc6b0'));const result=await fetch(assetUrl(`mods/${entry.directory}/${path}`));if(!result.ok)throw Error(t('mods.s0c61114'));return[path,new Uint8Array(await result.arrayBuffer())];})));return {...parseModPackage(files),builtin:true};}));
}
