import { beatValue, fromNumber } from './beat.mjs';
import { integerChartAlpha } from './alpha-values.mjs';
import { TempoMap } from './tempo.mjs';
import { sampleCurveTrajectory } from './curve-trajectory.mjs';
import { trajectorySplitSettings } from './trajectory-simplify.mjs';
import { validateNoiseAreas, diagnoseNoiseAreas, normalizeNoiseAreas, NOISE_VERSION } from './noise-areas.mjs';
import { validateNoiseLayers, NOISE_LAYER_VERSION } from './noise-skin.mjs';
import { emitModHook } from './mod-hooks.mjs';
import { validateGlobalEvents, GLOBAL_EVENT_VERSION } from './global-events.mjs';
import { t } from '../i18n.mjs';

export const EVENT_TYPES = ['moveXEvents', 'moveYEvents', 'rotateEvents', 'alphaEvents', 'speedEvents'];
export const EXTENDED_TYPES = ['scaleXEvents', 'scaleYEvents', 'colorEvents', 'paintEvents', 'textEvents', 'inclineEvents', 'gifEvents'];
export const NOTE_NAMES = { 1: 'Tap', 2: 'Hold', 3: 'Flick', 4: 'Drag' };

export function createEvent(start = 0, end = start, startBeat = 0, endBeat = startBeat + 1) {
  return { startTime: fromNumber(startBeat), endTime: fromNumber(endBeat), start, end, easingType: 1,
    easingLeft: 0, easingRight: 1, bezier: 0, bezierPoints: [0, 0, 1, 1], linkgroup: 0 };
}

export function createLine(name = '判定线') {
  const layer = Object.fromEntries(EVENT_TYPES.map(type => [type, [createEvent(type === 'alphaEvents' ? 255 : type === 'speedEvents' ? 10 : 0, undefined, 0, 1)]]));
  return { Name: name, Group: 0, Texture: 'line.png', bpmfactor: 1, father: -1, rotateWithFather: true,
    isCover: 1, zOrder: 0, anchor: [0.5, 0.5], isGif: false, eventLayers: [layer], extended: {}, notes: [], numOfNotes: 0 };
}

// Stored in new charts so older builds show a readable name. The editor swaps
// this sentinel for the localized "Untitled chart" when displaying it.
export const DEFAULT_CHART_NAME = '未命名谱面';

export function createChart() {
  return { META: { RPEVersion: 170, name: DEFAULT_CHART_NAME, composer: '', charter: '', illustration: '', level: '', song: '', background: '', offset: 0 },
    BPMList: [{ bpm: 120, startTime: [0, 0, 1] }], judgeLineGroup: ['Default'], judgeLineList: [createLine('Line 1')], blockAreaList: [] };
}

export function createNote(type, beat, positionX, endBeat = beat + 1) {
  return { type, startTime: fromNumber(beat), endTime: fromNumber(type === 2 ? endBeat : beat), positionX,
    above: 1, isFake: 0, speed: 1, size: 1, yOffset: 0, visibleTime: 999999, alpha: 255 };
}

export function parseChart(text) {
  let chart;
  try { chart = JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch { throw new Error(t('chart.sa8af1fb')); }
  if (chart.blockAreaList != null) chart.blockAreaList = normalizeNoiseAreas(chart.blockAreaList);
  assertChart(chart);
  return integerChartAlpha(chart);
}

export function noteIsAbove(note) {
  return Number(note.above ?? 1) === 1;
}

export function serializeChart(chart, { compact = false } = {}) {
  const custom=emitModHook('chart:serialize',{chart,compact,text:null});if(custom.text!==null)return String(custom.text);chart=custom.chart;compact=custom.compact;
  assertChart(chart);
  chart = integerChartAlpha(chart);
  const version = Math.max(chart.META.RPEVersion ?? 0, chart.globalEvents ? GLOBAL_EVENT_VERSION : 0, chart.noiseAreaLayers ? NOISE_LAYER_VERSION : chart.blockAreaList?.length ? NOISE_VERSION : 0);
  const snapshot = version !== chart.META.RPEVersion ? { ...chart, META: { ...chart.META, RPEVersion: version } } : chart;
  return stringifyPreservingNumbers(snapshot, compact ? 0 : 2) + (compact ? '' : '\n');
}

export function stringifyPreservingNumbers(value, space = 2) {
  const ordinary = JSON.stringify(value, null, space);
  let marker = '\u0000rpe-negative-zero\u0000';
  while (ordinary.includes(JSON.stringify(marker))) marker += '#';
  return JSON.stringify(value, (key, entry) => Object.is(entry, -0) ? marker : entry, space).replaceAll(JSON.stringify(marker), '-0');
}

export function assertChart(chart) {
  const validation=emitModHook('chart:validate',{chart,handled:false});if(validation.handled)return validation.chart;
  if (!chart || typeof chart !== 'object' || !chart.META || typeof chart.META !== 'object' || Array.isArray(chart.META)) throw new Error(t('chart.sd96a82c'));
  if (chart.judgeLineList != null && !Array.isArray(chart.judgeLineList)) throw new Error(t('chart.se63fe61'));
  new TempoMap(chart.BPMList);
  if (chart.META.offset !== undefined && !Number.isFinite(chart.META.offset)) throw new Error(t('chart.s0f9216b'));
  if (chart.blockAreaList != null) validateNoiseAreas(chart.blockAreaList);
  validateNoiseLayers(chart);
  validateGlobalEvents(chart);
  if (chart.noiseAreaOptions !== undefined) {
    if (!chart.noiseAreaOptions || typeof chart.noiseAreaOptions !== 'object' || Array.isArray(chart.noiseAreaOptions)) throw new Error(t('chart.s9704a67'));
    for (const key of ['ignoreTripleInversion']) if (chart.noiseAreaOptions[key] !== undefined && typeof chart.noiseAreaOptions[key] !== 'boolean') throw new Error('noiseAreaOptions.' + key + t('chart.sdb758e5'));
  }
  (chart.judgeLineList ?? []).forEach((line, lineIndex) => {
    const path = `judgeLineList[${lineIndex}]`;
    if (!line || typeof line !== 'object') throw new Error(t('chart.s587a0b4', { p0: path }));
    if (line.bpmfactor !== undefined && (!Number.isFinite(line.bpmfactor) || line.bpmfactor <= 0)) throw new Error(t('chart.s5b181b6', { p0: path }));
    if (line.anchor !== undefined && (!Array.isArray(line.anchor) || line.anchor.length !== 2 || !line.anchor.every(Number.isFinite))) throw new Error(t('chart.s21228c4', { p0: path }));
    if (line.notes != null && !Array.isArray(line.notes)) throw new Error(t('chart.s3fc86e5', { p0: path }));
    for (const [index, note] of (line.notes ?? []).entries()) {
      if (!note || typeof note !== 'object') throw new Error(t('chart.sb457910', { p0: path, p1: index }));
      beatValue(note.startTime, `${path}.notes[${index}].startTime`);
      beatValue(note.endTime, `${path}.notes[${index}].endTime`);
      if (!NOTE_NAMES[note.type] || !Number.isFinite(note.positionX)) throw new Error(t('chart.sd030bf4', { p0: path, p1: index }));
      for (const property of ['speed', 'size', 'alpha', 'yOffset', 'visibleTime']) {
        if (note[property] !== undefined && !Number.isFinite(note[property])) throw new Error(t('chart.s5000dde', { p0: path, p1: index, p2: property }));
      }
    }
    if (line.eventLayers != null && !Array.isArray(line.eventLayers)) throw new Error(t('chart.sa6d63e2', { p0: path }));
    for (const layer of [...(line.eventLayers ?? []), line.extended]) {
      if (!layer) continue;
      for (const type of [...EVENT_TYPES, ...EXTENDED_TYPES]) {
        if (layer[type] != null && !Array.isArray(layer[type])) throw new Error(t('chart.s3496237', { p0: path, p1: type }));
        for (const [index, event] of (layer[type] ?? []).entries()) {
          if (event?.trajectory) {
            if (type !== 'moveXEvents' || event.trajectory.version !== 1) throw new Error(t('chart.sbaf82f3'));
            sampleCurveTrajectory(event.trajectory.options, 65);
            trajectorySplitSettings(event.trajectory.split);
            if (!Number.isInteger(event.trajectory.segments) || event.trajectory.segments < 4 || event.trajectory.segments > 8192) throw new Error(t('chart.s7953a23'));
          }
          beatValue(event?.startTime, `${path}.${type}[${index}].startTime`);
          beatValue(event?.endTime, `${path}.${type}[${index}].endTime`);
          const validValue = value => type === 'textEvents' ? typeof value === 'string' : type === 'colorEvents' ? Array.isArray(value) && value.length === 3 && value.every(Number.isFinite) : Number.isFinite(value);
          if (type !== 'paintEvents' && (!validValue(event.start) || !validValue(event.end))) throw new Error(t('chart.s36d3319', { p0: path, p1: type, p2: index }));
          for (const property of ['easingLeft', 'easingRight']) {
            if (event[property] !== undefined && !Number.isFinite(event[property])) throw new Error(t('chart.s19e1a42', { p0: path, p1: type, p2: index, p3: property }));
          }
          if (event.bezier && (!Array.isArray(event.bezierPoints) || event.bezierPoints.length !== 4 || !event.bezierPoints.every(Number.isFinite))) throw new Error(t('chart.sa6dd197', { p0: path, p1: type, p2: index }));
        }
      }
    }
    for (const [name, property] of Object.entries({ alphaControl: 'alpha', posControl: 'pos', sizeControl: 'size', skewControl: 'skew', yControl: 'y' })) {
      if (line[name] == null) continue;
      if (!Array.isArray(line[name])) throw new Error(t('chart.se4b3c03', { p0: path, p1: name }));
      for (const [index, point] of line[name].entries()) {
        if (!Number.isFinite(point?.x) || !Number.isFinite(point?.[property])) throw new Error(t('chart.s2f74a3a', { p0: path, p1: name, p2: index }));
      }
    }
  });
}

export function diagnose(chart) {
  const issues = [];
  issues.push(...diagnoseNoiseAreas(chart.blockAreaList ?? []));
  const addIssue = (issue, severity = 'warning') => issues.push({ severity, ...issue });
  const bpmBeats = new Set();
  for (const [index, entry] of chart.BPMList.entries()) {
    const beat = beatValue(entry.startTime);
    if (bpmBeats.has(beat)) addIssue({ line: 0, beat, index, path: `BPMList[${index}]`, message: t('chart.s5c7f11a') }, 'info');
    bpmBeats.add(beat);
  }
  for (const [lineIndex, line] of (chart.judgeLineList ?? []).entries()) {
    const seen = new Map();
    for (const [index, note] of (line.notes ?? []).entries()) {
      const beat = beatValue(note.startTime);
      const report = (message, severity = 'error') => addIssue({ line: lineIndex, beat, index, path: `notes[${index}]`, message }, severity);
      if (beatValue(note.endTime) < beat) report(t('chart.s09eb5b2'));
      if (note.type === 2 && beatValue(note.endTime) === beat) report(t('chart.sd9e7995'));
      if (Math.abs(note.positionX) > 675) report(t('chart.s91fb3b9'), 'warning');
      if (note.isFake === true || Number(note.isFake) === 1) continue;
      const type = Number(note.type);
      const category = type === 1 || type === 2 ? 1 : type === 3 ? 2 : 0;
      if (!category) continue;
      const key = `${beat}:${note.positionX}:${noteIsAbove(note)}`;
      const previous = seen.get(key) ?? 0;
      if (previous & category) report(t('chart.sb895491'), 'warning');
      seen.set(key, previous | category);
    }
    const inspectEvents = (layer, layerIndex, extended) => {
      for (const type of [...EVENT_TYPES, ...EXTENDED_TYPES]) {
        if (type === 'paintEvents') continue;
        const events = layer?.[type] ?? [];
        if (!Array.isArray(events)) continue;
        const ordered = events.map((event, index) => ({ event, index })).sort((left, right) => beatValue(left.event.startTime) - beatValue(right.event.startTime));
        for (let position = 1; position < ordered.length; position++) {
          const previous = ordered[position - 1]; const current = ordered[position];
          if (beatValue(current.event.startTime) < beatValue(previous.event.endTime)) {
            addIssue({ line: lineIndex, beat: beatValue(current.event.startTime), index: current.index, layer: layerIndex, extended, path: `${type}[${current.index}]`, message: t('chart.s24d7d12', { p0: type }) }, 'error');
          }
        }
      }
    };
    for (const [layerIndex, layer] of (line.eventLayers ?? []).entries()) inspectEvents(layer, layerIndex, false);
    inspectEvents(line.extended, -1, true);
    const visited = new Set([lineIndex]);
    let parent = line.father ?? -1;
    while (parent !== -1) {
      if (!Number.isInteger(parent) || !chart.judgeLineList[parent] || visited.has(parent)) {
        addIssue({ line: lineIndex, beat: 0, path: 'father', message: t('chart.s237845c') }, 'error');
        break;
      }
      visited.add(parent);
      parent = chart.judgeLineList[parent].father ?? -1;
    }
  }
  return issues;
}

export function previewLimitations(chart) {
  const features = new Set();
  if ((chart.META.RPEVersion ?? 0) < 100) features.add(t('chart.sc829ef2'));
  for (const line of chart.judgeLineList ?? []) {
    if (line.Texture && line.Texture !== 'line.png') features.add(t('chart.scda1fcd'));
    if (line.isGif) features.add('GIF');
    if (line.attachUI && !['pause', 'combonumber', 'combo', 'score', 'bar', 'name', 'level'].includes(line.attachUI)) features.add(t('chart.sea93ab6', { p0: line.attachUI }));
    if (line.extended?.gifEvents?.length) features.add(t('chart.s3fea3f3'));
    if (line.extended?.textEvents?.some(event => event.font)) features.add(t('chart.s07fa720'));
    if (line.notes?.some(note => Array.isArray(note.color))) features.add(t('chart.s5621bcd'));
  }
  return [...features];
}
