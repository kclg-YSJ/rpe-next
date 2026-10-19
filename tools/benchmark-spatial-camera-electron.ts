import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

interface CameraBenchmarkReport {
  results: Record<string, unknown>[]; version: string; viewport: [number, number];
  lines: number; notes: number; errors: string[];
}

const scratch=path.resolve('.local-tools/spatial-camera');fs.mkdirSync(scratch,{recursive:true});app.setPath('userData',path.join(scratch,'benchmark-profile-'+Date.now()));app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion');
app.whenReady().then(async()=>{
  const win=new BrowserWindow({width:1440,height:960,show:false,webPreferences:{backgroundThrottling:false}});win.webContents.on('will-prevent-unload',(e:{preventDefault():void})=>e.preventDefault());const errors:string[]=[];win.webContents.on('console-message',(d:{level:string;message:string})=>{if(d.level==='error'&&!/favicon/.test(d.message))errors.push(d.message);});
  try{
    await win.loadURL('http://127.0.0.1:4187');win.showInactive();
    const report=await win.webContents.executeJavaScript(`(async()=>{
      while(!window.rpenMods)await new Promise(r=>setTimeout(r,50));const {editor:e,manager}=window.rpenMods;await manager.ready;document.querySelector('#new').click();
      const {createChart,createLine,createEvent,createNote}=await import('./src/core/chart.ts');const chart=createChart();chart.judgeLineList=Array.from({length:48},(_,i)=>{const line=createLine();line.eventLayers[0].moveXEvents=[createEvent((i%8-3.5)*140)];line.eventLayers[0].moveYEvents=[createEvent((Math.floor(i/8)-2.5)*110)];line.eventLayers[0].rotateEvents=[createEvent(i%3*15)];line.eventLayers[0].speedEvents=[createEvent(2)];line.extended.scaleXEvents=[createEvent(.07)];line.notes=Array.from({length:180},(_,j)=>({...createNote([1,2,3,4][j%4],j/4+6,(j%7-3)*55,j/4+6.6),speed:j%11===0?0:1}));return line;});
      e.replace(chart,'camera-benchmark.json');e.setPreview(true,{autoplay:false});Object.assign(e.preview,{showGameUI:true,showHitEffects:true,effectsSince:-Infinity,lineNumbers:false,lineArrows:false,lineTint:false});await e.skin.load();await document.fonts.ready;
      const pic=document.createElement('canvas');pic.width=1350;pic.height=900;const c=pic.getContext('2d'),gradient=c.createLinearGradient(0,0,1350,900);gradient.addColorStop(0,'#142e46');gradient.addColorStop(1,'#3a112b');c.fillStyle=gradient;c.fillRect(0,0,1350,900);const image=new Image();image.src=pic.toDataURL();await image.decode();e.preview.images={background:image};
      await manager.enable('spatial-camera');const api=window.rpenMods.runtime.loaded.get('spatial-camera').api,model=await api.package.import('camera.ts'),options=await api.package.import('settings.ts');
      const projection=await api.package.import('projection.ts'),timing={};let countTextures=0,bytes=0,sourceSize=null;
      const measure=(target,key,label,probe)=>{const previous=target[key];if(typeof previous!=='function')return;target[key]=function(...args){const t=performance.now();try{probe?.call(this,args);return previous.apply(this,args);}finally{timing[label]=(timing[label]??0)+performance.now()-t;}};};
      measure(projection.CameraProjection.prototype,'render','projection');measure(projection.CameraProjection.prototype,'mapHits','picking');
      measure(model.PlaneCamera.prototype,'bounds','bounds');measure(e.preview,'drawScene','scene');
      for(const type of [WebGLRenderingContext,WebGL2RenderingContext]){measure(type.prototype,'texSubImage2D','upload',function(args){const source=args.at(-1);if(source?.width){countTextures++;bytes+=source.width*source.height*4;sourceSize=[source.width,source.height];}});measure(type.prototype,'drawArrays','gpuDraw');}
      const modes=[['flat',model.DEFAULT_POSE,false],['affine',{...model.DEFAULT_POSE,x:100,y:50,z:1300,roll:16},false],['perspective',model.orbitPose(28,-24,1000,12),false],['perspective-follow',model.orbitPose(28,-24,1000,12),true],['steep',model.orbitPose(55,-45,1500,12),false]];const results=[];
      for(const [name,pose,follow]of modes){const changes=model.AXES.map(a=>({type:'spatial-camera/'+a.type,column:a.id,events:[createEvent(pose[a.id],pose[a.id],0,100)]}));e.globalEvents.document.apply(changes,'Benchmark');e.commit('Benchmark option',options.withCameraFollow(e.chart,api.manifest,follow));
        const times=[];for(let i=0;i<12;i++){e.preview.draw(e.chart,e.tempo,6+i/60,0);await new Promise(requestAnimationFrame);}for(const k of Object.keys(timing))timing[k]=0;countTextures=bytes=0;sourceSize=null;
        const start=performance.now();for(let i=0;i<72;i++){await new Promise(requestAnimationFrame);const t=performance.now();e.preview.draw(e.chart,e.tempo,6+i/120,0);times.push(performance.now()-t);}const wall=performance.now()-start;times.sort((a,b)=>a-b);results.push({name,mean:times.reduce((a,b)=>a+b)/times.length,p50:times[36],p95:times[68],wallPerFrame:wall/72,stages:Object.fromEntries(Object.entries(timing).map(([k,v])=>[k,v/72])),textureUploads:countTextures/72,uploadMegabytes:bytes/72/1e6,sourceSize,visibleNotes:e.preview.noteHitAreas.length});
      }
      await manager.disable('spatial-camera');return{results,version:navigator.userAgent,viewport:[e.preview.canvas.width,e.preview.canvas.height],lines:48,notes:8640};
    })()`,true) as CameraBenchmarkReport;
    report.errors=errors;const name=process.env.RPE_CAMERA_BENCH_LABEL||'current';fs.writeFileSync(path.join(scratch,'benchmark-'+name+'.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(errors.length)process.exitCode=1;
  }catch(error){console.error(error);process.exitCode=1;}finally{win.destroy();app.exit((process.exitCode as number | undefined) || 0);}
});
