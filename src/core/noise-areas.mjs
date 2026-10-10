import { beatValue, fromNumber, upperBound } from './beat.mjs';
import { EventTrack } from './events.mjs';

const TIME_EPSILON = 1e-9;

export const NOISE_VERSION = 220;
export const NOISE_TRACKS = [
  ['activeIntervals', '激活'], ['moveXEvents', '移动 X'], ['moveYEvents', '移动 Y'],
  ['rotateEvents', '旋转'], ['scaleXEvents', '缩放 X'], ['scaleYEvents', '缩放 Y'],
];
export const NOISE_AREA_COLORS = {
  appearance: [127, 35, 35, 0.4], active: [182, 60, 60, 0.667], edge: [255, 84, 84, 1],
};
export const noiseCenter = area => ({ x: (area.bottomLeft.x + area.topRight.x) / 2, y: (area.bottomLeft.y + area.topRight.y) / 2 });
export const noiseHasAnchor = type => ['rotateEvents', 'scaleXEvents', 'scaleYEvents'].includes(type);

export function createNoiseEvent(start = 0, end = start, startBeat = 0, endBeat = startBeat + 1, anchor) {
  return { startTime: fromNumber(startBeat), endTime: fromNumber(endBeat), start, end,
    easingType: 1, easingLeft: 0, easingRight: 1, bezier: 0, bezierPoints: [0, 0, 1, 1], inst: 0, linkgroup: 0,
    ...(anchor ? { anchor: { ...anchor } } : {}) };
}
export function createNoiseArea(start = 0, end = start + 4) {
  return { Name: '', bottomLeft: { x: -250, y: -150 }, topRight: { x: 250, y: 150 }, appearTime: fromNumber(start), disappearTime: fromNumber(end),
    activeIntervals: [], isInvert: false, moveXEvents: [], moveYEvents: [], rotateEvents: [], scaleXEvents: [], scaleYEvents: [] };
}
export function withNoiseAreas(chart, areas) {
  validateNoiseAreas(areas);
  return { ...chart, META: { ...chart.META, RPEVersion: Math.max(chart.META.RPEVersion ?? 0, NOISE_VERSION) }, blockAreaList: areas };
}
export function shiftNoiseArea(area, delta) {
  const result = structuredClone(area);
  for (const key of ['appearTime', 'disappearTime']) result[key] = fromNumber(beatValue(area[key]) + delta);
  for (const [type] of NOISE_TRACKS) result[type] = (area[type] ?? []).map(event => ({ ...structuredClone(event), startTime: fromNumber(beatValue(event.startTime) + delta), endTime: fromNumber(beatValue(event.endTime) + delta) }));
  return result;
}
export function noiseAreaLifetime(area) { return { appear: beatValue(area.appearTime), disappear: beatValue(area.disappearTime) }; }

const identity = () => [1, 0, 0, 1, 0, 0];
const applyTransform = (matrix, point) => ({ x: matrix[0] * point.x + matrix[2] * point.y + matrix[4], y: matrix[1] * point.x + matrix[3] * point.y + matrix[5] });
function composeTransform(after, before) {
  const origin = applyTransform(after, { x: before[4], y: before[5] });
  return [after[0] * before[0] + after[2] * before[1], after[1] * before[0] + after[3] * before[1],
    after[0] * before[2] + after[2] * before[3], after[1] * before[2] + after[3] * before[3], origin.x, origin.y];
}
function relativeTransform(type, start, value, anchor) {
  if (type === 'rotateEvents') {
    const angle = (value - start) * Math.PI / 180; const cosine = Math.cos(angle); const sine = Math.sin(angle);
    return [cosine, -sine, sine, cosine, anchor.x * (1 - cosine) - anchor.y * sine, anchor.y * (1 - cosine) + anchor.x * sine];
  }
  const ratio = start === 0 ? 1 : value / start;
  const scale = Number.isFinite(ratio) ? ratio : 1;
  return type === 'scaleXEvents' ? [scale, 0, 0, 1, anchor.x * (1 - scale), 0] : [1, 0, 0, scale, 0, anchor.y * (1 - scale)];
}
function cumulativeTrack(track, type, center) {
  const prefixes = new Map(); let matrix = identity(); let previous;
  for (const { event } of track.events) {
    const baseline = event.transformStart ?? event.start;
    if (previous) {
      const endpoint = previous.transformEnd ?? previous.end; const anchor = previous.anchor ?? center;
      matrix = composeTransform(relativeTransform(type, previous.transformStart ?? previous.start, endpoint, anchor), matrix);
      matrix = composeTransform(relativeTransform(type, endpoint, baseline, anchor), matrix);
    }
    prefixes.set(event, matrix); previous = event;
  }
  return prefixes;
}

const sampleOverrides = new WeakMap();
export function setNoiseSampleOverride(area, overrides) { sampleOverrides.set(area, overrides); }

export class NoiseAreaRuntime {
  constructor(area, tempo) {
    this.area = area; this.tempo = tempo; this.center = noiseCenter(area);
    this.appear = tempo.seconds(area.appearTime); this.disappear = tempo.seconds(area.disappearTime);
    this.intervals = (area.activeIntervals ?? []).map(interval => ({ start: Math.max(this.appear, tempo.seconds(interval.startTime)), end: Math.min(this.disappear, tempo.seconds(interval.endTime)), readyFlash: readyFlashSeconds(interval.readyFlash) })).filter(interval => interval.end > interval.start).sort((left, right) => left.start - right.start);
    this.tracks = Object.fromEntries(NOISE_TRACKS.slice(1).map(([type]) => [type, new EventTrack(area[type], tempo)]));
    this.prefixes = Object.fromEntries(['scaleXEvents', 'scaleYEvents', 'rotateEvents'].map(type => [type, cumulativeTrack(this.tracks[type], type, this.center)]));
    const left = Math.min(area.bottomLeft.x, area.topRight.x); const right = Math.max(area.bottomLeft.x, area.topRight.x);
    const bottom = Math.min(area.bottomLeft.y, area.topRight.y); const top = Math.max(area.bottomLeft.y, area.topRight.y);
    this.corners = [{ x: left, y: bottom }, { x: right, y: bottom }, { x: right, y: top }, { x: left, y: top }];
  }
  track(type, seconds, fallback) {
    const track = this.tracks[type]; const index = upperBound(track.events, seconds + TIME_EPSILON, entry => entry.start) - 1; const entry = track.events[index];
    return { value: entry ? track.sample(entry, seconds) : fallback, event: entry?.event };
  }
  sample(seconds, overrides = sampleOverrides.get(this.area) ?? {}) {
    const activeIndex = upperBound(this.intervals, seconds + TIME_EPSILON, interval => interval.start) - 1;
    const active = this.intervals[activeIndex]; const next = this.intervals[activeIndex + 1];
    let state = active && seconds + TIME_EPSILON < active.end ? 'active' : next?.readyFlash > 0 && seconds + TIME_EPSILON >= next.start - next.readyFlash ? 'ready' : 'disabled';
    if (seconds + TIME_EPSILON < this.appear) state = 'hiddenBefore';
    if (seconds + TIME_EPSILON >= this.disappear) state = 'hiddenAfter';
    const phase = next?.readyFlash > 0 ? Math.max(0, Math.min(1, (seconds - next.start + next.readyFlash) / next.readyFlash)) : 0;
    const activationMix = state === 'active' ? 1 : state === 'ready' ? (1 + Math.cos(phase * Math.PI * 6)) / 2 : 0;
    const alpha = NOISE_AREA_COLORS.appearance[3] + (NOISE_AREA_COLORS.active[3] - NOISE_AREA_COLORS.appearance[3]) * activationMix;
    const values = Object.fromEntries(NOISE_TRACKS.slice(1).map(([type]) => [type, overrides[type] ?? this.track(type, seconds, type.startsWith('scale') ? 1 : type === 'moveXEvents' ? this.center.x : type === 'moveYEvents' ? this.center.y : 0)]));
    const move = { x: values.moveXEvents.value - this.center.x, y: values.moveYEvents.value - this.center.y };
    const rotation = values.rotateEvents.value * Math.PI / 180;
    const scaleX = values.scaleXEvents.value; const scaleY = values.scaleYEvents.value;
    const anchorX = values.scaleXEvents.event?.anchor ?? this.center; const anchorY = values.scaleYEvents.event?.anchor ?? this.center; const anchorR = values.rotateEvents.event?.anchor ?? this.center;
    const accumulate = (type, point) => {
      const { event, value } = values[type]; if (!event) return point;
      const previous = applyTransform(this.prefixes[type].get(event) ?? identity(), point);
      return applyTransform(relativeTransform(type, event.transformStart ?? event.start, value, event.anchor ?? this.center), previous);
    };
    const rotate = point => ({ x: Math.cos(rotation) * point.x + Math.sin(rotation) * point.y, y: -Math.sin(rotation) * point.x + Math.cos(rotation) * point.y });
    const center = accumulate('rotateEvents', accumulate('scaleYEvents', accumulate('scaleXEvents', this.center)));
    const transform = point => { const rotated = rotate({ x: scaleX * (point.x - this.center.x), y: scaleY * (point.y - this.center.y) }); return { x: center.x + rotated.x + move.x, y: center.y + rotated.y + move.y }; };
    return { state, alpha, activationMix, points: this.corners.map(transform), center: transform(this.center), values, move, rotation, scaleX, scaleY, anchorX, anchorY, anchorR, transform, rotate };
  }
}
const runtimeCache = new WeakMap();
export function noiseRuntime(area, tempo) {
  let entry = runtimeCache.get(area);
  if (!entry || entry.tempo !== tempo) { entry = new NoiseAreaRuntime(area, tempo); runtimeCache.set(area, entry); }
  return entry;
}
export function sampleNoiseArea(area, beat, tempo) { return noiseRuntime(area, tempo).sample(tempo.seconds(beat)); }
export function noiseAreaState(area, beat, tempo) { return sampleNoiseArea(area, beat, tempo).state; }

function readyFlashSeconds(value) {
  if (typeof value === 'boolean') return value ? 0.5 : 0;
  return Number.isFinite(value) ? Math.round(Math.max(0, value) * 1000) / 1000 : 0.5;
}

export function normalizeNoiseAreas(areas = []) {
  return areas.map(area => ({ ...area, activeIntervals: (area.activeIntervals ?? []).map(interval => ({ ...interval, readyFlash: readyFlashSeconds(interval.readyFlash) })) }));
}

function validatePosition(value, path) {
  if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y)) throw new Error(path + ': 坐标必须包含有限 x/y');
}
function validateTrack(events, path, type) {
  if (!Array.isArray(events)) throw new Error(path + ' 必须为数组');
  const intervals = events.map((event, index) => {
    const eventPath = path + '[' + index + ']';
    const start = beatValue(event?.startTime, eventPath + '.startTime'); const end = beatValue(event?.endTime, eventPath + '.endTime');
    if (start > end) throw new Error(eventPath + ': 开始拍不能晚于结束拍');
    if (type === 'activeIntervals') {
      if (event.readyFlash !== undefined && !((typeof event.readyFlash === 'number' && Number.isFinite(event.readyFlash)) || typeof event.readyFlash === 'boolean')) throw new Error(eventPath + '.readyFlash 必须为秒数');
    } else {
      if (!Number.isFinite(event.start) || !Number.isFinite(event.end)) throw new Error(eventPath + ': 首尾值必须为有限数字');
      if (noiseHasAnchor(type)) validatePosition(event.anchor, eventPath + '.anchor');
      for (const field of ['transformStart', 'transformEnd']) if (event[field] !== undefined && (!noiseHasAnchor(type) || !Number.isFinite(event[field]))) throw new Error(eventPath + '.' + field + ': 仅旋转及缩放事件可使用有限变换参考值');
      if (event.transformStep !== undefined && (typeof event.transformStep !== 'boolean' || !noiseHasAnchor(type) || event.transformStep && start !== end)) throw new Error(eventPath + '.transformStep: 仅旋转及缩放的零时长事件可标记瞬时累计步骤');
      for (const flag of ['inst', 'bezier']) if (event[flag] !== undefined && ![0, 1, false, true].includes(event[flag])) throw new Error(eventPath + '.' + flag + ': 只接受 0/1 或布尔值');
      if (event.inst && event.start !== event.end) throw new Error(eventPath + ': 钩定事件首尾值必须相同');
      if (!Number.isInteger(event.easingType ?? 1) || (event.easingType ?? 1) < 1 || (event.easingType ?? 1) > 29) throw new Error(eventPath + ': 缓动编号须在 1–29 内');
      const left = event.easingLeft ?? 0; const right = event.easingRight ?? 1;
      if (!Number.isFinite(left) || !Number.isFinite(right) || left < 0 || right > 1 || left >= right) throw new Error(eventPath + ': 缓动边界须满足 0 ≤ 左 < 右 ≤ 1');
      if (event.bezier) {
        const points = event.bezierPoints;
        if (!Array.isArray(points) || points.length !== 4 || !points.every(Number.isFinite) || points[0] < 0 || points[0] > 1 || points[2] < 0 || points[2] > 1) throw new Error(eventPath + ': Bezier 控制点无效');
      }
    }
    return { start, end, index, event };
  }).filter(interval => type !== 'activeIntervals' || interval.end > interval.start).sort((left, right) => left.start - right.start);
  let previous;
  for (const interval of intervals) {
    const instantChain = noiseHasAnchor(type) && interval.start === previous?.start && previous.end === previous.start && previous.event.transformStep;
    if (previous && (interval.start < previous.end || type !== 'activeIntervals' && interval.start === previous.start && !instantChain)) throw new Error(path + '[' + interval.index + ']: 时间重叠或同起点冲突');
    previous = interval;
  }
}
export function validateNoiseArea(area, path = 'blockAreaList[]') {
  if (!area || typeof area !== 'object' || Array.isArray(area)) throw new Error(path + ': 无效噪域');
  for (const key of ['bottomLeft', 'topRight']) validatePosition(area[key], path + '.' + key);
  if (area.Name !== undefined && typeof area.Name !== 'string') throw new Error(path + '.Name 必须为文本');
  if (area.editorPositionX !== undefined && !Number.isFinite(area.editorPositionX)) throw new Error(path + '.editorPositionX 必须为有限数值');
  if (area.isInvert !== undefined && typeof area.isInvert !== 'boolean') throw new Error(path + '.isInvert 必须为布尔值');
  if (beatValue(area.appearTime, path + '.appearTime') > beatValue(area.disappearTime, path + '.disappearTime')) throw new Error(path + ': 出现拍不能晚于消失拍');
  for (const [type] of NOISE_TRACKS) validateTrack(area[type] ?? [], path + '.' + type, type);
  return area;
}
export function validateNoiseAreas(areas = []) {
  if (!Array.isArray(areas)) throw new Error('blockAreaList 必须为数组');
  areas.forEach((area, index) => validateNoiseArea(area, 'blockAreaList[' + index + ']')); return areas;
}
export function diagnoseNoiseAreas(areas = []) {
  const issues = [];
  for (const [index, area] of areas.entries()) {
    const path = 'blockAreaList[' + index + ']';
    const add = (message, options = {}) => issues.push({ severity: 'warning', noiseArea: index, beat: beatValue(area.appearTime), path, message, ...options });
    try { validateNoiseArea(area, path); } catch (error) { issues.push({ severity: 'error', noiseArea: index, beat: 0, path, message: error.message }); continue; }
    const { appear, disappear } = noiseAreaLifetime(area);
    if (appear === disappear || area.bottomLeft.x === area.topRight.x || area.bottomLeft.y === area.topRight.y) add('噪域生命周期或矩形面积为零');
    for (const [type] of NOISE_TRACKS) for (const [eventIndex, event] of (area[type] ?? []).entries()) {
      if (beatValue(event.startTime) < appear || beatValue(event.endTime) > disappear) add('噪域内部时间超出生命周期；原数据保留，仅限制显示范围', { beat: beatValue(event.startTime), path: path + '.' + type + '[' + eventIndex + ']', noiseTrack: type, index: eventIndex });
    }
  }
  return issues;
}
