import { beatValue, fromNumber } from './beat.ts';
import { SHADER_NAMES, shaderIdentity, shaderLine } from './shader.ts';
import type { ShaderEffectRecord } from './shader.ts';
import type { Beat, Chart, ChartEvent } from './types.ts';
export { shaderIdentity, shaderLine } from './shader.ts';

/**
 * Shader events projected per judge line, cached per chart document and then per line index.
 *
 * The lists themselves come out of untrusted chart fields, so entries are narrowed on the way in
 * (see {@link isChartEvent}) and the projection adds the beat range every consumer reads.
 */
const cache = new WeakMap<Chart, Map<number, ChartEvent[]>>();

/** Where one effect sits in the timeline's stacked lane layout, and how many lanes it shares. */
export interface ShaderLanePlacement {
  lane: number;
  count: number;
}

/**
 * The least an effect has to expose to be laid out in lanes: its beat range.
 *
 * Deliberately not `ChartEvent`: lane layout also runs over the loose records charts keep in their
 * effect lists, whose base-format fields (easing, links, …) may be missing entirely.
 */
export interface ShaderLaneEvent {
  startTime?: unknown;
  endTime?: unknown;
}

export function shaderEventLanes(events: readonly ShaderLaneEvent[]): Map<number, ShaderLanePlacement> {
  const layout = new Map<number, ShaderLanePlacement>();
  let group: { index: number; lane: number }[] = []; let lanes: number[] = []; let groupEnd = -Infinity;
  const finish = () => { for (const entry of group) layout.set(entry.index, { lane: entry.lane, count: lanes.length }); };
  const ordered = events.map((event, index) => ({ index, start: beatValue(event.startTime), end: beatValue(event.endTime) })).sort((left, right) => left.start - right.start || left.index - right.index);
  for (const entry of ordered) {
    if (entry.start >= groupEnd) { finish(); group = []; lanes = []; groupEnd = -Infinity; }
    let lane: number = lanes.findIndex(end => end <= entry.start);
    if (lane < 0) lane = lanes.length;
    lanes[lane] = entry.end; group.push({ index: entry.index, lane }); groupEnd = Math.max(groupEnd, entry.end);
  }
  finish(); return layout;
}

/** The shader type fields an effect stores: the shader path (or name) and whether it is a copy. */
export interface ShaderTypeFields {
  shader: string;
  clone: boolean;
}

export function shaderTypeFields(name: string): ShaderTypeFields {
  const index = SHADER_NAMES.indexOf(name);
  const base = index >= 10 && index < 20 ? SHADER_NAMES[index - 10] : name;
  const shader = index >= 20 ? `/${base}_pr.glsl` : base.replace(/_(\w)/g, (match: string, letter: string) => letter.toUpperCase());
  return { shader, clone: index >= 10 && index < 20 };
}

/** Reads an effect's beat range: charts store either a beat triple or a plain beat number. */
function eventBeat(value: unknown): Beat {
  if (Array.isArray(value)) {
    // An already-stored triple is passed through untouched, exactly as before; `beatValue` is what
    // validates it, at the call sites that need a number.
    const beat: Beat = value as Beat;
    return beat;
  }
  return fromNumber(Number(value) || 0);
}

/**
 * Narrows one entry of a chart's effect lists to an event.
 *
 * `effects` / `shaderEvents` / `META.effects` are not covered by `assertChart`, so their entries
 * arrive as `unknown`. The editor addresses them through the base-format event shape — that is what
 * this claims — and non-objects are dropped, exactly as the original object check did.
 */
function isChartEvent(value: unknown): value is ChartEvent {
  return Boolean(value) && typeof value === 'object';
}

export function shaderEvents(chart: Chart, lineIndex: number): ChartEvent[] {
  if (!cache.has(chart)) cache.set(chart, new Map());
  const lines = cache.get(chart)!;
  if (!lines.has(lineIndex)) {
    const roots: unknown[] = [chart.effects, chart.shaderEvents, chart.META?.effects].filter(Array.isArray).flat();
    const effects: ChartEvent[] = [...roots.filter(isChartEvent).filter(event => shaderLine(event, chart) === lineIndex), ...(chart.judgeLineList?.[lineIndex]?.extended?.paintEvents ?? [])];
    lines.set(lineIndex, effects.map(event => ({ ...event,
      startTime: eventBeat(event.startTime ?? event.start), endTime: eventBeat(event.endTime ?? event.end),
    })));
  }
  return lines.get(lineIndex)!;
}

export function serializeShaderEvent(event: ChartEvent, lineIndex: number): ShaderEffectRecord {
  const { startTime, endTime, ...effect } = event;
  return { ...effect, ...(event.shader ? {} : shaderTypeFields(shaderIdentity(event))), line: lineIndex, start: startTime, end: endTime };
}

export function replaceShaderEvents(chart: Chart, lineIndex: number, events: ChartEvent[]): Chart {
  for (const event of events) {
    if (beatValue(event.endTime) < beatValue(event.startTime)) throw new Error('着色器结束拍不能早于开始拍');
  }
  const keep = (values: unknown): unknown[] => {
    // An effect list is an untrusted chart field: nullish means empty and anything else is used as
    // the array `.filter` always assumed (a non-array throws here, exactly as before).
    const list: unknown[] = values === undefined || values === null ? [] : values as unknown[];
    return list.filter(event => !isChartEvent(event) || shaderLine(event, chart) !== lineIndex);
  };
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

export function remapShaderLines(chart: Chart, next: Chart, destinations: Map<number, number>, duplicate: number = -1): Chart {
  const remap = (effects: unknown[]): unknown[] => effects.flatMap(event => {
    if (!isChartEvent(event)) return [event];
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

/**
 * One segment of a shader parameter track: the beat range it covers, the values it eases between
 * and its easing. The payloads stay `unknown` because a parameter may be a scalar, a vector or a
 * texture reference; the extra index signature is what lets the inspector address fields by name.
 */
export interface ShaderParameterSegment {
  startTime?: unknown;
  endTime?: unknown;
  start?: unknown;
  end?: unknown;
  easingType?: number;
  [key: string]: unknown;
}

/** A shader parameter track: every segment of one uniform, in chart order. */
export type ShaderParameterTrack = ShaderParameterSegment[];

/** What {@link shaderParameterTrack} reads off an effect. */
export interface ShaderParameterSource {
  startTime?: unknown;
  endTime?: unknown;
  vars?: unknown;
}

export function shaderParameterTrack(event: ShaderParameterSource, name: string, fallback: unknown = 0): ShaderParameterTrack {
  // `vars` is untrusted chart data, so the read is funnelled through one narrowing: a non-object bag
  // simply has no such key, which is the `undefined` the original optional chain produced.
  const vars: unknown = event.vars;
  const bag: Record<string, unknown> = vars === undefined || vars === null ? {} : vars as Record<string, unknown>;
  const value = bag[name] ?? fallback;
  if (Array.isArray(value) && value[0] && typeof value[0] === 'object') {
    const track: ShaderParameterTrack = value;
    return track;
  }
  return [{ startTime: event.startTime, endTime: event.endTime, start: structuredClone(value), end: structuredClone(value), easingType: 1 }];
}

export function alignShaderTrack(track: ShaderParameterTrack, beat: Beat): ShaderParameterTrack {
  if (!track.length) return track;
  const delta = beatValue(beat) - Math.min(...track.map(segment => beatValue(segment.startTime)));
  return track.map(segment => ({ ...segment, startTime: fromNumber(beatValue(segment.startTime) + delta), endTime: fromNumber(beatValue(segment.endTime) + delta) }));
}

export function alignShaderParameters(event: ChartEvent): ChartEvent {
  // `Object.entries` accepts anything object-like and the nullish case falls back to an empty bag,
  // which is exactly what the original `event.vars ?? {}` expression passed in.
  const entries: [string, unknown][] = Object.entries((event.vars ?? {}) as object);
  const vars: [string, unknown][] = entries.map(([name, value]) => [name,
    Array.isArray(value) && value[0] && typeof value[0] === 'object' ? alignShaderTrack(value, event.startTime) : value,
  ]);
  return { ...event, vars: Object.fromEntries(vars) };
}

/** One `uniform` a GLSL source declares, with the default parsed from its trailing comment. */
export interface ShaderParameterDefinition {
  name: string;
  type: string;
  dimensions: number;
  /** A single number when `dimensions` is 1, otherwise the vector's components. */
  value: number | number[];
}

export function shaderParameters(source: string): ShaderParameterDefinition[] {
  return [...source.matchAll(/uniform\s+(float|int|bool|vec[234])\s+(\w+)\s*;([^\r\n]*)/g)]
    .filter(([, , name]) => !['resolution', 'screenSize', 'time', 'u_time'].includes(name))
    .map(([, type, name, comment]) => {
      const dimensions = type.startsWith('vec') ? Number(type.at(-1)) : 1;
      const values = comment.match(/%([^%]+)%/)?.[1].split(',').map(Number);
      const fallback: number[] = values?.length === dimensions && values.every(Number.isFinite) ? values : Array(dimensions).fill(0);
      return { name, type, dimensions, value: dimensions === 1 ? fallback[0] : fallback };
    });
}

export function parseShaderValue(text: string, dimensions: number): number | number[] {
  const parts = String(text).split(',').map(part => part.trim());
  const values = parts.map(Number);
  if (parts.some(part => !part) || values.length !== dimensions || !values.every(Number.isFinite)) throw new Error(`请输入 ${dimensions} 个有限数字，多个分量用逗号分隔`);
  return dimensions === 1 ? values[0] : values;
}
