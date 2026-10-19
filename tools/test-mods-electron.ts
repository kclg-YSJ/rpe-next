import { app, BrowserWindow } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import type { Note } from '../src/core/types.ts';
import type { RpenMods } from './test-spatial-camera-electron.ts';

type Modifier = NonNullable<Electron.InputEvent['modifiers']>[number];
type Point = { x: number; y: number };

interface TestError { testError: string }
interface ConsoleMessageLike { level: string; message: string }

interface AircraftModule {
  drawAircraft(context: CanvasRenderingContext2D, point: Point, radius: number, time: number, invincible?: boolean, invincibilityElapsed?: number): void;
}
interface PickupsModule {
  drawPickup(context: CanvasRenderingContext2D, pickup: { x: number; y: number; birth: number; kind: string }, time: number): void;
}
interface ModProof {
  total: number;
  message: string;
  answer: number;
  same: boolean;
  changes: number;
  commands: number;
}
interface BoundaryTiming {
  iterations?: number;
  duration?: number | string;
}

declare global {
  interface Window {
    rpenMods: RpenMods;
    modProof: ModProof | undefined;
    modArchive: number[];
    savedRandom: () => number;
    boundaryAnimation: Animation;
    modButtonLocation: { parent: HTMLElement; next: ChildNode | null };
  }
}

const isTestError = (value: unknown): value is TestError =>
  typeof value === 'object' && value !== null && 'testError' in value && typeof (value as TestError).testError === 'string';

const scratch = resolve('.local-tools/mod-tests');
mkdirSync(scratch, { recursive: true });
app.setPath('userData', join(scratch, 'profile-' + Date.now()));
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1440, height: 960, show: false, webPreferences: { backgroundThrottling: false } });
  win.webContents.on('will-prevent-unload', event => event.preventDefault());
  const errors: string[] = [];
  win.webContents.on('console-message', detail => {
    const info = detail as unknown as ConsoleMessageLike;
    if (info.level === 'error' && !/favicon/.test(info.message)) errors.push(info.message);
  });
  const run = async <A extends unknown[], R>(fn: (...args: A) => R | Promise<R>, ...args: A): Promise<R> => {
    const result: unknown = await win.webContents.executeJavaScript('(async()=>{try{return await (' + fn.toString() + ')(...' + JSON.stringify(args) + ')}catch(error){return {testError:error.stack}}})()', true);
    if (isTestError(result)) throw Error(result.testError);
    return result as R;
  };
  const until = async <A extends unknown[]>(fn: (...args: A) => unknown, ...args: A): Promise<void> => {
    const end = Date.now() + 15000;
    while (!await run(fn, ...args)) {
      if (Date.now() > end) throw Error('timeout: ' + fn + ' / ' + await run(() => window.rpenMods?.manager?.message.textContent));
      await wait(60);
    }
  };
  const key = async (value: string, modifiers: Modifier[] = []): Promise<void> => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: value, modifiers });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: value, modifiers });
    await wait(100);
  };
  const pointer = async (point: Point): Promise<void> => {
    win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(point.x), y: Math.round(point.y) });
    await wait(80);
  };
  const capture = async (name: string): Promise<void> => {
    await wait(150);
    writeFileSync(join(scratch, name + '.png'), (await win.webContents.capturePage()).toPNG());
  };
  try {
    await win.loadURL(process.env.RPE_MOD_TEST_URL || 'http://127.0.0.1:4187');
    win.showInactive();
    await until(() => Boolean(window.rpenMods?.manager.records.size));
    const initial = await run(async () => {
      await window.rpenMods.manager.ready;
      return { mods: [...window.rpenMods.manager.records.keys()], loaded: window.rpenMods.runtime.loaded.size, hidden: (document.querySelector('#mods-status') as HTMLElement).hidden };
    });
    assert.deepEqual(initial.mods, ['sky-dodge', 'pixel-miner', 'spatial-camera']);
    assert.equal(initial.loaded, 0);
    assert.equal(initial.hidden, true);
    const contrast = await run(async () => {
      const { drawAircraft } = await import('./assets/mods/sky-dodge/aircraft.mjs' as string) as AircraftModule;
      const { drawPickup } = await import('./assets/mods/sky-dodge/pickups.mjs' as string) as PickupsModule;
      const canvas = document.createElement('canvas');
      canvas.width = 900;
      canvas.height = 300;
      const context = canvas.getContext('2d')!;
      for (const [index, background] of ['#080c13', '#ffffff', '#b63c3c'].entries()) {
        const left = index * 300;
        context.fillStyle = background;
        context.fillRect(left, 0, 300, 300);
        context.fillStyle = index === 1 ? '#123246' : '#effaff';
        context.font = '15px sans-serif';
        context.fillText(['Dark', 'Light', 'Noise / notes'][index], left + 18, 25);
        if (index === 2) {
          context.fillStyle = '#ffd887';
          context.fillRect(left + 50, 85, 200, 10);
          context.fillStyle = '#9aeaff';
          context.fillRect(left + 50, 180, 200, 7);
        }
        drawAircraft(context, { x: left + 105, y: 90 }, 10, 1, false);
        drawAircraft(context, { x: left + 195, y: 90 }, 10, 1, true);
        drawPickup(context, { x: left + 105, y: 190, birth: 0, kind: 'star' }, 1);
        drawPickup(context, { x: left + 195, y: 190, birth: 0, kind: 'repair' }, 1);
      }
      return canvas.toDataURL('image/png');
    });
    writeFileSync(join(scratch, 'visibility.png'), Buffer.from(contrast.split(',')[1], 'base64'));
    const invincibleFlash = await run(async () => {
      const { drawAircraft } = await import('./assets/mods/sky-dodge/aircraft.mjs' as string) as AircraftModule;
      const canvas = document.createElement('canvas');
      canvas.width = 360;
      canvas.height = 120;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#080c13';
      context.fillRect(0, 0, 360, 120);
      for (const [index, label] of ['Normal', 'Invincible / bright', 'Invincible / dim'].entries()) {
        context.fillStyle = '#eaf7ff';
        context.font = '12px sans-serif';
        context.fillText(label, index * 120 + 8, 20);
        drawAircraft(context, { x: index * 120 + 60, y: 65 }, 10, 1, index > 0, index === 2 ? 0.18 : 0.04);
      }
      const brightness = (x: number): number => {
        const pixels = context.getImageData(x - 8, 57, 16, 16).data;
        let total = 0;
        for (let i = 0; i < pixels.length; i += 4) total += pixels[i] + pixels[i + 1] + pixels[i + 2];
        return total;
      };
      return { image: canvas.toDataURL('image/png'), bright: brightness(180), dim: brightness(300), locator: [...context.getImageData(314, 79, 1, 1).data] };
    });
    assert.ok(invincibleFlash.bright > invincibleFlash.dim * 2, JSON.stringify(invincibleFlash));
    assert.ok(invincibleFlash.locator[0] > 150 && invincibleFlash.locator[1] > 120);
    writeFileSync(join(scratch, 'invincibility.png'), Buffer.from(invincibleFlash.image.split(',')[1], 'base64'));
    // Exercise actual ZIP import and consent, cyclic modules, computed import and unrestricted hooks.
    await run(async () => {
      const { writeZip } = await import('./src/platform/archive.ts' as string) as typeof import('../src/platform/archive.ts');
      const encode = (value: unknown): Uint8Array => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));
      const files = new Map<string, Uint8Array>([
        ['mod.json', encode({ protocol: 'rpen-mod', api: 1, id: 'integration-mod', name: 'Integration', version: '1.0.0', author: 'Test', description: 'API integration fixture', entry: 'main.ts', settings: { amount: { type: 'number', label: 'Amount', default: 2, min: 1, max: 9 } } })],
        ['a.ts', encode("import {getB} from './b.ts';export const getA=()=>1;export const total=()=>getB()+1;")],
        ['b.ts', encode("import {getA} from './a.ts';export const getB=()=>getA()+2;")],
        ['data.json', encode({ message: 'multi-file' })], ['lazy.ts', encode('export const answer=23;')],
        ['main.ts', encode(`import {total} from './a.ts';import data from './data.json';import {getEditor,getModHost} from '@rpen/api';
export async function activate(api){const path='./lazy.ts';const lazy=await import(path);window.modProof={total:total(),message:data.message,answer:lazy.answer,same:getEditor()===api.editor&&getModHost()===window.rpenMods,changes:0,commands:0};
const node=document.createElement('div');node.id='integration-mounted';api.mount(node);api.style('#integration-mounted{position:fixed;pointer-events:none}');
api.settings.onChange(()=>window.modProof.changes++);api.commands.register({id:'count',title:'Count',shortcut:'CTRL&SHIFT&U',run:()=>window.modProof.commands++});
api.hook('session:before-commit',change=>{change.chart={...change.chart,'x-integration':true};});
api.patch(api.editor.timeline,'draw',previous=>function(...args){return previous.apply(this,args)});
return()=>{delete window.modProof};}`)]
      ]);
      window.modArchive = [...new Uint8Array(await writeZip(files).arrayBuffer())];
    });
    const importFixture = (): Promise<unknown> => run(() => {
      const manager = window.rpenMods.manager;
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array(window.modArchive)], 'Integration.rpenmod'));
      manager.file.files = transfer.files;
      manager.file.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await importFixture();
    await until(() => window.rpenMods.manager.warning.open);
    assert.equal(await run(() => ([...document.querySelectorAll('#mod-import-warning button')].at(-1) as HTMLButtonElement).disabled), true);
    assert.equal(await run(() => window.modProof), undefined);
    await run(() => window.rpenMods.manager.finishWarning(false));
    await until(() => !window.rpenMods.manager.busy);
    assert.equal(await run(() => window.rpenMods.manager.records.has('integration-mod')), false);
    await importFixture();
    await until(() => window.rpenMods.manager.warning.open);
    await run(() => {
      (document.querySelector('#mod-import-warning input') as HTMLInputElement).click();
      ([...document.querySelectorAll('#mod-import-warning button')].at(-1) as HTMLButtonElement).click();
    });
    await until(() => window.rpenMods.manager.records.has('integration-mod'));
    assert.equal(await run(() => window.rpenMods.runtime.loaded.size), 0);
    await run(() => window.rpenMods.manager.enable('integration-mod'));
    assert.deepEqual(await run(() => window.modProof), { total: 4, message: 'multi-file', answer: 23, same: true, changes: 0, commands: 0 });
    await run(() => window.rpenMods.runtime.loaded.get('integration-mod')!.api!.settings.set('amount', 6));
    assert.equal(await run(() => window.modProof!.changes), 1);
    await key('U', ['control', 'shift']);
    assert.equal(await run(() => window.modProof!.commands), 1);
    await run(() => {
      const input = document.createElement('input');
      input.id = 'mod-test-input';
      document.body.append(input);
      input.focus();
    });
    await key('U', ['control', 'shift']);
    assert.equal(await run(() => window.modProof!.commands), 1);
    await run(() => (document.querySelector('#mod-test-input') as HTMLElement).remove());
    await run(async () => {
      const { createChart } = await import('./src/core/chart.ts' as string) as typeof import('../src/core/chart.ts');
      window.rpenMods.editor.commit('Extension test', createChart());
    });
    assert.equal(await run(() => window.rpenMods.editor.chart['x-integration']), true);
    await run(() => window.rpenMods.manager.disable('integration-mod'));
    assert.equal(await run(() => document.querySelector('#integration-mounted')), null);
    assert.equal(await run(() => window.modProof), undefined);
    await run(() => window.rpenMods.manager.enable('integration-mod'));
    await win.loadURL(win.webContents.getURL());
    await until(() => window.rpenMods?.runtime.loaded.get('integration-mod')?.status === 'loaded');
    assert.equal(await run(() => window.rpenMods.runtime.loaded.get('integration-mod')!.api!.settings.get('amount')), 6);
    await win.loadURL((process.env.RPE_MOD_TEST_URL || 'http://127.0.0.1:4187') + '/?mods=off');
    await until(() => window.rpenMods?.manager.records.has('integration-mod'));
    await run(() => window.rpenMods.manager.ready);
    assert.equal(await run(() => window.rpenMods.runtime.loaded.size), 0);
    await run(async () => {
      window.confirm = () => true;
      const manager = window.rpenMods.manager;
      manager.desired.add('integration-mod');
      manager.persist();
      const { exportMod } = await import('./src/platform/mods.ts' as string) as typeof import('../src/platform/mods.ts');
      window.modArchive = [...new Uint8Array(await exportMod(manager.records.get('integration-mod')!).arrayBuffer())];
    });
    await importFixture();
    await until(() => window.rpenMods.manager.warning.open);
    await run(() => {
      (document.querySelector('#mod-import-warning input') as HTMLInputElement).click();
      ([...document.querySelectorAll('#mod-import-warning button')].at(-1) as HTMLButtonElement).click();
    });
    await until(() => !window.rpenMods.manager.busy);
    assert.equal(await run(() => window.rpenMods.manager.desired.has('integration-mod')), false);
    await run(async () => {
      await window.rpenMods.manager.disableAll();
      await window.rpenMods.manager.remove('integration-mod');
    });
    assert.equal(await run(() => window.rpenMods.manager.options['integration-mod']), undefined);
    await run(() => (document.querySelector('#mods-open') as HTMLElement).click());
    await until(() => (document.querySelector('#mod-manager') as HTMLDialogElement).open);
    await capture('manager');
    await run(async () => {
      await window.rpenMods.manager.enable('pixel-miner');
    });
    assert.equal(await run(() => window.rpenMods.runtime.loaded.size), 1);
    assert.equal(await run(() => (document.querySelector('#mods-status') as HTMLElement).textContent), '已装载 1 个模组');
    await run(async () => {
      await window.rpenMods.manager.disable('pixel-miner');
      await window.rpenMods.manager.enable('sky-dodge');
      window.rpenMods.manager.dialog.close();
      (document.querySelector('#new') as HTMLElement).click();
    });
    await until(() => window.rpenMods.editor.hasDocument);
    const before = await run(async () => {
      window.confirm = () => true;
      const editor = window.rpenMods.editor;
      const context = editor.audio.ensureContext();
      editor.audio.buffer = context.createBuffer(1, context.sampleRate * 8, context.sampleRate);
      editor.seek(0, { music: true });
      return { chart: JSON.stringify(editor.chart), undo: editor.session.history.undoStack.length, view: editor.preview.visible, pane: editor.activePane };
    });
    await key('F8');
    await until(() => Boolean(document.querySelector('.sky-dodge-dialog[open]')));
    assert.equal(await run(() => document.documentElement.dataset.modEditingLocked), 'true');
    await capture('intro');
    await run(() => ([...document.querySelectorAll('.sky-dodge-dialog button')].find(button => button.textContent === '了解，准备起飞') as HTMLButtonElement).click());
    assert.equal(await run(() => window.rpenMods.editor.audio.playing), false);
    const inside = await run(() => {
      const canvas = window.rpenMods.editor.preview.canvas;
      const bounds = canvas.getBoundingClientRect();
      const view = window.rpenMods.editor.preview.viewport;
      return { x: bounds.left + view.left + view.width * 0.75, y: bounds.top + view.top + view.height * 0.75 };
    });
    await pointer(inside);
    await until(() => window.rpenMods.editor.audio.playing);
    await capture('playing');
    const border = await run(() => {
      const renderer = window.rpenMods.editor.preview, view = renderer.viewport, canvas = renderer.canvas.getBoundingClientRect(), boundary = document.querySelector('.sky-dodge-boundary') as HTMLElement, rect = boundary.getBoundingClientRect(), style = getComputedStyle(boundary);
      return { left: rect.left - canvas.left - view.left - 0.5, top: rect.top - canvas.top - view.top - 0.5, width: rect.width - (view.width - 1), height: rect.height - (view.height - 1), pointerEvents: style.pointerEvents, stroke: parseFloat(style.borderTopWidth) };
    });
    assert.ok((['left', 'top', 'width', 'height'] as const).every(key => Math.abs(border[key]) < 1) && border.pointerEvents === 'none' && border.stroke > 0 && border.stroke <= 1.1, JSON.stringify(border));
    const time = await run(() => window.rpenMods.editor.audio.time);
    assert.ok(time > 0);
    await key('Q');
    await key('DELETE');
    assert.equal(await run(() => JSON.stringify(window.rpenMods.editor.chart)), before.chart);
    await pointer({ x: 4, y: 4 });
    await until(() => !window.rpenMods.editor.audio.playing);
    const paused = await run(() => window.rpenMods.editor.audio.time);
    await wait(100);
    assert.equal(await run(() => window.rpenMods.editor.audio.time), paused);
    const warning = await run(() => {
      window.boundaryAnimation = (document.querySelector('.sky-dodge-boundary') as HTMLElement).getAnimations()[0];
      const effect = window.boundaryAnimation.effect!.getTiming() as BoundaryTiming;
      return { iterations: effect.iterations, duration: effect.duration, state: window.boundaryAnimation.playState, time: window.boundaryAnimation.currentTime };
    });
    assert.equal(warning.iterations, 3);
    assert.equal(warning.duration, 360);
    assert.equal(warning.state, 'running');
    await capture('boundary-warning');
    await wait(130);
    assert.ok(await run(() => window.boundaryAnimation.currentTime as number) > (warning.time as number));
    await wait(1000);
    assert.equal(await run(() => window.boundaryAnimation.playState), 'finished');
    assert.equal(await run(() => getComputedStyle(document.querySelector('.sky-dodge-boundary') as HTMLElement).opacity), '0.8');
    assert.equal(await run(() => window.rpenMods.editor.audio.time), paused);
    await pointer(inside);
    await until(() => window.rpenMods.editor.audio.playing);
    assert.equal(await run(() => (document.querySelector('.sky-dodge-hearts') as HTMLElement).textContent), '♥♥♥♥♡');
    // Move outside/inside four more times; each re-entry costs one heart, bypassing hit invulnerability.
    for (let i = 0; i < 4; i++) {
      await pointer({ x: 3, y: 3 });
      await pointer(inside);
    }
    await until(() => (document.querySelector('.sky-dodge-dialog h2') as HTMLElement)?.textContent === '本次航行结束');
    assert.equal(await run(() => window.rpenMods.editor.audio.playing), false);
    await capture('failure');
    await run(() => ([...document.querySelectorAll('.sky-dodge-dialog button')].find(button => button.textContent === '重试') as HTMLButtonElement).click());
    assert.equal(await run(() => window.rpenMods.editor.audio.time), 0);
    assert.equal(await run(() => (document.querySelector('.sky-dodge-hearts') as HTMLElement).textContent), '♥♥♥♥♥');
    assert.equal(await run(() => (document.querySelector('.sky-dodge-boundary') as HTMLElement).getAnimations().length), 0);
    await pointer({ x: 5, y: 5 });
    await pointer(inside);
    await until(() => window.rpenMods.editor.audio.playing);
    await run(() => {
      const editor = window.rpenMods.editor;
      editor.seek(editor.audio.duration - 0.03, { music: true, pause: false });
    });
    await until(() => (document.querySelector('.sky-dodge-dialog h2') as HTMLElement)?.textContent === '抵达星海');
    await capture('success');
    await key('F8');
    await until(() => !document.querySelector('.sky-dodge-surface'));
    assert.equal(await run(() => document.documentElement.dataset.modEditingLocked), undefined);
    assert.equal(await run(() => window.rpenMods.editor.preview.visible), before.view);
    assert.equal(await run(() => JSON.stringify(window.rpenMods.editor.chart)), before.chart);
    assert.equal(await run(() => window.rpenMods.editor.session.history.undoStack.length), before.undo);
    await run(async () => {
      await window.rpenMods.manager.disableAll();
    });
    assert.equal(await run(() => (document.querySelector('#mods-status') as HTMLElement).hidden), true);
    assert.equal(await run(() => document.querySelector('#pixel-miner-ui')), null);
    // Deterministic pickup animation/collection in a real preview.
    await run(async () => {
      const editor = window.rpenMods.editor;
      editor.seek(0, { music: true });
      window.savedRandom = Math.random;
      Math.random = () => 0.25;
      await window.rpenMods.manager.enable('sky-dodge');
    });
    await key('F8');
    await run(() => ([...document.querySelectorAll('.sky-dodge-dialog button')].at(-1) as HTMLButtonElement).click());
    const safe = await run(() => {
      const rect = window.rpenMods.editor.preview.canvas.getBoundingClientRect();
      const v = window.rpenMods.editor.preview.viewport;
      return { x: rect.left + v.left + v.width * 0.85, y: rect.top + v.top + v.height * 0.1 };
    });
    await pointer(safe);
    await until(() => window.rpenMods.editor.audio.playing);
    await wait(1100);
    const pickup = await run(() => {
      const rect = window.rpenMods.editor.preview.canvas.getBoundingClientRect();
      const v = window.rpenMods.editor.preview.viewport;
      return { x: rect.left + v.left + 32 + (v.width - 64) * 0.25, y: rect.top + v.top + 32 + (v.height - 64) * 0.25 };
    });
    await pointer(pickup);
    await until(() => (document.querySelector('.sky-dodge-combo') as HTMLElement)?.textContent === '1 STARS');
    await capture('star');
    await key('F8');
    await run(() => {
      Math.random = window.savedRandom;
    });
    // Inactive and ready areas are harmless; active areas, real notes and Hold bodies collide.
    await run(async () => {
      const { createChart, createNote, createEvent } = await import('./src/core/chart.ts' as string) as typeof import('../src/core/chart.ts');
      const { createNoiseArea, withNoiseAreas } = await import('./src/core/noise-areas.ts' as string) as typeof import('../src/core/noise-areas.ts');
      const chart = createChart();
      const line = chart.judgeLineList[0];
      line.eventLayers[0].speedEvents = [createEvent(0.1, 0.1, 0, 100)];
      line.notes = [{ ...createNote(1, 100, -400), speed: 0 }, createNote(2, 2, 400, 40)] as Note[];
      const area = createNoiseArea(0, 100);
      area.bottomLeft = { x: -150, y: -300 };
      area.topRight = { x: 150, y: -100 };
      area.activeIntervals = [{ startTime: [8, 0, 1], endTime: [100, 0, 1], readyFlash: 0.5 }];
      const editor = window.rpenMods.editor;
      editor.replace(withNoiseAreas(chart, [area]));
      const context = editor.audio.ensureContext();
      editor.audio.buffer = context.createBuffer(1, context.sampleRate * 30, context.sampleRate);
      editor.seek(0, { music: true });
      await window.rpenMods.manager.setSetting('sky-dodge', 'invincibility', 0.5);
    });
    await key('F8');
    await run(() => ([...document.querySelectorAll('.sky-dodge-dialog button')].at(-1) as HTMLButtonElement).click());
    const noisePoint = await run(() => {
      const renderer = window.rpenMods.editor.preview, rect = renderer.canvas.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 + 200 * renderer.viewScale };
    });
    await pointer(noisePoint);
    await until(() => window.rpenMods.editor.audio.playing);
    await wait(180);
    assert.equal(await run(() => (document.querySelector('.sky-dodge-hearts') as HTMLElement).textContent), '♥♥♥♥♥');
    await run(() => window.rpenMods.editor.seek(3.6, { music: true, pause: false }));
    await wait(90);
    assert.equal(await run(() => window.rpenMods.editor.preview.noisePreview.hitEntries[0].state), 'ready');
    assert.equal(await run(() => (document.querySelector('.sky-dodge-hearts') as HTMLElement).textContent), '♥♥♥♥♥');
    await run(() => window.rpenMods.editor.seek(4.1, { music: true, pause: false }));
    await until(() => (document.querySelector('.sky-dodge-hearts') as HTMLElement).textContent === '♥♥♥♥♡');
    await pointer(safe);
    await wait(600);
    const holdPoint = await run(() => {
      const renderer = window.rpenMods.editor.preview, rect = renderer.canvas.getBoundingClientRect();
      const area = renderer.noteHitAreas.find(entry => entry.type === 2);
      if (!area) throw Error('Hold not visible');
      return { x: rect.left + (area.x1 + area.x2) / 2, y: rect.top + (area.y1 + area.y2) / 2 };
    });
    await pointer(holdPoint);
    await until(() => (document.querySelector('.sky-dodge-hearts') as HTMLElement).textContent === '♥♥♥♡♡');
    await pointer(safe);
    await wait(600);
    const tapPoint = await run(() => {
      const renderer = window.rpenMods.editor.preview, rect = renderer.canvas.getBoundingClientRect();
      const area = renderer.noteHitAreas.find(entry => entry.type === 1)!;
      return { x: rect.left + area.x1, y: rect.top + area.y1 };
    });
    await pointer(tapPoint);
    await until(() => (document.querySelector('.sky-dodge-hearts') as HTMLElement).textContent === '♥♥♡♡♡');
    // Disable while running, then test emergency shortcut after a fresh activation.
    await run(() => window.rpenMods.manager.disable('sky-dodge'));
    assert.equal(await run(() => document.querySelector('.sky-dodge-surface')), null);
    assert.equal(await run(() => document.documentElement.dataset.modEditingLocked), undefined);
    await run(async () => {
      await window.rpenMods.manager.enable('sky-dodge');
      await window.rpenMods.manager.setSetting('sky-dodge', 'toggle-key', 'F9');
    });
    await key('F8');
    assert.equal(await run(() => document.querySelector('.sky-dodge-surface')), null);
    await key('F9');
    await until(() => Boolean(document.querySelector('.sky-dodge-surface')));
    await key('F11', ['control', 'alt', 'shift']);
    await until(() => window.rpenMods.runtime.loaded.size === 0);
    assert.equal(await run(() => document.querySelector('.sky-dodge-surface')), null);
    // Apply the bundled UI skin, including its DOM organization, and keep manager reachable in a locked subtree.
    await run(async () => {
      const manager = window.rpenMods.editor.editorSkins;
      await manager.ready;
      await manager.use('inkline');
      const node = document.querySelector('#mods-open') as HTMLButtonElement;
      window.modButtonLocation = { parent: node.parentElement!, next: node.nextSibling };
      (document.querySelector('.editor-footer') as HTMLElement).append(node);
      window.rpenMods.editor.seek(0, { music: true });
      await window.rpenMods.manager.enable('sky-dodge');
    });
    await key('F9');
    assert.equal(await run(() => (document.querySelector('#mods-open') as HTMLElement).closest('[inert]')), null);
    await capture('inkline-intro');
    await run(() => (document.querySelector('#mods-open') as HTMLElement).click());
    await until(() => window.rpenMods.manager.dialog.open);
    await run(() => window.rpenMods.manager.toggle('sky-dodge'));
    assert.equal(await run(() => document.querySelector('.sky-dodge-surface')), null);
    await capture('inkline-manager');
    assert.notEqual(await run(() => getComputedStyle(document.querySelector('#mod-manager') as HTMLElement).color), 'rgb(0, 0, 0)');
    win.setSize(700, 860);
    await wait(150);
    assert.equal(await run(() => {
      const dialog = document.querySelector('#mod-manager') as HTMLElement;
      const box = dialog.getBoundingClientRect();
      return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight && dialog.scrollWidth <= dialog.clientWidth + 1;
    }), true);
    await capture('compact-manager');
    await run(async () => {
      window.rpenMods.manager.dialog.close();
      const saved = window.modButtonLocation;
      saved.parent.insertBefore(document.querySelector('#mods-open') as Node, saved.next);
      await window.rpenMods.editor.editorSkins.use('default');
    });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ initial, externalConsent: true, multiFileCycles: true, dynamicImport: true, semanticExtension: true, settingsOnce: true, persistence: true, safeBoot: true, textEntry: true, startStop: true, editingLocked: true, pointerPauseResume: true, viewportBorder: true, boundaryWarningWhilePaused: true, penalty: true, loseRetryWin: true, starCollection: true, activeNoiseOnly: true, noteHoldCollisions: true, customShortcut: true, emergency: true, inklineCompatible: true, movedManagerAccessible: true, narrowManager: true, unloadClean: true, chartUnchanged: true, errors }, null, 2));
  } catch (error) {
    console.error((error as Error).stack, errors);
    await capture('test-failure');
    process.exitCode = 1;
  } finally {
    win.destroy();
    app.exit((process.exitCode as number) || 0);
  }
}).catch(error => {
  console.error(error);
  app.exit(1);
});
