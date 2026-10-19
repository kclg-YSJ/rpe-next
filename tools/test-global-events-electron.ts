import { app, BrowserWindow } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import type { Beat, Chart } from '../src/core/types.ts';
import type { ModRecord } from '../src/ui/mod-runtime.ts';
import type { RpenMods } from './test-spatial-camera-electron.ts';

type Modifier = NonNullable<Electron.InputEvent['modifiers']>[number];
type MouseButton = 'left' | 'middle' | 'right';
type Point = { x: number; y: number };

interface TestError { testError: string }
interface ConsoleMessageLike { level: string; message: string }

interface GlobalEventRecord {
  start: number;
  end: number;
  startTime: Beat;
  endTime: Beat;
  easingType?: number;
  extra?: Record<string, unknown>;
  custom?: unknown;
  [key: string]: unknown;
}
interface GlobalRegistration {
  id: string;
  name: string;
  width?: number;
  columns: { id: string; name: string }[];
}
interface GlobalProbe {
  open(): void;
  read(type: string, column: string): GlobalEventRecord[];
  replace(type: string, column: string, events: GlobalEventRecord[]): void;
  register(definition: GlobalRegistration): () => void;
}

declare global {
  interface Window {
    rpenMods: RpenMods;
    originalChart: Chart;
    normalEventWidth: number;
    focusedGlobalInput: HTMLInputElement;
    globalProbe: GlobalProbe;
    removeGlobalScroll: () => void;
    globalPaint: number;
    savedGlobal: string;
    parsedGlobal: Chart;
  }
}

const isTestError = (value: unknown): value is TestError =>
  typeof value === 'object' && value !== null && 'testError' in value && typeof (value as TestError).testError === 'string';

const scratch = resolve('.local-tools/global-events');
mkdirSync(scratch, { recursive: true });
app.setPath('userData', join(scratch, 'profile-' + Date.now()));
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1440, height: 960, show: false, webPreferences: { backgroundThrottling: false } });
  const errors: string[] = [];
  const checks: string[] = [];
  win.webContents.on('will-prevent-unload', event => event.preventDefault());
  win.webContents.on('console-message', detail => {
    const info = detail as unknown as ConsoleMessageLike;
    if (info.level === 'error' && !/favicon/.test(info.message)) errors.push(info.message);
  });
  const run = async <A extends unknown[], R>(fn: (...args: A) => R | Promise<R>, ...args: A): Promise<R> => {
    const value: unknown = await win.webContents.executeJavaScript('(async()=>{try{return await(' + fn.toString() + ')(...' + JSON.stringify(args) + ')}catch(error){return{testError:error.stack}}})()', true);
    if (isTestError(value)) throw Error(value.testError);
    return value as R;
  };
  const until = async <A extends unknown[]>(fn: (...args: A) => unknown, ...args: A): Promise<void> => {
    const end = Date.now() + 15000;
    while (!await run(fn, ...args)) {
      if (Date.now() > end) throw Error('Timeout ' + fn + ' / ' + JSON.stringify(errors));
      await wait(60);
    }
  };
  const key = async (value: string, modifiers: Modifier[] = []): Promise<void> => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: value, modifiers });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: value, modifiers });
    await wait(100);
  };
  const move = async (point: Point): Promise<void> => {
    win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(point.x), y: Math.round(point.y) });
    await wait(70);
  };
  const down = (point: Point, button: MouseButton = 'left'): void =>
    win.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(point.x), y: Math.round(point.y), button, clickCount: 1 });
  const up = (point: Point, button: MouseButton = 'left'): void =>
    win.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(point.x), y: Math.round(point.y), button, clickCount: 1 });
  const click = async (point: Point): Promise<void> => {
    await move(point);
    down(point);
    up(point);
    await wait(100);
  };
  const point = (beat: number, column = 0): Promise<Point> =>
    run((beat: number, column: number): Point => {
      const e = window.rpenMods.editor.globalEvents, t = e.timeline, r = e.canvas.getBoundingClientRect(), bounds = t.eventColumnBounds(column);
      return { x: r.left + bounds.left + bounds.channelWidth / 2, y: r.top + t.vertical(beat) };
    }, beat, column);
  const events = (): Promise<GlobalEventRecord[]> => run(() => window.rpenMods.editor.globalEvents.document.read('rpen/placeholder', 'value'));
  const add = async (first: number, last: number): Promise<void> => {
    await move(await point(first));
    await key('R');
    await move(await point(last));
    await key('R');
  };
  const capture = async (name: string): Promise<void> => writeFileSync(join(scratch, name + '.png'), (await win.webContents.capturePage()).toPNG());
  try {
    await win.loadURL('http://127.0.0.1:4187');
    win.showInactive();
    await until(() => Boolean(window.rpenMods?.manager.records.size));
    await run(async () => {
      await window.rpenMods.manager.ready;
      (document.querySelector('#new') as HTMLElement).click();
      window.originalChart = window.rpenMods.editor.chart;
      window.normalEventWidth = window.rpenMods.editor.timeline.eventsCanvas.clientWidth / 5;
      (document.querySelector('#global-events-tool') as HTMLElement).click();
    });
    await run(() => document.fonts.ready);
    await wait(100);
    assert.equal(await run(() => (document.querySelector('.editor') as HTMLElement).classList.contains('global-events-mode')), true);
    assert.equal(await run(() => window.rpenMods.editor.activePane), 'global-events');
    assert.equal(await run(() => document.querySelector('[data-pane="global-events"]')), null);
    assert.ok(await run(() => Math.abs(window.rpenMods.editor.globalEvents.timeline.eventColumnBounds(0).channelWidth - window.normalEventWidth) < .2));
    checks.push('fixed ordinary column width and no persistent tab');
    await add(0.5, 1.5);
    assert.equal((await events()).length, 1);
    assert.equal(await run(() => window.rpenMods.editor.chart === window.originalChart), true);
    assert.equal(await run(() => window.rpenMods.editor.dirty), false);
    checks.push('placeholder does not change chart');
    await click(await point(1));
    assert.equal(await run(() => window.rpenMods.editor.globalEvents.selection.size), 1);
    assert.equal(await run(() => window.rpenMods.editor.activePane), 'global-event-properties');
    assert.equal(await run(() => (document.querySelector('[data-panel="global-events"]') as HTMLElement).hidden), true);
    assert.equal(await run(() => document.querySelector('#global-event-inspector .global-events-types')), null);
    checks.push('separate overview and inspector');
    await run(() => {
      const input = document.querySelector('#global-event-properties [data-rpen-field="end"]') as HTMLInputElement;
      input.focus();
      input.select();
      window.focusedGlobalInput = input;
    });
    await win.webContents.insertText('8.5');
    await wait(80);
    assert.equal((await events())[0].end, 8.5);
    assert.equal(await run(() => document.activeElement === window.focusedGlobalInput), true);
    await key('A', ['control']);
    await win.webContents.insertText('8');
    assert.equal((await events())[0].end, 8);
    await run(() => {
      const input = document.querySelector('#global-event-properties [data-rpen-field="startTime"]') as HTMLInputElement;
      input.focus();
      input.select();
      window.focusedGlobalInput = input;
    });
    await key('Backspace');
    for (const char of '0:1/2') await win.webContents.insertText(char);
    await wait(80);
    assert.equal(await run(() => window.focusedGlobalInput.value), '0:1/2');
    assert.equal(await run(() => document.activeElement === window.focusedGlobalInput), true);
    assert.deepEqual((await events())[0].startTime, [0, 1, 2]);
    const liveHistory = await run(() => window.rpenMods.editor.session.history.undoStack.length);
    await run(() => (document.activeElement as HTMLElement).blur());
    await wait(80);
    assert.equal(await run(() => window.rpenMods.editor.session.history.undoStack.length), liveHistory);
    checks.push('live numeric and fractional beat input preserves focus without Enter');
    // Native input shortcuts remain inside the form and do not copy events.
    await run(() => {
      const input = document.querySelector('#global-event-properties [data-rpen-field="end"]') as HTMLInputElement;
      input.focus();
      input.select();
    });
    await key('C', ['control']);
    assert.equal(await run(() => window.rpenMods.editor.globalEvents.document.editor.eventClipboard.length), 0);
    await run(() => (document.activeElement as HTMLElement).blur());
    const start = await point(1), end = { ...start, y: start.y - 62.5 };
    await move(start);
    down(start);
    await move(end);
    up(end);
    await wait(130);
    assert.deepEqual((await events())[0].startTime, [0, 3, 4]);
    assert.deepEqual((await events())[0].endTime, [1, 3, 4]);
    checks.push('native drag and form editing');
    // Resize the top endpoint and restore via actual undo.
    const endpoint = await point(1.75), resize = { ...endpoint, y: endpoint.y - 62.5 };
    await move(endpoint);
    down(endpoint);
    await move(resize);
    up(resize);
    await wait(110);
    assert.deepEqual((await events())[0].endTime, [2, 0, 1]);
    await key('Z', ['control']);
    assert.deepEqual((await events())[0].endTime, [1, 3, 4]);
    await key('C', ['control']);
    await move(await point(2.25));
    await key('V', ['control']);
    assert.equal((await events()).length, 2);
    await key('D');
    assert.equal((await events()).length, 1);
    await key('Z', ['control']);
    assert.equal((await events()).length, 2);
    checks.push('resize clipboard delete undo');
    await run(() => {
      window.rpenMods.editor.timeline.scale = 250;
      window.rpenMods.editor.invalidate();
    });
    await wait(100);
    await key('Escape');
    const boxStart = await point(0.5), boxEnd = await point(3.5);
    boxStart.x -= 20;
    boxEnd.x += 20;
    await move(boxStart);
    down(boxStart, 'middle');
    await move(boxEnd);
    up(boxEnd, 'middle');
    await click(boxEnd);
    assert.equal(await run(() => window.rpenMods.editor.globalEvents.selection.size), 2);
    checks.push('middle marquee');
    assert.equal(await run(() => window.rpenMods.editor.activePane), 'global-events');
    assert.equal(await run(() => (document.querySelector('[data-panel="global-event-properties"]') as HTMLElement).hidden), true);
    checks.push('multiple selection never opens property page');
    await key('Escape');
    const strokeStart = await point(0.5), strokeEnd = await point(3.5);
    await move(strokeStart);
    down(strokeStart);
    await move(strokeEnd);
    up(strokeEnd);
    await wait(90);
    assert.equal(await run(() => window.rpenMods.editor.globalEvents.selection.size), 0);
    checks.push('stroke selection disabled');
    await capture('placeholder');
    const grid = await run(() => {
      const e = window.rpenMods.editor.globalEvents, t = e.timeline, r = devicePixelRatio || 1, context = e.canvas.getContext('2d')!, inside = e.geometry[0].left + e.geometry[0].width / 2, outside = e.geometry.at(-1)!.left + e.geometry.at(-1)!.width + 40;
      const alpha = (x: number, y: number): number => context.getImageData(Math.floor(x * r), Math.floor(y * r), 1, 1).data[3];
      return { gridOutside: alpha(outside, t.vertical(1)), judgementOutside: alpha(outside, t.vertical(0)), gridInside: alpha(inside, t.vertical(1)), judgementInside: alpha(inside, t.vertical(0)), left: alpha(.5, 60), right: alpha(e.geometry[0].width + .5, 60) };
    });
    assert.equal(grid.gridOutside, 0);
    assert.equal(grid.judgementOutside, 0);
    assert.ok(grid.gridInside > 0 && grid.judgementInside > 0);
    assert.ok(grid.left > 0 && grid.right > 0);
    checks.push('grid restricted to columns with both thin boundaries');
    // Dynamic multi-column registration through the real scoped mod API, including custom form and renderer.
    await run(async () => {
      const { parseModPackage } = await import('./src/core/mod-package.ts' as string) as typeof import('../src/core/mod-package.ts');
      const encode = (value: unknown): Uint8Array => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));
      const record = parseModPackage(new Map([
        ['mod.json', encode({ protocol: 'rpen-mod', api: 1, id: 'global-probe', name: 'Wind', version: '1.0.0', author: 'Tester', description: 'Temporary test', entry: 'main.ts' })],
        ['main.ts', encode(`export function activate(api){
          api.globalEvents.register({id:'wind',name:api.manifest.name+' · '+api.manifest.author,columns:[
            {id:'x',name:'X',valueType:'number',defaultValue:2,draw({context,rectangle}){window.globalPaint=(window.globalPaint||0)+1;context.fillStyle='#33bbaa';context.fillRect(rectangle.x+4,rectangle.y+4,6,6);},inspector({container,event,update}){const button=document.createElement('button');button.type='button';button.id='global-custom';button.textContent='Custom';button.onclick=()=>update(current=>({...current,custom:'kept'}));container.append(button);}},
            {id:'y',name:'Y',valueType:'number',defaultValue:3,width:140},
            {id:'state',name:'状态',valueType:'json',defaultValue:{mode:'calm'},overlap:true}
          ]});window.globalProbe=api.globalEvents;api.dispose(()=>delete window.globalProbe);
        }`)]
      ])) as ModRecord;
      window.rpenMods.manager.records.set(record.manifest.id, record);
      await window.rpenMods.manager.enable(record.manifest.id);
      window.globalProbe.open();
      window.globalProbe.replace('wind', 'x', [{ startTime: [1, 0, 1], endTime: [2, 0, 1], start: 2, end: 5, easingType: 1, extra: { test: true } }]);
      window.globalProbe.replace('wind', 'y', [{ startTime: [1, 0, 1], endTime: [2, 0, 1], start: 3, end: 7, easingType: 1 }]);
    });
    await until(() => window.rpenMods.editor.globalEvents.document.columns.length === 4);
    assert.equal(await run(() => document.querySelectorAll('.global-event-density').length), 2);
    assert.equal(await run(() => (document.querySelector('[data-global-event-type="global-probe/wind"]') as HTMLElement).textContent!.includes('Wind（Tester）')), true);
    assert.equal(await run(() => window.rpenMods.editor.globalEvents.timeline.eventColumnBounds(2).channelWidth), 140);
    assert.equal(await run(() => {
      const g = window.rpenMods.editor.globalEvents.geometry;
      return g[1].left - g[0].left - g[0].width;
    }), 18);
    assert.equal(await run(() => {
      const g = window.rpenMods.editor.globalEvents.geometry;
      return g[2].left - g[1].left - g[1].width;
    }), 0);
    checks.push('type spacing and mod width override');
    await run(() => {
      const api = window.rpenMods.runtime.loaded.get('global-probe')!.api!;
      window.removeGlobalScroll = api.globalEvents.register({ id: 'many', name: 'Scroll', width: 96, columns: Array.from({ length: 24 }, (_, index) => ({ id: 'c' + index, name: 'C' + index })) });
      api.globalEvents.replace('many', 'c4', [{ startTime: [1, 0, 1], endTime: [2, 0, 1], start: 1, end: 2 }]);
    });
    await wait(100);
    const panStart = await run(() => {
      (document.querySelector('.global-events-scroll') as HTMLElement).scrollLeft = 0;
      const r = (document.querySelector('.global-events-scroll') as HTMLElement).getBoundingClientRect();
      return { x: r.left + Math.min(600, r.width - 20), y: r.top + 60 };
    }), panMiddle = { x: panStart.x - 150, y: panStart.y }, panEnd = { x: panStart.x - 300, y: panStart.y };
    await move(panStart);
    down(panStart);
    await move(panMiddle);
    await move(panEnd);
    up(panEnd);
    await wait(80);
    assert.ok(await run(() => Math.abs((document.querySelector('.global-events-scroll') as HTMLElement).scrollLeft - 300) < 3));
    assert.equal(await run(() => window.rpenMods.editor.globalEvents.selection.size), 0);
    checks.push('native horizontal pan with many columns uses stable screen coordinates');
    await click(await point(1.5, 8));
    assert.equal(await run(() => window.rpenMods.editor.globalEvents.selection.size), 1);
    assert.equal(await run(() => window.rpenMods.editor.activePane), 'global-event-properties');
    checks.push('event hit testing after pan');
    await run(() => {
      window.removeGlobalScroll();
      (document.querySelector('.global-events-scroll') as HTMLElement).scrollLeft = 0;
      window.rpenMods.editor.activatePane('global-events');
    });
    await wait(80);
    await click(await point(1.5, 1));
    await run(() => (document.querySelector('#global-custom') as HTMLElement).click());
    assert.equal(await run(() => window.globalProbe.read('wind', 'x')[0].custom), 'kept');
    await until(() => window.globalPaint > 0);
    checks.push('mod multiple columns custom renderer and inspector');
    const source = await run(() => window.rpenMods.editor.chart.globalEvents.types['global-probe/wind'].source);
    assert.deepEqual(source, { kind: 'mod', id: 'global-probe', name: 'Wind', author: 'Tester', version: '1.0.0' });
    await run(async () => {
      const { serializeChart, parseChart } = await import('./src/core/chart.ts' as string) as typeof import('../src/core/chart.ts');
      window.savedGlobal = serializeChart(window.rpenMods.editor.chart);
      window.parsedGlobal = parseChart(window.savedGlobal);
    });
    assert.equal(await run(() => window.savedGlobal.includes('rpen/placeholder')), false);
    checks.push('mod provenance and save round trip');
    await run(() => window.rpenMods.manager.disable('global-probe'));
    await until(() => window.rpenMods.editor.globalEvents.document.types.find(type => type.id === 'global-probe/wind')?.readonly);
    assert.equal(await run(() => window.rpenMods.editor.chart.globalEvents.types['global-probe/wind'].columns.x.events[0].custom), 'kept');
    await run(() => window.rpenMods.manager.enable('global-probe'));
    await until(() => window.globalProbe?.read('wind', 'x')[0]?.custom === 'kept');
    checks.push('unload reload retains data');
    await run(() => {
      window.rpenMods.editor.session.chart.judgeLineList[0].bpmfactor = 2;
      window.rpenMods.editor.seekBeat(2);
    });
    assert.equal(await run(() => window.rpenMods.editor.currentBeat()), 2);
    assert.equal(await run(() => window.rpenMods.editor.chartSeconds()), 1);
    checks.push('global beat ignores current line factor');
    await run(async () => {
      await window.rpenMods.editor.editorSkins.use('inkline');
      window.rpenMods.editor.seekBeat(0);
    });
    await wait(150);
    assert.equal(await run(() => ((document.querySelector('#global-events-tool') as HTMLElement).closest('[data-skin-group]') as HTMLElement | null)?.dataset.skinGroup), 'modes');
    await click(await point(1.5, 1));
    await capture('inkline');
    win.setSize(1050, 760);
    await wait(200);
    await capture('narrow');
    assert.equal(await run(() => (document.querySelector('#global-events-canvas') as HTMLElement).getBoundingClientRect().height > 200), true);
    checks.push('Inkline editing modes group');
    await run(() => (document.querySelector('#global-event-inspector [data-global-events-close]') as HTMLElement).click());
    assert.equal(await run(() => window.rpenMods.editor.globalEvents.active), false);
    assert.equal(await run(() => (document.querySelector('#notes') as HTMLElement).getBoundingClientRect().width > 0), true);
    await run(() => (document.querySelector('#global-events-tool') as HTMLElement).click());
    await run(() => (document.querySelector('#global-events-panel [data-global-events-close]') as HTMLElement).click());
    assert.equal(await run(() => window.rpenMods.editor.globalEvents.active), false);
    await run(() => {
      (document.querySelector('#global-events-tool') as HTMLElement).click();
      (document.querySelector('#noise-areas-tool') as HTMLElement).click();
    });
    assert.equal(await run(() => window.rpenMods.editor.noiseEditor.active && !window.rpenMods.editor.globalEvents.active), true);
    checks.push('both panel close actions skin narrow window and mode switching');
    await run(() => {
      window.rpenMods.editor.noiseEditor.close();
      window.rpenMods.editor.openGlobalEvents();
      (document.querySelector('#new') as HTMLElement).click();
      (document.querySelector('#modal-apply') as HTMLElement).click();
    });
    await wait(100);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ checks, errors }, null, 2));
  } catch (error) {
    console.error((error as Error).stack, errors);
    await capture('failure');
    process.exitCode = 1;
  } finally {
    win.destroy();
    app.exit((process.exitCode as number) || 0);
  }
}).catch(error => {
  console.error(error);
  app.exit(1);
});
