import { beatValue } from './beat.ts';
import { IntervalIndex } from './interval-index.ts';
import { EVENT_TYPES } from './chart.ts';
import { SPECIAL_TRACKS } from './editor-display.ts';
import { shaderEvents } from './shader-events.ts';
import type { TempoMap } from './tempo.ts';
import type { AnyEventType, Beat, Chart, ChartEvent, EventLayer, JudgeLine } from './types.ts';

/**
 * Indexed over the events of one track.
 *
 * The shader records reach here as `any` (they come out of a `WeakMap` inside `shader-events.ts`),
 * and an unannotated callback parameter would silently inherit that. The named callbacks below pin
 * the parameter type down.
 */
function trackIndex(events: ChartEvent[]): IntervalIndex<ChartEvent> {
  const start = (event: ChartEvent): number => beatValue(event.startTime);
  const end = (event: ChartEvent): number => beatValue(event.endTime);
  return new IntervalIndex(events, start, end);
}

/**
 * The beat range of one note, event or shader record.
 *
 * Beat triples arrive from parsed JSON, so the fields are `unknown`; this is the single place that
 * narrows them for {@link TempoMap.seconds}.
 */
interface BeatRange {
  start: number | Beat;
  end: number | Beat;
}

function beatRange(item: { startTime: unknown; endTime: unknown }): BeatRange {
  const start: number | Beat = item.startTime as number | Beat;
  const end: number | Beat = item.endTime as number | Beat;
  return { start, end };
}

/** One event track reduced to the start of each of its events, in real seconds. */
interface TrackTimes {
  times: number[];
  index: IntervalIndex<ChartEvent>;
}

/** The notes plus the event tracks of one judge line, all resolved to real seconds. */
interface LineActivityData {
  duration: number;
  notes: number[];
  /** Indexed by base layer, so it lines up with `chart.judgeLineList[i].eventLayers`. */
  layers: TrackTimes[];
  special: TrackTimes;
}

/** One judge line's cached activity plus the separately indexed shader effect tracks. */
interface LineEffects {
  activity: LineActivityData;
  shaderTimes: number[];
  shaderIndex: IntervalIndex<ChartEvent>;
}

/** The histogram cached by {@link TimelineActivity.density}. */
export interface DensityBins {
  key: string;
  bins: number;
  noteBins: Uint32Array;
  eventBins: Uint32Array;
  maximum: number;
}

/** Whether a layer has anything in the visible range. */
export type LayerState = 'empty' | 'visible' | 'outside';

/**
 * Per-line activity in real seconds, cached across compiles.
 *
 * Every field is declared explicitly: the constructor assigns them, and inference from the
 * constructor alone would be too narrow for the callers in `compile` and `density`.
 */
class LineActivity implements LineActivityData {
  duration: number;
  notes: number[];
  layers: TrackTimes[];
  special: TrackTimes;

  constructor(line: JudgeLine, tempo: TempoMap) {
    const factor = line.bpmfactor ?? 1;
    this.duration = 0;
    // Accepts notes, base-track events and shader records alike: all `beatRange` needs is a beat
    // pair, which every one of them has.
    const times = (events: readonly { startTime: unknown; endTime: unknown }[]): number[] => events.map(event => {
      const range = beatRange(event);
      const start = tempo.seconds(range.start, factor);
      this.duration = Math.max(this.duration, start, tempo.seconds(range.end, factor));
      return start;
    });
    const track = (layer: EventLayer | undefined, types: readonly AnyEventType[]): TrackTimes => {
      const events = types.flatMap(type => layer?.[type] ?? []);
      return { times: times(events), index: trackIndex(events) };
    };
    this.notes = times(line.notes ?? []);
    this.layers = (line.eventLayers ?? []).map(layer => track(layer, EVENT_TYPES));
    // `SPECIAL_TRACKS` is plain display metadata (its `key` is only a `string`), while `track`
    // indexes into the typed `EventLayer`, so the keys are re-narrowed here.
    const specialTypes: AnyEventType[] = SPECIAL_TRACKS
      .map(entry => entry.key as AnyEventType)
      .filter(type => type !== 'paintEvents');
    this.special = track(line.extended, specialTypes);
  }
}

export class TimelineActivity {
  cache: WeakMap<JudgeLine, LineActivity>;
  chart: Chart | null;
  tempo: TempoMap | null;
  densityCache: DensityBins | null;
  duration: number;
  lines: LineEffects[];

  constructor() {
    this.cache = new WeakMap();
    this.chart = null;
    this.tempo = null;
    this.densityCache = null;
    this.duration = 0;
    this.lines = [];
  }

  compile(chart: Chart, tempo: TempoMap): void {
    if (this.chart === chart && this.tempo === tempo) return;
    if (this.tempo !== tempo) this.cache = new WeakMap();
    this.chart = chart; this.tempo = tempo; this.densityCache = null; this.duration = 1;
    this.lines = chart.judgeLineList.map((line, index) => {
      if (!this.cache.has(line)) this.cache.set(line, new LineActivity(line, tempo));
      // `!` is a type-level assertion only: `has`/`set` above guarantee the entry exists, and the
      // original code read it back unguarded the same way.
      const activity = this.cache.get(line)!;
      const effects = shaderEvents(chart, index);
      const shaderTimes = effects.map((event: ChartEvent): number => {
        const range = beatRange(event);
        const start = tempo.seconds(range.start, line.bpmfactor ?? 1);
        this.duration = Math.max(this.duration, start, tempo.seconds(range.end, line.bpmfactor ?? 1));
        return start;
      });
      this.duration = Math.max(this.duration, activity.duration);
      return { activity, shaderTimes, shaderIndex: trackIndex(effects) };
    });
  }

  density(lineIndex: number, layer: number, extended: boolean, duration: number, height: number): DensityBins {
    const bins = Math.max(96, Math.min(900, Math.max(Math.round(height), Math.ceil(duration * 8))));
    const key = `${lineIndex}:${layer}:${extended}:${duration}:${bins}`;
    if (this.densityCache?.key === key) return this.densityCache;
    const noteBins = new Uint32Array(bins); const eventBins = new Uint32Array(bins);
    const add = (target: Uint32Array, times: number[] | undefined): void => { for (const seconds of times ?? []) target[Math.max(0, Math.min(bins - 1, Math.floor(seconds / duration * bins)))]++; };
    const line = this.lines[lineIndex];
    add(noteBins, line?.activity.notes);
    add(eventBins, extended ? line?.activity.special.times : line?.activity.layers[layer]?.times);
    if (extended) add(eventBins, line?.shaderTimes);
    this.densityCache = { key, bins, noteBins, eventBins, maximum: Math.max(1, ...noteBins, ...eventBins) };
    return this.densityCache;
  }

  layerState(lineIndex: number, layer: number, extended: boolean, start: number, end: number, shaderStart: number, shaderEnd: number): LayerState {
    const line = this.lines[lineIndex];
    const index = extended ? line?.activity.special.index : line?.activity.layers[layer]?.index;
    const shaders = extended ? line?.shaderIndex : null;
    if (!index?.entries.length && !shaders?.entries.length) return 'empty';
    return index?.has(start, end) || shaders?.has(shaderStart, shaderEnd) ? 'visible' : 'outside';
  }
}
