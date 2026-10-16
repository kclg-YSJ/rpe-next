import { beatValue } from './beat.ts';
import type { Chart } from './types.ts';

export const COLLAB_PROTOCOL = 1;
export const COLLAB_ID = '_rpeCollabId';
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);

/**
 * Whether a value is a plain object (not `null`, not an array).
 *
 * Written as a type guard so the callers below can index the result without a cast: everything this
 * module walks is JSON, so "is a non-array object" is exactly the shape they index into.
 */
function plain(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }

/** The collaboration identity an object carries, or `undefined` when it has none. */
function collabIdOf(value: unknown): unknown { return plain(value) ? value[COLLAB_ID] : undefined; }

export const equal = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

/** One step of a change path: an object key, an array index, or an object addressed by identity. */
export type ChangeSegment = string | number | { id: unknown };

/** A single applied/reverted change to a shared document. */
export interface ChartChange {
  path: ChangeSegment[];
  before?: unknown;
  after?: unknown;
}

/**
 * Rewrites `after` so that every object it shares with `before` is the *same* object instance.
 *
 * Collaboration round-trips rebuild documents, which would otherwise break the editor's
 * identity-based caches and selection. Objects are matched by `COLLAB_ID` where present and by
 * position otherwise, and the original `before` subtree is returned whenever nothing changed, so a
 * no-op update is referentially identical.
 */
export function shareChartReferences<T>(before: unknown, after: T): T {
  if (before === after || !before || !after || typeof before !== 'object' || typeof after !== 'object' || Array.isArray(before) !== Array.isArray(after)) return after;
  if (Array.isArray(after)) {
    const source: unknown[] = Array.isArray(before) ? before : [];
    const identities = new Map<unknown, unknown>(source.filter(item => collabIdOf(item)).map(item => [collabIdOf(item), item]));
    const result = after.map((item, index) => shareChartReferences(collabIdOf(item) ? identities.get(collabIdOf(item)) : source[index], item));
    // `source` and `result` hold the same element type as `after`; the cast only re-states that the
    // unchanged-array fast path returns the original array.
    const chosen: T = source.length === result.length && result.every((item, index) => item === source[index]) ? (source as T) : (result as T);
    return chosen;
  }
  const record = after as Record<string, unknown>;
  const previous = before as Record<string, unknown>;
  const keys = Object.keys(record); const result: Record<string, unknown> = {};
  for (const key of keys) result[key] = shareChartReferences(previous[key], record[key]);
  const chosen: T = keys.length === Object.keys(previous).length && keys.every(key => result[key] === previous[key]) ? (before as T) : (result as T);
  return chosen;
}

/** Rejects non-finite numbers, prototype-polluting keys and over-deep nesting in wire data. */
export function validateData(value: unknown, depth = 0): void {
  if (depth > 48) throw new Error('联机数据嵌套过深');
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('联机数据包含非法数字');
  if (value && typeof value === 'object') for (const [key, entry] of Object.entries(value)) {
    if (forbidden.has(key)) throw new Error('非法字段');
    validateData(entry, depth + 1);
  }
}

/**
 * Stamps a stable `COLLAB_ID` on every identifiable object in a deep copy of `chart`.
 *
 * Only the collections that collaboration treats as addressable are stamped — lines, notes, event
 * tracks and effects — and existing valid unique ids are preserved so a document can be re-identified
 * without churning every identity.
 */
export function identifyChart<T>(chart: T): T {
  const result = structuredClone(chart); const seen = new Set<unknown>();
  const visit = (value: unknown, key = ''): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      const items: unknown[] = value;
      const objects = key === 'judgeLineList' || key === 'notes' || key.endsWith('Events') || key === 'effects';
      for (const entry of items) {
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

/** Verifies every identifiable object carries a unique, bounded id; throws otherwise. */
export function validateIdentities(chart: unknown): void {
  const seen = new Set<unknown>();
  const visit = (value: unknown, key = ''): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      const items: unknown[] = value;
      const objects = key === 'judgeLineList' || key === 'notes' || key.endsWith('Events') || key === 'effects';
      for (const entry of items) {
        if (objects && plain(entry)) {
          const id = entry[COLLAB_ID];
          if (typeof id !== 'string' || id.length > 100 || !id.length || seen.has(id)) throw new Error('物件标识缺失或重复');
          seen.add(id);
        }
        visit(entry);
      }
    } else for (const [child, entry] of Object.entries(value)) visit(entry, child);
  };
  visit(chart);
}

/**
 * Rejects a change that would make a newly-moved event overlap a neighbour it did not overlap before.
 *
 * Events that kept their times are exempt, which is what lets a document be re-sent wholesale without
 * tripping the check; only genuinely new overlaps are refused.
 */
export function validateNewEventOverlaps(before: Chart, after: Chart): void {
  const previousLines = new Map<unknown, unknown>((before.judgeLineList ?? []).map(line => [collabIdOf(line), line]));
  for (const line of after.judgeLineList ?? []) {
    const previous = previousLines.get(collabIdOf(line));
    const previousRecord = plain(previous) ? previous : undefined;
    const layers: unknown[] = [...((line as unknown as Record<string, unknown>).eventLayers as unknown[] ?? []), (line as unknown as Record<string, unknown>).extended ?? {}];
    for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
      const oldLayer = plain(previousRecord) ? (layerIndex === layers.length - 1 ? previousRecord.extended : (previousRecord.eventLayers as unknown[] | undefined)?.[layerIndex]) : undefined;
      const oldRecord = plain(oldLayer) ? oldLayer : undefined;
      const layer = layers[layerIndex];
      const current: Record<string, unknown> = plain(layer) ? layer : {};
      for (const [type, events] of Object.entries(current)) {
        if (!type.endsWith('Events') || type === 'paintEvents' || !Array.isArray(events)) continue;
        const track: unknown[] = events;
        const old = new Map<unknown, unknown>(((oldRecord?.[type] as unknown[] | undefined) ?? []).map(event => [collabIdOf(event), event]));
        for (const event of track) {
          const previousEvent = old.get(collabIdOf(event));
          const eventRecord = plain(event) ? event : undefined;
          const previousRecordEvent = plain(previousEvent) ? previousEvent : undefined;
          if (previousRecordEvent && equal(previousRecordEvent.startTime, eventRecord?.startTime) && equal(previousRecordEvent.endTime, eventRecord?.endTime)) continue;
          const overlaps = (first: Record<string, unknown> | undefined, second: Record<string, unknown> | undefined): boolean => Boolean(first && second && Math.max(beatValue(first.startTime), beatValue(second.startTime)) < Math.min(beatValue(first.endTime), beatValue(second.endTime)) - 1e-9);
          if (track.some(other => other !== event && overlaps(eventRecord, plain(other) ? other : undefined) && !overlaps(previousRecordEvent, plain(old.get(collabIdOf(other))) ? old.get(collabIdOf(other)) as Record<string, unknown> : undefined))) throw new Error('事件区间与其他物件重叠，本次修改未应用');
        }
      }
    }
  }
}

/**
 * Diffs two documents into the smallest set of changes that turns `before` into `after`.
 *
 * Identity-bearing arrays are matched by `COLLAB_ID` so an insertion or reorder becomes a per-object
 * change rather than a whole-array replacement; other arrays and objects recurse by key. An empty
 * result means the documents are equivalent.
 */
export function chartChanges(before: unknown, after: unknown, path: ChangeSegment[] = [], result: ChartChange[] = []): ChartChange[] {
  if (before === after || equal(before, after)) return result;
  if (Array.isArray(before) && Array.isArray(after) && [...before, ...after].every(item => plain(item) && collabIdOf(item))) {
    const old = new Map<unknown, unknown>(before.map(item => [collabIdOf(item), item])); const next = new Map<unknown, unknown>(after.map(item => [collabIdOf(item), item]));
    const commonBefore = before.filter(item => next.has(collabIdOf(item))).map(item => collabIdOf(item));
    const commonAfter = after.filter(item => old.has(collabIdOf(item))).map(item => collabIdOf(item));
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

/** The identities a change touches, used to check edit locks before applying it. */
export function changeResources(change: ChartChange): unknown[] {
  // `plain` narrows each segment to the identity-object variant, which is the only one carrying an id.
  const ids: unknown[] = [];
  for (const segment of change.path) if (plain(segment)) ids.push(segment.id);
  const collect = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (collabIdOf(value)) ids.push(collabIdOf(value));
    for (const item of Object.values(value)) collect(item);
  };
  if (change.after === undefined || !ids.length || Array.isArray(change.before)) collect(change.before);
  return [...new Set(ids)];
}

/**
 * Applies a change set to a copy of `chart`.
 *
 * Every change is checked against its recorded `before` value, so a change built on a stale document
 * is refused rather than silently overwriting someone else's edit; `shareChartReferences` then
 * re-anchors the result so untouched subtrees keep their identity.
 */
export function applyChanges(chart: Chart, changes: unknown): Chart {
  if (!Array.isArray(changes) || changes.length > 50000) throw new Error('单次联机操作过大');
  validateData(changes);
  const result = structuredClone(chart);
  for (const raw of changes as ChartChange[]) {
    const change = raw;
    if (!Array.isArray(change.path) || !change.path.length || change.path.length > 16) throw new Error('非法操作路径');
    // A segment is invalid when it is an identity object without a string id, a non-string key that is
    // not a non-negative integer, or a name that would pollute a prototype or forge an identity. The
    // `forbidden` set holds strings only, so a numeric segment can never match it.
    const blocked = (segment: ChangeSegment): boolean => {
      if (plain(segment)) return typeof segment.id !== 'string';
      if (typeof segment !== 'string' && (!Number.isInteger(segment) || segment < 0)) return true;
      return forbidden.has(String(segment)) || segment === COLLAB_ID;
    };
    if (change.path.some(blocked)) throw new Error('非法操作路径');
    let parent: unknown = result;
    for (const segment of change.path.slice(0, -1)) {
      if (plain(segment)) parent = Array.isArray(parent) ? (parent as unknown[]).find(item => collabIdOf(item) === segment.id) : undefined;
      else parent = plain(parent) || Array.isArray(parent) ? (parent as Record<string | number, unknown>)[segment] : undefined;
      if (!parent || typeof parent !== 'object') throw new Error('目标已改变，请重新选择');
    }
    const last = change.path.at(-1)!;
    const keyed = plain(last);
    if (keyed && change.after !== undefined && collabIdOf(change.after) !== last.id) throw new Error('物件标识不匹配');
    if (keyed && !Array.isArray(parent)) throw new Error('目标列表不存在');
    const key: string | number = keyed ? (parent as unknown[]).findIndex(item => collabIdOf(item) === last.id) : last as string | number;
    const current: unknown = keyed
      ? ((key as number) < 0 ? undefined : (parent as unknown[])[key as number])
      : (parent as Record<string | number, unknown>)[key];
    if (!equal(current, change.before)) throw new Error('目标已被修改，本次操作未应用');
    if (change.after === undefined) {
      if (keyed) (parent as unknown[]).splice(key as number, 1);
      else delete (parent as Record<string, unknown>)[String(key)];
    } else if (keyed) {
      if ((key as number) < 0) (parent as unknown[]).push(structuredClone(change.after));
      else (parent as unknown[])[key as number] = structuredClone(change.after);
    } else (parent as Record<string | number, unknown>)[key] = structuredClone(change.after);
  }
  for (const line of result.judgeLineList ?? []) line.numOfNotes = line.notes?.length ?? 0;
  return shareChartReferences(chart, result);
}

export const inverseChanges = (changes: ChartChange[]): ChartChange[] => [...changes].reverse().map(change => ({ path: change.path, ...(change.after === undefined ? {} : { before: change.after }), ...(change.before === undefined ? {} : { after: change.before }) }));

/** The display identity shown for a member: a trimmed name of at most 32 characters, and a hex colour. */
export interface CollaborationProfile { name: string; color: string }

export function cleanProfile(profile: { name?: unknown; color?: unknown } | null | undefined): CollaborationProfile {
  return { name: String(profile?.name ?? '').trim().slice(0, 32) || '制谱者', color: /^#[0-9a-f]{6}$/i.test(String(profile?.color)) ? String(profile?.color) : '#64dba5' };
}

/** A validated invitation, ready to hand to the transport. */
export interface CollaborationInvitation { server: string; room: string; token: string }

export function parseInvitation(source: unknown): CollaborationInvitation {
  const text = String(source).trim();
  let payload: unknown;
  try {
    const encoded = text.startsWith('rpenext:') ? text.slice(8) : new URL(text).hash.slice(1).replace(/^collab=/, '');
    payload = JSON.parse(decodeURIComponent(encoded));
  } catch { throw new Error('邀请无效，请粘贴完整邀请链接'); }
  const record: Record<string, unknown> = plain(payload) ? payload : {};
  const url = new URL(String(record.server));
  if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.hash || url.search) throw new Error('服务器地址无效');
  const room = String(record.room); const token = String(record.token);
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(room) || !/^[a-zA-Z0-9_-]{24,120}$/.test(token)) throw new Error('邀请凭据无效');
  return { server: url.href, room, token };
}
