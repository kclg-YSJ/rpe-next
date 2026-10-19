// Wrapped in a block so this CommonJS script keeps its own scope; without a module
// boundary every tool's top-level `app`/`fs` would merge into one global scope.
{
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const scratch = path.join(root, '.local-tools/event-editor-benchmark');
app.setPath('userData', path.join(scratch, 'profile-' + Date.now()));
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.whenReady().then(async () => {
  await fs.mkdir(scratch, { recursive: true });
  if (process.argv.includes('--snapshot')) {
    for (const name of ['timeline', 'noise-area', 'event-curve']) {
      const source = await fs.readFile(path.join(root, 'src/ui', name + '.ts'), 'utf8');
      const rewritten = source.replace(/(from\s+['"])(\.\.?\/[^'"]+)(['"])/g, (match: string, prefix: string, relative: string, suffix: string) => {
        const target = ['timeline.ts', 'event-curve.ts'].includes(relative.slice(2)) ? path.join(scratch, relative.slice(2)) : path.resolve(root, 'src/ui', relative);
        return prefix + pathToFileURL(target).href + suffix;
      });
      await fs.writeFile(path.join(scratch, name + '.ts'), rewritten);
    }
    console.log('Saved local event renderer baseline.'); app.quit(); return;
  }
  await fs.writeFile(path.join(scratch, 'index.html'), '<!doctype html><title>Event editor benchmark</title><style>body{background:#242424;color:white}canvas{display:block;width:1000px;height:650px}</style>');
  const win = new BrowserWindow({ width: 1100, height: 760, show: false, webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false } });
  await win.loadFile(path.join(scratch, 'index.html'));
  const result = await win.webContents.executeJavaScript(`(async () => {
    const root = ${JSON.stringify(pathToFileURL(root + path.sep).href)};
    const { createChart, createLine, createEvent } = await import(root + 'src/core/chart.ts');
    const { createNoiseArea, createNoiseEvent } = await import(root + 'src/core/noise-areas.ts');
    const { EditorSession } = await import(root + 'src/application/session.ts');
    const { TempoMap } = await import(root + 'src/core/tempo.ts');
    const results = [];
    const flush = canvas => canvas.getContext('2d').getImageData(0, 0, 1, 1);
    const makeCanvas = () => { const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 650; document.body.append(canvas); return canvas; };
    for (const label of ['baseline', 'current']) {
      const base = label === 'baseline' ? ${JSON.stringify(pathToFileURL(scratch + path.sep).href)} : root + 'src/ui/';
      const { Timeline } = await import(base + 'timeline.ts');
      const { NoiseAreaEditor } = await import(base + 'noise-area.ts');
      for (const curve of ['linear', 'bezier']) {
        const types = ['moveXEvents', 'moveYEvents', 'rotateEvents', 'alphaEvents', 'speedEvents'];
        const events = Array.from({ length: 1000 }, (_, i) => ({ ...createEvent(Math.sin(i / 30) * 100, Math.sin((i+1) / 30) * 100, i / 250, (i+1) / 250), ...(curve === 'bezier' ? { bezier: 1, bezierPoints: [0.2, 0.8, 0.6, 0.1] } : {}) }));
        const chart = createChart(); for (const type of types) chart.judgeLineList[0].eventLayers[0][type] = events;
        chart.judgeLineList.push(...Array.from({length:7}, () => { const line = createLine(); for (const type of types) line.eventLayers[0][type] = events; return line; }));
        const session = new EditorSession(chart); const notes = makeCanvas(); const canvas = makeCanvas();
        const timeline = new Timeline(notes, canvas, () => session, () => {}, () => {});
        timeline.scale = 250; timeline.judgementOffset = 92; timeline.seamlessEvents = true; timeline.syncMultiLineChrome = () => {};
        for (const mode of ['single', 'multi', 'noise']) {
          session.multiLineEnabled = mode === 'multi'; session.multiLineMode = 'events'; session.multiLineIndices = [0,1,2,3,4,5,6,7]; timeline.multiLineEventWidth = 800; timeline.multiLineEventWidthExplicit = true;
          const area = createNoiseArea(0,4); for (const type of ['moveXEvents', 'moveYEvents', 'rotateEvents', 'scaleXEvents', 'scaleYEvents']) area[type] = events;
          const noise = Object.create(NoiseAreaEditor.prototype); const layout = {width:1000,height:650,split:400,eventLeft:430,eventWidth:90};
          const noiseChart = {...chart,blockAreaList:[area]}; const noiseTempo = new TempoMap(chart.BPMList);
          noise.getContext = () => ({timeline, tempo:noiseTempo, session: {chart:noiseChart}});
          noise.layout = () => layout; noise.y = beat => 558 - (beat - timeline.origin) * 125; noise.beatAt = y => (558-y)/125 + timeline.origin;
          noise.selected = 0; noise.selection = new Set(); noise.areaX = () => 100; noise.canvas = canvas; noise.drawDistribution = noise.drawOwner = () => {};
          const ctx = canvas.getContext('2d');
          const draw = () => { if (mode === 'single') timeline.drawEvents(timeline.origin); else {ctx.clearRect(0,0,1000,650); if (mode === 'multi') timeline.drawMultiLineEvents(timeline.origin); else noise.drawTimeline(ctx,1000,650,layout);} };
          for (let i=0;i<3;i++) draw(); flush(canvas);
          const batches = [];
          for (let batch=0;batch<4;batch++) { const start=performance.now(); for(let frame=0;frame<4;frame++){timeline.origin=frame/480;draw();} flush(canvas); batches.push((performance.now()-start)/4); await new Promise(resolve => setTimeout(resolve,30)); }
          const rects = mode === 'noise' ? noise.rects.filter(rect=>rect.type) : timeline.eventRects;
          results.push({label,curve,mode,visibleEvents:rects.filter(rect=>rect.x<=1000 && rect.x+rect.width>=0).length,processedEvents:rects.length,millisecondsPerFrame:batches.sort((a,b)=>a-b).slice(1,3).reduce((a,b)=>a+b)/2});
        }
        canvas.remove(); notes.remove();
      }
    }
    return {ratio:devicePixelRatio,results};
  })()`);
  console.log(JSON.stringify(result,null,2)); await fs.writeFile(path.join(scratch,'results.json'),JSON.stringify(result,null,2));
  win.destroy(); app.exit(0);
}).catch((error: unknown) => {console.error(error);app.exit(1);});
}
