const { app, BrowserWindow } = require('electron');
const { readFile, mkdir, writeFile } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');

app.setPath('userData', join(__dirname, '../.local-tools/official-import-test-profile'));
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

app.whenReady().then(async () => {
  const archivePath = process.argv[2];
  if (!archivePath) throw new Error('Usage: electron tools/test-official-import-electron.cjs <local official archive>');
  const { readZip } = await import(pathToFileURL(join(__dirname, '../src/platform/archive.mjs')));
  const files = await readZip(await readFile(archivePath));
  const source = [...files].filter(([name]) => /\.json$/i.test(name)).map(([, bytes]) => JSON.parse(new TextDecoder().decode(bytes))).find(chart => chart.formatVersion === 3);
  assert.ok(source);
  const expectedNotes = source.judgeLineList.reduce((sum, line) => sum + (line.notesAbove?.length ?? 0) + (line.notesBelow?.length ?? 0), 0);
  const window = new BrowserWindow({ width: 1440, height: 960, show: true, webPreferences: { partition: 'official-import-' + Date.now(), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  const errors = [];
  window.webContents.on('console-message', event => { if (event.level === 'error' && !/favicon/.test(event.message)) errors.push(event.message); });
  const evaluate = async (callback, ...args) => {
    const result = await window.webContents.executeJavaScript('(async () => { try { return await (' + callback.toString() + ')(...' + JSON.stringify(args) + '); } catch (error) { return { testError: error.stack }; } })()', true);
    if (result?.testError) throw new Error(result.testError); return result;
  };
  const click = async selector => { await evaluate(selector => document.querySelector(selector).click(), selector); await pause(200); };
  const waitFor = async callback => { const deadline = Date.now() + 60000; while (!await evaluate(callback)) { if (Date.now() > deadline) throw new Error('Timed out: ' + callback); await pause(200); } };
  const screenshot = async name => { await mkdir(join(__dirname, '../docs/noise-qa'), { recursive: true }); await writeFile(join(__dirname, '../docs/noise-qa', name + '.png'), (await window.webContents.capturePage()).toPNG()); };
  try {
    await window.loadURL(process.env.RPE_TEST_URL ?? 'http://127.0.0.1:4173');
    await evaluate(async () => {
      window.addEventListener('error', event => { window.officialTestErrors ??= []; window.officialTestErrors.push(event.message); });
      const { NoiseAreaEditor } = await import('./src/ui/noise-area.mjs'); const draw = NoiseAreaEditor.prototype.draw;
      NoiseAreaEditor.prototype.draw = function (...args) { window.officialTestEditor = this; return draw.apply(this, args); };
      const { NoisePreview } = await import('./src/ui/noise-preview.mjs'); const render = NoisePreview.prototype.draw;
      NoisePreview.prototype.draw = function (...args) { const start = performance.now(); const result = render.apply(this, args); this.testSeconds = args[3]; window.officialTestDraws ??= []; window.officialTestDraws.push({ milliseconds: performance.now() - start, count: this.guides.length }); return result; };
    });
    window.webContents.debugger.attach('1.3');
    const document = await window.webContents.debugger.sendCommand('DOM.getDocument');
    const input = await window.webContents.debugger.sendCommand('DOM.querySelector', { nodeId: document.root.nodeId, selector: '#file-input' });
    const started = Date.now();
    await window.webContents.debugger.sendCommand('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [resolve(archivePath)] });
    window.webContents.debugger.detach();
    await waitFor(() => document.querySelector('#music-name').textContent.endsWith('.ogg'));
    console.log('PASS: existing file input imports official archive with audio in ' + (Date.now() - started) + 'ms.');
    await click('#noise-areas-tool'); await waitFor(() => Boolean(window.officialTestEditor?.active));
    const stats = await evaluate(() => { const editor = window.officialTestEditor; const chart = editor.chart; return { lines: chart.judgeLineList.length, notes: chart.judgeLineList.reduce((sum, line) => sum + line.notes.length, 0), areas: chart.blockAreaList.length, version: chart.META.RPEVersion, song: chart.META.song, background: chart.META.background }; });
    assert.equal(stats.lines, source.judgeLineList.length); assert.equal(stats.notes, expectedNotes); assert.equal(stats.areas, source.blockAreaList.length); assert.ok(stats.version >= 220); assert.ok(stats.song); assert.ok(stats.background);
    const listPerformance = await evaluate(() => {
      const editor = window.officialTestEditor; const start = performance.now();
      for (let index = 0; index < 20; index++) editor.render();
      return { millisecondsPerRender: (performance.now() - start) / 20, buttons: document.querySelectorAll('.noise-list button').length, total: editor.areas().length, height: editor.areaList.element.clientHeight };
    });
    assert.ok(listPerformance.height > 80); assert.ok(listPerformance.buttons < 40);
    if (stats.areas > 100) {
      await evaluate(() => { const list = document.querySelector('.noise-list'); list.focus(); });
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'End' }); window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'End' }); await pause(200);
      assert.equal(await evaluate(() => Number(document.activeElement.dataset.noiseIndex)), stats.areas - 1);
      const scrolled = await evaluate(() => document.querySelector('.noise-list').scrollTop);
      await click(`.noise-list [data-noise-index="${stats.areas - 1}"]`);
      assert.equal(await evaluate(() => window.officialTestEditor.selected), stats.areas - 1);
      await click('#noise-properties > button');
      assert.ok(Math.abs(await evaluate(() => document.querySelector('.noise-list').scrollTop) - scrolled) < 1);
      assert.ok(await evaluate(() => document.querySelectorAll('.noise-list button').length) < 40);
      await evaluate(() => { const list = document.querySelector('.noise-list'); list.scrollTop = 0; list.dispatchEvent(new Event('scroll')); });
    }
    console.log('PASS: virtual noise list bounds DOM size, keyboard reaches last row and selecting/returning preserves scroll. ' + JSON.stringify(listPerformance));
    const fallingBlock = await evaluate(async () => {
      const editor = window.officialTestEditor; const tempo = editor.context.tempo;
      const index = editor.areas().findIndex(area => Math.abs(tempo.beat(tempo.seconds(area.appearTime)) - 240) < 0.001 && Math.abs(tempo.beat(tempo.seconds(area.disappearTime)) - 251) < 0.001);
      if (index < 0) return null;
      const { NoiseAreaRuntime } = await import('./src/core/noise-areas.mjs'); const { SceneRuntime } = await import('./src/core/scene.mjs');
      const area = new NoiseAreaRuntime(editor.areas()[index], tempo); const scene = new SceneRuntime(); scene.compile(editor.chart, tempo);
      return { index, samples: [244.01, 246, 248, 250].map(beat => { const seconds = tempo.seconds(beat); return { beat, top: Math.max(...area.sample(seconds).points.map(point => point.y)), lineY: scene.sampler(seconds)(0).y }; }) };
    });
    if (fallingBlock) { for (const sample of fallingBlock.samples) assert.ok(Math.abs(sample.top - sample.lineY) < 0.002); console.log('PASS: falling noise edge matches simultaneously descending line. ' + JSON.stringify(fallingBlock)); }
    if (stats.areas > 14121 && Math.abs(source.blockAreaList[14121].appearTime - 114.0136) < 0.001) {
      const orbit = await evaluate(async () => {
        const editor = window.officialTestEditor; const { NoiseAreaRuntime } = await import('./src/core/noise-areas.mjs');
        const runtime = new NoiseAreaRuntime(editor.areas()[14121], editor.context.tempo);
        return [420, 422, 424, 426].map(beat => { const state = runtime.sample(editor.context.tempo.seconds(beat)); return { beat, center: state.center, anchor: state.anchorR, radius: Math.hypot(state.center.x, state.center.y - 450) }; });
      });
      for (const sample of orbit) { assert.ok(Math.abs(sample.radius - 180) < 0.001); assert.ok(Math.abs(sample.anchor.y - 180) < 0.001); }
      console.log('PASS: noise 14121 orbits (0,450), radius 180, using the outgoing anchor. ' + JSON.stringify(orbit));
      await evaluate(() => { const input = document.querySelector('#autoplay-view'); input.checked = false; input.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#seek-beat').value = '370'; });
      await click('#seek'); await click('#view-toggle');
      const inversion = await evaluate(() => {
        const editor = window.officialTestEditor; const canvas = editor.context.preview.noisePreview.layers.get('composite');
        const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let active = 0; let disabled = 0;
        for (let index = 3; index < pixels.length; index += 4) { if (Math.abs(pixels[index] - 170) <= 1) active++; if (Math.abs(pixels[index] - 102) <= 1) disabled++; }
        return { active, disabled, compatibility: editor.chart.noiseAreaOptions.ignoreTripleInversion };
      });
      assert.equal(inversion.compatibility, true); assert.ok(inversion.active > 1000); assert.ok(inversion.disabled > 1000);
      await screenshot('official-noise-370-state-layers');
      await evaluate(() => { document.querySelector('#seek-beat').value = '422'; }); await click('#seek'); await screenshot('official-noise-14121-orbit');
      await click('#close-preview');
      console.log('PASS: beat 370 contains both active blocks and disabled background. ' + JSON.stringify(inversion));
    }
    await evaluate(() => { const editor = window.officialTestEditor; const tempo = editor.context.tempo; document.querySelector('#seek-beat').value = String(tempo.beat(113)); }); await click('#seek');
    await waitFor(() => Number.parseFloat(document.querySelector('#clock').textContent) >= 112.9);
    assert.ok(await evaluate(() => window.officialTestEditor.rects.some(rect => !rect.type)));
    await evaluate(() => { const editor = window.officialTestEditor; const visible = editor.rects.find(rect => !rect.type); editor.select(visible.index); });
    await pause(200);
    const selected = await evaluate(() => window.officialTestEditor.selected);
    const originalName = await evaluate(() => window.officialTestEditor.area().Name);
    await evaluate(() => { const input = document.querySelector('#noise-properties [aria-label="名称"]'); input.value = '导入编辑测试'; input.dispatchEvent(new Event('input')); input.dispatchEvent(new Event('change')); });
    assert.equal(await evaluate(() => window.officialTestEditor.area().Name), '导入编辑测试');
    await click('#undo'); assert.equal(await evaluate(() => window.officialTestEditor.areas()[window.officialTestEditor.selected].Name), originalName);
    const restored = await evaluate(async () => {
      const editor = window.officialTestEditor; const { serializeChart, parseChart } = await import('./src/core/chart.mjs');
      const chart = parseChart(serializeChart(editor.chart));
      return { areas: chart.blockAreaList.length, selectedArea: chart.blockAreaList[editor.selected], savedSourceAreas: chart.rpeNextLegacySource.document.blockAreaList.length };
    });
    assert.equal(restored.areas, stats.areas); assert.equal(restored.savedSourceAreas, stats.areas); assert.deepEqual(restored.selectedArea, await evaluate(() => window.officialTestEditor.area()));
    console.log('PASS: imported noise ' + selected + ' can be edited and undone; native JSON round-trip retains all noise and original official source.');
    await screenshot('official-noise-editor');
    await click('#view-toggle'); await pause(300); await click('#play');
    const preview = await evaluate(() => {
      const editor = window.officialTestEditor; const renderer = editor.context.preview; const seconds = renderer.noisePreview.testSeconds; const tempo = editor.context.tempo;
      const expected = editor.areas().flatMap((area, index) => seconds >= tempo.seconds(area.appearTime) && seconds < tempo.seconds(area.disappearTime) ? [index] : []);
      const actual = renderer.noisePreview.guides.map(entry => entry.index);
      return { seconds, expected: expected.sort((first, second) => first - second), actual: actual.sort((first, second) => first - second), draws: window.officialTestDraws.slice(-10) };
    });
    assert.deepEqual(preview.actual, preview.expected); assert.ok(preview.actual.length > 0);
    await screenshot('official-noise-preview');
    const runtimeErrors = await evaluate(() => window.officialTestErrors ?? []); assert.deepEqual(runtimeErrors, []); assert.deepEqual(errors, []);
    console.log('PASS: real editor/preview renders converted objects and active noise lifetime index correctly. ' + JSON.stringify({ stats, visibleAreas: preview.actual.length, draws: preview.draws }));
    window.destroy(); app.exit(0);
  } catch (error) { console.error(error.stack); console.error(errors); await screenshot('official-import-failure').catch(() => {}); window.destroy(); app.exit(1); }
}).catch(error => { console.error(error); app.exit(1); });
