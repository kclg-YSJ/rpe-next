import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import type { WebContents } from 'electron';
import type { NativeService } from '../desktop/native-service.ts';
import type { Chart, JudgeLine, Note } from '../src/core/types.ts';

interface EditorSmoke {
  raw: { replaceChart(chart: Chart, chartName: string, assets: Map<string, Uint8Array>, folders: string[]): void };
  chart: Chart;
  chartName: string;
  assets: Map<string, Uint8Array>;
  dirty?: boolean;
  libraryProject: { id: string };
  session: { line: { notes: Note[] }; setMultiLineEnabled(enabled: boolean): void; commit(label: string, chart: Chart): void };
  timeline: { origin: number; noteIndexes: Map<unknown, unknown>; renderNoteScale: number; noteWidth(note: { size?: number }): number; hit(point: { x: number; y: number }): { item: Note } | null; vertical(seconds: number): number; draw(origin: number): void };
  skin: { head: (...args: unknown[]) => boolean };
  activatePane(pane: string): void;
  save(): Promise<void>;
}
interface AssetSmokeWindow {
  rpenMods: { editor: EditorSmoke };
  assetTestProject?: string;
}

export interface SmokeAssetControls {
  openedFolders(action: () => Promise<unknown>): Promise<string[]>;
}

const run = <A extends unknown[], R>(contents: WebContents, fn: (...args: A) => R | Promise<R>, ...args: A): Promise<Awaited<R>> =>
  contents.executeJavaScript('(' + fn.toString() + ')(...' + JSON.stringify(args) + ')', true);

export async function smokeAssetLibrary(contents: WebContents, service: NativeService, controls: SmokeAssetControls): Promise<{ checks: string[] }> {
  const checks = await run(contents, async () => {
    function check(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
    const until = async (condition: () => boolean): Promise<void> => { const deadline = performance.now() + 6000; while (!condition()) { if (performance.now() > deadline) throw Error('Timed out: ' + condition); await new Promise(resolve => setTimeout(resolve, 15)); } };
    const { createChart, createLine, createNote } = await import('/src/core/chart.ts' as string) as typeof import('../src/core/chart.ts');
    const { assetPath } = await import('/src/platform/files.ts' as string) as typeof import('../src/platform/files.ts');
    const w = window as unknown as AssetSmokeWindow;
    const e = w.rpenMods.editor, chart = createChart();
    const canvas = document.createElement('canvas'); canvas.width = 24; canvas.height = 20; const c = canvas.getContext('2d')!; c.fillStyle = '#3377aa'; c.fillRect(0, 0, 24, 20);
    const png = new Uint8Array(await (await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(Error('无法生成图片')), 'image/png'))).arrayBuffer());
    chart.judgeLineList = [createLine(), createLine(), createLine()];
    chart.judgeLineList[0]!.Texture = 'art/same.png'; chart.judgeLineList[1]!.Texture = 'other/same.png';
    chart.META.background = 'art/same.png'; chart.META.name = '素材库测试';
    const assets = new Map(['charts/art/same.png', 'charts/other/same.png', 'free.png', 'shader/Ocean/pattern.png'].map(name => [name, png]));
    assets.set('shader/Ocean/main.glsl', new TextEncoder().encode('void main(){}'));
    e.raw.replaceChart(chart, 'charts/main.json', assets, ['charts/art/empty', 'destination', 'shader/Ocean']);
    const host = document.querySelector('#asset-library') as HTMLElement;
    const open = (): void => { e.activatePane('chart'); (document.querySelector('#assets') as HTMLElement).click(); };
    const row = (path: string): HTMLElement | undefined => [...host.querySelectorAll<HTMLElement>('.asset-row')].find(node => node.dataset.assetPath === path);
    const action = (text: string): void => { const button = [...host.querySelectorAll<HTMLButtonElement>('.asset-detail-actions button')].find(node => node.textContent === text); check(button, 'Missing action: ' + text); button.click(); };
    const apply = async (): Promise<void> => { (document.querySelector('#modal-apply') as HTMLButtonElement).click(); await until(() => !(document.querySelector('#modal') as HTMLDialogElement).open); };
    open();
    check(host.querySelectorAll('.asset-row').length === 3, 'Noise skin image leaked into library');
    const original = e.chart; row('charts/other/same.png')!.click();
    check(e.chart === original && !e.dirty, 'Image selection modified chart or dirtiness');
    check(e.chart.judgeLineList[0].Texture === 'art/same.png', 'Selection changed current line binding');
    check(row('charts/art/same.png')!.querySelector('small')!.textContent === '绑定：0', 'Incorrect same-basename usage');
    check(row('charts/other/same.png')!.querySelector('small')!.textContent === '绑定：1', 'Incorrect same-basename usage');
    const results = ['clicking an image only selects it; same-basename bindings and noise-skin filtering are correct'];
    row('charts/art/same.png')!.click(); action('移动到');
    (document.querySelector('#modal select') as HTMLSelectElement).value = 'destination'; await apply();
    check(e.assets.has('destination/same.png') && !e.assets.has('charts/art/same.png'), 'Image not moved');
    check(assetPath(e.assets, e.chart.judgeLineList[0].Texture, e.chartName) === 'destination/same.png', 'Moved line reference unresolved');
    check(e.chart.judgeLineList[1].Texture === 'other/same.png', 'Unrelated binding changed');
    check(assetPath(e.assets, e.chart.META.background, e.chartName) === 'destination/same.png', 'Background reference not moved');
    action('编辑图片'); await until(() => document.querySelector<HTMLCanvasElement>('.asset-editor-canvas')?.width === 24); await apply();
    check(e.chart.judgeLineList[1].Texture === 'other/same.png' && e.chart.judgeLineList[2].Texture === 'line.png', 'Image editing rebound unrelated lines');
    const selectFolder = (path: string): void => { const group = [...host.querySelectorAll<HTMLElement>('[data-asset-folder]')].find(node => node.dataset.assetFolder === path); check(group, 'Missing folder ' + path); (group.querySelector('summary') as HTMLElement).click(); };
    selectFolder('destination'); action('重命名');
    (document.querySelector('#modal input') as HTMLInputElement).value = 'renamed'; await apply();
    check(e.assets.has('renamed/same.png'), 'Folder rename did not move contents');
    action('移动到'); (document.querySelector('#modal select') as HTMLSelectElement).value = 'charts'; await apply();
    check(e.assets.has('charts/renamed/same.png'), 'Folder move did not move contents');
    check(assetPath(e.assets, e.chart.judgeLineList[0].Texture, e.chartName) === 'charts/renamed/same.png', 'Folder move reference unresolved');
    action('新建子文件夹'); (document.querySelector('#modal input') as HTMLInputElement).value = 'charts/renamed/new-empty'; await apply();
    check(host.querySelector('[data-asset-folder="charts/renamed/new-empty"]'), 'Empty folder not created');
    results.push('image move, content edit, folder rename/move and new empty subfolders preserve references');
    selectFolder('charts/renamed/new-empty'); action('删除文件夹'); await apply();
    check(!host.querySelector('[data-asset-folder="charts/renamed/new-empty"]'), 'Folder delete failed');
    open(); row('free.png')!.click(); action('重命名');
    (document.querySelector('#modal input') as HTMLInputElement).value = 'bad:name.png'; (document.querySelector('#modal-apply') as HTMLButtonElement).click();
    await until(() => (document.querySelector('#modal-error') as HTMLElement).textContent!.includes('无效'));
    check(e.assets.has('free.png') && !e.assets.has('bad:name.png'), 'Invalid rename mutated assets'); (document.querySelector('#modal') as HTMLDialogElement).close();
    const lineHost = document.querySelector('#line-panel') as HTMLElement; e.activatePane('lines');
    check(!lineHost.querySelector('[data-texture="shader/Ocean/pattern.png"]'), 'Noise skin leaked into texture picker');
    check(![...lineHost.querySelectorAll<HTMLOptionElement>('datalist option')].some(node => node.value === 'shader/Ocean/pattern.png'), 'Noise skin leaked into texture suggestions');
    results.push('folder delete and invalid path rollback work; line texture suggestions also exclude skin-owned images');

    // Exercise both draw paths with independent height and a wide note whose centre is offscreen.
    e.activatePane('notes'); e.session.line.notes = [3, 10, 100].map((size, index) => ({ ...createNote(1, 4, index === 2 ? 2500 : 0), size }));
    e.timeline.origin = 4; e.timeline.noteIndexes = new Map(); e.timeline.draw(4);
    const t = e.timeline, base = 68 * t.renderNoteScale;
    check(t.noteWidth({ size: 100 }) === base * 100 && t.noteWidth({ size: 10 }) === base * 10, 'Large width capped');
    const calls: unknown[][] = [], previous = e.skin.head;
    try {
      e.skin.head = (...args: unknown[]) => { calls.push(args); return true; }; t.draw(4);
      check(calls.some(args => args[4] === base * 100), 'Single-line draw capped or culled large note');
      check(calls.every(args => args[8] === base), 'Note height changed with size');
      const hit = t.hit({ x: 20, y: t.vertical(4) });
      check(hit?.item.size === 100, 'Partially visible wide note cannot be selected');
      e.session.setMultiLineEnabled(true); t.origin = 4; calls.length = 0; t.draw(4);
      const multiBase = 68 * t.renderNoteScale;
      check(calls.some(args => args[4] === multiBase * 100), 'Multi-line draw capped large note');
      check(calls.every(args => args[8] === multiBase), 'Multi-line note height changed');
      e.session.setMultiLineEnabled(false);
    } finally { e.skin.head = previous; }
    results.push('size 3/10/100 scales width without capping or changing height, in single/multi-line drawing and hit testing');
    // Restore valid immutable chart updates for the save/reopen checks.
    e.session.commit('测试音符', { ...e.chart, judgeLineList: e.chart.judgeLineList.map((line: JudgeLine, index: number): JudgeLine => index ? line : { ...(line as object), notes: [...e.chart.judgeLineList[0].notes] } as JudgeLine) });
    await e.save(); open();
    w.assetTestProject = e.libraryProject.id;
    return results;
  });
  const id = await run(contents, () => (window as unknown as AssetSmokeWindow).assetTestProject);
  const expected = await service.call<string>('assetFolder', id, 'charts/renamed/same.png', false);
  const opened = await controls.openedFolders(async () => {
    await run(contents, async () => {
      const host = document.querySelector('#asset-library') as HTMLElement;
      const row = [...host.querySelectorAll<HTMLElement>('.asset-row')].find(node => node.dataset.assetPath === 'charts/renamed/same.png'); row!.click();
      [...host.querySelectorAll<HTMLButtonElement>('.asset-detail-actions button')].find(node => node.textContent === '打开所在文件夹')!.click();
      await new Promise(resolve => setTimeout(resolve, 250));
      const group = [...host.querySelectorAll<HTMLElement>('[data-asset-folder]')].find(node => node.dataset.assetFolder === 'charts/art/empty'); (group!.querySelector('summary') as HTMLElement).click();
      [...host.querySelectorAll<HTMLButtonElement>('.asset-detail-actions button')].find(node => node.textContent === '打开文件夹')!.click();
      await new Promise(resolve => setTimeout(resolve, 250));
    });
  });
  assert.deepEqual(opened, [expected, await service.call('assetFolder', id, 'charts/art/empty', true)]);
  assert.ok((await readFile(join(expected, 'same.png'))).length > 0);
  assert.deepEqual(await readdir(opened[1]!), []);
  const reopened = await run(contents, async () => {
    const { readProject } = await import('/src/platform/library.ts' as string) as typeof import('../src/platform/library.ts');
    const w = window as unknown as AssetSmokeWindow;
    const e = w.rpenMods.editor, project = await readProject(w.assetTestProject!);
    e.raw.replaceChart(project!.chart, project!.chartName, new Map(project!.assets), project!.assetFolders ?? []); e.activatePane('assets');
    return { paths: [...e.assets.keys()], folders: project!.assetFolders ?? [], library: (document.querySelector('#asset-library') as HTMLElement).textContent, texture: e.chart.judgeLineList[1].Texture };
  });
  assert.ok(reopened.paths.includes('charts/renamed/same.png'));
  assert.ok(reopened.paths.includes('shader/Ocean/pattern.png'));
  assert.ok(!reopened.library!.includes('pattern.png'));
  assert.ok(reopened.folders.includes('charts/art/empty'));
  assert.equal(reopened.texture, 'other/same.png');
  checks.push('real native IPC opens image parent and empty folder itself; saved/reopened assets keep paths, bindings and skin resources');
  return { checks };
}
