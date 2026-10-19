import { beatValue, fromNumber } from './beat.ts';
import type { Chart, ChartEvent, GlobalEventColumnData, GlobalEventTypeData, GlobalEventValue } from './types.ts';
import type { TempoMap } from './tempo.ts';

export const GLOBAL_EVENT_VERSION = 240;
const localId = /^[a-z][a-z0-9._-]{0,95}$/;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
function check(condition: unknown, message: string): asserts condition { if (!condition) throw Error('全局事件：' + message); }
const text = (value: unknown): value is string => typeof value === 'string' && Boolean(value.trim());
const valueTypes = ['number', 'text', 'boolean', 'color', 'json'] as const;
export type GlobalValueType = typeof valueTypes[number];
const isValueType = (value: unknown): value is GlobalValueType => typeof value === 'string' && (valueTypes as readonly string[]).includes(value);
export const globalColumnKey = (type: string, column: string): string => 'global_' + [...type + '/' + column].map(char => char.charCodeAt(0).toString(16).padStart(4, '0')).join('');

export interface GlobalEventSource {
  kind: 'builtin' | 'mod';
  id: string;
  name: string;
  author?: string;
  version?: string;
  [key: string]: unknown;
}

export interface GlobalColumnDefinition {
  id: string;
  name: string;
  timelineLabel?: string;
  valueType?: GlobalValueType;
  width?: number;
  defaultValue: unknown;
  overlap: boolean;
  min?: number;
  max?: number;
  step?: number;
  formatValue?: (value: unknown) => string;
  draw?: (context: unknown) => void;
  shortcut?: (context: unknown) => unknown;
  create?: (context: { event: GlobalEventValue; previous?: GlobalEventValue; type: GlobalEventTypeDefinition; column: GlobalColumnDefinition }) => GlobalEventValue | null;
  inspector?: (context: unknown) => void | (() => void);
  validate?: (event: GlobalEventValue) => void | boolean | string;
  [key: string]: unknown;
}

export interface GlobalColumnDefinitionInput {
  id: string;
  name: string;
  timelineLabel?: string;
  valueType?: GlobalValueType;
  width?: number;
  defaultValue?: unknown;
  overlap?: boolean;
  min?: number;
  max?: number;
  step?: number;
  [key: string]: unknown;
}

export interface GlobalEventTypeDefinition {
  id: string;
  name: string;
  description?: string;
  source: GlobalEventSource;
  persistent: boolean;
  readonly: boolean;
  width?: number;
  columns: readonly GlobalColumnDefinition[];
  inspector?: (context: unknown) => void | (() => void);
  validate?: (event: GlobalEventValue, column: GlobalColumnDefinition) => void | boolean | string;
  [key: string]: unknown;
}

export interface GlobalEventTypeDefinitionInput {
  id: string;
  name: string;
  description?: string;
  width?: number;
  persistent?: boolean;
  columns: GlobalColumnDefinitionInput[];
  [key: string]: unknown;
}

export interface GlobalColumnEntry {
  type: GlobalEventTypeDefinition;
  column: GlobalColumnDefinition;
  key: string;
  events: GlobalEventValue[];
}

export interface GlobalColumnValidation {
  name: string;
  valueType?: GlobalValueType;
  min?: number;
  max?: number;
  validate?: (event: GlobalEventValue) => void | boolean | string;
}

export interface PlacedGlobalEventType {
  readonly: boolean;
}

export interface PlacedGlobalEventColumn extends GlobalColumnValidation {
  defaultValue: unknown;
  overlap: boolean;
  create?: { bivariant(context: unknown): GlobalEventValue | null }['bivariant'];
}

function globalEventSource(value: unknown, message: string): GlobalEventSource {
  check(record(value) && (value.kind === 'builtin' || value.kind === 'mod') && typeof value.id === 'string' && localId.test(value.id) && text(value.name), message);
  if (value.kind === 'mod') check(text(value.author) && text(value.version), '模组来源必须包含作者与版本');
  return value as GlobalEventSource;
}

export function validateGlobalEvent(event: unknown, path = '事件'): unknown {
  check(record(event), path + '必须是对象');
  check(Object.hasOwn(event, 'start') && Object.hasOwn(event, 'end'), path + '缺少首尾值');
  const start = beatValue(event.startTime, path + '.startTime'), end = beatValue(event.endTime, path + '.endTime');
  check(end >= start, path + '结束拍不能早于开始拍');
  const inspect = (value: unknown, parents = new Set<unknown>()): void => {
    check(value === null || ['string', 'boolean', 'number', 'object'].includes(typeof value), path + '只能包含 JSON 数据');
    if (typeof value === 'number') check(Number.isFinite(value), path + '不能包含非有限数字');
    if (!value || typeof value !== 'object') return;
    check(!parents.has(value), path + '不能包含循环引用'); parents.add(value);
    const prototype: unknown = Object.getPrototypeOf(value);
    check(Array.isArray(value) || prototype === Object.prototype || prototype === null, path + '只能包含普通 JSON 对象');
    for (const item of Object.values(value as Record<string, unknown>)) inspect(item, parents); parents.delete(value);
  };
  inspect(event);
  const easingType = event.easingType;
  if (easingType !== undefined) check(typeof easingType === 'number' && Number.isInteger(easingType) && easingType >= 1 && easingType <= 29, path + '缓动编号应为 1–29');
  for (const key of ['easingLeft', 'easingRight'] as const) {
    const value = event[key];
    if (value !== undefined) check(typeof value === 'number' && Number.isFinite(value), path + '.' + key + '必须为有限数字');
  }
  if (event.bezier) {
    check(Array.isArray(event.bezierPoints), path + 'Bezier 控制点无效');
    const points: unknown[] = event.bezierPoints;
    check(points.length === 4 && points.every(point => typeof point === 'number' && Number.isFinite(point)), path + 'Bezier 控制点无效');
  }
  return event;
}

export function validateGlobalEvents(chart: unknown): void {
  check(record(chart), '谱面必须是对象');
  const data = chart.globalEvents; if (data === undefined) return;
  check(record(data), 'globalEvents 需要 version:1 和 types 对象');
  const version = data.version;
  const types = data.types;
  check(version === 1 && record(types), 'globalEvents 需要 version:1 和 types 对象');
  for (const [id, rawType] of Object.entries(types)) {
    check(record(rawType) && text(rawType.name) && record(rawType.source) && record(rawType.columns), id + '缺少名称、来源或列');
    const type = rawType as GlobalEventTypeData;
    const source = type.source;
    check((source.kind === 'builtin' || source.kind === 'mod') && text(source.id) && text(source.name), id + '来源无效');
    check(id.startsWith((source.kind === 'builtin' ? 'rpen' : source.id) + '/') && localId.test(id.split('/')[1] ?? '') && id.split('/').length === 2, id + '命名空间与来源不一致');
    if (source.kind === 'mod') check(text(source.author) && text(source.version), id + '必须标识模组名、作者及版本');
    for (const [key, column] of Object.entries(type.columns)) {
      check(localId.test(key) && record(column) && text(column.name) && Array.isArray(column.events), id + '/' + key + '列无效');
      const entry = column as GlobalEventColumnData;
      entry.events.forEach((event, index) => validateGlobalEvent(event, id + '/' + key + '[' + index + ']'));
    }
  }
}

export class GlobalEventRegistry extends EventTarget {
  types: Map<string, GlobalEventTypeDefinition>;
  revision: number;

  constructor() { super(); this.types = new Map(); this.revision = 0; }

  register(definition: unknown, owner: unknown = { kind: 'builtin', id: 'rpen', name: 'RPE Next' }): () => void {
    const source = globalEventSource(owner, '类型来源无效');
    check(record(definition), '类型无效');
    const definitionId = definition.id;
    check(typeof definitionId === 'string' && localId.test(definitionId), '类型 id 应为小写字母开头的本地标识');
    const definitionName = definition.name;
    check(text(definitionName), '类型需要名称');
    const definitionWidth = definition.width;
    if (definitionWidth !== undefined) check(typeof definitionWidth === 'number' && Number.isFinite(definitionWidth) && definitionWidth >= 24 && definitionWidth <= 2048, '列宽需要在 24–2048 像素之间');
    const definitionColumns = definition.columns;
    check(Array.isArray(definitionColumns) && definitionColumns.length > 0, '类型至少需要一列');
    const id = (source.kind === 'mod' ? source.id : 'rpen') + '/' + definitionId;
    check(!this.types.has(id), '重复类型：' + id);
    const seen = new Set<string>();
    const columns = (definitionColumns as unknown[]).map((column): GlobalColumnDefinition => {
      check(record(column), '列 id 无效或重复');
      const columnId = column.id;
      check(typeof columnId === 'string' && localId.test(columnId) && !seen.has(columnId), '列 id 无效或重复'); seen.add(columnId);
      const columnName = column.name;
      check(text(columnName), '列需要名称');
      const timelineLabel = column.timelineLabel;
      if (timelineLabel !== undefined) check(text(timelineLabel), '时间轴短标题需要非空文字');
      const rawValueType = column.valueType ?? 'number';
      check(isValueType(rawValueType), '未知值类型：' + rawValueType);
      const valueType = rawValueType;
      const columnWidth = column.width;
      if (columnWidth !== undefined) check(typeof columnWidth === 'number' && Number.isFinite(columnWidth) && columnWidth >= 24 && columnWidth <= 2048, '列宽需要在 24–2048 像素之间');
      const fallback: Record<GlobalValueType, unknown> = { number: 0, text: '', boolean: false, color: [255, 255, 255], json: null };
      const result = {
        ...column,
        id: columnId,
        name: columnName,
        valueType,
        defaultValue: structuredClone(column.defaultValue ?? fallback[valueType]),
        overlap: Boolean(column.overlap),
      } as GlobalColumnDefinition;
      validateColumnEvent({ ...result, validate: undefined }, { startTime: [0, 0, 1], endTime: [1, 0, 1], start: result.defaultValue, end: result.defaultValue });
      for (const key of ['min', 'max', 'step'] as const) {
        const value = result[key];
        if (value !== undefined) check(typeof value === 'number' && Number.isFinite(value) && (key !== 'step' || value > 0), '列数值范围无效');
      }
      return Object.freeze(result);
    });
    const type: GlobalEventTypeDefinition = Object.freeze({ ...(definition as GlobalEventTypeDefinitionInput), id, source: Object.freeze(source), columns: Object.freeze(columns), persistent: definition.persistent !== false, readonly: false });
    this.types.set(id, type); this.changed();
    let active = true; return () => { if (!active || this.types.get(id) !== type) return; active = false; this.types.delete(id); this.changed(); };
  }

  changed(): void { this.revision++; this.dispatchEvent(new Event('change')); }

  list(chart: Chart): GlobalEventTypeDefinition[] {
    const known = [...this.types.values()];
    for (const [id, stored] of Object.entries(chart.globalEvents?.types ?? {})) if (!this.types.has(id)) known.push({
      id, name: stored.name, source: stored.source, persistent: true, readonly: true, description: '对应的事件类型尚未加载；数据会完整保留。',
      width: stored.width,
      columns: Object.entries(stored.columns).map(([columnId, column]) => ({ id: columnId, name: column.name, timelineLabel: column.timelineLabel, valueType: column.valueType ?? 'json', width: column.width, defaultValue: null, overlap: true })),
    });
    return known;
  }
}

export function validateColumnEvent(column: GlobalColumnValidation, event: GlobalEventValue): GlobalEventValue {
  validateGlobalEvent(event);
  for (const key of ['start', 'end'] as const) {
    const value = event[key];
    if (column.valueType === 'number') check(typeof value === 'number' && Number.isFinite(value), column.name + '的值需要是有限数字');
    if (column.valueType === 'text') check(typeof value === 'string', column.name + '的值需要是文字');
    if (column.valueType === 'boolean') check(typeof value === 'boolean', column.name + '的值需要是布尔值');
    if (column.valueType === 'color') {
      check(Array.isArray(value), column.name + '的值需要是 0–255 的 RGB 数组');
      const channels: unknown[] = value;
      check(channels.length === 3 && channels.every(channel => typeof channel === 'number' && Number.isFinite(channel) && channel >= 0 && channel <= 255), column.name + '的值需要是 0–255 的 RGB 数组');
    }
    if (typeof value === 'number') {
      if (column.min !== undefined) check(value >= column.min, column.name + '不能小于 ' + column.min);
      if (column.max !== undefined) check(value <= column.max, column.name + '不能大于 ' + column.max);
    }
  }
  const result = column.validate?.(event); check(result !== false && typeof result !== 'string', typeof result === 'string' ? result : column.name + '校验失败');
  return event;
}

export function placedGlobalEvent(type: PlacedGlobalEventType, column: PlacedGlobalEventColumn, events: GlobalEventValue[], first: number, second: number, easingType?: number | null, inst = false, preview = false): ChartEvent | null {
  check(!type.readonly, '请先启用提供此类型的模组');
  const start = Math.min(first, second), end = Math.max(first, second); if (end - start < 0.001) return null;
  if (!column.overlap) check(!events.some(event => start < beatValue(event.endTime) - 1e-8 && end > beatValue(event.startTime) + 1e-8), '该列已有重叠事件');
  const previous = events.filter(event => beatValue(event.endTime) <= start).sort((a, b) => beatValue(b.endTime) - beatValue(a.endTime))[0];
  const value = structuredClone(previous?.end ?? column.defaultValue);
  let event: GlobalEventValue | null = { startTime: fromNumber(start), endTime: fromNumber(end), start: value, end: structuredClone(value), easingType: easingType ?? previous?.easingType ?? 1, easingLeft: 0, easingRight: 1, bezier: 0, bezierPoints: [0, 0, 1, 1], inst: inst ? 1 : 0 };
  if (preview) return event as unknown as ChartEvent;
  if (column.create) event = column.create({ event: structuredClone(event), previous: previous && structuredClone(previous), type, column });
  if (event === null) return null; return validateColumnEvent(column, event) as unknown as ChartEvent;
}

export function registerPlaceholderGlobalEvent(registry: GlobalEventRegistry): () => void {
  return registry.register({ id: 'placeholder', name: '占位', description: '仅用于测试编辑操作，不产生效果、不保存到谱面。', persistent: false,
    columns: [{ id: 'value', name: '占位', valueType: 'number', defaultValue: 0 }] });
}

export function globalEventDensity(events: Iterable<GlobalEventValue>, tempo: TempoMap, duration: number, bins = 100): Uint32Array {
  const delta = new Int32Array(bins + 1), result = new Uint32Array(bins); const length = Math.max(0.001, duration);
  for (const event of events) {
    const start = tempo.seconds(event.startTime), end = tempo.seconds(event.endTime);
    if (end < 0 || start > length) continue;
    const first = Math.min(bins - 1, Math.max(0, Math.floor(start / length * bins))), last = Math.min(bins - 1, Math.max(first, Math.ceil(end / length * bins) - 1));
    delta[first]++; delta[last + 1]--;
  }
  let count = 0; for (let index = 0; index < bins; index++) { count += delta[index]; result[index] = count; } return result;
}
