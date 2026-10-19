import { Timeline, prepareCanvas } from './timeline.ts';
import { GlobalEventDocument } from '../application/global-events.ts';
import { placedGlobalEvent, globalEventDensity } from '../core/global-events.ts';
import { beatValue, fromNumber } from '../core/beat.ts';
import { eventKey, selectAllEvents, transformEvents, deleteEvents, copyEvents, pasteEvents } from '../application/event-commands.ts';
import { GlobalEventInspector } from './global-event-inspector.ts';
import { editorSkinContext, editorCanvasRevision } from './editor-skin-canvas.ts';
import type { AnyEventType, Chart, ChartEvent, GlobalEventValue } from '../core/types.ts';
import type { GlobalEventRegistry } from '../core/global-events.ts';
import type { TempoMap } from '../core/tempo.ts';
import type { TimelineSession } from './timeline.ts';
import type { EventEditSession, EventSelectionEntry, placedEvent } from '../application/event-commands.ts';

interface GeometryColumn { left: number; width: number }
interface GapColumn { left: number; width: number }

export interface GlobalColumnDefinition {
  id: string;
  name: string;
  timelineLabel?: string;
  valueType?: 'number' | 'text' | 'boolean' | 'color' | 'json';
  width?: number;
  defaultValue: unknown;
  overlap: boolean;
  min?: number;
  max?: number;
  step?: number;
  formatValue?(value: unknown): string;
  draw?(context: GlobalEventDrawContext): void;
  shortcut?(context: { action: string; event: ChartEvent }): ChartEvent | null | undefined;
  create?(context: { event: ChartEvent; previous?: ChartEvent; type: GlobalEventTypeDefinition; column: GlobalColumnDefinition }): ChartEvent | null;
  inspector?(context: GlobalEventInspectorContext): void | (() => void);
  validate?(event: GlobalEventValue): void | boolean | string;
}

export interface GlobalEventSource {
  kind: 'builtin' | 'mod';
  id: string;
  name: string;
  author?: string;
  version?: string;
}

export interface GlobalEventTypeDefinition {
  id: string;
  name: string;
  description?: string;
  source: GlobalEventSource;
  persistent: boolean;
  readonly: boolean;
  width?: number;
  columns: GlobalColumnDefinition[];
  inspector?(context: GlobalEventInspectorContext): void | (() => void);
  validate?(event: GlobalEventValue, column: GlobalColumnDefinition): void | boolean | string;
}

export interface GlobalColumnEntry {
  type: GlobalEventTypeDefinition;
  column: GlobalColumnDefinition;
  key: string;
  events: GlobalEventValue[];
}

export interface GlobalEventDrawContext {
  context: CanvasRenderingContext2D;
  rectangle: { x: number; y: number; width: number; height: number; type?: AnyEventType };
  event: ChartEvent;
  selected: boolean;
  tempo: TempoMap;
  seconds: number;
  timeline: Timeline;
  type: GlobalEventTypeDefinition;
  column: GlobalColumnDefinition;
}

export interface GlobalEventInspectorContext {
  container: HTMLElement;
  event: ChartEvent;
  entries: EventSelectionEntry[];
  type: GlobalEventTypeDefinition;
  column: GlobalColumnDefinition;
  update(change: (event: ChartEvent, entry: GlobalColumnEntry | undefined) => ChartEvent, label?: string): void;
  editor: GlobalEventsEditor;
  document: GlobalEventDocumentLike;
}

export interface GlobalEditingSession extends EventEditSession {
  notify(): void;
  clipboardVisible?: boolean;
}

export interface GlobalEventDocumentLike {
  columns: GlobalColumnEntry[];
  types: GlobalEventTypeDefinition[];
  cached: Chart | null;
  editor: GlobalEditingSession;
  snapshot(): Chart;
}

export interface GlobalEventsContext {
  session: TimelineSession;
  tempo: TempoMap;
  timeline: Timeline;
  previewVisible: boolean;
  seconds(): number;
  duration(): number;
}

export interface GlobalEventsEditorOptions {
  activate(pane: string): void;
  invalidate(): void;
  notify(message: string, level?: string): void;
  seek(beat: number): void;
  wheel(event: WheelEvent): void;
}

interface DensityBar {
  canvas: HTMLCanvasElement;
  type: string;
  entries: GlobalColumnEntry[];
  lists?: GlobalEventValue[][];
  duration?: number;
  bins?: number;
  tempo?: TempoMap;
  values?: Uint32Array;
  maximum?: number;
  frame?: HTMLCanvasElement;
  width?: number;
  height?: number;
  ratio?: number;
  skin?: number;
  marker?: number;
}

interface ActionEvent {
  key?: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  repeat?: boolean;
}

const node = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => { const element = document.createElement(tag); if (className) element.className = className; if (text) element.textContent = text; return element; };
class GlobalTimeline extends Timeline {
  owner!: GlobalEventsEditor;
  geometry?: GeometryColumn[];
  panEventColumns?: (delta: number) => void;
  createPlacedEvent?: (...args: Parameters<typeof placedEvent>) => ReturnType<typeof placedEvent>;
  override get eventTypes(): readonly AnyEventType[] { return (this.owner?.document.columns.map(column => column.key) ?? []) as AnyEventType[]; }
  override get factor(): number { return 1; }
  override viewHeight(): number { return this.eventsCanvas.clientHeight; }
  override eventColumnBounds(channel: number): { channelWidth: number; left: number; x: number; width: number } {
    const column = this.owner.geometry?.[channel] ?? { left: 0, width: 80 }, channelWidth = column.width;
    const width = channelWidth * Math.max(0.35, Math.min(1, this.eventBarWidth ?? 0.82));
    return { channelWidth, left: column.left, x: column.left + (channelWidth - width) / 2, width };
  }
  eventChannelAt(x: number): number { return this.owner.geometry?.findIndex(column => x >= column.left && x < column.left + column.width) ?? -1; }
  override grid(context: CanvasRenderingContext2D, width: number, height: number, playBeat: number): void {
    context.save(); context.beginPath();
    for (const column of this.owner.geometry ?? []) context.rect(column.left, 0, column.width, height);
    context.clip();
    this.gridReferenceWidth = this.eventsCanvas.parentElement!.clientWidth;
    super.grid(context, width, height, playBeat); context.restore();
  }
}

export class GlobalEventsEditor {
  host: HTMLElement;
  canvas: HTMLCanvasElement;
  registry: GlobalEventRegistry;
  getContext: () => GlobalEventsContext;
  active: boolean;
  properties: HTMLElement;
  document: GlobalEventDocumentLike;
  timeline: GlobalTimeline;
  inspector: GlobalEventInspector;
  activate: (pane: string) => void;
  invalidate: () => void;
  notify: (message: string, level?: string) => void;
  seek: (beat: number) => void;
  wheel: (event: WheelEvent) => void;
  selectionSignature?: string;
  referenceChrome?: number;
  labelColumns?: GlobalColumnEntry[];
  geometryColumns?: GlobalColumnEntry[];
  defaultWidth?: number;
  gaps: GapColumn[];
  geometry: GeometryColumn[];
  densityBars?: DensityBar[];
  densityRange?: { columns: GlobalColumnEntry[]; tempo: TempoMap; duration: number };

  constructor(host: HTMLElement, canvas: HTMLCanvasElement, registry: GlobalEventRegistry, getContext: () => GlobalEventsContext, options: GlobalEventsEditorOptions) {
    this.host = host; this.canvas = canvas; this.registry = registry; this.getContext = getContext; this.active = false;
    this.activate = options.activate; this.invalidate = options.invalidate; this.notify = options.notify; this.seek = options.seek; this.wheel = options.wheel;
    this.gaps = []; this.geometry = [];
    this.properties = document.querySelector<HTMLElement>('#global-event-inspector')!;
    this.document = new GlobalEventDocument(registry, () => this.context.session, () => {
      if (this.active) {
        const signature = [...this.selection].sort().join('|');
        if (signature !== this.selectionSignature) { this.selectionSignature = signature; this.activate(this.selection.size === 1 ? 'global-event-properties' : 'global-events'); }
        this.render();
      }
      this.invalidate();
    }) as unknown as GlobalEventDocumentLike;
    this.timeline = new GlobalTimeline(document.createElement('canvas'), canvas, () => this.document.editor as unknown as TimelineSession, () => {}, () => this.invalidate(), error => this.report(error));
    this.timeline.owner = this; this.timeline.extended = true; this.timeline.hoverArea = 'events'; this.timeline.tool = 0;
    this.timeline.panEventColumns = (delta: number) => { this.canvas.parentElement!.scrollLeft -= delta; };
    this.timeline.onWheel = (event: WheelEvent) => this.wheel(event); this.timeline.onDragScroll = (seconds: number) => this.context.timeline.onDragScroll?.(seconds);
    this.timeline.createPlacedEvent = (session: EventEditSession, key: AnyEventType, first: number, second: number, easing: number | null | undefined, line?: number, inst?: boolean, preview?: boolean) => {
      const entry = this.document.columns.find(column => column.key === key); if (!entry) throw Error('请选择全局事件列');
      return placedGlobalEvent(entry.type, entry.column, entry.events, first, second, easing, inst, preview);
    };
    this.timeline.formatEventValue = (value: unknown, key: AnyEventType) => {
      const column = this.document.columns.find(column => column.key === key)?.column;
      if (column?.formatValue) return String(column.formatValue(value));
      return typeof value === 'number' ? String(Math.round(value * 1000) / 1000) : typeof value === 'boolean' ? value ? '是' : '否' : typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');
    };
    this.timeline.decorateEvent = (context: CanvasRenderingContext2D, rectangle: { x: number; y: number; width: number; height: number; type?: AnyEventType }, event: ChartEvent, selected: boolean) => {
      const entry = this.document.columns.find(column => column.key === rectangle.type);
      if (entry?.column.draw) this.safely(() => entry.column.draw!({ context, rectangle, event, selected, tempo: this.context.tempo, seconds: this.context.seconds(), timeline: this.timeline, type: entry.type, column: entry.column }));
    };
    this.inspector = new GlobalEventInspector(this.properties, this);
    canvas.addEventListener('pointerdown', event => {
      if (this.active && event.button === 0 && this.selection.size === 1 && this.timeline.eventInteraction.hit(this.timeline.point(event, canvas))) this.activate('global-event-properties');
    });
    canvas.addEventListener('auxclick', event => event.preventDefault());
    canvas.addEventListener('contextmenu', event => { event.preventDefault(); this.timeline.cancelPlacement(); });
    this.registry.addEventListener('change', () => {
      this.timeline.cancelPlacement(); this.document.cached = null;
      if (this.active) this.render(); this.invalidate();
    });
  }
  get context(): GlobalEventsContext { return this.getContext(); }
  get selection(): Set<string> { this.document.snapshot(); return this.document.editor.eventSelection; }
  report(error: unknown): void { const detail = error as { message?: string } | null | undefined; this.notify(detail?.message ?? String(error), 'error'); }
  safely<T>(action: () => T): T | undefined { try { return action(); } catch (error) { this.report(error); return undefined; } }
  open(): void {
    const source = this.context.timeline, stageWidth = this.canvas.closest<HTMLElement>('.stage')!.clientWidth;
    if (!this.active && !source.notesOnly && !source.getSession().multiLineActive && source.eventsCanvas.clientWidth) this.referenceChrome = stageWidth - source.eventsCanvas.clientWidth * 2;
    this.active = true; this.context.timeline.origin = this.context.tempo.beat(this.context.seconds());
    this.activate('global-events'); this.sync(); this.render(); this.invalidate();
  }
  close(): void {
    this.timeline.cancelPlacement(); this.inspector?.dispose(); this.active = false;
    this.context.timeline.origin = this.context.tempo.beat(this.context.seconds(), this.context.session.line?.bpmfactor ?? 1);
    this.syncChrome(); this.activate('chart'); this.invalidate();
  }
  reset(): void { this.timeline.cancelPlacement(); this.inspector?.dispose(); this.active = false; this.document.cached = null; this.document.editor.eventClipboard = []; this.document.editor.eventSelection.clear(); this.syncChrome(); }
  syncChrome(): void {
    document.querySelector<HTMLElement>('.editor')!.classList.toggle('global-events-mode', this.active);
    const hidden = !this.active || this.context.previewVisible, close = document.querySelector<HTMLButtonElement>('#close-global-events')!;
    if (this.canvas.parentElement!.hidden !== hidden) this.canvas.parentElement!.hidden = hidden;
    if (close.hidden !== !this.active) close.hidden = !this.active;
    if (this.active) {
      for (const selector of ['#mirror', '#batch-run', '#notes-only']) { const button = document.querySelector<HTMLButtonElement>(selector)!; if (!button.disabled) button.disabled = true; }
      const label = document.querySelector<HTMLElement>('#selection-info')!, text = `${this.selection.size} 个全局事件已选`;
      if (label.textContent !== text) label.textContent = text;
    }
  }
  sync(): void {
    const source = this.context.timeline;
    type SyncedKey = 'origin' | 'scale' | 'division' | 'judgementOffset' | 'judgementColor' | 'barWidth' | 'barAlpha' | 'eventBarWidth' | 'eventOpacity' | 'seamlessEvents' | 'drawEventCurves' | 'eventValueFontSize' | 'eventCurveThreshold' | 'eventValueThreshold' | 'scrollSpeed';
    const copy = <K extends SyncedKey>(key: K): void => { this.timeline[key] = source[key] as GlobalTimeline[K]; };
    for (const key of ['origin', 'scale', 'division', 'judgementOffset', 'judgementColor', 'barWidth', 'barAlpha', 'eventBarWidth', 'eventOpacity', 'seamlessEvents', 'drawEventCurves', 'eventValueFontSize', 'eventCurveThreshold', 'eventValueThreshold', 'scrollSpeed'] as const) copy(key);
    this.timeline.tempo = this.context.tempo;
    const columns = this.document.columns;
    if (this.labelColumns !== columns) {
      this.labelColumns = columns;
      this.timeline.eventLabels = columns.map(({ type, column }) => column.timelineLabel ?? (type.columns.length > 1 ? type.name + ' · ' + column.name : type.name));
    }
    const viewportWidth = this.canvas.parentElement!.clientWidth;
    const gap = Number.parseFloat(getComputedStyle(this.canvas.closest('.canvases')!).columnGap) || 0;
    const defaultWidth = Math.max(24, (viewportWidth - (this.referenceChrome ?? 48 + gap * 3)) / 10);
    if (this.geometryColumns !== columns || this.defaultWidth !== defaultWidth) {
      this.geometryColumns = columns; this.defaultWidth = defaultWidth;
      let left = 0, previous: string | undefined;
      this.gaps = []; this.geometry = columns.map(entry => {
        if (previous && previous !== entry.type.id) { this.gaps.push({ left, width: 18 }); left += 18; }
        const column = { left, width: entry.column.width ?? entry.type.width ?? defaultWidth }; left += column.width; previous = entry.type.id; return column;
      });
      const minWidth = Math.ceil(left) + 'px'; if (this.canvas.style.minWidth !== minWidth) this.canvas.style.minWidth = minWidth;
    }
    this.syncChrome();
  }
  draw(beat: number): void {
    if (!this.active || this.context.previewVisible) return; this.sync();
    if (this.document.columns.length) {
      this.timeline.drawEvents(beat);
      const context = editorSkinContext(this.canvas.getContext('2d')!); context.fillStyle = '#242424';
      for (const gap of this.gaps) context.fillRect(gap.left, 0, gap.width, this.canvas.clientHeight);
      context.strokeStyle = '#334154'; context.lineWidth = 1; context.beginPath();
      for (const x of new Set(this.geometry.flatMap(column => [column.left, column.left + column.width]))) {
        const line = Math.min(this.canvas.clientWidth - 0.5, Math.round(x) + 0.5);
        context.moveTo(line, 0); context.lineTo(line, this.canvas.clientHeight);
      }
      context.stroke();
    }
    else { const { context, width, height } = prepareCanvas(this.canvas); this.timeline.grid(context, width, height, beat); context.fillStyle = '#dddddd'; context.font = '14px RPE,sans-serif'; context.fillText('暂无可用的全局事件类型', 20, 45); }
    this.drawDensity();
  }
  autoScroll(elapsed: number): void {
    if (!this.active || this.context.previewVisible || !this.timeline.drag && !this.timeline.eventInteraction.drag) return;
    this.sync(); this.timeline.autoScroll(elapsed);
  }
  copy(cut = false): void {
    copyEvents(this.document.editor); this.document.editor.clipboardVisible = true;
    if (cut) deleteEvents(this.document.editor); this.invalidate();
  }
  remove(): void { deleteEvents(this.document.editor); }
  paste(keepTime = false): void { const at = this.timeline.clipboardPointer ? this.timeline.snappedBeat(this.timeline.clipboardPointer.y) : this.context.tempo.beat(this.context.seconds()); pasteEvents(this.document.editor, at, keepTime); }
  action(action: string, event: ActionEvent = {}): boolean {
    if (!this.active || this.context.previewVisible) return false; this.sync();
    const session = this.document.editor;
    if (this.timeline.eventInteraction.pending && /^[0-9]$/.test(event.key ?? '') && !event.ctrlKey && !event.altKey) { this.timeline.eventInteraction.place(undefined, undefined, Number(event.key) || 10); return true; }
    if (['AddTap', 'AddEvent'].includes(action)) { if (!event.repeat) this.timeline.eventInteraction.place(undefined, undefined, undefined, action === 'AddTap'); }
    else if (action === 'SelectAll') { selectAllEvents(session, [...this.timeline.eventTypes]); session.notify(); }
    else if (action === 'Copy') this.copy();
    else if (action === 'Shear') this.copy(true);
    else if (['Paste', 'KeepTimePaste', 'PasteMirror', 'KeepTimePasteMirror'].includes(action)) this.paste(action.startsWith('KeepTime'));
    else if (action === 'Delete') this.remove();
    else if (action === 'QuickDelete') {
      if (!this.selection.size) { const hit = this.timeline.eventCursor && this.timeline.eventInteraction.hit(this.timeline.eventCursor); if (hit) session.eventSelection = new Set([eventKey(hit.type, hit.index)]); }
      this.remove();
    }
    else if (['NumberMirror', 'NumberFill'].includes(action)) transformEvents(session, '修改全局事件数值', (event, key) => {
      const column = this.document.columns.find(column => column.key === key)?.column;
      if (column?.shortcut) return column.shortcut({ action, event: structuredClone(event) }) ?? event;
      if (typeof event.start !== 'number' || typeof event.end !== 'number') return event;
      return action === 'NumberMirror' ? { ...event, start: -event.start, end: -event.end } : { ...event, end: event.start };
    });
    else if (['PageUp', 'PageDown'].includes(action)) { const delta = (action === 'PageUp' ? 1 : -1) / this.timeline.division; transformEvents(session, '移动全局事件', event => ({ ...event, startTime: fromNumber(beatValue(event.startTime) + delta), endTime: fromNumber(beatValue(event.endTime) + delta) })); }
    else if (['PageLeft', 'PageRight', 'AddDrag', 'AddFlick', 'AddHold', 'ToggleMultiLine', 'SwitchMultiLineMode', 'SwitchUI', 'ClipboardHistory', 'CurveBegin', 'CurveEnd'].includes(action)) { /* These operations have no global-column equivalent. */ }
    else if (action === 'Esc') { this.timeline.cancelPlacement(); session.eventSelection.clear(); session.clipboardVisible = false; session.notify(); }
    else return false;
    this.invalidate(); return true;
  }
  render(): void {
    if (!this.active) return; this.sync();
    if (!this.host.closest<HTMLElement>('[data-panel]')!.hidden) this.renderOverview();
    else if (!this.properties.closest<HTMLElement>('[data-panel]')!.hidden) this.inspector.render();
  }
  renderOverview(): void {
    this.inspector.dispose();
    const scroll = this.host.scrollTop; this.host.replaceChildren();
    const heading = node('div', 'panel-title', '全局事件'); heading.append(node('small', '', `${this.document.types.length} 类`)); this.host.append(heading);
    const summary = node('div', 'global-events-types'); this.host.append(summary); this.densityBars = [];
    for (const type of this.document.types) {
      const entries = this.document.columns.filter(entry => entry.type.id === type.id), count = entries.reduce((sum, entry) => sum + entry.events.length, 0);
      const card = node('div', 'global-event-kind'); card.dataset.globalEventType = type.id;
      const title = node('button', 'global-event-kind-title', type.name); title.type = 'button'; title.onclick = () => { const index = this.document.columns.findIndex(entry => entry.type.id === type.id); this.canvas.parentElement!.scrollLeft = this.geometry[index]?.left ?? 0; this.canvas.focus({ preventScroll: true }); };
      title.append(node('small', '', `${count} 个 · ${type.columns.length} 列`)); card.append(title);
      if (type.source.kind === 'mod') card.append(node('div', 'hint global-event-source', `${type.source.name}（${type.source.author}）${type.readonly ? ' · 未加载' : ''}`));
      else if (!type.persistent) card.append(node('div', 'hint global-event-source', '临时测试 · 不保存到谱面'));
      const density = node('canvas', 'global-event-density'); density.dataset.skinCanvas = 'global-density'; density.setAttribute('aria-label', type.name + '全曲分布'); density.title = '点击跳转至对应时间';
      density.onclick = event => { const rect = density.getBoundingClientRect(); this.seek(this.context.tempo.beat(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * this.densityDuration())); };
      card.append(density); summary.append(card); this.densityBars.push({ canvas: density, type: type.id, entries });
    }
    this.host.append(node('p', 'hint', 'Q / R 两次放置 · 拖动移动或调整首尾 · Shift / 中键框选 · 空白处横向拖动浏览事件列。多选支持时间轴操作，暂不提供右侧批量属性编辑。密度条可点击定位。'));
    this.host.append(this.closeButton());
    const returnToTools = node('button', 'wide-button', '返回谱面工具'); returnToTools.type = 'button'; returnToTools.onclick = () => this.activate('chart'); this.host.append(returnToTools);
    this.host.scrollTop = scroll; this.drawDensity();
  }
  closeButton(): HTMLButtonElement {
    const button = node('button', 'wide-button', '关闭全局事件编辑'); button.type = 'button'; button.dataset.globalEventsClose = 'true'; button.onclick = () => this.close(); return button;
  }
  densityDuration(): number {
    const context = this.context, duration = Math.max(0, context.duration() - (context.session.chart.META.offset ?? 0) / 1000);
    if (duration) return duration;
    const columns = this.document.columns;
    if (this.densityRange?.columns !== columns || this.densityRange.tempo !== context.tempo) {
      let end = 0; for (const { events } of columns) for (const event of events) end = Math.max(end, context.tempo.seconds(event.endTime));
      this.densityRange = { columns, tempo: context.tempo, duration: Math.max(8, end + 2) };
    }
    return this.densityRange.duration;
  }
  drawDensity(): void {
    if (this.host.closest<HTMLElement>('[data-panel]')!.hidden) return;
    const duration = this.densityDuration(), tempo = this.context.tempo, seconds = this.context.seconds(), ratio = globalThis.devicePixelRatio || 1, skin = editorCanvasRevision();
    const frames = (this.densityBars ?? []).map(bar => ({ bar, rectangle: bar.canvas.getBoundingClientRect() }));
    for (const { bar, rectangle: { width, height } } of frames) {
      if (!width || !height) continue;
      const bins = Math.max(1, Math.round(width / 3)), pixelWidth = Math.round(width * ratio), pixelHeight = Math.round(height * ratio);
      const lists = bar.entries.map(entry => entry.events);
      const key = lists.every((list, index) => list === bar.lists?.[index]) && lists.length === bar.lists?.length && bar.duration === duration && bar.bins === bins && bar.tempo === this.context.tempo;
      if (!key) { bar.values = globalEventDensity(lists.flat(), tempo, duration, bins); bar.maximum = bar.values.reduce((value, item) => Math.max(value, item), 1); bar.lists = lists; bar.duration = duration; bar.bins = bins; bar.tempo = tempo; }
      const changed = !key || !bar.frame || bar.width !== width || bar.height !== height || bar.ratio !== ratio || bar.skin !== skin;
      if (changed) {
        bar.frame ??= document.createElement('canvas'); bar.frame.width = pixelWidth; bar.frame.height = pixelHeight;
        const context = editorSkinContext(bar.frame.getContext('2d')!, 'global-density'); context.setTransform(ratio, 0, 0, ratio, 0, 0);
        context.fillStyle = '#282828'; context.fillRect(0, 0, width, height);
        for (let index = 0; index < bins; index++) if (bar.values![index]) { const amount = Math.sqrt(bar.values![index] / bar.maximum!); context.fillStyle = '#d39b55'; context.globalAlpha = 0.3 + amount * 0.7; const top = height * (1 - amount) * 0.7; context.fillRect(index * width / bins, top, Math.max(1, width / bins - 0.5), height - top); }
        bar.width = width; bar.height = height; bar.ratio = ratio; bar.skin = skin;
      }
      const marker = Math.max(0, Math.min(width - 1, Math.round(seconds / duration * pixelWidth) / ratio));
      const resized = bar.canvas.width !== pixelWidth || bar.canvas.height !== pixelHeight;
      if (!changed && !resized && bar.marker === marker) continue;
      if (resized) { bar.canvas.width = pixelWidth; bar.canvas.height = pixelHeight; }
      const raw = bar.canvas.getContext('2d')!; raw.setTransform(1, 0, 0, 1, 0, 0); raw.clearRect(0, 0, pixelWidth, pixelHeight); raw.drawImage(bar.frame!, 0, 0);
      const context = editorSkinContext(raw); context.setTransform(ratio, 0, 0, ratio, 0, 0); context.fillStyle = '#ffffff'; context.fillRect(marker, 0, 1, height); bar.marker = marker;
    }
  }
}
