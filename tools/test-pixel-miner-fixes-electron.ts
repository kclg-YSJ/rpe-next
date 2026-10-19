import { app, BrowserWindow } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import type { RpenMods } from './test-spatial-camera-electron.ts';

type Modifier = NonNullable<Electron.InputEvent['modifiers']>[number];
interface Point { x: number; y: number }
interface TestError { testError: string }
interface ConsoleMessageLike { level: string; message: string }
type RenderableEditor = RpenMods['editor'] & { render(): void };

declare global {
  interface Window {
    rpenMods: RpenMods;
    refreshHits: number;
    replacementControl: HTMLButtonElement;
  }
}

const isTestError = (value: unknown): value is TestError =>
  typeof value === 'object' && value !== null && 'testError' in value && typeof (value as TestError).testError === 'string';

const scratch = resolve('.local-tools/pixel-miner-fixes');
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
    const value: unknown = await win.webContents.executeJavaScript('(async()=>{try{return await(' + fn.toString() + ')(...' + JSON.stringify(args) + ')}catch(error){return{testError:error.stack}}})()', true);
    if (isTestError(value)) throw Error(value.testError);
    return value as R;
  };
  const until = async <A extends unknown[]>(fn: (...args: A) => unknown, ...args: A): Promise<void> => {
    const end = Date.now() + 15000;
    while (!await run(fn, ...args)) {
      if (Date.now() > end) throw Error('Timeout ' + fn);
      await wait(60);
    }
  };
  const key = async (value: string, modifiers: Modifier[] = []): Promise<void> => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: value, modifiers });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: value, modifiers });
    await wait(80);
  };
  const at = (selector: string): Promise<Point> => run(selector => {
    const rect = document.querySelector(selector)!.getBoundingClientRect();
    if (!rect.width || !rect.height) throw Error('Not visible: ' + selector);
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  }, selector);
  const move = async (point: Point): Promise<void> => {
    win.webContents.sendInputEvent({ type: 'mouseMove', ...point });
    await wait(40);
  };
  const down = (point: Point): void => win.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 });
  const up = (point: Point): void => win.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 });
  const click = async (point: Point): Promise<void> => {
    await move(point);
    down(point);
    up(point);
    await wait(90);
  };
  const mine = async (selector: string): Promise<void> => {
    const point = await at(selector);
    await move(point);
    down(point);
    await wait(410);
    up(point);
    await wait(40);
  };
  const capture = async (name: string): Promise<void> => {
    writeFileSync(join(scratch, name + '.png'), (await win.webContents.capturePage()).toPNG());
  };
  const inventory = (): Promise<void> => until(() => Boolean(document.querySelector('[data-pm-slot="1"] .pm-item-art')));
  const green = () => run(() => {
    const canvas = document.querySelector('.pm-effects') as HTMLCanvasElement;
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let sum = 0, count = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 1] > 160 && pixels[index] < 150 && pixels[index + 2] < 110 && pixels[index + 3] > 200) {
        sum += Math.floor(index / 4 / canvas.width) / (devicePixelRatio || 1);
        count++;
      }
    }
    return { y: count ? sum / count : null, count, xp: parseFloat((document.querySelector('.pm-xp-fill') as HTMLElement).style.width) };
  });
  try {
    await win.loadURL('http://127.0.0.1:4187');
    win.showInactive();
    await until(() => window.rpenMods?.manager.records.has('pixel-miner'));
    await run(async () => {
      await window.rpenMods.manager.ready;
      document.querySelector<HTMLButtonElement>('#new')!.click();
      await window.rpenMods.manager.enable('pixel-miner');
    });
    // Re-enable through the actual manager, then keep focus on the manager launcher.
    await click(await at('#mods-open'));
    await click(await at('[data-mod-id="pixel-miner"]'));
    const toggle = '#mod-manager .mod-manager-details .mod-manager-toolbar button:first-child';
    await click(await at(toggle));
    await until(() => !window.rpenMods.runtime.loaded.has('pixel-miner'));
    await click(await at(toggle));
    await until(() => window.rpenMods.runtime.loaded.get('pixel-miner')?.status === 'loaded');
    await click(await at('.mod-manager-heading button'));
    await run(() => document.querySelector<HTMLButtonElement>('#mods-open')!.focus());
    await key('F9');
    await key('3');
    assert.equal(await run(() => document.querySelector('[data-pm-slot="2"]')!.getAttribute('aria-pressed')), 'true');
    await key('1');
    await run(() => window.rpenMods.manager.setSetting('pixel-miner', 'mine-duration', 0.3));
    await mine('#bpm');
    await until(() => Boolean(document.querySelector('.pm-drop')));
    const frame = await run(() => {
      const style = getComputedStyle(document.querySelector('.pm-drop')!);
      return { width: parseFloat(style.width), height: parseFloat(style.height), border: parseFloat(style.borderTopWidth) };
    });
    assert.equal(frame.width, 52);
    assert.equal(frame.height, 52);
    assert.equal(frame.border, 2);
    const first = await green();
    assert.ok(first.count > 0);
    await wait(500);
    const fallen = await green();
    assert.ok(fallen.count > 0 && fallen.y! > first.y! + 60, JSON.stringify({ first, fallen }));
    assert.equal(fallen.xp, 0);
    await capture('orbs-falling');
    await inventory();
    await until(() => parseFloat((document.querySelector('.pm-xp-fill') as HTMLElement).style.width) > 0);
    await key('F9', ['control', 'shift']);
    // Skins must not reclaim a mined control or move a placed one; switching skin preserves custody.
    await run(() => window.rpenMods.editor.editorSkins.use('inkline'));
    await mine('#bpm');
    for (let index = 0; index < 3; index++) {
      await run(() => window.rpenMods.editor.editorSkins.runtime.sync());
      await wait(80);
    }
    assert.equal(await run(() => document.querySelector('#bpm')!.closest('.pm-stash') !== null), true);
    assert.equal(await run(() => document.querySelector('#bpm')!.getBoundingClientRect().width), 0);
    await inventory();
    await key('2');
    await click({ x: 850, y: 420 });
    await run(() => window.rpenMods.editor.editorSkins.runtime.sync());
    assert.equal(await run(() => document.querySelector('#bpm')!.closest('[data-pm-placement]') !== null), true);
    await capture('skin-custody');
    await run(() => window.rpenMods.editor.editorSkins.use('default'));
    assert.equal(await run(() => document.querySelector('#bpm')!.closest('[data-pm-placement]') !== null), true);
    await key('F9', ['control', 'shift']);
    assert.equal(await run(() => document.querySelector('#bpm')!.parentElement!.matches('.action-grid')), true);
    // Click caption text, not the tiny native checkbox; the entire toggle is mined.
    const pitch = await run(() => (document.querySelector('#preserve-pitch') as HTMLInputElement).checked);
    await mine('label.preserve-pitch span');
    assert.equal(await run(() => document.querySelector('#preserve-pitch')!.closest('.pm-stash') !== null), true);
    assert.equal(await run(() => (document.querySelector('#preserve-pitch') as HTMLInputElement).checked), pitch);
    await inventory();
    await key('2');
    await click({ x: 840, y: 380 });
    await key('F9');
    await click(await at('label.preserve-pitch span'));
    assert.equal(await run(() => (document.querySelector('#preserve-pitch') as HTMLInputElement).checked), !pitch);
    await key('F9');
    await key('1');
    const snap = await run(() => (document.querySelector('#snap-x') as HTMLInputElement).checked);
    await mine('label:has(#snap-x)');
    assert.equal(await run(() => document.querySelector('#snap-x')!.closest('.pm-stash') !== null), true);
    assert.equal(await run(() => (document.querySelector('#snap-x') as HTMLInputElement).checked), snap);
    await capture('toggles-mined');
    await key('F9', ['control', 'shift']);
    assert.equal(await run(() => (document.querySelector('#preserve-pitch') as HTMLInputElement).checked), !pitch);
    assert.equal(await run(() => document.querySelector('#snap-x')!.closest('.pm-stash')), null);
    // A freshly rendered field with the same identity must not respawn outside inventory.
    await run(() => {
      const form = document.createElement('form');
      form.id = 'refresh-fixture';
      form.style.cssText = 'position:fixed;left:100px;top:230px;z-index:1000';
      const button = document.createElement('button');
      button.id = 'refresh-control';
      button.type = 'button';
      button.textContent = 'Original';
      form.append(button);
      document.body.append(form);
      window.refreshHits = 0;
    });
    await mine('#refresh-control');
    await inventory();
    await run(() => {
      const button = document.createElement('button');
      button.id = 'refresh-control';
      button.type = 'button';
      button.textContent = 'Updated';
      button.onclick = () => window.refreshHits++;
      window.replacementControl = button;
      document.querySelector('#refresh-fixture')!.replaceChildren(button);
    });
    await until(() => document.querySelector('#refresh-control')?.closest('.pm-stash'));
    assert.equal(await run(() => document.querySelectorAll('#refresh-control').length), 1);
    await key('2');
    await click({ x: 830, y: 450 });
    await key('F9');
    await click(await at('#refresh-control'));
    assert.equal(await run(() => window.refreshHits), 1);
    await run(() => window.rpenMods.manager.disable('pixel-miner'));
    assert.equal(await run(() => document.querySelector('#refresh-control') === window.replacementControl), true);
    assert.equal(await run(() => document.querySelectorAll('[data-pm-placement],[data-pm-placeholder]').length), 0);
    // Inspector inputs have semantic field keys instead of IDs, and are rebuilt after edits.
    await run(async () => {
      document.querySelector('#refresh-fixture')!.remove();
      await window.rpenMods.manager.enable('pixel-miner');
      const { createNote } = await import('./src/core/chart.ts' as string) as typeof import('../src/core/chart.ts');
      window.rpenMods.editor.session.insertNotes([createNote(1, 4, 50)]);
      window.rpenMods.editor.activatePane('notes');
    });
    await key('F9');
    await mine('#properties input[data-rpen-field="positionX"]');
    await run(() => (window.rpenMods.editor as RenderableEditor).render());
    await until(() => !document.querySelector('#properties input[data-rpen-field="positionX"]'));
    await inventory();
    await key('2');
    await click({ x: 810, y: 500 });
    await run(() => (window.rpenMods.editor as RenderableEditor).render());
    await until(() => document.querySelector('[data-pm-placement] input[data-rpen-field="positionX"]'));
    await key('F9');
    await run(() => {
      const field = document.querySelector('[data-pm-placement] input[data-rpen-field="positionX"]') as HTMLInputElement;
      field.value = '123';
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await until(() => window.rpenMods.editor.chart.judgeLineList[0].notes[0].positionX === 123);
    await run(() => window.rpenMods.manager.disable('pixel-miner'));
    assert.equal(await run(() => (document.querySelector('#properties input[data-rpen-field="positionX"]') as HTMLInputElement).value), '123');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ reenableNumericKeys: true, experienceFallsThenWaits: true, dropSquareOutline: true, largerDrops: true, skinCannotRespawnMined: true, skinCannotMovePlaced: true, skinSwitchRestoresOrigin: true, pitchAndSnapLabels: true, checkboxStateAndFunction: true, dynamicReplacementRetained: true, inspectorFieldsRetained: true, unloadRestores: true, errors }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.stack : error, errors);
    await capture('failure');
    process.exitCode = 1;
  } finally {
    win.destroy();
    app.exit((process.exitCode as number | undefined) || 0);
  }
}).catch((error: unknown) => {
  console.error(error);
  app.exit(1);
});
