import { IntervalIndex } from './interval-index.mjs';
import { upperBound } from './beat.mjs';
import { EVENT_TYPES } from './chart.mjs';
import { shaderEvents } from './shader-events.mjs';

const EMPTY = Object.freeze([]);
const lowerBound = (values, value) => {
  let low = 0, high = values.length;
  while (low < high) { const middle = (low + high) >>> 1; if (values[middle] < value) low = middle + 1; else high = middle; }
  return low;
};

// A connected run only needs one interval to answer whether a line is visible.
// Immutable line/track references let edits reuse the other lines' merged runs.
export class LineActivityIndex {
  constructor() { this.runs = new WeakMap(); this.tracks = new Map(); }

  lineRuns(line, tempo, lists, kind) {
    let cache = this.runs.get(line); if (!cache) { cache = new Map(); this.runs.set(line, cache); }
    const previous = cache.get(kind), factor = line.bpmfactor ?? 1;
    if (previous?.tempo === tempo && previous.factor === factor && lists.length === previous.lists.length && lists.every((list, i) => list === previous.lists[i])) return previous.intervals;
    const intervals = [];
    for (const list of lists) for (const item of list ?? EMPTY) {
      if (!item?.startTime || !item?.endTime) continue;
      intervals.push({ start: tempo.seconds(item.startTime, factor), end: tempo.seconds(item.endTime, factor) });
    }
    intervals.sort((a, b) => a.start - b.start);
    const merged = [];
    for (const entry of intervals) {
      const last = merged.at(-1);
      if (last && entry.start <= last.end) last.end = Math.max(last.end, entry.end);
      else merged.push({ ...entry });
    }
    cache.set(kind, { tempo, factor, lists, intervals: merged }); return merged;
  }

  track(chart, tempo, kind, layer, extended) {
    if (this.chart !== chart || this.tempo !== tempo) { this.chart = chart; this.tempo = tempo; this.tracks.clear(); }
    const key = kind === 'notes' ? kind : `${layer}:${extended}`;
    if (this.tracks.has(key)) return this.tracks.get(key);
    const entries = [];
    for (const [lineIndex, line] of (chart.judgeLineList ?? EMPTY).entries()) {
      const lists = kind === 'notes' ? [line.notes ?? EMPTY] : extended
        ? ['scaleXEvents', 'scaleYEvents', 'colorEvents', 'textEvents'].map(type => line.extended?.[type] ?? EMPTY).concat([shaderEvents(chart, lineIndex)])
        : EVENT_TYPES.map(type => line.eventLayers?.[layer]?.[type] ?? EMPTY);
      for (const interval of this.lineRuns(line, tempo, lists, kind === 'notes' ? kind : key)) entries.push({ ...interval, lineIndex });
    }
    const track = { index: new IntervalIndex(entries, entry => entry.start, entry => entry.end),
      starts: entries.map(entry => entry.start).sort((a, b) => a - b), ends: entries.map(entry => entry.end).sort((a, b) => a - b) };
    this.tracks.set(key, track); return track;
  }

  query(chart, tempo, start, end, kind, layer = 0, extended = false) {
    const track = this.track(chart, tempo, kind, layer, extended);
    const beforeEnd = upperBound(track.starts, end, value => value), beforeStart = lowerBound(track.ends, start);
    if (track.lines && track.beforeEnd === beforeEnd && track.beforeStart === beforeStart) return track.lines;
    track.beforeEnd = beforeEnd; track.beforeStart = beforeStart;
    const lines = [...new Set(track.index.query(start, end).map(entry => entry.item.lineIndex))].sort((a, b) => a - b);
    if (!track.lines || lines.length !== track.lines.length || lines.some((value, i) => value !== track.lines[i])) track.lines = lines;
    return track.lines;
  }
}
