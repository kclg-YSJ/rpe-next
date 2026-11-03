import { parentPort, workerData } from 'node:worker_threads';
import { LargeChartDocument } from './large-chart-document.mjs';

const store = new LargeChartDocument(workerData.workspace, { progress: value => parentPort.postMessage({ progress: value }) });
try {
  const summary = workerData.project ? await store.restoreDatabase(workerData.project) : await store.import(workerData.source);
  parentPort.postMessage({ ready: summary });
  let queue=Promise.resolve();
  parentPort.on('message', request => {
    queue=queue.catch(()=>{}).then(async()=>{
      try {
        let result;
        if(request.method==='window')result=store.window({...request.value,packed:true});
        else if(request.method==='editable')result=await store.editable();
        else if(request.method==='page')result=store.page(request.value);
        else if(request.method==='edit')result=await store.edit(request.value);
        else if(request.method==='travel')result=await store.travel(request.value);
        else if(request.method==='save')result=await store.saveDatabase(request.value);
        else if(request.method==='hits')result=store.hits(request.value);
        else if(request.method==='soundNames')result=store.soundNames();
        else if(request.method==='selection')result=await store.selections.select(request.value);
        else if(request.method==='selectionRead')result=store.selections.read(request.value);
        else if(request.method==='selectionEdit')result=await store.selections.stage(request.value);
        else if(request.method==='selectionCopy')result=await store.selections.copy(request.value);
        else if(request.method==='selectionPaste')result=await store.selections.paste(request.value);
        else throw Error('无效的超大谱操作');
        const transfer=request.method==='window'?[result.notes.buffer,result.completions.buffer]:[];
        parentPort.postMessage({id:request.id,result},transfer);
      }catch(error){parentPort.postMessage({id:request.id,error:error.message});}
    });
  });
} catch (error) {
  store.close(); parentPort.postMessage({ failed: error.message }); parentPort.close();
}
