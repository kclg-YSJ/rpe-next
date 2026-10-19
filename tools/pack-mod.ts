import { readdir,readFile,writeFile } from 'node:fs/promises';
import { resolve,join,basename } from 'node:path';
import { parseModPackage } from '../src/core/mod-package.ts';
import { exportMod } from '../src/platform/mods.ts';

if(!process.argv[2])throw Error('用法：node tools/pack-mod.ts <目录> [输出.rpenmod]');
const root=resolve(process.argv[2]);const files=new Map();
async function visit(relative=''){
  for(const entry of await readdir(join(root,relative),{withFileTypes:true})){
    if(entry.name.startsWith('.')||entry.name==='node_modules')continue;
    const path=relative?relative+'/'+entry.name:entry.name;
    if(entry.isDirectory())await visit(path);
    else if(entry.isFile())files.set(path,new Uint8Array(await readFile(join(root,path))));
  }
}
await visit();const record=parseModPackage(files);const output=resolve(process.argv[3]??basename(root)+'.rpenmod');
await writeFile(output,new Uint8Array(await exportMod(record).arrayBuffer()));
console.log(`${record.manifest.name} · ${record.manifest.version} → ${output}`);
