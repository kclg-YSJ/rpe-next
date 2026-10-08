// Shared domain types for the RPE chart format.
//
// These describe the on-disk document as faithfully as the RPE specification allows, which is
// deliberately loose in places: real charts in the wild omit optional fields, carry unknown
// `extended` sub-tracks from newer RPE builds, and store numbers as either integers or strings.
// The types therefore mark genuinely optional members optional and index the open-ended extension
// bags, rather than pretending the format is closed.
//
// Conversion and validation stay in `chart.ts` (`assertChart`); these types describe what the rest
// of the application may assume once a document has passed it.

/** A beat position, stored as `[whole, numerator, denominator]`. */
export type Beat = [whole: number, numerator: number, denominator: number];

/** An RGB colour, 0-255 per channel. */
export type Color = [red: number, green: number, blue: number];

/** The five event tracks every RPE judge line carries. */
export type EventType = 'moveXEvents' | 'moveYEvents' | 'rotateEvents' | 'alphaEvents' | 'speedEvents';

/** The extra tracks RPE stores under `extended`. */
export type ExtendedType =
  | 'scaleXEvents' | 'scaleYEvents' | 'colorEvents' | 'paintEvents'
  | 'textEvents' | 'inclineEvents' | 'gifEvents';

/** Every event track name the editor understands. */
export type AnyEventType = EventType | ExtendedType;

/** Note kinds, matching the RPE numeric codes. */
export type NoteType = 1 | 2 | 3 | 4;

/**
 * A value carried by an event. Scalar tracks store numbers, `colorEvents` stores a colour and
 * `textEvents` stores (or references) a string.
 */
export type EventValue = number | Color | string;

/**
 * One editable parameter a curve preset declares.
 *
 * A preset ships a list of these so the trajectory panel can build a control per parameter; `value`
 * is the default the preset starts from, and `min`/`max`/`step` bound the slider.
 */
export interface CurveParameter {
  key: string;
  label?: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
}

/**
 * The settings a whole-curve trajectory is compiled from.
 *
 * This mirrors `TRAJECTORY_DEFAULTS` in `curve-trajectory.ts`. The expressions are user-authored
 * scripts and are therefore stored as strings; `mode` and the optional `shape` select which of them
 * are read. Every member is present on a compiled trajectory — `compileTrajectory` fills the
 * defaults in — while a preset or a saved document may carry only some of them, which is what
 * `editableTrajectoryOptions` reconciles.
 */
export interface CurveTrajectoryOptions {
  mode: 'parametric' | 'polar';
  /** Set by the generated-figure presets, which synthesise their expressions instead. */
  shape?: 'star' | 'random-polygon';
  xExpression: string;
  yExpression: string;
  radiusExpression: string;
  rotationExpression: string;
  tangentRotation: boolean;
  parameterStart: string;
  parameterEnd: string;
  angleStart: string;
  angleEnd: string;
  trimStart: number;
  trimEnd: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  alignStart: boolean;
  startX: number;
  startY: number;
  easingX: number;
  easingY: number;
  seed: number;
  randomness: number;
  parameters: Record<string, number>;
}

/** How an expanded trajectory is fitted back onto easing segments. */
export interface TrajectorySplit {
  simplify: boolean;
  tolerance: number;
}

/**
 * A whole-curve trajectory riding on a `moveXEvents` event.
 *
 * Only the X track stores one. The curve stands in for the entire motion, so the host event's own
 * `start`/`end` are only the endpoints it is anchored to; `expandTrajectory` turns it back into
 * ordinary per-event fragments for readers that do not understand it.
 */
export interface Trajectory {
  version: number;
  options: CurveTrajectoryOptions;
  segments: number;
  split: TrajectorySplit;
}

/**
 * A single easing event.
 *
 * `start`/`end` hold the track's values; `startTime`/`endTime` hold the beat range. The shader
 * extension stores non-numeric payloads in `start`/`end`, which is why they stay loosely typed.
 */
export interface ChartEvent {
  startTime: Beat;
  endTime: Beat;
  start: EventValue;
  end: EventValue;
  easingType: number;
  easingLeft: number;
  easingRight: number;
  bezier: number;
  bezierPoints: number[];
  linkgroup: number;
  /** Marks an instantaneous ("hooked") event, tolerated as either a boolean or 0/1. */
  inst?: boolean | number;
  /** Shader events identify their target and parameters through these. */
  shader?: string;
  shaderName?: string;
  order?: number;
  params?: unknown;
  /** The whole-curve trajectory this event carries; present only on the X track. */
  trajectory?: Trajectory;
  /**
   * Which reading of a trajectory a synthesised event carries.
   *
   * `LineRuntime` clones a trajectory event onto the Y and rotation tracks so those tracks evaluate
   * the same curve, marking the axis to read. Absent on real events, which are the X reading.
   */
  trajectoryAxis?: 'x' | 'y' | 'rotation';
  [key: string]: unknown;
}

/** A note on a judge line. */
export interface Note {
  type: NoteType;
  startTime: Beat;
  endTime: Beat;
  positionX: number;
  /** 1 for above the line, 0 for below. */
  above?: number | boolean;
  isFake?: number | boolean;
  speed?: number;
  size?: number;
  yOffset?: number;
  visibleTime?: number;
  alpha?: number;
  /** Per-note tint, present on charts that blend a texture with a colour. */
  color?: Color;
  [key: string]: unknown;
}

/** A layer of event tracks. */
export type EventLayer = Partial<Record<AnyEventType, ChartEvent[]>>;

/** A control point on one of the line's interpolation curves. */
export interface ControlPoint {
  x: number;
  [property: string]: number;
}

/** A judge line, including the properties RPE adds beyond the base format. */
export interface JudgeLine {
  Name: string;
  Group: number;
  Texture: string;
  bpmfactor: number;
  father: number;
  rotateWithFather: boolean;
  isCover: number;
  zOrder: number;
  anchor: number[];
  isGif: boolean;
  eventLayers: EventLayer[];
  extended: EventLayer;
  notes: Note[];
  numOfNotes: number;
  /** UI element this line drives, when bound. */
  attachUI?: string;
  alphaControl?: ControlPoint[];
  posControl?: ControlPoint[];
  sizeControl?: ControlPoint[];
  skewControl?: ControlPoint[];
  yControl?: ControlPoint[];
  [key: string]: unknown;
}

/** Chart metadata. `RPEVersion` drives the compatibility notes shown in the editor. */
export interface ChartMeta {
  RPEVersion: number;
  name: string;
  composer: string;
  charter: string;
  illustration: string;
  level: string;
  song: string;
  background: string;
  /** Offset in milliseconds. */
  offset: number;
  [key: string]: unknown;
}

/** One tempo entry. */
export interface BpmEntry {
  bpm: number;
  startTime: Beat;
  [key: string]: unknown;
}

/** A complete RPE chart document. */
export interface Chart {
  META: ChartMeta;
  BPMList: BpmEntry[];
  judgeLineGroup: string[];
  judgeLineList: JudgeLine[];
  /**
   * Present when the document was imported from another format, so re-export can preserve it.
   *
   * Nothing is required beyond the open-ended bag: the JSON-derived formats keep their original
   * bytes in `text`, while the official v3 converter stores the parsed document in `document`, and
   * consumers only test for presence. Requiring `text` here would misdescribe those documents.
   */
  rpeNextLegacySource?: { [key: string]: unknown };
  [key: string]: unknown;
}

/** A point in time, in both beats and seconds, as used by the editor's cursor readouts. */
export interface TimePoint {
  beat: number;
  seconds: number;
}

/** A selection of notes, keyed by owning line then note index. */
export type NoteSelection = Map<number, Set<number>>;
