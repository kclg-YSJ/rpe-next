import { IntervalIndex } from './interval-index.mjs';
import { recentHits } from './hit-effects.mjs';

// Only selected notes receive temporary entries and indexes. Event tracks and
// the full chart's spatial/hit indexes stay shared with the committed scene.
export class NotePreview {
  constructor() { this.runtimes = new Map(); this.timeDeltas = new Map(); this.completions = []; }

  update(scene, overrides) {
    if (this.chart === scene.chart && this.tempo === scene.tempo && this.overrides === overrides) return;
    this.chart = scene.chart; this.tempo = scene.tempo; this.overrides = overrides;
    this.runtimes.clear(); this.timeDeltas.clear(); this.completions = [];
    if (!overrides?.size) return;
    for (const [lineIndex, notes] of overrides) {
      const base = scene.lines[lineIndex]; if (!base) continue;
      const replaced = new Set(), draft = Object.create(base); draft.notes = [];
      for (const [index, note] of notes) {
        const source = base.notes[index]; if (!source) continue;
        const entry = { ...base.noteEntry(note, index, scene.tempo), sourceNote: source.note, sourceStart: source.start };
        replaced.add(index); draft.notes.push(entry);
        for (const [time, delta] of [[source.start, -1], [entry.start, 1]]) {
          const key = Math.round(time * 1000000); this.timeDeltas.set(key, (this.timeDeltas.get(key) ?? 0) + delta);
        }
        if (!source.note.isFake) this.completions.push([source.note.type === 2 ? source.end : source.start, -1]);
        if (!note.isFake) this.completions.push([note.type === 2 ? entry.end : entry.start, 1]);
      }
      draft.minSpeed = draft.notes.reduce((minimum, entry) => Math.min(minimum, Math.abs(entry.note.speed ?? 1) || 1), base.minSpeed);
      draft.hitTimes = [...draft.notes].sort((left, right) => left.start - right.start);
      draft.holdIndex = new IntervalIndex(draft.notes.filter(entry => entry.note.type === 2), entry => entry.start, entry => entry.end);
      draft.staticNotes = draft.notes.filter(entry => (entry.note.speed ?? 1) === 0);
      draft.staticIndex = new IntervalIndex(draft.staticNotes, entry => entry.start - (entry.note.visibleTime ?? 999999), entry => entry.end);
      draft.index = new IntervalIndex(draft.notes.filter(entry => (entry.note.speed ?? 1) !== 0), entry => Math.min(entry.floor, entry.tail), entry => Math.max(entry.floor, entry.tail));
      const runtime = Object.create(base);
      runtime.visibleNotes = (...args) => base.visibleNotes(...args).filter(entry => !replaced.has(entry.index)).concat(draft.visibleNotes(...args));
      runtime.previewHits = (...args) => recentHits(base, ...args).filter(hit => !replaced.has(hit.entry.index)).concat(recentHits(draft, ...args));
      this.runtimes.set(lineIndex, runtime);
    }
    for (const [key, delta] of this.timeDeltas) if (!delta) this.timeDeltas.delete(key);
  }

  runtime(scene, index) { return this.runtimes.get(index) ?? scene.lines[index]; }
  simultaneous(entry, original, counts) {
    if (!this.timeDeltas.size && (!entry.sourceNote || entry.start === entry.sourceStart)) return original.has(entry.sourceNote ?? entry.note);
    const key = Math.round(entry.start * 1000000);
    return (counts.get(key) ?? 0) + (this.timeDeltas.get(key) ?? 0) > 1;
  }
  completionDelta(seconds) { return this.completions.reduce((sum, [time, delta]) => sum + (time < seconds ? delta : 0), 0); }
}
