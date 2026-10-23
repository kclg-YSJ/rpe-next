import { beatValue } from './beat.mjs';
import { t } from '../i18n.mjs';

export const COLLAB_PROTOCOL = 1;
export const COLLAB_ID = '_rpeCollabId';
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export function shareChartReferences(before, after) {
  if (before === after || !before || !after || typeof before !== 'object' || typeof after !== 'object' || Array.isArray(before) !== Array.isArray(after)) return after;
  if (Array.isArray(after)) {
    const identities = new Map(Array.isArray(before) ? before.filter(item => item?.[COLLAB_ID]).map(item => [item[COLLAB_ID], item]) : []);
    const result = after.map((item, index) => shareChartReferences(item?.[COLLAB_ID] ? identities.get(item[COLLAB_ID]) : before[index], item));
    return before.length === result.length && result.every((item, index) => item === before[index]) ? before : result;
  }
  const keys = Object.keys(after); const result = {};
  for (const key of keys) result[key] = shareChartReferences(before[key], after[key]);
  return keys.length === Object.keys(before).length && keys.every(key => result[key] === before[key]) ? before : result;
}

export function validateData(value, depth = 0) {
  if (depth > 48) throw new Error(t('collaboration.s158de46'));
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(t('collaboration.s223212a'));
  if (value && typeof value === 'object') for (const [key, entry] of Object.entries(value)) {
    if (forbidden.has(key)) throw new Error(t('collaboration.s26e2810'));
    validateData(entry, depth + 1);
  }
}

export function identifyChart(chart) {
  const result = structuredClone(chart); const seen = new Set();
  const visit = (value, key = '') => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      const objects = key === 'judgeLineList' || key === 'notes' || key.endsWith('Events') || key === 'effects';
      for (const entry of value) {
        if (objects && plain(entry)) {
          if (typeof entry[COLLAB_ID] !== 'string' || seen.has(entry[COLLAB_ID])) entry[COLLAB_ID] = crypto.randomUUID();
          seen.add(entry[COLLAB_ID]);
        }
        visit(entry);
      }
    } else for (const [child, entry] of Object.entries(value)) visit(entry, child);
  };
  validateData(result); visit(result); return shareChartReferences(chart, result);
}

export function validateIdentities(chart) {
  const seen = new Set();
  const visit = (value, key = '') => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      const objects = key === 'judgeLineList' || key === 'notes' || key.endsWith('Events') || key === 'effects';
      for (const entry of value) {
        if (objects && plain(entry)) {
          const id = entry[COLLAB_ID];
          if (typeof id !== 'string' || id.length > 100 || !id.length || seen.has(id)) throw new Error(t('collaboration.se76e5c5'));
          seen.add(id);
        }
        visit(entry);
      }
    } else for (const [child, entry] of Object.entries(value)) visit(entry, child);
  };
  visit(chart);
}

export function validateNewEventOverlaps(before, after) {
  const previousLines = new Map((before.judgeLineList ?? []).map(line => [line[COLLAB_ID], line]));
  for (const line of after.judgeLineList ?? []) {
    const previous = previousLines.get(line[COLLAB_ID]);
    const layers = [...(line.eventLayers ?? []), line.extended ?? {}];
    for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
      const oldLayer = layerIndex === layers.length - 1 ? previous?.extended : previous?.eventLayers?.[layerIndex];
      for (const [type, events] of Object.entries(layers[layerIndex] ?? {})) {
        if (!type.endsWith('Events') || type === 'paintEvents' || !Array.isArray(events)) continue;
        const old = new Map((oldLayer?.[type] ?? []).map(event => [event[COLLAB_ID], event]));
        for (const event of events) {
          const previousEvent = old.get(event[COLLAB_ID]);
          if (previousEvent && equal(previousEvent.startTime, event.startTime) && equal(previousEvent.endTime, event.endTime)) continue;
          const overlaps = (first, second) => first && second && Math.max(beatValue(first.startTime), beatValue(second.startTime)) < Math.min(beatValue(first.endTime), beatValue(second.endTime)) - 1e-9;
          if (events.some(other => other !== event && overlaps(event, other) && !overlaps(previousEvent, old.get(other[COLLAB_ID])))) throw new Error(t('collaboration.s3af8b83'));
        }
      }
    }
  }
}

export function chartChanges(before, after, path = [], result = []) {
  if (before === after || equal(before, after)) return result;
  if (Array.isArray(before) && Array.isArray(after) && [...before, ...after].every(item => plain(item) && item[COLLAB_ID])) {
    const old = new Map(before.map(item => [item[COLLAB_ID], item])); const next = new Map(after.map(item => [item[COLLAB_ID], item]));
    const commonBefore = before.filter(item => next.has(item[COLLAB_ID])).map(item => item[COLLAB_ID]);
    const commonAfter = after.filter(item => old.has(item[COLLAB_ID])).map(item => item[COLLAB_ID]);
    if (!equal(commonBefore, commonAfter)) result.push({ path, before, after });
    else for (const id of new Set([...old.keys(), ...next.keys()])) {
      const previous = old.get(id); const current = next.get(id);
      if (previous && current && path.at(-1) === 'judgeLineList') chartChanges(previous, current, [...path, { id }], result);
      else if (!equal(previous, current)) result.push({ path: [...path, { id }], ...(previous === undefined ? {} : { before: previous }), ...(current === undefined ? {} : { after: current }) });
    }
  } else if (plain(before) && plain(after)) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (key === 'numOfNotes') continue;
      if (key === 'judgeLineList' || path.length === 0 || key === 'eventLayers' || key === 'extended' || key === 'notes' || key.endsWith('Events')) chartChanges(before[key], after[key], [...path, key], result);
      else if (!equal(before[key], after[key])) result.push({ path: [...path, key], ...(before[key] === undefined ? {} : { before: before[key] }), ...(after[key] === undefined ? {} : { after: after[key] }) });
    }
  } else if (Array.isArray(before) && Array.isArray(after) && path.at(-1) === 'eventLayers' && before.length === after.length) {
    before.forEach((item, index) => chartChanges(item, after[index], [...path, index], result));
  } else result.push({ path, ...(before === undefined ? {} : { before }), ...(after === undefined ? {} : { after }) });
  return result;
}

export function changeResources(change) {
  const ids = change.path.filter(plain).map(segment => segment.id);
  const collect = value => {
    if (!value || typeof value !== 'object') return;
    if (value[COLLAB_ID]) ids.push(value[COLLAB_ID]);
    for (const item of Object.values(value)) collect(item);
  };
  if (change.after === undefined || !ids.length || Array.isArray(change.before)) collect(change.before);
  return [...new Set(ids)];
}

export function applyChanges(chart, changes) {
  if (!Array.isArray(changes) || changes.length > 50000) throw new Error(t('collaboration.sd168e70'));
  validateData(changes);
  const result = structuredClone(chart);
  for (const change of changes) {
    if (!Array.isArray(change.path) || !change.path.length || change.path.length > 16) throw new Error(t('collaboration.s8806cab'));
    if (change.path.some(segment => plain(segment) ? typeof segment.id !== 'string' : typeof segment !== 'string' && (!Number.isInteger(segment) || segment < 0) || forbidden.has(segment) || segment === COLLAB_ID)) throw new Error(t('collaboration.s8806cab'));
    let parent = result;
    for (const segment of change.path.slice(0, -1)) {
      if (plain(segment)) parent = Array.isArray(parent) ? parent.find(item => item?.[COLLAB_ID] === segment.id) : undefined;
      else parent = parent?.[segment];
      if (!parent || typeof parent !== 'object') throw new Error(t('collaboration.sf62c604'));
    }
    const last = change.path.at(-1);
    const keyed = plain(last);
    if (keyed && change.after !== undefined && change.after?.[COLLAB_ID] !== last.id) throw new Error(t('collaboration.sfc1bcff'));
    if (keyed && !Array.isArray(parent)) throw new Error(t('collaboration.sfbc947e'));
    const key = keyed ? parent.findIndex(item => item?.[COLLAB_ID] === last.id) : last;
    const current = keyed && key < 0 ? undefined : parent[key];
    if (!equal(current, change.before)) throw new Error(t('collaboration.sb37cdaf'));
    if (change.after === undefined) { if (keyed) parent.splice(key, 1); else delete parent[key]; }
    else if (keyed && key < 0) parent.push(structuredClone(change.after));
    else parent[key] = structuredClone(change.after);
  }
  for (const line of result.judgeLineList ?? []) line.numOfNotes = line.notes?.length ?? 0;
  return shareChartReferences(chart, result);
}

export const inverseChanges = changes => [...changes].reverse().map(change => ({ path: change.path, ...(change.after === undefined ? {} : { before: change.after }), ...(change.before === undefined ? {} : { after: change.before }) }));

export function cleanProfile(profile) {
  return { name: String(profile?.name ?? '').trim().slice(0, 32) || t('collaboration.s9d3c09a'), color: /^#[0-9a-f]{6}$/i.test(profile?.color) ? profile.color : '#64dba5' };
}

export function parseInvitation(source) {
  const text = String(source).trim();
  let payload;
  try {
    const encoded = text.startsWith('rpenext:') ? text.slice(8) : new URL(text).hash.slice(1).replace(/^collab=/, '');
    payload = JSON.parse(decodeURIComponent(encoded));
  } catch { throw new Error(t('collaboration.s5a1a0da')); }
  const url = new URL(payload.server);
  if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.hash || url.search) throw new Error(t('collaboration.s783afdd'));
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(payload.room) || !/^[a-zA-Z0-9_-]{24,120}$/.test(payload.token)) throw new Error(t('collaboration.s09cdce4'));
  return { server: url.href, room: payload.room, token: payload.token };
}
