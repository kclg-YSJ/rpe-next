import { EventTrack, SpeedIntegral } from './events.ts';
import { IntervalIndex } from './interval-index.ts';
import { easing } from './easing.ts';
import { upperBound } from './beat.ts';
import { noteIsAbove } from './chart.ts';
import { trajectoryHasRotation } from './curve-trajectory.ts';
import type { TempoMap } from './tempo.ts';
import type { IndexedInterval } from './interval-index.ts';
import type { HitEntry } from './hit-effects.ts';
import type { Chart, ChartEvent, Color, JudgeLine, Note } from './types.ts';

/** The control curves a judge line can carry, keyed by the name the chart stores them under. */
export interface LineControls {
  alpha: ControlCurve;
  pos: ControlCurve;
  size: ControlCurve;
  skew: ControlCurve;
  y: ControlCurve;
}

/**
 * A judge line's event tracks, keyed by the four base track names.
 *
 * Each entry is the stack of layers the chart stores for that track, so a sample sums over all of
 * them; the runtime counterpart of {@link LineRuntime.tracks}.
 */
export interface LineTracks {
  moveXEvents: EventTrack[];
  moveYEvents: EventTrack[];
  rotateEvents: EventTrack[];
  alphaEvents: EventTrack[];
}

/** A judge line's tracks under `extended`, keyed by the extended track names. */
export interface ExtendedTracks {
  scaleXEvents: EventTrack;
  scaleYEvents: EventTrack;
  colorEvents: EventTrack;
  textEvents: EventTrack;
  inclineEvents: EventTrack;
}

/** The event track names the constructor builds {@link LineTracks} from. */
const TRACK_TYPES = ['moveXEvents', 'moveYEvents', 'rotateEvents', 'alphaEvents'] as const;

/** The control curves the constructor builds {@link LineControls} from, with their chart fields. */
const CONTROL_FIELDS = { alpha: 'alphaControl', pos: 'posControl', size: 'sizeControl', skew: 'skewControl', y: 'yControl' } as const;

/** A point of a control curve, as the chart stores it. */
interface CurvePoint {
  x: number;
  [property: string]: number;
}

/** The keys `LineControls` is indexed by; `ControlCurve` receives the same string. */
type ControlProperty = keyof LineControls;

/** The keys `LineTracks` is indexed by, i.e. the base track names. */
type TrackType = keyof LineTracks;

/** The seed of each extended track, mapping a track name to the value it falls back to. */
const EXTENDED_DEFAULTS = { scaleXEvents: 1, scaleYEvents: 1, colorEvents: [241, 216, 148] as Color, textEvents: '', inclineEvents: 0 };

/** One control-point curve, sampled by the covered distance. */
export class ControlCurve {
  property: ControlProperty;
  points: CurvePoint[];

  constructor(points: CurvePoint[] | null | undefined, property: ControlProperty) {
    this.property = property;
    this.points = [...(points ?? [])].sort((left, right) => left.x - right.x);
  }

  value(distance: number): number {
    if (this.points.length <= 1) return this.property === 'skew' ? 0 : 1;
    const index = upperBound(this.points, distance, point => point.x);
    if (index === 0) return this.points[0][this.property];
    if (index >= this.points.length) return (this.points.at(-1) as CurvePoint)[this.property];
    const start = this.points[index - 1];
    const end = this.points[index];
    const amount = easing((distance - start.x) / (end.x - start.x), end.easing ?? 1);
    return start[this.property] + (end[this.property] - start[this.property]) * amount;
  }
}

/** One judge line compiled to runtime form: tracks, the speed integral, and per-note positions. */
export class LineRuntime {
  line: JudgeLine;
  tracks: LineTracks;
  speeds: SpeedIntegral[];
  extended: ExtendedTracks;
  controls: LineControls;
  notes: HitEntry[];
  minSpeed: number;
  hitTimes: HitEntry[];
  holdIndex: IntervalIndex<HitEntry>;
  staticNotes: HitEntry[];
  index: IntervalIndex<HitEntry>;
  hasYControl: boolean;

  constructor(line: JudgeLine, tempo: TempoMap) {
    this.line = line;
    const factor = line.bpmfactor ?? 1;
    const tracks = Object.fromEntries(TRACK_TYPES.map(type => {
      const wantsRotation = type === 'moveYEvents' || type === 'rotateEvents';
      return [type, (line.eventLayers ?? []).map(layer => {
        // A trajectory event lives on the X track but drives Y and rotation too, so each of those two
        // tracks gets a virtual copy of it tagged with the axis it should be read on. The rotation copy
        // is only added when the trajectory actually produces an angle.
        const virtual: ChartEvent[] = wantsRotation
          ? (layer?.moveXEvents ?? []).filter(event => event.trajectory && (type !== 'rotateEvents' || trajectoryHasRotation(event.trajectory!.options))).map(event => ({ ...event, trajectoryAxis: type === 'moveYEvents' ? 'y' as const : 'rotation' as const }))
          : [];
        return new EventTrack([...(layer?.[type] ?? []), ...virtual], tempo, factor);
      })];
    }));
    this.tracks = tracks as unknown as LineTracks;
    this.speeds = (line.eventLayers ?? []).map(layer => new SpeedIntegral(layer?.speedEvents, tempo, factor));
    const defaultColor: Color = line.attachUI || line.extended?.textEvents?.length || line.Texture && line.Texture !== 'line.png' ? [255, 255, 255] : [241, 216, 148];
    const defaults = { ...EXTENDED_DEFAULTS, colorEvents: defaultColor };
    const extended = Object.fromEntries(Object.entries(defaults).map(([type, fallback]) => [type, new EventTrack(line.extended?.[type as keyof ExtendedTracks], tempo, factor, fallback)]));
    this.extended = extended as unknown as ExtendedTracks;
    const controls = Object.fromEntries(Object.entries(CONTROL_FIELDS)
      .map(([property, name]) => [property, new ControlCurve(line[name] as CurvePoint[] | undefined, property as ControlProperty)]));
    this.controls = controls as unknown as LineControls;
    this.notes = (line.notes ?? []).map(note => {
      const start = tempo.seconds(note.startTime, factor);
      const end = tempo.seconds(note.endTime, factor);
      return { note, start, end, floor: this.floor(start) + (note.yOffset ?? 0), tail: this.floor(end) + (note.yOffset ?? 0) };
    });
    this.minSpeed = this.notes.reduce((minimum, entry) => Math.min(minimum, Math.abs(entry.note.speed ?? 1) || 1), 1);
    this.hitTimes = [...this.notes].sort((left, right) => left.start - right.start);
    this.holdIndex = new IntervalIndex(this.notes.filter(entry => entry.note.type === 2), entry => entry.start, entry => entry.end);
    this.staticNotes = this.notes.filter(entry => (entry.note.speed ?? 1) === 0);
    this.index = new IntervalIndex(this.notes.filter(entry => (entry.note.speed ?? 1) !== 0), entry => Math.min(entry.floor, entry.tail), entry => Math.max(entry.floor, entry.tail));
    this.hasYControl = (line.yControl?.length ?? 0) > 1 && (line.yControl ?? []).some(point => point.y !== 1);
  }

  floor(seconds: number): number { return this.speeds.reduce((sum, speed) => sum + speed.distance(seconds), 0); }
  value(type: TrackType, seconds: number): number { return this.tracks[type].reduce((sum, track) => sum + Number(track.value(seconds)), 0); }

  state(seconds: number): LineState {
    return { x: this.value('moveXEvents', seconds), y: this.value('moveYEvents', seconds),
      rotation: this.value('rotateEvents', seconds), alpha: this.value('alphaEvents', seconds),
      scaleX: Number(this.extended.scaleXEvents.value(seconds)), scaleY: Number(this.extended.scaleYEvents.value(seconds)),
      color: this.extended.colorEvents.value(seconds) as Color, text: this.extended.textEvents.value(seconds) as string,
      incline: Number(this.extended.inclineEvents.value(seconds)), floor: this.floor(seconds) };
  }

  visibleNotes(seconds: number, state: LineState, radius = 1600): HitEntry[] {
    if (state.alpha < 0) return [];
    const range = radius / this.minSpeed;
    const entries = this.hasYControl ? this.notes : [...(this.index.query(state.floor - range, state.floor + range) as IndexedInterval<HitEntry>[]).map(entry => entry.item), ...this.staticNotes];
    return entries.filter(entry => {
      if (entry.end < seconds || entry.start - seconds > (entry.note.visibleTime ?? 999999)) return false;
      if (this.line.isCover === 1 && (entry.note.type === 2 ? entry.tail : entry.floor) < state.floor) return false;
      return true;
    });
  }

  noteState(entry: HitEntry, state: LineState, seconds: number): NoteState {
    const note = entry.note;
    const activeHold = note.type === 2 && entry.start < seconds;
    const distance = activeHold ? note.yOffset ?? 0 : entry.floor - state.floor;
    const speed = note.speed ?? 1;
    const side = noteIsAbove(note) ? 1 : -1;
    const isHold = note.type === 2;
    let horizontal = note.positionX * (isHold ? 1 : this.controls.pos.value(distance));
    const vertical = distance * speed * side * (isHold ? 1 : this.controls.y.value(distance));
    if (!isHold && Math.abs(state.incline) > 0.01) horizontal -= Math.tan(note.positionX / 675 * state.incline * Math.PI / 180) * distance * speed * side;
    return { x: horizontal, y: vertical, tail: (entry.tail - state.floor) * speed * side,
      size: (note.size ?? 1) * (isHold ? 1 : this.controls.size.value(distance)),
      alpha: (note.alpha ?? 255) / 255 * this.controls.alpha.value(distance),
      skew: isHold ? 0 : note.positionX * this.controls.skew.value(distance), showHead: !activeHold };
  }
}

/** A line's runtime state at one instant, as {@link LineRuntime.state} reports it. */
export interface LineState {
  x: number;
  y: number;
  rotation: number;
  alpha: number;
  scaleX: number;
  scaleY: number;
  color: Color;
  text: string;
  incline: number;
  floor: number;
}

/**
 * Where one note sits on screen, as {@link LineRuntime.noteState} reports it.
 *
 * `x`/`y` are the note's own offsets from the line; `tail` is the hold's far end; `alpha` is already
 * normalised to 0-1 while the line's own alpha stays in 0-255.
 */
export interface NoteState {
  x: number;
  y: number;
  tail: number;
  size: number;
  alpha: number;
  skew: number;
  showHead: boolean;
}

/**
 * Samples a line at a fixed instant, already resolving parent-line inheritance on demand.
 *
 * The result is `undefined` for an index outside `lines`, which is what the renderer relies on when
 * a pass refers to a line the current chart no longer has.
 */
export type SceneSampler = (index: number) => LineState | undefined;

/** Every judge line of one document compiled once, so a frame reuses the same runtime objects. */
export class SceneRuntime {
  cache: WeakMap<JudgeLine, LineRuntime>;
  chart: Chart | null;
  tempo: TempoMap | null;
  lines: LineRuntime[];
  order: number[];

  constructor() {
    this.cache = new WeakMap();
    this.chart = null;
    this.tempo = null;
    this.lines = [];
    this.order = [];
  }

  compile(chart: Chart, tempo: TempoMap): void {
    if (this.chart === chart && this.tempo === tempo) return;
    if (this.tempo !== tempo) { this.cache = new WeakMap(); this.tempo = tempo; }
    this.chart = chart;
    this.lines = (chart.judgeLineList ?? []).map(line => {
      if (!this.cache.has(line)) this.cache.set(line, new LineRuntime(line, tempo));
      return this.cache.get(line) as LineRuntime;
    });
    this.order = this.lines.map((line, index) => index).sort((left, right) => Number(this.lines[left].line.zOrder ?? 0) - Number(this.lines[right].line.zOrder ?? 0) || left - right);
  }

  sampler(seconds: number): SceneSampler {
    const states: (LineState | undefined)[] = [];
    const done = new Set<number>();
    const resolving = new Set<number>();
    const resolve = (index: number): boolean => {
      if (done.has(index)) return true;
      if (resolving.has(index)) return false;
      resolving.add(index);
      states[index] = this.lines[index].state(seconds);
      const line = this.lines[index].line;
      const father: unknown = line.father;
      const parent = father === null || father === undefined || father === '' ? -1 : (Number.isInteger(father) ? Number(father) : Number(father));
      if (Number.isInteger(parent) && parent >= 0 && parent < this.lines.length) {
        if (!resolve(parent)) { resolving.delete(index); done.add(index); return false; }
        const ancestor = states[parent] as LineState;
        const local = states[index] as LineState;
        const angle = -ancestor.rotation * Math.PI / 180;
        states[index] = { ...local, x: ancestor.x + local.x * Math.cos(angle) - local.y * Math.sin(angle),
          y: ancestor.y + local.x * Math.sin(angle) + local.y * Math.cos(angle),
          rotation: local.rotation + (line.rotateWithFather === undefined ? ((this.chart?.META.RPEVersion ?? 0) >= 163 ? ancestor.rotation : 0) : (line.rotateWithFather ? ancestor.rotation : 0)) };
      }
      resolving.delete(index);
      done.add(index);
      return true;
    };
    return (index: number): LineState | undefined => { if (!this.lines[index]) return undefined; resolve(index); return states[index]; };
  }

  sample(seconds: number): (LineState | undefined)[] {
    const sample = this.sampler(seconds);
    return this.lines.map((runtime, index) => sample(index));
  }
}
