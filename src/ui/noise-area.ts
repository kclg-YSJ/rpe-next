import { createNoiseArea, createNoiseEvent, noiseCenter, noiseHasAnchor, noiseRuntime, NOISE_TRACKS, withNoiseAreas, shiftNoiseArea } from '../core/noise-areas.ts';
import type { NoiseArea, NoiseEvent, NoiseInterval, NoiseTarget } from '../core/noise-areas.ts';
import { samplingTarget, sampleEditingArea, noiseSampleHandle, applyNoiseSample, fitNoiseSampleView } from '../core/noise-sampling.ts';
import { beatValue, fromNumber, parseBeat, formatBeat } from '../core/beat.ts';
import { previewViewport, strokeIntersects } from '../core/editor-display.ts';
import type { EventChain, Point } from '../core/editor-display.ts';
import { prepareCanvas } from './timeline.ts';
import { createEasingPicker, EASING_NAMES } from './easing-picker.ts';
import { NoiseAreaList } from './noise-list.ts';
import { NoiseLayerPanel } from './noise-layer-panel.ts';
import { noiseLayers, noiseLayerId } from '../core/noise-skin.ts';
import { drawEventCurve, drawEventCurveBatch } from './event-curve.ts';
import type { CurveBatchEntry } from './event-curve.ts';
import { eventDisplayIndex, selectedEventGroups } from './event-display-index.ts';
import { evaluateEventNumber } from '../core/numeric-expression.ts';
import { numericExpressionSource, setNumericExpressionResolver } from './numeric-expression-input.ts';
import type { TempoMap } from '../core/tempo.ts';
import type { Chart, Beat, ChartEvent, NoiseLayer } from '../core/types.ts';
import type { IntervalIndex } from '../core/interval-index.ts';

/** A judge line's or noise area's entry in the noise timeline, as `drawEntry` builds it. */
export interface NoiseRect {
  x: number;
  y: number;
  width: number;
  height: number;
  index: number;
  /** The noise track this rect belongs to, or `null` for an area bar. */
  type: string | null;
  head: number;
  tail: number;
  start: number;
  end: number;
}

/** A rect plus the handle the pointer is over, if any. */
export type NoiseHover = NoiseRect & { kind: 'start' | 'end' | 'move' };

/** The offscreen bounds `selectionRects` yields; rectangle selection reads only these members. */
export interface SelectionRect {
  x: number;
  width: number;
  index: number;
  type: string | null;
  start: number;
  end: number;
}

/** One seamless chain's curve sample, batched so a whole chain strokes in a single pass. */
interface CurveSample {
  event: Record<string, unknown>;
  range: EventChain;
  startY: number;
  endY: number;
}

/**
 * What `event-display-index.ts` returns for one track.
 *
 * The module is still plain JavaScript, so its own return type is inferred as `any`; declaring the
 * shape the editor reads keeps every lookup below checked instead of silently unchecked.
 */
interface EventDisplay {
  groups: EventChain[];
  ranges: Map<number, EventChain>;
  unmergeable: Set<EventChain>;
  index: IntervalIndex<NoiseEvent>;
}

/**
 * `findLast` is an ES2023 addition while `tsconfig.json` pins `lib` to ES2022 (the runtime is ES2023,
 * the same reason `clipboard-history.ts` declares `findLastIndex`). Declaring only the method this
 * file calls keeps the lookup a one-liner without widening `lib`.
 */
type LastSearch<T> = { findLast(predicate: (value: T, index: number, array: T[]) => boolean): T | undefined };

/** The live editor state the panel reads; supplied through `getContext`. */
export interface NoiseEditorContext {
  session: {
    chart: Chart;
    selection: Set<number>;
    eventSelection: Set<string>;
    multiLineActive: boolean;
    focus: string;
    line?: { bpmfactor?: number };
  };
  tempo: { beat(seconds: number, factor?: number): number; seconds(beat: Beat | number, factor?: number): number };
  timeline: {
    origin: number;
    judgementOffset: number;
    scale: number;
    division: number;
    gridCount: number;
    judgementColor?: string;
    /**
     * The event-display tuning the timeline's own event editor reads.
     *
     * The noise editor now draws its tracks with the same chain merging and curve rendering, so it
     * reads the same optional settings; each is compared against `false`/a fallback exactly as the
     * timeline does, so an unset value keeps the previous behaviour.
     */
    seamlessEvents?: boolean;
    drawEventCurves?: boolean;
    eventCurveThreshold?: number;
    eventValueThreshold?: number;
    eventValueFontSize?: number;
  };
  preview: { visible: boolean; viewDivisor?: number; aspectRatio?: number };
  realtimePreview: { visible: boolean; viewDivisor?: number; aspectRatio?: number };
  previewVisible: boolean;
  /** The current playhead, in seconds. A callback because playback moves it. */
  seconds: () => number;
  /** Whether the sample view may auto-fit its zoom. */
  sampleAutoFit?: boolean;
}

/** The collaborators the panel is wired to. */
export interface NoiseEditorOptions {
  commit(label: string, chart: Chart): void;
  invalidate(): void;
  notify(message: string, kind: 'error' | 'warning' | 'success'): void;
  activate(pane: string): void;
  pause(): void;
  seek(beat: number): void;
  wheel(event: WheelEvent): void;
  /** The document's asset store, which the layer panel reads to list and parse installed skins. */
  getAssets(): Map<string, Uint8Array>;
  /** Installs the files a skin import or a built-in skin unpacked. */
  onAssets(entries: Map<string, Uint8Array>): void;
}

/** A clipboard entry: either a whole area or one event from a track. */
interface NoiseClipboardEntry {
  type: string;
  value: NoiseArea | NoiseEvent;
}

/** The in-progress sample drag, in screen coordinates. */
interface SampleDrag {
  pointer: Point;
  offset: Point;
}

/** The sample view: the overlay's box, the viewport it maps, and the two coordinate conversions. */
interface SampleView {
  width: number;
  height: number;
  left: number;
  top: number;
  viewport: { scale: number; width: number; height: number; left: number; top: number };
  scale: number;
  world(point: Point): Point;
  screen(point: Point): Point;
}

function button(text: string, title: string, run: () => void): HTMLButtonElement {
  const control = document.createElement('button'); control.type = 'button'; control.textContent = text; control.title = title; control.onclick = run; return control;
}
function hint(text: string): HTMLParagraphElement { const node = document.createElement('p'); node.className = 'hint'; node.textContent = text; return node; }
const round = (value: number): number => Math.round(value * 10000) / 10000;
const durationText = (value: unknown): string => String(Math.round(Math.max(0, Number(value) || 0) * 1000) / 1000);
const readyFlashValue = (value: unknown): number => typeof value === 'boolean' ? (value ? 0.5 : 0) : Number.isFinite(value) ? Math.max(0, value as number) : 0.5;
const colors = ['#e5ab66', '#82b8df', '#b1b0e4', '#e9a4b0', '#86c3aa', '#d0bd7b'];
const HEADER_HEIGHT = 0;
const AREA_BAR_WIDTH = 60;

/** The options a `field` control is built with. */
interface FieldOptions {
  kind?: 'number' | 'beat' | 'duration' | 'checkbox' | 'text';
  step?: number;
  sample?: NoiseTarget;
  /** A select's `[value, label]` pairs; the 噪域层 select carries string ids, the rest numbers. */
  choices?: [number | string, string][];
  clear?: boolean;
}

/** The merged interval lists and ready-flash spans `drawDistribution` caches for one area. */
interface NoiseDistribution {
  tracks: [number, number][][];
  flashes: [number, number][];
  /** The tempo the spans were measured against; a different map invalidates the entry. */
  tempo: NoiseEditorContext['tempo'];
}

/**
 * The 噪域编辑 panel: draws the area/track timeline and edits an area's properties.
 *
 * The panel keeps a `draftChart` while a gesture is in flight and only commits on release, so a drag
 * produces one history entry rather than one per frame. `blockAreaList` is the format's own list, so
 * every edit round-trips through `withNoiseAreas` — which also validates and bumps `META.RPEVersion`.
 */
export class NoiseAreaEditor {
  eventDisplayChart?: Chart;
  host: HTMLElement;
  canvas: HTMLCanvasElement;
  getContext: () => NoiseEditorContext;
  // Assigned from `options` by the constructor's `Object.assign`, which the checker cannot follow.
  commit!: (label: string, chart: Chart) => void;
  invalidate!: () => void;
  notify!: (message: string, kind: 'error' | 'warning' | 'success') => void;
  activate!: (pane: string) => void;
  pause!: () => void;
  seek!: (beat: number) => void;
  wheel!: (event: WheelEvent) => void;
  /** The asset store, read by the layer panel; assigned from `options` like the hooks above. */
  getAssets!: () => Map<string, Uint8Array>;
  onAssets!: (entries: Map<string, Uint8Array>) => void;
  /** The properties pane, resolved once from the document. */
  properties: HTMLElement;
  active: boolean;
  /** The selected area's index, or `-1`. */
  selected: number;
  /** The selected keys, as `area:N` or `track:N`. */
  selection: Set<string>;
  /** The selected event within the selected area, if any. */
  event: { type: string; index: number } | null;
  cursor: (Point & { side: string; type: string; beat: number; rawBeat: number }) | null;
  /** The rects the pointer can hit. */
  rects: NoiseRect[];
  hover: NoiseHover | null;
  clipboard: { entries: NoiseClipboardEntry[]; start: number } | null;
  /** The first click of a two-click placement. */
  pending: (Point & { side: string; type: string; beat: number; rawBeat: number; hooked: boolean }) | null;
  /** The chart a gesture has produced but not yet committed. */
  draftChart: Chart | null;
  dragError: Error | null;
  easingState: { open: boolean };
  /** Merged interval lists per area, cached because merging runs on every repaint. */
  distributions: WeakMap<NoiseArea, NoiseDistribution>;
  /** The layers whose preview this session hid or forced to simple rendering; editor-only state. */
  hiddenLayers: Set<string>;
  simpleLayers: Set<string>;
  areaList: NoiseAreaList;
  layerPanel: NoiseLayerPanel;
  overlay: HTMLCanvasElement;
  sampleBar: HTMLDivElement;
  drag: { kind: string; start: NonNullable<NoiseAreaEditor['cursor']>; current?: NonNullable<NoiseAreaEditor['cursor']>; hit?: NoiseRect; base?: Chart; keys?: Set<string>; baseSelection?: Set<string>; points?: Point[]; moved: boolean } | null = null;
  sampleMode: (NoiseTarget & { base: Chart }) | null = null;
  sampleSeconds = 0;
  // `renderer` is the live preview state object, not a copy, so writing `viewDivisor` back onto it is
  // the point; it is the same shape `NoiseEditorContext.preview` declares.
  sampleZoom: { renderer: NoiseEditorContext['preview']; original: number; divisor: number }[] | null = null;
  sampleDrag: SampleDrag | null = null;
  samplePreviewCache: { source: Chart; mode: NoiseTarget; result: { chart: Chart; seconds: number } } | null = null;
  /** The signature the properties pane was last built for, so a focused field is not rebuilt. */
  formSignature: string | null = null;
  formCommitting = false;
  drawingLayout: { width: number; height: number; split: number; eventLeft: number; eventWidth: number } | null = null;
  listTitle: HTMLDivElement | null = null;
  modeHeader: HTMLSpanElement;
  modePrimary: HTMLSpanElement;
  modeCount: HTMLElement;
  modeOwner: HTMLSpanElement;
  modeTracks: HTMLSpanElement[];

  constructor(host: HTMLElement, canvas: HTMLCanvasElement, getContext: () => NoiseEditorContext, options: NoiseEditorOptions) {
    Object.assign(this, options); this.host = host; this.canvas = canvas; this.getContext = getContext;
    this.properties = document.querySelector('#noise-properties') as HTMLElement; this.active = false; this.selected = -1; this.selection = new Set();
    this.event = null; this.cursor = null; this.rects = []; this.hover = null; this.clipboard = null; this.pending = null; this.draftChart = null; this.dragError = null; this.easingState = { open: false };
    this.distributions = new WeakMap(); this.hiddenLayers = new Set(); this.simpleLayers = new Set();
    this.areaList = new NoiseAreaList(index => this.select(index));
    this.layerPanel = new NoiseLayerPanel(this);
    this.modeHeader = document.createElement('span'); this.modeHeader.className = 'noise-mode-head'; this.modeHeader.hidden = true;
    this.modePrimary = document.createElement('span'); this.modePrimary.className = 'noise-mode-primary';
    const modeTitle = document.createElement('strong'); modeTitle.textContent = '噪域编辑';
    this.modeCount = document.createElement('small'); this.modeCount.className = 'noise-mode-count'; this.modeOwner = document.createElement('span'); this.modeOwner.className = 'noise-mode-owner';
    this.modePrimary.append(modeTitle, this.modeCount, this.modeOwner);
    const spacer = document.createElement('span'); spacer.className = 'noise-mode-spacer';
    this.modeTracks = NOISE_TRACKS.map(([, label]) => { const item = document.createElement('span'); item.className = 'noise-mode-track'; item.textContent = label; return item; });
    const trailing = document.createElement('span'); trailing.className = 'noise-mode-spacer';
    this.modeHeader.append(this.modePrimary, spacer, ...this.modeTracks, trailing);
    (document.querySelector('.timeline-head') as HTMLElement).append(this.modeHeader);
    this.overlay = document.createElement('canvas'); this.overlay.className = 'noise-sampler'; this.overlay.hidden = true; (canvas.closest('.stage') as HTMLElement).append(this.overlay);
    this.sampleBar = document.createElement('div'); this.sampleBar.className = 'noise-sample-bar'; this.sampleBar.hidden = true;
    this.sampleBar.append(hint('拖动绿色控制点 · 可连续取样，完成统一应用 · Esc 全部取消'), button('完成取样', '保留全部取样结果并返回时间轴', () => this.endSample(true)), button('取消', '放弃全部取样修改', () => this.endSample(false))); (canvas.closest('.stage') as HTMLElement).append(this.sampleBar);
    // The DOM listener contract is `Event`; every one of these is dispatched as a pointer event, so
    // the narrower parameter is honest and the cast only bridges the contract's wider parameter.
    for (const [name, handler] of [['pointerdown', (event: PointerEvent) => this.down(event)], ['pointermove', (event: PointerEvent) => this.move(event)], ['pointerup', (event: PointerEvent) => this.up(event)], ['pointercancel', () => this.cancelGesture()]] as [string, (event: PointerEvent) => void][]) canvas.addEventListener(name, handler as EventListener);
    canvas.addEventListener('wheel', event => { event.preventDefault(); event.stopPropagation(); if (!this.sampleMode) { this.wheel(event); this.cursor = this.point(event); this.updateDrag(); } }, { passive: false });
    canvas.addEventListener('contextmenu', event => { event.preventDefault(); this.pending = null; this.invalidate(); });
    canvas.addEventListener('auxclick', event => event.preventDefault());
    this.overlay.addEventListener('pointerdown', event => this.sampleDown(event));
    this.overlay.addEventListener('pointermove', event => this.sampleMove(event));
    this.overlay.addEventListener('pointerup', event => { this.sampleDrag = null; this.overlay.releasePointerCapture?.(event.pointerId); });
    this.overlay.addEventListener('pointercancel', () => { this.sampleDrag = null; });
    this.canvas.addEventListener('pointerleave', () => { if (!this.drag) { this.cursor = null; this.hover = null; this.canvas.style.cursor = 'default'; this.invalidate(); } });
  }
  get context(): NoiseEditorContext { return this.getContext(); }
  get chart(): Chart { return this.draftChart ?? this.context.session.chart; }
  areas(): NoiseArea[] { return (this.chart.blockAreaList as NoiseArea[] | undefined) ?? []; }
  area(): NoiseArea | undefined { return this.areas()[this.selected]; }
  open(): void { this.active = true; this.context.timeline.origin = this.context.tempo.beat(this.context.seconds()); this.syncChrome(); this.activate('noise'); this.render(); this.invalidate(); }
  close(): void { this.flush(); this.cancelGesture(); this.endSample(false); this.active = false; this.context.timeline.origin = this.context.tempo.beat(this.context.seconds(), this.context.session.line?.bpmfactor ?? 1); this.syncChrome(); this.activate('chart'); this.invalidate(); }
  reset(): void { this.cancelGesture(); this.endSample(false); this.active = false; this.selected = -1; this.selection.clear(); this.event = null; this.pending = null; this.hiddenLayers.clear(); this.simpleLayers.clear(); this.areaList.reset(); this.syncChrome(); }
  syncChrome(): void {
    (document.querySelector('.editor') as HTMLElement).classList.toggle('noise-mode', this.active);
    this.modeHeader.hidden = !this.active;
    this.modeCount.textContent = `噪域数量 ${this.areas().length}`;
    this.modeOwner.textContent = this.area() ? `#${this.selected} ${this.area()!.Name || '未命名噪域'}` : '未指定噪域';
    if (this.active && !this.canvas.hidden) {
      const layout = this.layout();
      if (layout.width > 0) this.modeHeader.style.gridTemplateColumns = `${layout.split}px 30px repeat(${NOISE_TRACKS.length}, ${layout.eventWidth}px) 10px`;
    }
    this.canvas.hidden = !this.active || this.context.previewVisible || Boolean(this.sampleMode);
    (document.querySelector('#noise-tab') as HTMLElement).hidden = !this.active;
    this.overlay.hidden = !this.sampleMode; this.sampleBar.hidden = !this.sampleMode;
    (document.querySelector('.editor') as HTMLElement).classList.toggle('noise-sampling', Boolean(this.sampleMode));
    (document.querySelector('#mirror') as HTMLButtonElement).disabled = this.active;
    (document.querySelector('#batch-run') as HTMLButtonElement).disabled = this.active || !this.context.session.selection.size;
    (document.querySelector('#notes-only') as HTMLButtonElement).disabled = this.active || this.context.session.multiLineActive;
    (document.querySelector('#selection-info') as HTMLElement).textContent = this.active ? `${this.selection.size} 个噪域${this.event || [...this.selection].some(key => !key.startsWith('area:')) ? '内部事件' : ''}已选` : this.context.session.focus === 'events' ? `${this.context.session.eventSelection.size} 个事件已选` : `${this.context.session.selection.size} 个音符已选`;
    if (!this.sampleMode) (document.querySelector('#realtime-preview') as HTMLElement).hidden = !this.context.realtimePreview.visible;
  }
  report(error: Error): void { this.notify(error.message, 'error'); }
  commitAreas(label: string, areas: NoiseArea[]): boolean {
    try {
      const chart = withNoiseAreas(this.context.session.chart, areas);
      this.draftChart = null; this.commit(label, chart); this.render(); this.invalidate(); return true;
    } catch (error) { this.report(error as Error); this.draftChart = null; this.invalidate(); return false; }
  }
  replaceArea(area: NoiseArea, base: Chart = this.context.session.chart): Chart {
    return withNoiseAreas(base, ((base.blockAreaList as NoiseArea[] | undefined) ?? []).map((entry, index) => index === this.selected ? area : entry));
  }
  edit(change: (area: NoiseArea) => NoiseArea, finish = true): boolean {
    const current = this.area();
    if (!current) return false;
    try {
      const target = this.event;
      const previous = target ? (current[target.type] as NoiseEvent[] | undefined)?.[target.index] : null;
      const area = change(structuredClone(current));
      if (previous && previous.linkgroup !== undefined && previous.linkgroup > 0 && target!.type !== 'activeIntervals') {
        const next = (area[target!.type] as NoiseEvent[])[target!.index];
        const fields = ['start', 'end', 'easingType', 'easingLeft', 'easingRight', 'bezier', 'bezierPoints'];
        if (fields.some(field => JSON.stringify((previous as unknown as Record<string, unknown>)[field]) !== JSON.stringify((next as unknown as Record<string, unknown>)[field]))) (area as unknown as Record<string, NoiseEvent[]>)[target!.type] = (area[target!.type] as NoiseEvent[]).map((entry, index) => {
          if (index === target!.index || entry.linkgroup !== previous.linkgroup) return entry;
          const linked = { ...entry, ...Object.fromEntries(fields.filter(field => (next as unknown as Record<string, unknown>)[field] !== undefined).map(field => [field, structuredClone((next as unknown as Record<string, unknown>)[field])])) } as NoiseEvent;
          if (linked.inst) linked.end = linked.start;
          return linked;
        });
      }
      this.draftChart = this.replaceArea(area);
      if (finish) this.flush();
      this.invalidate();
    } catch (error) { if (finish) this.report(error as Error); return false; }
    return true;
  }
  flush(): void {
    if (!this.draftChart || this.sampleMode) return;
    const chart = this.draftChart; this.draftChart = null; this.formCommitting = true;
    try { this.commit('编辑噪域属性', chart); } catch (error) { this.report(error as Error); }
    finally { this.formCommitting = false; }
    this.render(); this.invalidate();
  }
  select(index: number, event: { type: string; index: number } | null = null, extend = false): void {
    this.flush(); this.selected = index; this.event = event; this.pending = null;
    const key = event ? event.type + ':' + event.index : 'area:' + index;
    if (extend && [...this.selection].some(entry => entry.startsWith('area:') === Boolean(event))) this.selection.clear();
    if (!extend) this.selection.clear();
    if (extend && this.selection.has(key)) this.selection.delete(key); else this.selection.add(key);
    this.activate('noise-properties'); this.render(); this.invalidate();
  }
  add(start: number, end: number, horizontal: number): void {
    const areas = [...this.areas(), { ...createNoiseArea(start, end), layerId: noiseLayers(this.chart)[0].id, editorPositionX: this.editorX(horizontal) }]; const index = areas.length - 1;
    if (this.commitAreas('添加噪域', areas)) this.select(index);
  }
  addEvent(type: string, start: number, end: number, hooked = false): void {
    const area = this.area(); if (!area) { this.notify('先在左侧选择一个噪域', 'warning'); return; }
    const sample = noiseRuntime(area, this.context.tempo).sample(this.context.tempo.seconds(start));
    const values = sample.values as Record<string, { value: number; event?: NoiseEvent }>;
    const value = values[type]?.value ?? 0;
    const event: NoiseInterval | NoiseEvent = type === 'activeIntervals' ? { startTime: fromNumber(start), endTime: fromNumber(end), readyFlash: 0.5 } : { ...createNoiseEvent(value, value, start, end, noiseHasAnchor(type) ? values[type]?.event?.anchor ?? noiseCenter(area) : undefined), inst: hooked ? 1 : 0 };
    const events = [...((area[type] as (NoiseEvent | NoiseInterval)[] | undefined) ?? []), event]; const areas = this.areas().map((entry, index) => index === this.selected ? { ...entry, [type]: events } : entry);
    if (this.commitAreas('放置噪域' + NOISE_TRACKS.find(track => track[0] === type)![1], areas)) this.select(this.selected, { type, index: events.length - 1 });
  }
  remove(): void {
    const keys = this.selection;
    if (!keys.size) return;
    let areas = this.areas();
    if ([...keys].some(key => key.startsWith('area:'))) { areas = areas.filter((area, index) => !keys.has('area:' + index)); this.selected = -1; }
    else if (this.area()) areas = areas.map((area, index) => index === this.selected ? { ...area, ...Object.fromEntries(NOISE_TRACKS.map(([type]) => [type, (((area[type] as NoiseEvent[] | undefined) ?? []).filter((event, eventIndex) => !keys.has(type + ':' + eventIndex)))])) } : area);
    this.selection.clear(); this.event = null; this.commitAreas('删除噪域对象', areas);
    if (this.selected === -1) this.activate('noise');
  }
  copy(cut = false): void {
    const entries: NoiseClipboardEntry[] = []; const area = this.area();
    for (const key of this.selection) {
      const [type, index] = key.split(':'); const source = type === 'area' ? this.areas()[Number(index)] : (area?.[type] as NoiseEvent[] | undefined)?.[Number(index)];
      if (source) entries.push({ type, value: type === 'area' ? { ...structuredClone(source as NoiseArea), editorPositionX: this.editorX(this.areaX(source as NoiseArea, Number(index))) } : structuredClone(source) });
    }
    if (!entries.length) return;
    this.clipboard = { entries, start: Math.min(...entries.map(entry => beatValue(entry.value[entry.type === 'area' ? 'appearTime' : 'startTime']))) };
    if (cut) this.remove();
    this.notify(cut ? '已剪切噪域对象' : '已复制噪域对象', 'success'); this.invalidate();
  }
  pastedAreas(at: number, keepTime = false): NoiseArea[] {
    const areas = [...this.areas()]; const clipboard = this.clipboard as NonNullable<NoiseAreaEditor['clipboard']>; const delta = keepTime ? 0 : at - clipboard.start;
    const firstArea = clipboard.entries.find(entry => entry.type === 'area');
    const deltaX = firstArea && this.cursor?.side === 'areas' ? this.editorX(this.cursor.x) - ((firstArea.value as NoiseArea).editorPositionX ?? 0) : 0;
    for (const entry of clipboard.entries) {
      if (entry.type === 'area') {
        const value = entry.value as NoiseArea;
        // A paste into a chart whose layers changed keeps the source layer when it still exists and
        // otherwise falls back to the first layer, so the pasted area never names a missing layer.
        const sourceLayer = noiseLayerId(value); const layers = noiseLayers(this.chart);
        areas.push({ ...shiftNoiseArea(value, delta), layerId: layers.some((layer: NoiseLayer) => layer.id === sourceLayer) ? sourceLayer : layers[0].id, editorPositionX: Math.max(-675, Math.min(675, (value.editorPositionX ?? 0) + deltaX)) });
      }
      else {
        if (!areas[this.selected]) throw new Error('请先选择接收事件的噪域');
        const area = areas[this.selected]; const source = entry.value as NoiseEvent; const value = { ...structuredClone(source), startTime: fromNumber(beatValue(source.startTime) + delta), endTime: fromNumber(beatValue(source.endTime) + delta) };
        areas[this.selected] = { ...area, [entry.type]: [...((area[entry.type] as NoiseEvent[] | undefined) ?? []), value] };
      }
    }
    return areas;
  }
  action(action: string): boolean {
    if (!this.active) return false;
    if (action === 'Esc') {
      if (this.sampleMode) this.endSample(false);
      else { this.cancelGesture(); this.selection.clear(); this.event = null; this.pending = null; this.clipboard = null; this.activate('noise'); this.render(); }
    } else if (this.sampleMode) return ['Copy', 'Shear', 'Paste', 'Delete', 'QuickDelete', 'AddTap', 'AddEvent'].includes(action);
    else if (action === 'Copy' || action === 'Shear') this.copy(action === 'Shear');
    else if (['Delete', 'QuickDelete'].includes(action)) this.remove();
    else if (['Paste', 'KeepTimePaste', 'PasteMirror', 'KeepTimePasteMirror'].includes(action)) {
      if (this.clipboard) {
        try { this.commitAreas('粘贴噪域对象', this.pastedAreas(this.cursor?.beat ?? this.context.timeline.origin, action.startsWith('KeepTime'))); } catch (error) { this.report(error as Error); }
      }
    } else if (action === 'SelectAll') {
      this.selection = new Set(this.cursor?.side === 'events' && this.area() ? NOISE_TRACKS.flatMap(([type]) => (((this.area() as NoiseArea)[type] as NoiseEvent[] | undefined) ?? []).map((entry, index) => type + ':' + index)) : this.areas().map((area, index) => 'area:' + index)); this.render();
    } else if (['AddTap', 'AddHold', 'AddEvent'].includes(action)) this.place(action === 'AddTap');
    else if (action === 'NumberMirror') {
      const target = this.event;
      if (this.selection.size === 1 && target && ['moveXEvents', 'moveYEvents', 'rotateEvents'].includes(target.type)) {
        this.edit(area => {
          const event = (area[target.type] as NoiseEvent[] | undefined)?.[target.index]; if (!event) return area;
          event.start = -event.start; event.end = -event.end;
          return area;
        });
      }
    } else if (action === 'PageUp' || action === 'PageDown') {
      const delta = (action === 'PageUp' ? 1 : -1) / Math.max(1, this.context.timeline.division);
      const selected = [...this.selection].filter(key => !key.startsWith('area:'));
      if (selected.length) this.edit(area => {
        for (const key of selected) {
          const [type, rawIndex] = key.split(':'); const index = Number(rawIndex);
          const event = (area as unknown as Record<string, NoiseEvent[] | undefined>)[type]?.[index];
          if (!event) continue;
          event.startTime = fromNumber(beatValue(event.startTime) + delta);
          event.endTime = fromNumber(beatValue(event.endTime) + delta);
        }
        return area;
      });
    } else if (['SwitchLock', 'StickNext'].includes(action)) return true;
    else if (['SwitchUI', 'ToggleMultiLine', 'SwitchMultiLineMode', 'NumberFill', 'AddDrag', 'AddFlick', 'CurveBegin', 'CurveEnd'].includes(action) || action === 'PageLeft' || action === 'PageRight') return true;
    else return false;
    this.invalidate(); return true;
  }
  layout(): { width: number; height: number; split: number; eventLeft: number; eventWidth: number } {
    if (this.drawingLayout) return this.drawingLayout;
    const { width, height } = this.canvas.getBoundingClientRect(); const split = Math.round(width * 0.43);
    return { width, height, split, eventLeft: split + 30, eventWidth: Math.max(1, (width - split - 40) / NOISE_TRACKS.length) };
  }
  eventBounds(type: string): { x: number; width: number } {
    const { eventLeft, eventWidth } = this.layout(); const column = NOISE_TRACKS.findIndex(track => track[0] === type);
    const width = Math.max(1, eventWidth - Math.max(16, eventWidth * 0.22));
    return { x: eventLeft + (column + 0.5) * eventWidth - width / 2, width };
  }
  editorX(horizontal: number): number { return Math.max(-675, Math.min(675, ((horizontal - AREA_BAR_WIDTH / 2) / Math.max(1, this.layout().split - AREA_BAR_WIDTH) - 0.5) * 1350)); }
  areaX(area: NoiseArea, index: number): number { const position = Number.isFinite(area.editorPositionX) ? area.editorPositionX as number : -540 + index % 6 * 216; return AREA_BAR_WIDTH / 2 + (position / 1350 + 0.5) * Math.max(1, this.layout().split - AREA_BAR_WIDTH); }
  hit(point: NonNullable<NoiseAreaEditor['cursor']>): NoiseRect | undefined {
    // `findLast` is ES2023; the intersection view above declares it without widening `lib`.
    const rects = this.rects as NoiseRect[] & LastSearch<NoiseRect>;
    return rects.findLast(rect => Boolean(rect.type) === (point.side === 'events') && point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= Math.max(HEADER_HEIGHT, rect.y - 5) && point.y <= rect.y + rect.height + 5);
  }
  hitKind(rect: NoiseRect, point: Point): 'start' | 'end' | 'move' { return Math.abs(point.y - rect.head) <= 7 ? 'start' : Math.abs(point.y - rect.tail) <= 7 ? 'end' : 'move'; }
  syncHover(): void { const cursor = this.cursor; const hit = cursor && this.hit(cursor); this.hover = hit && cursor ? { ...hit, kind: this.hitKind(hit, cursor) } : null; this.canvas.style.cursor = this.drag && ['move', 'start', 'end'].includes(this.drag.kind) ? this.drag.kind === 'move' ? 'grabbing' : 'ns-resize' : this.hover ? this.hover.kind === 'move' ? 'grab' : 'ns-resize' : 'default'; }
  y(beat: number): number { const { timeline, tempo } = this.context; return this.layout().height - timeline.judgementOffset - (tempo.seconds(beat) - tempo.seconds(timeline.origin)) * timeline.scale; }
  beatAt(vertical: number, snap = true): number {
    const { timeline, tempo } = this.context;
    const value = tempo.beat(tempo.seconds(timeline.origin) + (this.layout().height - timeline.judgementOffset - vertical) / timeline.scale);
    return snap ? Math.round(value * timeline.division) / timeline.division : value;
  }
  point(event: { clientX: number; clientY: number }): NonNullable<NoiseAreaEditor['cursor']> {
    const rect = this.canvas.getBoundingClientRect(); const x = event.clientX - rect.left; const y = event.clientY - rect.top; const layout = this.layout();
    const side = x < layout.split ? 'areas' : 'events'; const column = Math.max(0, Math.min(5, Math.floor((x - layout.eventLeft) / layout.eventWidth)));
    return { x, y, side, type: NOISE_TRACKS[column][0], beat: this.beatAt(y), rawBeat: this.beatAt(y, false) };
  }
  place(hooked = false): void {
    if (!this.cursor || this.cursor.y < HEADER_HEIGHT) return;
    if (!this.pending) this.pending = { ...this.cursor, hooked };
    else {
      const start = Math.min(this.pending.beat, this.cursor.beat); const end = Math.max(this.pending.beat, this.cursor.beat);
      if (this.pending.side === 'areas') this.add(start, end, this.pending.x);
      else this.addEvent(this.pending.type, start, end, this.pending.hooked);
      this.pending = null;
    }
    this.invalidate();
  }
  down(event: PointerEvent): void {
    if (event.button !== 0 && event.button !== 1) return;
    if (this.point(event).y < HEADER_HEIGHT) return;
    event.preventDefault(); event.stopPropagation(); this.flush(); this.pause(); this.cursor = this.point(event); this.canvas.focus();
    if (this.drag?.kind === 'rectangle') { this.up(event, true); return; }
    this.canvas.setPointerCapture(event.pointerId);
    const hit = this.hit(this.cursor);
    if (hit && !event.shiftKey && event.button !== 1) {
      const key = hit.type ? hit.type + ':' + hit.index : 'area:' + hit.index;
      if (!this.selection.has(key) || event.ctrlKey) this.select(hit.type ? this.selected : hit.index, hit.type ? { type: hit.type, index: hit.index } : null, event.ctrlKey);
      else { if (!hit.type) this.selected = hit.index; this.event = hit.type ? { type: hit.type, index: hit.index } : null; this.activate('noise-properties'); this.render(); }
      const kind = this.hitKind(hit, this.cursor);
      this.drag = { kind, start: this.cursor, hit, base: this.context.session.chart, keys: new Set(this.selection), moved: false };
    } else if (event.shiftKey || event.button === 1) {
      this.pending = null; this.drag = { kind: 'rectangle', start: this.cursor, current: this.cursor, baseSelection: new Set(this.selection), moved: false };
    } else {
      if (!event.ctrlKey) this.selection.clear();
      this.event = null; this.pending = null;
      this.drag = { kind: 'stroke', start: this.cursor, current: this.cursor, points: [this.cursor], moved: false };
      this.render();
    }
    this.syncHover(); this.invalidate();
  }
  move(event: PointerEvent): void {
    this.cursor = this.point(event);
    this.updateDrag();
  }
  updateDrag(): void {
    this.syncHover();
    const drag = this.drag; const cursor = this.cursor;
    if (!drag || !cursor) { this.invalidate(); return; }
    const previous = drag.current ?? drag.start; drag.current = cursor;
    drag.moved ||= Math.hypot(cursor.x - drag.start.x, cursor.y - drag.start.y) > 4;
    if (drag.kind === 'stroke' && drag.moved) {
      (drag.points as Point[]).push(cursor);
      for (const rect of this.rects) if (Boolean(rect.type) === (drag.start.side === 'events') && strokeIntersects({ x: previous.x, y: this.y(previous.rawBeat) }, cursor, { left: rect.x, right: rect.x + rect.width, top: rect.y, bottom: rect.y + rect.height })) {
        if ([...this.selection].some(key => key.startsWith('area:') !== !rect.type)) this.selection.clear();
        this.selection.add(rect.type ? rect.type + ':' + rect.index : 'area:' + rect.index);
      }
    }
    if (drag.kind === 'rectangle' || drag.kind === 'stroke' || !drag.moved) { this.invalidate(); return; }
    const delta = cursor.beat - drag.start.beat; const base = drag.base as Chart; const areas = structuredClone((base.blockAreaList as NoiseArea[] | undefined) ?? []);
    for (const key of drag.keys as Set<string>) {
      const [type, rawIndex] = key.split(':'); const index = Number(rawIndex);
      const entry = type === 'area' ? areas[index] : (areas[this.selected]?.[type] as NoiseEvent[] | undefined)?.[index]; if (!entry) continue;
      const startKey = type === 'area' ? 'appearTime' : 'startTime'; const endKey = type === 'area' ? 'disappearTime' : 'endTime';
      if (drag.kind === 'move') {
        if (type === 'area') areas[index] = { ...shiftNoiseArea(entry as NoiseArea, delta), editorPositionX: this.editorX(this.areaX(entry as NoiseArea, index) + cursor.x - drag.start.x) };
        else { (entry as unknown as Record<string, Beat>)[startKey] = fromNumber(beatValue((entry as unknown as Record<string, Beat>)[startKey]) + delta); (entry as unknown as Record<string, Beat>)[endKey] = fromNumber(beatValue((entry as unknown as Record<string, Beat>)[endKey]) + delta); }
      } else if (key === ((drag.hit as NoiseRect).type ? (drag.hit as NoiseRect).type + ':' + (drag.hit as NoiseRect).index : 'area:' + (drag.hit as NoiseRect).index)) {
        const name = drag.kind === 'start' ? startKey : endKey;
        (entry as unknown as Record<string, Beat>)[name] = fromNumber(drag.kind === 'start' ? Math.min(cursor.beat, beatValue((entry as unknown as Record<string, Beat>)[endKey])) : Math.max(cursor.beat, beatValue((entry as unknown as Record<string, Beat>)[startKey])));
      }
    }
    try { this.draftChart = withNoiseAreas(base, areas); this.dragError = null; } catch (error) { this.dragError = error as Error; }
    this.invalidate();
  }
  up(event: PointerEvent, finish = false): void {
    const drag = this.drag; if (!drag) return;
    this.cursor = this.point(event); this.updateDrag();
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
    if (drag.kind === 'rectangle' && !drag.moved && !finish) return;
    this.drag = null;
    if (drag.kind === 'rectangle' || drag.kind === 'stroke') {
      if (drag.kind === 'rectangle') {
      const current = drag.current as NonNullable<NoiseAreaEditor['cursor']>;
      const left = Math.min(drag.start.x, current.x); const right = Math.max(drag.start.x, current.x);
      const start = Math.min(drag.start.rawBeat, current.rawBeat); const end = Math.max(drag.start.rawBeat, current.rawBeat);
      this.selection = new Set([...(drag.baseSelection as Set<string>)].filter(key => key.startsWith('area:') === (drag.start.side === 'areas')));
      // The bounds are rebuilt here rather than read from the rects `drawTimeline` collected, so a
      // marquee still sees every entry, including the ones scrolled out of view.
      for (const rect of this.selectionRects(drag.start.side)) if (rect.x <= right && rect.x + rect.width >= left && rect.start <= end && rect.end >= start) this.selection.add(rect.type ? rect.type + ':' + rect.index : 'area:' + rect.index);
      }
      const first = [...this.selection][0]?.split(':');
      if (first) { if (first[0] === 'area') { this.selected = Number(first[1]); this.event = null; } else this.event = { type: first[0], index: Number(first[1]) }; this.activate('noise-properties'); }
      this.render();
    } else if (this.dragError) { this.report(this.dragError); this.draftChart = null; this.dragError = null; }
    else if (this.draftChart) this.flush();
    this.syncHover(); this.invalidate();
  }
  cancelGesture(): void { this.drag = null; this.pending = null; this.draftChart = null; this.dragError = null; this.invalidate(); }
  autoScroll(elapsed: number): void {
    if (!this.active || !this.drag || !this.cursor || this.sampleMode) return;
    const { height } = this.layout(); const edge = this.cursor.y < 30 ? 1 : this.cursor.y > height - 20 ? -1 : 0;
    if (edge) { const { tempo, timeline } = this.context; const beat = tempo.beat(tempo.seconds(timeline.origin) + edge * elapsed); this.seek(beat); timeline.origin = beat; this.cursor = { ...this.cursor, beat: this.beatAt(this.cursor.y), rawBeat: this.beatAt(this.cursor.y, false) }; this.updateDrag(); }
  }
  render(): void {
    this.syncChrome(); if (!this.active || this.formCommitting) return;
    if (!this.area()) { const first = [...this.selection].find(key => key.startsWith('area:') && this.areas()[Number(key.split(':')[1])]); this.selected = first ? Number(first.split(':')[1]) : -1; this.event = null; if (!first) this.selection.clear(); }
    if (this.event && !(this.area()?.[this.event.type] as NoiseEvent[] | undefined)?.[this.event.index]) this.event = null;
    if (!this.listTitle) {
      this.host.replaceChildren();
      this.listTitle = document.createElement('div'); this.listTitle.className = 'panel-title'; this.host.append(this.listTitle);
      this.host.append(this.layerPanel.element);
      const actions = document.createElement('div'); actions.className = 'noise-actions';
      actions.append(button('关闭编辑', '返回音符与事件编辑区', () => this.close())); this.host.append(actions);
      this.host.append(hint('Q / R 两次定位放置。拖动首尾调整时间，拖动身体整体移动；左侧窄条可自由横向排布。Shift / 中键框选，空白处按住左键划线多选；Ctrl+C/X/V 复制、剪切、粘贴。'));
      this.host.append(this.areaList.element);
    }
    this.layerPanel.render();
    const listTitle = '噪域 · ' + this.areas().length;
    if (this.listTitle.textContent !== listTitle) this.listTitle.textContent = listTitle;
    this.areaList.update(this.areas(), this.selected);
    const signature = `${this.selected}/${this.event?.type}/${this.event?.index}`;
    const activeElement = document.activeElement as HTMLElement | null;
    const focused = activeElement && this.properties.contains(activeElement) && activeElement.matches('input,select') ? activeElement : null;
    if (focused && signature === this.formSignature) {
      const snapshot = document.createElement('div'); this.renderProperties(snapshot);
      // The controls are a union of `<input>` and `<select>`; `checked` exists only on the former, and
      // both sides of this pair carry the same tag because they are matched by `aria-label`.
      for (const control of snapshot.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input,select')) { const existing = [...this.properties.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input,select')].find(input => input.getAttribute('aria-label') === control.getAttribute('aria-label')); if (existing && existing !== focused) { existing.value = control.value; if (existing instanceof HTMLInputElement && control instanceof HTMLInputElement) existing.checked = control.checked; } }
      return;
    }
    this.formSignature = signature;
    const scrollTop = (this.host.closest('.inspector') as HTMLElement).scrollTop;
    this.renderProperties(); (this.host.closest('.inspector') as HTMLElement).scrollTop = scrollTop;
  }
  field(host: HTMLElement, labelText: string, value: unknown, apply: (area: NoiseArea, value: never) => NoiseArea, { kind = 'number', step = 1, sample, choices, clear = false }: FieldOptions = {}): HTMLInputElement | HTMLSelectElement {
    const label = document.createElement('label'); label.className = 'noise-field'; label.append(labelText);
    const controls = document.createElement('span'); controls.className = 'noise-input-controls';
    const input = document.createElement(choices ? 'select' : 'input') as HTMLInputElement | HTMLSelectElement; input.setAttribute('aria-label', labelText);
    // The union hides the `<input>`-only members below (`step`, and the typed `wheel` overload).
    // `choices` decides the tag, but the members used here are shared or harmless on a `<select>`.
    const control = input as HTMLInputElement;
    if (choices) input.replaceChildren(...choices.map(([value, name]) => new Option(name, String(value))));
    else control.type = kind === 'beat' ? 'text' : kind;
    if (!choices && ['duration', 'beat'].includes(kind)) control.dataset.numericExpression = kind === 'beat' ? 'beat' : 'number';
    if (kind === 'checkbox') control.checked = Boolean(value); else input.value = kind === 'beat' ? formatBeat(value as Beat) : kind === 'duration' ? durationText(value) : kind === 'number' && !choices ? String(round(value as number)) : String(value);
    control.step = kind === 'number' ? 'any' : String(step);
    const movementExpression = sample?.type === 'moveYEvents' && ['start', 'end'].includes(sample.field);
    const evaluateMovement = (source: string): number => evaluateEventNumber(source, { type: sample!.type, field: sample!.field, event: (this.area() as unknown as Record<string, NoiseEvent[]>)[sample!.type]![sample!.index]!, tempo: this.context.tempo as unknown as TempoMap });
    if (movementExpression) { setNumericExpressionResolver(control, evaluateMovement); control.title = '支持表达式；nv 由另一端数值与时长计算速度为 n 时的位移'; }
    const read = (): never => (kind === 'checkbox' ? control.checked : kind === 'beat' ? parseBeat(input.value) : kind === 'text' ? input.value : movementExpression && String(numericExpressionSource(control)).trim().endsWith('v') ? evaluateMovement(numericExpressionSource(control)) : (input.value.trim() ? Number(input.value) : NaN)) as never;
    // Named so the change handler can re-run it; calling `control.oninput()` would need a synthetic
    // event argument that the assigned handler ignores anyway.
    const applyInput = (): void => { try { const valid = this.edit(area => apply(area, read()), false); input.setCustomValidity(valid ? '' : '数值无效或事件重叠'); } catch (error) { input.setCustomValidity((error as Error).message); } };
    control.oninput = applyInput;
    control.onchange = () => { applyInput(); if (control.checkValidity()) this.flush(); else this.notify(control.validationMessage, 'error'); };
    if (kind === 'number' || kind === 'duration' || kind === 'beat') {
      control.addEventListener('wheel', (event: WheelEvent) => { event.preventDefault(); event.stopPropagation(); try { const increment = kind === 'beat' ? 1 / this.context.timeline.division : kind === 'duration' ? 0.001 : step; const current = kind === 'beat' ? beatValue(read() as Beat) : Number(input.value); const next = current + (event.deltaY < 0 ? increment : -increment); input.value = kind === 'beat' ? formatBeat(fromNumber(next)) : kind === 'duration' ? durationText(next) : String(round(next)); control.onchange?.(new Event('change')); } catch (error) { this.report(error as Error); } }, { passive: false });
    }
    controls.append(input);
    if (sample) controls.append(button('⌖', '在预览中拖动取样：' + labelText, () => this.beginSample(sample)));
    if (clear) controls.append(button('×', '关闭预备闪烁', () => { input.value = '0'; input.onchange?.(new Event('change')); }));
    if (kind === 'beat') { const nudges = document.createElement('span'); nudges.className = 'noise-beat-nudges'; for (const [text, direction] of [['▴', 1], ['▾', -1]] as [string, number][]) nudges.append(button(text, '调整一横线', () => { try { input.value = formatBeat(fromNumber(beatValue(read() as Beat) + direction / this.context.timeline.division)); input.onchange?.(new Event('change')); } catch (error) { this.report(error as Error); } })); controls.append(nudges); }
    label.append(controls); host.append(label); return input;
  }
  renderProperties(host: HTMLElement = this.properties): void {
    host.replaceChildren();
    host.append(button('← 噪域列表', '返回噪域管理', () => this.activate('noise')));
    const area = this.area(); if (!area) { host.append(hint('请在左侧选择噪域。')); return; }
    const title = document.createElement('h3'); title.textContent = this.event ? NOISE_TRACKS.find(track => track[0] === this.event!.type)![1] + ' · 噪域 ' + this.selected : '噪域 ' + this.selected; host.append(title);
    // `noiseLayerId` supplies the default layer's id when the area predates layers, and the choices
    // are the current chart's layers, so the select always shows a value it can also write back.
    // `noise-skin.ts` returns a parsed definition, so the callback's parameter is annotated here.
    this.field(host, '所属噪域层', noiseLayerId(area), (item, value) => ({ ...item, layerId: value as unknown as string }), { kind: 'text', choices: noiseLayers(this.chart).map((layer: NoiseLayer) => [layer.id, layer.name] as [string, string]) });
    const target = this.event;
    const modifyEvent = (change: (event: Record<string, unknown>) => void) => (item: NoiseArea): NoiseArea => { const event = (item[target!.type] as unknown as Record<string, unknown>[])[target!.index]; change(event); return item; };
    if (target) {
      const { type, index } = target; const event = (area[type] as unknown as Record<string, unknown>[])[index];
      for (const [field, label] of [['startTime', '开始拍'], ['endTime', '结束拍']] as [string, string][]) this.field(host, label, event[field], (item, value) => modifyEvent(entry => { entry[field] = value; })(item), { kind: 'beat' });
      if (type === 'activeIntervals') this.field(host, '预备闪烁时长（秒）', readyFlashValue(event.readyFlash), (item, value) => modifyEvent(entry => { entry.readyFlash = Math.max(0, Math.round((value as unknown as number) * 1000) / 1000); })(item), { kind: 'duration', clear: true });
      else {
        for (const [field, label] of [['start', '首值'], ['end', '尾值']] as [string, string][]) this.field(host, label, event[field], (item, value) => modifyEvent(entry => { entry[field] = value; if (entry.inst) entry[field === 'start' ? 'end' : 'start'] = value; })(item), { step: type.startsWith('scale') ? 0.1 : 1, sample: { type, index, field } });
        if (noiseHasAnchor(type)) for (const axis of ['x', 'y']) this.field(host, '锚点 ' + axis.toUpperCase(), (event.anchor as Point)[axis as 'x' | 'y'], (item, value) => modifyEvent(entry => { (entry.anchor as Point)[axis as 'x' | 'y'] = value as unknown as number; })(item), { sample: { type, index, field: 'anchor' } });
        this.field(host, '钩定（首尾同步）', event.inst, (item, value) => modifyEvent(entry => { entry.inst = value ? 1 : 0; if (value) entry.end = entry.start; })(item), { kind: 'checkbox' });
        this.field(host, '绑定组', event.linkgroup ?? 0, (item, value) => modifyEvent(entry => { entry.linkgroup = Math.max(0, Math.round(value as unknown as number)); })(item));
        if ((event.linkgroup as number) > 0) host.append(button('选中绑定组 ' + event.linkgroup, '选中本噪域中同组的变换事件', () => { this.selection = new Set(NOISE_TRACKS.slice(1).flatMap(([track]) => (((this.area() as NoiseArea)[track] as NoiseEvent[] | undefined) ?? []).flatMap((entry, position) => entry.linkgroup === event.linkgroup ? [track + ':' + position] : []))); this.render(); this.invalidate(); }));
        this.field(host, '缓动', event.easingType ?? 1, (item, value) => modifyEvent(entry => { entry.easingType = value; })(item), { choices: EASING_NAMES.map((name, position) => [position + 1, (position + 1) + ' · ' + name]) });
        host.append(createEasingPicker((event.easingType as number) ?? 1, value => this.edit(modifyEvent(entry => { entry.easingType = value; })), this.easingState).element);
        for (const [field, label] of [['easingLeft', '缓动左边界'], ['easingRight', '缓动右边界']] as [string, string][]) this.field(host, label, event[field] ?? (field === 'easingLeft' ? 0 : 1), (item, value) => modifyEvent(entry => { entry[field] = value; })(item), { step: 0.05 });
        this.field(host, 'Bezier', event.bezier, (item, value) => modifyEvent(entry => { entry.bezier = value ? 1 : 0; })(item), { kind: 'checkbox' });
        for (const [position, label] of ['控制点 1 X', '控制点 1 Y', '控制点 2 X', '控制点 2 Y'].entries()) this.field(host, label, ((event.bezierPoints as number[] | undefined) ?? [0, 0, 1, 1])[position], (item, value) => modifyEvent(entry => { entry.bezierPoints ??= [0, 0, 1, 1]; (entry.bezierPoints as number[])[position] = value as unknown as number; })(item), { step: 0.05 });
      }
      host.append(button('噪域基础属性', '查看初始矩形与生命周期', () => this.select(this.selected)));
    } else {
      this.field(host, '名称', area.Name ?? '', (item, value) => ({ ...item, Name: value as unknown as string }), { kind: 'text' });
      for (const [field, label] of [['appearTime', '出现拍'], ['disappearTime', '消失拍']] as [string, string][]) this.field(host, label, (area as unknown as Record<string, unknown>)[field], (item, value) => ({ ...item, [field]: value }), { kind: 'beat' });
      // A corner handle names its own corner as the field; it belongs to no event track, so `type` is
      // the empty string — the falsy value every `target.type ? …` branch already treats as "none".
      for (const [field, label] of [['bottomLeft', '左下'], ['topRight', '右上']] as [string, string][]) for (const axis of ['x', 'y'] as const) this.field(host, label + ' ' + axis.toUpperCase(), (area[field as 'bottomLeft' | 'topRight'])[axis], (item, value) => ({ ...item, [field]: { ...(item[field as 'bottomLeft' | 'topRight']), [axis]: value as unknown as number } }), { sample: { type: '', index: 0, field } });
      this.field(host, '反转覆盖', area.isInvert, (item, value) => ({ ...item, isInvert: value as unknown as boolean }), { kind: 'checkbox' });
      host.append(hint('调整生命周期首尾不会缩放或裁剪内部事件。整体移动会平移所有内部时间；所有内部时间仍为全谱绝对拍数。'));
    }
    host.append(button('删除选中对象', '删除，可撤销', () => this.remove()));
  }
  beginSample(target: NoiseTarget): void {
    this.flush(); this.pause(); const area = this.area(); if (!area) return;
    this.sampleMode = { ...samplingTarget(area, target.type, target.index, target.field), base: this.sampleMode?.base ?? this.context.session.chart };
    this.sampleSeconds = target.type ? this.context.tempo.seconds((area[target.type] as unknown as Record<string, Beat>[])[target.index][target.field === 'end' ? 'endTime' : 'startTime']) : this.context.tempo.seconds(this.context.timeline.origin);
    this.sampleZoom ??= [this.context.preview, this.context.realtimePreview].map(renderer => ({ renderer, original: renderer.viewDivisor ?? 1, divisor: renderer.viewDivisor ?? 1 }));
    this.sampleDrag = null; this.render(); this.invalidate();
  }
  endSample(apply: boolean): void {
    if (!this.sampleMode) return;
    for (const { renderer, original } of this.sampleZoom ?? []) renderer.viewDivisor = original;
    this.sampleZoom = null;
    const chart = this.draftChart; this.sampleMode = null; this.sampleDrag = null; this.draftChart = null; this.syncChrome();
    if (apply && chart) { try { this.commit('预览拖动取样', chart); } catch (error) { this.report(error as Error); } }
    this.render(); this.invalidate();
  }
  fitSampleView(): void {
    const previousView = this.sampleView();
    const rect = this.overlay.getBoundingClientRect(); const controlsBottom = this.sampleBar.getBoundingClientRect().bottom - rect.top;
    const handle = noiseSampleHandle(this.area() as NoiseArea, this.context.tempo, this.sampleSeconds, this.sampleMode as NoiseTarget);
    for (const zoom of this.sampleZoom ?? []) {
      if (this.context.sampleAutoFit !== false) zoom.divisor = fitNoiseSampleView(handle, rect.width, rect.height, zoom.renderer.aspectRatio ?? 1.5, zoom.divisor, controlsBottom);
      zoom.renderer.viewDivisor = this.context.sampleAutoFit === false ? zoom.original : zoom.divisor;
    }
    const view = this.sampleView();
    if (this.sampleDrag && view.scale !== previousView.scale) {
      const position = view.screen(handle); const pointer = this.sampleDrag.pointer;
      this.sampleDrag.offset = { x: pointer.x - view.left - position.x, y: pointer.y - view.top - position.y };
    }
  }
  sampleView(): SampleView {
    const rect = this.overlay.getBoundingClientRect(); const renderer = this.context.previewVisible ? this.context.preview : this.context.realtimePreview;
    const viewport = previewViewport(rect.width, rect.height, renderer.aspectRatio ?? 1.5); const scale = viewport.scale / (renderer.viewDivisor ?? 1);
    const bounds = rect.toJSON() as unknown as { width: number; height: number; left: number; top: number; [key: string]: unknown };
    return { ...bounds, viewport, scale, world: (point: Point) => ({ x: (point.x - rect.width / 2) / scale, y: (rect.height / 2 - point.y) / scale }), screen: (point: Point) => ({ x: rect.width / 2 + point.x * scale, y: rect.height / 2 - point.y * scale }) };
  }
  sampleDown(event: PointerEvent): void {
    if (!this.sampleMode || event.button !== 0) return; event.preventDefault(); event.stopPropagation();
    const view = this.sampleView(); const point = { x: event.clientX - view.left, y: event.clientY - view.top }; const handle = view.screen(noiseSampleHandle(this.area() as NoiseArea, this.context.tempo, this.sampleSeconds, this.sampleMode));
    if (Math.hypot(point.x - handle.x, point.y - handle.y) > 26) return;
    this.overlay.setPointerCapture(event.pointerId); this.sampleDrag = { pointer: { x: event.clientX, y: event.clientY }, offset: { x: point.x - handle.x, y: point.y - handle.y } };
  }
  sampleMove(event: PointerEvent): void {
    const drag = this.sampleDrag;
    if (!drag) return;
    drag.pointer = { x: event.clientX, y: event.clientY };
    const view = this.sampleView(); const point = view.world({ x: event.clientX - view.left - drag.offset.x, y: event.clientY - view.top - drag.offset.y });
    try { const area = applyNoiseSample(this.area() as NoiseArea, this.context.tempo, this.sampleSeconds, this.sampleMode as NoiseTarget, point); this.draftChart = this.replaceArea(area); this.fitSampleView(); this.invalidate(); } catch (error) { this.notify((error as Error).message, 'warning'); this.sampleDrag = null; }
  }
  previewState(): { chart: Chart; seconds?: number } {
    if (!this.sampleMode) return { chart: this.chart };
    this.fitSampleView();
    if (this.samplePreviewCache?.source === this.chart && this.samplePreviewCache.mode === this.sampleMode) return this.samplePreviewCache.result;
    const chart = this.chart; const area = this.area() as NoiseArea; const target = this.sampleMode;
    const beat = this.context.tempo.beat(this.sampleSeconds);
    const display = structuredClone(area);
    display.appearTime = fromNumber(beat - 2); display.disappearTime = fromNumber(beat + 2);
    if (target.type && ['start', 'end'].includes(target.field)) {
      const event = (display[target.type] as unknown as Record<string, Record<string, unknown>>[])[target.index];
      event.transformStart ??= event.start;
      event.transformEnd ??= event.end;
      event.start = event[target.field]; event.end = event[target.field];
    }
    const result = { chart: { ...chart, blockAreaList: (chart.blockAreaList as NoiseArea[]).map((entry, index) => index === this.selected ? display : entry) }, seconds: this.sampleSeconds };
    this.samplePreviewCache = { source: chart, mode: this.sampleMode, result }; return result;
  }
  drawSample(): void {
    if (!this.sampleMode) return;
    const { context, width, height } = prepareCanvas(this.overlay); const view = this.sampleView(); const area = this.area() as NoiseArea;
    const sample = sampleEditingArea(area, this.context.tempo, this.sampleSeconds, this.sampleMode); const points = sample.points.map(view.screen);
    context.strokeStyle = '#67efa4'; context.lineWidth = 2; context.beginPath(); points.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y)); context.closePath(); context.stroke();
    const anchor = this.sampleMode.type && noiseHasAnchor(this.sampleMode.type) ? ((area[this.sampleMode.type] as unknown as { anchor: Point }[])[this.sampleMode.index]).anchor : null;
    if (anchor) { const point = view.screen(anchor); context.strokeStyle = '#f0ca67'; context.beginPath(); context.moveTo(point.x - 9, point.y); context.lineTo(point.x + 9, point.y); context.moveTo(point.x, point.y - 9); context.lineTo(point.x, point.y + 9); context.stroke(); context.fillStyle = '#f0ca67'; context.fillText('锚点', point.x + 12, point.y); }
    const handle = view.screen(noiseSampleHandle(area, this.context.tempo, this.sampleSeconds, this.sampleMode)); context.fillStyle = '#5cffa1'; context.beginPath(); context.arc(handle.x, handle.y, 9, 0, Math.PI * 2); context.fill(); context.strokeStyle = '#152a1d'; context.stroke();
    context.fillStyle = '#c8ffdf'; context.font = '14px sans-serif'; context.fillText('拖动绿色控制点 · 当前取样拍 ' + round(this.context.tempo.beat(this.sampleSeconds)), 18, height - 20);
    if (handle.x < 0 || handle.x > width || handle.y < 0 || handle.y > height) context.fillText('控制点在视野外：增大工具栏“缩放”以扩大可见范围', 18, height - 42);
  }
  draw(): void {
    this.syncChrome(); if (!this.active || this.context.previewVisible || this.sampleMode) return;
    const { context, width, height } = prepareCanvas(this.canvas); const layout = this.layout();
    this.drawingLayout = layout;
    try { this.drawTimeline(context, width, height, layout); } finally { this.drawingLayout = null; }
  }
  drawTimeline(context: CanvasRenderingContext2D, width: number, height: number, layout: { width: number; height: number; split: number; eventLeft: number; eventWidth: number }): void {
    const { timeline } = this.context;
    const first = Math.floor(this.beatAt(height, false) * timeline.division); const last = Math.ceil(this.beatAt(HEADER_HEIGHT, false) * timeline.division);
    context.font = '12px sans-serif';
    for (let index = first; index <= last && index < first + 8000; index++) {
      const beat = index / timeline.division; const vertical = this.y(beat); const major = index % timeline.division === 0;
      context.strokeStyle = major ? '#8f909577' : '#75777c3d'; context.lineWidth = major ? 2 : 1; context.beginPath(); context.moveTo(0, vertical); context.lineTo(width, vertical); context.stroke();
      if (major) { context.fillStyle = '#d0d0d4'; context.fillText(String(beat), layout.split + 2, vertical - 3); }
    }
    context.lineWidth = 1;
    for (let index = 0; index <= timeline.gridCount; index++) { const horizontal = 12 + index * (layout.split - 24) / timeline.gridCount; context.strokeStyle = '#71767c35'; context.beginPath(); context.moveTo(horizontal, HEADER_HEIGHT); context.lineTo(horizontal, height); context.stroke(); }
    for (let index = 0; index <= 6; index++) { const horizontal = layout.eventLeft + index * layout.eventWidth; context.strokeStyle = '#7f838755'; context.beginPath(); context.moveTo(horizontal, HEADER_HEIGHT); context.lineTo(horizontal, height); context.stroke(); }
    this.rects = [];
    // `seamless`, `range` and `curveBatches` are only ever supplied together by `drawTrack`, which
    // has already resolved the chain an entry belongs to; the defaults keep the area-bar call simple.
    const drawEntry = (entry: Record<string, unknown>, index: number, type: string | null, x: number, entryWidth: number, ghost = false, seamless = false, range: EventChain | null = null, clipped = false, curveBatches: Map<EventChain, CurveSample[]> | null = null): void => {
      const start = beatValue(entry[type ? 'startTime' : 'appearTime'] as Beat); const end = beatValue(entry[type ? 'endTime' : 'disappearTime'] as Beat);
      const head = this.y(start); const tail = this.y(end); const top = Math.min(head, tail); const bottom = Math.max(head, tail); const entryHeight = Math.max(5, bottom - top);
      const rect: NoiseRect = { x, y: top, width: entryWidth, height: entryHeight, index, type, head, tail, start, end };
      if (bottom < HEADER_HEIGHT || top > height || x + entryWidth < (type ? layout.eventLeft : 0) || x > (type ? width : layout.split)) return;
      if (!ghost) this.rects.push(rect);
      const selected = this.selection.has(type ? type + ':' + index : 'area:' + index);
      // An inverted area is drawn violet rather than red so the covered region reads at a glance.
      const color = type ? selected ? '#6de9a4' : colors[NOISE_TRACKS.findIndex(track => track[0] === type)] : entry.isInvert ? selected ? '#d7b2ff' : '#aa8cdb' : selected ? '#6de9a4' : '#c97c7c';
      const hovered = !ghost && this.hover?.index === index && this.hover?.type === type;
      // A merged chain is drawn once as a whole by `drawEventChain`; its curves are collected here
      // and stroked in one batch after the loop, and a hovered entry opts back out so its own
      // handles and outline stay visible.
      if (seamless && !hovered && type !== 'activeIntervals') {
        if (curveBatches && range && timeline.drawEventCurves !== false && layout.eventWidth >= (timeline.eventCurveThreshold ?? 24)) {
          if (!curveBatches.has(range)) curveBatches.set(range, []);
          curveBatches.get(range)!.push({ event: entry, range, startY: head, endY: tail });
        }
        return;
      }
      if (!clipped) { context.save(); context.beginPath(); context.rect(type ? layout.eventLeft : 0, HEADER_HEIGHT, type ? width - layout.eventLeft : layout.split, height - HEADER_HEIGHT); context.clip(); }
      context.globalAlpha = ghost ? 0.4 : 1; context.fillStyle = color + (hovered && this.hover!.kind === 'move' ? '75' : '40'); context.strokeStyle = hovered ? '#fff1d2' : color; context.lineWidth = selected || hovered ? 2 : 1; if (ghost) context.setLineDash([4, 3]);
      if (!seamless || hovered) { context.fillRect(x, top, entryWidth, entryHeight); context.strokeRect(x, top, entryWidth, entryHeight); }
      if (!type && !ghost) this.drawDistribution(context, entry as unknown as NoiseArea, x, entryWidth, top, bottom);
      context.fillStyle = color; if (!seamless || hovered) { context.fillRect(x, head - 2, entryWidth, 4); context.fillRect(x, tail - 2, entryWidth, 4); }
      if (hovered && this.hover!.kind !== 'move') { context.fillStyle = '#fff1d2'; context.fillRect(x - 2, (this.hover!.kind === 'start' ? head : tail) - 4, entryWidth + 4, 8); }
      context.font = '12px sans-serif'; context.textAlign = 'center';
      if (!type) context.fillText(((entry.Name as string) || '噪域 ' + index) + (entry.isInvert ? ' ⊕' : ''), x + entryWidth / 2, Math.max(HEADER_HEIGHT + 16, Math.min(height - 12, top + 18)), Math.max(1, entryWidth - 4));
      else if (type === 'activeIntervals') context.fillText(readyFlashValue(entry.readyFlash) > 0 ? `预闪 ${durationText(readyFlashValue(entry.readyFlash))}s` : '无预闪', x + entryWidth / 2, Math.max(HEADER_HEIGHT + 16, top + 18), Math.max(1, entryWidth - 4));
      else if (timeline.drawEventCurves !== false && layout.eventWidth >= (timeline.eventCurveThreshold ?? 24)) {
        drawEventCurve(context, entry as unknown as ChartEvent, range, { x, y: Math.max(HEADER_HEIGHT, top), width: entryWidth, height: Math.max(2, Math.min(height, bottom) - Math.max(HEADER_HEIGHT, top)) }, head, tail);
      }
      if (!clipped) context.restore();
    };
    const drawTrack = (events: NoiseEvent[], type: string, ghost = false): void => {
      const bounds = this.eventBounds(type); const seamlessGroups = new Set<EventChain>();
      const curveBatches = new Map<EventChain, CurveSample[]>();
      const display = eventDisplayIndex(this, events, this.chart) as EventDisplay; const { ranges } = display;
      const entries = display.index.query(this.beatAt(height, false), this.beatAt(HEADER_HEIGHT, false)).sort((first, second) => first.index - second.index);
      // A chain only exists for an index the index answered, so the lookups below cannot miss.
      const groups = new Set(entries.map(entry => ranges.get(entry.index)).filter((group): group is EventChain => group !== undefined));
      const selectedGroups = ghost ? new Set<EventChain>() : selectedEventGroups(this.selection, type, ranges) as Set<EventChain>;
      for (const group of groups) {
        if (timeline.seamlessEvents === false) continue;
        if (group.entries.length < 2 || selectedGroups.has(group) || display.unmergeable.has(group)) continue;
        this.drawEventChain(context, group, type, bounds, height, ghost);
        seamlessGroups.add(group);
      }
      context.save(); context.beginPath(); context.rect(layout.eventLeft, HEADER_HEIGHT, width - layout.eventLeft, height - HEADER_HEIGHT); context.clip();
      for (const { item, index } of entries) { const range = ranges.get(index); drawEntry(item, ghost ? -1 : index, type, bounds.x, bounds.width, ghost, range !== undefined && seamlessGroups.has(range), range ?? null, true, curveBatches); }
      context.globalAlpha = ghost ? 0.4 : 1; context.strokeStyle = colors[NOISE_TRACKS.findIndex(track => track[0] === type)]; if (ghost) context.setLineDash([4, 3]);
      for (const [group, curves] of curveBatches) {
        // A batched chain always spans at least two entries, so both ends exist.
        const top = Math.max(HEADER_HEIGHT, this.y(beatValue(group.entries.at(-1)!.event.endTime)));
        const bottom = Math.min(height, this.y(beatValue(group.entries[0]!.event.startTime)));
        drawEventCurveBatch(context, curves as unknown as CurveBatchEntry[], { x: bounds.x, y: top, width: bounds.width, height: Math.max(2, bottom - top) });
      }
      context.restore();
      if (type !== 'activeIntervals') this.drawEventValues(context, events, type, bounds, height, ghost, groups);
    };
    this.areas().forEach((area, index) => drawEntry(area as unknown as Record<string, unknown>, index, null, this.areaX(area, index) - AREA_BAR_WIDTH / 2, AREA_BAR_WIDTH));
    for (const [type] of NOISE_TRACKS) drawTrack((this.area()?.[type] as NoiseEvent[] | undefined) ?? [], type);
    if (this.pending && this.cursor) {
      const start = this.pending; const current = this.cursor; const bounds = this.eventBounds(start.type); context.fillStyle = '#78d99b44'; const top = this.y(Math.max(start.beat, current.beat)); const bottom = this.y(Math.min(start.beat, current.beat)); context.fillRect(start.side === 'areas' ? this.areaX({ editorPositionX: this.editorX(start.x) } as NoiseArea, 0) - AREA_BAR_WIDTH / 2 : bounds.x, top, start.side === 'areas' ? AREA_BAR_WIDTH : bounds.width, Math.max(4, bottom - top));
    }
    if (this.clipboard && this.cursor && !this.drag && !this.pending) {
      const delta = this.cursor.beat - this.clipboard.start;
      const ghosts = this.clipboard.entries.some(entry => entry.type === 'area') ? this.pastedAreas(this.cursor.beat).slice(this.areas().length) : [];
      for (const area of ghosts) drawEntry(area as unknown as Record<string, unknown>, -1, null, this.areaX(area, 0) - AREA_BAR_WIDTH / 2, AREA_BAR_WIDTH, true);
      // Every event ghost goes through the same track drawing, so a previewed paste merges exactly
      // like the events it will become.
      const eventGhosts = new Map<string, NoiseEvent[]>();
      for (const entry of this.clipboard.entries) if (entry.type !== 'area' && this.area()) {
        const source = entry.value as NoiseEvent; const value = { ...source, startTime: fromNumber(beatValue(source.startTime) + delta), endTime: fromNumber(beatValue(source.endTime) + delta) };
        if (!eventGhosts.has(entry.type)) eventGhosts.set(entry.type, []); eventGhosts.get(entry.type)!.push(value);
      }
      for (const [type, events] of eventGhosts) drawTrack(events, type, true);
    }
    if (this.drag?.kind === 'rectangle') { const start = this.drag.start; const current = this.cursor as NonNullable<NoiseAreaEditor['cursor']>; context.save(); context.lineWidth = 1; context.fillStyle = '#ffcc4430'; context.strokeStyle = '#ffdd77'; const top = this.y(start.rawBeat); const deltaY = this.y(current.rawBeat) - top; context.fillRect(start.x, top, current.x - start.x, deltaY); context.strokeRect(start.x, top, current.x - start.x, deltaY); context.restore(); }
    if (this.drag?.kind === 'stroke' && this.drag.moved) { context.save(); context.lineWidth = 1; context.strokeStyle = '#80ffff'; context.beginPath(); (this.drag.points as Point[]).forEach((point, index) => index ? context.lineTo(point.x, this.y((point as Point & { rawBeat: number }).rawBeat)) : context.moveTo(point.x, this.y((point as Point & { rawBeat: number }).rawBeat))); context.stroke(); context.restore(); }
    this.drawOwner(context, layout);
    const owner = this.area() ? `#${this.selected} ${this.area()!.Name || '未命名噪域'}` : '未指定噪域';
    this.canvas.setAttribute('aria-description', `噪域数量: ${this.areas().length}；当前右侧内部事件：${owner}`);
    context.strokeStyle = timeline.judgementColor ?? '#ffffff'; context.lineWidth = 2; context.beginPath(); context.moveTo(0, this.y(timeline.origin)); context.lineTo(width, this.y(timeline.origin)); context.stroke();
  }
  eventGroups(events: NoiseEvent[]): EventChain[] {
    return (eventDisplayIndex(this, events, this.draftChart ?? this.context.session?.chart) as EventDisplay).groups;
  }
  /**
   * The offscreen bounds rectangle selection tests, one per selectable entry.
   *
   * Built on demand rather than collected while drawing, so a marquee sees entries that are scrolled
   * out of view and nothing is paid for on the frames that draw no marquee.
   */
  *selectionRects(side: string): Generator<SelectionRect> {
    // Build offscreen selection bounds only on mouseup, not on every animation frame.
    if (side === 'areas') {
      for (const [index, area] of this.areas().entries()) yield { x: this.areaX(area, index) - AREA_BAR_WIDTH / 2, width: AREA_BAR_WIDTH, index, type: null, start: beatValue(area.appearTime), end: beatValue(area.disappearTime) };
    } else for (const [type] of NOISE_TRACKS) {
      const bounds = this.eventBounds(type);
      for (const [index, event] of ((this.area()?.[type] as NoiseEvent[] | undefined) ?? []).entries()) yield { ...bounds, index, type, start: beatValue(event.startTime), end: beatValue(event.endTime) };
    }
  }
  drawEventChain(context: CanvasRenderingContext2D, group: EventChain, type: string, bounds: { x: number; width: number }, height: number, ghost = false): void {
    // The chain's length was checked before it was drawn, so both ends exist.
    const head = this.y(beatValue(group.entries[0]!.event.startTime)); const tail = this.y(beatValue(group.entries.at(-1)!.event.endTime));
    const top = Math.max(HEADER_HEIGHT, tail); const bottom = Math.min(height, head);
    if (bottom <= top) return;
    const layout = this.layout(); const color = colors[NOISE_TRACKS.findIndex(track => track[0] === type)];
    context.save(); context.beginPath(); context.rect(layout.eventLeft, HEADER_HEIGHT, layout.width - layout.eventLeft, height - HEADER_HEIGHT); context.clip();
    context.globalAlpha = ghost ? 0.4 : 1; context.fillStyle = color + '40'; context.fillRect(bounds.x, top, bounds.width, bottom - top);
    context.strokeStyle = color; context.lineWidth = 1; if (ghost) context.setLineDash([4, 3]); context.strokeRect(bounds.x, tail, bounds.width, head - tail);
    context.fillStyle = color; context.fillRect(bounds.x, head - 2, bounds.width, 4); context.fillRect(bounds.x, tail - 2, bounds.width, 4); context.restore();
  }
  drawEventValues(context: CanvasRenderingContext2D, events: NoiseEvent[], type: string, bounds: { x: number; width: number }, height: number, ghost = false, visibleGroups: Set<EventChain> | null = null): void {
    if (!events.length || bounds.width < (this.context.timeline.eventValueThreshold ?? 30)) return;
    const groups = visibleGroups ?? this.eventGroups(events);
    const layout = this.layout();
    context.save(); context.beginPath(); context.rect(layout.eventLeft, HEADER_HEIGHT, layout.width - layout.eventLeft, height - HEADER_HEIGHT); context.clip();
    context.globalAlpha = ghost ? 0.4 : 1; context.font = `${this.context.timeline.eventValueFontSize ?? 13}px RPE, sans-serif`; context.textAlign = 'center';
    for (const group of groups) {
      // A chain always spans at least two entries, so the first and last are present.
      const first = group.entries[0]!.event; const last = group.entries.at(-1)!.event;
      const top = this.y(beatValue(last.endTime)); const bottom = this.y(beatValue(first.startTime));
      if (bottom < HEADER_HEIGHT || top > height) continue;
      context.fillStyle = colors[NOISE_TRACKS.findIndex(track => track[0] === type)];
      context.fillText(String(round(group.max)), bounds.x + bounds.width / 2, Math.max(HEADER_HEIGHT + 14, top + 14), bounds.width);
      if (bottom - top > 26) context.fillText(String(round(group.min)), bounds.x + bounds.width / 2, Math.min(height - 5, bottom - 5), bounds.width);
    }
    context.restore();
  }
  drawOwner(context: CanvasRenderingContext2D, layout: { width: number; height: number; split: number; eventLeft: number; eventWidth: number }): void {
    const area = this.area(); if (!area) return;
    const horizontal = this.areaX(area, this.selected); const top = this.y(beatValue(area.disappearTime)); const bottom = this.y(beatValue(area.appearTime));
    const above = bottom < HEADER_HEIGHT; const below = top > layout.height;
    context.save();
    context.beginPath(); context.rect(0, HEADER_HEIGHT, layout.split, layout.height - HEADER_HEIGHT); context.clip();
    const vertical = above ? HEADER_HEIGHT + 19 : below ? layout.height - 12 : Math.max(HEADER_HEIGHT + 18, Math.min(layout.height - 14, top + 36));
    const label = `${above ? '▲ ' : below ? '▼ ' : '→ '}#${this.selected} ${area.Name || '噪域'}`;
    context.font = '12px sans-serif'; context.textAlign = 'left'; const textWidth = Math.min(layout.split - 12, context.measureText(label).width + 10); const left = Math.max(6, Math.min(layout.split - textWidth - 6, horizontal + AREA_BAR_WIDTH / 2 + 7));
    context.fillStyle = '#242628ed'; context.fillRect(left - 3, vertical - 14, textWidth, 19); context.fillStyle = '#f5f5f5'; context.fillText(label, left, vertical, textWidth - 6); context.restore();
  }
  drawDistribution(context: CanvasRenderingContext2D, area: NoiseArea, left: number, width: number, top: number, bottom: number): void {
    const { tempo } = this.context;
    let distribution = this.distributions.get(area);
    // The flash spans are measured in seconds, so a different tempo map invalidates the entry even
    // though the area itself did not change.
    if (!distribution || distribution.tempo !== tempo) {
      const tracks: [number, number][][] = NOISE_TRACKS.map(([type]) => {
        const intervals = (((area[type] as NoiseEvent[] | undefined) ?? []).map(event => [beatValue(event.startTime), beatValue(event.endTime)]) as [number, number][]).sort((first, second) => first[0] - second[0]);
        const merged: [number, number][] = [];
        for (const interval of intervals) { const previous = merged.at(-1); if (previous && interval[0] <= previous[1]) previous[1] = Math.max(previous[1], interval[1]); else merged.push(interval); }
        return merged;
      });
      // A ready flash runs up to `readyFlash` seconds before its window opens, clipped to the area's
      // own lifetime and to the end of the preceding window so two flashes never overlap.
      const appear = tempo.seconds(area.appearTime); const disappear = tempo.seconds(area.disappearTime);
      const windows = (area.activeIntervals ?? []).map(interval => ({ start: Math.max(appear, tempo.seconds(interval.startTime)), end: Math.min(disappear, tempo.seconds(interval.endTime)), readyFlash: readyFlashValue(interval.readyFlash) })).filter(interval => interval.end > interval.start).sort((first, second) => first.start - second.start);
      const flashes: [number, number][] = windows.flatMap((interval, index) => {
        const start = Math.max(appear, windows[index - 1]?.end ?? -Infinity, interval.start - interval.readyFlash);
        return interval.readyFlash > 0 && start < interval.start ? [[tempo.beat(start), tempo.beat(interval.start)]] : [];
      });
      distribution = { tracks, flashes, tempo }; this.distributions.set(area, distribution);
    }
    context.save(); context.beginPath(); context.rect(left + 2, top + 2, width - 4, Math.max(0, bottom - top - 4)); context.clip(); context.globalAlpha *= 0.55;
    const spacing = (width - 12) / NOISE_TRACKS.length;
    // The flash marker is a dashed line down the first track's column.
    const flashX = left + 6 + (spacing - 2) / 2;
    context.strokeStyle = colors[0]; context.lineWidth = Math.max(1, Math.min(2, spacing / 3)); context.setLineDash([3, 3]); context.beginPath();
    for (const [start, end] of distribution.flashes) {
      const upper = Math.max(HEADER_HEIGHT, top, this.y(end)); const lower = Math.min(this.layout().height, bottom, this.y(start));
      if (lower > upper) { context.moveTo(flashX, upper); context.lineTo(flashX, lower); }
    }
    context.stroke(); context.setLineDash([]);
    for (const [column, intervals] of distribution.tracks.entries()) {
      context.fillStyle = colors[column];
      for (const [start, end] of intervals) {
        const upper = Math.max(HEADER_HEIGHT, top, this.y(end)); const lower = Math.min(this.layout().height, bottom, this.y(start));
        if (lower >= upper) context.fillRect(left + 6 + column * spacing, upper, Math.max(1, spacing - 2), Math.max(2, lower - upper));
      }
    }
    context.restore();
  }
}
