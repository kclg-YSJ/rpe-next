import { EVENT_TYPES, assertChart, createEvent } from '../core/chart.ts';
import { beatValue, fromNumber } from '../core/beat.ts';
import { trajectoryHasRotation } from '../core/curve-trajectory.ts';
import { EventTrack } from '../core/events.ts';
import type { ResolvedEvent } from '../core/events.ts';
import { shaderEvents, replaceShaderEvents, alignShaderParameters } from '../core/shader-events.ts';
import type { AnyEventType, Beat, Chart, ChartEvent, EventLayer, EventType } from '../core/types.ts';

/**
 * A document whose `extended` bag also allows an explicit `paintEvents` key.
 *
 * The track is never stored there — shader events live in the chart's top-level effect lists and are
 * projected per line by `shaderEvents` — but the editor still addresses them by that name, so the
 * helpers below accept and produce it.
 */
export type ShaderEventLayer = EventLayer & { paintEvents?: ChartEvent[] };

/** A parsed `type:index` selection key. */
export interface EventSelectionEntry {
  type: AnyEventType;
  index: number;
  event: ChartEvent;
}

/**
 * What {@link eventListAt} needs: a chart, a line index and a layer index.
 *
 * Kept as its own type rather than folded into {@link EventEditSession} because callers that only
 * read a track (batch-edit's per-line previews, selection-history's remapping) have no selection
 * state to hand over.
 */
export interface EventListSource {
  chart: Chart;
  lineIndex: number;
  eventLayer: number;
}

/** The subset of {@link EditorSession} the event commands read and write. */
export interface EventEditSession extends EventListSource {
  eventSelection: Set<string>;
  multiLineActive: boolean;
  multiLineMode: string;
  multiEventSelection: Map<number, Set<string>>;
  shaderAutoAlign?: boolean;
  line?: { bpmfactor?: number };
  selection: Set<number>;
  focus: string;
  eventClipboard: { type: AnyEventType; event: ChartEvent }[];
  selectionState(): unknown;
  commit(label: string, chart: Chart, beforeSelection?: unknown): void;
}

/** A track name plus the events to store under it. */
export type EventListUpdates = Map<AnyEventType, ChartEvent[]>;

/** The tempo map `splitEvent` measures with; only the seconds lookup is required. */
export interface EventTempo {
  seconds(beat: Beat | number, factor?: number): number;
}

/**
 * Replaces a track wholesale.
 *
 * `paintEvents` is an event payload rather than a stored key, so it is routed to the chart's effect
 * list instead of the layer.
 */
export type EventTransform = (event: ChartEvent, type: AnyEventType) => ChartEvent;

export const eventKey = (type: AnyEventType, index: number): string => `${type}:${index}`;

export function eventListAt(session: EventListSource, lineIndex: number, type: AnyEventType, layer = session.eventLayer): ChartEvent[] {
  if (type === 'paintEvents') return shaderEvents(session.chart, lineIndex);
  const line = session.chart.judgeLineList?.[lineIndex];
  return EVENT_TYPES.includes(type as EventType) ? (line?.eventLayers?.[layer] as ShaderEventLayer | undefined)?.[type] ?? [] : line?.extended?.[type] ?? [];
}

export function eventList(session: EventListSource, type: AnyEventType): ChartEvent[] {
  return eventListAt(session, session.lineIndex, type);
}

export function selectedEvents(session: EventEditSession): EventSelectionEntry[] {
  return [...session.eventSelection].map(key => {
    const [type, indexText] = key.split(':'); const index = Number(indexText);
    return { type: type as AnyEventType, index, event: eventList(session, type as AnyEventType)[index] };
  }).filter(entry => entry.event);
}

export function chartWithEventLists(chart: Chart, lineIndex: number, eventLayer: number, updates: EventListUpdates): Chart {
  const source = chart.judgeLineList[lineIndex];
  if (!source) throw new Error('请先添加判定线');
  const line = { ...source, extended: { ...source.extended }, eventLayers: [...(source.eventLayers ?? [])] };
  for (const [type, events] of updates) {
    for (const event of events) if (beatValue(event.endTime) < beatValue(event.startTime)) throw new Error('事件结束拍不能早于开始拍');
    if (type === 'paintEvents') continue;
    if (EVENT_TYPES.includes(type as EventType)) {
      while (line.eventLayers.length <= eventLayer) line.eventLayers.push({});
      line.eventLayers[eventLayer] = { ...(line.eventLayers[eventLayer] as ShaderEventLayer), [type]: events };
    }
    else line.extended[type] = events;
  }
  const lines = [...chart.judgeLineList]; lines[lineIndex] = line;
  chart = { ...chart, judgeLineList: lines };
  if (updates.has('paintEvents')) chart = replaceShaderEvents(chart, lineIndex, updates.get('paintEvents') ?? []);
  return chart;
}

export function commitEventLists(session: EventEditSession, label: string, updates: EventListUpdates, selection: Iterable<string> = session.eventSelection): void {
  const beforeSelection = session.selectionState();
  const chart = chartWithEventLists(session.chart, session.lineIndex, session.eventLayer, updates);
  assertChart(chart);
  session.eventSelection = new Set(selection); session.focus = 'events'; session.selection.clear();
  session.commit(label, chart, beforeSelection);
}

export function transformEvents(session: EventEditSession, label: string, transform: EventTransform): void {
  const updates: EventListUpdates = new Map();
  const linked = new Map<string, ChartEvent>();
  for (const { type, index, event } of selectedEvents(session)) {
    if (!updates.has(type)) updates.set(type, [...eventList(session, type)]);
    let next = transform(event, type);
    if (type === 'paintEvents' && session.shaderAutoAlign !== false && beatValue(next.startTime) !== beatValue(event.startTime)) next = alignShaderParameters(next);
    updates.get(type)![index] = next;
    const link = Number(event.linkgroup ?? 0);
    if (link > 0 && type !== 'paintEvents') linked.set(`${type}:${link}`, next);
  }
  for (const [group, next] of linked) {
    const [type, linkText] = group.split(':'); const link = Number(linkText);
    const events = updates.get(type as AnyEventType) ?? [...eventList(session, type as AnyEventType)];
    for (let index = 0; index < events.length; index++) {
      const event = events[index];
      if (Number(event.linkgroup ?? 0) !== link || session.eventSelection.has(eventKey(type as AnyEventType, index))) continue;
      events[index] = { ...event, start: structuredClone(next.start), end: structuredClone(next.end), easingType: next.easingType,
        easingLeft: next.easingLeft, easingRight: next.easingRight, bezier: next.bezier, bezierPoints: structuredClone(next.bezierPoints) };
    }
    updates.set(type as AnyEventType, events);
  }
  if (updates.size) commitEventLists(session, label, updates);
}

export function insertEvent(session: EventEditSession, type: AnyEventType, event: ChartEvent): void {
  const events = eventList(session, type);
  if (session.multiLineActive && session.multiLineMode === 'events') {
    const updates: EventListUpdates = new Map([[type, [...events, event]]]);
    commitEventLists(session, '添加事件', updates, [eventKey(type, events.length)]);
    return;
  }
  commitEventLists(session, '添加事件', new Map([[type, [...events, event]]]), [eventKey(type, events.length)]);
}

export function insertEventAt(session: EventEditSession, lineIndex: number, type: AnyEventType, event: ChartEvent): void {
  const events = eventListAt(session, lineIndex, type);
  const chart = chartWithEventLists(session.chart, lineIndex, session.eventLayer, new Map([[type, [...events, event]]]));
  const key = eventKey(type, events.length);
  const beforeSelection = session.selectionState();
  session.focus = 'events'; session.selection.clear();
  if (session.multiLineActive && session.multiLineMode === 'events') {
    session.multiEventSelection.set(lineIndex, new Set([key]));
    if (lineIndex === session.lineIndex) session.eventSelection = new Set([key]);
  } else session.eventSelection = new Set([key]);
  session.commit('添加事件', chart, beforeSelection);
}

/**
 * Builds the event a drag on empty timeline space should place.
 *
 * Returns `null` when the drag is too short to be an event. The value it interpolates from is the
 * previous event's end value on the same track, so the new event starts where the track left off.
 */
export function placedEvent(session: EventEditSession, type: AnyEventType, first: number, second: number, easingType: number | null | undefined, lineIndex = session.lineIndex, inst = false): ChartEvent | null {
  const start = Math.min(first, second); const end = Math.max(first, second);
  if (end - start < 0.001) return null;
  const events = eventListAt(session, lineIndex, type);
  // Shader events are a looser shape than ChartEvent: they carry their payload in `vars` and are
  // stamped by the two positions below rather than by `createEvent`. Extra keys are already open on
  // ChartEvent, so only the two interpolated values need widening to the event value union.
  if (type === 'paintEvents') return { startTime: fromNumber(start), endTime: fromNumber(end), start: fromNumber(start), end: fromNumber(end),
    easingType: 1, easingLeft: 0, easingRight: 1, bezier: 0, bezierPoints: [], linkgroup: -1,
    shader: 'chromatic', global: false, order: 0, vars: {} } as ChartEvent;
  // A trajectory occupies the Y and rotation tracks as well as its own X track, so placing an event on
  // either of those has to respect it too. Only a trajectory that really produces an angle blocks the
  // rotation track.
  const trajectories = ['moveYEvents', 'rotateEvents'].includes(type) ? eventListAt(session, lineIndex, 'moveXEvents').filter(event => event.trajectory && (type !== 'rotateEvents' || trajectoryHasRotation(event.trajectory!.options))) : [];
  if ([...events, ...trajectories].some(event => start < beatValue(event.endTime) && end > beatValue(event.startTime))) throw new Error('该时间范围与同轨道已有事件或整体轨迹重叠，请调整终点或按 Esc 取消');
  const previous = events.filter(event => beatValue(event.endTime) <= start).sort((left, right) => beatValue(right.startTime) - beatValue(left.startTime))[0];
  const fallback = type === 'alphaEvents' ? 255 : type.startsWith('scale') ? 1 : type === 'speedEvents' ? 10 : type === 'textEvents' ? '' : type === 'colorEvents' ? [255, 255, 255] : 0;
  const value = structuredClone(previous?.end ?? fallback) as number;
  return { ...createEvent(value, structuredClone(value), start, end), easingType: easingType ?? previous?.easingType ?? 1,
    inst: inst ? 1 : 0, ...(inst ? { end: structuredClone(value) } : {}) };
}

export function deleteEvents(session: EventEditSession): void {
  const updates: EventListUpdates = new Map();
  for (const { type } of selectedEvents(session)) updates.set(type, eventList(session, type).filter((event, index) => !session.eventSelection.has(eventKey(type, index))));
  if (updates.size) commitEventLists(session, '删除事件', updates, []);
}

export function copyEvents(session: EventEditSession): void { session.eventClipboard = structuredClone(selectedEvents(session).map(({ type, event }) => ({ type, event }))); }

export function pasteEvents(session: EventEditSession, beat: number, keepTime = false, mirror = false): void {
  if (!session.eventClipboard.length) return;
  const earliest = session.eventClipboard.reduce((value, entry) => Math.min(value, beatValue(entry.event.startTime)), Infinity);
  const delta = keepTime ? 0 : beat - earliest;
  const updates: EventListUpdates = new Map(); const selection: string[] = [];
  for (const { type, event } of session.eventClipboard) {
    if (!updates.has(type)) updates.set(type, [...eventList(session, type)]);
    const events = updates.get(type)!;
    selection.push(eventKey(type, events.length));
    let pasted = { ...structuredClone(event), startTime: fromNumber(beatValue(event.startTime) + delta), endTime: fromNumber(beatValue(event.endTime) + delta) };
    if (type === 'paintEvents' && delta && session.shaderAutoAlign !== false) pasted = alignShaderParameters(pasted);
    if (mirror && ['moveXEvents', 'rotateEvents'].includes(type)) { pasted.start = -pasted.start; pasted.end = -pasted.end; }
    events.push(pasted);
  }
  commitEventLists(session, '粘贴事件', updates, selection);
}

/**
 * Samples one event at `seconds` through the shared track evaluator.
 *
 * `EventTrack` is a plain JavaScript class in `core/events.ts` whose `value` is untyped, so the
 * sample is narrowed to a number here; both callers below have already rejected non-numeric
 * endpoints, which is the only case the evaluator can return something else.
 *
 * The track is built from an already-resolved entry because `EventTrack`'s constructor only accepts
 * a concrete `TempoMap`, while callers here are typed against the narrower {@link EventTempo}; the
 * `{ start, event, end }` shape below is exactly what that constructor derives, in the same order.
 */
function sampleValue(event: ChartEvent, tempo: EventTempo, seconds: number, factor: number): number {
  const entry: ResolvedEvent = { event, start: tempo.seconds(event.startTime, factor), end: tempo.seconds(event.endTime, factor) };
  const track = Object.create(EventTrack.prototype) as EventTrack;
  track.events = [entry]; track.fallback = 0;
  return track.value(seconds) as number;
}

/** Splits one numeric event in two at `beat`, keeping the sampled value exact. */
export function splitEvent(event: ChartEvent, beat: number, tempo: EventTempo, factor = 1): ChartEvent[] {
  const start = tempo.seconds(event.startTime, factor); const end = tempo.seconds(event.endTime, factor); const at = tempo.seconds(beat, factor);
  if (!(at > start && at < end)) throw new Error('拆分拍数必须在事件内部');
  if (event.bezier) throw new Error('Bezier 事件暂不支持无损拆分，请先使用缓动事件');
  if (typeof event.start !== 'number') throw new Error('当前拆分支持数值事件');
  const progress = (at - start) / (end - start);
  const middle = (event.easingLeft ?? 0) + ((event.easingRight ?? 1) - (event.easingLeft ?? 0)) * progress;
  const value = sampleValue(event, tempo, at, factor);
  // The numeric guard above narrows `start`; `end` is re-checked here because the comparison below
  // reads both endpoints, and a lossless split only makes sense when both values are numbers.
  const head = event.start; const tail = event.end;
  if (typeof head !== 'number' || typeof tail !== 'number') throw new Error('当前拆分支持数值事件');
  if (Math.abs(value - head) < 1e-10 && head !== tail || Math.abs(tail - value) < 1e-10 && head !== tail) throw new Error('此缓动切点无法无损拆分，请调整拆分拍数');
  return [{ ...event, endTime: fromNumber(beat), end: value, easingRight: middle }, { ...event, startTime: fromNumber(beat), start: value, easingLeft: middle }];
}

function splitEventOriginal(event: ChartEvent, beat: number, tempo: EventTempo, factor = 1): ChartEvent[] {
  const start = tempo.seconds(event.startTime, factor); const end = tempo.seconds(event.endTime, factor); const at = tempo.seconds(beat, factor);
  if (!(at > start && at < end)) throw new Error('拆分拍数必须在事件内部');
  if (event.bezier || typeof event.start !== 'number') throw new Error('当前拆分支持数值缓动事件');
  const value = sampleValue(event, tempo, at, factor);
  return [
    { ...event, endTime: fromNumber(beat), end: value, easingType: 1, easingLeft: 0, easingRight: 1, bezier: 0, bezierPoints: [0, 0, 1, 1] },
    { ...event, startTime: fromNumber(beat), start: value },
  ];
}

/** Splits every selected event the playhead sits inside; throws when it sits inside none. */
export function splitSelectedEvents(session: EventEditSession, beat: number, tempo: EventTempo): void {  const updates: EventListUpdates = new Map(); const selection: string[] = [];
  for (const { type, index, event } of selectedEvents(session)) {
    if (beatValue(event.startTime) >= beat || beatValue(event.endTime) <= beat) continue;
    const [first, second] = splitEventOriginal(event, beat, tempo, session.line?.bpmfactor ?? 1);
    if (!updates.has(type)) updates.set(type, [...eventList(session, type)]);
    const events = updates.get(type)!; events[index] = first; events.push(second);
    events.sort((left, right) => beatValue(left.startTime) - beatValue(right.startTime) || beatValue(left.endTime) - beatValue(right.endTime));
    for (let nextIndex = 0; nextIndex < events.length; nextIndex++) if (events[nextIndex] === first || events[nextIndex] === second) selection.push(eventKey(type, nextIndex));
  }
  if (!updates.size) throw new Error('播放光标不在选中事件内部');
  commitEventLists(session, '拆分事件', updates, selection);
}
