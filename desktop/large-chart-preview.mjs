import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, realpath, lstat, readdir, unlink, rmdir, copyFile, statfs, access } from 'node:fs/promises';
import { constants, createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { join, dirname } from 'node:path';
import { largeChartSaveDestination, largeChartSpace } from './large-chart-paths.mjs';

const FORMAT = 'rpen-large-preview-v1', uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const documentCommands = ['window','editable','page','edit','travel','save','hits','soundNames','selection','selectionRead','selectionEdit','selectionCopy','selectionPaste'];
const cacheFiles = /^(?:\.owner\.json|notes\.sqlite(?:-journal|-wal|-shm)?|summary\.json|(?:cover|music)\.[a-z0-9]+)$/;
async function smallJson(path) {
  const info = await lstat(path); if (!info.isFile() || info.isSymbolicLink() || info.size > 4096) throw Error('预览缓存标识文件无效');
  return JSON.parse(await readFile(path, 'utf8'));
}
export async function previewCacheRoot(parent) {
  const selected = await lstat(parent);
  if (!selected.isDirectory() || selected.isSymbolicLink()) throw Error('请选择普通目录，缓存目录不能是链接或重定向目录');
  const actual = await realpath(parent);
  await largeChartSpace(actual, 2 * 1024 ** 3);
  const root = join(actual, 'RPEN-LargeChartPreview');
  await mkdir(root, { recursive: true });
  const canonical = await realpath(root), same = process.platform === 'win32' ? canonical.toLowerCase() === root.toLowerCase() : canonical === root;
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink() || !same) throw Error('缓存目录不能是链接或重定向目录');
  await access(root, constants.W_OK);
  const marker = join(root, '.rpen-cache.json');
  try { if ((await smallJson(marker)).format !== FORMAT) throw Error('缓存目录标识不匹配'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; await writeFile(marker, JSON.stringify({ format: FORMAT }), { flag: 'wx' }); }
  return root;
}
export async function removePreviewWorkspace(root, workspace) {
  if (dirname(workspace) !== root || !uuid.test(workspace.slice(root.length + 1))) throw Error('无效的预览缓存路径');
  let info; try { info = await lstat(workspace); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(workspace) !== workspace) throw Error('拒绝清理重定向缓存');
  if ((await smallJson(join(workspace, '.owner.json'))).format !== FORMAT) throw Error('缓存缺少所有权标识');
  const names = await readdir(workspace);
  // Never recursively remove an arbitrary directory or follow a link.
  for (const name of names) { const stat = await lstat(join(workspace, name)); if (!cacheFiles.test(name) || !stat.isFile() || stat.isSymbolicLink()) throw Error('缓存包含未知文件，已保留以避免误删'); }
  for (const name of names.filter(name => name !== '.owner.json')) await unlink(join(workspace, name));
  await unlink(join(workspace, '.owner.json')); await rmdir(workspace);
}
export class LargeChartPreviewService {
  constructor(statePath, { progress = () => {} } = {}) { this.statePath = statePath; this.progress = progress; }
  async configure(parent) {
    const root = await previewCacheRoot(parent);
    this.recoveries=[];
    for (const name of await readdir(root)) {
      if (name === '.rpen-cache.json') continue;
      if (!uuid.test(name)) throw Error('预览缓存目录含未知内容，请选择其他目录');
      const workspace = join(root, name), info = await lstat(workspace);
      if (!info.isDirectory() || info.isSymbolicLink()) throw Error('缓存目录结构无效');
      const owner = await smallJson(join(workspace, '.owner.json'));
      if (owner.format !== FORMAT || !Number.isInteger(owner.pid)) throw Error('缓存所有权无效');
      let active = true; try { process.kill(owner.pid, 0); } catch (error) { if (error.code === 'ESRCH') active = false; }
      if (active) throw Error('此缓存目录正被另一个预览使用');
      if(owner.editing&&owner.dirty){this.recoveries.push({workspace,owner});continue;}
      await removePreviewWorkspace(root, workspace);
    }
    await writeFile(this.statePath, JSON.stringify({ parent: await realpath(parent) })); this.root = root;
    return root;
  }
  async open(source,{recovery}={}) {
    if (!this.root || this.job || this.stopping) throw Error('预览尚未配置或已有预览正在进行');
    const id = randomUUID(), workspace = join(this.root, id);
    const job = { id, workspace, pending: new Map(), sequence: 0 }; this.job = job;
    job.owner={format:FORMAT,pid:process.pid};
    job.prepare = (async () => {
      let used=0;for(const name of await readdir(this.root)){if(name==='.rpen-cache.json')continue;if(!uuid.test(name))throw Error('缓存目录包含未知内容');const directory=join(this.root,name),info=await lstat(directory);if(!info.isDirectory()||info.isSymbolicLink())throw Error('缓存目录结构无效');for(const file of await readdir(directory)){const info=await lstat(join(directory,file));if(!info.isFile()||info.isSymbolicLink())throw Error('缓存包含链接或未知目录');used+=info.size;}}
      const planned=recovery||/\.rpenlarge$/i.test(source)?(await lstat(source)).size+96*1024**2:864*1024**2;
      if(used+planned>1024**3)throw Error('缓存预算已被未保存工程占用，请先恢复并保存该工程');
      await mkdir(workspace); await writeFile(join(workspace, '.owner.json'), JSON.stringify(job.owner), { flag: 'wx' }); job.owned = true;
      if(recovery||/\.rpenlarge$/i.test(source)){const info=await lstat(source),disk=await statfs(workspace);if(!info.isFile()||info.isSymbolicLink()||info.size>768*1024**2||disk.bavail*disk.bsize<2*1024**3)throw Error('工程文件或磁盘空间超出预算');job.project=join(workspace,'notes.sqlite');await copyFile(source,job.project);job.savedPath=recovery?recovery.owner.savedPath:source;if(recovery){
        // A terminated worker can leave its last committed edit in the WAL.
        // Copy it beside the private database before SQLite opens that copy.
        try { const wal=await lstat(source+'-wal');if(!wal.isFile()||wal.isSymbolicLink()||wal.size>768*1024**2)throw Error('恢复日志无效或超过预算');await copyFile(source+'-wal',job.project+'-wal'); } catch(error) { if(error.code!=='ENOENT')throw error; }
        job.owner={...job.owner,editing:true,dirty:true};await writeFile(join(workspace,'.owner.json'),JSON.stringify(job.owner));}}
    })();
    try {
      await job.prepare; if (job.closing) throw Error('已取消超大谱预览');
      job.worker = new Worker(new URL('./large-chart-worker.mjs', import.meta.url), { workerData: { workspace, source, project:job.project }, resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 } });
      job.ready = new Promise((accept, reject) => { job.accept = accept; job.reject = reject; });
      job.worker.on('message', message => {
        if (this.job !== job || job.closing) return;
        if (message.progress) { this.progress({ id, ...message.progress, cacheRoot: this.root }); return; }
        if (message.failed) { job.reject(Error(message.failed)); return; }
        if (message.ready) { job.summary = message.ready; job.accept(message.ready); return; }
        const pending = job.pending.get(message.id); if (!pending) return; job.pending.delete(message.id);
        if (message.error) pending.reject(Error(message.error)); else pending.accept(message.result);
      });
      const failed = error => { job.reject(error); for (const pending of job.pending.values()) pending.reject(error); job.pending.clear(); if (!job.closing) this.close().catch(() => {}); };
      job.worker.on('error', failed); job.worker.on('exit', code => { if (!job.closing) failed(Error(`预览后台已停止（${code}）`)); });
      const summary = await job.ready;
      if (job.closing) throw Error('已取消超大谱预览');
      if(recovery){await removePreviewWorkspace(this.root,recovery.workspace);this.recoveries=this.recoveries.filter(value=>value!==recovery);}
      return this.publicSummary(summary);
    } catch (error) { await this.close({discard:true}); throw error; }
  }
  async window(id, value) {
    return this.command(id,'window',value);
  }
  publicSummary(summary=this.job.summary) {const job=this.job;return{...summary,id:job.id,cacheRoot:this.root,savedPath:job.savedPath,media:Object.fromEntries(Object.keys(summary.media??{}).map(role=>[role,`rpe://app/__large-preview/${job.id}/${role}`]))};}
  async command(id,method,value) {
    const job = this.job; if (!job || job.id !== id || !job.summary || job.closing) throw Error('预览已关闭');
    if(!documentCommands.includes(method))throw Error('不支持的超大谱操作');
    if(job.pending.size>=8)throw Error('后台操作过于频繁，请稍后重试');
    const changesDocument = ['edit','travel','selectionPaste'].includes(method) || method==='selectionEdit'&&value?.action==='finish';
    if(changesDocument){job.owner={...job.owner,editing:true,dirty:true};await writeFile(join(job.workspace,'.owner.json'),JSON.stringify(job.owner));}
    const result=await new Promise((accept,reject)=>{const request=++job.sequence;job.pending.set(request,{accept,reject});job.worker.postMessage({id:request,method,value});});
    if(['editable','save'].includes(method)||changesDocument){
      job.summary=result;job.owner={...job.owner,editing:true,dirty:result.dirty};await writeFile(join(job.workspace,'.owner.json'),JSON.stringify(job.owner));return this.publicSummary(result);
    }
    return result;
  }
  async close({discard=false}={}) {
    if (this.stopping) return this.stopping;
    const job = this.job; if (!job) return;
    job.closing = true; job.reject?.(Error('已取消超大谱预览')); for (const pending of job.pending.values()) pending.reject(Error('预览已关闭')); job.pending.clear();
    this.stopping = (async () => {
      try {
        await job.prepare.catch(() => {}); await job.worker?.terminate();
        if (job.owned&&(!job.owner?.dirty||discard)) await removePreviewWorkspace(this.root, job.workspace); else if(!job.owned)await rmdir(job.workspace).catch(error => { if (error.code !== 'ENOENT') throw error; });
        if (this.job === job) this.job = null;
      } finally { this.stopping = null; }
    })();
    return this.stopping;
  }
  async asset(request) {
    const match = new URL(request.url).pathname.match(/^\/__large-preview\/([^/]+)\/(music|cover)$/), job = this.job;
    if (!match || !job?.summary || job.closing || match[1] !== job.id || !job.summary.media[match[2]]) return new Response('Not found', { status: 404 });
    const path = join(job.workspace, job.summary.media[match[2]]), size = (await lstat(path)).size;
    let start = 0, end = size - 1, status = 200;
    const range = request.headers.get('Range');
    if (range) {
      const parts = range.match(/^bytes=(\d*)-(\d*)$/); if (!parts || !parts[1] && !parts[2]) return new Response(null, { status: 416 });
      if (!parts[1]) start = Math.max(0, size - Number(parts[2])); else start = Number(parts[1]);
      if (parts[1] && parts[2]) end = Math.min(end, Number(parts[2]));
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } }); status = 206;
    }
    const ext = path.split('.').at(-1), types = { mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac', m4a: 'audio/mp4', opus: 'audio/ogg', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
    const headers = { 'Content-Type': types[ext] ?? 'application/octet-stream', 'Content-Length': String(Math.max(0, end - start + 1)), 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    return new Response(request.method === 'HEAD' || !size ? null : Readable.toWeb(createReadStream(path, { start, end })), { status, headers });
  }
}
export function installLargeChartPreview({ ipcMain, service, window, origin, dialog, shell }) {
  let choosing = false, generation = 0;
  ipcMain.handle('rpen-large-preview', async (event, request) => {
    try {
      if (event.sender !== window()?.webContents || event.senderFrame !== event.sender.mainFrame || !event.senderFrame.url.startsWith(origin + '/')) throw Error('无权限');
      const { action, id, value } = request ?? {}; let result;
      if (action === 'choose') {
        if (choosing || service.job || service.stopping) throw Error('已有超大谱预览正在进行'); choosing = true;
        const current = generation;
        try {
          const source = await dialog.showOpenDialog(window(), { title: '超大谱 · 选择谱面或工程', filters: [{ name: '谱面与超大谱工程', extensions: ['zip', 'pez','rpenlarge'] }], properties: ['openFile'] });
          if (source.canceled || current !== generation) return { ok: true, result: null };
          if (!service.root) {
            let parent; try { parent = (await smallJson(service.statePath)).parent; await service.configure(parent); } catch { parent = null; }
            if (!parent) {
              const folder = await dialog.showOpenDialog(window(), { title: '选择缓存位置（上限 1 GiB，至少 2 GiB 可用空间）', defaultPath: dirname(source.filePaths[0]), properties: ['openDirectory', 'createDirectory'] });
              if (folder.canceled || current !== generation) return { ok: true, result: null }; await service.configure(folder.filePaths[0]);
            }
          }
          if (current !== generation) return { ok: true, result: null };
          let recovery;
          if(service.recoveries?.length){const choice=await dialog.showMessageBox(window(),{type:'question',title:'发现未保存的超大谱编辑',message:'恢复上次未保存的编辑？',buttons:['恢复编辑','打开刚选择的文件','取消'],defaultId:0,cancelId:2});if(choice.response===2)return{ok:true,result:null};if(choice.response===0)recovery=service.recoveries[0];}
          result=await service.open(recovery?join(recovery.workspace,'notes.sqlite'):source.filePaths[0],{recovery});
        } finally { choosing = false; }
      } else if (action === 'window') result = await service.window(id, value);
      else if(documentCommands.includes(action)&&action!=='save')result=await service.command(id,action,value);
      else if(action==='save'){
        const job=service.job;if(!job||job.id!==id)throw Error('工程已关闭');let destination=job.savedPath;
        if(!destination||value?.saveAs){const choice=await dialog.showSaveDialog(window(),{title:'保存超大谱工程',defaultPath:destination??join(dirname(service.root),'谱面.rpenlarge'),filters:[{name:'超大谱工程',extensions:['rpenlarge']}]});if(choice.canceled)return{ok:true,result:null};destination=choice.filePath;}
        destination = await largeChartSaveDestination(destination, service.root);
        result=await service.command(id,'save',destination);job.savedPath=destination;job.owner.savedPath=destination;await writeFile(join(job.workspace,'.owner.json'),JSON.stringify(job.owner));result.savedPath=destination;
      }
      else if (action === 'close') { generation++; result = await service.close({discard:value?.discard===true}); }
      else if (action === 'openCache') { if (service.root) { const error = await shell.openPath(service.root); if (error) throw Error(error); } }
      else throw Error('不支持的预览操作');
      return { ok: true, result };
    } catch (error) { return { ok: false, error: error.message }; }
  });
}
