const { app, BrowserWindow, protocol, net, session } = require('electron');
const { mkdir, writeFile, realpath } = require('node:fs/promises');
const { join, resolve, sep } = require('node:path');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');

app.setPath('userData', join(__dirname, '../.local-tools/text-lines-test-profile'));
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
protocol.registerSchemesAsPrivileged([{ scheme: 'rpe', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

app.whenReady().then(async () => {
  const root = await realpath(resolve(__dirname, '..'));
  const partition = 'text-lines-' + Date.now();
  session.fromPartition(partition).protocol.handle('rpe', async request => {
    try {
      const url = new URL(request.url); const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
      if (url.host !== 'app' || !['index.html', 'styles.css'].includes(relative) && !relative.startsWith('src/') && !relative.startsWith('assets/')) return new Response('Not found', { status: 404 });
      const path = await realpath(resolve(root, relative)); if (!path.startsWith(root + sep)) return new Response('Not found', { status: 404 });
      const response = await net.fetch(pathToFileURL(path).href); const headers = new Headers(response.headers);
      headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'");
      if (path.endsWith('.mjs')) headers.set('Content-Type', 'text/javascript; charset=utf-8');
      return new Response(response.body, { status: response.status, headers });
    } catch { return new Response('Not found', { status: 404 }); }
  });
  const window = new BrowserWindow({ width: 1440, height: 960, show: true, webPreferences: { partition, nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  const errors = []; window.webContents.on('console-message', event => { if (event.level === 'error' && !/favicon/.test(event.message)) errors.push(event.message); });
  const evaluate = async (callback, ...args) => {
    const result = await window.webContents.executeJavaScript('(async () => { try { return await (' + callback.toString() + ')(...' + JSON.stringify(args) + '); } catch (error) { return { testError: error.stack }; } })()', true);
    if (result?.testError) throw new Error(result.testError); return result;
  };
  const waitFor = async callback => { const deadline = Date.now() + 30000; while (!await evaluate(callback)) { if (Date.now() > deadline) throw new Error('Timed out: ' + callback + '\n' + await evaluate(() => document.querySelector('#text-lines-editor [role="status"]')?.textContent)); await pause(150); } };
  const click = async selector => {
    const point = await evaluate(selector => { const element = document.querySelector(selector); element.scrollIntoView({ block: 'nearest' }); const rect = element.getBoundingClientRect(); return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) }; }, selector);
    window.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 }); window.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 }); await pause(120);
  };
  const input = async (label, value) => evaluate((label, value) => { const element = document.querySelector('#text-lines-editor [aria-label="' + label + '"]'); element.value = value; element.dispatchEvent(new Event('input', { bubbles: true })); }, label, value);
  const ready = () => waitFor(() => Boolean(window.textTestPanel?.result));
  try {
    await window.loadURL('rpe://app/'); await pause(800);
    await evaluate(async () => {
      window.addEventListener('error', event => { window.textTestErrors ??= []; window.textTestErrors.push(event.message); });
      const { TextLinesPanel } = await import('./src/ui/text-lines.mjs'); const open = TextLinesPanel.prototype.open;
      TextLinesPanel.prototype.open = function (...args) { window.textTestPanel = this; return open.apply(this, args); };
      const { Preview } = await import('./src/ui/preview.mjs'); const draw = Preview.prototype.draw;
      Preview.prototype.draw = function (...args) { const result = draw.apply(this, args); if (window.textTestPanel?.previewChart === args[0] && this.visible) window.textTestPreview = { chart: args[0], count: this.noteHitAreas.length, seconds: args[2] }; return result; };
      const { createChart, createLine, createEvent } = await import('./src/core/chart.mjs'); const chart = createChart();
      chart.judgeLineList = Array.from({ length: 160 }, (_, index) => { const line = createLine('Text ' + index); line.eventLayers[0].alphaEvents = [createEvent(0)]; return line; });
      const transfer = new DataTransfer(); transfer.items.add(new File([JSON.stringify(chart)], 'text-test.json', { type: 'application/json' }));
      const input = document.querySelector('#file-input'); input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await waitFor(() => document.querySelector('#home').hidden); await click('#text-lines-tool');
    assert.equal(await evaluate(() => window.textTestPanel.controls.get('beat').value), '0:0/1');
    const defaults = await evaluate(() => {
      const panel = window.textTestPanel; const getContext = panel.getContext; const values = [];
      for (const beat of [2.5, -0.25]) {
        panel.getContext = () => { const context = getContext(); return { ...context, seconds: context.tempo.seconds(beat) }; };
        panel.open(); values.push(panel.controls.get('beat').value);
      }
      panel.getContext = getContext; panel.open(); return values;
    });
    assert.deepEqual(defaults, ['2:1/2', '-1:3/4']);
    assert.equal(await evaluate(() => window.textTestPanel.controls.get('coverage').value), '95');
    await input('参与线号 / 组名', '0:159'); await input('生成拍数', '4'); await input('拼合文本', 'RPE');
    const started = Date.now(); await ready();
    const initial = await evaluate(() => ({ count: window.textTestPanel.result.strokes.length, error: window.textTestPanel.result.error, passed: window.textTestPanel.result.passed, status: window.textTestPanel.message.textContent }));
    console.log('FIT: ' + JSON.stringify({ ...initial, milliseconds: Date.now() - started })); assert.equal(initial.passed, true); assert.ok(initial.count < 80, 'Skeleton fitting must not stack strokes to fill font weight');
    await waitFor(() => window.textTestPreview?.chart === window.textTestPanel.previewChart);
    assert.equal(await evaluate(() => window.textTestPreview.count), initial.count);
    assert.equal(await evaluate(() => window.textTestPreview.seconds), 2);
    assert.equal(await evaluate(() => Boolean(document.querySelector('[data-pane="text-lines"]'))), false);
    await input('骨架覆盖度下限 / %', '80.5'); await ready();
    assert.equal(await evaluate(() => window.textTestPanel.result.requiredCoverage), 0.805);
    assert.equal(await evaluate(() => window.textTestPanel.message.textContent.includes('要求 80.5%')), true);
    await input('骨架覆盖度下限 / %', '101');
    await waitFor(() => window.textTestPanel.message.textContent.includes('覆盖度下限须为'));
    assert.equal(await evaluate(() => window.textTestPanel.applyButton.disabled && !window.textTestPanel.previewChart), true);
    await input('骨架覆盖度下限 / %', '95'); await ready();
    console.log('PASS: initial beat handles zero, fractional and negative times; coverage threshold reaches worker and validates input.');
    await evaluate(() => { window.textTestOriginal = window.textTestPanel.getContext().session.chart; });
    await input('参与线号 / 组名', '0'); await input('容忍度 / %', '0'); await ready();
    assert.equal(await evaluate(() => window.textTestPanel.result.passed), false);
    assert.equal(await evaluate(() => window.textTestPanel.applyButton.disabled), true);
    assert.equal(await evaluate(() => window.textTestOriginal === window.textTestPanel.getContext().session.chart), true);
    console.log('PASS: insufficient line budget leaves chart untouched and disables apply.');
    await input('参与线号 / 组名', '0:159'); await input('容忍度 / %', '30'); await input('中心 X', '170'); await input('中心 X', '200'); await ready();
    assert.equal(await evaluate(() => window.textTestPanel.result.passed), true);
    await click('#text-lines-editor [aria-label="同时添加零速假音符"]'); await ready();
    await mkdir(join(root, 'docs/text-lines-qa'), { recursive: true });
    await evaluate(() => { document.querySelector('.text-lines-scroll').scrollTop = 0; }); await pause(150);
    await writeFile(join(root, 'docs/text-lines-qa/desktop-text-fit.png'), (await window.webContents.capturePage()).toPNG());
    await evaluate(() => { window.textTestExpected = window.textTestPanel.result.strokes; });
    await click('#text-lines-editor .text-lines-footer button:last-child');
    const applied = await evaluate(async () => {
      const panel = window.textTestPanel; const session = panel.getContext().session; const { SceneRuntime } = await import('./src/core/scene.mjs');
      const scene = new SceneRuntime(); scene.compile(session.chart, panel.getContext().tempo); const states = scene.sample(2);
      return { history: session.history.undoStack.length, count: session.chart.judgeLineList.reduce((sum, line) => sum + line.notes.length, 0), matches: window.textTestExpected.every((stroke, index) => Math.hypot(states[index].x - stroke.x, states[index].y - stroke.y) < 0.000001), active: panel.active };
    });
    assert.equal(applied.matches, true); assert.equal(applied.history, 1); assert.equal(applied.count, initial.count); assert.equal(applied.active, true);
    await click('#undo'); assert.equal(await evaluate(() => window.textTestOriginal === window.textTestPanel.getContext().session.chart), true);
    console.log('PASS: real desktop preview renders every fitted Drag at target time; apply and one undo verified.');
    assert.equal(await evaluate(() => document.querySelector('#text-lines-tool').textContent), '文字拼合');
    assert.equal(await evaluate(() => document.querySelector('#text-lines-editor .panel-title').textContent), '文字拼合');
    assert.deepEqual(await evaluate(() => [...window.textTestPanel.controls.get('noteType').options].map(option => [option.value, option.textContent])), [['4', 'Drag'], ['1', 'Tap'], ['3', 'Flick']]);
    for (const noteType of [1, 3]) {
      await input('音符种类', String(noteType)); await ready();
      assert.equal(await evaluate(() => window.textTestPanel.result.passed), true);
      assert.equal(await evaluate(() => window.textTestPanel.result.noteType), noteType);
      assert.equal(await evaluate(noteType => window.textTestPanel.previewChart.judgeLineList.filter(line => line.notes.length).every(line => line.notes[0].type === noteType), noteType), true);
      await click('#text-lines-editor .text-lines-footer button:last-child');
      assert.equal(await evaluate(noteType => { const notes = window.textTestPanel.getContext().session.chart.judgeLineList.flatMap(line => line.notes); return notes.length > 0 && notes.every(note => note.type === noteType && note.speed === 0); }, noteType), true);
      await click('#undo'); assert.equal(await evaluate(() => window.textTestOriginal === window.textTestPanel.getContext().session.chart), true);
    }
    await input('音符种类', '4'); await ready();
    console.log('PASS: Drag/Tap/Flick dropdown updates fitting, real preview, generated note types and undo.');
    await input('拼合文本', '中文 🎵'); await input('容忍度 / %', '60'); await ready();
    const unicode = await evaluate(() => ({ target: window.textTestPanel.result.target, count: window.textTestPanel.result.strokes.length, passed: window.textTestPanel.result.passed }));
    assert.ok(unicode.target > 0); assert.ok(unicode.count > 0); console.log('Unicode: ' + JSON.stringify(unicode));
    window.webContents.debugger.attach('1.3'); const document = await window.webContents.debugger.sendCommand('DOM.getDocument');
    const fontInput = await window.webContents.debugger.sendCommand('DOM.querySelector', { nodeId: document.root.nodeId, selector: '#text-lines-editor input[type="file"]' });
    await window.webContents.debugger.sendCommand('DOM.setFileInputFiles', { nodeId: fontInput.nodeId, files: [join(root, 'assets/rpe/fonts/cmdysj.ttf')] }); window.webContents.debugger.detach();
    await waitFor(() => window.textTestPanel.options.font.startsWith('TextFont')); await ready();
    assert.equal(await evaluate(() => window.textTestPanel.controls.get('font').selectedOptions[0].textContent), 'cmdysj.ttf');
    await input('生成拍数', 'nope'); await waitFor(() => !window.textTestPanel.worker && window.textTestPanel.applyButton.disabled && !window.textTestPanel.result);
    assert.equal(await evaluate(() => window.textTestPanel.previewChart), null);
    await click('#text-lines-editor .text-lines-footer button:first-child');
    assert.equal(await evaluate(() => window.textTestPanel.active), false);
    assert.deepEqual(await evaluate(() => window.textTestErrors ?? []), []); assert.deepEqual(errors, []);
    console.log('PASS: Unicode, local font import, invalid input, closing/cancellation; no renderer errors.');
    app.exit(0);
  } catch (error) { console.error(error.stack); console.error(errors); await mkdir(join(root, 'docs/text-lines-qa'), { recursive: true }); await writeFile(join(root, 'docs/text-lines-qa/failure.png'), (await window.webContents.capturePage()).toPNG()); app.exit(1); }
}).catch(error => { console.error(error); app.exit(1); });
