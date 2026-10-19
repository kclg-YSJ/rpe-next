// @ts-nocheck - Electron smoke script ported from the JavaScript release tooling.
import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const scratch=path.resolve('.local-tools/library-delete');fs.mkdirSync(scratch,{recursive:true});app.setPath('userData',path.join(scratch,'profile-'+Date.now()));app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
  const win=new BrowserWindow({width:1440,height:960,show:false,webPreferences:{backgroundThrottling:false}}),errors=[],checks=[];
  win.webContents.on('will-prevent-unload',event=>event.preventDefault());win.webContents.on('console-message',detail=>{if(detail.level==='error'&&!/favicon/.test(detail.message))errors.push(detail.message);});
  const run=async(fn,...args)=>{const result=await win.webContents.executeJavaScript('(async()=>{try{return await('+fn.toString()+')(...'+JSON.stringify(args)+')}catch(error){return{testError:error.stack}}})()',true);if(result?.testError)throw Error(result.testError);return result;};
  const until=async(fn,...args)=>{const end=Date.now()+10000;while(!await run(fn,...args)){if(Date.now()>end)throw Error('Timeout '+fn+' / '+JSON.stringify(errors));await wait(50);}};
  const cardAction=(name,action)=>run((name,action)=>{const card=[...document.querySelectorAll('.project-card')].find(card=>card.querySelector('h2').textContent===name);if(!card)throw Error('Missing '+name);const button=action==='open'?card.querySelector('.project-open'):[...card.querySelectorAll('.project-actions button')].find(button=>button.textContent===action);button.click();},name,action);
  const remove=async name=>{await cardAction(name,'删除');await until(()=>document.querySelector('#modal-title').textContent==='删除项目'&&document.querySelector('#modal').open);await run(()=>document.querySelector('#modal-apply').click());await until(name=>!document.querySelector('#modal').open&&![...document.querySelectorAll('.project-card h2')].some(node=>node.textContent===name),name);};
  try{
    await win.loadURL('http://127.0.0.1:4187/?mods=off');win.showInactive();await until(()=>Boolean(window.rpenMods));
    await run(async()=>{const e=window.rpenMods.editor;document.querySelector('#new').click();e.commit('Fixture',{...e.chart,META:{...e.chart.META,name:'Opened A'}});await e.save();window.deletedId=e.libraryProject.id;const {storeProject}=await import('./src/platform/library.ts'),{createChart}=await import('./src/core/chart.ts');for(const name of ['Other B','Other C','Other D']){const chart=createChart();chart.META.name=name;await storeProject({id:crypto.randomUUID(),chart,chartName:'chart.json',assets:[],bytes:0,imported:Date.now()});}document.querySelector('#library').click();});
    await until(()=>window.rpenMods.editor.home&&document.querySelectorAll('.project-card').length===4);
    await remove('Opened A');
    const afterDelete=await run(()=>({resumeHidden:document.querySelector('#resume-editor').hidden,saveDisabled:document.querySelector('#save').disabled,exportDisabled:document.querySelector('#export').disabled,dirty:window.rpenMods.editor.dirty,beforeUnloadCanceled:!window.dispatchEvent(new Event('beforeunload',{cancelable:true}))}));
    assert.deepEqual(afterDelete,{resumeHidden:true,saveDisabled:true,exportDisabled:true,dirty:false,beforeUnloadCanceled:false});
    await cardAction('Other B','open');await until(()=>window.rpenMods.editor.chart.META.name==='Other B'&&!window.rpenMods.editor.home);assert.equal(await run(()=>document.querySelector('#modal').open),false);checks.push('delete loaded project closes stale editor; opening another project has no switch or unload prompt');
    await run(()=>document.querySelector('#library').click());await until(()=>window.rpenMods.editor.home);await remove('Other C');assert.equal(await run(()=>document.querySelector('#resume-editor').hidden),false);
    await cardAction('Other D','open');await until(()=>window.rpenMods.editor.chart.META.name==='Other D'&&!window.rpenMods.editor.home);assert.equal(await run(()=>document.querySelector('#modal').open),false);checks.push('delete unrelated project preserves resumable clean session without false prompt');
    // A real pending edit must still be guarded, even when home was shown by an extension.
    await run(()=>{const e=window.rpenMods.editor;e.commit('Unsaved',{...e.chart,META:{...e.chart.META,name:'Unsaved D'}});e.raw.setHome(true);});await until(()=>window.rpenMods.editor.home);await cardAction('Other B','open');await until(()=>document.querySelector('#modal').open&&document.querySelector('#modal-title').textContent==='切换谱面？');assert.equal(await run(()=>window.rpenMods.editor.chart.META.name),'Unsaved D');await run(()=>document.querySelector('#modal').close());checks.push('genuine unsaved edits still require switch confirmation');
    await run(()=>{document.querySelector('#resume-editor').click();document.querySelector('#library').click();});await until(()=>document.querySelector('#modal-title').textContent==='返回主界面前保存修改？');
    await run(()=>[...document.querySelectorAll('#modal-content button')].find(button=>button.textContent==='不保存并返回').click());await until(()=>window.rpenMods.editor.home&&!document.querySelector('#modal').open);await cardAction('Other B','open');await until(()=>window.rpenMods.editor.chart.META.name==='Other B'&&!window.rpenMods.editor.home);assert.equal(await run(()=>document.querySelector('#modal').open),false);checks.push('explicit discard on returning home does not ask again when opening a project');
    assert.deepEqual(errors,[]);console.log(JSON.stringify({checks,errors},null,2));
  }catch(error){console.error(error.stack,errors);fs.writeFileSync(path.join(scratch,'failure.png'),(await win.webContents.capturePage()).toPNG());process.exitCode=1;}finally{win.destroy();app.exit(process.exitCode||0);}
});
