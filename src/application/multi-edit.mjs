import { beatValue, fromNumber } from '../core/beat.mjs';
import { assertChart } from '../core/chart.mjs';
import { integerAlphaEvent, integerNoteAlpha } from '../core/alpha-values.mjs';
import { easing } from '../core/easing.mjs';
import { compileExpression, compileBatchScript } from '../core/batch-script.mjs';
import { alignShaderParameters } from '../core/shader-events.mjs';
import { eventList, eventKey, chartWithEventLists } from './event-commands.mjs';
import { t } from '../i18n.mjs';

export const NOTE_BATCH_FIELDS = [
  ['x', t('multi-edit.s663ad0d')], ['speed', t('multi-edit.s0125bc6')], ['size', t('multi-edit.s34a6f69')], ['yOffset', t('multi-edit.saaf45bc')],
  ['visibleTime', t('multi-edit.s35fe5a7')], ['alpha', t('multi-edit.se498bbe')], ['t1', t('multi-edit.saaf45f4')], ['t2', t('multi-edit.sca5cb8c')],
  ['line', t('multi-edit.sfae5957')], ['hitSound', t('multi-edit.s2482510')], ['judgeArea', t('multi-edit.s7849633')],
  ['red', 'Red'], ['green', 'Green'], ['blue', 'Blue'],
];
export const EVENT_BATCH_FIELDS = [
  ['both', t('multi-edit.sb9b4ab9')], ['end', t('multi-edit.s02341a7')], ['start', t('multi-edit.sb577153')], ['easing', t('multi-edit.s866ddab')],
  ['t1', t('multi-edit.s0e1d000')], ['t2', t('multi-edit.s9ad044e')], ['line', t('multi-edit.s72b16cf')],
  ['linkgroup', t('multi-edit.s150e064')], ['duration', t('multi-edit.sad26cd1')], ['order', t('multi-edit.s06528e5')],
];
export const EVENT_BATCH_TYPES = [
  ['all', t('multi-edit.s778fc8f')], ['moveXEvents', 'X'], ['moveYEvents', 'Y'], ['rotateEvents', t('multi-edit.sa69e51e')], ['alphaEvents', t('multi-edit.s61b101b')],
  ['speedEvents', t('multi-edit.sf2fdffb')], ['scaleXEvents', t('multi-edit.s4175cf1')], ['scaleYEvents', t('multi-edit.sd55daa9')], ['paintEvents', t('multi-edit.s14f807e')],
  ['colorEvents', t('multi-edit.s8ef4886')], ['textEvents', t('multi-edit.sf4d3dab')],
];
export const BATCH_OPERATIONS = [['By', t('multi-edit.s798a5de')], ['To', t('multi-edit.s1cf4382')], ['Times', t('multi-edit.s2f757ce')], ['Max', t('multi-edit.s63f1ded')], ['Min', t('multi-edit.se76be40')], ['Flip', t('multi-edit.s1e32eeb')]];

export function batchOperation(before, value, operation) {
  switch (operation) {
    case 'By': return before + value; case 'To': return value; case 'Times': return before * value;
    case 'Max': return Math.max(before, value); case 'Min': return Math.min(before, value); case 'Flip': return value * 2 - before;
    default: throw new Error(t('multi-edit.s5b57638'));
  }
}

function sequence(text, fallback, skip = false) {
  const parts = String(text ?? '').trim().split(/[\s,，]+/).filter(Boolean);
  return parts.length ? parts.map(part => skip && part === '_' ? null : compileExpression(part)({})) : fallback;
}

function randomSource(seed) {
  let state = Number(seed) >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}

function distribution(options, random) {
  const lower = compileExpression(String(options.lower ?? 0))({});
  const upper = compileExpression(String(options.upper ?? 0))({});
  const cycle = sequence(options.cycle, [1], true); const disturbance = sequence(options.disturbance, []);
  const easingType = Number(options.easingType ?? 1);
  if (!Number.isInteger(easingType) || easingType < 1 || easingType > 29) throw new Error(t('multi-edit.s149b25e'));
  return (index, progress) => {
    const multiplier = cycle[index % cycle.length]; if (multiplier === null) return null;
    let value = lower + (upper - lower) * easing(progress, easingType);
    if (disturbance.length === 1) value += (random() * 2 - 1) * disturbance[0];
    else if (disturbance.length === 2) value += disturbance[0] + random() * (disturbance[1] - disturbance[0]);
    else if (disturbance.length) value += disturbance[Math.floor(random() * disturbance.length)];
    return value * multiplier;
  };
}

function scopeFor(item, kind, line, index, count) {
  const start = beatValue(item.startTime); const end = beatValue(item.endTime);
  const scope = { n: kind === 'notes' ? index : index + 1, i: index, N: count, u: count > 1 ? index / (count - 1) : 0,
    line, t: start, t1: start, t2: end, 'st.time': start, 'ed.time': end, duration: end - start };
  if (kind === 'notes') return { ...scope, x: item.positionX, speed: item.speed ?? 1, size: item.size ?? 1,
    yOffset: item.yOffset ?? 0, visibleTime: item.visibleTime ?? 999999, alpha: item.alpha ?? 255,
    judgeArea: item.judgeArea ?? 1, red: (item.tint ?? item.color)?.[0] ?? 255, green: (item.tint ?? item.color)?.[1] ?? 255, blue: (item.tint ?? item.color)?.[2] ?? 255,
    type: item.type, isFake: item.isFake ?? 0, above: item.above ?? 1,
    v: item.speed ?? 1, w: item.size ?? 1, width: item.size ?? 1, yoffset: item.yOffset ?? 0, vt: item.visibleTime ?? 999999 };
  return { ...scope, start: item.start, end: item.end, 'st.x': item.start, 'ed.x': item.end,
    easing: item.easingType ?? 1, linkgroup: item.linkgroup ?? 0, inst: item.inst ?? 0, order: scope.u };
}

function writeField(item, field, value) {
  if (field === 't1' || field === 't2') item[field === 't1' ? 'startTime' : 'endTime'] = fromNumber(value);
  else if (field === 'duration') item.endTime = fromNumber(beatValue(item.startTime) + Math.max(0, value));
  else if (field === 'both') { item.start = value; item.end = value; }
  else if (['red', 'green', 'blue'].includes(field)) {
    item.tint = [...(item.tint ?? item.color ?? [255, 255, 255])]; item.tint[['red', 'green', 'blue'].indexOf(field)] = Math.max(0, Math.min(255, Math.trunc(value)));
  } else item[field === 'x' ? 'positionX' : field === 'easing' ? 'easingType' : field] = value;
}

function validateChange(change, lineCount, snapshot) {
  if (change.kind === 'notes') change.after = integerNoteAlpha(change.after);
  else if (change.type === 'alphaEvents') change.after = integerAlphaEvent(change.after);
  const { after, kind, type } = change;
  if (!Number.isInteger(change.lineIndex) || change.lineIndex < 0 || change.lineIndex >= lineCount) throw new Error(t('multi-edit.s35d8e57', { p0: change.lineIndex }));
  if (kind === 'notes') {
    if (![1, 2, 3, 4].includes(after.type)) throw new Error(t('multi-edit.s8872b88'));
    if (![0, 1, 2].includes(after.above ?? 1) || ![0, 1].includes(after.isFake ?? 0)) throw new Error(t('multi-edit.s6d1382d'));
    after.above = (after.above ?? 1) === 1 ? 1 : after.type === 2 ? 0 : 2;
    if (after.type === 2 && change.before.type !== 2 && beatValue(after.endTime) === beatValue(after.startTime)) after.endTime = fromNumber(beatValue(after.startTime) + 0.25);
  }
  if (kind === 'notes' && after.type !== 2) {
    if (beatValue(after.startTime) === beatValue(change.before.startTime) && beatValue(after.endTime) !== beatValue(change.before.endTime)) after.startTime = [...after.endTime];
    else after.endTime = [...after.startTime];
  }
  if (beatValue(after.endTime) < beatValue(after.startTime)) throw new Error(t('multi-edit.sffce99d'));
  if (kind === 'events' && after.inst && JSON.stringify(after.start) !== JSON.stringify(after.end)) after.inst = 0;
  if (kind === 'events' && ![0, 1, false, true].includes(after.inst ?? 0)) throw new Error(t('multi-edit.s41eaccc'));
  if (kind === 'events' && type === 'paintEvents' && snapshot.shaderAutoAlign !== false && beatValue(after.startTime) !== beatValue(change.before.startTime)) change.after = alignShaderParameters(after);
  for (const [key, value] of Object.entries(change.after)) if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(t('multi-edit.sbb4b7da', { p0: key }));
  if (after.easingType !== undefined && (!Number.isInteger(after.easingType) || after.easingType < 1 || after.easingType > 29)) throw new Error(t('multi-edit.s5aa429b'));
}

function assemble(snapshot, changes, kind, removeSource = false) {
  let chart = snapshot.chart;
  const selection = new Set(kind === 'notes' ? snapshot.notes.map(entry => entry.index) : []);
  const eventSelection = new Set(kind === 'events' && !removeSource ? snapshot.events.filter(entry => (entry.lineIndex ?? snapshot.lineIndex) === snapshot.lineIndex).map(entry => eventKey(entry.type, entry.index)) : []);
  const sourceEventLines = new Set(snapshot.events.map(entry => Number.isInteger(entry.lineIndex) ? entry.lineIndex : snapshot.lineIndex));
  const affected = new Set(changes.flatMap(change => [snapshot.lineIndex, change.lineIndex, ...(kind === 'events' ? sourceEventLines : [])]));
  const notesByLine = new Map(); const eventsByLine = new Map();
  const selectedNotes = new Set(snapshot.notes.map(entry => entry.index));
  const noteUpdates = new Map(changes.filter(change => !change.copy).map(change => [change.index, change]));
  for (const lineIndex of affected) {
    const line = chart.judgeLineList[lineIndex];
    if (kind === 'notes') {
      const notes = []; if (lineIndex === snapshot.lineIndex) selection.clear();
      (line.notes ?? []).forEach((note, index) => {
        const change = lineIndex === snapshot.lineIndex ? noteUpdates.get(index) : null;
        if (change && change.lineIndex !== lineIndex) return;
        if (lineIndex === snapshot.lineIndex && selectedNotes.has(index)) selection.add(notes.length);
        notes.push(change?.after ?? note);
      });
      notesByLine.set(lineIndex, notes);
    } else eventsByLine.set(lineIndex, new Map());
  }
  if (removeSource) {
    const selected = new Map();
    for (const entry of snapshot.events) {
      const lineIndex = Number.isInteger(entry.lineIndex) ? entry.lineIndex : snapshot.lineIndex;
      const key = `${lineIndex}:${entry.type}`;
      if (!selected.has(key)) selected.set(key, { lineIndex, type: entry.type, indices: new Set() });
      selected.get(key).indices.add(entry.index);
    }
    for (const { lineIndex, type, indices } of selected.values()) {
      const original = eventList({ chart, lineIndex, line: chart.judgeLineList[lineIndex], eventLayer: snapshot.eventLayer }, type);
      eventsByLine.get(lineIndex)?.set(type, original.filter((event, index) => !indices.has(index)));
    }
  }
  for (const change of changes) {
    if (kind === 'notes') {
      if (change.lineIndex !== snapshot.lineIndex || change.copy) {
        const notes = notesByLine.get(change.lineIndex);
        if (change.lineIndex === snapshot.lineIndex) selection.add(notes.length);
        notes.push(change.after);
      }
    } else {
      const updates = eventsByLine.get(change.lineIndex);
      if (!updates.has(change.type)) updates.set(change.type, [...eventList({ chart, lineIndex: change.lineIndex, line: chart.judgeLineList[change.lineIndex], eventLayer: snapshot.eventLayer }, change.type)]);
      const events = updates.get(change.type);
      if (change.copy) {
        if (change.lineIndex === snapshot.lineIndex) eventSelection.add(eventKey(change.type, events.length));
        events.push(change.after);
      } else events[change.index] = change.after;
    }
  }
  if (notesByLine.size) chart = { ...chart, judgeLineList: chart.judgeLineList.map((line, index) => notesByLine.has(index) ? { ...line, notes: notesByLine.get(index), numOfNotes: notesByLine.get(index).length } : line) };
  for (const [lineIndex, updates] of eventsByLine) if (updates.size) chart = chartWithEventLists(chart, lineIndex, snapshot.eventLayer, updates);
  assertChart(chart);
  const multiEventSelection = new Map();
  if (kind === 'events' && !removeSource) {
    for (const change of changes) {
      if (!change.copy) {
        const lineIndex = Number.isInteger(change.lineIndex) ? change.lineIndex : snapshot.lineIndex;
        if (!multiEventSelection.has(lineIndex)) multiEventSelection.set(lineIndex, new Set());
        multiEventSelection.get(lineIndex).add(eventKey(change.type, change.index));
      }
    }
  }
  return { chart, lineIndex: snapshot.lineIndex, eventLayer: snapshot.eventLayer, focus: kind, selection, eventSelection, multiEventSelection, changes };
}

export function previewMultiEdit(snapshot, kind, options = {}) {
  const field = options.field ?? (kind === 'notes' ? 'x' : 'both'); const operation = options.operation ?? 'By';
  const scriptMode = options.mode === 'script';
  const fields = (kind === 'notes' ? NOTE_BATCH_FIELDS : EVENT_BATCH_FIELDS).map(([key]) => key).filter(key => !['hitSound', 'both', 'order'].includes(key));
  if (kind === 'notes') fields.push('type', 'isFake', 'above'); else fields.push('inst');
  const script = scriptMode ? compileBatchScript(options.script ?? '', fields) : [];
  if (scriptMode && !script.length) throw new Error(t('multi-edit.s963208d'));
  const condition = options.condition?.trim() ? compileExpression(options.condition) : () => 1;
  const random = randomSource(options.seed ?? 1);
  const modifier = scriptMode || field === 'hitSound' ? null : distribution(options, random);
  const groups = new Map();
  const applicationMode = kind === 'events' && options.eventApplicationMode === 'global' ? 'global' : 'per-line';
  for (const entry of kind === 'notes' ? snapshot.notes : snapshot.events) {
    if (kind === 'notes' && Number(options.noteType) && entry.note.type !== Number(options.noteType)) continue;
    if (kind === 'events' && options.eventType && options.eventType !== 'all' && options.eventType !== entry.type) continue;
    const sourceLine = Number.isInteger(entry.lineIndex) ? entry.lineIndex : snapshot.lineIndex;
    const key = kind === 'notes' ? 'notes' : applicationMode === 'global' ? entry.type : `${sourceLine}:${entry.type}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...entry, before: entry.note ?? entry.event });
  }
  const changes = [];
  for (const entries of groups.values()) {
    entries.sort((left, right) => beatValue(left.before.startTime) - beatValue(right.before.startTime) || left.index - right.index);
    const filtered = entries.filter((entry, index) => condition(scopeFor(entry.before, kind, Number.isInteger(entry.lineIndex) ? entry.lineIndex : snapshot.lineIndex, index, entries.length)));
    let time = filtered.length ? beatValue(filtered[0].before.startTime) : 0;
    const groupChanges = [];
    filtered.forEach((entry, index) => {
      const sourceLine = Number.isInteger(entry.lineIndex) ? entry.lineIndex : snapshot.lineIndex;
      const after = structuredClone(entry.before); const scope = scopeFor(after, kind, sourceLine, index, filtered.length);
      const change = { kind, type: entry.type, index: entry.index, before: entry.before, after, lineIndex: sourceLine, copy: false };
      if (scriptMode) {
        for (const statement of script) {
          const value = statement.evaluate(scope); const previous = scope[statement.field];
          const next = statement.operator === '=' ? value : statement.operator === '+=' ? previous + value : statement.operator === '-=' ? previous - value : statement.operator === '*=' ? previous * value : previous / value;
          if (!Number.isFinite(next)) throw new Error(t('multi-edit.sfaa68de', { p0: statement.field }));
          if (statement.field === 'line') { change.lineIndex = Math.round(next); change.copy = kind === 'events'; }
          else writeField(after, statement.field, next);
          Object.assign(scope, scopeFor(after, kind, change.lineIndex, index, filtered.length));
        }
      } else if (field === 'hitSound') {
        if (operation !== 'To') throw new Error(t('multi-edit.sb1c01c7'));
        after.hitSound = String(options.lower || options.upper || '');
      } else {
        const endpointDistribution = kind === 'notes' || ['line', 'duration', 'order'].includes(field);
        const progress = endpointDistribution ? scope.u : (index + 1) / filtered.length;
        const value = modifier(index, progress); if (value === null) return;
        if (field === 'line') { change.lineIndex = Math.round(batchOperation(sourceLine, value, operation)); change.copy = kind === 'events'; }
        else if (field === 'both') {
          if (typeof after.start !== 'number' || typeof after.end !== 'number') throw new Error(t('multi-edit.sac3b03e'));
          after.start = batchOperation(after.start, value, operation); after.end = batchOperation(after.end, value, operation);
        } else if (field === 'duration' && kind === 'events') {
          const duration = Math.max(0, batchOperation(scope.duration, value, operation));
          after.startTime = fromNumber(time); after.endTime = fromNumber(time + duration); time += duration;
        } else if (field === 'order') change.priority = batchOperation(scope.u, value, operation);
        else {
          if (typeof scope[field] !== 'number') throw new Error(t('multi-edit.sfe2eaba'));
          writeField(after, field, batchOperation(scope[field], value, operation));
        }
      }
      groupChanges.push(change);
    });
    if (!scriptMode && field === 'order') {
      const ordered = groupChanges.toSorted((left, right) => left.priority - right.priority);
      groupChanges.forEach((change, index) => { change.after = { ...structuredClone(ordered[index].before), startTime: [...change.before.startTime], endTime: [...change.before.endTime] }; });
    }
    for (const change of groupChanges) { validateChange(change, snapshot.chart.judgeLineList.length, snapshot); changes.push(change); }
  }
  if (!changes.length) throw new Error(t('multi-edit.sdd2c6a4'));
  return assemble(snapshot, changes, kind);
}

export function previewEventClones(snapshot, options = {}) {
  const targets = sequence(options.targets, []);
  if (!targets.length) throw new Error(t('multi-edit.s79fc9c9'));
  if (targets.some(value => !Number.isInteger(value) || value < 0 || value >= snapshot.chart.judgeLineList.length)) throw new Error(t('multi-edit.s3003deb'));
  if (!snapshot.events.length) throw new Error(t('multi-edit.s7ae99ea'));
  if (targets.length * snapshot.events.length > 100000) throw new Error(t('multi-edit.s5042d52'));
  const increment = compileExpression(String(options.increment ?? 0))({}) / Math.max(1, options.division ?? 4);
  const random = randomSource(options.seed ?? 1); const modifiers = new Map();
  for (const type of ['moveXEvents', 'moveYEvents', 'rotateEvents', 'alphaEvents']) modifiers.set(type, distribution(options.channels?.[type] ?? {}, random));
  const changes = [];
  for (const { type, index, event } of snapshot.events) {
    targets.forEach((lineIndex, targetIndex) => {
      const offset = targetIndex * increment; const after = structuredClone(event);
      after.startTime = fromNumber(beatValue(event.startTime) + offset); after.endTime = fromNumber(beatValue(event.endTime) + offset);
      const modifier = modifiers.get(type);
      if (modifier) { const value = modifier(targetIndex, targets.length > 1 ? targetIndex / (targets.length - 1) : 0); if (value !== null) { after.start += value; after.end += value; } }
      const change = { kind: 'events', type, index, before: event, after, lineIndex, copy: true };
      validateChange(change, snapshot.chart.judgeLineList.length, snapshot); changes.push(change);
    });
  }
  return assemble(snapshot, changes, 'events', options.retainSource === false);
}
