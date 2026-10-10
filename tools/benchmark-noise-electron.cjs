const { app, BrowserWindow } = require('electron');
const { readFile, writeFile, mkdir } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');

const root = join(__dirname, '..');
const scratch = join(root, '.local-tools/noise-benchmark');
app.setPath('userData', join(scratch, 'profile'));
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.whenReady().then(async () => {
  await mkdir(scratch, { recursive: true });
  const baseline = join(scratch, 'baseline.mjs');
  if (process.argv.includes('--snapshot')) {
    const source = await readFile(join(root, 'src/ui/noise-preview.mjs'), 'utf8');
    await writeFile(baseline, source.replaceAll("'../core/", "'" + pathToFileURL(join(root, 'src/core/')).href).replaceAll("'./", "'" + pathToFileURL(join(root, 'src/ui/')).href));
    console.log('Saved local noise renderer baseline.'); app.quit(); return;
  }
  const archive = process.argv[2];
  if (!archive) throw new Error('Usage: electron tools/benchmark-noise-electron.cjs <archive>');
  const window = new BrowserWindow({ width: 1280, height: 900, show: true, webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false } });
  await writeFile(join(scratch, 'index.html'), '<!doctype html><title>Noise rendering benchmark</title><body style="background:#222;color:white">Noise rendering benchmark</body>');
  await window.loadFile(join(scratch, 'index.html'));
  const result = await window.webContents.executeJavaScript(`(async () => {
    const { readFile } = require('node:fs/promises');
    const { readZip } = await import(${JSON.stringify(pathToFileURL(join(root, 'src/platform/archive.mjs')).href)});
    const { parseOfficialChart } = await import(${JSON.stringify(pathToFileURL(join(root, 'src/core/official-chart.mjs')).href)});
    const { TempoMap } = await import(${JSON.stringify(pathToFileURL(join(root, 'src/core/tempo.mjs')).href)});
    const { NoisePreview: Baseline } = await import(${JSON.stringify(pathToFileURL(baseline).href)});
    const { NoisePreview: Current } = await import(${JSON.stringify(pathToFileURL(join(root, 'src/ui/noise-preview.mjs')).href)});
    const files = await readZip(await readFile(${JSON.stringify(resolve(archive))}));
    const source = JSON.parse(new TextDecoder().decode([...files].find(([name]) => name.endsWith('.json'))[1]));
    const chart = parseOfficialChart(source); const tempo = new TempoMap(chart.BPMList);
    const width = 1000; const height = 660; const ratio = devicePixelRatio || 1;
    const canvas = document.createElement('canvas'); canvas.width = width * ratio; canvas.height = height * ratio;
    canvas.style.width = width + 'px'; canvas.style.height = height + 'px'; document.body.append(canvas);
    const context = canvas.getContext('2d'); context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const probe = document.createElement('canvas'); probe.width = probe.height = 1;
    const readback = probe.getContext('2d', { willReadFrequently: true });
    const flush = () => { readback.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, 1, 1); readback.getImageData(0, 0, 1, 1); };
    const results = [];
    for (const [label, Renderer] of [['baseline', Baseline], ['current', Current]]) {
      const renderer = new Renderer();
      for (const beat of [370, 415, 422]) {
        const durations = [];
        for (let batch = 0; batch < 4; batch++) {
          const start = performance.now();
          for (let frame = 0; frame < 12; frame++) {
            context.clearRect(0, 0, width, height);
            renderer.draw(context, chart, tempo, tempo.seconds(beat) + frame / 120, width, height, width / 1350);
          }
          flush(); if (batch) durations.push((performance.now() - start) / 12);
          await new Promise(resolve => setTimeout(resolve, 30));
        }
        results.push({ label, beat, count: renderer.guides.length, millisecondsPerFrame: durations.reduce((sum, value) => sum + value, 0) / durations.length });
      }
    }
    return { ratio, width, height, results };
  })()`);
  await writeFile(join(scratch, 'results.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2)); window.destroy(); app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
