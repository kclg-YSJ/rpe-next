import { app, BrowserWindow } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import type { RpenMods } from './test-spatial-camera-electron.ts';

type Modifier = NonNullable<Electron.InputEvent['modifiers']>[number];
interface Point { x: number; y: number }
interface Rect extends Point { width: number; height: number }
interface TestError { testError: string }
interface ConsoleMessageLike { level: string; message: string }
interface PlacementTest {
  name: string;
  tag: 'button' | 'input';
  width: number;
  height: number;
  point?: Point;
  edge?: boolean;
  skin?: string;
}

declare global {
  interface Window {
    rpenMods: RpenMods;
  }
}

const isTestError = (value: unknown): value is TestError =>
  typeof value === 'object' && value !== null && 'testError' in value && typeof (value as TestError).testError === 'string';

const scratch = resolve('.local-tools/pixel-miner-placement');
mkdirSync(scratch, { recursive: true });
app.setPath('userData', join(scratch, 'profile-' + Date.now()));
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1440, height: 960, show: false, webPreferences: { backgroundThrottling: false } });
  win.webContents.on('will-prevent-unload', event => event.preventDefault());
  const errors: string[] = [], checks: string[] = [];
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
  const move = (point: Point): void => win.webContents.sendInputEvent({ type: 'mouseMove', ...point });
  const down = (point: Point): void => win.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 });
  const up = (point: Point): void => win.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 });
  const rect = (selector: string): Promise<Rect> => run(selector => {
    const rect = document.querySelector(selector)!.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, width: rect.width, height: rect.height };
  }, selector);
  const sameCenter = (actual: Point, expected: Point, label: string): void => {
    assert.ok(Math.abs(actual.x - expected.x) < 0.2 && Math.abs(actual.y - expected.y) < 0.2, JSON.stringify({ label, actual, expected }));
  };
  const preview = async (point: Point): Promise<Rect> => {
    move(point);
    await wait(90);
    return rect('.pm-hand .pm-item-art');
  };
  const place = async (point: Point): Promise<void> => {
    move(point);
    down(point);
    up(point);
    await wait(100);
  };
  const mine = async (selector: string): Promise<void> => {
    await run(() => (document.activeElement as HTMLElement | null)?.blur());
    await key('1');
    const center = await rect(selector), point = { x: Math.round(center.x), y: Math.round(center.y) };
    move(point);
    await wait(50);
    down(point);
    await wait(410);
    up(point);
    await until(() => Boolean(document.querySelector('[data-pm-slot="1"] .pm-item-art')));
    await key('2');
  };
  try {
    await win.loadURL('http://127.0.0.1:4187');
    win.showInactive();
    await until(() => window.rpenMods?.manager.records.has('pixel-miner'));
    await run(async () => {
      await window.rpenMods.manager.ready;
      document.querySelector<HTMLButtonElement>('#new')!.click();
      await window.rpenMods.manager.enable('pixel-miner');
      window.rpenMods.manager.setSetting('pixel-miner', 'mine-duration', 0.3);
    });
    await key('F9');
    for (const test of [
      { name: 'button', tag: 'button', width: 110, height: 34, point: { x: 780, y: 360 } },
      { name: 'wide-input', tag: 'input', width: 310, height: 28, point: { x: 800, y: 400 } },
      { name: 'tall-button', tag: 'button', width: 56, height: 130, point: { x: 800, y: 380 } },
      { name: 'top-left-clamp', tag: 'button', width: 180, height: 64, point: { x: 1, y: 1 } },
      { name: 'bottom-right-clamp', tag: 'button', width: 200, height: 60, edge: true },
      { name: 'inkline', tag: 'button', width: 125, height: 36, point: { x: 810, y: 420 }, skin: 'inkline' }
    ] as PlacementTest[]) {
      await run(async test => {
        if (test.skin) await window.rpenMods.editor.editorSkins.use(test.skin);
        const fixture = document.createElement('form');
        fixture.id = 'placement-fixture';
        fixture.style.cssText = 'position:fixed;left:170px;top:250px;z-index:1000;line-height:100px';
        const control = test.tag === 'button' ? document.createElement('button') : document.createElement('input');
        control.id = 'placement-target';
        if (control instanceof HTMLButtonElement) {
          control.type = 'button';
          control.textContent = 'Placement';
        } else control.value = 'Wide input';
        control.style.cssText = `width:${test.width}px;height:${test.height}px;min-width:0;min-height:0;margin:0;box-sizing:border-box`;
        fixture.append(control);
        document.body.append(fixture);
      }, test);
      await mine('#placement-target');
      const point = test.edge ? await run(() => ({ x: innerWidth - 2, y: innerHeight - 2 })) : test.point!;
      const expected = await preview(point);
      const visible = await run(() => {
        const art = document.querySelector('.pm-hand .pm-item-art')!;
        const control = art.shadowRoot!.firstElementChild!.firstElementChild!;
        const rect = control.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      });
      sameCenter(visible, expected, test.name + ' preview content');
      await place(point);
      const actual = await rect('#placement-target');
      sameCenter(actual, expected, test.name);
      sameCenter(await rect('[data-pm-placement]'), expected, test.name + ' wrapper');
      if (test.name === 'button') {
        await run(() => {
          const control = document.createElement('button');
          control.id = 'placement-target';
          control.type = 'button';
          control.textContent = 'Rebuilt';
          control.style.cssText = 'width:180px;height:42px';
          document.querySelector('#placement-fixture')!.replaceChildren(control);
        });
        await until(() => document.querySelector('[data-pm-placement] #placement-target')?.textContent === 'Rebuilt');
        sameCenter(await rect('#placement-target'), expected, 'panel rebuild');
        checks.push('panel rebuild preserves center');
      }
      checks.push(test.name);
      await key('F9', ['control', 'shift']);
      await run(() => document.querySelector('#placement-fixture')!.remove());
    }
    await run(() => window.rpenMods.editor.editorSkins.use('default'));
    // Move and click in one native input batch: placement must use the latest pointer, not a stale rendered rectangle.
    await run(() => {
      const button = document.createElement('button');
      button.id = 'fast-placement';
      button.type = 'button';
      button.textContent = 'Fast';
      button.style.cssText = 'position:fixed;left:170px;top:250px;width:120px;height:36px';
      document.body.append(button);
    });
    await mine('#fast-placement');
    const old = { x: 650, y: 330 }, last = await preview(old), point = { x: 850, y: 470 };
    await place(point);
    sameCenter(await rect('#fast-placement'), { x: last.x + point.x - old.x, y: last.y + point.y - old.y }, 'fast pointer placement');
    checks.push('fast pointer placement');
    writeFileSync(join(scratch, 'aligned.png'), (await win.webContents.capturePage()).toPNG());
    await run(() => window.rpenMods.manager.disable('pixel-miner'));
    assert.equal(await run(() => document.querySelectorAll('[data-pm-placement],[data-pm-placeholder]').length), 0);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ checks, errors }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.stack : error, errors);
    writeFileSync(join(scratch, 'failure.png'), (await win.webContents.capturePage()).toPNG());
    process.exitCode = 1;
  } finally {
    win.destroy();
    app.exit((process.exitCode as number | undefined) || 0);
  }
}).catch((error: unknown) => {
  console.error(error);
  app.exit(1);
});
