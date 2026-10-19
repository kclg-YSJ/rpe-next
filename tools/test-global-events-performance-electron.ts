import { app, BrowserWindow } from 'electron';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

interface ConsoleMessageLike {
  level: string;
  message: string;
}

const scratch = resolve('.local-tools/global-events');
mkdirSync(scratch, { recursive: true });
app.setPath('userData', join(scratch, 'density-profile-' + Date.now()));
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1440, height: 960, show: false, webPreferences: { backgroundThrottling: false } });
  const errors: string[] = [];
  win.webContents.on('will-prevent-unload', event => event.preventDefault());
  win.webContents.on('console-message', detail => {
    const info = detail as unknown as ConsoleMessageLike;
    if (info.level === 'error' && !/favicon/.test(info.message)) errors.push(info.message);
  });
  try {
    await win.loadURL('http://127.0.0.1:4187');
    win.showInactive();
    const report: unknown = await win.webContents.executeJavaScript(`(async()=>{
      const check=(condition,message)=>{if(!condition)throw Error(message);},checks=[];
      while(!window.rpenMods)await new Promise(resolve=>setTimeout(resolve,30));
      const {editor:e,manager}=window.rpenMods;await manager.ready;document.querySelector('#new').click();
      const {createEvent}=await import('./src/core/chart.ts'),{globalEventDensity}=await import('./src/core/global-events.ts'),{editorSkinContext}=await import('./src/ui/editor-skin-canvas.ts');
      const g=e.globalEvents,original=g.getContext;let seconds=0,duration=0;
      g.getContext=()=>({...original(),seconds:()=>seconds,duration:()=>duration});
      const remove=e.globalEventRegistry.register({id:'density-test',name:'Density',columns:[{id:'x',name:'X'},{id:'y',name:'Y'}]});e.openGlobalEvents();
      const changes=['x','y'].map(column=>({type:'rpen/density-test',column,events:Array.from({length:6000},(_,index)=>createEvent(0,1,index/4,index/4+.125))}));
      g.document.apply(changes,'Density test');g.draw(0);g.drawDensity();
      const expected=e.tempo.seconds([1499,7,8])+2;check(g.densityDuration()===expected,'Fallback duration');
      let calls=0,secondsMethod=e.tempo.seconds;e.tempo.seconds=function(...args){calls++;return secondsMethod.apply(this,args);};
      try{for(let index=0;index<120;index++)g.drawDensity();check(calls===0,'Stable density must not traverse event endpoints');}finally{e.tempo.seconds=secondsMethod;}
      checks.push('120 density updates with 12000 events reuse duration and bins without tempo evaluation');
      let draws=0;const fill=CanvasRenderingContext2D.prototype.fillRect,image=CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.fillRect=function(...args){draws++;return fill.apply(this,args);};CanvasRenderingContext2D.prototype.drawImage=function(...args){draws++;return image.apply(this,args);};
      try{for(let index=0;index<120;index++)g.drawDensity();check(draws===0,'Stationary density must not redraw');seconds=expected/2;g.drawDensity();check(draws>0,'Moving marker must redraw');}finally{CanvasRenderingContext2D.prototype.fillRect=fill;CanvasRenderingContext2D.prototype.drawImage=image;}
      checks.push('stationary density performs no canvas drawing; seek refreshes the marker');
      const geometry=g.geometry,labels=g.timeline.eventLabels,observer=new MutationObserver(()=>{});observer.observe(document.querySelector('.editor'),{subtree:true,childList:true,attributes:true,characterData:true});
      for(let index=0;index<120;index++){g.sync();g.autoScroll(.016);}
      const mutations=observer.takeRecords();observer.disconnect();check(mutations.length===0,'Idle synchronization must not mutate DOM: '+mutations.map(change=>change.target.id+':'+change.attributeName).join(','));check(g.geometry===geometry&&g.timeline.eventLabels===labels,'Stable column geometry');
      checks.push('idle synchronization keeps geometry and produces no DOM mutations');
      seconds=0;
      const reference=bar=>{
        const canvas=document.createElement('canvas'),width=bar.width,height=bar.height,ratio=devicePixelRatio||1;canvas.width=bar.canvas.width;canvas.height=bar.canvas.height;
        const context=editorSkinContext(canvas.getContext('2d'),'global-density');context.setTransform(ratio,0,0,ratio,0,0);context.fillStyle='#282828';context.fillRect(0,0,width,height);
        const values=globalEventDensity(bar.entries.flatMap(entry=>entry.events),e.tempo,g.densityDuration(),Math.max(1,Math.round(width/3))),maximum=values.reduce((value,item)=>Math.max(value,item),1);
        for(let index=0;index<values.length;index++)if(values[index]){const amount=Math.sqrt(values[index]/maximum);context.fillStyle='#d39b55';context.globalAlpha=.3+amount*.7;const top=height*(1-amount)*.7;context.fillRect(index*width/values.length,top,Math.max(1,width/values.length-.5),height-top);}
        context.globalAlpha=1;context.fillStyle='#ffffff';context.fillRect(0,0,1,height);
        const a=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data,b=bar.canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
        check(a.every((value,index)=>Math.abs(value-b[index])<=1),'Cached density pixels match reference');
      };
      g.drawDensity();g.densityBars.forEach(reference);await e.editorSkins.use('inkline');g.drawDensity();g.densityBars.forEach(reference);checks.push('density matches original pixels with default and Inkline canvas palettes');
      const bar=g.densityBars.find(bar=>bar.type==='rpen/density-test'),previousWidth=bar.width;bar.canvas.style.width='173px';g.drawDensity();check(bar.width!==previousWidth&&bar.canvas.width===Math.round(173*devicePixelRatio),'Density resize invalidates raster');reference(bar);
      duration=60;g.drawDensity();check(bar.duration===60,'Audio duration invalidates density');duration=0;g.drawDensity();check(bar.duration===expected,'Fallback duration restored');checks.push('canvas resize and audio duration refresh cached density');
      g.document.apply([{...changes[0],events:[createEvent(2,3,0,1600)]}],'Extend density');const extended=g.densityDuration();check(extended===e.tempo.seconds([1600,0,1])+2,'Edit invalidates fallback range');e.session.travel('undo');check(g.densityDuration()===expected,'Undo invalidates fallback range');e.session.travel('redo');check(g.densityDuration()===extended,'Redo invalidates fallback range');
      e.commit('Density BPM',{...e.chart,BPMList:[{startTime:[0,0,1],bpm:240}]});check(g.densityDuration()===402,'Tempo invalidates duration');g.drawDensity();g.densityBars.forEach(reference);checks.push('event edits undo redo and BPM changes refresh range and density');
      e.activatePane('chart');const old=g.densityBars.map(bar=>bar.marker);seconds=100;g.drawDensity();check(g.densityBars.every((bar,index)=>bar.marker===old[index]),'Hidden overview is not drawn');e.activatePane('global-events');g.drawDensity();check(g.densityBars.every(bar=>bar.marker>0),'Reopening overview updates marker');
      await manager.enable('spatial-camera');check(document.querySelectorAll('#spatial-camera-overview').length===1,'Camera controls remain available');g.render();check(document.querySelectorAll('#spatial-camera-overview').length===1,'Camera controls remain unique');await manager.disable('spatial-camera');check(!document.querySelector('#spatial-camera-overview'),'Camera controls dispose');checks.push('hidden overview skips rendering; camera overview extension still mounts and disposes');
      remove();g.getContext=original;return {checks};
    })()`, true);
    if (errors.length) throw Error(errors.join('\n'));
    console.log(JSON.stringify({ ...(report as { checks: string[] }), errors }, null, 2));
  } catch (error) {
    console.error(error, errors);
    process.exitCode = 1;
  } finally {
    win.destroy();
    app.exit((process.exitCode as number) || 0);
  }
});
