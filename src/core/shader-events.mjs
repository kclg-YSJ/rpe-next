import { beatValue, fromNumber } from './beat.mjs';
import { SHADER_NAMES, shaderIdentity, shaderLine } from './shader.mjs';
import { t } from '../i18n.mjs';
export { shaderIdentity, shaderLine } from './shader.mjs';

const cache = new WeakMap();

export function shaderEventLanes(events) {
  const layout = new Map();
  let group = []; let lanes = []; let groupEnd = -Infinity;
  const finish = () => { for (const entry of group) layout.set(entry.index, { lane: entry.lane, count: lanes.length }); };
  const ordered = events.map((event, index) => ({ index, start: beatValue(event.startTime), end: beatValue(event.endTime) })).sort((left, right) => left.start - right.start || left.index - right.index);
  for (const entry of ordered) {
    if (entry.start >= groupEnd) { finish(); group = []; lanes = []; groupEnd = -Infinity; }
    let lane = lanes.findIndex(end => end <= entry.start);
    if (lane < 0) lane = lanes.length;
    lanes[lane] = entry.end; group.push({ index: entry.index, lane }); groupEnd = Math.max(groupEnd, entry.end);
  }
  finish(); return layout;
}

export function shaderTypeFields(name) {
  const index = SHADER_NAMES.indexOf(name);
  const base = index >= 10 && index < 20 ? SHADER_NAMES[index - 10] : name;
  const shader = index >= 20 ? `/${base}_pr.glsl` : base.replace(/_(\w)/g, (match, letter) => letter.toUpperCase());
  return { shader, clone: index >= 10 && index < 20 };
}

function eventBeat(value) {
  return Array.isArray(value) ? value : fromNumber(Number(value) || 0);
}

export function shaderEvents(chart, lineIndex) {
  if (!cache.has(chart)) cache.set(chart, new Map());
  const lines = cache.get(chart);
  if (!lines.has(lineIndex)) {
    const roots = [chart.effects, chart.shaderEvents, chart.META?.effects].filter(Array.isArray).flat().filter(event => event && typeof event === 'object');
    const effects = [...roots.filter(event => shaderLine(event, chart) === lineIndex), ...(chart.judgeLineList?.[lineIndex]?.extended?.paintEvents ?? [])];
    lines.set(lineIndex, effects.map(event => ({ ...event,
      startTime: eventBeat(event.startTime ?? event.start), endTime: eventBeat(event.endTime ?? event.end),
    })));
  }
  return lines.get(lineIndex);
}

export function serializeShaderEvent(event, lineIndex) {
  const { startTime, endTime, ...effect } = event;
  return { ...effect, ...(event.shader ? {} : shaderTypeFields(shaderIdentity(event))), line: lineIndex, start: startTime, end: endTime };
}

export function replaceShaderEvents(chart, lineIndex, events) {
  for (const event of events) {
    if (beatValue(event.endTime) < beatValue(event.startTime)) throw new Error(t('shader-events.s2a12e0d'));
  }
  const keep = events => (events ?? []).filter(event => !event || typeof event !== 'object' || shaderLine(event, chart) !== lineIndex);
  const lines = [...chart.judgeLineList];
  if (lines[lineIndex].extended?.paintEvents) {
    const { paintEvents, ...extended } = lines[lineIndex].extended;
    lines[lineIndex] = { ...lines[lineIndex], extended };
  }
  return { ...chart, judgeLineList: lines,
    effects: [...keep(chart.effects), ...events.map(event => serializeShaderEvent(event, lineIndex))],
    ...(Array.isArray(chart.shaderEvents) ? { shaderEvents: keep(chart.shaderEvents) } : {}),
    ...(Array.isArray(chart.META?.effects) ? { META: { ...chart.META, effects: keep(chart.META.effects) } } : {}),
  };
}

export function remapShaderLines(chart, next, destinations, duplicate = -1) {
  const remap = effects => effects.flatMap(event => {
    if (!event || typeof event !== 'object') return [event];
    const owner = shaderLine(event, chart); const destination = destinations.get(owner);
    if (destination === undefined) return [];
    const result = [{ ...event, line: destination }];
    if (owner === duplicate) result.push({ ...structuredClone(event), line: next.judgeLineList.length - 1 });
    return result;
  });
  return { ...next,
    ...(Array.isArray(chart.effects) ? { effects: remap(chart.effects) } : {}),
    ...(Array.isArray(chart.shaderEvents) ? { shaderEvents: remap(chart.shaderEvents) } : {}),
    ...(Array.isArray(chart.META?.effects) ? { META: { ...next.META, effects: remap(chart.META.effects) } } : {}),
  };
}

export function shaderParameterTrack(event, name, fallback = 0) {
  const value = event.vars?.[name] ?? fallback;
  if (Array.isArray(value) && value[0] && typeof value[0] === 'object') return value;
  return [{ startTime: event.startTime, endTime: event.endTime, start: structuredClone(value), end: structuredClone(value), easingType: 1 }];
}

export function alignShaderTrack(track, beat) {
  if (!track.length) return track;
  const delta = beatValue(beat) - Math.min(...track.map(segment => beatValue(segment.startTime)));
  return track.map(segment => ({ ...segment, startTime: fromNumber(beatValue(segment.startTime) + delta), endTime: fromNumber(beatValue(segment.endTime) + delta) }));
}

export function alignShaderParameters(event) {
  return { ...event, vars: Object.fromEntries(Object.entries(event.vars ?? {}).map(([name, value]) => [name,
    Array.isArray(value) && value[0] && typeof value[0] === 'object' ? alignShaderTrack(value, event.startTime) : value,
  ])) };
}

export function shaderParameters(source) {
  return [...source.matchAll(/uniform\s+(float|int|bool|vec[234])\s+(\w+)\s*;([^\r\n]*)/g)]
    .filter(([, , name]) => !['resolution', 'screenSize', 'time', 'u_time'].includes(name))
    .map(([, type, name, comment]) => {
      const dimensions = type.startsWith('vec') ? Number(type.at(-1)) : 1;
      const values = comment.match(/%([^%]+)%/)?.[1].split(',').map(Number);
      const fallback = values?.length === dimensions && values.every(Number.isFinite) ? values : Array(dimensions).fill(0);
      return { name, type, dimensions, value: dimensions === 1 ? fallback[0] : fallback };
    });
}

export function parseShaderValue(text, dimensions) {
  const parts = String(text).split(',').map(part => part.trim());
  const values = parts.map(Number);
  if (parts.some(part => !part) || values.length !== dimensions || !values.every(Number.isFinite)) throw new Error(t('shader-events.s99fbcbb', { p0: dimensions }));
  return dimensions === 1 ? values[0] : values;
}
