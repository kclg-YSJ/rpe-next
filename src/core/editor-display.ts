import { beatValue } from './beat.ts';
import { easing } from './easing.ts';
import { trajectoryEventValue } from './curve-trajectory.ts';
import type { TempoMap } from './tempo.ts';
import type { Chart, ChartEvent, Note } from './types.ts';

/**
 * An event paired with its position in the source array.
 *
 * The index survives sorting, so callers can map a drawn bar or a curve sample back onto the event
 * they came from.
 */
export interface IndexedEvent {
  event: ChartEvent;
  index: number;
}

/** A run of events that touch head-to-tail, with the value range their curves span. */
export interface EventChain {
  entries: IndexedEvent[];
  min: number;
  max: number;
}

/** A point in canvas pixels, as produced by the pointer helpers. */
export interface Point {
  x: number;
  y: number;
}

/** The clip rectangle the preview draws into, in canvas pixels. */
export interface PreviewViewport {
  scale: number;
  width: number;
  height: number;
  left: number;
  top: number;
}

/** One hit particle, in pixels relative to the hit, expanded by a decaying factor. */
export interface HitParticle {
  x: number;
  y: number;
  radius: number;
  alpha: number;
}

export const SPECIAL_TRACKS = [
  { key: 'scaleXEvents', label: '缩放 X' }, { key: 'scaleYEvents', label: '缩放 Y' },
  { key: 'colorEvents', label: '颜色' }, { key: 'paintEvents', label: '着色器' }, { key: 'textEvents', label: '文字' },
];
export const MAX_BASE_LAYERS = 4;

export function previewViewport(width: number, height: number, ratio = 1.5): PreviewViewport {
  const logicalWidth = Math.min(1350, 900 * ratio);
  const logicalHeight = Math.min(900, 1350 / ratio);
  const scale = Math.min(width / logicalWidth, height / logicalHeight);
  return { scale, width: logicalWidth * scale, height: logicalHeight * scale,
    left: (width - logicalWidth * scale) / 2, top: (height - logicalHeight * scale) / 2 };
}

export function eventChains(events: readonly ChartEvent[]): EventChain[] {
  const groups: EventChain[] = [];
  for (const entry of events.map((event, index): IndexedEvent => ({ event, index })).sort((left, right) => beatValue(left.event.startTime) - beatValue(right.event.startTime))) {
    let group: EventChain | undefined = groups.at(-1);
    const last: IndexedEvent | undefined = group?.entries.at(-1);
    // A trajectory both starts its own chain and ends the previous one: its curve is its own reading,
    // so it must not be merged into a neighbouring chain's value range.
    if (!group || !last || entry.event.trajectory || last.event.trajectory || Math.abs(beatValue(last.event.endTime) - beatValue(entry.event.startTime)) > 1e-8) {
      group = { entries: [], min: Infinity, max: -Infinity }; groups.push(group);
    }
    group.entries.push(entry);
    if (entry.event.trajectory) for (let index = 0; index <= 64; index++) { const value = trajectoryEventValue(entry.event, index / 64); group.min = Math.min(group.min, value); group.max = Math.max(group.max, value); }
    for (const value of [entry.event.start, entry.event.end]) if (typeof value === 'number') { group.min = Math.min(group.min, value); group.max = Math.max(group.max, value); }
  }
  return groups;
}

export function simultaneousNotes(chart: Chart, tempo: TempoMap): Set<Note> {
  const counts = new Map<number, number>(); const times = new Map<Note, number>();
  for (const line of chart.judgeLineList ?? []) for (const note of line.notes ?? []) {
    const time = Math.round(tempo.seconds(note.startTime, line.bpmfactor ?? 1) * 1000000);
    times.set(note, time); counts.set(time, (counts.get(time) ?? 0) + 1);
  }
  return new Set([...times].filter(([, time]) => counts.get(time)! > 1).map(([note]) => note));
}

export function strokeIntersects(start: Point, end: Point, rectangle: { left: number; right: number; top: number; bottom: number }): boolean {
  return Math.max(start.x, end.x) >= rectangle.left && Math.min(start.x, end.x) <= rectangle.right
    && Math.max(start.y, end.y) >= rectangle.top && Math.min(start.y, end.y) <= rectangle.bottom;
}

export function hitParticles(age: number, seed: number, size: number): HitParticle[] {
  if (age < 0 || age >= 2 / 3) return [];
  const amount = easing(age * 1.5, 16);
  return Array.from({ length: 4 }, (unused, index) => {
    const random = Math.sin(seed * 12.9898 + index * 78.233) * 43758.5453;
    const angle = (random - Math.floor(random)) * Math.PI * 2;
    return { x: Math.cos(angle) * size * 1.1 * amount, y: Math.sin(angle) * size * 1.1 * amount,
      radius: size * 0.075 * amount, alpha: Math.max(0, 1 - age * 1.5) };
  });
}
