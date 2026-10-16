import { fromNumber } from './beat.ts';
import { createNoiseArea, createNoiseEvent, noiseCenter, validateNoiseAreas } from './noise-areas.ts';
import type { NoiseArea, NoiseEvent, NoisePoint } from './noise-areas.ts';
import type { Beat } from './types.ts';

/**
 * The official chart format's own easing codes, mapped onto RPE's.
 *
 * Index 0 is unused (the official format's "no easing" is handled as a plain ramp below), so this is
 * read with `?? 1` rather than indexed directly.
 */
const easingTypes: number[] = [1, 5, 4, 7, 9, 8, 12, 11, 10, 13, 15, 14];

const finite = (value: unknown, path: string): number => {
  if (!Number.isFinite(value)) throw new Error(path + ': 必须为有限数字');
  return value as number;
};
const position = (value: unknown, path: string): NoisePoint => {
  // The two percentages arrive as whatever the document held; `finite` is what rejects a non-number,
  // so the record view is only used to reach the two fields.
  const point = value as { x?: unknown; y?: unknown } | null | undefined;
  return { x: finite(point?.x, path + '.x') * 1350 - 675, y: finite(point?.y, path + '.y') * 900 - 450 };
};
const array = (value: unknown, path: string): unknown[] => {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(path + ': 必须为数组');
  return value;
};

/** One official keyframe, normalised to a beat and a value. */
interface OfficialFrame {
  time: number;
  value: number;
  ease: number;
  anchor?: NoisePoint;
}

/** How one official track reads its value out of a keyframe. */
interface FrameReader {
  /** The axis suffix some tracks carry on their easing field (`easeTypeX` / `easeTypeY`). */
  axis?: string;
  value(event: Record<string, unknown>, eventPath: string): number;
}

function frames(source: Record<string, unknown>, type: string, read: FrameReader, path: string, anchored: boolean): OfficialFrame[] {
  return array(source[type], path + '.' + type).map((raw, index) => {
    // Every field below is probed before use, which is why the keyframe is viewed as an open record.
    const event = raw as Record<string, unknown> | null | undefined;
    const eventPath = `${path}.${type}[${index}]`;
    const ease = (event?.easeType ?? (read.axis ? event?.['easeType' + read.axis] : undefined) ?? 0) as number;
    if (!Number.isInteger(ease) || ease < 0 || ease > 14) throw new Error(eventPath + ': 官谱缓动编号须在 0–14 内');
    return { time: finite(event?.time, eventPath + '.time'), value: read.value(event as Record<string, unknown>, eventPath), ease,
      ...(anchored ? { anchor: position(event?.anchor, eventPath + '.anchor') } : {}) };
  }).sort((first, second) => first.time - second.time);
}

/** A run of official keyframes sharing one time, kept so only the last of the run is read. */
interface KeyframeGroup { time: number; first: OfficialFrame; last: OfficialFrame }

function convertTrack(keyframes: OfficialFrame[], beat: (seconds: number) => Beat, preserveInstant = false): NoiseEvent[] {
  if (preserveInstant) {
    const events: NoiseEvent[] = [];
    const append = (start: number, end: number, startTime: number, endTime: number, anchor: NoisePoint | undefined, easingType = 1, metadata: Record<string, unknown> = {}): NoiseEvent => {
      const event = createNoiseEvent(start, end, 0, 0, anchor);
      event.startTime = beat(startTime); event.endTime = beat(endTime); event.easingType = easingType;
      Object.assign(event, metadata); events.push(event); return event;
    };
    for (let index = 1; index < keyframes.length; index++) {
      const previous = keyframes[index - 1]; const current = keyframes[index];
      if (current.time === previous.time) {
        append(current.value, current.value, current.time, current.time, previous.anchor ?? current.anchor, 1,
          { transformStart: previous.value, transformEnd: current.value, transformStep: true });
      } else if (previous.ease === 13 || previous.ease === 14) {
        const value = previous.ease === 13 ? previous.value : current.value;
        append(value, value, previous.time, current.time, previous.anchor, 1,
          { transformStart: previous.value, transformEnd: current.value });
      } else if (previous.ease === 12 && previous.value !== current.value) {
        const middleTime = (previous.time + current.time) / 2; const middleValue = (previous.value + current.value) / 2;
        append(previous.value, middleValue, previous.time, middleTime, previous.anchor, 15);
        append(middleValue, current.value, middleTime, current.time, previous.anchor, 14,
          { transformStart: middleValue, transformEnd: current.value });
      } else append(previous.value, current.value, previous.time, current.time, previous.anchor, easingTypes[previous.ease] ?? 1);
    }
    const final = keyframes.at(-1);
    // The second-to-last keyframe is only read once the length check above has established it exists;
    // `?.` keeps that read total without changing which branch is taken.
    if (final) append(final.value, final.value, final.time, final.time, final.anchor, 1,
      keyframes.length > 1 && keyframes.at(-2)?.time === final.time ? { transformStep: true } : {});
    return events;
  }
  const groups: KeyframeGroup[] = [];
  for (const frame of keyframes) {
    const group = groups.at(-1);
    if (group && group.time === frame.time) group.last = frame;
    else groups.push({ time: frame.time, first: frame, last: frame });
  }
  const events: NoiseEvent[] = [];
  const append = (start: number, end: number, startTime: number, endTime: number, anchor: NoisePoint | undefined, easingType = 1): NoiseEvent => {
    const event = createNoiseEvent(start, end, 0, 0, anchor);
    event.startTime = beat(startTime); event.endTime = beat(endTime); event.easingType = easingType;
    events.push(event); return event;
  };
  for (let index = 1; index < groups.length; index++) {
    const previous = groups[index - 1]; const current = groups[index];
    const { value: start, ease, anchor } = previous.last; const { value: end } = current.first;
    if (ease === 13 || ease === 14) {
      const event = append(ease === 13 ? start : end, ease === 13 ? start : end, previous.time, current.time, anchor);
      if (anchor && start !== end) { event.transformStart = start; event.transformEnd = end; }
    }
    else if (ease === 12 && start !== end) {
      const middleTime = (previous.time + current.time) / 2; const middleValue = (start + end) / 2;
      append(start, middleValue, previous.time, middleTime, anchor, 15);
      append(middleValue, end, middleTime, current.time, anchor, 14);
    } else append(start, end, previous.time, current.time, anchor, easingTypes[ease] ?? 1);
  }
  const final = groups.at(-1)?.last;
  if (final) append(final.value, final.value, final.time, final.time, final.anchor);
  return events;
}

/**
 * Converts the official chart format's 噪域 list into this editor's own areas.
 *
 * The official format stores percentages and absolute seconds, so every time is converted through
 * `bpm`/`offset` here and every coordinate through the 1350x900 stage. The three transform tracks use
 * the official easing codes, which are remapped by `easingTypes`; the two "instant" codes (13/14) and
 * the "middle" code (12) split into extra events instead of mapping onto one.
 */
export function convertOfficialNoiseAreas(source: unknown, bpm: number, offset = 0): NoiseArea[] {
  finite(bpm, '官谱 BPM'); if (bpm <= 0) throw new Error('官谱 BPM 必须大于零');
  finite(offset, 'offset');
  const beat = (seconds: number): Beat => fromNumber((seconds - offset) * bpm / 60, 1000000000);
  const areas = array(source, 'blockAreaList').map((raw, index) => {
    const path = `blockAreaList[${index}]`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(path + ': 无效噪域');
    // Each field below is read through this record view and validated as it is used, which is what the
    // original's untyped property reads did implicitly.
    const entry = raw as Record<string, unknown>;
    const area = createNoiseArea();
    area.bottomLeft = position(entry.bottomLeftPercentage, path + '.bottomLeftPercentage');
    area.topRight = position(entry.topRightPercentage, path + '.topRightPercentage');
    for (const field of ['appearTime', 'disappearTime'] as const) area[field] = beat(finite(entry[field], path + '.' + field));
    const enable = finite(entry.enableTime, path + '.enableTime'); const disable = finite(entry.disableTime, path + '.disableTime');
    if (enable > disable) throw new Error(path + ': enableTime 不能晚于 disableTime');
    area.activeIntervals = [{ startTime: beat(enable), endTime: beat(disable), readyFlash: 0.5 }];
    if (entry.isSubtract != null && typeof entry.isSubtract !== 'boolean') throw new Error(path + '.isSubtract: 必须为布尔值');
    area.isInvert = entry.isSubtract === true;
    area.Name = typeof entry.Name === 'string' ? entry.Name : '';
    const center = noiseCenter(area);
    for (const axis of ['x', 'y'] as const) {
      const suffix = axis.toUpperCase();
      area['move' + suffix + 'Events'] = convertTrack(frames(entry, 'moveEvents', { axis: suffix, value: (event, eventPath) => position(event?.endPosition, eventPath + '.endPosition')[axis] }, path, false), beat);
      area['scale' + suffix + 'Events'] = convertTrack(frames(entry, 'scaleEvents', { axis: suffix, value: (event, eventPath) => finite((event?.scale as Record<string, unknown> | undefined)?.[axis], eventPath + '.scale.' + axis) }, path, true), beat, true);
    }
    area.rotateEvents = convertTrack(frames(entry, 'rotateEvents', { value: (event, eventPath) => -finite(event?.rotation, eventPath + '.rotation') }, path, true), beat, true);
    if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) throw new Error(path + ': 初始矩形坐标超出范围');
    return area;
  });
  return validateNoiseAreas(areas);
}
