import { beatValue, fromNumber } from './beat.ts';
import { SceneRuntime } from './scene.ts';
import type { HitEntry } from './hit-effects.ts';
import { createNoiseArea, createNoiseEvent, withNoiseAreas } from './noise-areas.ts';
import { noiseLayers } from './noise-skin.ts';
import type { TempoMap } from './tempo.ts';
import type { Beat, Chart, ChartEvent, JudgeLine, NoiseArea, Note } from './types.ts';

const MAX_SAMPLES = 60000;
const timeBeat = (seconds: number): Beat => fromNumber(seconds, 1000000000);

/** Which object the tracker follows: a whole line, or one note on it. */
export type NoiseTrackingTarget = { mode: 'line'; lineIndex: number } | { mode: 'note'; lineIndex: number; noteIndex: number };

/** One sampled position of the tracked object. */
export interface NoiseTrackingSample { x: number; y: number; rotation: number }

/** The resolved tracking source: the scene, the line, the optional note and a sampler. */
export interface NoiseTrackingSource {
  scene: SceneRuntime;
  line: JudgeLine;
  note: Note | null;
  sample(seconds: number): NoiseTrackingSample;
}

/** A time-stamped tracking sample; `seconds` is added once the source reports the position. */
interface TimedSample extends NoiseTrackingSample { seconds: number }

/** The options {@link trackedNoiseArea} builds its area from. */
export interface NoiseTrackingOptions {
  start: Beat | number;
  end: Beat | number;
  width: number;
  height: number;
  target: NoiseTrackingTarget;
  layerId?: string;
  invert?: boolean;
  active?: boolean;
  sampleRate?: number;
  name?: string;
}

export function noiseTrackingTarget(chart: Chart, tempo: TempoMap, target: NoiseTrackingTarget): NoiseTrackingSource {
  const line = chart.judgeLineList?.[target.lineIndex];
  if (!line || !['line', 'note'].includes(target.mode)) throw new Error('请选择追踪对象');
  const note = target.mode === 'note' ? line.notes?.[target.noteIndex] ?? null : null;
  if (target.mode === 'note' && !note) throw new Error('音符已不存在，请重新取样');
  const noteIndex = target.mode === 'note' ? target.noteIndex : -1;
  const scene = new SceneRuntime(); scene.compile(chart, tempo);
  const runtime = scene.lines[target.lineIndex];
  if (!runtime) throw new Error('请选择追踪对象');
  const entry: HitEntry | null = noteIndex >= 0 ? runtime.notes[noteIndex] ?? null : null;
  return {
    scene, line, note,
    sample(seconds) {
      const state = scene.sampler(seconds)(target.lineIndex);
      if (!state) throw new Error('追踪对象已不存在');
      if (!entry) return { x: state.x, y: state.y, rotation: state.rotation };
      const position = runtime.noteState(entry, state, seconds); const angle = state.rotation * Math.PI / 180;
      return { x: state.x + position.x * Math.cos(angle) + position.y * Math.sin(angle),
        y: state.y - position.x * Math.sin(angle) + position.y * Math.cos(angle), rotation: state.rotation };
    },
  };
}

// Event boundaries split the fit so a jump cannot become a short diagonal move.
function trackingCuts(chart: Chart, tempo: TempoMap, source: NoiseTrackingSource, start: number, end: number): number[] {
  const cuts = new Set<number>([start, end]); const seen = new Set<number>();
  const include = (seconds: number): void => { if (seconds > start && seconds < end) cuts.add(seconds); };
  let index = chart.judgeLineList.indexOf(source.line);
  while (Number.isInteger(index) && index >= 0 && index < chart.judgeLineList.length && !seen.has(index)) {
    seen.add(index); const line = chart.judgeLineList[index]!; const factor = line.bpmfactor ?? 1;
    for (const layer of [...(line.eventLayers ?? []), line.extended ?? {}]) for (const events of Object.values(layer ?? {})) {
      if (!Array.isArray(events)) continue;
      for (const event of events as ChartEvent[]) if (Array.isArray(event?.startTime) && Array.isArray(event?.endTime)) {
        include(tempo.seconds(event.startTime, factor)); include(tempo.seconds(event.endTime, factor));
      }
    }
    for (const point of tempo.points) include(tempo.seconds(point.beat, factor));
    const parent = Number(line.father ?? -1); index = Number.isInteger(parent) ? parent : -1;
  }
  if (source.note) {
    include(tempo.seconds(source.note.startTime, source.line.bpmfactor ?? 1));
    include(tempo.seconds(source.note.endTime, source.line.bpmfactor ?? 1));
  }
  for (const point of tempo.points) include(point.seconds);
  return [...cuts].sort((a, b) => a - b);
}

function simplify(samples: TimedSample[], positionTolerance: number, angleTolerance: number): TimedSample[] {
  const keep = new Set<number>([0, samples.length - 1]); const pending: [number, number][] = [[0, samples.length - 1]];
  while (pending.length) {
    const [first, last] = pending.pop()!; const a = samples[first]!; const b = samples[last]!; let worst = 1; let at = -1;
    for (let index = first + 1; index < last; index++) {
      const sample = samples[index]!; const amount = (sample.seconds - a.seconds) / (b.seconds - a.seconds);
      const error = Math.max(Math.hypot(sample.x - a.x - (b.x - a.x) * amount, sample.y - a.y - (b.y - a.y) * amount) / positionTolerance,
        Math.abs(sample.rotation - a.rotation - (b.rotation - a.rotation) * amount) / angleTolerance);
      if (error > worst) { worst = error; at = index; }
    }
    if (at !== -1) { keep.add(at); pending.push([first, at], [at, last]); }
  }
  return [...keep].sort((a, b) => a - b).map(index => samples[index]!);
}

export function trackedNoiseArea(chart: Chart, tempo: TempoMap, options: NoiseTrackingOptions): NoiseArea {
  const { start, end, width, height, target, layerId = noiseLayers(chart)[0]!.id, invert = false, active = true, sampleRate = 120, name = '' } = options;
  const startBeat = Array.isArray(start) ? beatValue(start) : start; const endBeat = Array.isArray(end) ? beatValue(end) : end;
  if (![startBeat, endBeat, width, height].every(Number.isFinite) || endBeat <= startBeat || width <= 0 || height <= 0 || width > 100000 || height > 100000) throw new Error('结束拍须晚于开始拍，宽高须在 0–100000 之间');
  if (![60, 120, 240].includes(sampleRate)) throw new Error('采样精度须为 60、120 或 240 Hz');
  if (!noiseLayers(chart).some(layer => layer.id === layerId)) throw new Error('目标噪域层已不存在');
  const source = noiseTrackingTarget(chart, tempo, target); const begin = tempo.seconds(startBeat); const finish = tempo.seconds(endBeat);
  const cuts = trackingCuts(chart, tempo, source, begin, finish);
  if ((finish - begin) * sampleRate + cuts.length * 2 > MAX_SAMPLES) throw new Error('追踪区间过长，请缩短区间或降低采样精度（最多 60000 个采样点）');
  const area: NoiseArea = { ...createNoiseArea(startBeat, endBeat), Name: name, layerId, isInvert: Boolean(invert),
    bottomLeft: { x: -width / 2, y: -height / 2 }, topRight: { x: width / 2, y: height / 2 },
    activeIntervals: active ? [{ startTime: fromNumber(startBeat), endTime: fromNumber(endBeat), readyFlash: 0.5 }] : [] };
  if (Array.isArray(start)) area.appearTime = [...start] as Beat; if (Array.isArray(end)) area.disappearTime = [...end] as Beat;
  if (active) { area.activeIntervals[0]!.startTime = [...area.appearTime] as Beat; area.activeIntervals[0]!.endTime = [...area.disappearTime] as Beat; }
  const read = (seconds: number): TimedSample => {
    const value = source.sample(seconds);
    if (!Object.values(value).every(Number.isFinite)) throw new Error('追踪对象在区间内包含无效坐标或旋转');
    return { ...value, seconds };
  };
  const eventBeat = (seconds: number): Beat => seconds === begin ? [...area.appearTime] as Beat : seconds === finish ? [...area.disappearTime] as Beat : timeBeat(tempo.beat(seconds));
  type TrackField = 'x' | 'y' | 'rotation';
  const append = (first: TimedSample, last: TimedSample, startSeconds = first.seconds, endSeconds = last.seconds): void => {
    for (const [type, field] of [['moveXEvents', 'x'], ['moveYEvents', 'y'], ['rotateEvents', 'rotation']] as [keyof NoiseArea, TrackField][]) {
      const event = createNoiseEvent(first[field], last[field], 0, 1, type === 'rotateEvents' ? { x: 0, y: 0 } : undefined);
      event.startTime = eventBeat(startSeconds); event.endTime = eventBeat(endSeconds);
      const track = area[type] as NoiseArea['moveXEvents'];
      track.push(event);
    }
  };
  for (let index = 0; index < cuts.length - 1; index++) {
    const first = cuts[index]!; const last = cuts[index + 1]!; const a = read(first);
    // The left limit retains the old value at an instantaneous boundary.
    const probe = Math.max(first, last - Math.min(1e-7, (last - first) * 1e-5)); const left = read(probe); const at = read(last);
    const discontinuity = Math.hypot(left.x - at.x, left.y - at.y) > 0.001 || Math.abs(left.rotation - at.rotation) > 0.001;
    const count = Math.max(1, Math.ceil((last - first) * sampleRate)); const samples: TimedSample[] = [a];
    for (let step = 1; step < count; step++) samples.push(read(first + (last - first) * step / count));
    samples.push({ ...(discontinuity ? left : at), seconds: last });
    const reduced = simplify(samples, 0.2, 0.02);
    for (let step = 1; step < reduced.length; step++) append(reduced[step - 1]!, reduced[step]!);
    // Adjacent events may have different endpoint values; the next start is the jump.
    if (index === cuts.length - 2 && discontinuity) append(samples.at(-1)!, at, last, last);
  }
  return area;
}

export function noiseTrackingChart(chart: Chart, area: NoiseArea): Chart { return withNoiseAreas(chart, [...(chart.blockAreaList ?? []), area]); }
