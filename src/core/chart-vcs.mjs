import { shaderLine } from './shader.mjs';
import { t } from '../i18n.mjs';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const hashCache = new WeakMap();

function setOwnData(target, key, value) {
  Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true });
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    const result = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) setOwnData(result, key, sortValue(value[key]));
    }
    return result;
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(sortValue(value));
}

export function deepEqual(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

export function cloneValue(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function toBytes(input) {
  if (typeof input === 'string') return encoder.encode(input);
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  return new Uint8Array(input);
}

function fallbackHash(bytes) {
  let hash = 0xcbf29ce484222325n;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

export async function sha256Hex(input) {
  const bytes = toBytes(input);
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
  }
  return fallbackHash(bytes);
}

export async function hashBytes(bytes, cacheKey = bytes) {
  if (cacheKey && typeof cacheKey === 'object') {
    const cached = hashCache.get(cacheKey);
    if (cached) return cached;
  }
  const hash = await sha256Hex(bytes);
  if (cacheKey && typeof cacheKey === 'object') hashCache.set(cacheKey, hash);
  return hash;
}

export const shortId = id => String(id ?? '').slice(0, 7);
export const GRAPH_COLOR_COUNT = 8;

export function textBytes(text) {
  return encoder.encode(text);
}

export function decodeText(bytes) {
  return decoder.decode(bytes);
}

export function bytesToBase64(input) {
  const bytes = toBytes(input);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  if (typeof globalThis.btoa === 'function') return globalThis.btoa(binary);
  return Buffer.from(binary, 'binary').toString('base64');
}

export function base64ToBytes(text) {
  const binary = typeof globalThis.atob === 'function' ? globalThis.atob(text) : Buffer.from(text, 'base64').toString('binary');
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function validateRefName(name) {
  const value = String(name ?? '').trim();
  if (!value) return t('chart-vcs.sca89845');
  if (value.length > 120) return t('chart-vcs.sf293aa3');
  if (/[\s~^:?*[\\]/.test(value)) return t('chart-vcs.s34a9276');
  if (value.startsWith('/') || value.endsWith('/') || value.includes('//') || value.includes('..')) return t('chart-vcs.sa9837b8');
  if (value.includes('@{')) return t('chart-vcs.sb469089');
  if (value.endsWith('.') || value.endsWith('.lock')) return t('chart-vcs.s993696d');
  return null;
}

export function assertRefName(name, label = t('chart-vcs.s23c0e10')) {
  const message = validateRefName(name);
  if (message) throw new Error(t('chart-vcs.s4086fc6', { p0: label, p1: message }));
  return String(name).trim();
}

function formatBeat(beat) {
  if (!Array.isArray(beat) || beat.length !== 3) return '?';
  const value = beat[0] + beat[1] / beat[2];
  return Number.isFinite(value) ? value.toFixed(3) : '?';
}

function noteLabel(note) {
  const types = { 1: 'Tap', 2: 'Hold', 3: 'Flick', 4: 'Drag' };
  return t('chart-vcs.s62076d8', { p0: types[note?.type] ?? 'Note', p1: formatBeat(note?.startTime), p2: Number(note?.positionX ?? 0) });
}

function eventLabel(type, event) {
  return t('chart-vcs.secc3078', { p0: type, p1: formatBeat(event?.startTime) });
}

function groupItems(items, keyOf) {
  const groups = new Map();
  for (const item of items) {
    const key = keyOf(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

function countValues(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

function unmatched(items, otherItems) {
  const counts = countValues(otherItems.map(canonicalJson));
  const result = [];
  for (const item of items) {
    const key = canonicalJson(item);
    const count = counts.get(key) ?? 0;
    if (count) counts.set(key, count - 1);
    else result.push(item);
  }
  return result;
}

function diffItems(beforeItems, afterItems, keyOf, label) {
  const beforeGroups = groupItems(beforeItems, keyOf);
  const afterGroups = groupItems(afterItems, keyOf);
  const result = { added: 0, removed: 0, modified: 0, samples: { added: [], removed: [], modified: [] } };
  const keys = new Set([...beforeGroups.keys(), ...afterGroups.keys()]);
  for (const key of keys) {
    const before = beforeGroups.get(key) ?? [];
    const after = afterGroups.get(key) ?? [];
    const beforeLeft = unmatched(before, after);
    const afterLeft = unmatched(after, before);
    const modified = Math.min(beforeLeft.length, afterLeft.length);
    result.modified += modified;
    result.removed += beforeLeft.length - modified;
    result.added += afterLeft.length - modified;
    if (modified && result.samples.modified.length < 5) result.samples.modified.push(label(afterLeft[0] ?? beforeLeft[0]));
    if (afterLeft.length > modified && result.samples.added.length < 5) result.samples.added.push(label(afterLeft[modified]));
    if (beforeLeft.length > modified && result.samples.removed.length < 5) result.samples.removed.push(label(beforeLeft[modified]));
  }
  return result;
}

function eventTypeKeys(beforeLayer, afterLayer) {
  const keys = new Set([...Object.keys(beforeLayer ?? {}), ...Object.keys(afterLayer ?? {})]);
  return [...keys].filter(key => key.endsWith('Events'));
}

const META_LABELS = {
  name: t('chart-vcs.scaeac8b'), composer: t('chart-vcs.sc36f907'), charter: t('chart-vcs.sf6379dd'), illustration: t('chart-vcs.s687c35c'),
  level: t('chart-vcs.s205aff9'), song: t('chart-vcs.sbf52cf7'), background: t('chart-vcs.sb13d33a'), offset: t('chart-vcs.sde4c142')
};
const NOTE_FIELD_LABELS = {
  type: t('chart-vcs.se4e46c7'), startTime: t('chart-vcs.s087c451'), endTime: t('chart-vcs.sc4d3fa4'), positionX: t('chart-vcs.sc389e2f'), above: t('chart-vcs.sa88d531'),
  speed: t('chart-vcs.sf2fdffb'), size: t('chart-vcs.sfd20702'), yOffset: t('chart-vcs.s9d63ee8'), visibleTime: t('chart-vcs.s9717d88'), alpha: t('chart-vcs.s61b101b'), isFake: t('chart-vcs.sc4c77c4')
};
const EVENT_FIELD_LABELS = {
  startTime: t('chart-vcs.s087c451'), endTime: t('chart-vcs.sc4d3fa4'), start: t('chart-vcs.s532cd47'), end: t('chart-vcs.s00005a6'),
  easingType: t('chart-vcs.s727b7cd'), easingLeft: t('chart-vcs.s47c47ad'), easingRight: t('chart-vcs.se91875b'),
  bezier: 'Bezier', bezierPoints: t('chart-vcs.sb1f6d6a'), linkgroup: t('chart-vcs.s7941eab')
};
const OTHER_LABELS = {
  markers: t('chart-vcs.sbff4860'), globalEvents: t('chart-vcs.s895a20e'), noiseAreaLayers: t('chart-vcs.s7d95025'),
  effects: t('chart-vcs.s151ddd4'), blockAreaList: t('chart-vcs.s61d33c8'), noiseAreaOptions: t('chart-vcs.s324f893')
};

function formatDiffValue(value) {
  if (value === undefined) return t('chart-vcs.s6238bf9');
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    if (value.length && value.every(item => item && typeof item === 'object' && 'time' in item)) {
      return value.map(item => t('chart-vcs.sfb88580', { p0: item.name ?? t('chart-vcs.sc515246'), p1: formatDiffValue(item.time) })).join('；');
    }
    if (value.length === 3 && value.every(Number.isFinite)) return t('chart-vcs.s79ab764', { p0: formatBeat(value) });
    return value.map(formatDiffValue).join(' / ');
  }
  if (typeof value === 'object') {
    const text = canonicalJson(value);
    return text.length > 90 ? `${text.slice(0, 89)}…` : text;
  }
  return String(value);
}

function describeFieldChanges(before, after, labels) {
  const changes = [];
  for (const key of new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])) {
    if (deepEqual(before?.[key], after?.[key])) continue;
    changes.push(`${labels[key] ?? key}：${formatDiffValue(before?.[key])} → ${formatDiffValue(after?.[key])}`);
    if (changes.length >= 6) { changes.push('…'); break; }
  }
  return changes.join('，');
}

function matchItems(beforeItems, afterItems, keyOf) {
  const beforeGroups = groupItems(beforeItems, keyOf);
  const afterGroups = groupItems(afterItems, keyOf);
  const result = { added: [], removed: [], modified: [] };
  for (const key of new Set([...beforeGroups.keys(), ...afterGroups.keys()])) {
    const before = beforeGroups.get(key) ?? [];
    const after = afterGroups.get(key) ?? [];
    const beforeLeft = unmatched(before, after);
    const afterLeft = unmatched(after, before);
    const modified = Math.min(beforeLeft.length, afterLeft.length);
    for (let index = 0; index < modified; index++) result.modified.push({ before: beforeLeft[index], after: afterLeft[index] });
    result.removed.push(...beforeLeft.slice(modified));
    result.added.push(...afterLeft.slice(modified));
  }
  return result;
}

export function diffCharts(before, after) {
  const beforeChart = before ?? {};
  const afterChart = after ?? {};
  const meta = [];
  const details = [];
  const metaKeys = new Set([...Object.keys(beforeChart.META ?? {}), ...Object.keys(afterChart.META ?? {})]);
  for (const key of [...metaKeys].sort()) {
    if (!deepEqual(beforeChart.META?.[key], afterChart.META?.[key])) {
      meta.push({ key, before: beforeChart.META?.[key], after: afterChart.META?.[key] });
    }
  }
  for (const entry of meta) {
    details.push({ kind: 'meta', text: `${META_LABELS[entry.key] ?? entry.key}：${formatDiffValue(entry.before)} → ${formatDiffValue(entry.after)}` });
  }

  const bpm = diffItems(beforeChart.BPMList ?? [], afterChart.BPMList ?? [],
    entry => canonicalJson(entry?.startTime), entry => t('chart-vcs.s2f24647', { p0: Number(entry?.bpm ?? 0), p1: formatBeat(entry?.startTime) }));
  const bpmChanges = matchItems(beforeChart.BPMList ?? [], afterChart.BPMList ?? [], entry => canonicalJson(entry?.startTime));
  for (const entry of bpmChanges.added) details.push({ kind: 'bpm', text: t('chart-vcs.s6a98778', { p0: Number(entry?.bpm ?? 0), p1: formatBeat(entry?.startTime) }) });
  for (const entry of bpmChanges.removed) details.push({ kind: 'bpm', text: t('chart-vcs.s23c1828', { p0: Number(entry?.bpm ?? 0), p1: formatBeat(entry?.startTime) }) });
  for (const change of bpmChanges.modified) {
    details.push({ kind: 'bpm', text: t('chart-vcs.s8c655f2', { p0: formatBeat(change.after?.startTime ?? change.before?.startTime), p1: Number(change.before?.bpm ?? 0), p2: Number(change.after?.bpm ?? 0) }) });
  }

  const beforeLines = beforeChart.judgeLineList ?? [];
  const afterLines = afterChart.judgeLineList ?? [];
  const lineCount = Math.min(beforeLines.length, afterLines.length);
  let lineModified = 0;
  const lineSamples = [];
  for (let index = 0; index < lineCount; index++) {
    if (!deepEqual(beforeLines[index], afterLines[index])) {
      lineModified++;
      const lineName = afterLines[index]?.Name ?? beforeLines[index]?.Name ?? t('chart-vcs.s8c77106', { p0: index + 1 });
      if (lineSamples.length < 5) lineSamples.push(lineName);
      details.push({ kind: 'line', text: t('chart-vcs.s927c1a8', { p0: lineName }) });
    }
  }
  for (let index = lineCount; index < afterLines.length; index++) {
    details.push({ kind: 'line', text: t('chart-vcs.s3c6c215', { p0: afterLines[index]?.Name ?? t('chart-vcs.s8c77106', { p0: index + 1 }) }) });
  }
  for (let index = lineCount; index < beforeLines.length; index++) {
    details.push({ kind: 'line', text: t('chart-vcs.s7f984d1', { p0: beforeLines[index]?.Name ?? t('chart-vcs.s8c77106', { p0: index + 1 }) }) });
  }
  const lines = {
    before: beforeLines.length, after: afterLines.length,
    added: Math.max(0, afterLines.length - beforeLines.length),
    removed: Math.max(0, beforeLines.length - afterLines.length),
    modified: lineModified, samples: lineSamples
  };

  const notes = { added: 0, removed: 0, modified: 0, samples: { added: [], removed: [], modified: [] } };
  const events = { added: 0, removed: 0, modified: 0, samples: { added: [], removed: [], modified: [] } };
  const mergeCounts = (target, source) => {
    for (const key of ['added', 'removed', 'modified']) target[key] += source[key];
    for (const key of ['added', 'removed', 'modified']) target.samples[key].push(...source.samples[key].slice(0, Math.max(0, 5 - target.samples[key].length)));
  };
  const countLayerEvents = (layer, direction) => {
    for (const type of eventTypeKeys(layer, layer)) {
      const list = layer?.[type] ?? [];
      if (direction === 'added') events.added += list.length;
      else events.removed += list.length;
    }
  };

  for (let index = 0; index < lineCount; index++) {
    const beforeLine = beforeLines[index] ?? {};
    const afterLine = afterLines[index] ?? {};
    const lineName = afterLine.Name ?? beforeLine.Name ?? t('chart-vcs.s8c77106', { p0: index + 1 });
    const noteKey = note => `${note?.type}|${canonicalJson(note?.startTime)}|${note?.positionX}|${note?.above ?? 1}`;
    mergeCounts(notes, diffItems(beforeLine.notes ?? [], afterLine.notes ?? [], noteKey, noteLabel));
    const noteChanges = matchItems(beforeLine.notes ?? [], afterLine.notes ?? [], noteKey);
    for (const note of noteChanges.added) details.push({ kind: 'note', text: t('chart-vcs.s3f15fb6', { p0: index + 1, p1: lineName, p2: noteLabel(note) }) });
    for (const note of noteChanges.removed) details.push({ kind: 'note', text: t('chart-vcs.s1e664bd', { p0: index + 1, p1: lineName, p2: noteLabel(note) }) });
    for (const change of noteChanges.modified) {
      const fields = describeFieldChanges(change.before, change.after, NOTE_FIELD_LABELS);
      details.push({ kind: 'note', text: t('chart-vcs.sceec6e2', { p0: index + 1, p1: lineName, p2: noteLabel(change.after), p3: fields ? `（${fields}）` : '' }) });
    }
    const beforeLayers = [...(beforeLine.eventLayers ?? []), beforeLine.extended ?? {}];
    const afterLayers = [...(afterLine.eventLayers ?? []), afterLine.extended ?? {}];
    const layerCount = Math.max(beforeLayers.length, afterLayers.length);
    for (let layerIndex = 0; layerIndex < layerCount; layerIndex++) {
      const beforeLayer = beforeLayers[layerIndex] ?? {};
      const afterLayer = afterLayers[layerIndex] ?? {};
      for (const type of eventTypeKeys(beforeLayer, afterLayer)) {
        const eventKey = event => canonicalJson(event?.startTime);
        mergeCounts(events, diffItems(beforeLayer[type] ?? [], afterLayer[type] ?? [], eventKey, event => eventLabel(type, event)));
        const eventChanges = matchItems(beforeLayer[type] ?? [], afterLayer[type] ?? [], eventKey);
        for (const event of eventChanges.added) details.push({ kind: 'event', text: t('chart-vcs.sc95b336', { p0: index + 1, p1: lineName, p2: eventLabel(type, event) }) });
        for (const event of eventChanges.removed) details.push({ kind: 'event', text: t('chart-vcs.s2a1f6ef', { p0: index + 1, p1: lineName, p2: eventLabel(type, event) }) });
        for (const change of eventChanges.modified) {
          const fields = describeFieldChanges(change.before, change.after, EVENT_FIELD_LABELS);
          details.push({ kind: 'event', text: t('chart-vcs.s0f9390f', { p0: index + 1, p1: lineName, p2: eventLabel(type, change.after), p3: fields ? `（${fields}）` : '' }) });
        }
      }
    }
  }
  for (let index = lineCount; index < afterLines.length; index++) {
    notes.added += afterLines[index]?.notes?.length ?? 0;
    for (const layer of [...(afterLines[index]?.eventLayers ?? []), afterLines[index]?.extended ?? {}]) countLayerEvents(layer, 'added');
  }
  for (let index = lineCount; index < beforeLines.length; index++) {
    notes.removed += beforeLines[index]?.notes?.length ?? 0;
    for (const layer of [...(beforeLines[index]?.eventLayers ?? []), beforeLines[index]?.extended ?? {}]) countLayerEvents(layer, 'removed');
  }

  const summary = [];
  const other = [];
  const ignoredKeys = new Set(['META', 'BPMList', 'judgeLineList', 'chartTime']);
  for (const key of new Set([...Object.keys(beforeChart), ...Object.keys(afterChart)])) {
    if (ignoredKeys.has(key)) continue;
    if (!deepEqual(beforeChart[key], afterChart[key])) other.push({ key, before: beforeChart[key], after: afterChart[key] });
  }
  for (const entry of other) {
    details.push({ kind: 'other', text: `${OTHER_LABELS[entry.key] ?? entry.key}：${formatDiffValue(entry.before)} → ${formatDiffValue(entry.after)}` });
  }
  let detailsTruncated = false;
  if (details.length > 200) {
    details.length = 200;
    detailsTruncated = true;
  }
  if (meta.length) summary.push(t('chart-vcs.s73d8719', { p0: meta.length }));
  if (bpm.added || bpm.removed || bpm.modified) summary.push(`BPM +${bpm.added} -${bpm.removed} ~${bpm.modified}`);
  if (lines.added || lines.removed || lines.modified) summary.push(t('chart-vcs.s0dabef6', { p0: lines.added, p1: lines.removed, p2: lines.modified }));
  if (notes.added || notes.removed || notes.modified) summary.push(t('chart-vcs.s071d67e', { p0: notes.added, p1: notes.removed, p2: notes.modified }));
  if (events.added || events.removed || events.modified) summary.push(t('chart-vcs.sb3afc70', { p0: events.added, p1: events.removed, p2: events.modified }));
  if (other.length) summary.push(t('chart-vcs.s0afb0bf', { p0: other.length }));
  const total = meta.length + bpm.added + bpm.removed + bpm.modified + lines.added + lines.removed + lines.modified + notes.added + notes.removed + notes.modified + events.added + events.removed + events.modified + other.length;
  return { meta, bpm, lines, notes, events, other, details, detailsTruncated, summary, total };
}

export function diffTrees(before, after) {
  const beforeAssets = new Map((before?.assets ?? []).map(entry => [entry.path, entry]));
  const afterAssets = new Map((after?.assets ?? []).map(entry => [entry.path, entry]));
  const added = [], modified = [], deleted = [];
  for (const [path, entry] of afterAssets) {
    const previous = beforeAssets.get(path);
    if (!previous) added.push(entry);
    else if (previous.blob !== entry.blob) modified.push({ path, before: previous, after: entry });
  }
  for (const [path, entry] of beforeAssets) if (!afterAssets.has(path)) deleted.push(entry);
  const foldersChanged = !deepEqual([...(before?.folders ?? [])].sort(), [...(after?.folders ?? [])].sort());
  return {
    chartChanged: (before?.chart ?? null) !== (after?.chart ?? null),
    chartNameChanged: (before?.chartName ?? '') !== (after?.chartName ?? ''),
    foldersChanged, added, modified, deleted,
    total: Number((before?.chart ?? null) !== (after?.chart ?? null)) + Number((before?.chartName ?? '') !== (after?.chartName ?? '')) + added.length + modified.length + deleted.length + Number(foldersChanged)
  };
}

export function hasTreeChanges(diff) {
  return Boolean(diff && diff.total > 0);
}

export function mergeFolders(base = [], ours = [], theirs = []) {
  const baseSet = new Set(base), ourSet = new Set(ours), theirSet = new Set(theirs);
  const result = new Set();
  for (const folder of new Set([...ourSet, ...theirSet])) {
    if (ourSet.has(folder) && theirSet.has(folder)) result.add(folder);
    else if (ourSet.has(folder)) { if (!baseSet.has(folder)) result.add(folder); }
    else if (!baseSet.has(folder)) result.add(folder);
  }
  return [...result].sort();
}

function mergeConflict(path, base, ours, theirs, oursPresent = true, theirsPresent = true, kind = 'chart') {
  return { path: formatPath(path), pathArray: path, base, ours, theirs, oursPresent, theirsPresent, kind };
}

export function formatPath(path) {
  let text = '';
  for (const part of path) {
    if (typeof part === 'number') text += `[${part}]`;
    else text += text ? `.${part}` : String(part);
  }
  return text || '(root)';
}

function mergeObject(base, ours, theirs, path, conflicts) {
  const result = {};
  const keys = new Set([...Object.keys(base), ...Object.keys(ours), ...Object.keys(theirs)]);
  for (const key of keys) {
    const inBase = Object.hasOwn(base, key);
    const inOurs = Object.hasOwn(ours, key);
    const inTheirs = Object.hasOwn(theirs, key);
    const baseValue = inBase ? base[key] : undefined;
    const childPath = [...path, key];
    if (inOurs && inTheirs) setOwnData(result, key, mergeValue(baseValue, ours[key], theirs[key], childPath, conflicts));
    else if (inOurs) {
      if (!inBase) setOwnData(result, key, cloneValue(ours[key]));
      else if (!deepEqual(ours[key], baseValue)) {
        conflicts.push(mergeConflict(childPath, baseValue, ours[key], undefined, true, false));
        setOwnData(result, key, cloneValue(ours[key]));
      }
    } else if (inTheirs) {
      if (!inBase) setOwnData(result, key, cloneValue(theirs[key]));
      else if (!deepEqual(theirs[key], baseValue)) {
        conflicts.push(mergeConflict(childPath, baseValue, undefined, theirs[key], false, true));
        setOwnData(result, key, cloneValue(theirs[key]));
      }
    }
  }
  return result;
}

function arrayConfig(path) {
  const last = path.at(-1);
  if (last === 'BPMList') return { keyOf: entry => canonicalJson(entry?.startTime), sortByTime: true };
  if (last === 'notes') return { keyOf: note => `${note?.type}|${canonicalJson(note?.startTime)}|${note?.positionX}|${note?.above ?? 1}`, sortByTime: true };
  if (last === 'markers') return { keyOf: marker => String(marker?.time ?? ''), sortByTime: true };
  if (typeof last === 'string' && last.endsWith('Events')) return { keyOf: event => canonicalJson(event?.startTime), sortByTime: true };
  return null;
}

function timeValue(item) {
  const beat = item?.startTime ?? item?.time;
  if (Array.isArray(beat) && beat.length === 3) return beat[0] + beat[1] / beat[2];
  const value = Number(beat);
  return Number.isFinite(value) ? value : 0;
}

function groupKeyed(items, keyOf) {
  const groups = new Map();
  const occurrences = new Map();
  for (const item of items) {
    const raw = keyOf(item);
    const occurrence = occurrences.get(raw) ?? 0;
    occurrences.set(raw, occurrence + 1);
    groups.set(`${raw}#${occurrence}`, item);
  }
  return groups;
}

function lineName(line) {
  return String(line?.Name ?? '');
}

function lineSignature(line, omitName = false) {
  if (!line || typeof line !== 'object' || Array.isArray(line)) return line;
  const copy = { ...line };
  delete copy.father;
  if (omitName) delete copy.Name;
  return canonicalJson(copy);
}

function matchLineIndices(base, branch, renames = true) {
  const used = new Set();
  const matches = new Map();
  const groups = (lines, keyOf, skip) => {
    const result = new Map();
    lines.forEach((line, index) => {
      if (skip(index)) return;
      const key = keyOf(line);
      if (key === '') return;
      if (!result.has(key)) result.set(key, []);
      result.get(key).push(index);
    });
    return result;
  };
  const match = keyOf => {
    const before = groups(base, keyOf, index => used.has(index));
    const after = groups(branch, keyOf, index => matches.has(index));
    for (const [key, indices] of after) {
      const candidates = before.get(key);
      if (indices.length !== 1 || candidates?.length !== 1) continue;
      matches.set(indices[0], candidates[0]); used.add(candidates[0]);
    }
  };
  match(lineName);
  match(line => lineSignature(line));
  if (renames) match(line => lineSignature(line, true));
  const remainingNames = groups(base, lineName, index => used.has(index));
  const ambiguous = branch.some((line, index) => !matches.has(index) && remainingNames.has(lineName(line)));
  return { matches, ambiguous };
}

function lineIdentities(base, ours, theirs) {
  const ourMatch = matchLineIndices(base, ours);
  const theirMatch = matchLineIndices(base, theirs);
  const ourIds = ours.map((line, index) => ourMatch.matches.has(index) ? `base:${ourMatch.matches.get(index)}` : `ours:${index}`);
  const theirIds = theirs.map((line, index) => theirMatch.matches.has(index) ? `base:${theirMatch.matches.get(index)}` : `theirs:${index}`);
  const ourAdded = ours.flatMap((line, index) => ourMatch.matches.has(index) ? [] : [{ line, index }]);
  const theirAdded = theirs.flatMap((line, index) => theirMatch.matches.has(index) ? [] : [{ line, index }]);
  const addedMatch = matchLineIndices(ourAdded.map(entry => entry.line), theirAdded.map(entry => entry.line), false);
  for (const [theirIndex, ourIndex] of addedMatch.matches) theirIds[theirAdded[theirIndex].index] = ourIds[ourAdded[ourIndex].index];
  return { base: base.map((line, index) => `base:${index}`), ours: ourIds, theirs: theirIds, ambiguous: ourMatch.ambiguous || theirMatch.ambiguous || addedMatch.ambiguous };
}

function completeLineOrder(primary, secondary) {
  const present = new Set(primary), before = new Map();
  let pending = [];
  for (const identity of secondary) {
    if (!present.has(identity)) { pending.push(identity); present.add(identity); }
    else if (pending.length) { before.set(identity, [...(before.get(identity) ?? []), ...pending]); pending = []; }
  }
  return primary.flatMap(identity => [...(before.get(identity) ?? []), identity]).concat(pending);
}

function mergeLineOrder(base, ours, theirs, path, conflicts) {
  const ourIds = new Set(ours), theirIds = new Set(theirs);
  const common = new Set(base.filter(identity => ourIds.has(identity) && theirIds.has(identity)));
  const before = base.filter(identity => common.has(identity)), ourOrder = ours.filter(identity => common.has(identity)), theirOrder = theirs.filter(identity => common.has(identity));
  if (!deepEqual(before, ourOrder) && !deepEqual(before, theirOrder) && !deepEqual(ourOrder, theirOrder)) {
    conflicts.push(mergeConflict(path, base, ours, theirs));
    return completeLineOrder(ours, theirs);
  }
  return deepEqual(before, ourOrder) ? completeLineOrder(theirs, ours) : completeLineOrder(ours, theirs);
}

function mapShaderReferences(chart, remap) {
  for (const events of [chart.effects, chart.shaderEvents, chart.META?.effects]) {
    if (!Array.isArray(events)) continue;
    for (let index = events.length - 1; index >= 0; index--) {
      const event = events[index];
      if (!event || typeof event !== 'object') continue;
      const destination = remap(event, chart);
      if (destination === undefined) events.splice(index, 1);
      else event.line = destination;
    }
  }
}

function normalizeLineGraph(chart, identities) {
  const result = cloneValue(chart);
  mapShaderReferences(result, (event, source) => identities[shaderLine(event, source)]);
  const lines = { $order: identities };
  result.judgeLineList.forEach((line, index) => { lines[identities[index]] = { ...line, father: identities[line.father] ?? null }; });
  result.judgeLineList = lines;
  return result;
}

function restoreLineGraph(chart) {
  const result = cloneValue(chart), graph = result.judgeLineList;
  const identities = [...new Set([...(graph.$order ?? []), ...Object.keys(graph).filter(key => key !== '$order')])].filter(identity => Object.hasOwn(graph, identity));
  const indices = new Map(identities.map((identity, index) => [identity, index]));
  result.judgeLineList = identities.map(identity => ({ ...graph[identity], father: indices.get(graph[identity].father) ?? -1 }));
  mapShaderReferences(result, event => indices.get(event.line));
  return { chart: result, identities, indices };
}

function mergeKeyedArray(base, ours, theirs, keyOf, path, conflicts) {
  const before = groupKeyed(base, keyOf);
  const our = groupKeyed(ours, keyOf);
  const their = groupKeyed(theirs, keyOf);
  const result = [];
  const keys = [...before.keys(), ...[...our.keys()].filter(key => !before.has(key)), ...[...their.keys()].filter(key => !before.has(key) && !our.has(key))];
  for (const key of keys) {
    const inBase = before.has(key), inOurs = our.has(key), inTheirs = their.has(key);
    const itemPath = [...path, result.length];
    if (inOurs && inTheirs) result.push(mergeValue(before.get(key), our.get(key), their.get(key), itemPath, conflicts));
    else if (inOurs) {
      if (!inBase) result.push(cloneValue(our.get(key)));
      else if (!deepEqual(our.get(key), before.get(key))) {
        conflicts.push(mergeConflict(itemPath, before.get(key), our.get(key), undefined, true, false));
        result.push(cloneValue(our.get(key)));
      }
    } else if (inTheirs) {
      if (!inBase) result.push(cloneValue(their.get(key)));
      else if (!deepEqual(their.get(key), before.get(key))) {
        conflicts.push(mergeConflict(itemPath, before.get(key), undefined, their.get(key), false, true));
        result.push(cloneValue(their.get(key)));
      }
    }
  }
  return result;
}

function mergeArray(base, ours, theirs, path, conflicts) {
  if (path.length === 2 && path[0] === 'judgeLineList' && path[1] === '$order') return mergeLineOrder(base, ours, theirs, path, conflicts);
  const config = arrayConfig(path);
  if (config) return mergeKeyedArray(base, ours, theirs, config.keyOf, path, conflicts);
  if (base.length === ours.length && base.length === theirs.length) {
    return base.map((item, index) => mergeValue(item, ours[index], theirs[index], [...path, index], conflicts));
  }
  conflicts.push(mergeConflict(path, base, ours, theirs));
  return cloneValue(ours);
}

export function sortChartCollections(chart) {
  if (!chart || typeof chart !== 'object') return chart;
  if (Array.isArray(chart.BPMList)) chart.BPMList.sort((left, right) => timeValue(left) - timeValue(right));
  if (Array.isArray(chart.markers)) chart.markers.sort((left, right) => timeValue(left) - timeValue(right));
  if (Array.isArray(chart.globalEvents)) chart.globalEvents.sort((left, right) => timeValue(left) - timeValue(right));
  for (const line of chart.judgeLineList ?? []) {
    if (!line) continue;
    if (Array.isArray(line.notes)) line.notes.sort((left, right) => timeValue(left) - timeValue(right));
    for (const layer of line.eventLayers ?? []) {
      if (!layer) continue;
      for (const key of Object.keys(layer)) if (key.endsWith('Events') && Array.isArray(layer[key])) layer[key].sort((left, right) => timeValue(left) - timeValue(right));
    }
    if (line.extended) {
      for (const key of Object.keys(line.extended)) if (key.endsWith('Events') && Array.isArray(line.extended[key])) line.extended[key].sort((left, right) => timeValue(left) - timeValue(right));
    }
  }
  return chart;
}

function mergeValue(base, ours, theirs, path, conflicts) {
  if (deepEqual(ours, theirs)) return cloneValue(ours);
  if (deepEqual(base, ours)) return cloneValue(theirs);
  if (deepEqual(base, theirs)) return cloneValue(ours);
  const isObject = value => value && typeof value === 'object' && !Array.isArray(value);
  if (isObject(base) && isObject(ours) && isObject(theirs)) return mergeObject(base, ours, theirs, path, conflicts);
  if (Array.isArray(base) && Array.isArray(ours) && Array.isArray(theirs)) return mergeArray(base, ours, theirs, path, conflicts);
  conflicts.push(mergeConflict(path, base, ours, theirs));
  return cloneValue(ours);
}

function chartMergeState(base, ours, theirs) {
  const conflicts = [];
  const documents = [base ?? {}, ours ?? {}, theirs ?? {}];
  if (!documents.every(chart => Array.isArray(chart.judgeLineList))) return { chart: mergeValue(...documents, [], conflicts), conflicts, normalized: false };
  const identities = lineIdentities(...documents.map(chart => chart.judgeLineList));
  if (identities.ambiguous) {
    if (deepEqual(ours, theirs)) return { chart: cloneValue(ours), conflicts, normalized: false };
    if (deepEqual(base, ours)) return { chart: cloneValue(theirs), conflicts, normalized: false };
    if (deepEqual(base, theirs)) return { chart: cloneValue(ours), conflicts, normalized: false };
    conflicts.push(mergeConflict([], base, ours, theirs));
    return { chart: cloneValue(ours), conflicts, normalized: false };
  }
  const normalized = documents.map((chart, index) => normalizeLineGraph(chart, identities[['base', 'ours', 'theirs'][index]]));
  return { chart: mergeValue(...normalized, [], conflicts), conflicts, normalized: true };
}

function chartMergeConflict(conflict, merged, indices) {
  const result = cloneValue(conflict), path = conflict.pathArray;
  if (path[0] === 'judgeLineList') {
    if (path[1] === '$order') {
      result.path = t('chart-vcs.s3fb39f9'); result.pathArray = ['judgeLineList'];
      for (const side of ['base', 'ours', 'theirs']) {
        const graph = { ...merged.judgeLineList, $order: conflict[side] };
        result[side] = restoreLineGraph({ ...merged, judgeLineList: graph }).chart.judgeLineList;
      }
    } else {
      result.pathArray = ['judgeLineList', indices.get(path[1]), ...path.slice(2)];
      result.path = formatPath(result.pathArray);
      for (const side of ['base', 'ours', 'theirs']) {
        if (path.length === 3 && path[2] === 'father') result[side] = indices.get(conflict[side]) ?? -1;
        else if (path.length === 2 && conflict[side]) result[side].father = indices.get(conflict[side].father) ?? -1;
      }
    }
  } else {
    const effectPath = path[0] === 'META' ? path.slice(1) : path;
    if (['effects', 'shaderEvents'].includes(effectPath[0])) for (const side of ['base', 'ours', 'theirs']) {
      const value = result[side];
      if (effectPath.length === 1 && Array.isArray(value)) for (const event of value) { if (event && typeof event === 'object') event.line = indices.get(event.line) ?? -1; }
      else if (effectPath.length === 2 && value && typeof value === 'object') value.line = indices.get(value.line) ?? -1;
      else if (effectPath.length === 3 && effectPath[2] === 'line') result[side] = indices.get(value) ?? -1;
    }
  }
  return result;
}

export function mergeCharts(base, ours, theirs) {
  const result = chartMergeState(base, ours, theirs);
  const restored = result.normalized ? restoreLineGraph(result.chart) : result;
  const chart = restored.chart, conflicts = result.normalized ? result.conflicts.map(conflict => chartMergeConflict(conflict, result.chart, restored.indices)) : result.conflicts;
  if (!conflicts.length) sortChartCollections(chart);
  return { chart, conflicts };
}

export function resolveChartMerge(base, ours, theirs, choices) {
  const result = chartMergeState(base, ours, theirs);
  const resolved = applyMergeResolutions(result.chart, result.conflicts, choices);
  return sortChartCollections(result.normalized ? restoreLineGraph(resolved).chart : resolved);
}

export function assertMergedLineParents(chart) {
  const lines = chart.judgeLineList ?? [], state = new Uint8Array(lines.length);
  for (let index = 0; index < lines.length; index++) {
    if (state[index] === 2) continue;
    const chain = [];
    let current = index;
    while (current !== -1 && state[current] !== 2) {
      if (state[current] === 1) throw new Error(t('chart-vcs.s49405e4'));
      state[current] = 1; chain.push(current);
      const parent = lines[current]?.father ?? -1;
      if (!Number.isInteger(parent) || parent < -1 || parent >= lines.length) throw new Error(t('chart-vcs.sb10b60e'));
      current = parent;
    }
    for (const entry of chain) state[entry] = 2;
  }
  return chart;
}

export function mergeAssets(base = [], ours = [], theirs = []) {
  const before = new Map(base.map(entry => [entry.path, entry]));
  const our = new Map(ours.map(entry => [entry.path, entry]));
  const their = new Map(theirs.map(entry => [entry.path, entry]));
  const result = [];
  const conflicts = [];
  const paths = [...new Set([...before.keys(), ...our.keys(), ...their.keys()])].sort();
  for (const path of paths) {
    const inBase = before.has(path), inOurs = our.has(path), inTheirs = their.has(path);
    const conflictPath = ['assets', path];
    if (inOurs && inTheirs) {
      const oursEntry = our.get(path), theirsEntry = their.get(path), baseEntry = before.get(path);
      if (deepEqual(oursEntry, theirsEntry)) result.push(cloneValue(oursEntry));
      else if (deepEqual(baseEntry, oursEntry)) result.push(cloneValue(theirsEntry));
      else if (deepEqual(baseEntry, theirsEntry)) result.push(cloneValue(oursEntry));
      else {
        conflicts.push(mergeConflict(conflictPath, baseEntry, oursEntry, theirsEntry, true, true, 'asset'));
        result.push(cloneValue(oursEntry));
      }
    } else if (inOurs) {
      if (!inBase) result.push(cloneValue(our.get(path)));
      else if (!deepEqual(our.get(path), before.get(path))) {
        conflicts.push(mergeConflict(conflictPath, before.get(path), our.get(path), undefined, true, false, 'asset'));
        result.push(cloneValue(our.get(path)));
      }
    } else if (inTheirs) {
      if (!inBase) result.push(cloneValue(their.get(path)));
      else if (!deepEqual(their.get(path), before.get(path))) {
        conflicts.push(mergeConflict(conflictPath, before.get(path), undefined, their.get(path), false, true, 'asset'));
        result.push(cloneValue(their.get(path)));
      }
    }
  }
  return { assets: result, conflicts };
}

function setAtPath(root, path, value) {
  if (!path.length) return;
  let parent = root;
  for (let index = 0; index < path.length - 1; index++) {
    const key = path[index];
    const next = path[index + 1];
    if (!Object.hasOwn(parent, key) || parent[key] === null || typeof parent[key] !== 'object') {
      setOwnData(parent, key, typeof next === 'number' ? [] : {});
    }
    parent = parent[key];
  }
  setOwnData(parent, path.at(-1), cloneValue(value));
}

function getAtPath(root, path) {
  let parent = root;
  for (const key of path) {
    if (parent === undefined || parent === null || !Object.hasOwn(parent, key)) return undefined;
    parent = parent[key];
  }
  return parent;
}

function removeAtPaths(root, paths) {
  const arrayGroups = new Map();
  for (const path of paths) {
    if (!path.length) continue;
    const parentPath = path.slice(0, -1);
    const last = path.at(-1);
    if (typeof last === 'number') {
      const key = canonicalJson(parentPath);
      if (!arrayGroups.has(key)) arrayGroups.set(key, { parentPath, indices: [] });
      arrayGroups.get(key).indices.push(last);
    } else {
      const parent = getAtPath(root, parentPath);
      if (parent && typeof parent === 'object') delete parent[last];
    }
  }
  for (const { parentPath, indices } of arrayGroups.values()) {
    const parent = getAtPath(root, parentPath);
    if (!Array.isArray(parent)) continue;
    for (const index of [...new Set(indices)].sort((left, right) => right - left)) parent.splice(index, 1);
  }
}

export function applyMergeResolutions(chart, conflicts, choices) {
  let result = cloneValue(chart);
  const removals = [];
  conflicts.forEach((conflict, index) => {
    const choice = choices[index] === 'theirs' ? 'theirs' : 'ours';
    const present = choice === 'theirs' ? conflict.theirsPresent !== false : conflict.oursPresent !== false;
    const value = choice === 'theirs' ? conflict.theirs : conflict.ours;
    if (!conflict.pathArray.length && present) result = cloneValue(value);
    else if (present) setAtPath(result, conflict.pathArray, value);
    else removals.push(conflict.pathArray);
  });
  if (Array.isArray(result.judgeLineList)) {
    const deleted = new Set(removals.filter(path => path.length === 2 && path[0] === 'judgeLineList').map(path => path[1]));
    if (deleted.size) {
      const indices = new Map();
      result.judgeLineList.forEach((line, index) => { if (!deleted.has(index)) indices.set(index, indices.size); });
      for (const line of result.judgeLineList) if (line.father >= 0) line.father = indices.get(line.father) ?? -1;
      mapShaderReferences(result, (event, source) => indices.get(shaderLine(event, source)));
    }
  }
  removeAtPaths(result, removals);
  return result;
}

export function applyAssetResolutions(assets, conflicts, choices) {
  const result = new Map((assets ?? []).map(entry => [entry.path, cloneValue(entry)]));
  conflicts.forEach((conflict, index) => {
    const path = conflict.pathArray[1];
    const choice = choices[index] === 'theirs' ? 'theirs' : 'ours';
    const present = choice === 'theirs' ? conflict.theirsPresent !== false : conflict.oursPresent !== false;
    if (present) result.set(path, cloneValue(choice === 'theirs' ? conflict.theirs : conflict.ours));
    else result.delete(path);
  });
  return [...result.values()].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}

function compareCommits(left, right) {
  return (right?.timestamp ?? 0) - (left?.timestamp ?? 0) || String(right?.id ?? '').localeCompare(String(left?.id ?? ''));
}

export function graphLayout(commits, refs = {}) {
  const byId = new Map();
  for (const commit of commits ?? []) if (commit?.id) byId.set(commit.id, commit);
  const candidates = [...byId.values()].sort(compareCommits);
  const indegree = new Map(candidates.map(commit => [commit.id, 1]));
  for (const commit of candidates) {
    for (const parent of commit.parents ?? []) {
      if (byId.has(parent)) indegree.set(parent, indegree.get(parent) + 1);
    }
  }
  const queue = candidates.filter(commit => indegree.get(commit.id) === 1);
  const ordered = [];
  while (queue.length) {
    const commit = queue.shift();
    ordered.push(commit);
    for (const parent of commit.parents ?? []) {
      if (!byId.has(parent)) continue;
      const count = indegree.get(parent);
      if (!count) continue;
      indegree.set(parent, count - 1);
      if (count - 1 === 1) queue.unshift(byId.get(parent));
    }
    indegree.set(commit.id, 0);
  }
  const orderedIds = new Set(ordered.map(commit => commit.id));
  for (const commit of candidates) if (!orderedIds.has(commit.id)) { ordered.push(commit); orderedIds.add(commit.id); }

  const branches = refs.branches ?? {};
  const tags = refs.tags ?? {};
  const refsByCommit = new Map();
  const addRef = (id, ref) => {
    if (!id) return;
    if (!refsByCommit.has(id)) refsByCommit.set(id, []);
    refsByCommit.get(id).push(ref);
  };
  for (const [name, id] of Object.entries(branches)) addRef(id, { type: 'branch', name, head: refs.head?.type === 'branch' && refs.head.name === name });
  for (const [name, tag] of Object.entries(tags)) addRef(typeof tag === 'string' ? tag : tag?.commit, { type: 'tag', name });
  if (refs.head?.type === 'detached') addRef(refs.head.commit, { type: 'head', name: 'HEAD', head: true });

  const branchColor = new Map(Object.keys(branches).sort().map((name, index) => [name, index % GRAPH_COLOR_COUNT]));
  const tagColor = new Map(Object.keys(tags).sort().map((name, index) => [name, (branchColor.size + index) % GRAPH_COLOR_COUNT]));
  const labelColor = id => {
    const itemRefs = refsByCommit.get(id) ?? [];
    const branch = itemRefs.find(ref => ref.type === 'branch');
    if (branch) return branchColor.get(branch.name);
    const tag = itemRefs.find(ref => ref.type === 'tag');
    if (tag) return tagColor.get(tag.name);
    if (itemRefs.some(ref => ref.type === 'head')) return 0;
    return undefined;
  };
  const refColor = ref => ref.type === 'branch' ? branchColor.get(ref.name) : ref.type === 'tag' ? tagColor.get(ref.name) : 0;
  const refOrder = ref => ref.type === 'branch' ? 0 : ref.type === 'head' ? 1 : 2;

  let colorIndex = -1;
  let previousOutput = [];
  const rows = [];
  for (const commit of ordered) {
    const inputSwimlanes = previousOutput.map(node => ({ ...node }));
    const outputSwimlanes = [];
    const parents = commit.parents ?? [];
    const inputIndex = inputSwimlanes.findIndex(node => node.id === commit.id);
    const circleIndex = inputIndex !== -1 ? inputIndex : inputSwimlanes.length;
    let firstParentAdded = false;
    if (parents.length) {
      for (const node of inputSwimlanes) {
        if (node.id === commit.id) {
          if (!firstParentAdded) {
            outputSwimlanes.push({ id: parents[0], color: node.color });
            firstParentAdded = true;
          }
          continue;
        }
        outputSwimlanes.push({ ...node });
      }
    }
    for (let index = firstParentAdded ? 1 : 0; index < parents.length; index++) {
      let color = index === 0 ? labelColor(commit.id) : labelColor(parents[index]);
      if (color === undefined) {
        colorIndex = (colorIndex + 1) % GRAPH_COLOR_COUNT;
        color = colorIndex;
      }
      outputSwimlanes.push({ id: parents[index], color });
    }
    const circleColor = labelColor(commit.id) ?? outputSwimlanes[circleIndex]?.color ?? inputSwimlanes[circleIndex]?.color ?? 0;
    const incomingLanes = [];
    inputSwimlanes.forEach((node, index) => { if (node.id === commit.id && index !== circleIndex) incomingLanes.push(index); });
    const commitRefs = (refsByCommit.get(commit.id) ?? [])
      .map(ref => ({ ...ref, color: refColor(ref) }))
      .sort((left, right) => refOrder(left) - refOrder(right) || left.name.localeCompare(right.name));
    const row = {
      id: commit.id, commit, index: rows.length, lane: circleIndex,
      inputSwimlanes, outputSwimlanes, circleIndex, circleColor, incomingLanes, refs: commitRefs,
      color: circleColor,
      head: refs.head?.type === 'detached' ? refs.head.commit === commit.id : branches[refs.head?.name] === commit.id
    };
    rows.push(row);
    previousOutput = outputSwimlanes;
  }

  const rowById = new Map(rows.map(row => [row.id, row]));
  const edges = [];
  for (const row of rows) {
    for (const parent of row.commit.parents ?? []) {
      const target = rowById.get(parent);
      if (target) edges.push({ from: row, to: target, color: row.circleColor });
    }
    for (const incomingLane of row.incomingLanes) {
      edges.push({
        from: { ...row, lane: incomingLane }, to: row,
        color: row.inputSwimlanes[incomingLane]?.color ?? row.circleColor, incoming: true
      });
    }
  }
  const laneCount = Math.max(1, ...rows.map(row => Math.max(row.inputSwimlanes.length, row.outputSwimlanes.length, row.circleIndex + 1)));
  return { rows, edges, laneCount, rowCount: rows.length };
}
