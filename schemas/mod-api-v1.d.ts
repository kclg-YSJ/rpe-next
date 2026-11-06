/** RPEN mod API 1. Internal editor classes remain extensible and version-dependent. */
export type Dispose = () => void;
export type Beat = [number, number, number];
export type LocalizedText = string | Record<string, string>;
export type SettingDefinition<Text = string> = {
  label: Text; description?: Text;
} & (
  | {type: 'boolean'; default: boolean}
  | {type: 'number'; default: number; min: number; max: number; step?: number}
  | {type: 'text' | 'color' | 'shortcut'; default: string}
  | {type: 'select'; default: string; options: Record<string, Text>}
);
export type Setting = SettingDefinition;
export interface ModManifest {
  protocol: 'rpen-mod'; api: 1; id: string; name: string;
  version: string; author: string; description: string; entry: string;
  dependencies?: string[]; conflicts?: string[]; settings?: Record<string, Setting>;
  homepage?: string;
  market?: {id: string; api: string; [key: string]: unknown};
  [extension: `x-${string}`]: unknown;
}
export type ModManifestSource = Omit<ModManifest, 'name' | 'author' | 'description' | 'settings'> & {
  name: LocalizedText; author: LocalizedText; description: LocalizedText;
  settings?: Record<string, SettingDefinition<LocalizedText>>;
};
export interface Frame {
  /** requestAnimationFrame timestamp in milliseconds. */
  timestamp: number;
  /** Seconds since previous callback, including playback pauses. */
  elapsed: number;
  chartSeconds: number; musicSeconds: number; playing: boolean;
}
export interface PreviewFrame {
  renderer: any; target: 'preview' | 'realtime';
  chart: any; tempo: any; seconds: number; timestamp: number;
}
export interface Command {
  /** Unique within this mod. */
  id: string; title?: string;
  shortcut?: string;
  /** Name of a shortcut setting; takes precedence over shortcut. */
  setting?: string;
  allowInDialog?: boolean;
  run(): unknown;
}
export type GlobalEventSource = {kind: 'builtin' | 'mod'; id: string; name: string; author?: string; version?: string};
/** Normalized time-monotone cubic animation curve, embedded with every event. */
export interface AnimationCurveNode {
  x: number; y: number; mode?: 'auto' | 'smooth' | 'corner' | 'linear' | 'hold';
  in?: [number, number]; out?: [number, number];
  [key: string]: unknown;
}
export interface AnimationCurve { version: 1; name?: string; nodes: AnimationCurveNode[]; [key: string]: unknown; }
export interface CustomEventEasing {
  curve: AnimationCurve;
  /** Source time domain. Cropping retains the original output basis. */
  domain?: [number, number]; sourceStart?: number | number[] | string | boolean; sourceEnd?: number | number[] | string | boolean;
  [key: string]: unknown;
}
export interface GlobalEvent {
  startTime: Beat; endTime: Beat; start: any; end: any;
  easingType?: number; easingLeft?: number; easingRight?: number;
  customEasing?: CustomEventEasing;
  bezier?: number | boolean; bezierPoints?: [number, number, number, number];
  inst?: number | boolean; linkgroup?: number;
  [key: string]: any;
}
export interface GlobalEventInspectorContext {
  /** Property inspectors are mounted only for one selected global event. */
  container: HTMLElement; event: GlobalEvent;
  entries: Array<{type: string; index: number; event: GlobalEvent}>;
  type: any; column: GlobalEventColumn; editor: any; document: any;
  /** Immutable transaction, supports undo/redo. */
  update(change: (event: GlobalEvent, entry: any) => GlobalEvent, label?: string): void;
}
export interface GlobalEventColumn {
  /** Local stable identifier, unique within its type. */
  id: string; name: string;
  /** Optional compact title used by the fixed-width timeline column. */
  timelineLabel?: string;
  valueType?: 'number' | 'text' | 'boolean' | 'color' | 'json'; defaultValue?: any;
  min?: number; max?: number; step?: number; overlap?: boolean;
  /** CSS pixels, 24–2048. Inherits type width, then ordinary event column width. */
  width?: number;
  create?(context: {event: GlobalEvent; previous?: GlobalEvent; type: any; column: GlobalEventColumn}): GlobalEvent | null;
  validate?(event: GlobalEvent): void | boolean | string;
  formatValue?(value: any): string;
  draw?(context: {context: CanvasRenderingContext2D; rectangle: {x: number; y: number; width: number; height: number}; event: GlobalEvent; selected: boolean; tempo: any; seconds: number; timeline: any; type: any; column: GlobalEventColumn}): void;
  inspector?(context: GlobalEventInspectorContext): void | Dispose;
  shortcut?(context: {action: 'NumberMirror' | 'NumberFill'; event: GlobalEvent}): GlobalEvent | null;
}
export interface GlobalEventType {
  /** Local id; the host prefixes <mod id>/. Prefer mod name + author in name. */
  id: string; name: string; description?: string; columns: GlobalEventColumn[];
  width?: number; persistent?: boolean;
  validate?(event: GlobalEvent, column: GlobalEventColumn): void | boolean | string;
  inspector?(context: GlobalEventInspectorContext): void | Dispose;
}
export interface GlobalEventsApi {
  /** Registration is automatically removed on unload; chart data is retained. */
  register(type: GlobalEventType): Dispose;
  list(): Array<{id: string; name: string; source: GlobalEventSource; persistent: boolean; readonly: boolean; columns: Array<{id: string; name: string; valueType: string}>}>;
  /** Returns a deep copy; accepts local or namespaced type id. */
  read(type: string, column: string): GlobalEvent[];
  /** Own types only. Source metadata is stamped automatically. */
  replace(type: string, column: string, events: GlobalEvent[], label?: string): boolean;
  open(): void;
}
export interface CommitHook {
  session: any; label: string; chart: any; beforeSelection: any;
  cancel: boolean; normalizeAlpha: boolean;
}
export interface HookPayloads {
  'ui:before-relocate': {node: Element; parent: Node; anchor: Node | null; reason: 'skin-organize' | 'skin-restore'; cancel: boolean};
  /** Runs before ordinary editor input and mod shortcuts. Set handled to consume. */
  'input:before': {event: Event; handled: boolean};
  'session:before-commit': CommitHook;
  'session:after-commit': {session: any; label: string; chart: any};
  'chart:parse': {text: string; chart: any | null};
  'chart:parsed': {chart: any};
  'chart:validate': {chart: any; handled: boolean};
  'chart:serialize': {chart: any; compact: boolean; text: string | null};
  /** Add project asset paths required by custom chart data before PEZ pruning. */
  'chart:export-assets': {chart: any; chartName: string; assets: Map<string, Uint8Array>; required: Set<string>};
  'preview:before': {chart: any; seconds: number; lineIndex: number};
}
export interface Editor {
  readonly session: any; readonly chart: any; readonly tempo: any;
  readonly assets: Map<string, Uint8Array>;
  readonly preferences: any; readonly editorPreferences: any;
  readonly chartName: string; readonly hasDocument: boolean;
  readonly home: boolean; readonly activePane: string; readonly dirty: boolean;
  /** Backend-neutral record. id and storageRevision are opaque identifiers, not paths. */
  readonly libraryProject: any;
  loop: {start: number; end: number} | null;
  audio: any; audioSources: any; audioOnsets: any; audioAnalysis: any; playback: any; preview: any; realtimePreview: any; timeline: any;
  skin: any; images: any; hitSounds: any; editorSkins: any; noteSkins: any; noiseEditor: any; eventSampler: any;
  /** Advanced floating panel; edits native line speed events using distance easing. */
  speedCurve: { active: boolean; open(anchor?: { x: number; y: number }): boolean; close(): void; saveView(immediate?: boolean): void };
  trajectoryPanel: any; textLinesPanel: any; noiseFitPanel: any;
  /** Lazily loaded spatial trajectory editor. Disabled views create no scene indexes. */
  spatialTool: { readonly enabled: boolean; open(): Promise<void>; reset(): void };
  noiseTrackingPanel: any; multiEdit: any; batchControls: any; collaboration: any;
  globalEvents: any; globalEventRegistry: any; openGlobalEvents(): void;
  versionControl: any;
  chartSeconds(): number; offsetSeconds(): number; currentBeat(): number;
  invalidate(): void; render(): void;
  notify(message: string, level?: string): void;
  /** Await the active save queue; rejects on write/conflict errors. New edits can remain dirty. */
  save(): Promise<unknown>;
  activatePane(name: string): void;
  commit(label: string, chart: any): unknown;
  replace(chart: any, name?: string): unknown;
  seek(seconds: number, options?: {music?: boolean; pause?: boolean}): void;
  seekBeat(beat: number, pause?: boolean): void;
  selectLine(index: number): void;
  setPreview(visible: boolean, options?: {stay?: boolean; autoplay?: boolean}): void;
  play(): Promise<void>; pause(): void;
  addAsset(path: string, bytes: Uint8Array): void; removeAsset(path: string): void;
  /** After replacing shader resource bytes: marks assets dirty, refreshes diagnostics and shader caches without reloading images. */
  shaderAssetsChanged(): void;
  /** Changes preview state temporarily; returned function restores view and pauses. */
  beginPreviewSession(): Dispose;
  raw: {
    readonly session: any; chart: any; readonly assets: Map<string, Uint8Array>;
    tempo: any; renderSession: Function; replaceChart: Function; activatePane: Function;
    togglePlayback: Function; togglePreview: Function; save: Function;
    applyDisplaySettings: Function; persistEditor: Function; setHome: Function;
  };
}
export interface ModApi {
  agent: {
    register(definition: {
      name: string; description: string; access: 'read' | 'edit' | 'dangerous';
      parameters: Record<string, unknown>;
      prepare(args: any, context: {signal: AbortSignal}): Promise<AgentCommandPlan> | AgentCommandPlan;
    }): Dispose;
    list(): Array<{type: 'function'; function: {name: string; description: string; parameters: any}}>;
  };
  readonly version: 1; readonly id: string; readonly manifest: ModManifest; readonly manifestSource: ModManifestSource;
  readonly editor: Editor; readonly signal: AbortSignal;
  dispose(cleanup: () => unknown): Dispose;
  log(...values: unknown[]): void;
  notify(message: string, level?: 'success' | 'warning' | 'error' | string): void;
  listen(target: EventTarget, type: string, callback: (event: any) => unknown,
    options?: boolean | AddEventListenerOptions): Dispose;
  /** Receives detail directly, not the DOM event. */
  on(type: string, callback: (detail: any) => unknown): Dispose;
  /** Emits mod:<id>:<type>. */
  emit(type: string, detail?: unknown): void;
  /** Callbacks must edit payload synchronously. */
  hook<K extends keyof HookPayloads>(name: K,
    callback: (payload: HookPayloads[K]) => void, priority?: number): Dispose;
  onFrame(callback: (frame: Frame) => unknown): Dispose;
  onPreview(callback: (frame: PreviewFrame) => unknown,
    options?: {target?: 'preview' | 'realtime'}): Dispose;
  patch<T extends object, K extends keyof T>(target: T, key: K,
    wrapper: (previous: T[K]) => T[K]): Dispose;
  timeout(callback: () => unknown, milliseconds: number): Dispose;
  interval(callback: () => unknown, milliseconds: number): Dispose;
  mount<T extends Node>(node: T, parent?: Node): T;
  style(css: string): HTMLStyleElement;
  settings: {
    get(key: string): boolean | number | string;
    /** Validates and updates; desktop file persistence is queued separately. */
    set(key: string, value: boolean | number | string): Promise<void>;
    onChange(callback: (change: {key: string; value: boolean | number | string}) => unknown): Dispose;
  };
  storage: {
    /** Personal mod data in the current browser origin or desktop library, outside the chart. */
    read<T = Record<string, unknown>>(fallback?: T): T;
    /** Synchronous API; desktop persistence runs in the background. Awaiting void does not flush it. */
    write(value: unknown): void; clear(): void;
  };
  package: {
    files(): string[]; bytes(path: string): Uint8Array | null; text(path: string): string;
    url(path: string, mime?: string): string; import(path: string): Promise<any>;
  };
  commands: {register(command: Command): Dispose};
  globalEvents: GlobalEventsApi;
  lockEditing(options?: {reason?: string; roots?: string[]}): Dispose;
  importInternal(path: string): Promise<any>;
}
export interface AgentCommandPlan {
  summary?: string; details?: unknown; access?: 'read' | 'edit' | 'dangerous';
  valid?(): boolean;
  apply(context: {signal: AbortSignal}): unknown | Promise<unknown>;
}
export interface ModHost {
  apiVersion: 1; editor: Editor;
  /** Advanced mutable internals, see src/ui/mod-runtime.mjs and mod-manager.mjs. */
  runtime: any; manager: any;
  resolveModule(loadId: string, specifier: string, from: string): string;
  disableAll(): Promise<void>;
}
export type Activate = (api: ModApi) => void | Dispose | {dispose(): unknown}
  | Promise<void | Dispose | {dispose(): unknown}>;
export function getEditor(): Editor;
export function getModHost(): ModHost;
export const apiVersion: 1;
export default getEditor;
declare global { interface Window {rpenMods: ModHost} }
