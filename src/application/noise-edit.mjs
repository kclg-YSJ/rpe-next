import { createChart, createLine } from '../core/chart.mjs';
import { NOISE_TRACKS, NOISE_VERSION, validateNoiseArea } from '../core/noise-areas.mjs';
import { NOISE_LAYER_VERSION } from '../core/noise-skin.mjs';
import { beatValue } from '../core/beat.mjs';
import { compileExpression, compileBatchScript } from '../core/batch-script.mjs';
import { rebaseCustomEventValues } from '../core/event-easing.mjs';
import { batchDistribution, batchRandom, batchOperation, previewMultiEdit, EVENT_BATCH_FIELDS } from './multi-edit.mjs';
import { EditorSession } from './session.mjs';
import { cutSelectedEvents, stickSelectedEvents, stickSelectedEventToNext } from './event-tools.mjs';
import { t } from '../i18n.mjs';

export const NOISE_EDIT_TYPES = NOISE_TRACKS.slice(1);
export const NOISE_POSITION_TYPES = [
  ['bottomLeft.x', t('noise-batch.bottomLeftX')], ['bottomLeft.y', t('noise-batch.bottomLeftY')],
  ['topRight.x', t('noise-batch.topRightX')], ['topRight.y', t('noise-batch.topRightY')],
];
const positionPaths = new Map(NOISE_POSITION_TYPES.map(([type]) => [type, type.split('.')]));
export const isNoisePositionType = type => positionPaths.has(type);
const allowed = new Set(NOISE_EDIT_TYPES.map(([type]) => type));
function editedNoiseChart(chart, areas, changed) {
  for (const index of changed) validateNoiseArea(areas[index], `blockAreaList[${index}]`);
  return { ...chart, META: { ...chart.META, RPEVersion: Math.max(chart.META.RPEVersion ?? 0, chart.noiseAreaLayers ? NOISE_LAYER_VERSION : NOISE_VERSION) }, blockAreaList: areas };
}
export function captureNoiseEdit(editor) {
  const chart = editor.context.session.chart, area = editor.selected, keys = new Set(editor.selection);
  const areas = [...keys].filter(key => key.startsWith('area:')).map(key => Number(key.slice(5))).filter(index => chart.blockAreaList?.[index]);
  return { chart, area, keys, areas, mode: areas.length ? 'areas' : 'events' };
}
function projectedSession(snapshot) {
  const area = snapshot.chart.blockAreaList?.[snapshot.area];
  if (!area) throw Error(t('noise-area.sbbb578e'));
  const chart = createChart(), line = createLine(); chart.META = snapshot.chart.META; chart.BPMList = snapshot.chart.BPMList;
  line.eventLayers = [Object.fromEntries(NOISE_EDIT_TYPES.slice(0, 3).map(([type]) => [type, area[type] ?? []]))];
  line.extended = Object.fromEntries(NOISE_EDIT_TYPES.slice(3).map(([type]) => [type, area[type] ?? []])); chart.judgeLineList = [line];
  const session = new EditorSession(chart); session.focus = 'events';
  session.eventSelection = new Set([...snapshot.keys].filter(key => allowed.has(key.split(':')[0])));
  return session;
}
function projectedTrack(chart, type) { return type.startsWith('scale') ? chart.judgeLineList[0].extended[type] : chart.judgeLineList[0].eventLayers[0][type]; }
function projectedResult(snapshot, chart, keys, changes = []) {
  const source = snapshot.chart.blockAreaList[snapshot.area], area = { ...source };
  for (const [type] of NOISE_EDIT_TYPES) {
    const events = projectedTrack(chart, type) ?? [];
    if (events !== (source[type] ?? []) && (source[type] || events.length)) area[type] = events;
  }
  const areas = [...snapshot.chart.blockAreaList]; areas[snapshot.area] = area;
  return { source: snapshot.chart, chart: editedNoiseChart(snapshot.chart, areas, [snapshot.area]), changes, selected: snapshot.area, keys: new Set([...snapshot.keys].filter(key => key.startsWith('activeIntervals:')).concat([...keys])) };
}
export function previewNoiseEdit(snapshot, options = {}) {
  if (snapshot.mode === 'events') {
    if (options.field === 'line') throw Error(t('noise-batch.chooseType'));
    if (options.mode === 'script') compileBatchScript(options.script ?? '', EVENT_BATCH_FIELDS.map(([key]) => key).filter(key => !['line', 'both', 'order'].includes(key)).concat('inst'));
    const session = projectedSession(snapshot);
    const events = [...session.eventSelection].flatMap(key => { const [type, index] = key.split(':'); const event = projectedTrack(session.chart, type)?.[Number(index)]; return event ? [{ type, index: Number(index), lineIndex: 0, event }] : []; });
    if (events.length > 100000) throw Error(t('noise-batch.limit'));
    const result = previewMultiEdit({ chart: session.chart, lineIndex: 0, eventLayer: 0, events, notes: [], focus: 'events' }, 'events', options);
    for (const change of result.changes) {
      const next = rebaseCustomEventValues(change.before, change.after);
      if (next !== change.after) projectedTrack(result.chart, change.type)[change.index] = next;
      change.after = next;
    }
    return projectedResult(snapshot, result.chart, session.eventSelection, result.changes);
  }
  const type = options.eventType;
  const positionPath = positionPaths.get(type);
  if (!allowed.has(type) && !positionPath) throw Error(t('noise-batch.chooseType'));
  if (snapshot.areas.length > 100000) throw Error(t('noise-batch.limit'));
  const condition = options.condition?.trim() ? compileExpression(options.condition) : () => 1;
  const source = snapshot.chart.blockAreaList, areas = [...source], changes = [];
  const order = snapshot.areas.toSorted((a, b) => beatValue(source[a].appearTime) - beatValue(source[b].appearTime) || a - b);
  const entries = order.filter((area, i) => condition({ i, n: i + 1, N: order.length, u: order.length > 1 ? i / (order.length - 1) : 0, area, t: beatValue(source[area].appearTime) }));
  const distribution = batchDistribution(options, batchRandom(options.seed ?? 1));
  const script = options.mode === 'script' ? compileBatchScript(options.script ?? '', ['value']) : null;
  if (script && !script.length) throw Error(t('multi-edit.s963208d'));
  for (const [i, index] of entries.entries()) {
    const scope = { i, n: i + 1, N: entries.length, u: entries.length > 1 ? i / (entries.length - 1) : 0, area: index, t: beatValue(source[index].appearTime), value: 0 };
    let value = script ? 0 : distribution(i, (i + 1) / entries.length);
    if (script) for (const statement of script) {
      const next = statement.evaluate(scope);
      scope.value = statement.operator === '=' ? next : statement.operator === '+=' ? scope.value + next : statement.operator === '-=' ? scope.value - next : statement.operator === '*=' ? scope.value * next : scope.value / next;
      value = scope.value;
    }
    if (value === null) continue;
    if (!Number.isFinite(value)) throw Error(t('multi-edit.sfaa68de', { p0: 'value' }));
    if (positionPath) {
      const [corner, axis] = positionPath, before = source[index][corner][axis];
      const after = batchOperation(before, value, options.operation ?? 'By');
      areas[index] = { ...source[index], [corner]: { ...source[index][corner], [axis]: after } };
      changes.push({ area: index, type, before, after });
      continue;
    }
    const events = source[index][type] ?? [];
    if (changes.length + events.length > 100000) throw Error(t('noise-batch.limit'));
    if (!events.length) continue;
    areas[index] = { ...source[index], [type]: events.map((before, eventIndex) => {
      const after = rebaseCustomEventValues(before, { ...before, start: batchOperation(before.start, value, options.operation ?? 'By'), end: batchOperation(before.end, value, options.operation ?? 'By') });
      changes.push({ area: index, type, index: eventIndex, before, after }); return after;
    }) };
  }
  if (!changes.length) throw Error(t('multi-edit.sdd2c6a4'));
  return { source: snapshot.chart, chart: editedNoiseChart(snapshot.chart, areas, new Set(changes.map(change => change.area))), changes, selected: snapshot.area, keys: snapshot.keys };
}
export function noiseEventTool(snapshot, action, options = {}) {
  const session = projectedSession(snapshot), before = session.chart;
  let report;
  if (action === 'cut') report = cutSelectedEvents(session, options);
  else if (action === 'stick') report = stickSelectedEvents(session);
  else if (action === 'next') report = { changed: Number(stickSelectedEventToNext(session)) };
  if (session.chart === before) return { report };
  if (action !== 'cut') for (const [type] of NOISE_EDIT_TYPES) {
    const old = projectedTrack(before, type) ?? [], next = projectedTrack(session.chart, type) ?? [];
    if (next !== old) next.forEach((event, index) => { if (event !== old[index]) next[index] = rebaseCustomEventValues(old[index], event); });
  }
  return { ...projectedResult(snapshot, session.chart, session.eventSelection), report };
}
export function mirrorNoiseEvent(type, source) {
  let event = structuredClone(source);
  if (type === 'moveXEvents' || type === 'rotateEvents') {
    event.start = -source.start; event.end = -source.end;
    for (const field of ['transformStart', 'transformEnd']) if (Number.isFinite(source[field])) event[field] = -source[field];
    event = rebaseCustomEventValues(source, event);
  }
  if (event.anchor) event.anchor.x = -event.anchor.x;
  return event;
}
export function mirrorNoiseArea(source) {
  return { ...source, bottomLeft: { ...source.bottomLeft, x: -source.topRight.x }, topRight: { ...source.topRight, x: -source.bottomLeft.x },
    ...Object.fromEntries(NOISE_EDIT_TYPES.map(([type]) => [type, (source[type] ?? []).map(event => mirrorNoiseEvent(type, event))])) };
}
export function applyNoiseEdit(editor, result, label = t('noise-batch.apply')) {
  const session = editor.context.session;
  if (!result?.chart) return false;
  if (session.chart !== result.source) throw Error(t('noise-batch.stale'));
  const before = { selected: editor.selected, event: editor.event, keys: new Set(editor.selection) };
  const after = { selected: result.selected, keys: result.keys, event: [...result.keys].filter(key => !key.startsWith('area:')).map(key => { const [type, index] = key.split(':'); return { type, index: Number(index) }; })[0] ?? null };
  const restore = value => { editor.selected = value.selected; editor.event = value.event; editor.selection = new Set(value.keys); editor.draftChart = null; };
  session.commit(label, result.chart);
  if (session.chart === result.source) return false;
  const auxiliary = { undo: () => restore(before), redo: () => restore(after) };
  const command = session.collaboration?.queue?.at(-1) ?? session.history.undoStack.at(-1);
  if (command) {
    const previous = command.auxiliary;
    command.auxiliary = { undo: () => { previous?.undo(); auxiliary.undo(); }, redo: () => { previous?.redo(); auxiliary.redo(); } };
  }
  restore(after); editor.render(); editor.invalidate(); return true;
}
