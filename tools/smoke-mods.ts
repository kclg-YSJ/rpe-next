import type { WebContents } from 'electron';

/** Exercise the real desktop rpe:// protocol, CSP, import maps and module loader. */
export interface SmokeModsResult {
  packageModules: boolean; internalImports: boolean; semanticHook: boolean;
  gameStart: boolean; gamePlayback: boolean; cleanup: boolean; documentation: boolean;
}

export async function smokeMods(webContents: WebContents): Promise<SmokeModsResult> {
  return webContents.executeJavaScript(`(async()=>{
    const host=window.rpenMods;await host.manager.ready;
    const {parseModPackage}=await import('/src/core/mod-package.ts');const encode=text=>new TextEncoder().encode(text);
    const record=parseModPackage(new Map([
      ['mod.json',encode(JSON.stringify({protocol:'rpen-mod',api:1,id:'desktop-probe',name:'Probe',version:'1.0.0',author:'Test',description:'Temporary protocol test',entry:'main.ts'}))],
      ['helper.ts',encode('export const answer=42;')],
      ['main.ts',encode("import {getEditor} from '@rpen/api';import {answer} from './helper.ts';export function activate(api){window.desktopModProof={same:getEditor()===api.editor,answer};api.hook('session:before-commit',change=>{change.chart={...change.chart,'x-desktop-mod':true}});return()=>{delete window.desktopModProof};}")]
    ]));host.manager.records.set(record.manifest.id,record);await host.manager.enable('desktop-probe');
    if(!window.desktopModProof.same||window.desktopModProof.answer!==42)throw Error('Desktop package modules failed');
    document.querySelector('#new').click();const {createChart}=await import('/src/core/chart.ts');host.editor.commit('Desktop mod',createChart());if(!host.editor.chart['x-desktop-mod'])throw Error('Desktop semantic hook failed');
    await host.manager.disable('desktop-probe');if(window.desktopModProof)throw Error('Desktop unload failed');
    const context=host.editor.audio.ensureContext();host.editor.audio.buffer=context.createBuffer(1,context.sampleRate*3,context.sampleRate);host.editor.seek(0,{music:true});
    await host.manager.enable('sky-dodge');host.runtime.commands.get('sky-dodge:toggle').run();
    if(!document.querySelector('.sky-dodge-dialog[open]')||host.runtime.locks.size!==1)throw Error('Desktop game start failed');
    [...document.querySelectorAll('.sky-dodge-dialog button')].at(-1).click();
    const surface=document.querySelector('.sky-dodge-surface');const rect=surface.getBoundingClientRect();surface.dispatchEvent(new PointerEvent('pointermove',{clientX:rect.left+rect.width/2,clientY:rect.top+rect.height/2,bubbles:true}));
    await new Promise(resolve=>setTimeout(resolve,150));if(!host.editor.audio.playing)throw Error('Desktop game playback failed');
    await host.manager.disableAll();if(host.runtime.locks.size||document.querySelector('.sky-dodge-surface')||host.editor.audio.playing)throw Error('Desktop game cleanup failed');
    for(const path of ['/protocols/MOD-PROTOCOL.zh-CN.md','/protocols/GLOBAL-EVENTS-PROTOCOL.zh-CN.md','/protocols/EDITOR-SKIN-PROTOCOL.zh-CN.md','/schemas/mod-api-v1.d.ts','/schemas/mod-v1.schema.json'])if(!(await fetch(path)).ok)throw Error('Desktop documentation unavailable: '+path);
    return{packageModules:true,internalImports:true,semanticHook:true,gameStart:true,gamePlayback:true,cleanup:true,documentation:true};
  })()`,true);
}
