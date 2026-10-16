import { beatValue, fromNumber, upperBound } from './beat.ts';
import { EventTrack } from './events.ts';
import { NOISE_LAYER_VERSION } from './noise-skin.mjs';
import type { Beat, Chart, ChartEvent, NoiseArea, NoiseEvent, NoiseInterval, NoisePoint } from './types.ts';

// The four area shapes are declared in `types.ts` because `Chart` carries the list and `types.ts` sits
// at the bottom of the import graph. They are re-exported here so every existing importer of this
// module keeps working unchanged.
export type { NoiseArea, NoiseEvent, NoiseInterval, NoisePoint };

const TIME_EPSILON = 1e-9;

export const NOISE_VERSION = 220;

/**
 * The six tracks every 噪域 carries, as `[field, label]`.
 *
 * The first is the area's own activation schedule; the other five are the transform tracks, which is
 * why most code below slices the first entry off before treating them as transforms.
 */
export const NOISE_TRACKS: readonly (readonly [string, string])[] = [
  ['activeIntervals', '激活'], ['moveXEvents', '移动 X'], ['moveYEvents', '移动 Y'],
  ['rotateEvents', '旋转'], ['scaleXEvents', '缩放 X'], ['scaleYEvents', '缩放 Y'],
];

/** The four-channel colours the preview blends between, as `[red, green, blue, alpha]` per state. */
export const NOISE_AREA_COLORS: { appearance: number[]; active: number[]; edge: number[] } = {
  appearance: [127, 35, 35, 0.4], active: [182, 60, 60, 0.667], edge: [255, 84, 84, 1],
};

/** The tempo lookup the runtime needs; only the seconds conversion is used. */
export interface NoiseTempo {
  seconds(beat: number | Beat | [number, number, number]): number;
}

/** The five states {@link NoiseAreaRuntime.sample} reports. */
export type NoiseState = 'active' | 'ready' | 'disabled' | 'hiddenBefore' | 'hiddenAfter';

/** One track's reading at a moment: the value, plus the event that produced it when there is one. */
export interface NoiseTrackSample { value: number; event: NoiseEvent | undefined }

/** Everything the preview and the sampler read off an area at one moment. */
export interface NoiseAreaSample {
  state: NoiseState;
  alpha: number;
  activationMix: number;
  /** The four transformed corners, in `bottomLeft`, `bottomRight`, `topRight`, `topLeft` order. */
  points: NoisePoint[];
  center: NoisePoint;
  values: Record<string, NoiseTrackSample>;
  move: NoisePoint;
  rotation: number;
  scaleX: number;
  scaleY: number;
  anchorX: NoisePoint;
  anchorY: NoisePoint;
  anchorR: NoisePoint;
  transform(point: NoisePoint): NoisePoint;
  rotate(point: NoisePoint): NoisePoint;
}

/** A value substituted for one track while a drag is in flight, keyed by track name. */
export type NoiseSampleOverride = Record<string, { value: number; event: NoiseEvent } | undefined>;

/** The field a sampler drag is editing, and the point its displacement is measured through. */
export interface NoiseTarget {
  type: string;
  index: number;
  field: string;
  reference?: NoisePoint;
}

/** The shape {@link diagnoseNoiseAreas} reports, structural so this module need not import `chart.ts`. */
export interface NoiseDiagnostic {
  severity: 'error' | 'warning';
  noiseArea: number;
  beat: number;
  path: string;
  message: string;
  noiseTrack?: string;
  index?: number;
  [key: string]: unknown;
}

export const noiseCenter = (area: NoiseArea): NoisePoint => ({ x: (area.bottomLeft.x + area.topRight.x) / 2, y: (area.bottomLeft.y + area.topRight.y) / 2 });

/** Whether a track's events carry an anchor. */
export const noiseHasAnchor = (type: string): boolean => ['rotateEvents', 'scaleXEvents', 'scaleYEvents'].includes(type);

export function createNoiseEvent(start = 0, end = start, startBeat = 0, endBeat = startBeat + 1, anchor?: NoisePoint): NoiseEvent {
  return { startTime: fromNumber(startBeat), endTime: fromNumber(endBeat), start, end,
    easingType: 1, easingLeft: 0, easingRight: 1, bezier: 0, bezierPoints: [0, 0, 1, 1], inst: 0, linkgroup: 0,
    ...(anchor ? { anchor: { ...anchor } } : {}) };
}
export function createNoiseArea(start = 0, end = start + 4): NoiseArea {
  return { Name: '', bottomLeft: { x: -250, y: -150 }, topRight: { x: 250, y: 150 }, appearTime: fromNumber(start), disappearTime: fromNumber(end),
    activeIntervals: [], isInvert: false, moveXEvents: [], moveYEvents: [], rotateEvents: [], scaleXEvents: [], scaleYEvents: [] };
}
export function withNoiseAreas(chart: Chart, areas: NoiseArea[]): Chart {
  validateNoiseAreas(areas);
  // A chart that already carries noise layers needs the higher layer version recorded instead.
  return { ...chart, META: { ...chart.META, RPEVersion: Math.max(chart.META.RPEVersion ?? 0, chart.noiseAreaLayers ? NOISE_LAYER_VERSION : NOISE_VERSION) }, blockAreaList: areas };
}
export function shiftNoiseArea(area: NoiseArea, delta: number): NoiseArea {
  const result = structuredClone(area);
  for (const key of ['appearTime', 'disappearTime']) result[key] = fromNumber(beatValue(area[key]) + delta);
  for (const [type] of NOISE_TRACKS) {
    // The tracks are read through the area's own key rather than by name, because `NOISE_TRACKS` is
    // the only place the six names are listed; each is an event array by construction.
    const events = area[type] as NoiseEvent[] | undefined;
    result[type] = (events ?? []).map(event => ({ ...structuredClone(event), startTime: fromNumber(beatValue(event.startTime) + delta), endTime: fromNumber(beatValue(event.endTime) + delta) }));
  }
  return result;
}
export function noiseAreaLifetime(area: NoiseArea): { appear: number; disappear: number } { return { appear: beatValue(area.appearTime), disappear: beatValue(area.disappearTime) }; }

const identity = (): number[] => [1, 0, 0, 1, 0, 0];
const applyTransform = (matrix: number[], point: NoisePoint): NoisePoint => ({ x: matrix[0] * point.x + matrix[2] * point.y + matrix[4], y: matrix[1] * point.x + matrix[3] * point.y + matrix[5] });
function composeTransform(after: number[], before: number[]): number[] {
  const origin = applyTransform(after, { x: before[4], y: before[5] });
  return [after[0] * before[0] + after[2] * before[1], after[1] * before[0] + after[3] * before[1],
    after[0] * before[2] + after[2] * before[3], after[1] * before[2] + after[3] * before[3], origin.x, origin.y];
}
function relativeTransform(type: string, start: number, value: number, anchor: NoisePoint): number[] {
  if (type === 'rotateEvents') {
    const angle = (value - start) * Math.PI / 180; const cosine = Math.cos(angle); const sine = Math.sin(angle);
    return [cosine, -sine, sine, cosine, anchor.x * (1 - cosine) - anchor.y * sine, anchor.y * (1 - cosine) + anchor.x * sine];
  }
  const ratio = start === 0 ? 1 : value / start;
  const scale = Number.isFinite(ratio) ? ratio : 1;
  return type === 'scaleXEvents' ? [scale, 0, 0, 1, anchor.x * (1 - scale), 0] : [1, 0, 0, scale, 0, anchor.y * (1 - scale)];
}
/**
 * The transform each anchored event accumulates on top of, keyed by event.
 *
 * Only the rotation and scale tracks accumulate; the walk is why the prefixes are cached per runtime
 * rather than recomputed per sample.
 */
function cumulativeTrack(track: EventTrack, type: string, center: NoisePoint): Map<ChartEvent, number[]> {
  const prefixes = new Map<ChartEvent, number[]>(); let matrix = identity(); let previous: ChartEvent | undefined;
  for (const { event } of track.events) {
    // A transform track only carries numbers, so the wider `EventValue` union the base type declares
    // for colour and text tracks narrows to the numeric reading the arithmetic below expects.
    const baseline = (event.transformStart ?? event.start) as number;
    if (previous) {
      const endpoint = (previous.transformEnd ?? previous.end) as number; const anchor = previous.anchor ?? center;
      matrix = composeTransform(relativeTransform(type, (previous.transformStart ?? previous.start) as number, endpoint, anchor), matrix);
      matrix = composeTransform(relativeTransform(type, endpoint, baseline, anchor), matrix);
    }
    prefixes.set(event, matrix); previous = event;
  }
  return prefixes;
}

const sampleOverrides = new WeakMap<NoiseArea, NoiseSampleOverride>();
export function setNoiseSampleOverride(area: NoiseArea, overrides: NoiseSampleOverride): void { sampleOverrides.set(area, overrides); }

/** One resolved activation window, in seconds. */
interface ActiveInterval { start: number; end: number; readyFlash: number }

/**
 * One area resolved against a tempo map.
 *
 * The constructor converts every beat into seconds once, so sampling is a lookup rather than a
 * conversion; the interval list is clipped to the area's lifetime and the transform prefixes are
 * precomputed because both are read on every frame.
 */
export class NoiseAreaRuntime {
  area: NoiseArea;
  tempo: NoiseTempo;
  center: NoisePoint;
  appear: number;
  disappear: number;
  intervals: ActiveInterval[];
  tracks: Record<string, EventTrack>;
  prefixes: Record<string, Map<ChartEvent, number[]>>;
  corners: NoisePoint[];

  constructor(area: NoiseArea, tempo: NoiseTempo) {
    this.area = area; this.tempo = tempo; this.center = noiseCenter(area);
    this.appear = tempo.seconds(area.appearTime); this.disappear = tempo.seconds(area.disappearTime);
    this.intervals = (area.activeIntervals ?? []).map(interval => ({ start: Math.max(this.appear, tempo.seconds(interval.startTime)), end: Math.min(this.disappear, tempo.seconds(interval.endTime)), readyFlash: readyFlashSeconds(interval.readyFlash) })).filter(interval => interval.end > interval.start).sort((left, right) => left.start - right.start);
    this.tracks = Object.fromEntries(NOISE_TRACKS.slice(1).map(([type]) => [type, new EventTrack(area[type] as ChartEvent[] | undefined, tempo as never)]));
    this.prefixes = Object.fromEntries(['scaleXEvents', 'scaleYEvents', 'rotateEvents'].map(type => [type, cumulativeTrack(this.tracks[type], type, this.center)]));
    const left = Math.min(area.bottomLeft.x, area.topRight.x); const right = Math.max(area.bottomLeft.x, area.topRight.x);
    const bottom = Math.min(area.bottomLeft.y, area.topRight.y); const top = Math.max(area.bottomLeft.y, area.topRight.y);
    this.corners = [{ x: left, y: bottom }, { x: right, y: bottom }, { x: right, y: top }, { x: left, y: top }];
  }
  track(type: string, seconds: number, fallback: number): NoiseTrackSample {
    const track = this.tracks[type]; const index = upperBound(track.events, seconds + TIME_EPSILON, entry => entry.start) - 1; const entry = track.events[index];
    // `EventTrack.sample` returns the wider `EventValue` union because the same class also serves the
    // colour and text tracks; a transform track only ever yields a number, so the read is narrowed.
    const value = (entry ? track.sample(entry, seconds) : fallback) as number;
    return { value, event: entry?.event as NoiseEvent | undefined };
  }
  sample(seconds: number, overrides: NoiseSampleOverride = sampleOverrides.get(this.area) ?? {}): NoiseAreaSample {
    const activeIndex = upperBound(this.intervals, seconds + TIME_EPSILON, interval => interval.start) - 1;
    const active = this.intervals[activeIndex]; const next = this.intervals[activeIndex + 1];
    // Read through locals so the ready-flash tests below need no narrowing; an absent `next` yields a
    // zero flash, which is exactly what the original's `undefined > 0` comparison produced.
    const nextStart = next?.start ?? Number.POSITIVE_INFINITY; const nextFlash = next?.readyFlash ?? 0;
    let state: NoiseState = active && seconds + TIME_EPSILON < active.end ? 'active' : nextFlash > 0 && seconds + TIME_EPSILON >= nextStart - nextFlash ? 'ready' : 'disabled';
    if (seconds + TIME_EPSILON < this.appear) state = 'hiddenBefore';
    if (seconds + TIME_EPSILON >= this.disappear) state = 'hiddenAfter';
    const phase = nextFlash > 0 ? Math.max(0, Math.min(1, (seconds - nextStart + nextFlash) / nextFlash)) : 0;
    const activationMix = state === 'active' ? 1 : state === 'ready' ? (1 + Math.cos(phase * Math.PI * 6)) / 2 : 0;
    const alpha = NOISE_AREA_COLORS.appearance[3] + (NOISE_AREA_COLORS.active[3] - NOISE_AREA_COLORS.appearance[3]) * activationMix;
    const values: Record<string, NoiseTrackSample> = Object.fromEntries(NOISE_TRACKS.slice(1).map(([type]) => [type, overrides[type] ?? this.track(type, seconds, type.startsWith('scale') ? 1 : type === 'moveXEvents' ? this.center.x : type === 'moveYEvents' ? this.center.y : 0)]));
    const move = { x: values.moveXEvents.value - this.center.x, y: values.moveYEvents.value - this.center.y };
    const rotation = values.rotateEvents.value * Math.PI / 180;
    const scaleX = values.scaleXEvents.value; const scaleY = values.scaleYEvents.value;
    const anchorX = values.scaleXEvents.event?.anchor ?? this.center; const anchorY = values.scaleYEvents.event?.anchor ?? this.center; const anchorR = values.rotateEvents.event?.anchor ?? this.center;
    const accumulate = (type: string, point: NoisePoint): NoisePoint => {
      const { event, value } = values[type]; if (!event) return point;
      const previous = applyTransform(this.prefixes[type].get(event) ?? identity(), point);
      return applyTransform(relativeTransform(type, (event.transformStart ?? event.start) as number, value, event.anchor ?? this.center), previous);
    };
    const rotate = (point: NoisePoint): NoisePoint => ({ x: Math.cos(rotation) * point.x + Math.sin(rotation) * point.y, y: -Math.sin(rotation) * point.x + Math.cos(rotation) * point.y });
    const center = accumulate('rotateEvents', accumulate('scaleYEvents', accumulate('scaleXEvents', this.center)));
    const transform = (point: NoisePoint): NoisePoint => { const rotated = rotate({ x: scaleX * (point.x - this.center.x), y: scaleY * (point.y - this.center.y) }); return { x: center.x + rotated.x + move.x, y: center.y + rotated.y + move.y }; };
    return { state, alpha, activationMix, points: this.corners.map(transform), center: transform(this.center), values, move, rotation, scaleX, scaleY, anchorX, anchorY, anchorR, transform, rotate };
  }
}
const runtimeCache = new WeakMap<NoiseArea, NoiseAreaRuntime>();
export function noiseRuntime(area: NoiseArea, tempo: NoiseTempo): NoiseAreaRuntime {
  let entry = runtimeCache.get(area);
  if (!entry || entry.tempo !== tempo) { entry = new NoiseAreaRuntime(area, tempo); runtimeCache.set(area, entry); }
  return entry;
}
export function sampleNoiseArea(area: NoiseArea, beat: number | Beat, tempo: NoiseTempo): NoiseAreaSample { return noiseRuntime(area, tempo).sample(tempo.seconds(beat)); }
export function noiseAreaState(area: NoiseArea, beat: number | Beat, tempo: NoiseTempo): NoiseState { return sampleNoiseArea(area, beat, tempo).state; }

function readyFlashSeconds(value: unknown): number {
  if (typeof value === 'boolean') return value ? 0.5 : 0;
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(Math.max(0, value) * 1000) / 1000 : 0.5;
}

export function normalizeNoiseAreas(areas: NoiseArea[] = []): NoiseArea[] {
  return areas.map(area => ({ ...area, activeIntervals: (area.activeIntervals ?? []).map(interval => ({ ...interval, readyFlash: readyFlashSeconds(interval.readyFlash) })) }));
}

function validatePosition(value: unknown, path: string): void {
  // The two coordinates are read off whatever arrived, so the record view is what the finite tests
  // below inspect; a missing or non-numeric coordinate fails exactly as it did before.
  const point = value as { x?: unknown; y?: unknown } | null | undefined;
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error(path + ': 坐标必须包含有限 x/y');
}
function validateTrack(events: unknown, path: string, type: string): void {
  if (!Array.isArray(events)) throw new Error(path + ' 必须为数组');
  // `Array.isArray` on an `unknown` yields `any[]`; naming the element as a record keeps the field
  // reads below honest — every one of them is probed before use anyway.
  const list = events as Record<string, unknown>[];
  const intervals = list.map((event, index) => {
    const eventPath = path + '[' + index + ']';
    const start = beatValue(event?.startTime, eventPath + '.startTime'); const end = beatValue(event?.endTime, eventPath + '.endTime');
    if (start > end) throw new Error(eventPath + ': 开始拍不能晚于结束拍');
    if (type === 'activeIntervals') {
      if (event.readyFlash !== undefined && !((typeof event.readyFlash === 'number' && Number.isFinite(event.readyFlash)) || typeof event.readyFlash === 'boolean')) throw new Error(eventPath + '.readyFlash 必须为秒数');
    } else {
      if (!(typeof event.start === 'number' && Number.isFinite(event.start)) || !(typeof event.end === 'number' && Number.isFinite(event.end))) throw new Error(eventPath + ': 首尾值必须为有限数字');
      if (noiseHasAnchor(type)) validatePosition(event.anchor, eventPath + '.anchor');
      for (const field of ['transformStart', 'transformEnd']) {
        const reference = event[field];
        if (reference !== undefined && (!noiseHasAnchor(type) || !(typeof reference === 'number' && Number.isFinite(reference)))) throw new Error(eventPath + '.' + field + ': 仅旋转及缩放事件可使用有限变换参考值');
      }
      if (event.transformStep !== undefined && (typeof event.transformStep !== 'boolean' || !noiseHasAnchor(type) || event.transformStep && start !== end)) throw new Error(eventPath + '.transformStep: 仅旋转及缩放的零时长事件可标记瞬时累计步骤');
      for (const flag of ['inst', 'bezier']) {
        const flagValue = event[flag];
        if (flagValue !== undefined && ![0, 1, false, true].includes(flagValue as number | boolean)) throw new Error(eventPath + '.' + flag + ': 只接受 0/1 或布尔值');
      }
      if (event.inst && event.start !== event.end) throw new Error(eventPath + ': 钩定事件首尾值必须相同');
      const rawEasing = event.easingType ?? 1;
      if (typeof rawEasing !== 'number' || !Number.isInteger(rawEasing) || rawEasing < 1 || rawEasing > 29) throw new Error(eventPath + ': 缓动编号须在 1–29 内');
      // A non-numeric bound is what the original's `Number.isFinite` test rejected, so it is read the
      // same way here rather than defaulted.
      const finite = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
      const left = finite(event.easingLeft ?? 0); const right = finite(event.easingRight ?? 1);
      if (left === null || right === null || left < 0 || right > 1 || left >= right) throw new Error(eventPath + ': 缓动边界须满足 0 ≤ 左 < 右 ≤ 1');
      if (event.bezier) {
        const points: unknown = event.bezierPoints;
        if (!Array.isArray(points) || points.length !== 4 || !points.every(Number.isFinite)) throw new Error(eventPath + ': Bezier 控制点无效');
        const control = points as number[];
        if (control[0] < 0 || control[0] > 1 || control[2] < 0 || control[2] > 1) throw new Error(eventPath + ': Bezier 控制点无效');
      }
    }
    return { start, end, index, event };
  }).filter(interval => type !== 'activeIntervals' || interval.end > interval.start).sort((left, right) => left.start - right.start);
  let previous: (typeof intervals)[number] | undefined;
  for (const interval of intervals) {
    const instantChain = noiseHasAnchor(type) && interval.start === previous?.start && previous?.end === previous?.start && previous?.event.transformStep;
    if (previous && (interval.start < previous.end || type !== 'activeIntervals' && interval.start === previous.start && !instantChain)) throw new Error(path + '[' + interval.index + ']: 时间重叠或同起点冲突');
    previous = interval;
  }
}
export function validateNoiseArea(area: unknown, path = 'blockAreaList[]'): NoiseArea {
  if (!area || typeof area !== 'object' || Array.isArray(area)) throw new Error(path + ': 无效噪域');
  const candidate = area as Record<string, unknown>;
  for (const key of ['bottomLeft', 'topRight']) validatePosition(candidate[key], path + '.' + key);
  if (candidate.Name !== undefined && typeof candidate.Name !== 'string') throw new Error(path + '.Name 必须为文本');
  if (candidate.editorPositionX !== undefined && !Number.isFinite(candidate.editorPositionX)) throw new Error(path + '.editorPositionX 必须为有限数值');
  if (candidate.isInvert !== undefined && typeof candidate.isInvert !== 'boolean') throw new Error(path + '.isInvert 必须为布尔值');
  if (beatValue(candidate.appearTime, path + '.appearTime') > beatValue(candidate.disappearTime, path + '.disappearTime')) throw new Error(path + ': 出现拍不能晚于消失拍');
  for (const [type] of NOISE_TRACKS) validateTrack(candidate[type] ?? [], path + '.' + type, type);
  return candidate as NoiseArea;
}
export function validateNoiseAreas(areas: unknown = []): NoiseArea[] {
  if (!Array.isArray(areas)) throw new Error('blockAreaList 必须为数组');
  // The validated list is the array that arrived, returned as-is so callers keep writing through it.
  const list = areas as unknown[];
  list.forEach((area, index) => validateNoiseArea(area, 'blockAreaList[' + index + ']'));
  return list as NoiseArea[];
}
export function diagnoseNoiseAreas(areas: NoiseArea[] = []): NoiseDiagnostic[] {
  const issues: NoiseDiagnostic[] = [];
  for (const [index, area] of areas.entries()) {
    const path = 'blockAreaList[' + index + ']';
    const add = (message: string, options: Partial<NoiseDiagnostic> = {}): void => { issues.push({ severity: 'warning', noiseArea: index, beat: beatValue(area.appearTime), path, message, ...options }); };
    try { validateNoiseArea(area, path); } catch (error) { issues.push({ severity: 'error', noiseArea: index, beat: 0, path, message: (error as Error).message }); continue; }
    const { appear, disappear } = noiseAreaLifetime(area);
    if (appear === disappear || area.bottomLeft.x === area.topRight.x || area.bottomLeft.y === area.topRight.y) add('噪域生命周期或矩形面积为零');
    for (const [type] of NOISE_TRACKS) for (const [eventIndex, event] of (area[type] as NoiseEvent[] | undefined ?? []).entries()) {
      if (beatValue(event.startTime) < appear || beatValue(event.endTime) > disappear) add('噪域内部时间超出生命周期；原数据保留，仅限制显示范围', { beat: beatValue(event.startTime), path: path + '.' + type + '[' + eventIndex + ']', noiseTrack: type, index: eventIndex });
    }
  }
  return issues;
}
