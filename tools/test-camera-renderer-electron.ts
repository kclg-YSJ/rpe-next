import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

interface CameraRendererResult {
  path: string; total: number; large: number; errorFraction: number; averageDelta: number;
  warmUploads: number; draws: number; fallback: string; cache: string; glError: number;
}

const scratch=path.resolve('.local-tools/spatial-camera');app.setPath('userData',path.join(scratch,'render-profile-'+Date.now()));
app.whenReady().then(async()=>{const win=new BrowserWindow({width:1200,height:800,show:false,webPreferences:{backgroundThrottling:false}}),errors:string[]=[];win.webContents.on('will-prevent-unload',(e:{preventDefault():void})=>e.preventDefault());win.webContents.on('console-message',(d:{level:string;message:string})=>{if(d.level==='error'&&!/favicon/.test(d.message))errors.push(d.message);});try{
await win.loadURL('http://127.0.0.1:4187');const result=await win.webContents.executeJavaScript(`(async()=>{
while(!window.rpenMods)await new Promise(r=>setTimeout(r,30));const h=window.rpenMods;await h.manager.ready;document.querySelector('#new').click();await h.manager.enable('spatial-camera');const api=h.runtime.loaded.get('spatial-camera').api,{CameraProjection}=await api.package.import('projection.ts'),{orbitPose,DEFAULT_POSE}=await api.package.import('camera.ts');
const frame={width:800,height:600,scale:.6,viewport:{left:0,top:33.3,width:800,height:533.4,scale:.6}},pose=orbitPose(25,-20,1000,13),a=new CameraProjection(()=>{}),b=new CameraProjection(()=>{}),canvas=document.createElement('canvas');canvas.width=800;canvas.height=600;const ctx=canvas.getContext('2d'),renderer={guides:[],noteHitAreas:[]};const image=document.createElement('canvas');image.width=96;image.height=64;const c=image.getContext('2d');c.fillStyle='#39db75';c.fillRect(0,0,48,64);c.fillStyle='#ec6237';c.fillRect(48,0,48,32);c.fillStyle='#2b82fc';c.fillRect(48,32,48,32);
const draw=(c,chart,tempo,seconds,line,raw)=>{c.save();c.translate(raw.width/2-raw.center.x,raw.height/2+raw.center.y);c.globalAlpha=.75;c.fillStyle='rgba(240,80,70,.7)';c.fillRect(-260,-160,180,180);c.translate(170,-80);c.rotate(.25);c.drawImage(image,0,0,96,64,-90,-60,180,120);c.restore();c.save();c.translate(raw.width/2-raw.center.x,raw.height/2+raw.center.y);c.fillStyle='#f2e6c9';c.font='38px sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText('Camera 3D',0,130);c.restore();};
const paint=(p,force=false,callback=draw,options={})=>{ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,800,600);ctx.save();ctx.rect(0,33.3,800,533.4);ctx.clip();p.render(ctx,renderer,{},null,1,0,frame,pose,'sharp',callback,{mapHits:false,forceCapture:force,...options});ctx.restore();return ctx.getImageData(0,0,800,600);};
const optimized=paint(a),path=a.lastPath,reference=paint(b,true);let changed=0,total=0,large=0;for(let i=0;i<optimized.data.length;i+=4){let delta=0;for(let k=0;k<4;k++)delta=Math.max(delta,Math.abs(optimized.data[i+k]-reference.data[i+k]));if(optimized.data[i+3]||reference.data[i+3]){total++;if(delta>25)large++;changed+=delta;}}
paint(a);const warmUploads=a.sprites.uploads,draws=a.sprites.drawCalls;
const repeated=(c,chart,tempo,seconds,line,raw)=>{const pattern=c.createPattern(image,'repeat');c.fillStyle=pattern;c.fillRect(raw.width/2-raw.center.x-100,raw.height/2+raw.center.y-100,200,200);};paint(a,false,repeated);const fallback=a.lastPath;
paint(a,true,draw,{cacheKey:'background'});paint(a,true,draw,{cacheKey:'background'});const cache=a.lastPath;
const data=new Uint8Array(4);const gl=a.gl;gl.finish();const glError=gl.getError();a.dispose();b.dispose();await h.manager.disable('spatial-camera');return{path,total,large,errorFraction:large/total,averageDelta:changed/total,warmUploads,draws,fallback,cache,glError};})()`,true) as CameraRendererResult;
assert.equal(result.path,'sprites');assert.ok(result.errorFraction<.08,JSON.stringify(result));assert.equal(result.warmUploads,0);assert.ok(result.draws<=2);assert.equal(result.fallback,'capture');assert.equal(result.cache,'cached');assert.equal(result.glError,0);assert.deepEqual(errors,[]);console.log(JSON.stringify(result,null,2));
}catch(e){console.error(e);process.exitCode=1;}finally{win.destroy();app.exit((process.exitCode as number | undefined) || 0);}});
