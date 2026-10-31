import { upperBound } from './beat.mjs';
import { easing, bezier } from './easing.mjs';
import { trajectoryEventValue } from './curve-trajectory.mjs';

export class EventTrack {
  constructor(events, tempo, factor = 1, fallback = 0) {
    this.fallback = fallback;
    this.events = (events ?? []).map(event => ({ event, start: tempo.seconds(event.startTime, factor), end: tempo.seconds(event.endTime, factor) }))
      .sort((left, right) => left.start - right.start);
    this.cursor = 0;
  }

  value(seconds) {
    if (!this.events.length) return this.fallback;
    const current = this.events[this.cursor], next = this.events[this.cursor + 1];
    if (!Number.isFinite(seconds) || (!current || seconds < current.start && this.cursor !== 0) || next && seconds >= next.start) this.cursor = Math.max(0, upperBound(this.events, seconds, item => item.start) - 1);
    const entry = this.events[this.cursor];
    return this.sample(entry, seconds);
  }

  sample(entry, seconds) {
    const event = entry.event;
    if (event.trajectory) return trajectoryEventValue(event, entry.end <= entry.start ? 1 : Math.max(0, Math.min(1, (seconds - entry.start) / (entry.end - entry.start))));
    if (typeof event.start === 'number' && event.start === event.end) return event.start;
    if (Array.isArray(event.start) && Array.isArray(event.end) && event.start.every((value, index) => value === event.end[index])) return event.start;
    const progress = entry.end <= entry.start ? 1 : Math.max(0, Math.min(1, (seconds - entry.start) / (entry.end - entry.start)));
    const amount = event.bezier ? bezier(progress, event.bezierPoints) : easing(progress, event.easingType, event.easingLeft ?? 0, event.easingRight ?? 1);
    if (Array.isArray(event.start) && Array.isArray(event.end)) return event.start.map((value, index) => value + (event.end[index] - value) * amount);
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

export class SpeedIntegral extends EventTrack {
  constructor(events, tempo, factor = 1) {
    super(events, tempo, factor, 0);
    const cuts = [...new Set([0, ...this.events.flatMap(entry => [entry.start, entry.end])])].sort((left, right) => left - right);
    this.segments = [];
    let distance = 0;
    for (let index = 0; index < cuts.length - 1; index++) {
      const start = cuts[index];
      const end = cuts[index + 1];
      const entry = this.events[Math.max(0, upperBound(this.events, (start + end) / 2, event => event.start) - 1)];
      const segment = { start, end, distance, entry };
      this.segments.push(segment);
      distance += this.integrate(segment, end);
    }
    this.firstTime = cuts[0];
    this.lastTime = cuts.at(-1);
    this.lastDistance = distance;
    this.zero = this.raw(0);
  }

  integrate(segment, end) {
    if (!segment.entry) return 0;
    const { event, start: eventStart, end: eventEnd } = segment.entry;
    const duration = end - segment.start;
    if (event.start === event.end) return duration * event.start;
    if (segment.start >= eventEnd) return duration * this.sample(segment.entry, eventEnd);
    if (end <= eventStart) return duration * this.sample(segment.entry, eventStart);
    if (!event.bezier && (event.easingType ?? 1) === 1) return duration * (this.sample(segment.entry, segment.start) + this.sample(segment.entry, end)) / 2;
    const step = (end - segment.start) / 20;
    let sum = 0;
    for (let index = 0; index <= 20; index++) {
      const weight = index === 0 || index === 20 ? 1 : index % 2 ? 4 : 2;
      sum += weight * this.sample(segment.entry, segment.start + step * index);
    }
    return sum * step / 3;
  }

  raw(seconds) {
    if (seconds <= this.firstTime) return (seconds - this.firstTime) * this.value(this.firstTime);
    if (seconds >= this.lastTime) return this.lastDistance + (seconds - this.lastTime) * this.value(this.lastTime);
    const segment = this.segments[Math.max(0, upperBound(this.segments, seconds, entry => entry.start) - 1)];
    return segment.distance + this.integrate(segment, seconds);
  }

  distance(seconds) { return (this.raw(seconds) - this.zero) * 120; }
}
