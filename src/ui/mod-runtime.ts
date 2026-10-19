import { localPreferences } from '../platform/local-preferences.ts';
import { rewriteModModule,resolveModImport,modPath,modSettingValue } from '../core/mod-package.ts';
import { registerModHook,emitModHook } from '../core/mod-hooks.ts';
import { parseShortcut,formatShortcut } from '../core/shortcut-spec.ts';
import { shortcutKey,shortcutMatches } from '../core/preferences.ts';
import { isTextEntry } from './keyboard.ts';
import { cancelValueDrag } from './draggable-value.ts';
import type { ShortcutTarget } from './keyboard.ts';
import type { Chart, GlobalEventValue } from '../core/types.ts';

export type ModSettingDefinition =
  | { label: string; description?: string; type: 'boolean'; default: boolean }
  | { label: string; description?: string; type: 'number'; default: number; min: number; max: number; step?: number }
  | { label: string; description?: string; type: 'text' | 'color' | 'shortcut'; default: string }
  | { label: string; description?: string; type: 'select'; default: string; options: Record<string, string> };

export interface ModManifest {
  protocol: string;
  api: number;
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  entry: string;
  dependencies: string[];
  conflicts: string[];
  settings: Record<string, ModSettingDefinition>;
}

export interface ModRecord {
  manifest: ModManifest;
  files: Map<string, Uint8Array>;
  bytes: number;
  builtin?: boolean;
}

export type ModSettings = Record<string, unknown>;

export interface GlobalEventSource {
  kind: 'builtin' | 'mod';
  id: string;
  name: string;
  author?: string;
  version?: string;
}

interface GlobalEventTypeSummary {
  id: string;
  name: string;
  source: GlobalEventSource;
  persistent: boolean;
  readonly: boolean;
  columns: { id: string; name: string; valueType?: string }[];
}

interface GlobalEventChange { type: string; column: string; events: GlobalEventValue[] }
interface GlobalEventDocumentAccess {
  types: GlobalEventTypeSummary[];
  read(type: string, column: string): GlobalEventValue[];
  apply(changes: GlobalEventChange[], label: string): boolean;
}

export interface ModEditor {
  session: { lineIndex?: number; line?: { bpmfactor?: number }; chart: Chart } | null;
  chart: Chart;
  tempo: unknown;
  home: boolean;
  activePane: string;
  dirty: boolean;
  globalEventRegistry: { register(definition: unknown, owner: unknown): () => void };
  globalEvents: { document: unknown };
  openGlobalEvents(): void;
  [key: string]: unknown;
}

interface ModRuntimeOptions {
  editor: ModEditor;
  notify: (message: string, level?: string) => void;
  invalidate: () => void;
  changed: () => void;
}

interface ModGlobalEventColumnDefinition { [key: string]: unknown; id: string; name: string }
interface ModGlobalEventTypeDefinition { [key: string]: unknown; id: string; name: string; columns?: ModGlobalEventColumnDefinition[] }
export interface ModCommandDefinition { id: string; title?: string; shortcut?: string; setting?: string; allowInDialog?: boolean; run: () => unknown }
export interface ModCommand extends ModCommandDefinition { owner: string }
interface ModuleLoad {
  loadId: string;
  prefix: string;
  record: ModRecord;
  resolve(specifier: string, path: string): string;
  urls: string[];
  map: HTMLScriptElement;
}
export interface ModState {
  id: string;
  record: ModRecord;
  scope: ModScope;
  settings: ModSettings;
  onSetting: (key: string, value: unknown) => Promise<void> | void;
  status: 'loading' | 'loaded' | 'error';
  errors: number;
  cancelled?: boolean;
  lastError?: string;
  modules?: ModuleLoad;
  api?: ModApi;
  promise?: Promise<ModState | undefined>;
}
interface EditorState {
  session: unknown;
  chart: unknown;
  playing: boolean;
  home: boolean;
  pane: string;
  lineIndex: number | undefined;
  dirty: boolean;
  [key: string]: unknown;
}
export interface ModFrame {
  timestamp: number;
  elapsed: number;
  chartSeconds: number;
  musicSeconds: number;
  playing: boolean;
}
export interface PreviewFrame {
  target: string;
  chart: unknown;
  tempo: unknown;
  seconds: number;
  timestamp: number;
  renderer?: unknown;
}
interface FrameEntry { owner: string; callback: (frame: ModFrame) => unknown }
interface OverlayEntry { owner: string; callback: (frame: PreviewFrame) => unknown; target: string }
interface LockOptions { reason?: string; roots?: string[] }
interface LockEntry { token: symbol; reason: string }
interface PatchEntry { wrapper: (value: unknown) => unknown }
interface PatchStack { original: unknown; entries: PatchEntry[]; had: boolean; descriptor: PropertyDescriptor | undefined }
type Dispose = () => void;

export interface ModApi {
  version: number;
  id: string;
  manifest: ModManifest;
  editor: ModEditor;
  signal: AbortSignal;
  dispose(cleanup: () => unknown): Dispose;
  log(...values: unknown[]): void;
  notify(message: unknown, level?: string): void;
  listen(target: EventTarget, type: string, callback: (event: unknown) => unknown, options?: boolean | AddEventListenerOptions): Dispose;
  on(type: string, callback: (detail: unknown) => unknown): Dispose;
  emit(type: string, detail?: unknown): void;
  hook(name: string, callback: (payload: unknown) => void, priority?: number): Dispose;
  onFrame(callback: (frame: ModFrame) => unknown): Dispose;
  onPreview(callback: (frame: PreviewFrame) => unknown, options?: { target?: string }): Dispose;
  patch(target: object, key: PropertyKey, wrapper: (previous: unknown) => unknown): Dispose;
  timeout(callback: () => unknown, milliseconds: number): Dispose;
  interval(callback: () => unknown, milliseconds: number): Dispose;
  mount<T extends Node>(node: T, parent?: ParentNode): T;
  style(css: string): HTMLStyleElement;
  settings: {
    get(key: string): unknown;
    set(key: string, value: unknown): Promise<void>;
    onChange(callback: (change: { key: string; value: unknown }) => unknown): Dispose;
  };
  storage: {
    read<T = Record<string, unknown>>(fallback?: T): T;
    write(value: unknown): void;
    clear(): void;
  };
  package: {
    files(): string[];
    bytes(path: string): Uint8Array | null;
    text(path: string): string;
    url(path: string, type?: string): string;
    import(path: string): Promise<unknown>;
  };
  commands: { register(definition: ModCommandDefinition): Dispose };
  globalEvents: {
    register(definition: ModGlobalEventTypeDefinition): Dispose;
    list(): GlobalEventTypeSummary[];
    read(type: string, column: string): GlobalEventValue[];
    replace(type: string, column: string, events: GlobalEventValue[], label?: string): boolean;
    open(): void;
  };
  lockEditing(options?: LockOptions): Dispose;
  importInternal(path: string): Promise<unknown>;
}

interface Catchable { catch(onRejected: (reason: unknown) => unknown): unknown }
const isPromiseLike = (value: unknown): value is Catchable => Boolean(value) && typeof (value as Catchable).catch === 'function';

export class ModScope {
  cleanups: (() => void)[];
  onError: (error: unknown) => void;
  closed: boolean;
  controller: AbortController;

  constructor(onError: (error: unknown) => void = console.error) { this.cleanups = []; this.onError = onError; this.closed = false; this.controller = new AbortController(); }
  defer(dispose: () => unknown): Dispose { if (typeof dispose !== 'function') throw Error('清理回调必须是函数'); const invoke = (): void => { const result = dispose(); if (isPromiseLike(result)) result.catch(this.onError); }; if (this.closed) { invoke(); return () => {}; } let active = true; const cleanup = (): void => { if (!active) return; active = false; const index = this.cleanups.indexOf(cleanup); if (index >= 0) this.cleanups.splice(index, 1); invoke(); }; this.cleanups.push(cleanup); return cleanup; }
  wrap<A extends unknown[], R>(callback: (...args: A) => R): (...args: A) => R | undefined { return (...args: A): R | undefined => { if (this.closed) return undefined; try { const result = callback(...args); if (isPromiseLike(result)) result.catch(this.onError); return result; } catch (error) { this.onError(error); return undefined; } }; }
  listen(target: EventTarget, type: string, callback: (event: unknown) => unknown, options?: boolean | AddEventListenerOptions): Dispose { const wrapped = this.wrap(callback); target.addEventListener(type, wrapped as EventListener, options); return this.defer(() => target.removeEventListener(type, wrapped as EventListener, options)); }
  dispose(): void { if (this.closed) return; this.closed = true; this.controller.abort(); for (const cleanup of this.cleanups.splice(0).reverse()) try { cleanup(); } catch (error) { this.onError(error); } }
}
export class ModRuntime {
  editor: ModEditor;
  notify: (message: string, level?: string) => void;
  invalidate: () => void;
  changed: () => void;
  loaded: Map<string, ModState>;
  commands: Map<string, ModCommand>;
  frames: Set<FrameEntry>;
  overlays: Set<OverlayEntry>;
  events: EventTarget;
  locks: Map<string, Set<LockEntry>>;
  moduleLoads: Map<string, ModuleLoad>;
  baseUrl: string;
  patchTargets: WeakMap<object, Map<PropertyKey, PatchStack>>;
  inertNodes?: WeakMap<HTMLElement, { previous: boolean; count: number }>;
  editorState: EditorState | null;
  lastTime: number | undefined;
  emergency?: () => void;

  constructor({editor,notify,invalidate,changed}: ModRuntimeOptions) { this.editor = editor; this.notify = notify; this.invalidate = invalidate; this.changed = changed; this.loaded = new Map(); this.commands = new Map(); this.frames = new Set(); this.overlays = new Set(); this.events = new EventTarget(); this.locks = new Map(); this.moduleLoads = new Map(); this.baseUrl = new URL('../../', import.meta.url).href; this.patchTargets = new WeakMap(); this.editorState = null; this.lastTime = undefined; }
  async prepareModules(record: ModRecord): Promise<ModuleLoad> {
    const loadId = record.manifest.id + '-' + crypto.randomUUID(); const prefix = '@rpen-mod/' + loadId + '/'; const resolve = (specifier: string, path: string): string => resolveModImport(specifier, path, record.files, prefix, this.baseUrl); const imports: Record<string, string> = {}; const urls: string[] = [];
    try {
      for (const [path, bytes] of record.files) { if (!/\.(m?js|json)$/.test(path)) continue; let source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        if (path.endsWith('.json')) source = 'export default ' + JSON.stringify(JSON.parse(source)) + ';'; else source = rewriteModModule(source, path, resolve, loadId);
        const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' })); urls.push(url); imports[prefix + path] = url;
      }
      const map = document.createElement('script'); map.type = 'importmap'; map.textContent = JSON.stringify({ imports }); document.head.append(map);
      const state: ModuleLoad = { loadId, prefix, record, resolve, urls, map }; this.moduleLoads.set(loadId, state); return state;
    } catch (error) { urls.forEach(URL.revokeObjectURL); throw error; }
  }
  resolveModule(loadId: string, specifier: string, path: string): string { const load = this.moduleLoads.get(loadId); if (!load) throw Error('该模组已卸载'); return load.resolve(specifier, path); }
  load(record: ModRecord, settings: ModSettings, onSetting: (key: string, value: unknown) => Promise<void> | void): Promise<ModState | undefined> {
    const existing = this.loaded.get(record.manifest.id); if (existing) return existing.promise ?? Promise.resolve(existing);
    const promise = this.activate(record, settings, onSetting); const state = this.loaded.get(record.manifest.id); if (state) state.promise = promise; return promise;
  }
  async activate(record: ModRecord, settings: ModSettings, onSetting: (key: string, value: unknown) => Promise<void> | void): Promise<ModState | undefined> {
    const id = record.manifest.id;
    const scope = new ModScope(error => this.failure(id, error)); const state: ModState = { id, record, scope, settings, onSetting, status: 'loading', errors: 0 }; this.loaded.set(id, state);
    try {
      const modules = await this.prepareModules(record); state.modules = modules; scope.defer(() => { modules.urls.forEach(URL.revokeObjectURL); modules.map.remove(); this.moduleLoads.delete(modules.loadId); });
      const api = this.createApi(state); state.api = api;
      // CSP allows imported package modules; packages deliberately execute with the page's authority.
      const module = await import(modules.prefix + record.manifest.entry) as { activate?: (api: ModApi) => unknown; default?: (api: ModApi) => unknown }; if (scope.closed) return; const activate = module.activate ?? module.default; if (typeof activate !== 'function') throw Error('入口模块必须导出 activate(api) 或 default 函数');
      const cleanup = await activate(api); if (typeof cleanup === 'function') scope.defer(cleanup as () => unknown); else if (cleanup && typeof cleanup === 'object' && 'dispose' in cleanup && typeof (cleanup as { dispose?: unknown }).dispose === 'function') scope.defer(() => (cleanup as { dispose(): unknown }).dispose());
      if (scope.closed) return;
      state.status = 'loaded'; this.emit('mod:loaded', { id }); this.changed(); this.invalidate(); return state;
    } catch (error) { scope.dispose(); if (this.loaded.get(id) === state) this.loaded.delete(id); this.changed(); if (!state.cancelled) throw error; return undefined; }
  }
  async unload(id: string, reason = 'disabled'): Promise<void> { const state = this.loaded.get(id); if (!state) return; state.cancelled = true; this.loaded.delete(id); state.scope.dispose(); this.emit('mod:unloaded', { id, reason, error: state.lastError }); this.changed(); this.invalidate(); }
  failure(id: string, error: unknown): void { const state = this.loaded.get(id); if (state) { state.errors++; const detail = error as { stack?: string; message?: string } | null | undefined; state.lastError = detail?.stack ?? String(error); if (state.errors === 1) this.notify(`模组 ${id}：${detail?.message ?? String(error)}`, 'error'); if (state.errors >= 5 && state.status === 'loaded') { state.status = 'error'; queueMicrotask(() => this.unload(id, 'error')); } } console.error('[mod ' + id + ']', error); this.changed(); }
  emit(type: string, detail?: unknown): void { this.events.dispatchEvent(new CustomEvent(type, { detail })); }
  tick(detail: ModFrame): void {
    if (this.loaded.size) { const editor = this.editor; const state: EditorState = { session: editor.session, chart: editor.chart, playing: detail.playing, home: editor.home, pane: editor.activePane, lineIndex: editor.session?.lineIndex, dirty: editor.dirty }; const previous = this.editorState;
      if (!previous || Object.keys(state).some(key => state[key] !== previous[key])) this.emit('editor:state', { ...state, previous });
      if (!previous || state.chart !== previous.chart || state.session !== previous.session) this.emit('editor:chart', { chart: state.chart, session: state.session }); this.editorState = state;
      if (detail.musicSeconds !== this.lastTime) { this.lastTime = detail.musicSeconds; this.emit('editor:time', detail); }
    } else { this.editorState = null; this.lastTime = undefined; }
    for (const entry of [...this.frames]) entry.callback(detail);
  }
  draw(renderer: unknown, frame: PreviewFrame): void { for (const entry of [...this.overlays]) if (!entry.target || entry.target === frame.target) entry.callback({ ...frame, renderer }); }
  shortcut(event: KeyboardEvent): boolean {
    if (event.isComposing || event.repeat || isTextEntry(event.target as unknown as ShortcutTarget | null)) return false;
    for (const command of [...this.commands.values()].reverse()) {
      const state = this.loaded.get(command.owner); const key = command.setting ? state?.settings[command.setting] : command.shortcut;
      if (!key || !shortcutMatches(event, key) || document.querySelector('dialog[open]') && !command.allowInDialog || this.locks.size && !this.locks.has(command.owner)) continue;
      cancelValueDrag(); event.preventDefault(); event.stopImmediatePropagation(); command.run(); return true;
    } return false;
  }
  lock(owner: string, options: LockOptions = {}): Dispose {
    cancelValueDrag();
    const token = Symbol(owner); const releases: (() => void)[] = []; const roots = options.roots ?? ['header nav > :not(#mods-open)', '.transport', '.editor-toolbar', '.timeline-head', '.editor-footer', '.inspector', '.preview-overlay', '.canvases', '#noise-editor-canvas', '.timeline-strips', '#home'];
    const nodes = new Set<HTMLElement>(); const protect = '#mods-open,#mods-status,[data-mod-interactive]'; const collect = (node: HTMLElement): void => { if (node.matches(protect)) return; if (node.querySelector(protect)) { for (const child of node.children) if (child instanceof HTMLElement) collect(child); } else nodes.add(node); }; for (const selector of roots) for (const node of document.querySelectorAll<HTMLElement>(selector)) collect(node);
    this.inertNodes ??= new WeakMap(); for (const node of nodes) { let state = this.inertNodes!.get(node); if (!state) { state = { previous: node.inert, count: 0 }; this.inertNodes!.set(node, state); } state.count++; node.inert = true; releases.push(() => { state!.count--; if (!state!.count) { node.inert = state!.previous; this.inertNodes!.delete(node); } }); }
    const entry: LockEntry = { token, reason: options.reason ?? owner }; let tokens = this.locks.get(owner); if (!tokens) { tokens = new Set(); this.locks.set(owner, tokens); } tokens.add(entry); document.documentElement.dataset.modEditingLocked = 'true';
    let done = false; return () => { if (done) return; done = true; releases.reverse().forEach(fn => fn()); tokens!.delete(entry); if (!tokens!.size) this.locks.delete(owner); if (!this.locks.size) delete document.documentElement.dataset.modEditingLocked; };
  }
  handleInput(event: Event): void {
    const input = emitModHook('input:before', { event, handled: false }) as { event: Event; handled: boolean }; if (input.handled) { cancelValueDrag(); event.preventDefault(); event.stopImmediatePropagation(); return; }
    if (event.type === 'keydown' && this.shortcut(event as KeyboardEvent)) return;
    if (!this.locks.size) return;
    const bypass = (event.target as Element | null)?.closest?.('[data-mod-interactive],#mod-manager,#mods-open,#mods-status,#mods-emergency'); if (bypass) return;
    if (['keydown', 'keyup', 'wheel', 'pointerdown', 'pointerup', 'click', 'dblclick', 'contextmenu', 'drop', 'dragstart', 'input', 'change', 'submit'].includes(event.type)) { event.preventDefault(); event.stopImmediatePropagation(); }
  }
  installInput(): void {
    const gate = globalThis as typeof globalThis & { __rpenModInputGate?: boolean };
    if (gate.__rpenModInputGate) return;
    for (const type of ['keydown', 'keyup', 'wheel', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'drop', 'dragstart', 'input', 'change', 'submit']) window.addEventListener(type, (event: Event) => {
      const keyboard = event as KeyboardEvent;
      if (type === 'keydown' && keyboard.ctrlKey && keyboard.altKey && keyboard.shiftKey && keyboard.key === 'F11') { event.preventDefault(); event.stopImmediatePropagation(); this.emergency?.(); return; } this.handleInput(event);
    }, { capture: true, passive: false });
  }
  patch(scope: ModScope, target: object, key: PropertyKey, wrapper: (value: unknown) => unknown): Dispose {
    if (!target || typeof wrapper !== 'function') throw Error('patch 需要对象、属性名和包装函数'); let props = this.patchTargets.get(target); if (!props) { props = new Map(); this.patchTargets.set(target, props); } let stack = props.get(key);
    if (!stack) { const original = (target as Record<PropertyKey, unknown>)[key]; stack = { original, entries: [], had: Object.hasOwn(target, key), descriptor: Object.getOwnPropertyDescriptor(target, key) }; props.set(key, stack); }
    const current = stack; const entry: PatchEntry = { wrapper }; current.entries.push(entry); const rebuild = (): void => { let value = current.original; for (const item of current.entries) value = item.wrapper(value); Object.defineProperty(target, key, { configurable: true, enumerable: current.descriptor?.enumerable ?? true, writable: true, value }); }; try { rebuild(); } catch (error) { current.entries.pop(); if (!current.entries.length) props.delete(key); throw error; }
    return scope.defer(() => { current.entries = current.entries.filter(item => item !== entry); if (current.entries.length) rebuild(); else { if (current.had) Object.defineProperty(target, key, current.descriptor!); else delete (target as Record<PropertyKey, unknown>)[key]; props.delete(key); } });
  }
  createApi(state: ModState): ModApi {
    const { scope, id, record } = state; const storedKey = 'rpe-next-mod-data:' + id;
    const globalDocument = this.editor.globalEvents.document as GlobalEventDocumentAccess;
    const api: ModApi = {
      version: 1, id, manifest: record.manifest, editor: this.editor, signal: scope.controller.signal, dispose: fn => scope.defer(fn),
      log: (...args: unknown[]) => console.log('[mod ' + id + ']', ...args), notify: (message: unknown, level = 'success') => this.notify(String(message), level),
      listen: (target: EventTarget, type: string, fn: (event: unknown) => unknown, options?: boolean | AddEventListenerOptions) => scope.listen(target, type, fn, options),
      on: (type: string, fn: (detail: unknown) => unknown) => scope.listen(this.events, type, event => fn((event as CustomEvent).detail)), emit: (type: string, detail?: unknown) => this.emit('mod:' + id + ':' + type, detail),
      hook: (name: string, fn: (payload: unknown) => void, priority = 0) => scope.defer(registerModHook(name, fn, priority, error => this.failure(id, error))),
      onFrame: fn => { const entry: FrameEntry = { owner: id, callback: scope.wrap(fn) }; this.frames.add(entry); return scope.defer(() => this.frames.delete(entry)); },
      onPreview: (fn, options = {}) => { const entry: OverlayEntry = { owner: id, callback: scope.wrap(fn), target: options.target ?? 'preview' }; this.overlays.add(entry); return scope.defer(() => this.overlays.delete(entry)); },
      patch: (target: object, key: PropertyKey, wrapper: (previous: unknown) => unknown) => this.patch(scope, target, key, wrapper),
      timeout: (fn: () => unknown, ms: number) => { const timer = setTimeout(scope.wrap(fn), ms); return scope.defer(() => clearTimeout(timer)); },
      interval: (fn: () => unknown, ms: number) => { const timer = setInterval(scope.wrap(fn), ms); return scope.defer(() => clearInterval(timer)); },
      mount: <T extends Node>(node: T, parent: ParentNode = document.body): T => { parent.append(node); scope.defer(() => (node as unknown as ChildNode).remove()); return node; },
      style: (css: string): HTMLStyleElement => { const sheet = document.createElement('style'); sheet.textContent = css; document.head.append(sheet); scope.defer(() => sheet.remove()); return sheet; },
      settings: { get: (key: string) => state.settings[key], set: async (key: string, value: unknown) => { const definition = Object.hasOwn(record.manifest.settings, key) ? record.manifest.settings[key] : null; if (!definition) throw Error('未知模组设置项：' + key); modSettingValue(definition, value, key); await state.onSetting(key, value); }, onChange: (fn: (change: { key: string; value: unknown }) => unknown) => scope.listen(this.events, 'settings:' + id, event => fn((event as CustomEvent<{ key: string; value: unknown }>).detail)) },
      storage: { read: <T = Record<string, unknown>>(fallback?: T): T => { try { return (JSON.parse(localPreferences.getItem(storedKey) ?? 'null') ?? structuredClone(fallback)) as T; } catch { return structuredClone(fallback) as T; } }, write: (value: unknown) => localPreferences.setItem(storedKey, JSON.stringify(value)), clear: () => localPreferences.removeItem(storedKey) },
      package: { files: () => [...record.files.keys()], bytes: (path: string) => record.files.get(modPath(path))?.slice() ?? null,
        text: (path: string) => new TextDecoder('utf-8', { fatal: true }).decode(record.files.get(modPath(path)) ?? new Uint8Array()),
        url: (path: string, type?: string) => { const bytes = record.files.get(modPath(path)); if (!bytes) throw Error('模组素材不存在：' + path); const extension = path.split('.').at(-1)!.toLowerCase(); const mime = type ?? (({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml', webp: 'image/webp', gif: 'image/gif', ogg: 'audio/ogg', wav: 'audio/wav', mp3: 'audio/mpeg', json: 'application/json', css: 'text/css', woff2: 'font/woff2', ttf: 'font/ttf' } as Record<string, string>)[extension] ?? 'application/octet-stream'); const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime })); scope.defer(() => URL.revokeObjectURL(url)); return url; },
        import: (path: string) => import(state.modules!.resolve('./' + modPath(path), '')),
      },
      commands: { register: (definition: ModCommandDefinition) => { if (typeof definition.id !== 'string' || typeof definition.run !== 'function') throw Error('命令缺少 id / run'); const key = id + ':' + definition.id; if (this.commands.has(key)) throw Error('命令重复：' + key); const command: ModCommand = { ...definition, owner: id, run: scope.wrap(definition.run) }; this.commands.set(key, command); this.changed(); return scope.defer(() => { this.commands.delete(key); this.changed(); }); } },
      globalEvents: {
        register: (definition: ModGlobalEventTypeDefinition) => {
          const wrap = <T extends Record<string, unknown>>(value: T): Record<string, unknown> => Object.fromEntries(Object.entries(value).map(([key, item]): [string, unknown] => [key, typeof item === 'function' ? (...args: unknown[]) => { if (scope.closed) throw Error('该模组已停用'); try { return (item as (...parameters: unknown[]) => unknown)(...args); } catch (error) { this.failure(id, error); throw error; } } : item]));
          return scope.defer(this.editor.globalEventRegistry.register({ ...wrap(definition), columns: definition.columns?.map(column => wrap(column)) },
            { kind: 'mod', id, name: record.manifest.name, author: record.manifest.author, version: record.manifest.version }));
        },
        list: () => globalDocument.types.map(type => ({ id: type.id, name: type.name, source: { ...type.source }, persistent: type.persistent, readonly: type.readonly, columns: type.columns.map(column => ({ id: column.id, name: column.name, valueType: column.valueType })) })),
        read: (type: string, column: string) => globalDocument.read(type.includes('/') ? type : id + '/' + type, column),
        replace: (type: string, column: string, events: GlobalEventValue[], label = '模组修改全局事件') => { const key = type.includes('/') ? type : id + '/' + type; if (!key.startsWith(id + '/')) throw Error('请仅使用此接口修改本模组的全局事件'); return globalDocument.apply([{ type: key, column, events }], label); },
        open: () => this.editor.openGlobalEvents(),
      },
      lockEditing: (options?: LockOptions) => scope.defer(this.lock(id, options)),
      importInternal: (path: string) => import(new URL('src/' + modPath(path), this.baseUrl).href),
    }; return api;
  }
}
export function shortcutFromEvent(event: KeyboardEvent): string | null { const parts: string[] = []; if (event.ctrlKey || event.metaKey) parts.push('CTRL'); if (event.altKey) parts.push('ALT'); if (event.shiftKey) parts.push('SHIFT'); const key = shortcutKey(event); if (!['CONTROL', 'SHIFT', 'ALT', 'META'].includes(key)) parts.push(key); const result = parseShortcut(parts.join('&')); return result.error ? null : result.value ?? null; }
export { formatShortcut };
