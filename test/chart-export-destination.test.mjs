import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChartExportDestination, installChartExport } from '../desktop/chart-export.mjs';
import { saveChartExport } from '../src/platform/chart-export-destination.mjs';

test('谱面导出仅成功后记忆目录，重启恢复，取消不改变目录且不覆盖既有文件',async t=>{
  const root=await mkdtemp(join(tmpdir(),'rpen-export-test-'));t.after(()=>rm(root,{recursive:true,force:true}));const output=join(root,'导出谱面');await mkdir(output);
  const state=join(root,'config.json'),service=await new ChartExportDestination(state,root).initialize(),bytes=new Uint8Array([1,2,3]);let options;
  assert.equal(await service.save('one.json',bytes,async value=>(options=value,{canceled:true})),null);assert.equal(options.defaultPath,join(root,'one.json'));
  await service.save('one.json',bytes,async value=>({filePath:join(output,'谱面.json')}));assert.deepEqual(new Uint8Array(await readFile(join(output,'谱面.json'))),bytes);
  const reopened=await new ChartExportDestination(state,root).initialize();await reopened.save('two.pez',bytes,async value=>(options=value,{canceled:true}));assert.equal(options.defaultPath,join(output,'two.pez'));
  await reopened.save('one.json',new Uint8Array([4]),async()=>({filePath:join(output,'谱面.json')}));assert.equal((await readFile(join(output,'谱面.json')))[0],4);
  await assert.rejects(reopened.save('../secret.json',bytes,async()=>assert.fail('invalid name opens picker')));
});

test('桌面导出桥验证主窗口来源，浏览器以固定picker ID记忆目录，取消不写入',async()=>{
  let handler;const mainFrame={url:'rpe://app/index.html'},sender={mainFrame},service={save:async()=> 'chart.json'};
  installChartExport({ipcMain:{handle:(name,fn)=>{handler=fn;}},service,window:()=>({webContents:sender}),origin:'rpe://app',dialog:{}});
  assert.equal((await handler({sender,senderFrame:mainFrame},'chart.json',new Uint8Array())).ok,true);
  assert.equal((await handler({sender:{},senderFrame:mainFrame},'chart.json',new Uint8Array())).ok,false);
  let requested,written,closed=false;const blob=new Blob(['chart']);
  const name=await saveChartExport(blob,'demo.pez',{showSaveFilePicker:async options=>(requested=options,{name:'chosen.pez',createWritable:async()=>({write:async value=>{written=value;},close:async()=>{closed=true;}})})});
  assert.equal(name,'chosen.pez');assert.equal(requested.id,'rpen-chart-export');assert.equal(requested.suggestedName,'demo.pez');assert.equal(written,blob);assert.equal(closed,true);
  assert.equal(await saveChartExport(blob,'demo.json',{showSaveFilePicker:async()=>{throw Object.assign(Error(),{name:'AbortError'});}}),null);
});
