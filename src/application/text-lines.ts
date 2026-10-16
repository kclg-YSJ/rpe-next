import { assertChart, createEvent, createNote } from '../core/chart.ts';
import { beatValue } from '../core/beat.ts';
import { TempoMap } from '../core/tempo.ts';
import { SceneRuntime } from '../core/scene.ts';
import type { LineState, LineTracks } from '../core/scene.ts';
import { EventTrack } from '../core/events.ts';
import type { TrackValue } from '../core/events.ts';
import type { Beat, Chart, ChartEvent, EventLayer, JudgeLine, Note, NoteType } from '../core/types.ts';
import type { FittedStroke } from '../core/text-fit.ts';

/**
 * A stroke's target transform: the absolute position and rotation to write into a line.
 *
 * Deliberately narrower than `LineState` — placing a stroke only ever sets these three, and the rest
 * of a line's state is left to the document.
 */
interface TargetState {
  x: number;
  y: number;
  rotation: number;
}

/**
 * A `father` reference resolved to an index, or `-1` when the line has no parent.
 *
 * The format allows an empty string for "no parent" even though the field is otherwise numeric, so
 * both that and a missing value map to `-1`.
 */
const parentIndex = (line: JudgeLine): number => {
  const father = line.father as number | string | null | undefined;
  return father === '' || father == null ? -1 : Number(father);
};

/**
 * Converts an absolute time back into the parent's local beat grid.
 *
 * `exactBeat` short-circuits the search when the caller already holds the beat the stroke was placed
 * at, which is the common case and avoids the decrementing loop below. Otherwise the beat is found by
 * stepping the last nanosecond down until `tempo.seconds` lands at or before `seconds`, which is how
 * a fractional beat is represented exactly in the format's [whole, numerator, denominator] triple.
 */
function localTime(seconds: number, tempo: TempoMap, factor: number, exactBeat?: Beat): Beat {
  if (factor === 1 && exactBeat) return [...exactBeat];
  const value = tempo.beat(seconds, factor); const whole = Math.floor(value);
  const time: Beat = [whole, Math.floor((value - whole) * 1000000000), 1000000000];
  while (tempo.seconds(time, factor) > seconds) time[1]--;
  return time;
}

/**
 * Inserts one instantaneous event at `time`, splitting whatever event already spans that instant.
 *
 * RPE cannot express two values for the same property at the same beat, so a stroke landing mid-event
 * forces a split: the spanning event is truncated and its end value resampled at the new boundary,
 * with `easingRight` scaled to the progress already covered so the remaining curve keeps its shape.
 * A `trajectory` or Bezier event is refused instead, because splitting one would change its geometry.
 * The zero-duration event that anchors the new value is appended last, and the list is re-sorted by
 * start time so callers see a normalised track.
 */
function insertStep(events: ChartEvent[], time: Beat, value: number, tempo: TempoMap, factor: number, replace: boolean, track: EventTrack = new EventTrack(events, tempo, factor)): ChartEvent[] {
  const beat = beatValue(time);
  const seconds = tempo.seconds(beat, factor);
  const output: ChartEvent[] = [];
  for (const event of events) {
    const start = beatValue(event.startTime); const end = beatValue(event.endTime);
    if (start <= beat && end > beat || start === beat) {
      if (!replace) throw new Error('生成时刻已有位移或旋转事件，请勾选替换或选择空白时刻');
      if (start < beat) {
        if (event.trajectory || event.bezier) throw new Error('生成时刻穿过整体轨迹或 Bezier 事件，请先拆分或另选时刻');
        const progress = (seconds - tempo.seconds(event.startTime, factor)) / (tempo.seconds(event.endTime, factor) - tempo.seconds(event.startTime, factor));
        output.push({ ...event, endTime: [...time], end: track.sample({ event, start: tempo.seconds(event.startTime, factor), end: tempo.seconds(event.endTime, factor) }, seconds), easingRight: (event.easingLeft ?? 0) + ((event.easingRight ?? 1) - (event.easingLeft ?? 0)) * progress });
      }
    } else output.push(event);
  }
  // Seed the track's value from the start when no earlier event exists, so the new step has a base.
  if (!output.some(event => beatValue(event.startTime) < beat)) output.push({ ...createEvent(track.value(seconds - 0.000001) as number, undefined, Math.min(-1000000, beat - 1), beat), endTime: [...time] });
  output.push({ ...createEvent(value, value, 0, 0), startTime: [...time], endTime: [...time] });
  return output.sort((first, second) => beatValue(first.startTime) - beatValue(second.startTime));
}

/** The options the 拼字 panel's `read()` supplies. */
export interface TextLinesOptions {
  /** The fitted strokes to place, in pixel coordinates. */
  strokes: FittedStroke[];
  /** The judge lines the strokes are assigned to, one per stroke. */
  indices: number[];
  /** The beat every stroke is placed at. */
  beat: number;
  /** The same instant as a beat triple, when the caller already holds one. */
  beatTime?: Beat;
  /** The note size to write. */
  size: number;
  /** The note type to place; Drag, Tap or Flick only. */
  noteType?: NoteType;
  /** Whether to append the notes rather than replacing the line's existing ones. */
  addNotes?: boolean;
  /** Whether an existing event at the target instant may be replaced. */
  replace?: boolean;
  /** Whether to emit only the generated note, leaving the document otherwise untouched. */
  preview?: boolean;
}

/**
 * Writes a fitted text layout into the chart as one note plus a position event per line.
 *
 * Each stroke becomes a judge line moved to the stroke's centre and rotated to its angle, with the
 * note sitting on it. The placement is expressed in *absolute* chart space, so a line that has a
 * parent has the ancestor's transform divided back out before the event values are written — and
 * `parentState` resolves that ancestry lazily and memoised, because a chain of parents would
 * otherwise be walked once per stroke. Lines whose ancestors are themselves being moved resolve from
 * the desired stroke positions instead of the document, so the whole layout lands where the panel
 * previewed it rather than compounding the edits line by line.
 */
export function textLinesChart(chart: Chart, { strokes, indices, beat, beatTime, size, noteType = 4, addNotes = false, replace = false, preview = false }: TextLinesOptions): Chart {
  if (![4, 1, 3].includes(noteType)) throw new Error('拼字音符类型须为 Drag、Tap 或 Flick');
  if (!strokes.length || strokes.length > indices.length || new Set(indices).size !== indices.length || !Number.isFinite(beat) || !Number.isFinite(size) || size <= 0) throw new Error('拼字参数或可用线数无效');
  if (strokes.some(stroke => ![stroke.x, stroke.y, stroke.angle].every(Number.isFinite))) throw new Error('笔画坐标或角度无效');
  if (beatTime && beatValue(beatTime) !== beat) throw new Error('目标拍数不一致');
  if (indices.some(index => !Number.isInteger(index) || !chart.judgeLineList[index])) throw new Error('参与线号超出范围');
  const tempo = new TempoMap(chart.BPMList); const seconds = tempo.seconds(beat);
  const scene = new SceneRuntime(); scene.compile(chart, tempo); const states = scene.sample(seconds);
  const desired = new Map<number, TargetState>(strokes.map((stroke, index) => [indices[index], { x: stroke.x, y: stroke.y, rotation: stroke.angle * 180 / Math.PI }]));
  // Walk each participating line's ancestry once up front, so a cycle is reported before any edit.
  for (const [index] of desired) {
    const seen = new Set([index]); let parent = parentIndex(chart.judgeLineList[index]);
    while (parent !== -1) { if (!Number.isInteger(parent) || !chart.judgeLineList[parent] || seen.has(parent)) throw new Error('参与判定线存在无效父线或循环父线'); seen.add(parent); parent = parentIndex(chart.judgeLineList[parent]); }
  }
  const resolved = new Map<number, TargetState>();
  const parentState = (index: number): TargetState => {
    if (resolved.has(index)) return resolved.get(index) as TargetState;
    if (desired.has(index)) return desired.get(index) as TargetState;
    const line = chart.judgeLineList[index]; const local = scene.lines[index].state(seconds); const parent = parentIndex(line);
    if (parent >= 0) {
      const ancestor = parentState(parent); const angle = -ancestor.rotation * Math.PI / 180;
      const state: TargetState = { x: ancestor.x + local.x * Math.cos(angle) - local.y * Math.sin(angle), y: ancestor.y + local.x * Math.sin(angle) + local.y * Math.cos(angle), rotation: local.rotation + ((line.rotateWithFather ?? ((chart.META.RPEVersion ?? 0) >= 163)) ? ancestor.rotation : 0) }; resolved.set(index, state); return state;
    }
    const sampled = states[index] as LineState | undefined;
    return sampled ? { x: sampled.x, y: sampled.y, rotation: sampled.rotation } : { x: 0, y: 0, rotation: 0 };
  };
  const lines = chart.judgeLineList.map((line, index) => {
    if (!desired.has(index)) return line;
    if (line.attachUI) throw new Error(`线 ${index} 绑定了游戏 UI，不能用于音符拼字`);
    if (line.eventLayers?.some(layer => layer?.moveXEvents?.some(event => event.trajectory && tempo.seconds(event.startTime, line.bpmfactor ?? 1) <= seconds && tempo.seconds(event.endTime, line.bpmfactor ?? 1) >= seconds))) throw new Error(`线 ${index} 正处于整体轨迹，请另选时刻或先拆分`);
    let target = desired.get(index) as TargetState; const parent = parentIndex(line);
    if (parent >= 0) {
      const ancestor = parentState(parent); const angle = ancestor.rotation * Math.PI / 180; const horizontal = target.x - ancestor.x; const vertical = target.y - ancestor.y;
      target = { ...target, x: horizontal * Math.cos(angle) - vertical * Math.sin(angle), y: horizontal * Math.sin(angle) + vertical * Math.cos(angle), rotation: target.rotation - ((line.rotateWithFather ?? ((chart.META.RPEVersion ?? 0) >= 163)) ? ancestor.rotation : 0) };
    }
    const layers: EventLayer[] = [...(line.eventLayers ?? [])]; const layer: EventLayer = { ...(layers[0] ?? {}) }; const factor = line.bpmfactor ?? 1; const time = localTime(seconds, tempo, factor, beatTime);
    for (const [type, key] of [['moveXEvents', 'x'], ['moveYEvents', 'y'], ['rotateEvents', 'rotation']] as [keyof LineTracks, 'x' | 'y' | 'rotation'][]) {
      const tracks = scene.lines[index].tracks[type];
      // The line's other layers add on top, so they are subtracted out to land on the absolute target.
      const others = tracks.slice(1).reduce((sum, track) => sum + Number(track.value(seconds)), 0);
      layer[type] = insertStep(layer[type] ?? [], time, target[key] - others, tempo, factor, replace, tracks[0]);
    }
    layers[0] = layer;
    let notes = line.notes ?? [];
    if (addNotes || preview) {
      const note: Note = { ...createNote(noteType, tempo.beat(seconds + 1, factor), 0), speed: 0, size, isFake: 1, visibleTime: 999999, yOffset: 0 };
      notes = preview ? [note] : [...notes, note];
    }
    return { ...line, eventLayers: layers, notes, numOfNotes: notes.length };
  });
  const next: Chart = { ...chart, judgeLineList: lines }; assertChart(next); return next;
}
