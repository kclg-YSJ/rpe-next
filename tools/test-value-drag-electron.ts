// @ts-nocheck - ported release smoke script.
import { app, BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const scratch = path.resolve('.local-tools/value-drag');
fs.mkdirSync(scratch, { recursive: true });
app.setPath('userData', path.join(scratch, 'profile-' + Date.now()));
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1440, height: 960, show: false, webPreferences: { backgroundThrottling: false } });
  const errors = [], checks = [];
  win.webContents.on('will-prevent-unload', event => event.preventDefault());
  win.webContents.on('console-message', detail => { if (detail.level === 'error' && !/favicon/.test(detail.message)) errors.push(detail.message); });
  const run = (fn, ...args) => win.webContents.executeJavaScript('(' + fn.toString() + ')(...' + JSON.stringify(args) + ')', true);
  const setup = () => run(async () => {
    const { cancelValueDrag } = await import('./src/ui/draggable-value.ts'); cancelValueDrag();
    const editor = window.rpenMods.editor, { createChart, createEvent } = await import('./src/core/chart.ts');
    editor.eventSampler.finish(false);
    const chart = createChart(); chart.judgeLineList[0].eventLayers[0].moveXEvents = [createEvent(20, 120, 0, 4)];
    editor.replace(chart, 'Drag test'); editor.session.eventSelection = new Set(['moveXEvents:0']); editor.session.focus = 'events'; editor.render();
    window.startFiniteDrag = () => {
      const label = document.querySelector('#event-properties label[data-rpen-field="start"]');
      label.requestPointerLock = () => Promise.reject(new Error('Use finite drag for deterministic integration checks'));
      label.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1, isPrimary: true, clientX: 100, clientY: 40 }));
      window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 130, clientY: 40 }));
    };
    window.releaseFiniteDrag = () => window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 130, clientY: 40 }));
  });
  try {
    await win.loadURL(process.env.RPE_TEST_URL || 'http://127.0.0.1:4187'); win.show(); win.focus();
    await run(async () => { while (!window.rpenMods) await new Promise(resolve => setTimeout(resolve, 20)); await window.rpenMods.manager.ready; document.querySelector('#new').click(); });
    await pause(450);
    await run(()=>{window.dragEvents=[];for(const type of ['pointerdown','pointermove','pointerlockchange','pointerlockerror','blur'])window.addEventListener(type,event=>window.dragEvents.push({type,target:event.target?.tagName,key:event.key,x:event.clientX,locked:!!document.pointerLockElement}),true);});
    await setup(); await pause(120);
    const point = await run(() => { const box = document.querySelector('#event-properties label[data-rpen-field="start"]').getBoundingClientRect(); return { x: Math.round(box.left + 20), y: Math.round(box.top + box.height / 2) }; });
    win.webContents.sendInputEvent({ type: 'mouseMove', ...point });
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
    win.webContents.sendInputEvent({ type: 'mouseMove', x: point.x + 30, y: point.y }); await pause(180);
    assert.equal(await run(() => !!document.pointerLockElement), true, 'native drag acquires pointer lock');
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' }); await pause(180);
    assert.deepEqual(await run(() => { const e = window.rpenMods.editor; return [e.chart.judgeLineList[0].eventLayers[0].moveXEvents[0].start, e.session.history.undoStack.length, !!e.eventSampler.active, !!document.pointerLockElement]; }), [20, 0, false, false]);
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
    checks.push('native Escape cancels a locked drag without committing');

    await setup();
    assert.deepEqual(await run(() => {
      const e = window.rpenMods.editor, chart = structuredClone(e.chart), events = chart.judgeLineList[0].eventLayers[0].moveXEvents;
      events[0].linkgroup = 7; events.push({ ...events[0], startTime: [4, 0, 1], endTime: [8, 0, 1] });
      e.commit('Bound events', chart); e.session.history.undoStack = []; startFiniteDrag(); releaseFiniteDrag();
      const result = [e.chart.judgeLineList[0].eventLayers[0].moveXEvents.map(event => event.start), e.session.history.undoStack.length];
      e.session.travel('undo'); result.push(e.chart.judgeLineList[0].eventLayers[0].moveXEvents.map(event => event.start)); return result;
    }), [[50, 50], 1, [20, 20]]);
    checks.push('bound events follow the same transform and undo together');

    await setup();
    assert.deepEqual(await run(() => {
      const e = window.rpenMods.editor; e.commit('Rename', { ...e.chart, META: { ...e.chart.META, name: 'Changed' } }); startFiniteDrag();
      const event = new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true }); window.dispatchEvent(event);
      const during = [e.chart.META.name, e.session.history.undoStack.length, event.defaultPrevented]; releaseFiniteDrag();
      return [during, e.chart.META.name, e.session.history.undoStack.length];
    }), [['Changed', 1, true], 'Changed', 2]);
    checks.push('Ctrl+Z cannot pass through an active drag');

    await setup();
    assert.deepEqual(await run(() => {
      const e = window.rpenMods.editor; e.commit('Rename', { ...e.chart, META: { ...e.chart.META, name: 'Changed' } }); startFiniteDrag();
      e.session.travel('undo'); releaseFiniteDrag(); return [e.chart.META.name, e.session.history.undoStack.length, e.session.history.redoStack.length];
    }), ['未命名谱面', 0, 1]);
    checks.push('external undo cancels the stale draft and preserves redo');

    await setup();
    assert.deepEqual(await run(async () => {
      const host = window.rpenMods, { registerModHook } = await import('./src/core/mod-hooks.ts'); startFiniteDrag();
      const off = registerModHook('session:before-commit', change => { change.cancel = true; }); releaseFiniteDrag(); off();
      return [host.editor.chart.judgeLineList[0].eventLayers[0].moveXEvents[0].start, host.editor.session.history.undoStack.length];
    }), [20, 0]);
    checks.push('mod commit hooks can still cancel the final value');

    await setup();
    assert.deepEqual(await run(() => {
      const host = window.rpenMods; startFiniteDrag(); const unlock = host.runtime.lock('drag-test');
      const result = [!!host.editor.eventSampler.active, document.documentElement.classList.contains('value-dragging')]; unlock(); releaseFiniteDrag();
      return [...result, host.editor.session.history.undoStack.length];
    }), [false, false, 0]);
    checks.push('mod editing locks cancel active property gestures');

    await setup();
    assert.deepEqual(await run(async () => {
      const host = window.rpenMods, { registerModHook } = await import('./src/core/mod-hooks.ts'); startFiniteDrag();
      const off = registerModHook('input:before', input => { if (input.event.key === 'F6') input.handled = true; });
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F6', code: 'F6', bubbles: true, cancelable: true })); off(); releaseFiniteDrag();
      return [!!host.editor.eventSampler.active, host.editor.session.history.undoStack.length];
    }), [false, 0]);
    checks.push('mod input hooks cancel gestures before taking ownership');

    await setup();
    assert.deepEqual(await run(async () => {
      const h = window.rpenMods; await h.manager.enable('sky-dodge');
      startFiniteDrag(); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F8', code: 'F8', bubbles: true, cancelable: true }));
      const result = [!!h.editor.eventSampler.active, !!document.querySelector('.sky-dodge-dialog[open]'), h.runtime.locks.size];
      await h.manager.disable('sky-dodge'); return [...result, h.runtime.locks.size];
    }), [false, true, 1, 0]);
    checks.push('game hotkey takes over and releases cleanly');

    await setup();
    assert.deepEqual(await run(async () => {
      const h = window.rpenMods; await h.manager.enable('pixel-miner'); startFiniteDrag();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F9', code: 'F9', bubbles: true, cancelable: true }));
      const result = [!!h.editor.eventSampler.active, document.documentElement.classList.contains('value-dragging')];
      await h.manager.disable('pixel-miner'); return [...result, h.runtime.locks.size];
    }), [false, false, 0]);
    checks.push('miner hotkey takes over without leaving gesture state');

    await setup();
    await run(async () => { const h = window.rpenMods; await h.manager.enable('spatial-camera'); startFiniteDrag(); h.editor.eventSampler.valueDraft.startedAt -= 200; h.editor.invalidate(); });
    await pause(180);
    assert.equal(await run(() => { const h = window.rpenMods; const camera = h.runtime.loaded.get('spatial-camera'); return camera?.status === 'loaded' && !!h.editor.eventSampler.looping; }), true);
    await run(async () => { releaseFiniteDrag(); await window.rpenMods.manager.disable('spatial-camera'); });
    checks.push('camera mod remains loaded during a looping value preview');
    assert.deepEqual(errors, []);
    const report = { checks, errors }; fs.writeFileSync(path.join(scratch, 'result.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    const state=await run(()=>({events:window.dragEvents,draft:!!window.rpenMods?.editor.eventSampler.valueDraft,dragging:document.documentElement.classList.contains('value-dragging'),field:document.querySelector('#event-properties [data-rpen-field="start"] input')?.value}));
    fs.writeFileSync(path.join(scratch, 'failure.txt'), error.stack + '\n' + JSON.stringify({errors,state},null,2)); console.error(error); process.exitCode = 1;
  } finally { win.destroy(); app.exit(process.exitCode || 0); }
});
