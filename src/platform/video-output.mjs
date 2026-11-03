import { checkRenderAbort, renderAwait } from '../core/render-task.mjs';
import { t } from '../i18n.mjs';

const MAX_FILE_BYTES = 128 * 1024 ** 3;
export function videoDownload(blob, name) {
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;link.dataset.modInteractive='true';
  document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  return {status:'download-started',name,bytes:blob.size};
}
export async function createVideoOutput(name, mime, { signal, expectedBytes=0 } = {}) {
  checkRenderAbort(signal);
  const bridge=globalThis.rpenRenderOutput;
  if(bridge?.version===1){
    const call=async(action,value)=>{const r=await bridge.call(action,value);if(!r.ok)throw Error(r.error);return r.result;};
    const selected=await call('begin',{name});if(!selected)return null;
    let size=0,done=false;
    const abort=async()=>{if(done)return;done=true;await call('abort',{id:selected.id});};
    if(signal?.aborted){await abort();checkRenderAbort(signal);}
    return {name:selected.name,writable:new WritableStream({
      async write({data,position}){checkRenderAbort(signal);for(let offset=0;offset<data.length;offset+=1024**2){size=await call('write',{id:selected.id,position:position+offset,data:data.slice(offset,offset+1024**2)});}},
      close:()=>call('close',{id:selected.id}),abort
    }),bytes:()=>size,abort,async commit(){checkRenderAbort(signal);const result=await call('commit',{id:selected.id});done=true;return {...result,...(result.id?{openFolder:()=>call('openFolder',{id:result.id})}:{})};}};
  }
  let handle,root,temporary=false,fileName,writer;
  if(typeof globalThis.showSaveFilePicker==='function') {
    try {handle=await showSaveFilePicker({suggestedName:name,types:[{description:t('render.videoFile'),accept:{[mime]:['.'+name.split('.').at(-1)]}}]});}
    catch(error){if(error.name==='AbortError')return null;throw error;}
  }else if(navigator.storage?.getDirectory){
    const estimate=await navigator.storage.estimate();if(estimate.quota-estimate.usage<expectedBytes+32*1024**2)throw Error(t('render.outputSpace'));
    root=await navigator.storage.getDirectory();fileName='rpen-video-'+crypto.randomUUID();handle=await root.getFileHandle(fileName,{create:true});temporary=true;
  }else throw Error(t('render.outputUnavailable'));
  let size=0,done=false;
  const clean=async()=>{if(temporary)await root.removeEntry(fileName).catch(()=>{});};
  try{writer=await handle.createWritable();}catch(error){await clean();throw error;}
  const abort=async()=>{if(done)return;done=true;await writer.abort().catch(()=>{});await clean();};
  if(signal?.aborted){await abort();checkRenderAbort(signal);}
  return {name,writable:new WritableStream({async write({data,position}){checkRenderAbort(signal);if(position+data.length>MAX_FILE_BYTES)throw Error(t('render.outputSpace'));await writer.write({type:'write',position,data});size=Math.max(size,position+data.length);},close(){},abort}),bytes:()=>size,abort,
    async commit(){checkRenderAbort(signal);await writer.close();const file=await handle.getFile();if(!temporary){done=true;return{status:'saved',name,bytes:size};}const result=videoDownload(file,name);done=true;return{...result,file,dispose:clean};}
  };
}
