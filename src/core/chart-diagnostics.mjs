import { beatValue, fromNumber } from './beat.mjs';
import { TempoMap } from './tempo.mjs';
import { diagnoseNoiseAreas, NOISE_TRACKS } from './noise-areas.mjs';
import { validateGlobalEvent } from './global-events.mjs';
import { t, currentLocale } from '../i18n.mjs';

const BASE = ['moveXEvents', 'moveYEvents', 'rotateEvents', 'alphaEvents', 'speedEvents'];
const EXTRA = ['scaleXEvents', 'scaleYEvents', 'colorEvents', 'textEvents', 'inclineEvents', 'gifEvents', 'paintEvents'];
const lineCache = new WeakMap();
const noteCache = new WeakMap(), trackCache = new WeakMap();
const list = value => Array.isArray(value) ? value : [];
const append = (target, source) => { for (const value of source) target.push(value); };
const legacyMessages = { noteTime: 'chart.s09eb5b2', holdZero: 'chart.sd9e7995', xRange: 'chart.s91fb3b9', noteOverlap: 'chart.sb895491', bpmDuplicate: 'chart.s5c7f11a', father: 'chart.s237845c', eventOverlap: 'chart.s24d7d12' };
export const diagnosticKey = issue => [issue.code ?? issue.message, issue.line, issue.layer, issue.extended, issue.path, issue.asset, issue.target, issue.globalType, issue.globalColumn].join('|');
export function diagnostic(code, severity, location = {}, args = {}) {
  return { code, severity, line: 0, beat: 0, path: '', removable: false, ...location, message: t(legacyMessages[code] ?? 'diag.' + code, code === 'eventOverlap' ? { p0: args.type } : args) };
}
function readBeat(value) { try { return beatValue(value); } catch { return NaN; } }
const fake = note => note?.isFake === true || Number(note?.isFake) === 1;
const sameValue = (a, b) => a === b || Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);

// One active end per exact X and side suffices: each later object only needs one
// conflict witness. No pair list is constructed even for thousands of stacked Holds.
export function noteOverlapIndices(notes) {
  const groups = new Map(), duplicates = new Set(), result = new Set();
  for (let index = 0; index < notes.length; index++) {
    const note = notes[index]; if (fake(note)) continue;
    const start = readBeat(note.startTime), end = readBeat(note.endTime), side = Number(note.above ?? 1) === 1;
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const position = `${note.positionX}:${side}`;
    if (note.type === 3) { const key = `${position}:${start}`; if (duplicates.has(key)) result.add(index); duplicates.add(key); }
    if (note.type !== 1 && note.type !== 2) continue;
    if (!groups.has(position)) groups.set(position, []);
    groups.get(position).push({ index, start, end: note.type === 2 ? Math.max(start, end) : start });
  }
  for (const entries of groups.values()) {
    entries.sort((a, b) => a.start - b.start || a.index - b.index);
    let furthest = -Infinity;
    for (const entry of entries) { if (entry.start <= furthest) result.add(entry.index); furthest = Math.max(furthest, entry.end); }
  }
  return result;
}

function easingIssues(event, emit) {
  // EventTrack returns constant values before looking at easing. RPE's FillBlank
  // even stores the line id as the easing id of its constant incline event.
  // Keep those unused fields intact rather than reporting a playback error.
  if (!sameValue(event.start, event.end)) {
    if (!event.bezier) {
      if (event.easingType !== undefined && (!Number.isInteger(event.easingType) || event.easingType < 1 || event.easingType > 29)) emit('easing', 'error');
      const left = event.easingLeft ?? 0, right = event.easingRight ?? 1;
      // Equal boundaries intentionally fall back to linear interpolation in both
      // engines. Bezier events do not use easing ids or slice boundaries at all.
      if (![left, right].every(Number.isFinite) || left < 0 || left > 1 || right < 0 || right > 1 || left > right) emit('easingBounds', 'error');
    }
    if (event.bezier && (!Array.isArray(event.bezierPoints) || event.bezierPoints.length !== 4 || !event.bezierPoints.every(Number.isFinite) || event.bezierPoints[0] < 0 || event.bezierPoints[0] > 1 || event.bezierPoints[2] < 0 || event.bezierPoints[2] > 1)) emit('bezier', 'error');
  }
  if (event.linkgroup !== undefined && (!Number.isInteger(event.linkgroup) || event.linkgroup < 0) || event.bezier !== undefined && ![0, 1, true, false].includes(event.bezier)) emit('value', 'error');
}
function missingBaselineIssue(type, location) {
  const column = { moveXEvents: 'X', moveYEvents: 'Y', rotateEvents: t('timeline.sa69e51e'), alphaEvents: t('inspector.s61b101b'), speedEvents: t('inspector.sf2fdffb') }[type];
  return diagnostic('missingBaseline', 'warning', { ...location, path: type, eventType: type }, { column });
}
function eventIssues(events, type, location, seconds, options, column) {
  const issues = [], intervals = [];
  let hasInitialValue = false;
  for (const [index, event] of list(events).entries()) {
    const start = readBeat(event?.startTime), end = readBeat(event?.endTime), where = { ...location, index, beat: Number.isFinite(start) ? start : 0, path: `${location.path ?? type}[${index}]`, removable: location.globalType ? false : location.removable ?? true };
    const emit = (code, severity = 'error', args) => issues.push(diagnostic(code, severity, where, args));
    if (!Number.isFinite(start) || !Number.isFinite(end)) { emit('beat'); continue; }
    // Events starting before zero retain their end value after they finish.
    // Inclusive zero also covers a boundary event or an instantaneous marker.
    if (start <= 0 && end >= start) hasInitialValue = true;
    if (end < start || end === start && !event.inst && !event.transformStep && !sameValue(event.start, event.end) && type !== 'activeIntervals') emit('eventTime');
    if (seconds && outside(seconds(start), seconds(end), options, true)) emit('timeRange');
    if (type !== 'activeIntervals') {
      const values = [event.start, event.end], kind = column?.valueType ?? (type === 'textEvents' ? 'text' : type === 'colorEvents' ? 'color' : type === 'paintEvents' ? 'shader' : 'number');
      if (kind === 'number' && !values.every(Number.isFinite) || kind === 'text' && !values.every(v => typeof v === 'string') || kind === 'boolean' && !values.every(v => typeof v === 'boolean') || kind === 'color' && !values.every(v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite))) emit('value');
      if (kind === 'color' && values.some(v => Array.isArray(v) && v.some(c => c < 0 || c > 255))) emit('valueRange', 'warning');
      if (type === 'alphaEvents' && values.some(v => v > 255)) emit('alphaRange', 'warning');
      if (column && values.some(v => typeof v === 'number' && (column.min !== undefined && v < column.min || column.max !== undefined && v > column.max))) { emit('valueRange', 'warning'); if (location.globalType) emit('globalRule', 'error', { reason: column.name }); }
      easingIssues(event, emit);
    }
    if (type === 'speedEvents' && location.layer > 0) emit('layerSpeed', 'warning');
    if (location.globalType) { try { validateGlobalEvent(event); } catch (error) { issues.push(diagnostic('globalRule', 'error', where, { reason: error.message })); } }
    if (end >= start) intervals.push({ start, end, where, event });
  }
  if (location.layer === 0 && BASE.includes(type) && !hasInitialValue) issues.push(missingBaselineIssue(type, location));
  if (type !== 'paintEvents' && location.noiseArea === undefined && !column?.overlap) {
    intervals.sort((a, b) => a.start - b.start || a.where.index - b.where.index);
    let furthest = -Infinity;
    for (const current of intervals) {
      if (current.end > current.start && current.start < furthest) issues.push(diagnostic('eventOverlap', 'error', current.where, { type }));
      if (current.end > current.start) furthest = Math.max(furthest, current.end);
    }
  }
  return issues;
}
function shaderParameterIssues(event, location, seconds, options) {
  const issues = [];
  const finite = value => typeof value === 'number' ? Number.isFinite(value) : typeof value === 'boolean' || typeof value === 'string' || Array.isArray(value) && value.every(finite);
  for (const [name, value] of Object.entries(event.vars ?? {})) {
    const path = `${location.path}.vars.${name}`;
    if (Array.isArray(value) && value.some(segment => segment && typeof segment === 'object' && !Array.isArray(segment))) {
      for (const [index, segment] of value.entries()) {
        const start = readBeat(segment?.startTime), end = readBeat(segment?.endTime), where = { ...location, path: `${path}[${index}]`, beat: Number.isFinite(start) ? start : 0, removable: false };
        const emit = code => issues.push(diagnostic(code, 'error', where));
        if (![start, end].every(Number.isFinite)) emit('beat');
        else { if (end < start) emit('eventTime'); if (seconds && outside(seconds(start), seconds(end), options, true)) emit('timeRange'); }
        if (!finite(segment?.start) || !finite(segment?.end)) emit('value');
        if (segment) easingIssues(segment, emit);
      }
    } else if (!finite(value)) issues.push(diagnostic('value', 'error', { ...location, path, removable: false }));
  }
  return issues;
}
function outside(start, end, options, interval = false) {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  const offset = options.offset ?? 0;
  return (interval ? end : start) + offset < -.01 - 1e-8 || Number.isFinite(options.duration) && options.duration > 0 && (interval ? start : end) + offset > options.duration + .05 + 1e-8;
}

function inspectLine(line, index, tempo, options) {
  const context = [tempo?.points, options.duration, options.offset, currentLocale().locale];
  // Cache by the source arrays, so changing a line label or selecting it does
  // not repeat note/track scans. Worker patches retain unchanged array identities.
  const refs = [line.notes, line.eventLayers, line.extended, line.bpmfactor, line.alphaControl, line.posControl, line.sizeControl, line.skewControl, line.yControl, ...context];
  const memo = lineCache.get(line);
  if (memo && memo.refs.every((v, i) => v === refs[i])) return memo.issues.map(issue => ({ ...issue, line: index }));
  const issues = [], factor = line.bpmfactor ?? 1, seconds = tempo && Number.isFinite(factor) && factor > 0 ? beat => tempo.seconds(beat, factor) : null;
  if (!Number.isFinite(factor) || factor <= 0) issues.push(diagnostic('value', 'error', { line: index, path: 'bpmfactor' }));
  if (line.anchor !== undefined && (!Array.isArray(line.anchor) || line.anchor.length !== 2 || !line.anchor.every(Number.isFinite)) || line.zOrder !== undefined && !Number.isFinite(line.zOrder)) issues.push(diagnostic('value', 'error', { line: index, path: 'line' }));
  const notes = list(line.notes), noteKey = [factor, ...context], noteMemo = noteCache.get(notes);
  if (noteMemo && noteMemo.key.every((v, i) => v === noteKey[i])) append(issues, noteMemo.issues.map(issue => ({ ...issue, line: index })));
  else {
  const firstIssue = issues.length, overlaps = noteOverlapIndices(notes);
  for (const [i, note] of notes.entries()) {
    const start = readBeat(note?.startTime), end = readBeat(note?.endTime), where = { line: index, index: i, beat: Number.isFinite(start) ? start : 0, path: `notes[${i}]`, removable: true };
    const emit = (code, severity = 'error') => issues.push(diagnostic(code, severity, where));
    if (!Number.isFinite(start) || !Number.isFinite(end)) { emit('beat'); continue; }
    if (end < start) issues.push(diagnostic('noteTime', 'error', where));
    if (note.type === 2 && end === start) issues.push(diagnostic('holdZero', 'warning', where));
    if (seconds && outside(seconds(start), seconds(end), options)) emit('timeRange');
    if (!fake(note) && Math.abs(note.positionX) > 700) issues.push(diagnostic('xRange', 'info', where));
    if (![1, 2, 3, 4].includes(note.type) || !Number.isFinite(note.positionX) || ['speed', 'size', 'alpha', 'yOffset', 'visibleTime', 'judgeArea'].some(key => note[key] !== undefined && !Number.isFinite(note[key]))) emit('value');
    if (note.above !== undefined && ![0, 1, 2].includes(Number(note.above)) || note.isFake !== undefined && ![0, 1].includes(Number(note.isFake))) emit('value');
    if (note.size === 0) emit('zeroWidth', 'warning');
    if (note.alpha > 255) emit('alphaRange', 'warning');
    if (note.visibleTime < 0 || note.size < 0) emit('valueRange', 'warning');
    for (const field of ['tint', 'color', 'tintHitEffects']) if (note[field] !== undefined && (!Array.isArray(note[field]) || note[field].length !== 3 || note[field].some(v => !Number.isFinite(v) || v < 0 || v > 255))) emit('valueRange', 'warning');
    if (overlaps.has(i)) issues.push(diagnostic('noteOverlap', 'warning', where));
  }
  noteCache.set(notes, { key: noteKey, issues: issues.slice(firstIssue) });
  }
  const inspectTrack = (events, type, location) => {
    if (!Array.isArray(events)) { if (location.layer === 0 && BASE.includes(type)) issues.push(missingBaselineIssue(type, location)); return; }
    const key = [type, location.layer, location.extended, factor, ...context], memo = trackCache.get(events);
    if (memo && memo.key.every((v, i) => v === key[i])) append(issues, memo.issues.map(issue => ({ ...issue, line: index })));
    else { const found = eventIssues(events, type, location, seconds, options); trackCache.set(events, { key, issues: found }); append(issues, found); }
  };
  const layers = list(line.eventLayers);
  for (let layer = 0; layer < Math.max(1, layers.length); layer++) for (const type of BASE) inspectTrack(layers[layer]?.[type], type, { line: index, layer });
  for (const type of EXTRA) inspectTrack(line.extended?.[type], type, { line: index, extended: true });
  for (const [i, event] of list(line.extended?.paintEvents).entries()) append(issues, shaderParameterIssues(event, { line: index, path: `paintEvents[${i}]`, extended: true }, seconds, options));
  for (const [name, key] of Object.entries({ alphaControl: 'alpha', posControl: 'pos', sizeControl: 'size', skewControl: 'skew', yControl: 'y' })) for (const [i, point] of list(line[name]).entries()) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point[key]) || point.easing !== undefined && (!Number.isInteger(point.easing) || point.easing < 1 || point.easing > 29)) issues.push(diagnostic('value', 'error', { line: index, path: `${name}[${i}]` }));
  }
  lineCache.set(line, { refs, issues }); return issues;
}
let tempoMemo;
export function diagnoseChart(chart, options = {}) {
  const issues = [], config = { ...options, offset: Number(chart.META?.offset ?? 0) / 1000 };
  if (!Number.isFinite(config.offset)) issues.push(diagnostic('value', 'error', { path: 'META.offset' }));
  let tempo;
  try { if (tempoMemo?.source !== chart.BPMList) tempoMemo = { source: chart.BPMList, tempo: new TempoMap(chart.BPMList) }; tempo = tempoMemo.tempo; }
  catch (error) { issues.push(diagnostic('value', 'error', { path: 'BPMList' }, { reason: error.message })); }
  const seen = new Set();
  for (const [index, entry] of list(chart.BPMList).entries()) {
    const beat = readBeat(entry.startTime); if (seen.has(beat)) issues.push(diagnostic('bpmDuplicate', 'info', { index, beat, path: `BPMList[${index}]`, removable: true })); seen.add(beat);
  }
  const lines = list(chart.judgeLineList);
  for (const [index, line] of lines.entries()) append(issues, inspectLine(line, index, tempo, config));
  // Resolve the parent graph once, including all descendants of a broken chain.
  const status = new Map();
  for (let i = 0; i < lines.length; i++) {
    if (status.has(i)) continue;
    const path = [], visiting = new Set(); let current = i, valid = true;
    while (current !== -1) {
      if (!Number.isInteger(current) || !lines[current] || visiting.has(current)) { valid = false; break; }
      if (status.has(current)) { valid = status.get(current); break; }
      visiting.add(current); path.push(current); current = lines[current].father ?? -1;
    }
    for (const index of path) status.set(index, valid);
  }
  for (const [line, valid] of status) if (!valid) issues.push(diagnostic('father', 'error', { line, path: 'father', removable: true }));
  append(issues, diagnoseNoiseAreas(chart.blockAreaList ?? []));
  for (const [i, area] of list(chart.blockAreaList).entries()) {
    const seconds = tempo ? beat => tempo.seconds(beat) : null;
    const a = readBeat(area.appearTime), b = readBeat(area.disappearTime);
    if (seconds && Number.isFinite(a) && Number.isFinite(b) && outside(seconds(a), seconds(b), config, true)) issues.push(diagnostic('timeRange', 'error', { noiseArea: i, path: `blockAreaList[${i}]`, removable: true }));
    for (const [type] of NOISE_TRACKS) append(issues, eventIssues(area[type], type, { noiseArea: i, noiseTrack: type, path: `blockAreaList[${i}].${type}` }, seconds, config));
  }
  const definitions = new Map(options.globalTypes?.map(type => [type.id, type]));
  for (const [typeId, type] of Object.entries(chart.globalEvents?.types ?? {})) {
    const registered = definitions.get(typeId);
    const source = type.source;
    if (options.globalTypes && source?.kind === 'mod' && !registered) issues.push(diagnostic('modMissing', 'warning', { path: 'globalEvents', globalType: typeId }, { name: `${source.name} (${source.author})` }));
    if (registered && (registered.source?.id !== source?.id || registered.source?.author !== source?.author)) issues.push(diagnostic('modMismatch', 'error', { path: 'globalEvents', globalType: typeId }));
    if (registered && registered.source?.version !== source?.version) issues.push(diagnostic('modVersion', 'warning', { path: 'globalEvents', globalType: typeId }, { version: source?.version, current: registered.source?.version }));
    for (const [columnId, column] of Object.entries(type.columns ?? {})) {
      const definition = registered?.columns.find(entry => entry.id === columnId);
      if (registered && !definition) issues.push(diagnostic('globalRule', 'error', { path: 'globalEvents', globalType: typeId, globalColumn: columnId }, { reason: columnId }));
      append(issues, eventIssues(column.events, columnId, { path: `globalEvents.${typeId}.${columnId}`, globalType: typeId, globalColumn: columnId, removable: false }, tempo && (beat => tempo.seconds(beat)), config, definition ?? { overlap: true, valueType: column.valueType ?? 'json' }));
    }
  }
  for (const [i, event] of [...list(chart.effects), ...list(chart.shaderEvents), ...list(chart.META?.effects)].entries()) {
    const time = value => Array.isArray(value) ? value : Number.isFinite(value) ? fromNumber(value) : [NaN, 0, 1];
    const normalized = { ...event, startTime: time(event.startTime ?? event.start ?? 0), endTime: time(event.endTime ?? event.end ?? 0) };
    append(issues, eventIssues([normalized], 'paintEvents', { line: Number.isInteger(event.line) ? event.line : 0, path: `effects.${i}`, removable: false }, tempo && (beat => tempo.seconds(beat)), config));
    append(issues, shaderParameterIssues(event, { line: Number.isInteger(event.line) ? event.line : 0, path: `effects.${i}` }, tempo && (beat => tempo.seconds(beat)), config));
  }
  return issues;
}
