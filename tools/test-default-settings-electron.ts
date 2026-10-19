// @ts-nocheck - ported release smoke script.
import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const scratch=path.resolve('.local-tools/default-settings-'+Date.now());fs.mkdirSync(scratch,{recursive:true});app.setPath('userData',path.join(scratch,'Profile'));
app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion');
app.whenReady().then(async()=>{
 const win=new BrowserWindow({width:1440,height:960,show:false,webPreferences:{backgroundThrottling:false}}),errors=[];
 win.webContents.on('will-prevent-unload',event=>event.preventDefault());
 win.webContents.on('console-message',details=>{if(details.level==='error'&&!/favicon/.test(details.message))errors.push(details.message);});
 const run=fn=>win.webContents.executeJavaScript('('+fn.toString()+')()',true);
 const ready=async()=>{const end=Date.now()+15000;while(!await run(()=>Boolean(window.rpenMods))){if(Date.now()>end)throw Error('Startup timed out');await new Promise(r=>setTimeout(r,30));}await run(async()=>{const e=window.rpenMods.editor;await e.editorSkins.ready;await e.noteSkins.ready;await document.fonts.ready;});};
 try{
  await win.loadURL('http://127.0.0.1:4187/?mods=off');await ready();
  const current=await run(()=>{const e=window.rpenMods.editor;return{volume:e.audio.volume,hitVolume:e.hitSounds.volume,noteSize:e.preview.noteSize,gridCount:e.timeline.gridCount,scale:e.timeline.scale,eventOpacity:e.timeline.eventOpacity,eventBarWidth:e.timeline.eventBarWidth,realtimeAlpha:e.realtimePreview.opacity,fps:Number(document.querySelector('#fps-limit').value),fpsUnlimited:document.querySelector('#fps-unlimited').checked,showUI:e.preview.showGameUI,theme:e.editorSkins.current,tips:document.querySelector('#tips-enabled').checked,autoSave:Number(document.querySelector('#autosave-seconds').value)};});
  assert.deepEqual(current,{volume:.51,hitVolume:.2573,noteSize:200,gridCount:21,scale:600,eventOpacity:.45,eventBarWidth:.67,realtimeAlpha:.05,fps:120,fpsUnlimited:false,showUI:true,theme:'inkline',tips:false,autoSave:240});
  const liveWidth=await run(()=>{const e=window.rpenMods.editor,input=document.querySelector('#note-size');input.value='240';input.dispatchEvent(new Event('input',{bubbles:true}));return{value:Number(input.value),preview:e.preview.noteSize,realtime:e.realtimePreview.noteSize,timeline:e.timeline.noteScale};});
  assert.deepEqual(liveWidth,{value:240,preview:240,realtime:240,timeline:240/175});
  const pairedSampling=await run(async()=>{const e=window.rpenMods.editor,{createChart,createEvent}=await import('/src/core/chart.ts');const chart=createChart(),layer=chart.judgeLineList[0].eventLayers[0];layer.moveXEvents=[createEvent(20,20,2,4)];layer.moveYEvents=[createEvent(-30,-30,2,4)];e.replace(chart);const sampler=e.eventSampler;if(!sampler.begin({type:'moveXEvents',index:0,field:'start',lineIndex:0}))throw Error('Sampler did not start');if(!sampler.mode.paired)throw Error('Matching Y event was not paired');const start=sampler.handle(sampler.draftChart);sampler.applyPoint({x:start.x+40,y:start.y-60});const preview=sampler.previewState(),draft=sampler.draftChart.judgeLineList[0].eventLayers[0];if(Math.abs(draft.moveXEvents[0].start-60)>1e-3||Math.abs(draft.moveYEvents[0].start-30)>1e-3)throw Error('Paired drag did not update both movement values');if(preview.chart.judgeLineList[0].eventLayers[0].moveYEvents[0].start!==30)throw Error('Paired movement was missing from the live preview');sampler.finish(true);const applied=e.chart.judgeLineList[0].eventLayers[0];if(applied.moveXEvents[0].start!==60||applied.moveYEvents[0].start!==30)throw Error('Paired values were not committed together');e.session.travel('undo');const undone=e.chart.judgeLineList[0].eventLayers[0];if(undone.moveXEvents[0].start!==20||undone.moveYEvents[0].start!==-30)throw Error('Paired sample was not one undo step');sampler.finish(false);return{paired:sampler.mode===null,committed:applied.moveXEvents[0].start===60&&applied.moveYEvents[0].start===30,undone:undone.moveXEvents[0].start===20&&undone.moveYEvents[0].start===-30};});
  assert.deepEqual(pairedSampling,{paired:true,committed:true,undone:true});
  await run(async()=>{const{localPreferences}=await import('/src/platform/local-preferences.ts');const{migratePreferences}=await import('/src/core/preferences.ts');const{storePreferences}=await import('/src/platform/library.ts');localPreferences.setItem('rpe-next-editor-v1',JSON.stringify({scale:355,volume:.2,eventOpacity:.7}));localPreferences.setItem('rpe-next-active-editor-skin-v1','default');await storePreferences(migratePreferences(JSON.stringify({NoteSize:144,MusicVolume:.65,FpsLimit:0})));});
  await win.reload();await ready();
  await new Promise(r=>setTimeout(r,150));
  const saved=await run(()=>{const e=window.rpenMods.editor;return{volume:e.audio.volume,noteSize:e.preview.noteSize,scale:e.timeline.scale,eventOpacity:e.timeline.eventOpacity,theme:e.editorSkins.current,fpsUnlimited:document.querySelector('#fps-unlimited').checked};});
  assert.deepEqual(saved,{volume:.2,noteSize:144,scale:355,eventOpacity:.7,theme:'default',fpsUnlimited:true});assert.deepEqual(errors,[]);
  console.log(JSON.stringify({checks:['fresh profile uses calibrated runtime, controls and Inkline appearance','note width updates preview and timeline immediately','paired movement sampling previews, commits and undoes both axes atomically','stored browser preferences and explicit default theme survive reload'],current,liveWidth,pairedSampling,saved,errors},null,2));
 }catch(error){console.error(error.stack,errors);process.exitCode=1;}finally{win.destroy();app.exit(process.exitCode||0);}
}).catch(error=>{console.error(error);app.exit(1);});
