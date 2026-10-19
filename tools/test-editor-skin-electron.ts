import { app, BrowserWindow } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import type { EditorSkins } from '../src/ui/editor-skins.ts';
import type { Timeline } from '../src/ui/timeline.ts';
import type { EditorSession } from '../src/application/session.ts';

declare global {
  interface Window {
    themeManager: EditorSkins;
    themeSession: EditorSession;
    themeTimeline: Timeline;
    skinSyncs: number;
    chartBeforeSkin: string;
    defaultUi: { root: string; save: string; saveParent: string; font: string };
    testErrors: string[];
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
  const until = async (callback: () => unknown): Promise<void> => { const end = Date.now() + 15000; while (!await run(callback)) { if (Date.now() > end) throw Error('timeout ' + callback + ': ' + await run(() => document.querySelector<HTMLElement>('#editor-skin-settings [role=status]')!?.textContent)); await wait(80); } };
  try {
    await win.loadURL(process.env.RPE_SKIN_TEST_URL || 'http://127.0.0.1:4187'); win.showInactive(); await wait(300);
    await run(async () => {
      window.testErrors = []; window.addEventListener('error', event => window.testErrors.push(event.message));
      const { EditorSkins } = await import('./src/ui/editor-skins.ts' as string) as typeof import('../src/ui/editor-skins.ts'); const original = EditorSkins.prototype.importFiles;
      EditorSkins.prototype.importFiles = function (...args) { window.themeManager = this; return original.apply(this, args); };
      const { EditorSkinRuntime } = await import('./src/ui/editor-skin-runtime.ts' as string) as typeof import('../src/ui/editor-skin-runtime.ts'); const sync = EditorSkinRuntime.prototype.sync;
      window.skinSyncs = 0; EditorSkinRuntime.prototype.sync = function (...args) { window.skinSyncs++; return sync.apply(this, args); };
      const { Timeline } = await import('./src/ui/timeline.ts' as string) as typeof import('../src/ui/timeline.ts'); const draw = Timeline.prototype.draw;
      Timeline.prototype.draw = function (...args) { window.themeTimeline = this; window.themeSession = this.getSession() as unknown as EditorSession; return draw.apply(this, args); };
      document.querySelector<HTMLElement>('#new')!.click();
    }); await until(() => !!window.themeSession);
    await run(async () => {
      const { createNote, createEvent } = await import('./src/core/chart.ts' as string) as typeof import('../src/core/chart.ts'); const session = window.themeSession;
      session.insertNotes([createNote(1, .5, -200), createNote(3, 1, 0), createNote(4, 1.5, 200)]);
      const line = session.chart.judgeLineList[0]; const layer = { ...line.eventLayers[0], moveXEvents: [createEvent(-100, 100, .4, 1.4)] };
      session.commit('UI QA', { ...session.chart, judgeLineList: [{ ...line, eventLayers: [layer] }] });
      document.querySelector<HTMLElement>('#preferences')!.click();
      window.defaultUi = { root: getComputedStyle(document.documentElement).backgroundColor, save: document.querySelector<HTMLElement>('#save')!.textContent, saveParent: document.querySelector<HTMLElement>('#save')!.parentElement!.tagName, font: getComputedStyle(document.body).fontFamily };
      window.chartBeforeSkin = JSON.stringify(session.chart);
    });
    const { editorSkinFixture } = await import('../test/fixtures/editor-skin.ts');
    const { exportEditorSkin } = await import('../src/platform/editor-skins.ts');
    const zip = [...new Uint8Array(await exportEditorSkin(editorSkinFixture()).arrayBuffer())];
    await run(bytes => { const input = document.querySelector<HTMLInputElement>('[aria-label="导入编辑器皮肤包"]')!; const transfer = new DataTransfer(); transfer.items.add(new File([new Uint8Array(bytes)], 'test-skin.rpenskin')); input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true })); }, zip);
    await until(() => window.themeManager?.records.has('test-skin'));
    assert.equal(await run(() => document.documentElement.dataset.editorSkin), undefined);
    const builtinInkline = await run(async () => {
      const manager = window.themeManager; const record = manager.records.get('inkline')!;
      if (!record?.builtin || ![...manager.select.options].some(option => option.value === 'inkline' && option.textContent === '墨线 Inkline(cmdysj)')) throw Error('Inkline is unavailable without import');
      await manager.use('inkline'); if (!manager.deleteButton.disabled || getComputedStyle(manager.recovery).display !== 'none') throw Error('builtin skin deletion or persistent recovery state incorrect');
      if (manager.appearanceDisclosure.hidden || manager.appearanceDisclosure.open || manager.appearanceDisclosure.tagName !== 'DETAILS') throw Error('editor skin parameters must start collapsed');
      manager.appearanceDisclosure.querySelector('summary')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      if (!manager.appearanceDisclosure.open) throw Error('editor skin parameters cannot expand');
      const beatDisplay = document.querySelector<HTMLElement>('#beat-display')!;
      if (!beatDisplay.textContent!.endsWith(' 拍') || beatDisplay.dataset.ui !== 'beat-display' || getComputedStyle(beatDisplay).display === 'none') throw Error('Inkline is missing the current beat readout');
      const parameter = manager.appearance.querySelector<HTMLInputElement>('[data-skin-parameter=event-fill]')!; parameter.value = '#12db86'; parameter.dispatchEvent(new Event('change', { bubbles: true }));
      for (let count = 0; count < 50 && manager.runtime.prepared!.record.skin.canvas!.palette!['#e58d24'] !== '#12db86'; count++) await new Promise(resolve => requestAnimationFrame(resolve));
      if (manager.runtime.prepared!.record.skin.canvas!.palette!['#e58d24'] !== '#12db86') throw Error('builtin Inkline parameter failed');
      if (!manager.appearanceDisclosure.open) throw Error('editing a skin parameter must keep its disclosure open');
      await manager.resetParameters('inkline'); if (String(manager.runtime.prepared!.record.skin.canvas!.palette!['#e58d24']) !== '#4d6476') throw Error('builtin Inkline defaults failed');
      document.querySelector<HTMLDialogElement>('#settings-modal')!.close(); document.querySelector<HTMLElement>('#noise-areas-tool')!.click();
      await new Promise(resolve => requestAnimationFrame(resolve));
      const noiseCanvas = document.querySelector<HTMLElement>('#noise-editor-canvas')!;
      if (noiseCanvas.hidden || getComputedStyle(noiseCanvas).backgroundColor !== 'rgba(0, 0, 0, 0)') throw Error('Inkline noise editor must keep a transparent background');
      const stage = getComputedStyle(document.querySelector<HTMLElement>('.stage')!).backgroundColor;
      const pixelCanvas = document.createElement('canvas'); pixelCanvas.width = pixelCanvas.height = 1;
      const pixelContext = pixelCanvas.getContext('2d')!; pixelContext.fillStyle = stage; pixelContext.fillRect(0, 0, 1, 1);
      const stagePixel = pixelContext.getImageData(0, 0, 1, 1).data;
      if (stagePixel[3] !== 255 || stagePixel.slice(0, 3).some(channel => channel > 80)) throw Error('Inkline noise editor lost its dark workspace background');
      document.querySelector<HTMLElement>('#close-noise-editor')!.click(); document.querySelector<HTMLElement>('#preferences')!.click();
      const confirm = window.confirm; window.confirm = () => { throw Error('builtin deletion must be rejected before confirmation'); };
      try { await manager.remove(); } finally { window.confirm = confirm; }
      if (!manager.records.has('inkline')) throw Error('builtin skin was deleted');
      await manager.use('default'); if (!manager.appearanceDisclosure.hidden) throw Error('default skin should not show an empty parameter disclosure');
      manager.select.value = 'test-skin'; manager.showDetails(); if (manager.appearanceDisclosure.open) throw Error('switching skins must start with collapsed parameters'); return true;
    });
    await run(() => [...document.querySelectorAll<HTMLElement>('.editor-skin-actions button')].find(button => button.textContent === '应用')!.click());
    await until(() => document.documentElement.dataset.editorSkin === 'test-skin'); await wait(200);
    assert.equal(await run(() => getComputedStyle(document.querySelector<HTMLElement>('rpen-skin-recovery')!).display), 'none');
    const applied = await run(() => ({ root: getComputedStyle(document.documentElement).backgroundColor, background: getComputedStyle(document.querySelector<HTMLElement>('.editor')!).backgroundColor, save: document.querySelector<HTMLElement>('#save')!.textContent, group: document.querySelector<HTMLElement>('#save')!.closest<HTMLElement>('[data-skin-group]')?.dataset.skinGroup, font: getComputedStyle(document.body).fontFamily, cssSheets: document.adoptedStyleSheets.length }));
    assert.equal(applied.root, 'rgb(38, 40, 43)'); assert.equal(applied.background, 'rgb(41, 44, 48)'); assert.equal(applied.group, 'project'); assert.ok(applied.save.includes('保存谱面'));
    assert.equal(await run(() => getComputedStyle(document.querySelector<HTMLElement>('#save')!, '::before').backgroundImage.startsWith('url("blob:')), true);
    assert.equal(await run(() => getComputedStyle(document.querySelector<HTMLElement>('#save')!, '::before').filter), 'none');
    const idleStart = await run(() => window.skinSyncs); await wait(400);
    assert.ok((await run(() => window.skinSyncs)) - idleStart < 4, 'skin synchronization must not rebuild the editor indefinitely');
    // Flush the new stylesheet and wait for its initial color transitions to settle.
    await until(() => getComputedStyle(document.querySelector<HTMLElement>('#editor-skin-settings button')!).backgroundColor === 'rgb(56, 56, 56)');
    const controlColors = await run(() => ['#editor-skin-settings button', '#play', '#open', '#rate'].map(selector => { const style = getComputedStyle(document.querySelector<HTMLElement>(selector)!); return { selector, background: style.backgroundColor, inputToken: style.getPropertyValue('--rpen-input') }; }));
    assert.equal(controlColors[0].background, 'rgb(56, 56, 56)');
    assert.equal(controlColors[3].background, 'rgb(56, 56, 56)');
    writeFileSync('.local-tools/editor-skin-settings.png', (await win.webContents.capturePage()).toPNG());
    await run(() => document.querySelector<HTMLDialogElement>('#settings-modal')!.close()); await wait(200); writeFileSync('.local-tools/editor-skin-test-skin.png', (await win.webContents.capturePage()).toPNG());
    // The original action nodes and listeners remain functional after grouping.
    await run(() => document.querySelector<HTMLElement>('#save')!.click()); await until(() => !window.themeSession.history.dirty);
    const extra = await run(async () => {
      const { parseEditorSkin } = await import('./src/core/editor-skin.ts' as string) as typeof import('../src/core/editor-skin.ts');
      const { drawClipboardThumbnail } = await import('./src/ui/clipboard-history.ts' as string) as typeof import('../src/ui/clipboard-history.ts');
      const thumbnail = document.createElement('canvas'); drawClipboardThumbnail(thumbnail, { notes: [], events: [] } as unknown as Parameters<typeof drawClipboardThumbnail>[1]);
      const pixel = [...thumbnail.getContext('2d')!.getImageData(0, 0, 1, 1).data];
      if (JSON.stringify(pixel) !== '[39,49,58,255]') throw Error('detached clipboard thumbnail was not recolored: ' + pixel);
      const manager = window.themeManager; const base = manager.records.get('test-skin')!;
      const fontBytes = new Uint8Array(await (await fetch('./assets/rpe/fonts/cmdysj.ttf')).arrayBuffer());
      const skin = structuredClone(base.skin); skin.id = 'font-check'; skin.assets!.ui = { type: 'font', path: 'ui.ttf' }; skin.tokens!['font-family'] = 'font(ui), sans-serif';
      skin.hide = ['@migrate', '@recover', '#skin-hidden-fixture'];
      skin.texts!.push({ selector: '#skin-state-fixture', text: '静止' }, { selector: '#skin-state-fixture.active', text: '活动' });
      const files = new Map(base.files); files.set('ui.ttf', fontBytes); files.set('skin.json', new TextEncoder().encode(JSON.stringify(skin)));
      const parsed = parseEditorSkin(files); manager.records.set(skin.id, parsed); await manager.use(skin.id);
      const migrate = document.querySelector<HTMLElement>('#migrate')!;
      if (getComputedStyle(migrate).display !== 'none' || migrate.getClientRects().length) throw Error('hide did not remove control from layout');
      const hidden = document.createElement('input'); hidden.id = 'skin-hidden-fixture'; hidden.value = 'keep-value'; hidden.style.display = 'inline-block'; document.body.append(hidden);
      if (getComputedStyle(hidden).display !== 'none') throw Error('hide failed for dynamically created control with inline display');
      hidden.focus(); if (document.activeElement === hidden) throw Error('hidden control received focus');
      hidden.style.display = 'flex'; if (getComputedStyle(hidden).display !== 'none') throw Error('application display update bypassed hide');
      const family = manager.runtime.prepared!.fonts.get('ui');
      if (!document.fonts.check(`13px "${family}"`)) throw Error('local skin font did not load');
      const fixture = document.createElement('button'); fixture.id = 'skin-state-fixture'; fixture.textContent = '原文'; document.body.append(fixture);
      manager.runtime.sync(); if (fixture.textContent !== '静止') throw Error('base text override failed');
      fixture.className = 'active'; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (String(fixture.textContent) !== '活动') throw Error('state text override failed');
      fixture.className = ''; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (fixture.textContent !== '静止') throw Error('state text restoration failed');
      await manager.use('default'); if (String(fixture.textContent) !== '原文') throw Error('original text restoration failed'); fixture.remove();
      if (document.querySelector<HTMLElement>('#migrate') !== migrate || getComputedStyle(migrate).display === 'none') throw Error('hidden command not restored with original node');
      if (getComputedStyle(hidden).display !== 'flex' || hidden.value !== 'keep-value') throw Error('control state changed or display not restored');
      hidden.focus(); if (document.activeElement !== hidden) throw Error('restored control could not receive focus'); hidden.remove();
      if (document.fonts.check(`13px "${family}"`) && [...document.fonts].some(font => font.family === family)) throw Error('font not released');
      const rejected = [];
      for (const source of ['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.test/x.png"/></svg>']) {
        const invalid = { ...base.skin, id: 'unsafe-test', preview: 'x', assets: { x: { type: 'image', path: 'x.svg' } }, styles: [], icons: {}, decorations: [] };
        const entry = parseEditorSkin(new Map([['skin.json', new TextEncoder().encode(JSON.stringify(invalid))], ['x.svg', new TextEncoder().encode(source)]]));
        try { await manager.runtime.prepare(entry); throw Error('unsafe SVG unexpectedly accepted'); } catch (error) { const message = error instanceof Error ? error.message : String(error); if (/unexpectedly/.test(message)) throw error; rejected.push(message); }
      }
      await manager.use('test-skin');
      if (JSON.stringify(window.themeSession.chart) !== window.chartBeforeSkin) throw Error('theme application changed chart data');
      return { font: family, stateTexts: true, hideRestored: true, unsafeSvgRejected: rejected.length, detachedThumbnail: true, chartUnchanged: true };
    });
    const api2 = await run(async () => {
      const { parseEditorSkin } = await import('./src/core/editor-skin.ts' as string) as typeof import('../src/core/editor-skin.ts'); const { editorSkinState, editorSkinSignal } = await import('./src/ui/editor-skin-state.ts' as string) as typeof import('../src/ui/editor-skin-state.ts');
      const manager = window.themeManager; const base = manager.records.get('test-skin')!; const skin = structuredClone(base.skin); skin.id = 'api-two-check';
      skin.assets!.native = { type: 'image', builtin: 'save' }; skin.assets!.mark.sources = [{ path: 'images/mark2.svg', scale: 2 }];
      skin.variants = { day: { name: '日间', colorScheme: 'light', tokens: { 'surface-alt': '#e1ecfa' } }, night: { name: '夜间', colorScheme: 'dark', tokens: { 'surface-alt': '#172330' } } };
      skin.systemVariants = { light: 'day', dark: 'night' };
      skin.styles!.push(
        { selector: '[data-skin-group=project]', set: { gap: '13px', 'flex-direction': 'column' } },
        { media: '(width > 1px), (aspect-ratio < 1/4)', rules: [{ selector: '@root', set: { '--rpen-gap': '9px', 'color-scheme': 'light' } }] },
        { selector: '@root[data-rpen-dirty=true]', set: { '--skin-state-color': '#123456' } },
        { selector: '.skin-query-label', set: { color: '#999999' } },
        { container: '(width <= 240px)', rules: [{ supports: '(display: grid)', rules: [{ selector: '.skin-query-label', set: { color: '#010203' } }] }] },
        { selector: '#skin-size-fixture', set: { width: '23px', height: '23px' }, important: ['width', 'height'] },
        { selector: '@root[data-rpen-event-save-succeeded=true]', set: { '--skin-event-check': 'yes' } },
      );
      skin.organize!.push({ slot: 'toolbar', id: 'tabs-test', items: ['tab-notes', 'tab-events'] }, { slot: 'footer', id: 'time-test', items: ['line-controls', 'beat-controls', 'seek'] });
      skin.icons = [{ selector: '#skin-icon-fixture[data-on=true]', asset: 'native' }];
      skin.decorations!.push({ id: 'extra-mark', selector: '@inspector-tabs', asset: 'mark', placement: 'after' });
      skin.canvas!.targets = { density: { palette: { '#56b9d4': '#ff00ff' } }, history: { palette: { '#c69b55': '#00ffcc' } } };
      const files = new Map(base.files); files.set('images/mark2.svg', files.get('images/mark.svg')!); files.set('skin.json', new TextEncoder().encode(JSON.stringify(skin)));
      const parsed = parseEditorSkin(files); manager.records.set(skin.id, parsed); await manager.use(skin.id);
      const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (getComputedStyle(document.querySelector<HTMLElement>('[data-skin-group=project]')!).gap !== '13px') throw Error('group gap is still blocked by inline style');
      if (getComputedStyle(document.querySelector<HTMLElement>('[data-skin-group=project]')!).flexDirection !== 'column') throw Error('group direction could not be restyled');
      if (getComputedStyle(document.documentElement).getPropertyValue('--rpen-gap').trim() !== '9px') throw Error('root/media token override failed');
      if (!document.querySelector<HTMLElement>('.editor-toolbar [data-pane=notes]')! || !document.querySelector<HTMLElement>('footer .line-select-group')!) throw Error('new organize slots failed');
      document.querySelector<HTMLElement>('[data-pane=events]')!.click(); if (document.documentElement.dataset.rpenPane !== 'events') throw Error('moved tab action or global pane state failed');
      const fixture = document.createElement('div'); fixture.style.cssText = 'container-type:inline-size;width:200px';
      const label = document.createElement('span'); label.className = 'skin-query-label'; label.textContent = 'container'; fixture.append(label); document.body.append(fixture);
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.id = 'skin-size-fixture'; fixture.append(checkbox);
      const icon = document.createElement('button'); icon.id = 'skin-icon-fixture'; icon.dataset.on = 'true'; fixture.append(icon);
      await frame(); if (getComputedStyle(label).color !== 'rgb(1, 2, 3)') throw Error('container/supports rule not active');
      if (getComputedStyle(checkbox).width !== '23px') throw Error('restricted important dimensions failed');
      if (!getComputedStyle(icon, '::before').backgroundImage.startsWith('url("blob:')) throw Error('selector/state builtin icon not active');
      if (!manager.runtime.prepared!.imageSets.get('mark')?.startsWith('image-set(')) throw Error('high DPI variants not prepared');
      editorSkinState({ dirty: true }); if (getComputedStyle(document.documentElement).getPropertyValue('--skin-state-color').trim() !== '#123456') throw Error('global dirty-state selector failed');
      editorSkinSignal('save-succeeded'); await frame(); if (getComputedStyle(document.documentElement).getPropertyValue('--skin-event-check').trim() !== 'yes') throw Error('save signal failed');
      manager.drafts[skin.id].variant = 'night'; await manager.use(skin.id);
      if (manager.runtime.prepared!.record.skin.colorScheme !== 'dark') throw Error('variant did not apply');
      manager.select.value = skin.id; manager.showDetails(); const width = manager.appearance.querySelector<HTMLInputElement>('[data-skin-parameter=panel-width]')!; width.value = '400'; width.dispatchEvent(new Event('change'));
      for (let count = 0; count < 20 && manager.runtime.prepared!.record.skin.tokens!['param-panel-width'] !== '400px'; count++) await frame();
      if (manager.runtime.prepared!.record.skin.tokens!['param-panel-width'] !== '400px') throw Error('user parameter did not preview');
      manager.confirmPreview();
      if (getComputedStyle(manager.recovery).display !== 'none') throw Error('preview confirmation left a persistent recovery button');
      const options = JSON.parse(localStorage.getItem('rpe-next-editor-skin-options-v1')!);
      if (options[skin.id]?.parameters['panel-width'] !== 400 || options[skin.id]?.variant !== 'night') throw Error('skin appearance preferences were not persisted');
      const pixelCount = (id: string, matches: (red: number, green: number, blue: number, alpha: number) => boolean) => { const canvas = document.querySelector<HTMLCanvasElement>(id)!; const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data; let count = 0; for (let offset = 0; offset < pixels.length; offset += 4) if (matches(pixels[offset], pixels[offset + 1], pixels[offset + 2], pixels[offset + 3])) count++; return count; };
      await frame(); const densityPixels = pixelCount('#note-density', (red, green, blue, alpha) => red > 180 && green < 30 && blue > 180 && alpha > 20);
      if (!densityPixels) throw Error('offscreen note density bars were not recolored');
      fixture.remove(); await manager.use('test-skin'); document.querySelector<HTMLElement>('[data-pane=notes]')!.click();
      if (!document.querySelector<HTMLElement>('.inspector-tabs [data-pane=notes]')! || !document.querySelector<HTMLElement>('.transport .line-select-group')!) throw Error('moved controls not restored');
      const dev = { protocol: 'rpen-editor-skin', version: 1, id: 'dev-check', name: '开发检查', tokens: { surface: '#112233' } };
      manager.directoryHandle = { async *values() { yield { kind: 'file', name: 'skin.json', getFile: async () => new File([JSON.stringify(dev)], 'skin.json') }; } } as unknown as FileSystemDirectoryHandle;
      await manager.reloadDirectory(); await manager.use(dev.id); dev.tokens.surface = '#223344'; await manager.reloadDirectory();
      if (manager.runtime.prepared!.record.skin.tokens!.surface !== '#223344' || !manager.previewTimer) throw Error('development folder reload did not preview new content');
      await manager.use('test-skin');
      return { containerQueries: true, rootTokens: true, groupOverrides: true, movedTabsAndInputs: true, restrictedImportant: true, builtinIcon: true, highDpi: true, signals: true, variants: true, userParameters: true, persistedAppearance: true, developmentReload: true, densityPixels };
    });
    const parameterReset = await run(async () => {
      const manager = window.themeManager; manager.drafts['test-skin'].parameters = { 'panel-width': 480, accent: '#123456' }; await manager.use('test-skin');
      manager.select.value = 'test-skin'; manager.showDetails();
      const other = structuredClone(manager.options['api-two-check']); manager.resetParametersButton.click();
      for (let count = 0; count < 50 && manager.runtime.prepared!.record.skin.tokens!['param-panel-width'] !== '350px'; count++) await new Promise(resolve => requestAnimationFrame(resolve));
      if (manager.current !== 'test-skin' || manager.runtime.prepared!.record.skin.tokens!['param-panel-width'] !== '350px' || manager.runtime.prepared!.record.skin.tokens!['param-accent'] !== '#2469d9') throw Error('reset button did not apply package defaults');
      if (Object.keys(JSON.parse(localStorage.getItem('rpe-next-editor-skin-options-v1')!)['test-skin'].parameters).length) throw Error('reset defaults not persisted');
      if (JSON.stringify(manager.options['api-two-check']) !== JSON.stringify(other)) throw Error('reset changed another skin');
      const variant = manager.options['api-two-check'].variant; manager.select.value = 'api-two-check'; manager.showDetails(); await manager.resetParameters('api-two-check');
      if (manager.current !== 'test-skin' || manager.options['api-two-check']!.variant !== variant || Object.keys(manager.options['api-two-check']!.parameters!).length) throw Error('resetting inactive skin changed current skin or variant');
      manager.drafts['test-skin'].parameters = { accent: '#654321' }; await manager.use('test-skin', true);
      return { button: true, inactiveSkinReset: true, variantPreserved: true };
    });
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'BACKSPACE', modifiers: ['control', 'alt', 'shift'] });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'BACKSPACE', modifiers: ['control', 'alt', 'shift'] });
    await until(() => window.themeManager.runtime.prepared!.record.skin.tokens!['param-accent'] === '#2469d9' && !window.themeManager.previewTimer);
    assert.equal(await run(() => window.themeManager.current), 'test-skin');
    const deletion = await run(async () => {
      const manager = window.themeManager; manager.drafts['test-skin'].parameters = { 'panel-width': 480 }; await manager.use('test-skin');
      const confirm = window.confirm; window.confirm = () => true;
      try { manager.select.value = 'test-skin'; await manager.remove(); } finally { window.confirm = confirm; }
      if (manager.records.has('test-skin') || manager.options['test-skin'] || manager.drafts['test-skin'] || JSON.parse(localStorage.getItem('rpe-next-editor-skin-options-v1')!)['test-skin']) throw Error('deleted skin retained saved appearance or draft');
      if (manager.current !== 'default') throw Error('removing active skin did not restore default');
      return true;
    });
    await run(bytes => { const input = document.querySelector<HTMLInputElement>('[aria-label="导入编辑器皮肤包"]')!; const transfer = new DataTransfer(); transfer.items.add(new File([new Uint8Array(bytes)], 'test-skin.rpenskin')); input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true })); }, zip);
    await until(() => window.themeManager.records.has('test-skin'));
    await run(async () => {
      const manager = window.themeManager; await manager.use('test-skin');
      if (manager.runtime.prepared!.record.skin.tokens!['param-panel-width'] !== '350px' || Object.keys(manager.options['test-skin']!.parameters!).length) throw Error('reimport restored deleted parameter values');
      const options = JSON.parse(localStorage.getItem('rpe-next-editor-skin-options-v1')!); options['orphaned-skin'] = { variant: 'base', parameters: { accent: '#654321' } }; localStorage.setItem('rpe-next-editor-skin-options-v1', JSON.stringify(options));
    });
    const defaultUiSnapshot = await run(() => window.defaultUi);
    await win.reload(); await until(() => document.documentElement.dataset.editorSkin === 'test-skin');
    assert.equal(await run(() => Object.hasOwn(JSON.parse(localStorage.getItem('rpe-next-editor-skin-options-v1')!), 'orphaned-skin')), false);
    await run(async defaults => {
      window.defaultUi = defaults;
      const { EditorSkins } = await import('./src/ui/editor-skins.ts' as string) as typeof import('../src/ui/editor-skins.ts'); const importFiles = EditorSkins.prototype.importFiles;
      EditorSkins.prototype.importFiles = function (...args) { window.themeManager = this; return importFiles.apply(this, args); };
      // Expose the restored manager without changing its installed package or current appearance.
      const input = document.querySelector<HTMLElement>('[aria-label="导入编辑器皮肤包"]')!; input.dispatchEvent(new Event('change', { bubbles: true }));
      document.querySelector<HTMLElement>('#new')!.click();
    }, defaultUiSnapshot); await wait(160);
    await run(() => document.querySelector<HTMLElement>('#noise-areas-tool')!.click()); await wait(180);
    assert.equal(await run(() => !document.querySelector<HTMLCanvasElement>('#noise-editor-canvas')!.hidden), true);
    writeFileSync('.local-tools/editor-skin-noise.png', (await win.webContents.capturePage()).toPNG());
    await run(() => { document.querySelector<HTMLElement>('#close-noise-editor')!.click(); document.querySelector<HTMLElement>('#multi-line-toggle')!.click(); }); await wait(180);
    assert.equal(await run(() => document.querySelector<HTMLElement>('.editor')!.classList.contains('multi-notes')), true);
    writeFileSync('.local-tools/editor-skin-multi.png', (await win.webContents.capturePage()).toPNG());
    await run(() => { document.querySelector<HTMLElement>('#multi-line-toggle')!.click(); document.querySelector<HTMLElement>('#library')!.click(); }); await wait(180);
    assert.equal(await run(() => !document.querySelector<HTMLElement>('#home')!.hidden), true);
    writeFileSync('.local-tools/editor-skin-home.png', (await win.webContents.capturePage()).toPNG());
    await run(() => document.querySelector<HTMLElement>('#resume-editor')!.click());
    await run(async () => { await window.themeManager.use('default'); });
    assert.equal(await run(() => document.querySelector<HTMLElement>('#save')!.textContent === window.defaultUi.save), true);
    assert.equal(await run(() => document.querySelector<HTMLElement>('#save')!.parentElement!.tagName), 'NAV');
    assert.equal(await run(() => getComputedStyle(document.documentElement).backgroundColor === window.defaultUi.root), true);
    assert.equal(await run(() => getComputedStyle(document.body).fontFamily === window.defaultUi.font), true);
    assert.equal(await run(() => document.querySelector<HTMLElement>('#save')!.hasAttribute('data-ui')), false);
    await run(async () => { await window.themeManager.use('test-skin', true); });
    assert.equal(await run(() => getComputedStyle(window.themeManager.recovery).display), 'block');
    await run(() => { window.themeManager.deadline = Date.now() - 1; });
    await until(() => !document.documentElement.dataset.editorSkin); assert.equal(await run(() => window.themeManager.current), 'default');
    await run(() => window.themeManager.use('test-skin'));
    await win.reload(); await until(() => document.documentElement.dataset.editorSkin === 'test-skin');
    assert.equal(await run(() => getComputedStyle(document.querySelector<HTMLElement>('rpen-skin-recovery')!).display), 'none');
    // Fresh startup retains Inkline as the only builtin.
    assert.deepEqual(await run(async () => (await (await fetch('./assets/editor-skins/index.json')).json() as { directory: string }[]).map((entry: { directory: string }) => entry.directory)), ['inkline']);
    await run(() => document.querySelector<HTMLElement>('#new')!.click()); await wait(200);
    for (const [width, height] of [[1000, 680], [600, 800]]) {
      win.setContentSize(width, height); await wait(160);
      const size = await run(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth, editor: document.querySelector<HTMLElement>('.editor')!.getBoundingClientRect().width, inspector: document.querySelector<HTMLElement>('.inspector')!.getBoundingClientRect().width, timeRight: document.querySelector<HTMLElement>('.time-readouts')!.getBoundingClientRect().right, beatVisible: document.querySelector<HTMLElement>('#beat-display')!.getBoundingClientRect().width > 0 }));
      assert.equal(size.beatVisible, true); assert.ok(size.timeRight <= size.width + 1);
      assert.ok(size.scroll <= size.width + 2); assert.ok(size.editor > 200 && size.inspector > 200); writeFileSync('.local-tools/editor-skin-' + width + 'x' + height + '.png', (await win.webContents.capturePage()).toPNG());
    }
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'F12', modifiers: ['control', 'alt', 'shift'] });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'F12', modifiers: ['control', 'alt', 'shift'] });
    await until(() => !document.documentElement.dataset.editorSkin);
    assert.deepEqual(errors, []);
    await run(() => localStorage.setItem('rpe-next-active-editor-skin-v1', 'missing-test-skin')); await win.reload();
    await until(() => document.querySelector<HTMLElement>('#editor-skin-settings [role=status]')!?.textContent.includes('找不到已保存的皮肤'));
    assert.equal(await run(() => document.documentElement.hasAttribute('data-editor-skin')), false);
    console.log(JSON.stringify({ applied, builtinInkline, extra, api2, parameterReset, parameterResetHotkey: true, deleteClearsAppearance: deletion, reimportDefaults: true, orphanedPreferencesCleaned: true, missingSkinWarning: true, previewTimeout: true, restoredOnStartup: true, widths: [1440, 1000, 600], resetHotkey: true, errors }, null, 2)); win.destroy(); app.exit(0);
  } catch (error) { console.error(error instanceof Error ? error.stack : String(error), errors); try { writeFileSync('.local-tools/editor-skin-failure.png', (await win.webContents.capturePage()).toPNG()); } catch {} win.destroy(); app.exit(1); }
});
