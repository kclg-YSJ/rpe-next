import { beatValue, fromNumber } from '../core/beat.mjs';
import { createEvent, assertChart } from '../core/chart.mjs';
import { compileTrajectory, sampleCurveTrajectory, TRAJECTORY_VERSION, trajectoryHasRotation } from '../core/curve-trajectory.mjs';
import { simplifyTrajectorySamples, trajectorySplitSettings } from '../core/trajectory-simplify.mjs';
import { EventTrack } from '../core/events.mjs';
import { TempoMap } from '../core/tempo.mjs';
import { chartWithEventLists } from './event-commands.mjs';
import { t } from '../i18n.mjs';

export const TRAJECTORY_AXES = { moveXEvents: 'x', moveYEvents: 'y', rotateEvents: 'rotation' };

export function createTrajectoryEvent(options, startTime, endTime, segments = 128, split = {}) {
  const start = beatValue(startTime); const end = beatValue(endTime);
  if (start < 0 || end <= start) throw new Error(t('trajectory-commands.sa257eee'));
  if (!Number.isInteger(segments) || segments < 4 || segments > 8192) throw new Error(t('trajectory-commands.s6d93f68'));
  sampleCurveTrajectory(options, 257);
  const evaluate = compileTrajectory(options);
  return { ...createEvent(evaluate(0).x, evaluate(1).x, start, end), startTime: [...startTime], endTime: [...endTime], trajectory: { version: 1, options: structuredClone(options), segments, split: trajectorySplitSettings(split) } };
}

export function trajectoryChart(chart, lineIndex, layerIndex, event, editing = null, replace = false) {
  if (editing) {
    for (let sourceLine = 0; sourceLine < chart.judgeLineList.length; sourceLine++) {
      for (let sourceLayer = 0; sourceLayer < (chart.judgeLineList[sourceLine].eventLayers ?? []).length; sourceLayer++) {
        const source = chart.judgeLineList[sourceLine].eventLayers[sourceLayer]?.moveXEvents;
        if (source?.includes(editing) && (sourceLine !== lineIndex || sourceLayer !== layerIndex)) chart = chartWithEventLists(chart, sourceLine, sourceLayer, new Map([['moveXEvents', source.filter(candidate => candidate !== editing)]]));
      }
    }
  }
  const line = chart.judgeLineList?.[lineIndex];
  if (!line || !Number.isInteger(layerIndex) || layerIndex < 0 || layerIndex > 3) throw new Error(t('trajectory-commands.sd093990'));
  const layer = line.eventLayers?.[layerIndex] ?? {};
  const begin = beatValue(event.startTime); const finish = beatValue(event.endTime);
  const tempo = new TempoMap(chart.BPMList); const factor = line.bpmfactor ?? 1;
  const updates = new Map();
  for (const type of Object.keys(TRAJECTORY_AXES)) {
    if (type === 'rotateEvents' && !trajectoryHasRotation(event.trajectory.options)) continue;
    const entries = [];
    for (const original of layer[type] ?? []) {
      if (original === editing) continue;
      const start = beatValue(original.startTime); const end = beatValue(original.endTime);
      if (begin >= end || finish <= start) { entries.push(original); continue; }
      if (!replace) throw new Error(t('trajectory-commands.s4a05a50'));
      if (original.trajectory) throw new Error(t('trajectory-commands.s7c2c568'));
      const track = new EventTrack([original], tempo, factor);
      const secondsStart = tempo.seconds(original.startTime, factor); const secondsEnd = tempo.seconds(original.endTime, factor);
      const clipped = (first, last) => {
        const startTime = fromNumber(first); const endTime = fromNumber(last);
        const left = original.easingLeft ?? 0; const range = (original.easingRight ?? 1) - left;
        return { ...original, startTime, endTime, start: track.value(tempo.seconds(startTime, factor)), end: track.value(tempo.seconds(endTime, factor)), easingLeft: left + range * (tempo.seconds(startTime, factor) - secondsStart) / (secondsEnd - secondsStart), easingRight: left + range * (tempo.seconds(endTime, factor) - secondsStart) / (secondsEnd - secondsStart) };
      };
      if (original.bezier && (start < begin || end > finish)) throw new Error(t('trajectory-commands.s869ce32'));
      if (start < begin) entries.push(clipped(start, begin));
      if (end > finish) entries.push(clipped(finish, end));
    }
    if (type === 'moveXEvents') entries.push(event);
    updates.set(type, entries);
  }
  const result = chartWithEventLists(chart, lineIndex, layerIndex, updates);
  result.META = { ...result.META, RPEVersion: Math.max(TRAJECTORY_VERSION, result.META.RPEVersion ?? 0) };
  assertChart(result);
  return result;
}

export function expandTrajectory(event, tempo, factor = 1, overrides = {}) {
  const evaluate = compileTrajectory(event.trajectory.options);
  const start = tempo.seconds(event.startTime, factor); const end = tempo.seconds(event.endTime, factor);
  const count = overrides.segments ?? event.trajectory.segments ?? 128;
  if (!Number.isInteger(count) || count < 4 || count > 8192) throw new Error(t('trajectory-commands.s7953a23'));
  const settings = trajectorySplitSettings({ ...event.trajectory.split, ...overrides });
  const samples = Array.from({ length: count + 1 }, (unused, index) => evaluate(index / count));
  const result = new Map(Object.entries(TRAJECTORY_AXES).filter(([type]) => type !== 'rotateEvents' || trajectoryHasRotation(event.trajectory.options)).map(([type]) => [type, []]));
  const beatAt = index => index === 0 ? beatValue(event.startTime) : index === count ? beatValue(event.endTime) : tempo.beat(start + (end - start) * index / count, factor);
  for (const [type, entries] of result) {
    const values = samples.map(point => point[TRAJECTORY_AXES[type]]);
    const pieces = settings.simplify ? simplifyTrajectorySamples(values, settings.tolerance) : Array.from({ length: count }, (unused, index) => ({ first: index, last: index + 1, easingType: 1 }));
    for (const piece of pieces) entries.push({ ...createEvent(values[piece.first], values[piece.last], beatAt(piece.first), beatAt(piece.last)), easingType: piece.easingType });
  }
  return result;
}

export function splitTrajectoryChart(chart, lineIndex, layerIndex, event, settings = {}) {
  const layer = chart.judgeLineList[lineIndex].eventLayers[layerIndex];
  if (!layer.moveXEvents?.includes(event) || !event.trajectory) throw new Error(t('trajectory-commands.s91b6dc2'));
  const fragments = expandTrajectory(event, new TempoMap(chart.BPMList), chart.judgeLineList[lineIndex].bpmfactor ?? 1, settings);
  const updates = new Map([...fragments].map(([type, entries]) => [type, [...(layer[type] ?? []).filter(candidate => candidate !== event), ...entries].sort((left, right) => beatValue(left.startTime) - beatValue(right.startTime))]));
  return chartWithEventLists(chart, lineIndex, layerIndex, updates);
}
