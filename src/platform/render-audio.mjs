import { assetBytes, resourceReferences } from './files.mjs';
import { assetUrl } from '../core/asset-url.mjs';
import { mixRenderPcm } from '../core/render-audio-mix.mjs';
import { checkRenderAbort, renderAwait, renderYield } from '../core/render-task.mjs';
import { loadMediaBunny } from './video-encoder.mjs';
import { t } from '../i18n.mjs';

const contexts = new Map();
export async function decodeBytes(value, sampleRate=48000, signal) {
  if(!contexts.has(sampleRate)){if(contexts.size>=2)contexts.delete(contexts.keys().next().value);contexts.set(sampleRate,new OfflineAudioContext(2,1,sampleRate));}
  const bytes=value instanceof Blob?await renderAwait(value.arrayBuffer(),signal):value.buffer.slice(value.byteOffset,value.byteOffset+value.byteLength);
  const buffer=await renderAwait(contexts.get(sampleRate).decodeAudioData(bytes),signal);
  if(buffer.length*buffer.numberOfChannels*4>16*1024**2)throw Error(t('render.soundBudget'));
  return buffer;
}
export function disposeDecodeContext(){contexts.clear();}

export async function createRenderMusic({project,buffer,url,signal}) {
  if(buffer)return {buffer,duration:buffer.duration,read:async()=>[{buffer,timestamp:0}],dispose(){}};
  const refs=resourceReferences(project.chart,project.assets,project.chartName,project.info);
  const bytes=refs.song?assetBytes(project.assets,refs.song,project.chartName):null;
  if(!url&&!bytes){if(refs.song)throw Error(t('render.missingMusic',{name:refs.song}));return null;}
  const media=await renderAwait(loadMediaBunny(),signal);
  const blob=bytes?(bytes instanceof Blob?bytes:new Blob([bytes])):null;
  const input=new media.Input({source:blob?new media.BlobSource(blob):new media.UrlSource(url,{maxCacheSize:8*1024**2}),formats:media.ALL_FORMATS});
  let objectUrl;
  try {
    const track=await renderAwait(input.getPrimaryAudioTrack(),signal);
    if(!track||!await renderAwait(track.canDecode(),signal))throw Error(t('render.musicDecode'));
    const duration=await renderAwait(track.computeDuration(),signal);
    if(!Number.isFinite(duration)||duration<=0)throw Error(t('render.musicDecode'));
    const sink=new media.AudioBufferSink(track),elements=new Set();
    const result={duration,buffer:null,
      createElement(){const audio=new Audio();objectUrl??=blob?URL.createObjectURL(blob):url;audio.src=objectUrl;audio.preload='auto';elements.add(audio);return audio;},
      async read(start,end,taskSignal){if(end<=0||start>=duration)return[];const pieces=[];let samples=0;const iterator=sink.buffers(Math.max(0,start),Math.min(end,duration));try{for(;;){const next=await renderAwait(iterator.next(),taskSignal);if(next.done)break;samples+=next.value.buffer.length*next.value.buffer.numberOfChannels*4;if(samples>8*1024**2)throw Error(t('render.audioBudget'));pieces.push(next.value);}}finally{await iterator.return();}return pieces;},
      dispose(){for(const audio of elements){audio.pause();audio.removeAttribute('src');audio.load();}elements.clear();input.dispose();if(blob&&objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=null;}
    };
    return result;
  }catch(error){input.dispose();throw error;}
}

// Each render owns this cache. Selected skin buffers never borrow the live
// editor's previous pack; chart resources have the same priority as playback.
export async function loadHitBuffers({assets,chartName,noteSkinRecord=null,sampleRate=48000,signal,names=['tap','drag','flick']}) {
  const buffers=new Map();let bytesUsed=0;
  buffers.ensure=async(entries,taskSignal=signal)=>{
    const unique=new Set(entries.map(e=>typeof e==='string'?e:e.sound));
    for(const name of unique){
      checkRenderAbort(taskSignal);if(buffers.has(name))continue;
      let bytes=assetBytes(assets,name,chartName)??noteSkinRecord?.sounds?.get(name);
      if(!bytes&&['tap','drag','flick'].includes(name)){const response=await renderAwait(fetch(assetUrl(`rpe/SE/${name}.ogg`),{signal:taskSignal}),taskSignal);if(response.ok)bytes=new Uint8Array(await response.arrayBuffer());}
      if(!bytes)throw Error(t('render.missingSound',{name}));
      const buffer=await decodeBytes(bytes,sampleRate,taskSignal);checkRenderAbort(taskSignal);
      bytesUsed+=buffer.length*buffer.numberOfChannels*4;if(bytesUsed>64*1024**2)throw Error(t('render.soundBudget'));buffers.set(name,buffer);
    }
  };
  await buffers.ensure(names,signal);return buffers;
}

// The encoder requests at most one second at a time. Carry hit tails across
// chunk boundaries and query the complete disk document, never the UI page.
export function createRenderAudioTrack(project,settings,hitBuffers,signal) {
  const hasMusic=Boolean(project.musicSource&&settings.musicVolume>0),hasHits=settings.hitSounds&&settings.hitVolume>0;
  if(!hasMusic&&!hasHits)return null;
  let active=[],until=null;
  return {sampleRate:settings.sampleRate,
    async read(relativeStart,frames){
      checkRenderAbort(signal);project.assertCurrent();
      const start=settings.start+relativeStart,end=start+frames/settings.sampleRate;
      if(hasHits){
        const lookback=Math.max(0,...[...hitBuffers.values()].map(b=>b.duration));
        const continuous=until!==null&&Math.abs(until-start)<1e-6;
        if(!continuous)active=[];
        const first=continuous?until:start-lookback;
        const hits=await project.readHits(first,end,signal);await hitBuffers.ensure(hits,signal);
        const groups=new Map();
        for(const hit of [...active.filter(h=>h.time+(hitBuffers.get(h.sound)?.duration??0)>start),...hits]){
          const key=JSON.stringify([hit.time,hit.sound]),found=groups.get(key);
          if(found)found.count+=(hit.count??1);else groups.set(key,{...hit,count:hit.count??1});
        }
        active=[...groups.values()];until=end;
        if(active.length>200000)throw Error(t('render.audioBudget'));
      }
      const offset=settings.offset/1000;
      const music=hasMusic?await project.musicSource.read(start+offset,end+offset,signal):[];
      await renderYield(signal);
      const options={start,frames,sampleRate:settings.sampleRate,hitBuffers,musicVolume:settings.musicVolume,hitVolume:settings.hitVolume,offset};
      const result=mixRenderPcm({...options,music});
      if(hasHits)for(let index=0;index<active.length;index+=64){
        mixRenderPcm({...options,hits:active.slice(index,index+64),target:result});
        if(index+64<active.length)await renderYield(signal);
      }
      checkRenderAbort(signal);return result;
    }
  };
}
