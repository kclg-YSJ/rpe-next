import { fromNumber } from './beat.mjs';
import { createNoiseArea, createNoiseEvent, noiseCenter, validateNoiseAreas } from './noise-areas.mjs';

const easingTypes = [1, 5, 4, 7, 9, 8, 12, 11, 10, 13, 15, 14];
const finite = (value, path) => {
  if (!Number.isFinite(value)) throw new Error(path + ': 必须为有限数字');
  return value;
};
const position = (value, path) => ({ x: finite(value?.x, path + '.x') * 1350 - 675, y: finite(value?.y, path + '.y') * 900 - 450 });
const array = (value, path) => {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(path + ': 必须为数组');
  return value;
};

function frames(source, type, read, path, anchored) {
  return array(source[type], path + '.' + type).map((event, index) => {
    const eventPath = `${path}.${type}[${index}]`;
    const ease = event?.easeType ?? event?.['easeType' + read.axis] ?? 0;
    if (!Number.isInteger(ease) || ease < 0 || ease > 14) throw new Error(eventPath + ': 官谱缓动编号须在 0–14 内');
    return { time: finite(event?.time, eventPath + '.time'), value: read.value(event, eventPath), ease,
      ...(anchored ? { anchor: position(event?.anchor, eventPath + '.anchor') } : {}) };
  }).sort((first, second) => first.time - second.time);
}

function convertTrack(keyframes, beat, preserveInstant = false) {
  if (preserveInstant) {
    const events = [];
    const append = (start, end, startTime, endTime, anchor, easingType = 1, metadata = {}) => {
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
    if (final) append(final.value, final.value, final.time, final.time, final.anchor, 1,
      keyframes.length > 1 && keyframes.at(-2).time === final.time ? { transformStep: true } : {});
    return events;
  }
  const groups = [];
  for (const frame of keyframes) {
    const group = groups.at(-1);
    if (group?.time === frame.time) group.last = frame;
    else groups.push({ time: frame.time, first: frame, last: frame });
  }
  const events = [];
  const append = (start, end, startTime, endTime, anchor, easingType = 1) => {
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

export function convertOfficialNoiseAreas(source, bpm, offset = 0) {
  finite(bpm, '官谱 BPM'); if (bpm <= 0) throw new Error('官谱 BPM 必须大于零');
  finite(offset, 'offset');
  const beat = seconds => fromNumber((seconds - offset) * bpm / 60, 1000000000);
  const areas = array(source, 'blockAreaList').map((entry, index) => {
    const path = `blockAreaList[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(path + ': 无效噪域');
    const area = createNoiseArea();
    area.bottomLeft = position(entry.bottomLeftPercentage, path + '.bottomLeftPercentage');
    area.topRight = position(entry.topRightPercentage, path + '.topRightPercentage');
    for (const field of ['appearTime', 'disappearTime']) area[field] = beat(finite(entry[field], path + '.' + field));
    const enable = finite(entry.enableTime, path + '.enableTime'); const disable = finite(entry.disableTime, path + '.disableTime');
    if (enable > disable) throw new Error(path + ': enableTime 不能晚于 disableTime');
    area.activeIntervals = [{ startTime: beat(enable), endTime: beat(disable), readyFlash: 0.5 }];
    if (entry.isSubtract != null && typeof entry.isSubtract !== 'boolean') throw new Error(path + '.isSubtract: 必须为布尔值');
    area.isInvert = entry.isSubtract ?? false;
    area.Name = typeof entry.Name === 'string' ? entry.Name : '';
    const center = noiseCenter(area);
    for (const axis of ['x', 'y']) {
      const suffix = axis.toUpperCase();
      area['move' + suffix + 'Events'] = convertTrack(frames(entry, 'moveEvents', { axis: suffix, value: (event, eventPath) => position(event?.endPosition, eventPath + '.endPosition')[axis] }, path, false), beat);
      area['scale' + suffix + 'Events'] = convertTrack(frames(entry, 'scaleEvents', { axis: suffix, value: (event, eventPath) => finite(event?.scale?.[axis], eventPath + '.scale.' + axis) }, path, true), beat, true);
    }
    area.rotateEvents = convertTrack(frames(entry, 'rotateEvents', { value: (event, eventPath) => -finite(event?.rotation, eventPath + '.rotation') }, path, true), beat, true);
    if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) throw new Error(path + ': 初始矩形坐标超出范围');
    return area;
  });
  return validateNoiseAreas(areas);
}
