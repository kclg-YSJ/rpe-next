import { beatValue, fromNumber } from '../core/beat.ts';
import { easing, bezier } from '../core/easing.ts';
import { EVENT_TYPES } from '../core/chart.ts';
import { snapTime } from '../core/edit-grid.ts';
import { eventList, eventKey, selectedEvents, commitEventLists } from './event-commands.ts';
import type { EventEditSession } from './event-commands.ts';
import type { ChartEvent, Color, EventValue } from '../core/types.ts';

/** The tracks the cut tool understands: every base track plus the numeric extended ones. */
const cutTypes = new Set<string>([...EVENT_TYPES, 'scaleXEvents', 'scaleYEvents', 'colorEvents']);

/** What {@link cutEventParts} needs from a tempo map; matches `TempoMap`. */
interface CutTempo {
  seconds(beat: number, factor?: number): number;
  beat(seconds: number, factor?: number): number;
}

/**
 * The tempo map `snapTime` measures with.
 *
 * `snapTime` is declared against `core/tempo.ts`'s `TempoMap`, whose accessors additionally accept a
 * beat triple. {@link CutTempo} stays the narrower view this module documents, because the cuts it
 * computes always work on beat numbers; the two accessors the cut path uses are the only ones the
 * object has to provide, so the intersection below keeps `CutOptions.tempo` assignable to both
 * without widening the runtime contract or restating `TempoMap` here.
 */
type SnapTempo = CutTempo & Parameters<typeof snapTime>[2];

/** Options for {@link cutEventParts}; `tempo` is omitted at call sites that work in raw beats. */
export interface CutOptions {
  division?: number;
  density?: number;
  beat?: number;
  tempo?: SnapTempo;
  factor?: number;
}

/** How many events a cut or stick pass rewrote, generated and left alone. */
export interface CutResult {
  changed: number;
  generated: number;
  skipped: number;
}

export function canCutEvent(type: string, event: ChartEvent): boolean {
  return !event.trajectory && cutTypes.has(type) && beatValue(event.endTime) > beatValue(event.startTime);
}

export function cutEventParts(type: string, event: ChartEvent, { division = 4, density = 4, beat, tempo, factor = 1 }: CutOptions = {}): ChartEvent[] | null {
  if (!canCutEvent(type, event)) return null;
  if (!Number.isFinite(density) || density <= 0 || !Number.isFinite(division) || division < 1) throw new Error('切割密度和横线细分必须大于零');
  const subdivisions = Math.max(1, Math.trunc(division * density));
  const start = beatValue(event.startTime); const end = beatValue(event.endTime);
  const snapped = tempo ? beatValue(snapTime(tempo.seconds(beat ?? start, factor), division, tempo, factor)) : Math.round((beat ?? start) * division) / division;
  const anchor = snapped > start && snapped < end ? snapped : start;
  const count = Math.ceil((end - start) * subdivisions) + 1;
  if (count > 100000) throw new Error('切割结果过多，请降低密度或分批切割');
  const cuts = [start];
  const first = Math.floor((start - anchor) * subdivisions) + 1;
  for (let index = first; index <= Math.ceil((end - anchor) * subdivisions); index++) {
    const point = anchor + index / subdivisions;
    if (point >= end - 1e-9) break;
    if (point > start + 1e-9) cuts.push(point);
  }
  cuts.push(end);
  // Samples the event's own interpolation. Colour events interpolate per channel, numeric tracks
  // interpolate once; `alphaEvents` truncates because alpha is stored as an integer.
  const sample = (position: number): EventValue => {
    const progress = (position - start) / (end - start);
    const amount = event.bezier ? bezier(progress, event.bezierPoints) : easing(progress, event.easingType, event.easingLeft ?? 0, event.easingRight ?? 1);
    if (Array.isArray(event.start)) {
      const from = event.start as number[]; const to = event.end as number[];
      // Channel-wise sample of a colour event; `cutTypes` only admits three-channel tracks here, so
      // the three channels are written out rather than mapped. `Array.map` erases the tuple to
      // `number[]`, which is not assignable to `Color`; spelling the triple out keeps the result
      // exactly what the mapped form produced, with `Math.trunc` applied per channel.
      const blended: Color = [
        Math.trunc(from[0] + (to[0] - from[0]) * amount),
        Math.trunc(from[1] + (to[1] - from[1]) * amount),
        Math.trunc(from[2] + (to[2] - from[2]) * amount),
      ];
      return blended;
    }
    const value = (event.start as number) + ((event.end as number) - (event.start as number)) * amount;
    return type === 'alphaEvents' ? Math.trunc(value) : value;
  };
  return cuts.slice(0, -1).map((point, index): ChartEvent => ({ ...structuredClone(event), startTime: fromNumber(point), endTime: fromNumber(cuts[index + 1]),
    start: sample(point), end: sample(cuts[index + 1]), easingType: 1, easingLeft: 0, easingRight: 1, bezier: 0, bezierPoints: [0, 0, 1, 1], linkgroup: 0, inst: 0 }));
}

export function cutSelectedEvents(session: EventEditSession, options: CutOptions = {}): CutResult {
  const updates = new Map(); const selection = new Set<string>(); let changed = 0; let generated = 0; let skipped = 0;
  for (const type of new Set(selectedEvents(session).map(entry => entry.type))) {
    // Keeps each produced piece paired with the selection flag of the event it came from, so the
    // replacement segments of a selected event stay selected after the sort below.
    const events: { item: ChartEvent; selected: boolean }[] = [];
    eventList(session, type).forEach((event, index) => {
      const selected = session.eventSelection.has(eventKey(type, index));
      const parts = selected ? cutEventParts(type, event, options) : null;
      if (selected && !parts) skipped++;
      if (parts) { changed++; generated += parts.length; }
      if (generated > 100000) throw new Error('切割结果过多，请降低密度或分批切割');
      for (const item of parts ?? [event]) events.push({ item, selected });
    });
    events.sort((left, right) => beatValue(left.item.startTime) - beatValue(right.item.startTime));
    events.forEach((entry, index) => { if (entry.selected) selection.add(eventKey(type, index)); });
    updates.set(type, events.map(entry => entry.item));
  }
  if (changed) commitEventLists(session, '切割选中事件', updates, selection);
  return { changed, generated, skipped };
}

/** Snaps each selected event's start value onto the end value of the event before it. */
export function stickSelectedEvents(session: EventEditSession): { changed: number; skipped: number } {
  const updates = new Map(); let changed = 0; let skipped = 0;
  for (const type of new Set(selectedEvents(session).map(entry => entry.type))) {
    const events = [...eventList(session, type)];
    if (type === 'paintEvents') { skipped += selectedEvents(session).filter(entry => entry.type === type).length; continue; }
    const order = events.map((event, index) => ({ event, index })).sort((left, right) => beatValue(left.event.startTime) - beatValue(right.event.startTime) || left.index - right.index);
    order.forEach((entry, position) => {
      if (!session.eventSelection.has(eventKey(type, entry.index))) return;
      if (!position) { skipped++; return; }
      const previous = events[order[position - 1].index];
      const start = structuredClone(previous.end);
      events[entry.index] = { ...entry.event, start, ...(entry.event.inst ? { end: structuredClone(start) } : {}) }; changed++;
    });
    updates.set(type, events);
  }
  if (changed) commitEventLists(session, '粘合选中事件', updates);
  return { changed, skipped };
}
