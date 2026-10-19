import { app, BrowserWindow } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import type { Beat, Chart, ChartEvent } from '../src/core/types.ts';
import type { EditorSession } from '../src/application/session.ts';
import type { Timeline } from '../src/ui/timeline.ts';
import type { Preview } from '../src/ui/preview.ts';
import type { PreviewViewport } from '../src/core/editor-display.ts';
import type { LineGuide } from '../src/core/preview-guides.ts';
import type { TempoMap } from '../src/core/tempo.ts';
import type { EditorSkins } from '../src/ui/editor-skins.ts';
import type { ModRecord } from '../src/ui/mod-runtime.ts';
import type { ModManager } from '../src/ui/mod-manager.ts';
import type { AudioBufferLike, AudioContextLike } from '../src/platform/audio.ts';

type Modifier = NonNullable<Electron.InputEvent['modifiers']>[number];
type Point = { x: number; y: number };
type CameraAxisId = 'x' | 'y' | 'z' | 'yaw' | 'pitch' | 'roll' | 'fov';
type TestChart = Chart & { globalEvents: NonNullable<Chart['globalEvents']> };

interface TestError { testError: string }
interface ConsoleMessageLike { level: string; message: string }

export interface CameraAxis {
  type: 'position' | 'rotation' | 'lens';
  id: CameraAxisId;
  name: string;
  unit: string;
  fallback: number;
  min: number;
  max: number;
  slider: [number, number];
  step: number;
  drag: number;
  presets: number[];
}
export interface CameraPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
  fov: number;
}
interface CameraFrame {
  width: number;
  height: number;
  scale: number;
  viewport: PreviewViewport;
}
interface CameraProjected { x: number; y: number; depth: number }
interface PlaneCameraLike {
  project(point: { x: number; y: number; z?: number }): CameraProjected;
}
interface PlaneCameraConstructor {
  new (pose: CameraPose, frame: CameraFrame): PlaneCameraLike;
}
export interface CameraModel {
  AXES: CameraAxis[];
  DEFAULT_POSE: CameraPose;
  PlaneCamera: PlaneCameraConstructor;
  orbitPose(yaw?: number, pitch?: number, distance?: number, roll?: number): CameraPose;
}
export interface CameraOptions {
  cameraFollowsChart(chart: Chart): boolean;
  withCameraFollow(chart: Chart, manifest: unknown, enabled: boolean): Chart;
}

interface GlobalColumnEntry {
  key: string;
  type: { id: string };
  column: { id: string };
  events: ChartEvent[];
}
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
interface GlobalChange { type: string; column: string; events: ChartEvent[] }
interface GlobalRegistration {
  id: string;
  name: string;
  width?: number;
  columns: { id: string; name: string }[];
}
interface ModGlobalEvents {
  open(): void;
  read(type: string, column: string): GlobalEventRecord[];
  replace(type: string, column: string, events: unknown[]): void;
  register(definition: GlobalRegistration): () => void;
}
interface GlobalDocumentEditor {
  eventSelection: Set<string>;
  eventClipboard: unknown[];
  notify(): void;
}
interface GlobalDocument {
  columns: GlobalColumnEntry[];
  types: { id: string; readonly?: boolean }[];
  editor: GlobalDocumentEditor;
  read(type: string, column: string): GlobalEventRecord[];
  apply(changes: GlobalChange[], label: string): void;
}
interface GlobalTimeline {
  eventLabels: string[];
  eventsCanvas: HTMLCanvasElement;
  scale: number;
  eventColumnBounds(column: number): { left: number; width: number; channelWidth: number };
  vertical(beat: number): number;
}
interface GlobalEvents {
  document: GlobalDocument;
  timeline: GlobalTimeline;
  selection: Set<string>;
  canvas: HTMLCanvasElement;
  geometry: { left: number; width: number }[];
  active: boolean;
  inspector: { render(): void };
  open(): void;
}
interface CameraApi {
  manifest: unknown;
  package: { import(name: string): Promise<unknown> };
  globalEvents: ModGlobalEvents;
}
interface CameraHandle {
  kind: 'axis' | 'ring';
  id: string;
  start: Point;
  end: Point;
  screens: Point[];
}
interface CameraScene {
  poses: { start: CameraPose; end: CameraPose };
  handles: CameraHandle[];
}
interface CameraSceneCanvas extends HTMLCanvasElement { cameraScene: CameraScene }
interface CameraBackgroundRestore {
  images: TestPreview['images'];
  alpha: number;
  blur: number;
}
interface CameraRealtimeRestore extends CameraBackgroundRestore {
  visible: boolean;
  ui: boolean;
}
interface EditorAudioContext extends AudioContextLike {
  readonly sampleRate: number;
  createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBuffer;
}
interface EditorAudio {
  buffer: AudioBufferLike | null;
  playing: boolean;
  time: number;
  duration: number;
  ensureContext(): EditorAudioContext;
  seek(seconds: number): void;
}
type TestPreview = Omit<Preview, 'images' | 'viewport' | 'viewScale' | 'guides'> & {
  images?: { background?: CanvasImageSource | null };
  viewport: PreviewViewport;
  viewScale: number;
  guides: LineGuide[];
  spatialCameraState: CameraPose;
};
interface Editor {
  chart: TestChart;
  session: EditorSession;
  timeline: Timeline;
  preview: TestPreview;
  realtimePreview: TestPreview;
  globalEvents: GlobalEvents;
  audio: EditorAudio;
  editorSkins: EditorSkins;
  tempo: TempoMap;
  assets: Map<string, Uint8Array>;
  activePane: string;
  hasDocument: boolean;
  dirty: boolean;
  globalEventRegistry: { register(definition: unknown): () => void };
  seek(seconds: number, options?: { music?: boolean; pause?: boolean }): void;
  seekBeat(beat: number): void;
  currentBeat(): number;
  chartSeconds(): number;
  commit(label: string, chart: Chart): void;
  replace(chart: Chart, name?: string): void;
  setPreview(enabled: boolean, options?: { autoplay?: boolean }): void;
  invalidate(): void;
  openGlobalEvents(): void;
  activatePane(pane: string): void;
  noiseEditor: { active: boolean; close(): void };
}
interface ModStateLike {
  status: 'loading' | 'loaded' | 'error';
  api?: CameraApi & { settings: { get(key: string): unknown; set(key: string, value: unknown): Promise<void> } };
}
interface ModRuntimeLike {
  loaded: Map<string, ModStateLike>;
  locks: Map<string, Set<unknown>>;
  commands: Map<string, { run(): unknown }>;
}
interface Manager {
  records: Map<string, ModRecord>;
  ready: Promise<void>;
  enable(id: string): Promise<void>;
  disable(id: string): Promise<void>;
  disableAll(): Promise<void>;
  remove(id: string): Promise<void>;
  toggle(id: string): Promise<void>;
  setSetting(id: string, key: string, value: unknown): Promise<void>;
  finishWarning(accepted: boolean): void;
  persist(): void;
  desired: Set<string>;
  options: Record<string, Record<string, unknown> | undefined>;
  busy: boolean;
  warning: HTMLDialogElement;
  dialog: HTMLDialogElement;
  file: HTMLInputElement;
  message: HTMLElement;
}
export interface RpenMods {
  editor: Editor;
  runtime: ModRuntimeLike;
  manager: Manager;
}

declare global {
  interface Window {
    rpenMods: RpenMods;
    flatDraw: Preview['drawScene'];
    fixture: Chart;
    cleanCameraFrame: () => ImageData;
    baselinePixels: ImageData;
    baselineSize: [number, number];
    cameraApi: CameraApi;
    cameraModel: CameraModel;
    cameraOptions: CameraOptions;
    setCameraFollow: (enabled: boolean) => void;
    setCamera: (pose: CameraPose) => void;
    cameraCore: typeof import('../src/core/chart.ts');
    cameraBackgroundRestore: CameraBackgroundRestore;
    cameraTestImage: HTMLImageElement;
    cameraFrame: (renderer: TestPreview) => ImageData;
    fixedCameraFrame: ImageData;
    cameraFollowChart: Chart;
    cameraRealtimeRestore: CameraRealtimeRestore;
    cameraSlider: HTMLInputElement;
    cameraBase: string;
    studioInitial: { start: CameraPose; end: CameraPose };
    conflictChart: Chart;
    conflictHistory: number;
    followSaved: Chart;
    savedCamera: Chart;
  }
}

const isTestError = (value: unknown): value is TestError =>
  typeof value === 'object' && value !== null && 'testError' in value && typeof (value as TestError).testError === 'string';

const scratch = resolve('.local-tools/spatial-camera');
mkdirSync(scratch, { recursive: true });
app.setPath('userData', join(scratch, 'profile-' + Date.now()));
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1440, height: 960, show: false, webPreferences: { backgroundThrottling: false } }), errors: string[] = [], checks: string[] = [];
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
    const end = Date.now() + 20000;
    while (!await run(fn, ...args)) {
      if (Date.now() > end) throw Error('Timeout ' + fn + ' / ' + JSON.stringify(errors));
      await wait(70);
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
  const down = (point: Point): void => win.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(point.x), y: Math.round(point.y), button: 'left', clickCount: 1 });
  const up = (point: Point): void => win.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(point.x), y: Math.round(point.y), button: 'left', clickCount: 1 });
  const capture = async (name: string): Promise<void> => writeFileSync(join(scratch, name + '.png'), (await win.webContents.capturePage()).toPNG());
  try {
    await win.loadURL('http://127.0.0.1:4187');
    win.showInactive();
    await until(() => window.rpenMods?.manager.records.has('spatial-camera'));
    await run(async () => {
      await window.rpenMods.manager.ready;
      const e = window.rpenMods.editor;
      (document.querySelector('#new') as HTMLElement).click();
      const { createChart, createLine, createEvent, createNote } = await import('./src/core/chart.ts' as string) as typeof import('../src/core/chart.ts');
      const { createNoiseArea } = await import('./src/core/noise-areas.ts' as string) as typeof import('../src/core/noise-areas.ts');
      const chart = createChart();
      chart.META.name = 'Camera TEST';
      chart.META.level = 'TEST';
      chart.judgeLineList = [];
      for (const [x, y, color] of [[-280, 180, [255, 40, 40]], [300, -180, [30, 255, 60]], [180, 220, [40, 80, 255]]] as [number, number, [number, number, number]][]) {
        const line = createLine();
        line.eventLayers[0].moveXEvents = [createEvent(x)];
        line.eventLayers[0].moveYEvents = [createEvent(y)];
        line.extended.colorEvents = [createEvent(color)];
        line.extended.scaleXEvents = [createEvent(.1)];
        line.extended.scaleYEvents = [createEvent(3)];
        chart.judgeLineList.push(line);
      }
      const note = { ...createNote(4, 20, 80), speed: 0, tint: [255, 255, 0], yOffset: 80 };
      chart.judgeLineList[0].notes = [note];
      chart.blockAreaList = [{ ...createNoiseArea(0, 30), Name: 'Camera noise', bottomLeft: { x: -100, y: -70 }, topRight: { x: 100, y: 70 }, activeIntervals: [{ startTime: [0, 0, 1], endTime: [30, 0, 1], readyFlash: 0 }] }];
      e.replace(chart, 'camera-test.json');
      e.setPreview(true, { autoplay: false });
      e.preview.showGameUI = false;
      e.preview.lineNumbers = false;
      e.preview.lineArrows = false;
      e.preview.lineTint = false;
      e.preview.pickPreviewLines = true;
      e.preview.pickPreviewNoiseAreas = true;
      e.seek(1);
      e.invalidate();
      window.flatDraw = e.preview.drawScene;
      window.fixture = structuredClone(chart);
    });
    await run(() => document.fonts.ready);
    await wait(150);
    await run(() => {
      window.cleanCameraFrame = () => {
        const e = window.rpenMods.editor, r = e.preview, c = r.canvas.getContext('2d')!;
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.clearRect(0, 0, r.canvas.width, r.canvas.height);
        r.draw(e.chart, e.tempo, 1, 0);
        return c.getImageData(0, 0, r.canvas.width, r.canvas.height);
      };
      window.baselinePixels = window.cleanCameraFrame();
      window.baselineSize = [window.baselinePixels.width, window.baselinePixels.height];
    });
    await run(() => window.rpenMods.manager.enable('spatial-camera'));
    await wait(100);
    assert.equal(await run(() => window.rpenMods.editor.globalEvents.document.columns.length), 8);
    const neutral = await run(() => {
      const r = window.rpenMods.editor.preview, actual = window.cleanCameraFrame(), before = window.baselinePixels;
      let count = 0, max = 0, left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
      for (let i = 0; i < actual.data.length; i += 4) {
        let delta = 0;
        for (let j = 0; j < 4; j++) delta = Math.max(delta, Math.abs(actual.data[i + j] - before.data[i + j]));
        if (delta) {
          count++;
          max = Math.max(max, delta);
          const x = (i / 4) % actual.width, y = Math.floor(i / 4 / actual.width);
          left = Math.min(left, x);
          right = Math.max(right, x);
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
        }
      }
      return { count, max, left, right, top, bottom, beforeSize: window.baselineSize, afterSize: [actual.width, actual.height], pose: r.spatialCameraState };
    });
    assert.equal(neutral.count, 0, JSON.stringify(neutral));
    checks.push('default is pixel-identical and seven axes registered');
    await run(async () => {
      const api = window.rpenMods.runtime.loaded.get('spatial-camera')!.api!;
      window.cameraApi = api;
      window.cameraModel = await api.package.import('camera.ts') as CameraModel;
      window.cameraOptions = await api.package.import('settings.ts') as CameraOptions;
      window.setCameraFollow = enabled => window.rpenMods.editor.commit('Camera follow fixture', window.cameraOptions.withCameraFollow(window.rpenMods.editor.chart, api.manifest, enabled));
      window.setCamera = pose => {
        const { AXES } = window.cameraModel;
        const { createEvent } = window.cameraCore;
        window.rpenMods.editor.globalEvents.document.apply(AXES.map(axis => ({ type: 'spatial-camera/' + axis.type, column: axis.id, events: [createEvent(pose[axis.id], pose[axis.id], 0, 30)] })), 'Camera fixture');
      };
      window.cameraCore = await import('./src/core/chart.ts' as string) as typeof import('../src/core/chart.ts');
      window.setCamera(window.cameraModel.orbitPose(28, -24, 1000, 12));
    });
    await wait(150);
    const projection = await run(() => {
      const e = window.rpenMods.editor, r = e.preview, frame = { width: r.canvas.clientWidth, height: r.canvas.clientHeight, scale: r.viewScale, viewport: r.viewport }, camera = new window.cameraModel.PlaneCamera(r.spatialCameraState, frame), states = r.scene.sample(e.chartSeconds()), ratio = devicePixelRatio || 1, c = r.canvas.getContext('2d')!;
      const colors = [];
      for (let index = 0; index < 3; index++) {
        const expected = camera.project(states[index]!), guide = r.guides.find(item => item.index === index)!;
        const pixels = c.getImageData(Math.round(expected.x * ratio) - 3, Math.round(expected.y * ratio) - 3, 7, 7).data;
        let red = 0, green = 0, blue = 0;
        for (let i = 0; i < pixels.length; i += 4) { red += pixels[i]; green += pixels[i + 1]; blue += pixels[i + 2]; }
        colors.push({ expected, guide, sum: [red, green, blue] });
      }
      const noise = r.noisePreview.hitEntries[0], center = camera.project({ x: 0, y: 0 }), canvas = r.canvas.getBoundingClientRect(), note = r.noteHitAreas[0];
      return { colors, noiseCenter: noise?.center as Point, expectedNoise: { x: (center.x - frame.width / 2) / frame.scale, y: (frame.height / 2 - center.y) / frame.scale }, noisePick: r.pickNoiseArea(canvas.left + center.x, canvas.top + center.y), notePick: r.pickNoteTarget(canvas.left + note.x1, canvas.top + note.y1), linePick: r.pick(canvas.left + colors[0].guide.x, canvas.top + colors[0].guide.y) };
    });
    for (let index = 0; index < 3; index++) {
      const item = projection.colors[index];
      assert.ok(Math.hypot(item.expected.x - item.guide.x, item.expected.y - item.guide.y) < 2, JSON.stringify(item));
      const dominant = item.sum[index];
      assert.ok(dominant > item.sum[(index + 1) % 3] * 1.4 && dominant > item.sum[(index + 2) % 3] * 1.4, JSON.stringify(item));
    }
    assert.ok(Math.hypot(projection.noiseCenter.x - projection.expectedNoise.x, projection.noiseCenter.y - projection.expectedNoise.y) < 1e-5);
    assert.equal(projection.noisePick, 0);
    assert.equal(projection.linePick, 0);
    assert.deepEqual(projection.notePick, { lineIndex: 0, noteIndex: 0 });
    checks.push('GPU projection pixels geometry and line note noise picking agree');
    await capture('orbit');
    await run(async () => {
      const { loadBuiltinNoiseSkins } = await import('./src/platform/noise-skins.ts' as string) as typeof import('../src/platform/noise-skins.ts'), e = window.rpenMods.editor;
      for (const skin of await loadBuiltinNoiseSkins()) for (const [name, bytes] of skin.files) e.assets.set('shader/' + skin.name + '/' + name, bytes);
    });
    for (const skin of ['Ocean', 'NoiseField']) {
      await run(skin => {
        const e = window.rpenMods.editor;
        e.preview.noisePreview.forceSimple = false;
        e.commit('Skin fixture', { ...e.chart, noiseAreaLayers: [{ id: 'default', name: 'Camera layer', skin: 'shader/' + skin, parameters: {} }] });
      }, skin);
      await until(skin => {
        const g = window.rpenMods.editor.preview.noisePreview.gpu;
        return Boolean(g && g.instances.get('default')?.skin === g.skins.get('shader/' + skin) && !g.skins.get('shader/' + skin)?.pending);
      }, skin);
      const mask = await run(() => {
        const r = window.rpenMods.editor.preview, n = r.noisePreview, g = n.gpu!, instance = g.instances.get('default')!, target = instance.fullMask, gl = g.gl, entry = n.hitEntries[0], x = r.canvas.clientWidth / 2 + entry.center.x * r.viewScale, y = r.canvas.clientHeight / 2 - entry.center.y * r.viewScale, v = r.viewport;
        const value = new Uint8Array(4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
        gl.readPixels(Math.floor((x - v.left) / v.width * target.width), Math.floor((1 - (y - v.top) / v.height) * target.height), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, value);
        return { word: value[0], errors: [...g.errors] };
      });
      assert.equal(mask.word, 1, skin + JSON.stringify(mask));
      assert.deepEqual(mask.errors, []);
      await capture('skin-' + skin);
    }
    checks.push('Ocean and NoiseField GPU masks follow camera projection');
    await run(() => {
      const e = window.rpenMods.editor;
      e.commit('Shader fixture', { ...e.chart, noiseAreaLayers: [{ id: 'default', name: 'Camera layer', skin: '' }], effects: [{ shader: 'grayscale', startTime: [0, 0, 1], endTime: [30, 0, 1], global: false }, { shader: 'vignette', startTime: [0, 0, 1], endTime: [30, 0, 1], global: true }] });
      e.preview.showGameUI = true;
    });
    await until(() => {
      const r = window.rpenMods.editor.preview;
      return r.shaderRuntime.sources.has('grayscale') && r.shaderRuntime.sources.has('vignette');
    });
    const order = await run(() => {
      const e = window.rpenMods.editor, r = e.preview, c = r.canvas.getContext('2d')!, log: string[] = [], scene = r.drawScene, render = r.shaderPipeline.render, noise = r.noisePreview.draw, text = c.fillText;
      r.drawScene = function (this: TestPreview, ...args: Parameters<typeof scene>) { log.push('scene'); return scene.apply(this, args); };
      r.shaderPipeline.render = function (this: typeof r.shaderPipeline, ...args: Parameters<typeof render>) { log.push((args[2][0] as unknown as { global: boolean }).global ? 'global' : 'local'); return render.apply(this, args); } as typeof r.shaderPipeline.render;
      r.noisePreview.draw = function (this: typeof r.noisePreview, ...args: Parameters<typeof noise>) { log.push('noise'); return noise.apply(this, args); };
      c.fillText = function (this: CanvasRenderingContext2D, value: string, ...args: [x: number, y: number, maxWidth?: number]) { if (value === e.chart.META.name) log.push('ui'); return text.call(this, value, ...args); } as typeof c.fillText;
      try {
        r.draw(e.chart, e.tempo, 1, 0);
        return { log, error: r.shaderPipeline.lastError };
      } finally {
        r.drawScene = scene;
        r.shaderPipeline.render = render;
        r.noisePreview.draw = noise;
        c.fillText = text;
      }
    });
    assert.deepEqual(order.log, ['scene', 'local', 'ui', 'noise', 'global']);
    assert.ok(!order.error);
    checks.push('real local and global shaders retain scene UI noise order');
    await run(() => {
      const e = window.rpenMods.editor;
      e.commit('Remove shader fixture', { ...e.chart, effects: [] });
      e.preview.showGameUI = false;
    });
    // Far sideways movement must render a line outside the original viewport.
    await run(() => {
      const e = window.rpenMods.editor, chart = structuredClone(e.chart), line = chart.judgeLineList[1];
      line.eventLayers[0].moveXEvents = [window.cameraCore.createEvent(4000)];
      line.eventLayers[0].moveYEvents = [window.cameraCore.createEvent(0)];
      e.commit('Far line', chart);
      window.setCamera({ ...window.cameraModel.DEFAULT_POSE, x: 4000 });
    });
    await wait(100);
    assert.ok(await run(() => {
      const r = window.rpenMods.editor.preview, p = r.guides.find(item => item.index === 1)!;
      return Math.hypot(p.x - r.canvas.clientWidth / 2, p.y - r.canvas.clientHeight / 2) < 1;
    }));
    checks.push('capture window follows world position beyond original viewport');
    await run(() => {
      window.setCamera({ ...window.cameraModel.DEFAULT_POSE });
      const e = window.rpenMods.editor;
      e.preview.showGameUI = true;
      e.invalidate();
    });
    await wait(100);
    const ui = await run(() => {
      const r = window.rpenMods.editor.preview, c = r.canvas.getContext('2d')!, v = r.viewport, d = devicePixelRatio || 1;
      return [...c.getImageData(Math.round((v.left + 8) * d), Math.round((v.top + v.height - 45) * d), Math.round((v.width * .45 - 8) * d), Math.round(40 * d)).data];
    });
    await run(() => window.setCamera(window.cameraModel.orbitPose(-22, -18, 1200)));
    await wait(100);
    const uiAfter = await run(() => {
      const r = window.rpenMods.editor.preview, c = r.canvas.getContext('2d')!, v = r.viewport, d = devicePixelRatio || 1;
      return [...c.getImageData(Math.round((v.left + 8) * d), Math.round((v.top + v.height - 45) * d), Math.round((v.width * .45 - 8) * d), Math.round(40 * d)).data];
    });
    assert.deepEqual(uiAfter, ui);
    checks.push('screen UI remains fixed');
    // Background and UI optionally share the plane camera while preserving their separate passes.
    assert.equal(await run(() => window.cameraOptions.cameraFollowsChart(window.rpenMods.editor.chart)), false);
    await run(async () => {
      const e = window.rpenMods.editor, r = e.preview, picture = document.createElement('canvas');
      picture.width = 1350;
      picture.height = 900;
      const c = picture.getContext('2d')!;
      c.fillStyle = '#07131b';
      c.fillRect(0, 0, 1350, 900);
      c.fillStyle = '#ff00ff';
      c.fillRect(185, 410, 80, 80);
      const image = new Image();
      image.src = picture.toDataURL();
      await image.decode();
      window.cameraBackgroundRestore = { images: r.images, alpha: r.backgroundAlpha, blur: r.backgroundBlur };
      window.cameraTestImage = image;
      r.images = { background: image };
      r.backgroundAlpha = 1;
      r.backgroundBlur = 0;
      window.setCamera(window.cameraModel.DEFAULT_POSE);
      window.cameraFrame = renderer => {
        const c = renderer.canvas.getContext('2d')!;
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.clearRect(0, 0, renderer.canvas.width, renderer.canvas.height);
        renderer.draw(e.chart, e.tempo, 1, 0);
        return c.getImageData(0, 0, renderer.canvas.width, renderer.canvas.height);
      };
      window.fixedCameraFrame = window.cameraFrame(r);
    });
    await run(() => window.setCameraFollow(true));
    const neutralFollow = await run(() => {
      const r = window.rpenMods.editor.preview, actual = window.cameraFrame(r), before = window.fixedCameraFrame, v = r.viewport, d = devicePixelRatio || 1;
      let count = 0, max = 0, left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
      for (let i = 0; i < actual.data.length; i += 4) {
        const x = (i / 4) % actual.width, y = Math.floor(i / 4 / actual.width);
        if (x <= Math.ceil(v.left * d) + 1 || x >= Math.floor((v.left + v.width) * d) - 1 || y <= Math.ceil(v.top * d) + 1 || y >= Math.floor((v.top + v.height) * d) - 1) continue;
        let delta = 0;
        for (let j = 0; j < 4; j++) delta = Math.max(delta, Math.abs(actual.data[i + j] - before.data[i + j]));
        if (delta) {
          count++;
          max = Math.max(max, delta);
          left = Math.min(left, x);
          right = Math.max(right, x);
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
        }
      }
      return { count, max, left, right, top, bottom, pose: r.spatialCameraState };
    });
    assert.equal(neutralFollow.count, 0, JSON.stringify(neutralFollow));
    await run(() => {
      window.setCamera(window.cameraModel.orbitPose(18, -15, 1450, 16));
      window.cameraFollowChart = window.rpenMods.editor.chart;
    });
    const followed = await run(async () => {
      const { gameUiLayout } = await import('./src/core/game-ui.ts' as string) as typeof import('../src/core/game-ui.ts'), e = window.rpenMods.editor, r = e.preview;
      window.cameraFrame(r);
      const rect = r.canvas.getBoundingClientRect(), frame = { width: rect.width, height: rect.height, scale: r.viewScale, viewport: r.viewport }, camera = new window.cameraModel.PlaneCamera(r.spatialCameraState, frame), marker = camera.project({ x: -450, y: 0 }), c = r.canvas.getContext('2d')!, d = devicePixelRatio || 1;
      const name = gameUiLayout(frame.viewport.width / frame.viewport.scale, frame.viewport.height / frame.viewport.scale).find(item => item.key === 'name') as { fontSize: number; x: number; y: number } | undefined;
      c.font = `${name!.fontSize}px RPEGame,sans-serif`;
      c.textBaseline = 'bottom';
      const metrics = c.measureText(e.chart.META.name), expected = camera.project({ x: name!.x + metrics.width / 2, y: name!.y + (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2 });
      const pixels = c.getImageData(Math.max(0, Math.round(expected.x * d) - 130), Math.max(0, Math.round(expected.y * d) - 50), 260, 100).data;
      let white = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 225 && pixels[i + 1] > 225 && pixels[i + 2] > 225) white++;
      return { pixel: [...c.getImageData(Math.round(marker.x * d), Math.round(marker.y * d), 1, 1).data], white, chartUnchanged: e.chart === window.cameraFollowChart, guide: r.guides.find(item => item.index === 0)!, expectedGuide: camera.project(r.scene.sample(1)[0]!) };
    });
    assert.ok(followed.pixel[0] > 230 && followed.pixel[1] < 15 && followed.pixel[2] > 230, JSON.stringify(followed));
    assert.ok(followed.white > 30, JSON.stringify(followed));
    assert.equal(followed.chartUnchanged, true);
    assert.ok(Math.hypot(followed.guide.x - followed.expectedGuide.x, followed.guide.y - followed.expectedGuide.y) < 1);
    await wait(150);
    await capture('follow-chart');
    await run(() => {
      const e = window.rpenMods.editor;
      e.setPreview(false, { autoplay: false });
      const r = e.realtimePreview;
      window.cameraRealtimeRestore = { images: r.images, alpha: r.backgroundAlpha, blur: r.backgroundBlur, visible: r.visible, ui: r.showGameUI };
      r.images = { background: window.cameraTestImage };
      r.backgroundAlpha = 1;
      r.backgroundBlur = 0;
      r.visible = true;
      r.showGameUI = true;
      e.invalidate();
    });
    await wait(100);
    const realtimeFollow = await run(() => {
      const r = window.rpenMods.editor.realtimePreview;
      window.cameraFrame(r);
      const rect = r.canvas.getBoundingClientRect(), camera = new window.cameraModel.PlaneCamera(r.spatialCameraState, { width: rect.width, height: rect.height, scale: r.viewScale, viewport: r.viewport }), point = camera.project({ x: -450, y: 0 }), d = devicePixelRatio || 1;
      return [...r.canvas.getContext('2d')!.getImageData(Math.round(point.x * d), Math.round(point.y * d), 1, 1).data];
    });
    assert.ok(realtimeFollow[0] > 230 && realtimeFollow[1] < 15 && realtimeFollow[2] > 230);
    await run(() => {
      const e = window.rpenMods.editor, r = e.realtimePreview, s = window.cameraRealtimeRestore;
      r.images = s.images;
      r.backgroundAlpha = s.alpha;
      r.backgroundBlur = s.blur;
      r.visible = s.visible;
      r.showGameUI = s.ui;
      e.setPreview(true, { autoplay: false });
    });
    await run(() => window.setCameraFollow(false));
    const restored = await run(() => {
      const r = window.rpenMods.editor.preview;
      window.cameraFrame(r);
      const rect = r.canvas.getBoundingClientRect(), d = devicePixelRatio || 1;
      return [...r.canvas.getContext('2d')!.getImageData(Math.round((rect.width / 2 - 450 * r.viewScale) * d), Math.round(rect.height / 2 * d), 1, 1).data];
    });
    assert.ok(restored[0] > 230 && restored[1] < 15 && restored[2] > 230);
    await run(() => {
      const r = window.rpenMods.editor.preview, s = window.cameraBackgroundRestore;
      r.images = s.images;
      r.backgroundAlpha = s.alpha;
      r.backgroundBlur = s.blur;
      window.rpenMods.editor.invalidate();
    });
    checks.push('follow-chart defaults off neutral pixels identical projected background and UI toggle live without chart mutation');
    // Animated track evaluation uses global beats, retains tails and defaults before the first event.
    await run(() => {
      const e = window.rpenMods.editor;
      e.preview.showGameUI = false;
      window.setCamera(window.cameraModel.DEFAULT_POSE);
      window.cameraApi.globalEvents.replace('position', 'x', [window.cameraCore.createEvent(0, 300, 4, 8)]);
      e.seekBeat(2);
    });
    await wait(80);
    assert.equal(await run(() => window.rpenMods.editor.preview.spatialCameraState.x), 0);
    await run(() => window.rpenMods.editor.seekBeat(6));
    await wait(80);
    assert.equal(await run(() => window.rpenMods.editor.preview.spatialCameraState.x), 150);
    await run(() => window.rpenMods.editor.seekBeat(10));
    await wait(80);
    assert.equal(await run(() => window.rpenMods.editor.preview.spatialCameraState.x), 300);
    checks.push('global timing interpolation defaults and final values');
    // Select the X event and edit via real preview drag, first cancel then apply.
    await run(() => {
      const e = window.rpenMods.editor;
      e.setPreview(false, { autoplay: false });
      e.openGlobalEvents();
      e.seekBeat(4);
      const entry = e.globalEvents.document.columns.find(entry => entry.type.id === 'spatial-camera/position' && entry.column.id === 'x')!;
      e.globalEvents.document.editor.eventSelection = new Set([entry.key + ':0']);
      e.globalEvents.document.editor.notify();
    });
    await until(() => document.querySelector('[data-camera-axis="x"]'));
    assert.deepEqual(await run(() => window.rpenMods.editor.globalEvents.timeline.eventLabels), ['占位', '位置 X', '位置 Y', '位置 Z', '偏航', '俯仰', '画面倾斜', '视角']);
    assert.equal(await run(() => ((document.querySelector('#spatial-camera-overview') as HTMLElement).closest('[data-panel]') as HTMLElement).dataset.panel), 'global-events');
    assert.equal(await run(() => Boolean(document.querySelector('[data-panel="chart"] #spatial-camera-tool'))), false);
    assert.equal(await run(() => Boolean(document.querySelector('#global-event-inspector [data-camera-follow-chart]'))), false);
    assert.equal(await run(() => [...document.querySelectorAll('#global-event-inspector button')].some(button => button.textContent === '姿态过渡助手')), false);
    await wait(150);
    await capture('event-titles');
    const slider = await run(() => {
      const input = document.querySelector('[data-camera-axis="x"] input[type=range]') as HTMLInputElement;
      window.cameraSlider = input;
      input.focus();
      input.value = '360';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return { same: document.querySelector('[data-camera-axis="x"] input[type=range]') === input, value: window.cameraApi.globalEvents.read('position', 'x')[0].end };
    });
    assert.equal(slider.same, true);
    assert.equal(slider.value, 360);
    await run(() => {
      window.cameraSlider.blur();
      window.rpenMods.editor.session.travel('undo');
    });
    checks.push('compact timeline headings and stable live slider');
    const clickSelector = async (selector: string): Promise<void> => {
      const p = await run(selector => {
        const node = document.querySelector(selector) as HTMLElement;
        node.scrollIntoView({ block: 'nearest' });
        const r = node.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }, selector);
      await move(p);
      down(p);
      up(p);
      await wait(80);
    };
    const endpointHistory = await run(() => window.rpenMods.editor.session.history.undoStack.length);
    await clickSelector('[data-camera-axis="x"] [data-camera-endpoint="start"]');
    assert.equal(await run(() => window.rpenMods.editor.currentBeat()), 4);
    const startSlider = await run(() => {
      const node = document.querySelector('[data-camera-axis="x"] input[type=range]') as HTMLInputElement;
      node.scrollIntoView({ block: 'nearest' });
      const r = node.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await move(startSlider);
    down(startSlider);
    await move({ x: startSlider.x + 50, y: startSlider.y });
    up({ x: startSlider.x + 50, y: startSlider.y });
    await wait(80);
    assert.ok(await run(() => window.cameraApi.globalEvents.read('position', 'x')[0].start > 0));
    assert.equal(await run(() => window.cameraApi.globalEvents.read('position', 'x')[0].end), 300);
    await run(() => {
      (document.activeElement as HTMLElement).blur();
      window.rpenMods.editor.globalEvents.inspector.render();
    });
    await wait(70);
    assert.equal(await run(() => (document.querySelector('[data-camera-axis="x"] [data-camera-endpoint="start"]') as HTMLElement).getAttribute('aria-pressed')), 'true');
    await run(() => ([...document.querySelectorAll('[data-camera-axis="x"] button')].find(button => button.textContent === '在预览中拖拽') as HTMLButtonElement).click());
    const startSamplePoint = await run(() => {
      const r = (document.querySelector('.camera3d-sampler') as HTMLElement).getBoundingClientRect();
      return { x: r.left + r.width * .5, y: r.top + r.height * .55 };
    });
    await move(startSamplePoint);
    down(startSamplePoint);
    await move({ x: startSamplePoint.x + 50, y: startSamplePoint.y });
    up({ x: startSamplePoint.x + 50, y: startSamplePoint.y });
    await run(() => ([...document.querySelectorAll('.camera3d-sample-bar button')].find(button => button.textContent === '应用') as HTMLButtonElement).click());
    assert.equal(await run(() => window.cameraApi.globalEvents.read('position', 'x')[0].end), 300);
    await run(endpointHistory => {
      const e = window.rpenMods.editor;
      while (e.session.history.undoStack.length > endpointHistory) e.session.travel('undo');
    }, endpointHistory);
    await clickSelector('[data-camera-axis="x"] [data-camera-endpoint="end"]');
    checks.push('native start slider and preview sampling retain start through seeking focus and rerender');
    await run(() => ([...document.querySelectorAll('[data-camera-axis="x"] button')].find(button => button.textContent === '在预览中拖拽') as HTMLButtonElement).click());
    assert.equal(await run(() => (document.querySelector('.editor') as HTMLElement).classList.contains('camera3d-adjusting')), true);
    assert.equal(await run(() => window.rpenMods.runtime.locks.size), 1);
    const point = await run(() => {
      const r = (document.querySelector('.camera3d-sampler') as HTMLElement).getBoundingClientRect();
      return { x: r.left + r.width * .5, y: r.top + r.height * .55 };
    });
    await move(point);
    down(point);
    await move({ x: point.x + 90, y: point.y });
    up({ x: point.x + 90, y: point.y });
    await wait(80);
    assert.equal(await run(() => window.cameraApi.globalEvents.read('position', 'x')[0].end), 300);
    await key('Escape');
    assert.equal(await run(() => window.rpenMods.runtime.locks.size), 0);
    assert.equal(await run(() => window.cameraApi.globalEvents.read('position', 'x')[0].end), 300);
    checks.push('preview drag cancel restores unchanged chart and editor');
    await run(() => ([...document.querySelectorAll('[data-camera-axis="x"] button')].find(button => button.textContent === '在预览中拖拽') as HTMLButtonElement).click());
    const beforeHistory = await run(() => window.rpenMods.editor.session.history.undoStack.length);
    await move(point);
    down(point);
    await move({ x: point.x + 60, y: point.y });
    up({ x: point.x + 60, y: point.y });
    await run(() => ([...document.querySelectorAll('.camera3d-sample-bar button')].find(button => button.textContent === '应用') as HTMLButtonElement).click());
    assert.ok(await run(() => window.cameraApi.globalEvents.read('position', 'x')[0].end > 300));
    assert.equal(await run(() => window.rpenMods.editor.session.history.undoStack.length), beforeHistory + 1);
    await run(() => window.rpenMods.editor.session.travel('undo'));
    assert.equal(await run(() => window.cameraApi.globalEvents.read('position', 'x')[0].end), 300);
    checks.push('preview drag apply is one undoable edit');
    for (const id of ['y', 'z', 'yaw', 'pitch', 'roll', 'fov']) {
      await run(id => {
        const e = window.rpenMods.editor, axis = window.cameraModel.AXES.find(axis => axis.id === id)!, entry = e.globalEvents.document.columns.find(entry => entry.type.id === 'spatial-camera/' + axis.type && entry.column.id === id)!;
        e.globalEvents.document.editor.eventSelection = new Set([entry.key + ':0']);
        e.globalEvents.document.editor.notify();
      }, id);
      await clickSelector(`[data-camera-axis="${id}"] [data-camera-endpoint="start"]`);
      const axisEdit = await run(id => {
        const axis = window.cameraModel.AXES.find(axis => axis.id === id)!, before = window.cameraApi.globalEvents.read(axis.type, id)[0], input = document.querySelector(`[data-camera-axis="${id}"] input[type=range]`) as HTMLInputElement;
        input.focus();
        input.value = String(before.start + axis.step * 10);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        const after = window.cameraApi.globalEvents.read(axis.type, id)[0];
        return { changed: after.start !== before.start, endUnchanged: after.end === before.end };
      }, id);
      assert.deepEqual(axisEdit, { changed: true, endUnchanged: true });
      await run(() => window.rpenMods.editor.session.travel('undo'));
    }
    checks.push('all position rotation and FOV columns edit their selected starting value');
    // The helper previews without touching data, then writes all seven tracks atomically.
    await run(() => {
      const e = window.rpenMods.editor;
      for (const type of ['position', 'rotation', 'lens']) for (const axis of window.cameraModel.AXES.filter(axis => axis.type === type)) window.cameraApi.globalEvents.replace(type, axis.id, []);
      e.seekBeat(0);
      window.cameraBase = JSON.stringify(e.chart);
      e.openGlobalEvents();
    });
    await clickSelector('#spatial-camera-assistant');
    await until(() => document.querySelector('.camera3d-dialog[open]'));
    await wait(100);
    assert.equal(await run(() => JSON.stringify(window.rpenMods.editor.chart) === window.cameraBase), true);
    assert.equal(await run(() => Boolean(document.querySelector('.camera3d-studio [data-camera-follow-chart]'))), false);
    await capture('assistant');
    await clickSelector('[data-camera-studio-switch="start"]');
    const sceneStart = await run(() => {
      const canvas = document.querySelector('[data-camera-scene]') as CameraSceneCanvas, s = canvas.cameraScene, r = canvas.getBoundingClientRect(), h = s.handles.find(h => h.id === 'x')!;
      window.studioInitial = structuredClone(s.poses);
      return { from: { x: r.left + h.end.x, y: r.top + h.end.y }, to: { x: r.left + h.end.x + (h.end.x - h.start.x) * .5, y: r.top + h.end.y + (h.end.y - h.start.y) * .5 } };
    });
    await move(sceneStart.from);
    down(sceneStart.from);
    await move(sceneStart.to);
    up(sceneStart.to);
    await wait(100);
    assert.ok(await run(() => (document.querySelector('[data-camera-scene]') as CameraSceneCanvas).cameraScene.poses.start.x !== window.studioInitial.start.x));
    assert.equal(await run(() => (document.querySelector('[data-camera-scene]') as CameraSceneCanvas).cameraScene.poses.end.x === window.studioInitial.end.x), true);
    await clickSelector('[data-camera-scene-tool="rotate"]');
    const ring = await run(() => {
      const canvas = document.querySelector('[data-camera-scene]') as CameraSceneCanvas, s = canvas.cameraScene, r = canvas.getBoundingClientRect(), h = s.handles.find(h => h.id === 'roll')!;
      const dist = (p: Point, a: Point, b: Point): number => { const x = b.x - a.x, y = b.y - a.y, t = Math.max(0, Math.min(1, ((p.x - a.x) * x + (p.y - a.y) * y) / (x * x + y * y || 1))); return Math.hypot(p.x - a.x - x * t, p.y - a.y - y * t); };
      let best = -1, index = 0;
      for (let i = 0; i < 60; i++) {
        const p = h.screens[i];
        if (!p) continue;
        let score = Infinity;
        for (const other of s.handles.filter(other => other !== h)) for (let j = 1; j < other.screens.length; j++) if (other.screens[j] && other.screens[j - 1]) score = Math.min(score, dist(p, other.screens[j - 1], other.screens[j]));
        if (score > best) { best = score; index = i; }
      }
      const a = h.screens[index], b = h.screens[index + 6];
      return { from: { x: r.left + a.x, y: r.top + a.y }, to: { x: r.left + b.x, y: r.top + b.y } };
    });
    await move(ring.from);
    down(ring.from);
    await move(ring.to);
    up(ring.to);
    await wait(100);
    assert.ok(await run(() => Math.abs((document.querySelector('[data-camera-scene]') as CameraSceneCanvas).cameraScene.poses.start.roll) > 1));
    assert.equal(await run(() => (document.querySelector('[data-camera-scene]') as CameraSceneCanvas).cameraScene.poses.end.roll), 0);
    assert.equal(await run(() => getComputedStyle(document.querySelector('[data-camera-pose="end"]') as Element).opacity), '.42'.replace(/^\./, '0.'));
    await capture('studio-dragged');
    await run(() => ([...document.querySelectorAll('.camera3d-dialog-actions button')].find(button => button.textContent === '取消姿态编辑') as HTMLButtonElement).click());
    assert.equal(await run(() => JSON.stringify(window.rpenMods.editor.chart) === window.cameraBase), true);
    assert.equal(await run(() => window.rpenMods.runtime.locks.size), 0);
    checks.push('native 3D axis and rotation-ring editing affect selected endpoint only and cancel discards drafts');
    await run(() => window.rpenMods.editor.openGlobalEvents());
    await clickSelector('#spatial-camera-overview [data-camera-follow-chart]');
    assert.equal(await run(() => window.cameraOptions.cameraFollowsChart(window.rpenMods.editor.chart)), true);
    await clickSelector('#spatial-camera-overview [data-camera-follow-chart]');
    assert.equal(await run(() => JSON.stringify(window.rpenMods.editor.chart) === window.cameraBase), true);
    await capture('overview-tools');
    await clickSelector('#spatial-camera-assistant');
    await until(() => document.querySelector('[data-camera-scene]'));
    checks.push('assistant and per-chart follow controls live exclusively in global overview');
    await clickSelector('[data-camera-studio-switch="start"]');
    await run(() => {
      const input = document.querySelector('[data-camera-studio-value="y"]') as HTMLInputElement;
      input.focus();
      input.value = '45';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await clickSelector('[data-camera-studio-switch="end"]');
    await run(() => {
      const input = document.querySelector('[data-camera-studio-value="x"]') as HTMLInputElement;
      input.focus();
      input.value = '-350';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await wait(100);
    const transitionBefore = await run(() => (document.querySelector('.camera3d-transition-preview') as HTMLCanvasElement).toDataURL());
    await run(() => ([...document.querySelectorAll('.camera3d-preview-controls button')].find(button => button.textContent === '动态预览过渡') as HTMLButtonElement).click());
    await wait(260);
    assert.notEqual(await run(() => (document.querySelector('.camera3d-transition-preview') as HTMLCanvasElement).toDataURL()), transitionBefore);
    await clickSelector('[data-camera-studio-switch="end"]');
    const before = await run(() => window.rpenMods.editor.session.history.undoStack.length);
    await run(() => (document.querySelector('[data-camera-generate]') as HTMLElement).click());
    await until(() => !document.querySelector('.camera3d-dialog'));
    assert.equal(await run(() => window.rpenMods.editor.session.history.undoStack.length), before + 1);
    assert.equal(await run(() => Object.values(window.rpenMods.editor.chart.globalEvents.types).filter(type => type.source.id === 'spatial-camera').flatMap(type => Object.values(type.columns)).reduce((sum, column) => sum + column.events.length, 0)), 7);
    await run(() => window.rpenMods.editor.session.travel('undo'));
    assert.equal(await run(() => JSON.stringify(window.rpenMods.editor.chart) === window.cameraBase), true);
    await run(() => window.rpenMods.editor.session.travel('redo'));
    checks.push('assistant live preview atomic generation undo redo');
    assert.equal(await run(() => window.cameraApi.globalEvents.read('position', 'y')[0].start), 45);
    assert.equal(await run(() => window.cameraApi.globalEvents.read('position', 'x')[0].end), -350);
    checks.push('custom edited endpoints generate exact values and dynamic preview is visible inside studio');
    await run(() => {
      window.conflictChart = window.rpenMods.editor.chart;
      window.conflictHistory = window.rpenMods.editor.session.history.undoStack.length;
      window.rpenMods.editor.openGlobalEvents();
    });
    await clickSelector('#spatial-camera-assistant');
    await clickSelector('[data-camera-generate]');
    await wait(150);
    const conflict = await run(() => {
      const alert = document.querySelector('.camera3d-studio-error') as HTMLElement, panel = document.querySelector('.camera3d-studio-panel') as HTMLElement, r = alert.getBoundingClientRect(), b = (document.querySelector('[data-camera-generate]') as HTMLElement).getBoundingClientRect();
      return { text: alert.textContent, visible: !alert.hidden && r.top >= 0 && r.bottom <= innerHeight && r.bottom <= b.top, focused: document.activeElement === alert, chartUnchanged: window.rpenMods.editor.chart === window.conflictChart, historyUnchanged: window.rpenMods.editor.session.history.undoStack.length === window.conflictHistory, panelTop: panel.scrollTop };
    });
    assert.ok(conflict.text!.includes('已有事件'));
    assert.equal(conflict.visible, true);
    assert.equal(conflict.focused, true);
    assert.equal(conflict.chartUnchanged, true);
    assert.equal(conflict.historyUnchanged, true);
    assert.equal(conflict.panelTop, 0);
    await capture('generation-conflict');
    assert.equal(await run(() => {
      const input = document.querySelector('[aria-label="摄像机过渡开始拍"]') as HTMLInputElement;
      input.focus();
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return document.activeElement === input;
    }), true);
    await run(() => {
      const start = document.querySelector('[aria-label="摄像机过渡开始拍"]') as HTMLInputElement, end = document.querySelector('[aria-label="摄像机过渡结束拍"]') as HTMLInputElement;
      start.value = '8:0/1';
      start.dispatchEvent(new Event('input', { bubbles: true }));
      end.value = '12:0/1';
      end.dispatchEvent(new Event('input', { bubbles: true }));
    });
    assert.equal(await run(() => (document.querySelector('.camera3d-studio-error') as HTMLElement).hidden), true);
    await run(() => ([...document.querySelectorAll('.camera3d-dialog-actions button')].find(button => button.textContent === '取消姿态编辑') as HTMLButtonElement).click());
    checks.push('generation conflicts remain visible beside footer actions without scrolling or modifying chart');
    const chartSettings = await run(async () => {
      const e = window.rpenMods.editor;
      window.setCameraFollow(true);
      if (!window.cameraOptions.cameraFollowsChart(e.chart)) throw Error('Follow not set');
      e.session.travel('undo');
      if (window.cameraOptions.cameraFollowsChart(e.chart)) throw Error('Follow undo failed');
      e.session.travel('redo');
      const { createChartExport } = await import('./src/platform/files.ts' as string) as typeof import('../src/platform/files.ts'), { readZip } = await import('./src/platform/archive.ts' as string) as typeof import('../src/platform/archive.ts'), { parseChart, createChart } = await import('./src/core/chart.ts' as string) as typeof import('../src/core/chart.ts');
      window.followSaved = structuredClone(e.chart);
      const exported = createChartExport(e.chart, new Map(), 'camera.json', { compatibility: 'next', format: 'pez' }), files = await readZip(await exported.blob.arrayBuffer());
      const json = [...files].find(([name]) => name.endsWith('.json'))!;
      const parsed = parseChart(new TextDecoder().decode(json[1]));
      e.replace(createChart(), 'other-chart.json');
      const separate = !window.cameraOptions.cameraFollowsChart(e.chart);
      e.replace(window.followSaved, 'follow-chart.json');
      return { separate, pez: window.cameraOptions.cameraFollowsChart(parsed), reopen: window.cameraOptions.cameraFollowsChart(e.chart) };
    });
    assert.deepEqual(chartSettings, { separate: true, pez: true, reopen: true });
    checks.push('follow is per-chart undoable retained by generation JSON reopen and PEZ');
    const saved = await run(async () => {
      const { serializeChart, parseChart } = await import('./src/core/chart.ts' as string) as typeof import('../src/core/chart.ts');
      const e = window.rpenMods.editor, text = serializeChart(e.chart);
      window.savedCamera = parseChart(text);
      return window.savedCamera.globalEvents!.types['spatial-camera/position'].source;
    });
    assert.deepEqual(saved, { kind: 'mod', id: 'spatial-camera', name: '三维摄像机', author: 'rpe-next', version: '1.0.0' });
    await run(() => window.rpenMods.manager.disable('spatial-camera'));
    assert.equal(await run(() => window.rpenMods.editor.preview.drawScene === window.flatDraw), true);
    assert.equal(await run(() => Boolean(document.querySelector('#spatial-camera-tool,#spatial-camera-overview'))), false);
    assert.equal(await run(() => window.rpenMods.editor.globalEvents.document.types.find(type => type.id === 'spatial-camera/position')!.readonly), true);
    await run(() => {
      const e = window.rpenMods.editor;
      e.replace(window.savedCamera, 'camera-reopen.json');
    });
    await run(() => window.rpenMods.manager.enable('spatial-camera'));
    await run(() => {
      const e = window.rpenMods.editor;
      e.setPreview(true, { autoplay: false });
      e.seekBeat(4);
    });
    await wait(100);
    assert.equal(await run(() => window.rpenMods.editor.preview.spatialCameraState.yaw), 28);
    checks.push('file provenance reopen disabled data retention and reenable');
    await run(() => {
      const e = window.rpenMods.editor;
      e.setPreview(false, { autoplay: false });
      e.openGlobalEvents();
      const entry = e.globalEvents.document.columns.find(entry => entry.type.id === 'spatial-camera/rotation' && entry.column.id === 'yaw')!;
      e.globalEvents.document.editor.eventSelection = new Set([entry.key + ':0']);
      e.globalEvents.document.editor.notify();
      ([...document.querySelectorAll('[data-camera-axis="yaw"] button')].find(button => button.textContent === '在预览中拖拽') as HTMLButtonElement).click();
    });
    await run(() => window.rpenMods.manager.disable('spatial-camera'));
    assert.equal(await run(() => window.rpenMods.runtime.locks.size), 0);
    assert.equal(await run(() => (document.querySelector('.editor') as HTMLElement).classList.contains('camera3d-adjusting')), false);
    checks.push('unloading during adjustment restores controls');
    await run(() => window.rpenMods.manager.enable('spatial-camera'));
    await run(() => window.rpenMods.runtime.commands.get('spatial-camera:assistant')!.run());
    await until(() => document.querySelector('[data-camera-scene]'));
    win.setSize(1050, 760);
    await wait(200);
    const layout = await run(() => {
      const dialog = document.querySelector('.camera3d-studio') as HTMLElement, scene = document.querySelector('[data-camera-scene]') as CameraSceneCanvas, generate = document.querySelector('[data-camera-generate]') as HTMLElement, r = generate.getBoundingClientRect();
      return { horizontalOverflow: dialog.scrollWidth > dialog.clientWidth, sceneWidth: scene.clientWidth, buttonVisible: r.bottom <= innerHeight && r.right <= innerWidth };
    });
    assert.equal(layout.horizontalOverflow, false);
    assert.ok(layout.sceneWidth > 200);
    assert.equal(layout.buttonVisible, true);
    await capture('studio-narrow');
    await run(() => {
      const start = document.querySelector('[aria-label="摄像机过渡开始拍"]') as HTMLInputElement, end = document.querySelector('[aria-label="摄像机过渡结束拍"]') as HTMLInputElement;
      start.value = '0:0/1';
      start.dispatchEvent(new Event('input', { bubbles: true }));
      end.value = '2:0/1';
      end.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await clickSelector('[data-camera-generate]');
    assert.equal(await run(() => {
      const node = document.querySelector('.camera3d-studio-error') as HTMLElement, r = node.getBoundingClientRect();
      return !node.hidden && r.top >= 0 && r.bottom <= innerHeight;
    }), true);
    await capture('generation-conflict-narrow');
    await run(() => window.rpenMods.manager.disable('spatial-camera'));
    assert.equal(await run(() => Boolean(document.querySelector('.camera3d-studio'))), false);
    assert.equal(await run(() => window.rpenMods.runtime.locks.size), 0);
    assert.equal(await run(() => document.querySelectorAll('dialog[open]').length), 0);
    checks.push('narrow 3D workspace and disabling while open fully restore editor');
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
