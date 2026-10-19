import { app, BrowserWindow } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import type { EditorSession } from '../src/application/session.ts';
import type { NoiseTrackingPanel } from '../src/ui/noise-tracking.ts';
import type { NoiseAreaEditor } from '../src/ui/noise-area.ts';
import type { EditorSkins } from '../src/ui/editor-skins.ts';
/** The preview surface this harness inspects; the panel's interface only declares picking. */
interface QaPreview {
  guides: { index: number; x: number; y: number; alpha: number }[];
  noteHitAreas: { lineIndex: number; x1: number; x2: number; y1: number; y2: number }[];
  canvas: HTMLCanvasElement;
  visible: boolean;
}


declare global {
  interface Window {
    qaSession: EditorSession;
    qaTracker: NoiseTrackingPanel;
    qaNoise: NoiseAreaEditor;
    qaSkins: EditorSkins;
    qaErrors: string[];
    qaWheelCalls: number;
  }
}

const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1440, height: 960, show: false, webPreferences: { backgroundThrottling: false } });
  win.webContents.on('will-prevent-unload', event => event.preventDefault());
  const errors: string[] = []; win.webContents.on('console-message', (detail: { level: string; message: string }) => { if (detail.level === 'error' && !/favicon/.test(detail.message)) errors.push(detail.message); });
  const run = async <A extends unknown[], R>(fn: (...args: A) => R, ...args: A): Promise<Awaited<R>> => {
    const result: { testError?: string } | undefined = await win.webContents.executeJavaScript('(async()=>{try{return await (' + fn.toString() + ')(...' + JSON.stringify(args) + ')}catch(error){return {testError:error.stack}}})()', true);
    if (result?.testError) throw Error(result.testError); return result as Awaited<R>;
  };
  const until = async (callback: () => unknown): Promise<void> => { const end = Date.now() + 15000; while (!await run(callback)) { if (Date.now() > end) throw Error('timeout: ' + callback); await wait(60); } };
  const click = async (point: { x: number; y: number }): Promise<void> => {
    win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(point.x), y: Math.round(point.y) });
    win.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(point.x), y: Math.round(point.y), button: 'left', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(point.x), y: Math.round(point.y), button: 'left', clickCount: 1 }); await wait(120);
  };
  const wheel = async (deltaY: number): Promise<void> => {
    const point = await run(() => { const rectangle = document.querySelector<HTMLElement>('.stage')!.getBoundingClientRect(); return { x: rectangle.left + rectangle.width / 2, y: rectangle.top + rectangle.height * 0.8 }; });
    win.webContents.sendInputEvent({ type: 'mouseWheel', x: Math.round(point.x), y: Math.round(point.y), deltaY, deltaX: 0, canScroll: true }); await wait(140);
  };
  try {
    await win.loadURL(process.env.RPE_TRACKING_TEST_URL || 'http://127.0.0.1:4187'); win.showInactive(); await wait(400);
    await run(async () => {
      window.qaErrors = []; window.addEventListener('error', event => window.qaErrors.push(event.message));
      const { Timeline } = await import('./src/ui/timeline.ts' as string) as typeof import('../src/ui/timeline.ts'); const draw = Timeline.prototype.draw;
      Timeline.prototype.draw = function(...args) { window.qaSession = this.getSession() as unknown as EditorSession; return draw.apply(this, args); };
      const { NoiseTrackingPanel } = await import('./src/ui/noise-tracking.ts' as string) as typeof import('../src/ui/noise-tracking.ts'); const open = NoiseTrackingPanel.prototype.open;
      NoiseTrackingPanel.prototype.open = function(...args) { window.qaTracker = this; return open.apply(this, args); };
      const { NoiseAreaEditor } = await import('./src/ui/noise-area.ts' as string) as typeof import('../src/ui/noise-area.ts'); const noiseDraw = NoiseAreaEditor.prototype.draw;
      NoiseAreaEditor.prototype.draw = function(...args) { window.qaNoise = this; return noiseDraw.apply(this, args); };
      const { EditorSkins } = await import('./src/ui/editor-skins.ts' as string) as typeof import('../src/ui/editor-skins.ts'); const use = EditorSkins.prototype.use;
      EditorSkins.prototype.use = function(...args) { window.qaSkins = this; return use.apply(this, args); };
      document.querySelector<HTMLElement>('#new')!.click();
    }); await until(() => Boolean(window.qaSession));
    await run(async () => {
      const { createLine, createEvent, createNote } = await import('./src/core/chart.ts' as string) as typeof import('../src/core/chart.ts');
      const line = createLine('QA invisible line'); line.eventLayers[0].alphaEvents = [createEvent(0)];
      line.eventLayers[0].moveYEvents = [createEvent(120)];
      line.eventLayers[0].moveXEvents = [createEvent(-220, 200, 0, 8)];
      line.eventLayers[0].rotateEvents = [createEvent(0, 35, 0, 8)];
      const holdLine = createLine('QA hold'); holdLine.eventLayers[0].moveXEvents = [createEvent(250)];
      holdLine.eventLayers[0].speedEvents = [createEvent(1)];
      holdLine.notes = [createNote(2, 1, 0, 6)]; holdLine.numOfNotes = 1;
      const session = window.qaSession; session.commit('QA source', { ...session.chart, META: { ...session.chart.META, offset: 250 }, judgeLineList: [session.line!, line, holdLine] });
      document.querySelector<HTMLElement>('#noise-tracking-tool')!.click();
    }); await until(() => Boolean(window.qaTracker?.previewChart!) && document.querySelector<HTMLElement>('#beat-display')!.textContent === '-0.500 拍');
    const initial = await run(() => {
      const panel = window.qaTracker; const context = panel.context;
      return { active: panel.active, visible: !document.querySelector<HTMLElement>('[data-panel=noise-tracking]')!.hidden, generated: context.session.chart.blockAreaList!.length, preview: panel.previewChart!.blockAreaList!.length,
        editorHidden: getComputedStyle(document.querySelector<HTMLElement>('.canvases')!).visibility, width: (panel.controls.get('width') as HTMLInputElement).value, beat: document.querySelector<HTMLElement>('#beat-display')!.textContent };
    });
    assert.equal(initial.active, true); assert.equal(initial.visible, true); assert.equal(initial.generated, 0); assert.equal(initial.preview, 1); assert.equal(initial.editorHidden, 'hidden');
    assert.equal(initial.beat, '-0.500 拍');
    await run(() => {
      const panel = window.qaTracker; const original = panel.wheel; window.qaWheelCalls = 0;
      panel.wheel = function(...args) { window.qaWheelCalls++; return original.apply(this, args); };
    });
    const beforeWheel = await run(() => window.qaTracker.context.seconds()); await wheel(120);
    const afterWheel = await run(() => ({ time: window.qaTracker.context.seconds(), preview: window.qaTracker.previewSeconds, calls: window.qaWheelCalls }));
    assert.ok(afterWheel.time > beforeWheel, JSON.stringify({ beforeWheel, afterWheel })); assert.equal(afterWheel.preview, afterWheel.time); assert.equal(afterWheel.calls, 1);
    assert.equal(await run(() => document.querySelector<HTMLElement>('#beat-display')!.textContent), '0.100 拍');
    await wheel(-120);
    assert.equal(await run(() => window.qaTracker.context.seconds()), -0.25);
    assert.equal(await run(() => document.querySelector<HTMLInputElement>('#wheel-limit-audio-start')!.checked), true);
    await run(() => {
      document.querySelector<HTMLElement>('#preferences')!.click(); const control = document.querySelector<HTMLInputElement>('#wheel-limit-audio-start')!; control.checked = false; control.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector<HTMLDialogElement>('#settings-modal')!.close();
    }); await wheel(-120);
    assert.ok(await run(() => window.qaTracker.context.seconds() < -0.25));
    assert.equal(await run(() => JSON.parse(localStorage.getItem('rpe-next-editor-v1')!).wheelStopAtAudioStart), false);
    await run(() => {
      document.querySelector<HTMLElement>('#preferences')!.click(); const control = document.querySelector<HTMLInputElement>('#wheel-limit-audio-start')!; control.checked = true; control.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector<HTMLDialogElement>('#settings-modal')!.close();
    }); await wheel(-120);
    assert.equal(await run(() => window.qaTracker.context.seconds()), -0.25);
    await run(() => window.qaTracker.beginSample()); await wait(180);
    assert.equal(await run(() => window.qaTracker.context.session.chart.judgeLineList[1]!.eventLayers![0]!.alphaEvents![0]!.start), 0);
    const invisiblePoint = await run(() => {
      const renderer = (window.qaTracker.context.realtimePreview as unknown as QaPreview); const guide = renderer.guides.find(entry => entry.index === 1)!; const bounds = renderer.canvas.getBoundingClientRect();
      if (guide.alpha !== 255) throw Error('invisible line not temporarily opaque');
      return { x: bounds.left + guide.x, y: bounds.top + guide.y };
    }); await click(invisiblePoint);
    assert.equal(await run(() => window.qaTracker.sampling), false); assert.equal(await run(() => Number(window.qaTracker.options.lineIndex)), 1);
    assert.equal(await run(() => window.qaTracker.context.session.chart.judgeLineList[1]!.eventLayers![0]!.alphaEvents![0]!.start), 0);
    await wait(120);
    assert.equal(await run(() => (window.qaTracker.context.realtimePreview as unknown as QaPreview).guides.find(entry => entry.index === 1)!.alpha), 0);
    await run(() => { const panel = window.qaTracker; for (const [key, value] of [['start', '1:1/2'], ['end', '5:1/2'], ['width', '260'], ['height', '90']]) { const control = (panel.controls.get(key) as HTMLInputElement); control.value = value; control.dispatchEvent(new Event('input', { bubbles: true })); } });
    await run(() => window.qaTracker.generate.click()); await wait(120);
    assert.equal(await run(() => window.qaTracker.context.session.chart.blockAreaList!.length), 1);
    assert.equal(await run(() => window.qaTracker.previewChart!.blockAreaList!.length), 1);
    assert.equal(await run(() => document.querySelector<HTMLElement>('[data-panel=noise-tracking]')!.hidden), false);
    assert.equal(await run(() => document.querySelector<HTMLElement>('.editor')!.classList.contains('noise-mode')), false);
    assert.equal(await run(() => (window.qaTracker.controls.get('width') as HTMLInputElement).value), '260');
    await run(() => document.querySelector<HTMLElement>('#undo')!.click()); await wait(100);
    assert.equal(await run(() => window.qaTracker.context.session.chart.blockAreaList!.length), 0);
    await run(() => document.querySelector<HTMLElement>('#redo')!.click()); await wait(100);
    assert.equal(await run(() => window.qaTracker.context.session.chart.blockAreaList!.length), 1);
    await run(() => {
      const panel = window.qaTracker; (panel.controls.get('mode') as HTMLSelectElement).value = 'note'; (panel.controls.get('mode') as HTMLSelectElement).dispatchEvent(new Event('input', { bubbles: true })); panel.beginSample();
    }); await wait(180);
    const holdPoint = await run(() => {
      const renderer = (window.qaTracker.context.realtimePreview as unknown as QaPreview); const area = renderer.noteHitAreas.find(entry => entry.lineIndex === 2); const bounds = renderer.canvas.getBoundingClientRect();
      if (!area || Math.abs(area.y2 - area.y1) < 30) throw Error('hold body unavailable for sampling');
      return { x: bounds.left + (area.x1 + area.x2) / 2, y: bounds.top + (area.y1 + area.y2) / 2 };
    });
    const emptyLinePoint = await run(() => {
      const renderer = (window.qaTracker.context.realtimePreview as unknown as QaPreview); const guide = renderer.guides.find(entry => entry.index === 0)!; const bounds = renderer.canvas.getBoundingClientRect();
      return { x: bounds.left + guide.x - 150, y: bounds.top + guide.y };
    }); await click(emptyLinePoint);
    assert.equal(await run(() => window.qaTracker.sampling), true);
    assert.equal(await run(() => window.qaTracker.noteTarget), null);
    await click(holdPoint);
    assert.deepEqual(await run(() => window.qaTracker.noteTarget), { mode: 'note', lineIndex: 2, noteIndex: 0 });
    assert.equal(await run(() => window.qaTracker.context.session.lineIndex), 0);
    await run(() => window.qaTracker.generate.click()); await wait(120);
    assert.equal(await run(() => window.qaTracker.context.session.chart.blockAreaList!.length), 2);
    await run(() => window.qaTracker.beginSample()); await wait(80);
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'ESCAPE' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'ESCAPE' });
    await until(() => !window.qaTracker.sampling);
    assert.equal(await run(() => document.querySelector<HTMLElement>('[data-panel=noise-tracking]')!.hidden), false);
    // Back button restores the editor, reopening preserves the form and target.
    await run(() => [...document.querySelectorAll<HTMLElement>('.noise-tracking-footer button')].find(button => button.textContent === '返回谱面工具')!.click());
    assert.equal(await run(() => getComputedStyle(document.querySelector<HTMLElement>('.canvases')!).visibility), 'visible');
    await run(() => document.querySelector<HTMLElement>('#noise-tracking-tool')!.click()); await wait(100);
    assert.equal(await run(() => (window.qaTracker.controls.get('start') as HTMLInputElement).value), '1:1/2');
    assert.equal(await run(() => (window.qaTracker.controls.get('width') as HTMLInputElement).value), '260');
    await run(() => {
      const panel = window.qaTracker; (panel.controls.get('show') as HTMLInputElement).checked = false; (panel.controls.get('show') as HTMLInputElement).dispatchEvent(new Event('input', { bubbles: true }));
    }); await wait(100);
    assert.equal(await run(() => getComputedStyle(document.querySelector<HTMLElement>('.canvases')!).visibility), 'visible');
    await run(() => {
      const panel = window.qaTracker; (panel.controls.get('show') as HTMLInputElement).checked = true; (panel.controls.get('show') as HTMLInputElement).dispatchEvent(new Event('input', { bubbles: true }));
    }); await wait(100);
    assert.equal(await run(() => window.qaTracker.previewChart!.blockAreaList!.length), 2);
    await run(() => { document.querySelector<HTMLElement>('#view-toggle')!.click(); window.qaTracker.beginSample(); }); await wait(160);
    const fullPreviewHold = await run(() => {
      const renderer = (window.qaTracker.context.preview as unknown as QaPreview); const area = renderer.noteHitAreas.find(entry => entry.lineIndex === 2); const bounds = renderer.canvas.getBoundingClientRect();
      if (!renderer.visible || !area) throw Error('full preview sampling did not render notes');
      return { x: bounds.left + (area.x1 + area.x2) / 2, y: bounds.top + (area.y1 + area.y2) / 2 };
    }); await click(fullPreviewHold);
    assert.equal(await run(() => window.qaTracker.sampling), false);
    const fullBeforeWheel = await run(() => window.qaTracker.context.seconds()); await wheel(120);
    const fullAfterWheel = await run(() => ({ time: window.qaTracker.context.seconds(), preview: window.qaTracker.previewSeconds, calls: window.qaWheelCalls }));
    assert.ok(fullAfterWheel.time > fullBeforeWheel); assert.equal(fullAfterWheel.preview, fullAfterWheel.time); assert.equal(fullAfterWheel.calls, 5);
    await run(() => document.querySelector<HTMLElement>('#view-toggle')!.click()); await wait(100);
    await run(() => { window.qaTracker.playButton.click(); }); const before = await run(() => window.qaTracker.previewSeconds); await wait(250);
    assert.notEqual(await run(() => window.qaTracker.previewSeconds), before);
    await run(() => window.qaTracker.playButton.click());
    writeFileSync('.local-tools/noise-tracking-default.png', (await win.webContents.capturePage()).toPNG());
    await run(() => {
      document.querySelector<HTMLElement>('#preferences')!.click(); const control = document.querySelector<HTMLSelectElement>('#editor-skin-select')!; control.value = 'inkline'; control.dispatchEvent(new Event('change'));
      [...document.querySelectorAll<HTMLElement>('.editor-skin-actions button')].find(button => button.textContent === '应用')!.click();
    }); await until(() => document.documentElement.dataset.editorSkin === 'inkline');
    await run(() => document.querySelector<HTMLDialogElement>('#settings-modal')!.close()); await wait(200);
    writeFileSync('.local-tools/noise-tracking-inkline.png', (await win.webContents.capturePage()).toPNG());
    win.setSize(760, 720); await wait(150);
    const compact = await run(() => { const rect = window.qaTracker.generate.getBoundingClientRect(); return { visible: rect.top >= 0 && rect.bottom <= innerHeight && rect.right <= innerWidth, overflow: document.documentElement.scrollWidth > innerWidth + 1 }; });
    assert.equal(compact.visible, true); assert.equal(compact.overflow, false);
    writeFileSync('.local-tools/noise-tracking-compact.png', (await win.webContents.capturePage()).toPNG());
    win.setSize(1440, 960);
    await run(async () => {
      await window.qaSkins.use('default');
      const { createNoiseArea, createNoiseEvent, withNoiseAreas } = await import('./src/core/noise-areas.ts' as string) as typeof import('../src/core/noise-areas.ts');
      const area = createNoiseArea(0, 4);
      area.moveXEvents = Array.from({ length: 100 }, (unused, index) => createNoiseEvent(1000 + index, 1001 + index, 0.5 + index / 100, 0.5 + (index + 1) / 100));
      const session = window.qaTracker.context.session; session.commit('QA short events', withNoiseAreas(session.chart, [...session.chart.blockAreaList!, area]));
      document.querySelector<HTMLElement>('#noise-areas-tool')!.click();
    }); await until(() => Boolean(window.qaNoise?.active));
    const denseValues = await run(() => {
      const editor = window.qaNoise; editor.select(editor.areas().length - 1);
      const context = editor.canvas.getContext('2d')!; const original = context.fillText; const texts: string[] = [];
      context.fillText = function(text, ...args) { if (Number(text) >= 1000 && Number(text) <= 1100) texts.push(String(text)); return original.call(this, text, ...args); };
      try { editor.draw(); } finally { context.fillText = original; }
      return texts;
    }); assert.deepEqual(denseValues, ['1100', '1000']);
    const seamCounts = await run(() => {
      const editor = window.qaNoise; const context = editor.canvas.getContext('2d')!; const original = context.strokeRect; const x = editor.eventBounds('moveXEvents').x;
      const counts = [];
      try {
        for (const enabled of [true, false, true]) {
          const control = document.querySelector<HTMLInputElement>('#seamless-events')!; control.checked = enabled; control.dispatchEvent(new Event('input', { bubbles: true }));
          let count = 0; context.strokeRect = function(left, ...args) { if (left === x) count++; return original.call(this, left, ...args); };
          editor.hover = null; editor.draw(); counts.push(count);
        }
      } finally { context.strokeRect = original; }
      return { counts, visibleSegments: editor.rects.filter(rect => rect.type === 'moveXEvents').length };
    }); assert.ok(seamCounts.visibleSegments > 1); assert.deepEqual(seamCounts.counts, [1, seamCounts.visibleSegments, 1]);
    const connectedCurves = await run(() => {
      const editor = window.qaNoise; const context = editor.canvas.getContext('2d')!; const names = ['beginPath', 'moveTo', 'lineTo', 'stroke'] as const;
      const raw = { beginPath: context.beginPath, moveTo: context.moveTo, lineTo: context.lineTo, stroke: context.stroke };
      const curves: number[][][] = []; let points: number[][] = []; let subpaths: number[][][] = [];
      context.beginPath = function (): void { points = []; subpaths = []; raw.beginPath.call(context); };
      context.moveTo = function (x: number, y: number): void { points = [[x, y]]; subpaths.push(points); raw.moveTo.call(context, x, y); };
      context.lineTo = function (x: number, y: number): void { points.push([x, y]); raw.lineTo.call(context, x, y); };
      context.stroke = function (): void { for (const path of subpaths) if (path.length >= 2 && path[0]![0]! !== path.at(-1)![0]! && path[0]![1]! !== path.at(-1)![1]!) curves.push(path.map(point => [...point])); (raw.stroke as () => void).call(context); };
      try { editor.draw(); } finally { for (const name of names) (context as unknown as Record<string, unknown>)[name] = raw[name]; }
      const bounds = editor.eventBounds('moveXEvents'); let seamError = 0;
      for (let index = 1; index < curves.length; index++) seamError = Math.max(seamError, Math.hypot(...curves[index - 1]!.at(-1)!.map((value, axis) => value - curves[index]![0]![axis]!)));
      return { segments: curves.length, expected: editor.rects.filter(rect => rect.type === 'moveXEvents').length, seamError, firstSegmentWidth: Math.abs(curves[0]!.at(-1)![0]! - curves[0]![0]![0]!), expectedWidth: (bounds.width - 12) / 100 };
    }); assert.equal(connectedCurves.segments, connectedCurves.expected); assert.ok(connectedCurves.segments > 1); assert.ok(connectedCurves.seamError < 1e-8); assert.ok(Math.abs(connectedCurves.firstSegmentWidth - connectedCurves.expectedWidth) < 1e-8);
    const curveSwitch = await run(() => {
      const editor = window.qaNoise; const control = document.querySelector<HTMLInputElement>('#draw-event-curves')!;
      if (!control.checked || editor.context.timeline.drawEventCurves !== true) throw Error('event curves must default to enabled');
      const context = editor.canvas.getContext('2d')!; const original = context.lineTo; const results = [];
      try {
        for (const enabled of [true,false,true]) {
          control.checked=enabled; control.dispatchEvent(new Event('input',{bubbles:true}));
          let segments=0; context.lineTo=function(...args){segments++;return original.apply(this,args);}; editor.draw();
          const saved=JSON.parse(localStorage.getItem('rpe-next-editor-v1')!).drawEventCurves;
          if (saved !== enabled || editor.context.timeline.drawEventCurves !== enabled) throw Error('event curve preference was not applied/saved');
          results.push({enabled,segments,hitRects:editor.rects.filter(rect=>rect.type==='moveXEvents').length});
        }
      } finally {context.lineTo=original;}
      return results;
    });
    assert.ok(curveSwitch[0].segments>curveSwitch[1].segments); assert.equal(curveSwitch[0].segments,curveSwitch[2].segments);
    assert.equal(curveSwitch[0].hitRects,curveSwitch[1].hitRects); assert.equal(curveSwitch[0].hitRects,curveSwitch[2].hitRects);
    await run(() => {
      const session = window.qaNoise.context.session as unknown as EditorSession;
      session.commit('QA BPM factor', { ...session.chart, judgeLineList: session.chart.judgeLineList.map((line, index) => index ? line : { ...line, bpmfactor: 2 }) });
    }); await wait(100);
    assert.equal(await run(() => document.querySelector<HTMLElement>('#beat-display')!.textContent), '-0.500 拍');
    await run(() => document.querySelector<HTMLElement>('#close-noise-editor')!.click()); await wait(100);
    assert.equal(await run(() => document.querySelector<HTMLElement>('#beat-display')!.textContent), '-0.250 拍');
    await run(() => { document.querySelector<HTMLElement>('#noise-areas-tool')!.click(); window.qaNoise.select(window.qaNoise.areas().length - 1); }); await wait(140);
    writeFileSync('.local-tools/noise-tracking-short-event-values.png', (await win.webContents.capturePage()).toPNG());
    assert.deepEqual(await run(() => window.qaErrors), []); assert.deepEqual(errors, []);
    console.log(JSON.stringify({ initial, previewWheel: afterWheel, fullPreviewWheel: fullAfterWheel, denseValues, seamCounts, connectedCurves, curveSwitch, beatReadout: true, linePicking: true, opacityRestored: true, holdBodyPicking: true, currentLineUnchanged: true, undoRedo: true, preservedParameters: true, animation: true, inkline: true, compact, errors }, null, 2));
  } catch (error) { console.error(error, errors); writeFileSync('.local-tools/noise-tracking-failure.png', (await win.webContents.capturePage()).toPNG()); process.exitCode = 1; }
  finally { win.destroy(); app.exit(typeof process.exitCode === 'number' ? process.exitCode : 0); }
});
