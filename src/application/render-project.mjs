import { TempoMap } from '../core/tempo.mjs';
import { hitTimeline } from '../platform/hitsounds.mjs';
import { largeChartCommand } from '../platform/native.mjs';
import { createRenderMusic } from '../platform/render-audio.mjs';
import { checkRenderAbort, renderAwait, renderYield } from '../core/render-task.mjs';
import { t } from '../i18n.mjs';

const MAX_SECONDS = 12 * 3600;
export function declaredDuration(chart) { const n = Number(chart?.META?.duration); return Number.isFinite(n) && n > 0 && n <= MAX_SECONDS ? n : 0; }
export function chartRange(chart, tempo, musicDuration = 0, offsetMs = null, largeEnd = 0) {
  const offset = Number(offsetMs ?? chart.META?.offset ?? 0) / 1000;
  const declared = declaredDuration(chart), musicSeconds = Number.isFinite(musicDuration) ? Math.max(0, musicDuration) : 0;
  let last = largeEnd;
  // State events may have sentinel end times. Music or a declared duration wins.
  if (!declared && !musicSeconds) {
    const visit = (events, factor) => { for (const event of events ?? []) for (const beat of [event.startTime, event.endTime, event.disappearTime]) if (beat !== undefined) { const s=tempo.seconds(beat,factor);if(Number.isFinite(s)&&s<=MAX_SECONDS)last=Math.max(last,s); } };
    for (const line of chart.judgeLineList ?? []) {
      const factor=line.bpmfactor??1;visit(line.notes,factor);
      for (const layer of [...(line.eventLayers??[]),line.extended??{}]) for (const events of Object.values(layer??{})) if(Array.isArray(events))visit(events,factor);
    }
    for(const area of chart.blockAreaList??[])visit([area],area.bpmfactor??1);
    for(const type of Object.values(chart.globalEvents?.types??{}))for(const column of Object.values(type.columns??{}))visit(column.events,1);
  }
  const content=Math.min(MAX_SECONDS,Math.max(0,last)+.9),musicEnd=Math.max(0,musicSeconds-offset);
  return {start:0,end:Math.max(.1,declared||musicEnd||content||1),musicEnd,declared,content,musicSeconds,offset};
}
export function rangeEndAtOffset(range, offsetMs) { return Math.max(.1,range.declared||(range.musicSeconds>0?range.musicSeconds-offsetMs/1000:range.content)||1); }

export async function loadStudioProject(host, signal, { musicEnabled = true, hitDelays = null, hitLine = null, playbackMusic = false } = {}) {
  const editor=host.editor,session=editor.session;
  if(!editor.hasDocument||editor.home)throw Error(t('render.openChart'));
  const disk=session.largeDocument;
  if(disk)await renderAwait(disk.flush(),signal);
  checkRenderAbort(signal);
  if(editor.session!==session||!editor.hasDocument)throw Error(t('render.projectChanged'));
  const revision=disk?.revision,chart=structuredClone(disk?.header??editor.chart),assets=new Map(editor.assets??[]),chartName=editor.chartName;
  const tempo=new TempoMap(chart.BPMList);
  const assertCurrent=()=>{checkRenderAbort(signal);if(disk&&(disk.disposed||disk.revision!==revision))throw Error(t('render.projectChanged'));};
  const project={chart,assets,chartName,info:editor.libraryProject?.info??{},tempo,chartOffset:Number(chart.META?.offset)||0,title:chart.META?.name||chartName,sourceSession:session,sourceChart:editor.chart,large:disk?{...disk.summary,chart,revision}:null,assertCurrent};
  project.largeCover = disk ? editor.images?.background : null;
  project.hitSoundNames = disk ? await renderAwait(largeChartCommand('soundNames', disk.summary.id), signal) : [...new Set(['tap','drag','flick',...chart.judgeLineList.flatMap(line=>(line.notes??[]).filter(note=>!note.isFake).map(note=>note.hitsound||note.hitSound).filter(Boolean))])];
  let entries;
  project.readHits=async(start,end,taskSignal)=>{
    assertCurrent();checkRenderAbort(taskSignal);
    if (disk) {
      const result = [];
      for (let from = start; from < end - 1e-9; from = Math.min(end, from + 1)) {
        const to = Math.min(end, from + 1);
        const options = { start: from, end: to, ...(hitDelays ? { delays: hitDelays, line: hitLine } : {}) };
        const value = await renderAwait(largeChartCommand('hits', disk.summary.id, options), taskSignal);
        assertCurrent();
        for (const entry of value.entries) {
          const time = entry.time + (hitDelays?.[entry.kind] ?? 0) / 1000;
          if (time >= from && time < to) result.push({ ...entry, time });
        }
      }
      return result;
    }
    if(!entries){await renderYield(taskSignal);entries=hitTimeline(chart,tempo,hitDelays?Object.fromEntries(Object.entries(hitDelays).map(([kind,ms])=>[kind,ms/1000])):{tap:0,drag:0,flick:0},hitLine).map(e=>({...e,time:e.time-project.chartOffset/1000,count:1}));}
    const lower=value=>{let lo=0,hi=entries.length;while(lo<hi){const mid=Math.floor((lo+hi)/2);if(entries[mid].time<value)lo=mid+1;else hi=mid;}return lo;};
    return entries.slice(lower(start),lower(end));
  };
  project.readWindow=disk?async(seconds,radius,taskSignal,historySpan=.75)=>{
    assertCurrent();let span=.5;
    for(;;){try{const value=await renderAwait(largeChartCommand('window',disk.summary.id,{seconds,span,radius,historySpan}),taskSignal);assertCurrent();return value;}catch(error){if(!/不同音符组超过/.test(error.message)||span<.025)throw error;span/=2;}}
  }:null;
  try {
    try { project.musicSource=await createRenderMusic({project,buffer:playbackMusic?editor.audio?.playbackBuffer:disk?null:editor.audio?.buffer,url:playbackMusic?editor.audio?.playbackMedia?.src:disk?(editor.audio?.media?.src||disk.summary.media?.music):null,signal}); }
    catch (error) { if (musicEnabled || signal?.aborted) throw error; project.musicError=error; project.musicSource=null; }
    project.musicBuffer=project.musicSource?.buffer??null;
    project.range=chartRange(chart,tempo,project.musicSource?.duration??editor.audio?.buffer?.duration??editor.audio?.media?.duration??0,null,disk?.summary.endTime??0);project.duration=project.range.end;
    project.dispose=()=>{project.musicSource?.dispose();entries=null;};return project;
  }catch(error){project.musicSource?.dispose();throw error;}
}
