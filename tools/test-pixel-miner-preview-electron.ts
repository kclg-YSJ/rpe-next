// @ts-nocheck - Electron smoke script ported from the JavaScript release tooling.
import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const scratch=path.resolve('.local-tools/pixel-miner-preview');fs.mkdirSync(scratch,{recursive:true});app.setPath('userData',path.join(scratch,'profile-'+Date.now()));app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
  const win=new BrowserWindow({width:1440,height:960,show:false,webPreferences:{backgroundThrottling:false}}),errors=[],checks=[];
  win.webContents.on('will-prevent-unload',event=>event.preventDefault());win.webContents.on('console-message',detail=>{if(detail.level==='error'&&!/favicon/.test(detail.message))errors.push(detail.message);});win.webContents.on('render-process-gone',(_event,details)=>errors.push(JSON.stringify(details)));
  const run=async(fn,...args)=>{const result=await win.webContents.executeJavaScript('(async()=>{try{return await('+fn.toString()+')(...'+JSON.stringify(args)+')}catch(error){return{testError:error.stack}}})()',true);if(result?.testError)throw Error(result.testError);return result;};
  const until=async(fn,...args)=>{const end=Date.now()+12000;while(!await run(fn,...args)){if(Date.now()>end)throw Error('Timeout '+fn+' / '+JSON.stringify(errors));await wait(50);}};
  const key=async(keyCode,modifiers=[])=>{win.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});win.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers});await wait(80);};
  const move=async point=>{win.webContents.sendInputEvent({type:'mouseMove',...point});await wait(40);},down=point=>win.webContents.sendInputEvent({type:'mouseDown',...point,button:'left',clickCount:1}),up=point=>win.webContents.sendInputEvent({type:'mouseUp',...point,button:'left',clickCount:1});
  const mine=async()=>{const point=await run(()=>{const rect=document.querySelector('#preview').getBoundingClientRect();return{x:Math.round(rect.left+rect.width*.45),y:Math.round(rect.top+rect.height*.55)};});await move(point);down(point);await wait(410);up(point);await until(()=>Boolean(document.querySelector('.pm-drop')));};
  const capture=async name=>fs.writeFileSync(path.join(scratch,name+'.png'),(await win.webContents.capturePage()).toPNG());
  try{
    await win.loadURL('http://127.0.0.1:4187');win.showInactive();await until(()=>Boolean(window.rpenMods));
    await run(async()=>{
      const {editor:e,manager,runtime}=window.rpenMods;await manager.ready;document.querySelector('#new').click();
      const background=document.createElement('canvas');background.width=600;background.height=400;const context=background.getContext('2d');context.fillStyle='#3569a2';context.fillRect(0,0,600,400);context.fillStyle='#c47348';context.fillRect(180,100,240,200);
      e.addAsset('miner-preview.png',new Uint8Array(await(await new Promise(resolve=>background.toBlob(resolve))).arrayBuffer()));
      const {createNoiseArea,withNoiseAreas}=await import('./src/core/noise-areas.ts');e.commit('Preview fixture',withNoiseAreas({...e.chart,META:{...e.chart.META,background:'miner-preview.png'}},[createNoiseArea(0,100)]));
      await manager.enable('pixel-miner');await manager.setSetting('pixel-miner','mine-duration',.25);await manager.setSetting('pixel-miner','sound-volume',0);
      const audio=e.audio.ensureContext();e.audio.buffer=audio.createBuffer(1,audio.sampleRate*30,audio.sampleRate);e.setPreview(true,{autoplay:false});
      window.previewLoopTicks=0;runtime.loaded.get('pixel-miner').api.onFrame(()=>window.previewLoopTicks++);
      window.previewDraws=0;const draw=e.preview.drawBackground;e.preview.drawBackground=function(...args){window.previewDraws++;return draw.apply(this,args);};
      window.previewCanvas=e.preview.canvas;window.previewParent=e.preview.canvas.parentElement;window.previewChart=JSON.stringify(e.chart);
      window.previewDigest=(reference=false)=>{const e=window.rpenMods.editor,r=e.preview;r.duration=e.audio.duration;r.draw(e.chart,e.tempo,1,0);const canvas=r.shaderCanvas.style.visibility==='visible'?r.shaderCanvas:r.canvas,sample=document.createElement('canvas');sample.width=canvas.width;sample.height=canvas.height;const context=sample.getContext('2d');context.drawImage(canvas,0,0);const data=context.getImageData(0,0,canvas.width,canvas.height).data;if(reference)window.previewReference=data;let maximumDifference=0,totalDifference=0;for(let index=0;index<data.length;index++){const difference=Math.abs(data[index]-window.previewReference[index]);maximumDifference=Math.max(maximumDifference,difference);totalDifference+=difference;}return{size:[canvas.width,canvas.height],maximumDifference,averageDifference:totalDifference/data.length};};
    });await until(()=>Boolean(window.rpenMods.editor.images.background));await run(async()=>{await window.rpenMods.editor.skin.load();await document.fonts.ready;});await key('F9');
    for(const effects of [false,true]){
      await run(async effects=>{const e=window.rpenMods.editor;e.commit('Preview effects',{...e.chart,effects:effects?[{shader:'grayscale',startTime:[0,0,1],endTime:[100,0,1],global:false},{shader:'vignette',startTime:[0,0,1],endTime:[100,0,1],global:true}]:[]});e.seek(1,{music:true});await e.play();},effects);
      if(effects)await until(()=>window.rpenMods.editor.preview.shaderCanvas.style.visibility==='visible');
      const before=await run(()=>({digest:window.previewDigest(true),width:window.previewCanvas.width,height:window.previewCanvas.height}));
      await mine();
      const hidden=await run(()=>{const e=window.rpenMods.editor,r=e.preview;return{time:e.audio.time,ticks:window.previewLoopTicks,draws:window.previewDraws,hidden:r.canvas.closest('.pm-stash')!==null,width:r.canvas.width,height:r.canvas.height,shader:r.shaderCanvas.style.visibility,overlay:r.overlayCanvas.style.visibility,hits:r.noteHitAreas.length,viewport:r.viewport};});
      assert.equal(hidden.hidden,true);assert.deepEqual([hidden.width,hidden.height],[before.width,before.height]);assert.equal(hidden.shader,'hidden');assert.equal(hidden.overlay,'hidden');assert.equal(hidden.hits,0);assert.equal(hidden.viewport,null);
      await until((ticks,time)=>window.previewLoopTicks>ticks+5&&window.rpenMods.editor.audio.time>time+.1,hidden.ticks,hidden.time);const later=await run(()=>({time:window.rpenMods.editor.audio.time,ticks:window.previewLoopTicks,draws:window.previewDraws}));assert.ok(later.ticks>hidden.ticks+5,JSON.stringify({hidden,later}));assert.ok(later.time>hidden.time+.1);assert.equal(later.draws,hidden.draws);await capture(effects?'mined-shaders':'mined-background');
      await until(()=>Boolean(document.querySelector('[data-pm-slot="1"] .pm-item-art')));await key('2');const point={x:700,y:450};await move(point);down(point);up(point);await until(()=>Boolean(document.querySelector('#preview').closest('[data-pm-placement]')));await run(()=>window.rpenMods.editor.pause());
      await until(()=>{const r=window.rpenMods.editor.preview;return r.shaderCanvas.parentElement===r.canvas.parentElement&&r.overlayCanvas.parentElement===r.canvas.parentElement;});
      const placed=await run(()=>{const r=window.rpenMods.editor.preview,a=r.canvas.getBoundingClientRect(),b=r.shaderCanvas.getBoundingClientRect();return{same:r.canvas===window.previewCanvas,shader:r.shaderCanvas.parentElement===r.canvas.parentElement,overlay:r.overlayCanvas.parentElement===r.canvas.parentElement,aligned:Math.abs(a.left-b.left)<.2&&Math.abs(a.top-b.top)<.2&&Math.abs(a.width-b.width)<.2&&Math.abs(a.height-b.height)<.2,digest:window.previewDigest()};});
      assert.equal(placed.same,true,'same live canvas');assert.equal(placed.shader,true,'shader follows');assert.equal(placed.overlay,true,'overlay follows');assert.equal(placed.aligned,true,'shader aligned');assert.deepEqual(placed.digest.size,before.digest.size);assert.ok(placed.digest.maximumDifference<=16&&placed.digest.averageDifference<.02,JSON.stringify(placed.digest));await capture(effects?'placed-shaders':'placed-background');
      await key('F9',['control','shift']);await until(()=>window.previewCanvas.parentElement===window.previewParent&&window.rpenMods.editor.preview.shaderCanvas.parentElement===window.previewParent);const restored=await run(()=>window.previewDigest());assert.deepEqual(restored.size,before.digest.size);assert.ok(restored.maximumDifference<=16&&restored.averageDifference<.02,JSON.stringify(restored));
      checks.push(effects?'local/global shaders hide with the mined preview, align when placed and restore matching pixels':'mining a playing preview with background preserves rendering loop, audio, canvas and restored pixels');
    }
    await run(()=>window.rpenMods.editor.editorSkins.use('inkline'));await key('1');await mine();await run(()=>window.rpenMods.manager.disable('pixel-miner'));
    await until(()=>window.previewCanvas.parentElement===window.previewParent&&window.rpenMods.editor.preview.shaderCanvas.parentElement===window.previewParent);assert.equal(await run(()=>document.querySelectorAll('[data-pm-placement],[data-pm-placeholder],[data-pm-root]').length),0);await until(()=>Boolean(window.rpenMods.editor.preview.viewport));checks.push('Inkline preview can be mined and disabling the mod restores canvas and shader surfaces');
    assert.deepEqual(errors,[]);console.log(JSON.stringify({checks,errors},null,2));
  }catch(error){console.error(error.stack,errors);await capture('failure');process.exitCode=1;}finally{win.destroy();app.exit(process.exitCode||0);}
}).catch(error=>{console.error(error);app.exit(1);});
