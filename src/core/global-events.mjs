import { beatValue, fromNumber } from './beat.mjs';
import { t } from '../i18n.mjs';

export const GLOBAL_EVENT_VERSION = 240;
const localId = /^[a-z][a-z0-9._-]{0,95}$/;
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const check = (condition, message) => { if (!condition) throw Error(t('global-events.s80e6a38') + message); };
const text = value => typeof value === 'string' && Boolean(value.trim());
export const globalColumnKey = (type, column) => 'global_' + [...type + '/' + column].map(char => char.charCodeAt(0).toString(16).padStart(4, '0')).join('');

export function validateGlobalEvent(event, path = t('global-events.s550e328')) {
  check(record(event), path + t('global-events.s390e8da'));
  check(Object.hasOwn(event, 'start') && Object.hasOwn(event, 'end'), path + t('global-events.sce56947'));
  const start = beatValue(event.startTime, path + '.startTime'), end = beatValue(event.endTime, path + '.endTime');
  check(end >= start, path + t('global-events.sffce99d'));
  const inspect = (value, parents = new Set()) => {
    check(value === null || ['string', 'boolean', 'number', 'object'].includes(typeof value), path + t('global-events.s20cf8a0'));
    if (typeof value === 'number') check(Number.isFinite(value), path + t('global-events.sc51a670'));
    if (!value || typeof value !== 'object') return;
    check(!parents.has(value), path + t('global-events.s8856f4d')); parents.add(value);
    check(Array.isArray(value) || [Object.prototype, null].includes(Object.getPrototypeOf(value)), path + t('global-events.s68c582b'));
    for (const item of Object.values(value)) inspect(item, parents); parents.delete(value);
  };
  inspect(event);
  if (event.easingType !== undefined) check(Number.isInteger(event.easingType) && event.easingType >= 1 && event.easingType <= 29, path + t('global-events.sd140225'));
  for (const key of ['easingLeft', 'easingRight']) if (event[key] !== undefined) check(Number.isFinite(event[key]), path + '.' + key + t('global-events.s83da463'));
  if (event.bezier) check(Array.isArray(event.bezierPoints) && event.bezierPoints.length === 4 && event.bezierPoints.every(Number.isFinite), path + t('global-events.s0e21209'));
  return event;
}

export function validateGlobalEvents(chart) {
  const data = chart.globalEvents; if (data === undefined) return;
  check(record(data) && data.version === 1 && record(data.types), t('global-events.sf626de8'));
  for (const [id, type] of Object.entries(data.types)) {
    check(record(type) && text(type.name) && record(type.source) && record(type.columns), id + t('global-events.sa6cf3c7'));
    const source = type.source;
    check(['builtin', 'mod'].includes(source.kind) && text(source.id) && text(source.name), id + t('global-events.s36d83ce'));
    check(id.startsWith((source.kind === 'builtin' ? 'rpen' : source.id) + '/') && localId.test(id.split('/')[1]) && id.split('/').length === 2, id + t('global-events.s6de3f28'));
    if (source.kind === 'mod') check(text(source.author) && text(source.version), id + t('global-events.s5d28afc'));
    for (const [key, column] of Object.entries(type.columns)) {
      check(localId.test(key) && record(column) && text(column.name) && Array.isArray(column.events), id + '/' + key + t('global-events.s01b52fd'));
      column.events.forEach((event, index) => validateGlobalEvent(event, id + '/' + key + '[' + index + ']'));
    }
  }
}

export class GlobalEventRegistry extends EventTarget {
  constructor() { super(); this.types = new Map(); this.revision = 0; }
  register(definition, owner = { kind: 'builtin', id: 'rpen', name: 'RPE Next' }) {
    check(record(owner) && ['builtin', 'mod'].includes(owner.kind) && localId.test(owner.id) && text(owner.name), t('global-events.scb232e8'));
    if (owner.kind === 'mod') check(text(owner.author) && text(owner.version), t('global-events.s1210418'));
    check(record(definition) && localId.test(definition.id), t('global-events.s6c9e402'));
    check(text(definition.name), t('global-events.sce51c0c'));
    if (definition.width !== undefined) check(Number.isFinite(definition.width) && definition.width >= 24 && definition.width <= 2048, t('global-events.s285f53c'));
    check(Array.isArray(definition.columns) && definition.columns.length > 0, t('global-events.s33f85fe'));
    const source = structuredClone(owner), id = (source.kind === 'mod' ? source.id : 'rpen') + '/' + definition.id;
    check(!this.types.has(id), t('global-events.s3e90c25') + id);
    const seen = new Set();
    const columns = definition.columns.map(column => {
      check(record(column) && localId.test(column.id) && !seen.has(column.id), t('global-events.sd06d0d0')); seen.add(column.id);
      check(text(column.name), t('global-events.sf94e0cf'));
      if (column.timelineLabel !== undefined) check(text(column.timelineLabel), t('global-events.se39f749'));
      const valueType = column.valueType ?? 'number';
      if (column.width !== undefined) check(Number.isFinite(column.width) && column.width >= 24 && column.width <= 2048, t('global-events.s285f53c'));
      check(['number', 'text', 'boolean', 'color', 'json'].includes(valueType), t('global-events.s51d1d6d') + valueType);
      const fallback = { number: 0, text: '', boolean: false, color: [255, 255, 255], json: null }[valueType];
      const result = { ...column, valueType, defaultValue: structuredClone(column.defaultValue ?? fallback), overlap: Boolean(column.overlap) };
      validateColumnEvent({ ...result, validate: undefined }, { startTime: [0, 0, 1], endTime: [1, 0, 1], start: result.defaultValue, end: result.defaultValue });
      for (const key of ['min', 'max', 'step']) if (result[key] !== undefined) check(Number.isFinite(result[key]) && (key !== 'step' || result[key] > 0), t('global-events.sf9702bf'));
      return Object.freeze(result);
    });
    const type = Object.freeze({ ...definition, id, source: Object.freeze(source), columns: Object.freeze(columns), persistent: definition.persistent !== false, readonly: false });
    this.types.set(id, type); this.changed();
    let active = true; return () => { if (!active || this.types.get(id) !== type) return; active = false; this.types.delete(id); this.changed(); };
  }
  changed() { this.revision++; this.dispatchEvent(new Event('change')); }
  list(chart) {
    const known = [...this.types.values()];
    for (const [id, stored] of Object.entries(chart.globalEvents?.types ?? {})) if (!this.types.has(id)) known.push({
      id, name: stored.name, source: stored.source, persistent: true, readonly: true, description: t('global-events.s1d20e6d'),
      width: stored.width,
      columns: Object.entries(stored.columns).map(([id, column]) => ({ id, name: column.name, timelineLabel: column.timelineLabel, valueType: column.valueType ?? 'json', width: column.width, defaultValue: null, overlap: true })),
    });
    return known;
  }
}

export function validateColumnEvent(column, event) {
  validateGlobalEvent(event);
  for (const key of ['start', 'end']) {
    const value = event[key];
    if (column.valueType === 'number') check(Number.isFinite(value), column.name + t('global-events.sab2409a'));
    if (column.valueType === 'text') check(typeof value === 'string', column.name + t('global-events.s92b5682'));
    if (column.valueType === 'boolean') check(typeof value === 'boolean', column.name + t('global-events.sc1e04a1'));
    if (column.valueType === 'color') check(Array.isArray(value) && value.length === 3 && value.every(channel => Number.isFinite(channel) && channel >= 0 && channel <= 255), column.name + t('global-events.s09c9f81'));
    if (typeof value === 'number') {
      if (column.min !== undefined) check(value >= column.min, column.name + t('global-events.s7e48679') + column.min);
      if (column.max !== undefined) check(value <= column.max, column.name + t('global-events.s3b03799') + column.max);
    }
  }
  const result = column.validate?.(event); check(result !== false && typeof result !== 'string', typeof result === 'string' ? result : column.name + t('global-events.s2da7449'));
  return event;
}

export function placedGlobalEvent(type, column, events, first, second, easingType, inst = false, preview = false) {
  check(!type.readonly, t('global-events.s26a13c8'));
  const start = Math.min(first, second), end = Math.max(first, second); if (end - start < 0.001) return null;
  if (!column.overlap) check(!events.some(event => start < beatValue(event.endTime) - 1e-8 && end > beatValue(event.startTime) + 1e-8), t('global-events.s156277e'));
  const previous = events.filter(event => beatValue(event.endTime) <= start).sort((a, b) => beatValue(b.endTime) - beatValue(a.endTime))[0];
  const value = structuredClone(previous?.end ?? column.defaultValue);
  let event = { startTime: fromNumber(start), endTime: fromNumber(end), start: value, end: structuredClone(value), easingType: easingType ?? previous?.easingType ?? 1, easingLeft: 0, easingRight: 1, bezier: 0, bezierPoints: [0, 0, 1, 1], inst: inst ? 1 : 0 };
  if (preview) return event;
  if (column.create) event = column.create({ event: structuredClone(event), previous: previous && structuredClone(previous), type, column });
  if (event === null) return null; return validateColumnEvent(column, event);
}

export function registerPlaceholderGlobalEvent(registry) {
  return registry.register({ id: 'placeholder', name: t('global-events.sc2f9907'), description: t('global-events.saa26a8f'), persistent: false,
    columns: [{ id: 'value', name: t('global-events.sc2f9907'), valueType: 'number', defaultValue: 0 }] });
}

export function globalEventDensity(events, tempo, duration, bins = 100) {
  const delta = new Int32Array(bins + 1), result = new Uint32Array(bins); const length = Math.max(0.001, duration);
  for (const event of events) {
    const start = tempo.seconds(event.startTime), end = tempo.seconds(event.endTime);
    if (end < 0 || start > length) continue;
    const first = Math.min(bins - 1, Math.max(0, Math.floor(start / length * bins))), last = Math.min(bins - 1, Math.max(first, Math.ceil(end / length * bins) - 1));
    delta[first]++; delta[last + 1]--;
  }
  let count = 0; for (let index = 0; index < bins; index++) { count += delta[index]; result[index] = count; } return result;
}
