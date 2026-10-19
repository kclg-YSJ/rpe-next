/** RPEN mod API 1. Internal editor classes remain extensible and version-dependent. */
export type Dispose = () => void;
export type Beat = [number, number, number];
export type Setting = {
  label: string; description?: string;
} & (
  | {type: 'boolean'; default: boolean}
  | {type: 'number'; default: number; min: number; max: number; step?: number}
  | {type: 'text' | 'color' | 'shortcut'; default: string}
  | {type: 'select'; default: string; options: Record<string, string>}
);
export interface ModManifest {
  protocol: 'rpen-mod'; api: 1; id: string; name: string;
  version: string; author: string; description: string; entry: string;
  dependencies?: string[]; conflicts?: string[]; settings?: Record<string, Setting>;
  [extension: `x-${string}`]: unknown;
}
export interface Frame {
  /** requestAnimationFrame timestamp in milliseconds. */
  timestamp: number;
  /** Seconds since previous callback, including playback pauses. */
  elapsed: number;
  chartSeconds: number; musicSeconds: number; playing: boolean;
}
export interface PreviewFrame {
  renderer: unknown; target: 'preview' | 'realtime';
  chart: unknown; tempo: unknown; seconds: number; timestamp: number;
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
export interface GlobalEvent {
  startTime: Beat; endTime: Beat; start: unknown; end: unknown;
  easingType?: number; easingLeft?: number; easingRight?: number;
  bezier?: number | boolean; bezierPoints?: [number, number, number, number];
  inst?: number | boolean; linkgroup?: number;
  [key: string]: unknown;
}
export interface GlobalEventInspectorContext {
  /** Property inspectors are mounted only for one selected global event. */
  container: HTMLElement; event: GlobalEvent;
  entries: Array<{type: string; index: number; event: GlobalEvent}>;
  type: unknown; column: GlobalEventColumn; editor: unknown; document: unknown;
  /** Immutable transaction, supports undo/redo. */
  update(change: (event: GlobalEvent, entry: unknown) => GlobalEvent, label?: string): void;
}
export interface GlobalEventColumn {
  /** Local stable identifier, unique within its type. */
  id: string; name: string;
  /** Optional compact title used by the fixed-width timeline column. */
  timelineLabel?: string;
  valueType?: 'number' | 'text' | 'boolean' | 'color' | 'json'; defaultValue?: unknown;
  min?: number; max?: number; step?: number; overlap?: boolean;
  /** CSS pixels, 24–2048. Inherits type width, then ordinary event column width. */
  width?: number;
  create?(context: {event: GlobalEvent; previous?: GlobalEvent; type: unknown; column: GlobalEventColumn}): GlobalEvent | null;
  validate?(event: GlobalEvent): void | boolean | string;
  formatValue?(value: unknown): string;
  draw?(context: {context: CanvasRenderingContext2D; rectangle: {x: number; y: number; width: number; height: number}; event: GlobalEvent; selected: boolean; tempo: unknown; seconds: number; timeline: unknown; type: unknown; column: GlobalEventColumn}): void;
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
  session: unknown; label: string; chart: unknown; beforeSelection: unknown;
  cancel: boolean; normalizeAlpha: boolean;
}
export interface HookPayloads {
  'ui:before-relocate': {node: Element; parent: Node; anchor: Node | null; reason: 'skin-organize' | 'skin-restore'; cancel: boolean};
  /** Runs before ordinary editor input and mod shortcuts. Set handled to consume. */
  'input:before': {event: Event; handled: boolean};
  'session:before-commit': CommitHook;
  'chart:serialize': {chart: unknown; compact: boolean; text: string | null};
  'chart:export-assets': {chart: unknown; chartName: string; assets: Map<string, Uint8Array>; required: Set<string>};
  'preview:before': {chart: unknown; seconds: number; lineIndex: number};
}
export interface Editor {
  readonly session: unknown; readonly chart: unknown; readonly tempo: unknown;
  readonly assets: Map<string, Uint8Array>;
  readonly preferences: unknown; readonly editorPreferences: unknown;
  readonly chartName: string; readonly hasDocument: boolean;
  readonly home: boolean; readonly activePane: string; readonly dirty: boolean;
  /** Backend-neutral record. id and storageRevision are opaque identifiers, not paths. */
  readonly libraryProject: unknown;
  loop: {start: number; end: number} | null;
  audio: unknown; playback: unknown; preview: unknown; realtimePreview: unknown; timeline: unknown;
  skin: unknown; images: unknown; hitSounds: unknown; editorSkins: unknown; noteSkins: unknown; noiseEditor: unknown; eventSampler: unknown;
  trajectoryPanel: unknown; textLinesPanel: unknown; noiseFitPanel: unknown;
  noiseTrackingPanel: unknown; multiEdit: unknown; batchControls: unknown; collaboration: unknown;
  globalEvents: unknown; globalEventRegistry: unknown; openGlobalEvents(): void;
  chartSeconds(): number; offsetSeconds(): number; currentBeat(): number;
  invalidate(): void; render(): void;
  notify(message: string, level?: string): void;
  /** Await the active save queue; rejects on write/conflict errors. New edits can remain dirty. */
  save(): Promise<unknown>;
  activatePane(name: string): void;
  commit(label: string, chart: unknown): unknown;
  replace(chart: unknown, name?: string): unknown;
  seek(seconds: number, options?: {music?: boolean; pause?: boolean}): void;
  seekBeat(beat: number, pause?: boolean): void;
  selectLine(index: number): void;
  setPreview(visible: boolean, options?: {stay?: boolean; autoplay?: boolean}): void;
  play(): Promise<void>; pause(): void;
  addAsset(path: string, bytes: Uint8Array): void; removeAsset(path: string): void;
  /** Changes preview state temporarily; returned function restores view and pauses. */
  beginPreviewSession(): Dispose;
  raw: {
    readonly session: unknown; chart: unknown; readonly assets: Map<string, Uint8Array>;
    tempo: unknown; renderSession: Function; replaceChart: Function; activatePane: Function;
    togglePlayback: Function; togglePreview: Function; save: Function;
    applyDisplaySettings: Function; persistEditor: Function; setHome: Function;
  };
}
export interface ModApi {
  readonly version: 1; readonly id: string; readonly manifest: ModManifest;
  readonly editor: Editor; readonly signal: AbortSignal;
  dispose(cleanup: () => unknown): Dispose;
  log(...values: unknown[]): void;
  notify(message: string, level?: 'success' | 'warning' | 'error' | string): void;
  listen(target: EventTarget, type: string, callback: (event: unknown) => unknown,
    options?: boolean | AddEventListenerOptions): Dispose;
  /** Receives detail directly, not the DOM event. */
  on(type: string, callback: (detail: unknown) => unknown): Dispose;
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
    url(path: string, mime?: string): string; import(path: string): Promise<unknown>;
  };
  commands: {register(command: Command): Dispose};
  globalEvents: GlobalEventsApi;
  lockEditing(options?: {reason?: string; roots?: string[]}): Dispose;
  importInternal(path: string): Promise<unknown>;
}
export interface ModHost {
  apiVersion: 1; editor: Editor;
  /** Advanced mutable internals, see src/ui/mod-runtime.mjs and mod-manager.mjs. */
  runtime: unknown; manager: unknown;
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
