import { upperBound } from './beat.ts';
import { easing, bezier } from './easing.ts';
import { trajectoryEventValue } from './curve-trajectory.ts';
import type { TempoMap } from './tempo.ts';
import type { ChartEvent, Color, EventValue } from './types.ts';

/**
 * One event resolved to wall-clock seconds.
 *
 * `start`/`end` are the event's own beat range converted through the tempo map, so every later
 * lookup is a binary search over seconds rather than over beats.
 */
export interface ResolvedEvent {
  event: ChartEvent;
  start: number;
  end: number;
}

/** The value an event track yields: a number, an RGB triple, or text. */
export type TrackValue = EventValue;

/**
 * Samples one event track (for example `moveXEvents`) at an arbitrary time.
 *
 * A track is a piecewise curve: each event eases from its `start` value to its `end` value across
 * its own time range, and the value at any instant belongs to the event whose start precedes it.
 * The `fallback` is returned only when the track holds no events at all — that is what makes an
 * empty `alphaEvents` layer behave as fully opaque while an empty `moveXEvents` layer behaves as 0.
 */
export class EventTrack {
  fallback: TrackValue;
  events: ResolvedEvent[];

  constructor(events: ChartEvent[] | undefined, tempo: TempoMap, factor = 1, fallback: TrackValue = 0) {
    this.fallback = fallback;
    this.events = (events ?? []).map(event => ({ event, start: tempo.seconds(event.startTime, factor), end: tempo.seconds(event.endTime, factor) }))
      .sort((left, right) => left.start - right.start);
  }

  value(seconds: number): TrackValue {
    if (!this.events.length) return this.fallback;
    const entry = this.events[Math.max(0, upperBound(this.events, seconds, item => item.start) - 1)];
    return this.sample(entry, seconds);
  }

  /**
   * Samples a single event at `seconds`.
   *
   * The return type is the union because the caller decides what a colour or text track means; the
   * branches below are exhaustive over the possible `start`/`end` shapes but TypeScript cannot
   * correlate the two indexed reads, so each branch narrows independently.
   */
  sample(entry: ResolvedEvent, seconds: number): TrackValue {
    const event = entry.event;
    // A whole-curve trajectory owns its own value on every axis, so it replaces the easing below
    // rather than being read through it. `trajectoryAxis` is set on the virtual copies the line
    // runtime builds for the Y and rotation tracks.
    if (event.trajectory) return trajectoryEventValue(event, entry.end <= entry.start ? 1 : Math.max(0, Math.min(1, (seconds - entry.start) / (entry.end - entry.start))));
    if (typeof event.start === 'number' && event.start === event.end) return event.start;
    if (Array.isArray(event.start) && Array.isArray(event.end) && event.start.every((value, index) => value === (event.end as Color)[index])) return event.start;
    const progress = entry.end <= entry.start ? 1 : Math.max(0, Math.min(1, (seconds - entry.start) / (entry.end - entry.start)));
    const amount = event.bezier ? bezier(progress, event.bezierPoints) : easing(progress, event.easingType, event.easingLeft ?? 0, event.easingRight ?? 1);
    if (Array.isArray(event.start) && Array.isArray(event.end)) {
      const from = event.start as Color;
      const to = event.end as Color;
      const blended: Color = [from[0] + (to[0] - from[0]) * amount, from[1] + (to[1] - from[1]) * amount, from[2] + (to[2] - from[2]) * amount];
      return blended;
    }
    if (typeof event.start === 'string' && typeof event.end === 'string') {
      if (seconds < entry.start) return '';
      if (seconds >= entry.end) return event.end.replaceAll('%P%', '');
      if (event.start.includes('%P%') && event.end.includes('%P%')) {
        const start = Number.parseFloat(event.start.replaceAll('%P%', ''));
        const end = Number.parseFloat(event.end.replaceAll('%P%', ''));
        if (Number.isFinite(start) && Number.isFinite(end)) {
          const value = start + (end - start) * amount;
          return Number.isInteger(start) && Number.isInteger(end) ? String(Math.trunc(value)) : value.toFixed(3);
        }
      }
      if (event.end.startsWith(event.start)) return event.start + [...event.end.slice(event.start.length)].slice(0, Math.floor([...event.end.slice(event.start.length)].length * amount)).join('');
      if (event.start.startsWith(event.end)) return event.end + [...event.start.slice(event.end.length)].slice(0, Math.floor([...event.start.slice(event.end.length)].length * (1 - amount))).join('');
      return event.start;
    }
    if (typeof event.start !== 'number' || typeof event.end !== 'number') return event.start;
    return event.start + (event.end - event.start) * amount;
  }
}

/**
 * One constant-speed slice of the timeline.
 *
 * `distance` is the cumulative distance at `start`, so integrating a slice only has to add the
 * contribution of the slice itself rather than re-walking everything before it.
 */
export interface SpeedSegment {
  start: number;
  end: number;
  distance: number;
  entry: ResolvedEvent;
}

/**
 * The time integral of a speed track: converts a time to the distance a note travelling at that
 * speed would have covered.
 *
 * The track is cut at every event boundary so that each slice is a single continuous curve, which
 * makes each slice integrable in closed form (linear, or Simpson's rule for eased curves).
 */
export class SpeedIntegral extends EventTrack {
  segments: SpeedSegment[];
  firstTime: number;
  lastTime: number;
  lastDistance: number;
  /** The raw integral at t=0, subtracted so `distance` starts at zero wherever the chart does. */
  zero: number;

  constructor(events: ChartEvent[] | undefined, tempo: TempoMap, factor = 1) {
    super(events, tempo, factor, 0);
    const cuts = [...new Set([0, ...this.events.flatMap(entry => [entry.start, entry.end])])].sort((left, right) => left - right);
    this.segments = [];
    let distance = 0;
    for (let index = 0; index < cuts.length - 1; index++) {
      const start = cuts[index];
      const end = cuts[index + 1];
      const entry = this.events[Math.max(0, upperBound(this.events, (start + end) / 2, event => event.start) - 1)];
      const segment: SpeedSegment = { start, end, distance, entry };
      this.segments.push(segment);
      distance += this.integrate(segment, end);
    }
    this.firstTime = cuts[0];
    this.lastTime = cuts.at(-1) as number;
    this.lastDistance = distance;
    this.zero = this.raw(0);
  }

  /** Integrates the slice from its own `start` up to `end`, in the event's speed units. */
  integrate(segment: SpeedSegment, end: number): number {
    if (!segment.entry) return 0;
    const { event, start: eventStart, end: eventEnd } = segment.entry;
    const duration = end - segment.start;
    if (event.start === event.end) return duration * (event.start as number);
    if (segment.start >= eventEnd) return duration * (this.sample(segment.entry, eventEnd) as number);
    if (end <= eventStart) return duration * (this.sample(segment.entry, eventStart) as number);
    if (!event.bezier && (event.easingType ?? 1) === 1) return duration * ((this.sample(segment.entry, segment.start) as number) + (this.sample(segment.entry, end) as number)) / 2;
    const step = (end - segment.start) / 20;
    let sum = 0;
    for (let index = 0; index <= 20; index++) {
      const weight = index === 0 || index === 20 ? 1 : index % 2 ? 4 : 2;
      sum += weight * (this.sample(segment.entry, segment.start + step * index) as number);
    }
    return sum * step / 3;
  }

  /** The unbounded integral at `seconds`, before the t=0 offset is applied. */
  raw(seconds: number): number {
    if (seconds <= this.firstTime) return (seconds - this.firstTime) * (this.value(this.firstTime) as number);
    if (seconds >= this.lastTime) return this.lastDistance + (seconds - this.lastTime) * (this.value(this.lastTime) as number);
    const segment = this.segments[Math.max(0, upperBound(this.segments, seconds, entry => entry.start) - 1)];
    return segment.distance + this.integrate(segment, seconds);
  }

  /** The distance travelled by `seconds`, in the editor's 120-units-per-second screen scale. */
  distance(seconds: number): number { return (this.raw(seconds) - this.zero) * 120; }
}
