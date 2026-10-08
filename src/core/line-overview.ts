import { IntervalIndex } from './interval-index.ts';
import { upperBound } from './beat.ts';
import { EVENT_TYPES } from './chart.ts';
import type { Beat, ChartEvent, JudgeLine, Note } from './types.ts';
import type { TempoMap } from './tempo.ts';

/** One note or event placed on the real-seconds axis by {@link LineOverviewIndex}. */
interface TimedEntry<T> {
  item: T;
  start: number;
  end: number;
}

/** A {@link TimedEntry} for an event track, tagged with the channel it is drawn in. */
interface TimedEvent extends TimedEntry<ChartEvent> {
  /** 0-4 are the base tracks, 5 is every extended track. */
  channel: number;
  layer: number | undefined;
}

/** The slice of thumbnails to render, as computed by {@link lineOverviewWindow}. */
interface LineOverviewWindow {
  totalRows: number;
  maxRow: number;
  firstRow: number;
  indices: number[];
}

/** The panel geometry returned by {@link lineOverviewLayout}. */
interface LineOverviewLayout {
  columns: number;
  rows: number;
  thumbnailHeight: number;
  panelWidth: number;
}

/** What {@link LineOverviewIndex.sample} reports for one viewport. */
interface LineOverviewSample {
  notes: TimedEntry<Note>[];
  events: TimedEvent[];
  notesLeft: number;
  eventsLeft: number;
}

/** Moves `index` by one step, wrapping around `count`; `null` when there is nothing to step to. */
export function stepLine(index: number, direction: number, count: number): number | null {
  return count > 0 ? ((index + Math.sign(direction)) % count + count) % count : null;
}

/** Steps through a filtered list of line numbers, entering from either end when `index` is absent. */
export function stepOverviewLine(index: number, direction: number, indices: number[]): number | null {
  if (!indices.length || !direction) return null;
  const position = indices.indexOf(index);
  if (position < 0) return direction > 0 ? indices[0] : indices.at(-1) ?? null;
  return indices[stepLine(position, direction, indices.length) ?? 0];
}

/**
 * Computes the visible thumbnail window.
 *
 * `index` is the selected line; `browseRow` overrides the follow-the-selection row when the user
 * has dragged the scrollbar (`null` means follow).
 */
export function lineOverviewWindow(index: number, count: number, columns: number, rows: number, browseRow: number | null = null): LineOverviewWindow {
  const totalRows = Math.ceil(count / columns);
  const maxRow = Math.max(0, totalRows - rows);
  const firstRow = Math.max(0, Math.min(maxRow, browseRow ?? Math.floor(index / columns) - Math.floor(rows / 2)));
  const first = firstRow * columns;
  return { totalRows, maxRow, firstRow, indices: Array.from({ length: Math.max(0, Math.min(columns * rows, count - first)) }, (unused, offset) => first + offset) };
}

export function nearbyLines(index: number, count: number, columns = 5, rows = 4): number[] {
  return lineOverviewWindow(index, count, columns, rows).indices;
}

/** Derives the grid geometry from the stage box; all values are in CSS pixels. */
export function lineOverviewLayout(width: number, height: number): LineOverviewLayout {
  const panelWidth = Math.min(width - 16, width * 0.88, 1060);
  const columns = Math.max(2, Math.min(6, Math.floor((panelWidth - 36) / 140)));
  const previousRows = height < 300 ? 2 : 3;
  const thumbnailHeight = Math.floor(Math.max(24, Math.min(96, (height * 0.84 - 36) / previousRows - 26)));
  return { columns, rows: previousRows + 1, thumbnailHeight, panelWidth };
}

/**
 * Per-line index of what is visible on a thumbnail.
 *
 * Notes and events are stored twice: once as an interval tree over real seconds (for the
 * `matches`/`sample` overlap queries) and once as a sorted list of end times (for the "N left"
 * counters, which only need a binary search).
 */
export class LineOverviewIndex {
  notes: IntervalIndex<TimedEntry<Note>>;
  events: IntervalIndex<TimedEvent>;
  noteEnds: number[];
  eventEnds: number[];

  /**
   * `layer` restricts the index to one event layer (`undefined` indexes every layer); `extended`
   * switches to the extended tracks, where `shaders` are folded into the paint channel.
   */
  constructor(line: JudgeLine, tempo: TempoMap, shaders: ChartEvent[] = [], layer: number | undefined = undefined, extended = false) {
    const factor = line.bpmfactor ?? 1;
    const timing = <T extends { startTime: number | Beat; endTime: number | Beat }>(item: T): TimedEntry<T> => ({ item, start: tempo.seconds(item.startTime, factor), end: tempo.seconds(item.endTime, factor) });
    const notes = (line.notes ?? []).map(timing);
    const events: TimedEvent[] = [];
    if (extended) {
      const extendedTypes = ['scaleXEvents', 'scaleYEvents', 'colorEvents', 'paintEvents', 'textEvents'];
      for (const [type, list] of Object.entries(line.extended ?? {})) {
        const channel = extendedTypes.indexOf(type);
        if (channel < 0 || !Array.isArray(list)) continue;
        for (const event of list) if (event?.startTime && event?.endTime) events.push({ ...timing(event), channel, layer: 0 });
      }
      for (const event of shaders) events.push({ ...timing(event), channel: 3, layer: 0 });
    } else {
      const layers = layer === undefined ? (line.eventLayers ?? []) : [line.eventLayers?.[layer] ?? {}];
      layers.forEach((currentLayer, layerIndex) => EVENT_TYPES.forEach((type, channel) => {
        for (const event of currentLayer[type] ?? []) events.push({ ...timing(event), channel, layer: layer === undefined ? layerIndex : layer });
      }));
      if (layer === undefined) for (const [type, list] of Object.entries(line.extended ?? {})) {
        if (type === 'paintEvents' || !Array.isArray(list)) continue;
        for (const event of list) if (event?.startTime && event?.endTime) events.push({ ...timing(event), channel: 5, layer: 0 });
      }
      // Preserve the direct-constructor API used by diagnostics and plugins.
      // The line switcher passes an empty shader list for ordinary layers.
      for (const event of shaders) events.push({ ...timing(event), channel: 5, layer });
    }
    this.notes = new IntervalIndex(notes, entry => entry.start, entry => entry.end);
    this.events = new IntervalIndex(events, entry => entry.start, entry => entry.end);
    this.noteEnds = notes.map(entry => entry.end).sort((left, right) => left - right);
    this.eventEnds = events.map(entry => entry.end).sort((left, right) => left - right);
  }

  matches(start: number, end: number, notesOnly: boolean, eventsOnly: boolean): boolean {
    return (!notesOnly || this.notes.has(start, end)) && (!eventsOnly || this.events.has(start, end));
  }

  sample(seconds: number, start: number, end: number): LineOverviewSample {
    return {
      notes: this.notes.query(start, end).map(entry => entry.item),
      events: this.events.query(start, end).map(entry => entry.item),
      notesLeft: this.noteEnds.length - upperBound(this.noteEnds, seconds, value => value),
      eventsLeft: this.eventEnds.length - upperBound(this.eventEnds, seconds, value => value),
    };
  }
}
