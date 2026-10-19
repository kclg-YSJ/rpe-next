import { app, BrowserWindow } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import type { RpenMods } from './test-spatial-camera-electron.ts';

type Modifier = NonNullable<Electron.InputEvent['modifiers']>[number];
interface Point { x: number; y: number }
interface TestError { testError: string }
interface ConsoleMessageLike { level: string; message: string }
interface PickaxePixels { pickaxeSprite(): HTMLCanvasElement }
type OpenableManager = RpenMods['manager'] & { open(): Promise<void> };
type RenderableEditor = RpenMods['editor'] & { render(): void };

declare global {
  interface Window {
    rpenMods: RpenMods;
    minerClicks: number;
    minerDelegates: number;
    minerValue: string;
    minerOriginals: Element[];
    minerChart: string;
    minerHistory: number;
  }
}

const isTestError = (value: unknown): value is TestError =>
  typeof value === 'object' && value !== null && 'testError' in value && typeof (value as TestError).testError === 'string';

const scratch = resolve('.local-tools/pixel-miner-tests');
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
    const result: unknown = await win.webContents.executeJavaScript('(async()=>{try{return await (' + fn.toString() + ')(...' + JSON.stringify(args) + ')}catch(error){return{testError:error.stack}}})()', true);
    if (isTestError(result)) throw Error(result.testError);
    return result as R;
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
  const at = (selector: string): Promise<Point> => run(value => {
    const rect = document.querySelector(value)!.getBoundingClientRect();
    if (!rect.width || !rect.height) throw Error('Not visible: ' + value);
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
    await wait(80);
  };
  const capture = async (name: string): Promise<void> => {
    await wait(80);
    writeFileSync(join(scratch, name + '.png'), (await win.webContents.capturePage()).toPNG());
  };
  const mine = async (selector: string): Promise<void> => {
    const point = await at(selector);
    await move(point);
    down(point);
    await wait(410);
    up(point);
    await wait(50);
  };
  const slot = (number: number): string => '[data-pm-slot="' + number + '"]';
  try {
    await win.loadURL('http://127.0.0.1:4187');
    win.showInactive();
    await until(() => window.rpenMods?.manager.records.has('pixel-miner'));
    const sprite = await run(async () => {
      const { pickaxeSprite } = await import('./assets/mods/pixel-miner/pixels.mjs' as string) as PickaxePixels;
      const sprite = pickaxeSprite(), context = sprite.getContext('2d')!, pixels = context.getImageData(0, 0, 20, 20).data;
      for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) {
        const at = (y * 20 + x) * 4;
        if (pixels[at + 1] > pixels[at] * 1.25 && pixels[at + 2] > 100) {
          const other = ((20 - x) * 20 + (20 - y)) * 4;
          if (20 - y < 0 || 20 - y >= 20 || 20 - x < 0 || 20 - x >= 20 || pixels.slice(at, at + 4).some((value, index) => value !== pixels[other + index])) throw Error('Asymmetric pickaxe head ' + x + ',' + y);
        }
      }
      const image = document.createElement('canvas');
      image.width = image.height = 240;
      const enlarged = image.getContext('2d')!;
      enlarged.imageSmoothingEnabled = false;
      enlarged.drawImage(sprite, 0, 0, 240, 240);
      return image.toDataURL();
    });
    writeFileSync(join(scratch, 'pickaxe.png'), Buffer.from(sprite.split(',')[1], 'base64'));
    await run(async () => {
      document.querySelector<HTMLButtonElement>('#new')!.click();
      const host = window.rpenMods;
      await host.manager.enable('pixel-miner');
      await host.manager.setSetting('pixel-miner', 'mine-duration', 0.9);
      const form = document.createElement('form');
      form.id = 'miner-fixture';
      form.style.cssText = 'position:fixed;left:70px;top:220px;width:490px;padding:16px;background:#334051;z-index:1000;display:flex;flex-wrap:wrap;gap:12px;border:1px solid #678';
      window.minerClicks = 0;
      window.minerDelegates = 0;
      form.addEventListener('click', event => {
        const target = event.target as Element | null;
        if (target?.matches('button')) window.minerDelegates++;
      });
      form.addEventListener('input', event => {
        const target = event.target as HTMLInputElement | null;
        if (target?.id === 'miner-value') window.minerValue = target.value;
      });
      for (let index = 0; index < 10; index++) {
        const button = document.createElement('button');
        button.id = 'miner-button-' + index;
        button.type = 'button';
        button.textContent = '控件 ' + index;
        button.addEventListener('click', () => window.minerClicks++);
        form.append(button);
      }
      const input = document.createElement('input');
      input.id = 'miner-value';
      input.value = 'test';
      input.setAttribute('aria-label', '数值测试控件');
      form.append(input);
      document.body.append(form);
      window.minerOriginals = [...form.children];
      window.minerChart = JSON.stringify(host.editor.chart);
      window.minerHistory = host.editor.session.history.undoStack.length;
    });
    await key('F9');
    assert.equal(await run(() => document.documentElement.dataset.pmTool), 'pickaxe');
    assert.equal(await run(() => document.querySelectorAll('.pm-slot').length), 9);
    await capture('hotbar');
    const first = await at('#miner-button-0');
    await move(first);
    down(first);
    await wait(130);
    await capture('cracks');
    up(first);
    await wait(100);
    assert.equal(await run(() => window.minerClicks), 0);
    assert.equal(await run(() => document.querySelectorAll('.pm-drop').length), 0);
    await run(() => window.rpenMods.manager.setSetting('pixel-miner', 'mine-duration', 0.3));
    await mine('#miner-button-0');
    await until(() => document.querySelector('.pm-drop'));
    assert.equal(await run(() => window.minerClicks), 0);
    await capture('drop');
    await until(() => document.querySelector('[data-pm-slot="1"] .pm-item-art'));
    await key('2');
    assert.equal(await run(() => document.querySelector('.pm-item-name')!.textContent), '控件 0');
    assert.equal(await run(() => document.documentElement.dataset.pmTool), 'item');
    await capture('held');
    const placePoint = { x: 850, y: 420 };
    await click(placePoint);
    assert.equal(await run(() => document.querySelector('[data-pm-slot="1"] .pm-item-art')), null);
    assert.equal(await run(() => document.querySelector('#miner-button-0') === window.minerOriginals[0]), true);
    assert.equal(await run(() => (document.querySelector('#miner-button-0') as HTMLButtonElement).form === document.querySelector('#miner-fixture')), true);
    await key('F9');
    assert.equal(await run(() => document.documentElement.dataset.pmTool), undefined);
    assert.equal(await run(() => (document.querySelector('.pm-hotbar') as HTMLElement).hidden), true);
    await click(await at('#miner-button-0'));
    assert.equal(await run(() => window.minerClicks), 1);
    assert.equal(await run(() => window.minerDelegates), 1);
    await key('F9');
    await key('1');
    await mine('#miner-button-0');
    await until(() => document.querySelector('[data-pm-slot="1"] .pm-item-art'));
    // Text entry does not select slots; wheel input still reaches the timeline.
    await run(() => (document.querySelector('#miner-value') as HTMLInputElement).focus());
    await key('3');
    assert.equal(await run(() => document.querySelector('[data-pm-slot="0"]')!.getAttribute('aria-pressed')), 'true');
    await run(() => (document.querySelector('#miner-value') as HTMLInputElement).blur());
    const wheelPoint = await at('#notes');
    await run(() => window.rpenMods.editor.seek(2, { music: true }));
    const beforeTime = await run(() => window.rpenMods.editor.audio.time);
    await move({ x: wheelPoint.x, y: wheelPoint.y + 160 });
    win.webContents.sendInputEvent({ type: 'mouseWheel', x: wheelPoint.x, y: wheelPoint.y + 160, deltaX: 0, deltaY: -120 });
    await wait(100);
    assert.notEqual(await run(() => window.rpenMods.editor.audio.time), beforeTime);
    // A field placed after its panel is hidden still dispatches original delegated form changes.
    await mine('#miner-value');
    await until(() => document.querySelector('[data-pm-slot="2"] .pm-item-art'));
    await key('3');
    await run(() => (document.querySelector('#miner-fixture') as HTMLElement).style.display = 'none');
    await click({ x: 850, y: 480 });
    await key('F9');
    await until(() => document.querySelector('#miner-value')!.getBoundingClientRect().width > 0);
    await run(() => {
      const input = document.querySelector('#miner-value') as HTMLInputElement;
      input.value = 'changed';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    assert.equal(await run(() => window.minerValue), 'changed');
    await capture('placed-field');
    await key('F9');
    await key('1');
    await mine('#miner-value');
    await run(() => (document.querySelector('#miner-fixture') as HTMLElement).style.display = 'flex');
    await until(() => document.querySelector('[data-pm-slot="2"] .pm-item-art'));
    for (let index = 1; index <= 7; index++) await mine('#miner-button-' + index);
    await wait(3000);
    assert.equal(await run(() => document.querySelectorAll('.pm-slot .pm-item-art').length), 8);
    assert.equal(await run(() => document.querySelectorAll('.pm-drop').length), 1);
    assert.ok(Number(await run(() => document.querySelector('.pm-level')!.textContent)) > 0);
    await capture('full');
    const dropBefore = await run(() => (document.querySelector('.pm-drop') as HTMLElement).style.transform);
    await key('F9');
    await wait(180);
    assert.equal(await run(() => document.querySelectorAll('.pm-drop').length), 1);
    assert.notEqual(await run(() => (document.querySelector('.pm-drop') as HTMLElement).style.transform), dropBefore);
    await key('F9');
    await key('2');
    await click({ x: 900, y: 430 });
    await until(() => document.querySelectorAll('.pm-drop').length === 0);
    assert.equal(await run(() => document.querySelectorAll('.pm-slot .pm-item-art').length), 8);
    // Dedicated restore preserves actual control identity, values, styles, listeners and chart state.
    await key('F9', ['control', 'shift']);
    assert.equal(await run(() => document.querySelectorAll('.pm-drop,[data-pm-placement],[data-pm-placeholder]').length), 0);
    assert.equal(await run(() => window.minerOriginals.every(node => node.parentElement === document.querySelector('#miner-fixture'))), true);
    assert.equal(await run(() => (document.querySelector('#miner-value') as HTMLInputElement).value), 'changed');
    assert.equal(await run(() => document.querySelector('#miner-value')!.getAttribute('form')), null);
    assert.equal(await run(() => document.querySelectorAll('.pm-slot .pm-item-art').length), 0);
    // Mine a real editor tool and activate it after placement.
    await mine('#metadata');
    await until(() => document.querySelector('[data-pm-slot="1"] .pm-item-art'));
    await key('2');
    await click({ x: 880, y: 420 });
    await key('F9');
    await click(await at('#metadata'));
    assert.equal(await run(() => window.rpenMods.editor.activePane), 'metadata');
    await run(() => window.rpenMods.manager.disable('pixel-miner'));
    assert.equal(await run(() => document.querySelector('[data-pm-root]')), null);
    assert.equal(await run(() => document.querySelectorAll('[data-pm-placement],[data-pm-placeholder]').length), 0);
    assert.equal(await run(() => JSON.stringify(window.rpenMods.editor.chart)), await run(() => window.minerChart));
    assert.equal(await run(() => window.rpenMods.editor.session.history.undoStack.length), await run(() => window.minerHistory));
    assert.equal(await run(() => document.querySelector('#metadata')!.closest('.action-grid') !== null), true);
    assert.equal(await run(() => document.documentElement.dataset.pmTool), undefined);
    await run(async () => {
      document.querySelector('#miner-fixture')!.remove();
      await window.rpenMods.editor.editorSkins.use('inkline');
      await window.rpenMods.manager.enable('pixel-miner');
      window.rpenMods.editor.activatePane('chart');
    });
    await key('F9');
    await mine('#preferences');
    await until(() => document.querySelector('[data-pm-slot="1"] .pm-item-art'));
    await key('2');
    await click({ x: 850, y: 450 });
    await key('F9');
    await click(await at('#preferences'));
    await until(() => (document.querySelector('#settings-modal') as HTMLDialogElement).open);
    await capture('inkline-settings');
    await run(() => (document.querySelector('#settings-modal') as HTMLDialogElement).close());
    await key('F9');
    await key('1');
    await run(() => (window.rpenMods.manager as OpenableManager).open());
    await until(() => (document.querySelector('#mod-manager') as HTMLDialogElement).open);
    assert.equal(await run(() => getComputedStyle(document.querySelector('#mods-open')!).cursor), 'auto');
    await run(() => window.rpenMods.manager.dialog.close());
    win.setSize(700, 850);
    await wait(120);
    assert.equal(await run(() => {
      const rect = document.querySelector('.pm-hotbar')!.getBoundingClientRect();
      return rect.left >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight;
    }), true);
    assert.equal(await run(() => getComputedStyle(document.querySelector('.pm-slot')!).borderRadius), '0px');
    await capture('compact');
    await run(async () => {
      await window.rpenMods.manager.disable('pixel-miner');
      await window.rpenMods.editor.editorSkins.use('default');
    });
    win.setSize(1440, 960);
    await run(async () => {
      await window.rpenMods.manager.enable('pixel-miner');
      window.rpenMods.editor.activatePane('chart');
    });
    await key('F9');
    await mine('#notes');
    await until(() => document.querySelector('[data-pm-slot="1"] .pm-item-art'));
    await key('2');
    await click({ x: 620, y: 460 });
    assert.equal(await run(() => document.querySelector('#notes')!.closest('[data-pm-placement]') !== null), true);
    await run(() => window.rpenMods.manager.disable('pixel-miner'));
    assert.equal(await run(() => document.querySelector('#notes')!.closest('[data-pm-placement]')), null);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ symmetricPickaxe: true, hotbar: true, miningCracks: true, shortPressCancelled: true, dropAndExperience: true, holdAndPlace: true, actualNodeAndListeners: true, delegatedFormPortal: true, textInputSafe: true, wheelPreserved: true, fullInventoryDropWaits: true, freeSlotAbsorbs: true, togglePreserves: true, restoreShortcut: true, realEditorButton: true, canvasControl: true, unloadRestores: true, inklineCompatible: true, managerReachable: true, narrowToolbar: true, chartUnchanged: true, errors }, null, 2));
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
