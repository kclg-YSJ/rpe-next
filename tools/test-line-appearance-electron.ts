// @ts-nocheck - Electron smoke script ported from the JavaScript release tooling.
import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const scratch = path.resolve('.local-tools/line-appearance'); fs.mkdirSync(scratch, { recursive: true });
app.setPath('userData', path.join(scratch, 'profile-' + Date.now()));
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1440, height: 960, show: false, webPreferences: { backgroundThrottling: false } }), errors = [];
  win.webContents.on('will-prevent-unload', event => event.preventDefault());
  win.webContents.on('console-message', detail => { if (detail.level === 'error' && !/favicon/.test(detail.message)) errors.push(detail.message); });
  try {
    await win.loadURL('http://127.0.0.1:4187/?mods=off');
    const result = await win.webContents.executeJavaScript(`(async () => {
      const check = (value, message) => { if (!value) throw Error(message); };
      const until = async condition => { const end = performance.now() + 10000; while (!await condition()) { if (performance.now() > end) throw Error('Condition timed out: ' + condition); await new Promise(resolve => setTimeout(resolve, 20)); } };
      await until(() => window.rpenMods); const e = window.rpenMods.editor; await e.manager?.ready;
      await e.skin.load(); await document.fonts.ready;
      const { createChart, createNote, createEvent, serializeChart, parseChart } = await import('./src/core/chart.ts');
      const { TempoMap } = await import('./src/core/tempo.ts');
      const { Preview } = await import('./src/ui/preview.ts'), { ResourceNoteSkin } = await import('./src/ui/resource-note-skin.ts');
      const { RpeSkin } = await import('./src/ui/skin.ts'), { parseNoteSkin, NOTE_SKIN_IMAGES } = await import('./src/core/note-skin.ts');
      const checks = [];
      document.querySelector('#new').click(); document.querySelector('[data-pane=lines]').click();
      const field = name => document.querySelector('#line-panel input[aria-label="' + name + '"]');
      check(field('锚点 X').value === '0.5' && field('锚点 Y').value === '0.5', 'Default anchors absent');
      field('BPM 倍率').value = '2'; field('锚点 X').value = '-0.25'; field('锚点 Y').value = '1.25';
      document.querySelector('#line-panel .primary.wide-button').click();
      check(e.chart.judgeLineList[0].bpmfactor === .5 && e.chart.judgeLineList[0].anchor.join(',') === '-0.25,1.25', 'Panel apply did not preserve reciprocal or anchor');
      e.seek(1, { music: true }); await until(() => document.querySelector('#bpm-display').textContent === '240.00 BPM');
      check(field('BPM 倍率').value === '2', 'Multiplier changed when redisplaying');
      document.querySelector('#undo').click(); check(e.chart.judgeLineList[0].bpmfactor === 1, 'Line attributes not undoable');
      document.querySelector('#redo').click(); check(e.chart.judgeLineList[0].bpmfactor === .5, 'Line attributes not redoable');
      const serialized = parseChart(serializeChart(e.chart)); check(serialized.judgeLineList[0].bpmfactor === .5 && serialized.judgeLineList[0].anchor[0] === -.25, 'Chart roundtrip changed raw factors');
      checks.push('line panel anchors and reciprocal BPM apply, redisplay, undo/redo, effective BPM and JSON roundtrip');
      const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 600; const c = canvas.getContext('2d');
      const bounds = () => { const data = c.getImageData(0,0,800,600).data; let l=800,r=-1,t=600,b=-1; for(let y=0;y<600;y++)for(let x=0;x<800;x++)if(data[(y*800+x)*4+3]>10){l=Math.min(l,x);r=Math.max(r,x);t=Math.min(t,y);b=Math.max(b,y);}return {x:l,y:t,width:r-l+1,height:b-t+1}; };
      const draw = fn => { c.setTransform(1,0,0,1,0,0); c.clearRect(0,0,800,600); c.save(); c.translate(400,300); fn(); c.restore(); return bounds(); };
      const compareNotes = (skin, name) => {
        for (const type of [1,3,4]) for (const highlight of [false,true]) {
          const a = draw(() => skin.head(c,type,0,0,80,highlight,undefined,0,160)), b = draw(() => skin.head(c,type,0,0,240,highlight,undefined,0,160));
          check(Math.abs(a.height-b.height)<=1 && b.width>a.width*2.5, name+' head height changed '+JSON.stringify({type,a,b}));
        }
        for (const highlight of [false,true]) {
          const a = draw(() => skin.hold(c,0,100,-100,80,highlight,true,undefined,160)), b = draw(() => skin.hold(c,0,100,-100,240,highlight,true,undefined,160));
          check(Math.abs(a.height-b.height)<=1 && b.width>a.width*2.5, name+' Hold cap height changed');
        }
      };
      compareNotes(e.skin,'default'); checks.push('default Tap/Drag/Flick and Hold, including highlights, widen without increasing height in actual pixels');
      const asset = document.createElement('canvas'); asset.width=160;asset.height=160;const a=asset.getContext('2d');a.fillStyle='#ff7f00';a.fillRect(0,0,160,160);
      const png=new Uint8Array(await(await new Promise(resolve=>asset.toBlob(resolve))).arrayBuffer());
      const files=new Map([['info.yml',new TextEncoder().encode('name: Appearance Test\\nauthor: Local\\nhitFx: [1,1]\\nholdAtlas: [16,16]\\nholdAtlasMH: [16,16]\\n')],...NOTE_SKIN_IMAGES.map(name=>[name,png])]);
      const record=parseNoteSkin(files,'pack-123456789012345678901234'), pack=await ResourceNoteSkin.prepare(record,(_name,picture)=>picture), imported=new RpeSkin(()=>{}); imported.setResourcePack(pack);
      compareNotes(imported,'imported'); checks.push('imported resource pack heads and Hold caps obey separate width and height scales');
      pack.info={...pack.info,holdCompact:true,holdRepeat:true};
      const aHold=draw(()=>imported.hold(c,0,100,-100,80,false,true,undefined,160)), bHold=draw(()=>imported.hold(c,0,100,-100,240,false,true,undefined,160));
      check(aHold.height===bHold.height,'Repeated Hold body stretched vertically');
      const preview = new Preview(canvas); preview.lineScale=1; preview.skin={tinted:()=>asset,tintedSource:(_name,picture)=>picture}; preview.images={images:new Map([['test.png',asset]])};
      const state={scaleX:1,scaleY:1,alpha:255,color:[255,255,255],text:'Anchor'};
      const line=createChart().judgeLineList[0];
      for(const texture of ['line.png','test.png','text']) {
        const source=texture==='text'?{...line,extended:{textEvents:[createEvent('Anchor')]}}:{...line,Texture:texture};
        const centered=draw(()=>preview.drawLine(c,source,state,.1));
        const shifted=draw(()=>preview.drawLine(c,{...source,anchor:[0,1]},state,.1));
        check(shifted.x>=399 && shifted.y>=299,texture+' top-left anchor not at line position '+JSON.stringify(shifted));
        check(Math.abs(shifted.x-centered.x-centered.width/2)<=3 && Math.abs(shifted.y-centered.y-centered.height/2)<=3,texture+' anchor translation incorrect');
      }
      const rotated=draw(()=>{c.rotate(Math.PI/2);preview.drawLine(c,{...line,Texture:'test.png',anchor:[0,1]},{...state,scaleX:1.5,scaleY:1},1);});
      check(Math.abs(rotated.x-240)<=1&&Math.abs(rotated.y-300)<=1&&Math.abs(rotated.width-160)<=1&&Math.abs(rotated.height-240)<=1,'Anchor rotation scale pixel mismatch '+JSON.stringify(rotated));
      checks.push('default line, image and text anchors translate actual pixels and rotate/scale around the line position');
      const chart=createChart();chart.judgeLineList[0].notes=[{...createNote(1,4,-200),speed:0,size:.5},{...createNote(1,4,200),speed:0,size:2}];
      const probeCanvas=document.createElement('canvas');probeCanvas.width=1350;probeCanvas.height=900;probeCanvas.getBoundingClientRect=()=>({left:0,top:0,width:1350,height:900});
      const probe=new Preview(probeCanvas);Object.assign(probe,{visible:true,applyShaders:false,showHitEffects:false,lineNumbers:false,lineArrows:false,lineTint:false,skin:e.skin,collisionGeometry:true});
      probe.draw(chart,new TempoMap(chart.BPMList),0,0); const hits=probe.noteHitAreas;
      check(hits.length===2 && hits[0].collisionHeight===hits[1].collisionHeight && hits[1].collisionWidth===hits[0].collisionWidth*4,'Preview collision geometry no longer matches visible size');
      const skin=e.skin, original=skin.head, calls=[];skin.head=function(...args){calls.push(args);return original.apply(this,args);};
      try{e.replace(chart);e.timeline.origin=4;e.timeline.draw(4);check(calls.length===2&&calls[0][8]===calls[1][8],'Single-line timeline height scale '+JSON.stringify(calls.map(args=>args.slice(2))));e.session.setMultiLineEnabled(true);e.timeline.origin=4;e.timeline.draw(4);check(calls.slice(-2)[0][8]===calls.slice(-2)[1][8],'Multi-line timeline height scale');}finally{skin.head=original;}
      checks.push('preview collision geometry, single-line and multi-line editor share width-only size behavior');
      document.querySelector('[data-pane=lines]').click();field('BPM 倍率').value='0';document.querySelector('#line-panel .primary.wide-button').click();check(e.chart.judgeLineList[0].bpmfactor===1,'Zero multiplier was accepted');
      pack.dispose();return{checks};
    })()`, true);
    assert.deepEqual(errors, []); console.log(JSON.stringify({ ...result, errors }, null, 2));
    fs.writeFileSync(path.join(scratch, 'result.png'), (await win.webContents.capturePage()).toPNG());
  } catch (error) { console.error(error.stack, errors); process.exitCode = 1; }
  finally { win.destroy(); app.exit(process.exitCode || 0); }
}).catch(error => { console.error(error.stack); app.exit(1); });
