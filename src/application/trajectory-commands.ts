import { beatValue, fromNumber } from '../core/beat.ts';
import { createEvent, assertChart } from '../core/chart.ts';
import { compileTrajectory, sampleCurveTrajectory, TRAJECTORY_VERSION, trajectoryHasRotation } from '../core/curve-trajectory.ts';
import { simplifyTrajectorySamples, trajectorySplitSettings } from '../core/trajectory-simplify.ts';
import { EventTrack } from '../core/events.ts';
import { TempoMap } from '../core/tempo.ts';
import { chartWithEventLists } from './event-commands.ts';
import type { EventListUpdates } from './event-commands.ts';
import type { AnyEventType, Beat, Chart, ChartEvent, CurveTrajectoryOptions, EventLayer, TrajectorySplit } from '../core/types.ts';

/**
 * The event track each trajectory axis is written to.
 *
 * The annotation keeps every member literal, so `TrajectoryAxisType` below is the exact axis union
 * callers index layers and samples with rather than widening to `string`.
 */
export const TRAJECTORY_AXES: { moveXEvents: 'x'; moveYEvents: 'y'; rotateEvents: 'rotation' } = { moveXEvents: 'x', moveYEvents: 'y', rotateEvents: 'rotation' };

/** The event tracks a whole-curve trajectory occupies. */
export type TrajectoryAxisType = keyof typeof TRAJECTORY_AXES;

/**
 * The split settings an explicit expansion may override.
 *
 * `TrajectorySplit` holds the two fitting knobs; the panel also passes the segment count it wants the
 * expansion cut into, which {@link expandTrajectory} reads ahead of the trajectory's own.
 */
type TrajectorySplitOverrides = Partial<TrajectorySplit> & { segments?: number };

export function createTrajectoryEvent(options: CurveTrajectoryOptions, startTime: Beat, endTime: Beat, segments = 128, split: Partial<TrajectorySplit> = {}): ChartEvent {
  const start = beatValue(startTime); const end = beatValue(endTime);
  if (start < 0 || end <= start) throw new Error('轨迹结束拍须大于开始拍，开始拍不能为负');
  if (!Number.isInteger(segments) || segments < 4 || segments > 8192) throw new Error('拆分段数须为 4–8192');
  sampleCurveTrajectory(options, 257);
  const evaluate = compileTrajectory(options);
  return { ...createEvent(evaluate(0).x, evaluate(1).x, start, end), startTime: [...startTime], endTime: [...endTime], trajectory: { version: 1, options: structuredClone(options), segments, split: trajectorySplitSettings(split) } };
}

export function trajectoryChart(chart: Chart, lineIndex: number, layerIndex: number, event: ChartEvent, editing: ChartEvent | null = null, replace = false): Chart {
  if (editing) {
    for (let sourceLine = 0; sourceLine < chart.judgeLineList.length; sourceLine++) {
      for (let sourceLayer = 0; sourceLayer < (chart.judgeLineList[sourceLine].eventLayers ?? []).length; sourceLayer++) {
        const source = chart.judgeLineList[sourceLine].eventLayers[sourceLayer]?.moveXEvents;
        if (source?.includes(editing) && (sourceLine !== lineIndex || sourceLayer !== layerIndex)) chart = chartWithEventLists(chart, sourceLine, sourceLayer, new Map<AnyEventType, ChartEvent[]>([['moveXEvents', source.filter(candidate => candidate !== editing)]]));
      }
    }
  }
  const line = chart.judgeLineList?.[lineIndex];
  if (!line || !Number.isInteger(layerIndex) || layerIndex < 0 || layerIndex > 3) throw new Error('目标判定线或基础层无效');
  const layer: EventLayer = line.eventLayers?.[layerIndex] ?? {};
  const begin = beatValue(event.startTime); const finish = beatValue(event.endTime);
  const tempo = new TempoMap(chart.BPMList); const factor = line.bpmfactor ?? 1;
  const updates: EventListUpdates = new Map();
  for (const type of Object.keys(TRAJECTORY_AXES) as TrajectoryAxisType[]) {
    // A trajectory event always carries its trajectory — `createTrajectoryEvent` builds it and the
    // panel only offers this command for events that have one — so the assertions below are exactly
    // the unguarded reads the original made.
    if (type === 'rotateEvents' && !trajectoryHasRotation(event.trajectory!.options)) continue;
    const entries: ChartEvent[] = [];
    for (const original of layer[type] ?? []) {
      if (original === editing) continue;
      const start = beatValue(original.startTime); const end = beatValue(original.endTime);
      if (begin >= end || finish <= start) { entries.push(original); continue; }
      if (!replace) throw new Error('目标区间已有位移或旋转事件；请选择空白区间，或勾选替换区间内事件');
      if (original.trajectory) throw new Error('区间内已有整体轨迹，请先删除或拆分该轨迹');
      const track = new EventTrack([original], tempo, factor);
      const secondsStart = tempo.seconds(original.startTime, factor); const secondsEnd = tempo.seconds(original.endTime, factor);
      const clipped = (first: number, last: number) => {
        const startTime = fromNumber(first); const endTime = fromNumber(last);
        const left = original.easingLeft ?? 0; const range = (original.easingRight ?? 1) - left;
        return { ...original, startTime, endTime, start: track.value(tempo.seconds(startTime, factor)), end: track.value(tempo.seconds(endTime, factor)), easingLeft: left + range * (tempo.seconds(startTime, factor) - secondsStart) / (secondsEnd - secondsStart), easingRight: left + range * (tempo.seconds(endTime, factor) - secondsStart) / (secondsEnd - secondsStart) };
      };
      if (original.bezier && (start < begin || end > finish)) throw new Error('替换区间穿过 Bezier 事件，请先切割该事件');
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

export function expandTrajectory(event: ChartEvent, tempo: TempoMap, factor = 1, overrides: TrajectorySplitOverrides = {}): Map<TrajectoryAxisType, ChartEvent[]> {
  // As in `trajectoryChart`, callers only expand events that carry a trajectory.
  const evaluate = compileTrajectory(event.trajectory!.options);
  const start = tempo.seconds(event.startTime, factor); const end = tempo.seconds(event.endTime, factor);
  const count = overrides.segments ?? event.trajectory!.segments ?? 128;
  if (!Number.isInteger(count) || count < 4 || count > 8192) throw new Error('轨迹拆分段数无效');
  const settings = trajectorySplitSettings({ ...event.trajectory!.split, ...overrides });
  const samples = Array.from({ length: count + 1 }, (unused, index) => evaluate(index / count));
  const result = new Map<TrajectoryAxisType, ChartEvent[]>(Object.entries(TRAJECTORY_AXES).filter(([type]) => type !== 'rotateEvents' || trajectoryHasRotation(event.trajectory!.options)).map(([type]): [TrajectoryAxisType, ChartEvent[]] => [type as TrajectoryAxisType, []]));
  const beatAt = (index: number): number => index === 0 ? beatValue(event.startTime) : index === count ? beatValue(event.endTime) : tempo.beat(start + (end - start) * index / count, factor);
  for (const [type, entries] of result) {
    const values = samples.map(point => point[TRAJECTORY_AXES[type]]);
    const pieces = settings.simplify ? simplifyTrajectorySamples(values, settings.tolerance) : Array.from({ length: count }, (unused, index) => ({ first: index, last: index + 1, easingType: 1 }));
    for (const piece of pieces) entries.push({ ...createEvent(values[piece.first], values[piece.last], beatAt(piece.first), beatAt(piece.last)), easingType: piece.easingType });
  }
  return result;
}

export function splitTrajectoryChart(chart: Chart, lineIndex: number, layerIndex: number, event: ChartEvent, settings: TrajectorySplitOverrides = {}): Chart {
  const layer = chart.judgeLineList[lineIndex].eventLayers[layerIndex];
  if (!layer.moveXEvents?.includes(event) || !event.trajectory) throw new Error('请选择一个整体曲线轨迹事件');
  const fragments = expandTrajectory(event, new TempoMap(chart.BPMList), chart.judgeLineList[lineIndex].bpmfactor ?? 1, settings);
  const updates: EventListUpdates = new Map([...fragments].map(([type, entries]): [TrajectoryAxisType, ChartEvent[]] => [type, [...(layer[type] ?? []).filter(candidate => candidate !== event), ...entries].sort((left, right) => beatValue(left.startTime) - beatValue(right.startTime))]));
  return chartWithEventLists(chart, lineIndex, layerIndex, updates);
}
