import { beatValue, upperBound } from './beat.mjs';
import { IntervalIndex } from './interval-index.mjs';

export class NoteDisplayIndex extends IntervalIndex {
  constructor(notes) {
    super(notes, note => Math.min(beatValue(note.startTime), beatValue(note.endTime)), note => Math.max(beatValue(note.startTime), beatValue(note.endTime)));
    for (const entry of this.entries) { entry.beat = beatValue(entry.item.startTime); entry.endBeat = beatValue(entry.item.endTime); }
    this.maxSize = notes.reduce((maximum, note) => Math.max(maximum, Math.abs(note.size ?? 1)), 0);
    this.ends = Float64Array.from(this.entries, entry => entry.end).sort();
  }

  inSourceOrder(start, end) {
    const beforeEnd = upperBound(this.entries, end, entry => entry.start);
    let low = 0, high = this.ends.length;
    while (low < high) { const middle = (low + high) >>> 1; if (this.ends[middle] < start) low = middle + 1; else high = middle; }
    if (this.visible && beforeEnd === this.beforeEnd && low === this.beforeStart) return this.visible;
    this.beforeEnd = beforeEnd; this.beforeStart = low;
    // The source order is also the painter's order, including stacked Holds.
    this.visible = this.query(start, end).sort((left, right) => left.index - right.index);
    return this.visible;
  }

  timeMapping(tempo, factor) {
    if (this.tempo === tempo && this.factor === factor) return;
    this.tempo = tempo; this.factor = factor;
    for (const entry of this.entries) { entry.seconds = tempo.seconds(entry.beat, factor); entry.endSeconds = tempo.seconds(entry.endBeat, factor); }
  }
}
