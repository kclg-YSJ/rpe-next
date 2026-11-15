const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..'), scratch = path.join(root, '.local-tools/event-easing');
app.setPath('userData', path.join(scratch, 'profile-' + Date.now()));
app.commandLine.appendSwitch('force-device-scale-factor', '2');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

app.whenReady().then(async () => {
  await fs.mkdir(scratch, { recursive: true });
  await fs.writeFile(path.join(scratch, 'index.html'), `<!doctype html><meta charset="utf-8"><base href="${pathToFileURL(root + path.sep).href}"><script type="importmap">{"imports":{"@rpen/":"./src/"}}</script><link rel="stylesheet" href="styles.css"><link rel="stylesheet" href="assets/mods/rpe-classic-layout/layout.css"><style>body{display:block;margin:0;overflow:auto}.inspector{width:380px;margin:16px}#event-properties{padding:1px 0}</style><main class="inspector"><section data-panel="notes" hidden><form id="properties"></form></section><section data-panel="events"><small id="event-selection-count"></small><form id="event-properties"></form></section></main>`);
  const win = new BrowserWindow({ width: 920, height: 1000, show: false, webPreferences: { backgroundThrottling: false, offscreen: true } });
  const errors = [], checks = [];
  win.webContents.on('console-message', detail => { if (detail.level === 'error') errors.push(detail.message); });
  const run = (fn, ...args) => win.webContents.executeJavaScript('(' + fn.toString() + ')(...' + JSON.stringify(args) + ')', true);
  const capture = async name => {
    if (!name.endsWith('popup')) await run(() => document.querySelector('.event-easing-editor')?.scrollIntoView({ block: 'center' }));
    await run(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await fs.writeFile(path.join(scratch, name + '.png'), (await win.webContents.capturePage()).toPNG());
  };
  const click = async selector => { await run(selector => document.querySelector(selector).click(), selector); await wait(40); };
  const event = () => run(() => session.line.eventLayers[0].moveXEvents[0]);
  try {
    await win.loadFile(path.join(scratch, 'index.html'));
    await run(async () => {
      const { EditorSession } = await import('./src/application/session.mjs');
      const { createChart, createEvent } = await import('./src/core/chart.mjs');
      const { TempoMap } = await import('./src/core/tempo.mjs');
      const { renderEventInspector } = await import('./src/ui/event-inspector.mjs');
      const { EventSampler } = await import('./src/ui/event-sampler.mjs');
      const chart = createChart(); chart.judgeLineList[0].eventLayers[0].moveXEvents = [{ ...createEvent(20, 120, 0, 4), easingType: 5 }];
      window.session = new EditorSession(chart); session.eventSelection = new Set(['moveXEvents:0']); session.focus = 'events';
      const tempo = new TempoMap(chart.BPMList);
      window.sampler = Object.assign(Object.create(EventSampler.prototype), { getContext: () => ({ session, tempo }), syncChrome() {}, invalidate() {} });
      window.render = () => renderEventInspector(session, tempo, () => 0, error => { throw error; }, () => {}, sampler);
      session.addEventListener('change', render); render();
      window.bitmap = () => document.querySelector('.event-easing-panel .easing-preview').toDataURL();
      window.scrub = (key, delta) => {
        const label = document.querySelector(`label[data-rpen-field="${key}"]`);
        label.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, isPrimary: true, pointerId: 1, clientX: 100, clientY: 40 }));
        window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, pointerType: 'touch', clientX: 100 + delta, clientY: 40 }));
      };
    });
    await wait(100);
    assert.equal(await run(() => document.querySelectorAll('[data-easing-mode]').length), 3);
    assert.equal(await run(() => document.querySelector('.event-easing-editor details')), null);
    assert.equal(await run(() => {
      const left = document.querySelector('label[data-rpen-field="easingLeft"]').getBoundingClientRect(), right = document.querySelector('label[data-rpen-field="easingRight"]').getBoundingClientRect();
      return Math.abs(left.top - right.top) < 1 && left.right <= right.left;
    }), true);
    const dimensions = () => run(() => [...document.querySelectorAll('.event-easing-panel canvas')].map(canvas => {
      const r = canvas.getBoundingClientRect(), s = getComputedStyle(canvas), width = r.width - parseFloat(s.borderLeftWidth) - parseFloat(s.borderRightWidth), height = r.height - parseFloat(s.borderTopWidth) - parseFloat(s.borderBottomWidth);
      return { width, height, bitmapWidth: canvas.width, bitmapHeight: canvas.height, ratio: devicePixelRatio };
    }));
    const checkDimensions = async () => {
      for (const size of await dimensions()) {
        assert.ok(Math.abs(size.width / size.height - 2.6) < .01, JSON.stringify(size));
        assert.ok(Math.abs(size.bitmapWidth - size.width * size.ratio) <= 2, JSON.stringify(size));
        assert.ok(Math.abs(size.bitmapHeight - size.height * size.ratio) <= 2, JSON.stringify(size));
      }
    };
    await checkDimensions(); await capture('standard');
    await click('.event-easing-trigger');
    assert.equal(await run(() => document.querySelector('.event-easing-popup').matches(':popover-open')), true);
    assert.equal(await run(() => document.querySelectorAll('.event-easing-popup [data-easing]').length), 29);
    const checkGallery = async () => {
      const layout = await run(() => {
        const box = id => { const r = document.querySelector(`[data-easing="${id}"]`).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width }; };
        return { columns: getComputedStyle(document.querySelector('.easing-gallery-grouped')).gridTemplateColumns.split(' ').length, sine: [3, 2, 6].map(box), quad: [5, 4, 7].map(box), circ: box(22), overflow: document.querySelector('.event-easing-popup').scrollWidth > document.querySelector('.event-easing-popup').clientWidth };
      });
      assert.equal(layout.columns, 3); assert.equal(layout.overflow, false);
      assert.ok(layout.sine[0].x < layout.sine[1].x && layout.sine[1].x < layout.sine[2].x);
      assert.ok(layout.sine.every(box => box.y === layout.sine[0].y));
      assert.deepEqual(layout.sine.map(box => box.x), layout.quad.map(box => box.x));
      assert.equal(layout.circ.x, layout.sine[2].x);
    };
    await checkGallery();
    const navigate = async (id, key) => run((id, key) => {
      const button = document.querySelector(`[data-easing="${id}"]`); button.focus(); button.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); return document.activeElement.dataset.easing;
    }, id, key);
    assert.equal(await navigate(6, 'ArrowDown'), '7');
    assert.equal(await navigate(13, 'ArrowDown'), '22'); // Skip unavailable Quint/Expo InOut entries.
    assert.equal(await navigate(22, 'ArrowUp'), '13');
    assert.equal(await navigate(2, 'ArrowUp'), '1');
    await run(() => document.querySelector('[data-easing="5"]').focus({ preventScroll: true }));
    await capture('popup');
    await click('.event-easing-popup [data-easing="8"]'); assert.equal((await event()).easingType, 8);
    await click('.event-easing-trigger');
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' }); await wait(50);
    assert.equal(await run(() => document.querySelector('.event-easing-popup').matches(':popover-open')), false);
    checks.push('exclusive mode tabs, inline boundary fields, graphical popup selection and Escape');
    for (const [key, delta, expected] of [['easingLeft', 30, .3], ['easingRight', -20, .8]]) {
      const before = await run(() => ({ bitmap: bitmap(), history: session.history.undoStack.length }));
      await run((key, delta) => scrub(key, delta), key, delta);
      assert.ok(await run(() => bitmap()) !== before.bitmap, key + ' redraws during dragging');
      assert.equal(await run(key => sampler.draftChart.judgeLineList[0].eventLayers[0].moveXEvents[0][key], key), expected);
      await run(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
      await wait(40);
      assert.ok(await run(() => bitmap()) === before.bitmap, key + ' restores the preview after cancellation');
      assert.equal(await run(() => session.history.undoStack.length), before.history);
      await run((key, delta) => { scrub(key, delta); window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 })); }, key, delta);
      assert.equal((await event())[key], expected); assert.equal(await run(() => session.history.undoStack.length), before.history + 1);
      await run(() => session.travel('undo'));
      await wait(40);
    }
    checks.push('real sampler boundary preview, cancel, single commit and undo');
    await click('[data-easing-mode="custom"]'); assert.ok((await event()).customEasing);
    assert.equal(await run(() => document.querySelector('.custom-easing-group').tagName), 'DIV');
    assert.equal(await run(() => document.querySelector('label[data-rpen-field="easingLeft"]')), null);
    await run(async () => {
      const { saveCurveLibrary } = await import('./src/platform/animation-curve-library.mjs');
      saveCurveLibrary([{ id: 'easing-test', name: 'Template test', curve: { version: 1, name: 'Template test', nodes: [{ x: 0, y: 0, mode: 'linear' }, { x: .5, y: .8, mode: 'linear' }, { x: 1, y: 1, mode: 'linear' }] } }]);
      document.dispatchEvent(new Event('rpen-curve-library-changed'));
    });
    await click('.custom-easing-choice'); assert.equal((await event()).customEasing.curve.name, 'Template test');
    await capture('custom');
    await click('.custom-easing-group .wide-button');
    assert.equal(await run(() => !!document.querySelector('#animation-curve-editor')), true);
    await run(async () => (await import('./src/ui/custom-easing-controls.mjs')).closeAnimationCurveEditor());
    checks.push('inline template library refresh, template application and animation curve editor');
    await click('[data-easing-mode="bezier"]'); assert.equal((await event()).bezier, 1); assert.ok(!(await event()).customEasing);
    assert.equal(await run(() => document.querySelectorAll('.event-easing-panel canvas').length), 1);
    await checkDimensions(); await capture('bezier');
    for (const width of [280, 480]) {
      await run(width => { document.querySelector('.inspector').style.width = width + 'px'; }, width); await wait(60); await checkDimensions();
    }
    await win.webContents.setZoomFactor(1.25); await wait(80); await checkDimensions();
    await win.webContents.setZoomFactor(1); await wait(80);
    // Use real pointer capture to exercise the resized canvas's hit testing.
    const location = await run(() => {
      const canvas = document.querySelector('.bezier-editor'); canvas.scrollIntoView({ block: 'center' });
      const box = canvas.getBoundingClientRect(), scale = canvas.clientWidth / 260;
      const point = (x, y) => ({ x: Math.round(box.left + canvas.clientLeft + x * scale), y: Math.round(box.top + canvas.clientTop + y * scale) });
      return { start: point(10, 80), end: point(70, 35) };
    });
    win.webContents.sendInputEvent({ type: 'mouseMove', ...location.start });
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...location.start });
    win.webContents.sendInputEvent({ type: 'mouseMove', ...location.end }); await wait(40);
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...location.end }); await wait(50);
    const points = (await event()).bezierPoints;
    assert.ok(Math.abs(points[0] - .25) < .01 && Math.abs(points[1] - .75) < .02, JSON.stringify(points));
    await capture('bezier-dragged');
    checks.push('custom/Bezier activation, HiDPI canvases, resizing, zoom and native handle drag');
    for (const theme of ['default', 'inkline', 'rpe-classic', 'rpe-classic-layout']) {
      const id = theme === 'rpe-classic-layout' ? 'rpe-classic' : theme;
      let record = null;
      if (id !== 'default') {
        const directory = path.join(root, 'assets/editor-skins', id), skin = JSON.parse(await fs.readFile(path.join(directory, 'skin.json'), 'utf8'));
        const entry = JSON.parse(await fs.readFile(path.join(root, 'assets/editor-skins/index.json'), 'utf8')).find(entry => entry.directory === id);
        const files = await Promise.all(Object.values(skin.assets).map(async asset => [asset.path, [...await fs.readFile(entry.shared?.[asset.path] ? path.join(root, 'assets', entry.shared[asset.path]) : path.join(directory, asset.path))]]));
        record = { skin, files };
      }
      await run(async (record, classic) => {
        const { EditorSkinRuntime } = await import('./src/ui/editor-skin-runtime.mjs');
        const { resolveEditorSkin } = await import('./src/core/editor-skin.mjs');
        window.skinRuntime ??= new EditorSkinRuntime(() => {});
        skinRuntime.apply(record ? await skinRuntime.prepare({ skin: resolveEditorSkin(record.skin), files: new Map(record.files.map(([name, bytes]) => [name, new Uint8Array(bytes)])) }) : null);
        document.querySelector('.inspector').style.width = '380px';
        if (classic) {
          document.documentElement.dataset.rpeClassicActive = '';
          document.documentElement.style.setProperty('--rc-s', '.67');
          document.querySelector('.inspector').style.height = 'calc(100vh - 32px)';
          window.scrollTo(0, 0);
          const { installPropertyPanels } = await import('./assets/mods/rpe-classic-layout/property-panels.mjs');
          installPropertyPanels({ editor: { session, timeline: { eventInteraction: {} }, invalidate() {} }, hook() {}, on() {}, patch() {}, listen() {}, dispose() {} }, { active: true });
        }
      }, record, theme === 'rpe-classic-layout');
      for (const mode of ['standard', 'custom', 'bezier']) {
        await click(`[data-easing-mode="${mode}"]`); await wait(160);
        const state = await run(() => {
          const tabs = document.querySelector('.event-easing-tabs'), selected = tabs.querySelector('[aria-selected=true]'), other = tabs.querySelector('[aria-selected=false]');
          const selectedStyle = getComputedStyle(selected), otherStyle = getComputedStyle(other), groupStyle = getComputedStyle(tabs);
          return { active: selected.classList.contains('active'), activeCount: tabs.querySelectorAll('.active').length, selected: selectedStyle.backgroundColor, other: otherStyle.backgroundColor, border: parseFloat(groupStyle.borderTopWidth), padding: parseFloat(groupStyle.paddingTop), canvases: document.querySelectorAll('.event-easing-panel canvas').length, fits: [...tabs.children].every(button => button.scrollWidth <= button.clientWidth) };
        });
        assert.equal(state.active, true, theme); assert.equal(state.activeCount, 1, theme); assert.notEqual(state.selected, state.other, theme + ' selected tab must be visibly different');
        assert.ok(state.border > 0 && state.padding > 0, theme + ' tabs have a shared group'); assert.equal(state.canvases, 1, theme); assert.equal(state.fits, true, theme);
        await checkDimensions(); await capture(`${theme}-${mode}`);
        if (mode === 'standard') {
          assert.equal(await run(() => {
            const field = document.querySelector('.event-easing-panel > .field'), label = document.createRange(); label.selectNodeContents(field.firstChild);
            return label.getClientRects().length === 1 && [...document.querySelectorAll('.event-easing-boundaries .rc-property-spin')].every(spin => spin.getBoundingClientRect().right <= spin.closest('.field').getBoundingClientRect().right + 1);
          }), true, theme + ' labels and classic spinners fit without overlapping');
          await click('.event-easing-trigger'); await checkGallery(); await capture(`${theme}-popup`); await click('.event-easing-popup [data-easing="3"]'); assert.equal((await event()).easingType, 3);
        }
      }
    }
    checks.push('visible selected/grouped tabs and three-column family picker in default, Inkline, RPE Classic fallback and active classic layout');
    assert.deepEqual(errors, []); console.log(JSON.stringify({ checks, errors }, null, 2));
  } catch (error) { console.error(error.stack, errors); await capture('failure'); process.exitCode = 1; }
  finally { win.destroy(); app.exit(process.exitCode || 0); }
}).catch(error => { console.error(error); app.exit(1); });
