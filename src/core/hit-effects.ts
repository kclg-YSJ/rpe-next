import { upperBound } from './beat.ts';
import type { IntervalIndex, IndexedInterval } from './interval-index.ts';
import type { Note } from './types.ts';

export const HOLD_HIT_INTERVAL = 20 / 120;

/**
 * A note as the scene runtime stores it: the source note plus its precomputed wall-clock span.
 *
 * Mirrors the shape `LineRuntime` builds in `scene.ts`; declared structurally here rather than
 * imported because that class is still untyped during the migration.
 */
export interface HitEntry {
  note: Note;
  start: number;
  end: number;
  floor: number;
  tail: number;
}

/**
 * The subset of `LineRuntime` this module reads.
 *
 * `hitTimes` is start-sorted, which `upperBound` relies on; `holdIndex` indexes the same entries.
 */
export interface HitRuntime {
  hitTimes: HitEntry[];
  holdIndex: IntervalIndex<HitEntry>;
}

/** One hit effect sample: the note it belongs to, its time, and the seed that makes it stable. */
export interface HitSample {
  entry: HitEntry;
  time: number;
  seed: number;
}

/**
 * Every hit effect still alive in `[max(seconds - lifetime, since), seconds]`.
 *
 * Taps and Drags come from the start-sorted `hitTimes` (their seed is the array index); Holds emit
 * one pulse per `HOLD_HIT_INTERVAL` while they are held, seeded from the entry index and pulse so
 * the particles stay deterministic as the window slides.
 */
export function recentHits(runtime: HitRuntime, seconds: number, since: number, lifetime = 2 / 3): HitSample[] {
  const first = upperBound(runtime.hitTimes, Math.max(seconds - lifetime, since), entry => entry.start);
  const last = upperBound(runtime.hitTimes, seconds, entry => entry.start);
  const hits: HitSample[] = [];
  for (let index = first; index < last; index++) {
    const entry = runtime.hitTimes[index];
    if (entry.note.type !== 2 && !entry.note.isFake) hits.push({ entry, time: entry.start, seed: index });
  }
  for (const { item: entry, index } of runtime.holdIndex.query(seconds - lifetime, seconds) as IndexedInterval<HitEntry>[]) {
    if (entry.note.isFake) continue;
    const firstPulse = Math.max(0, Math.floor((Math.max(seconds - lifetime, since) - entry.start) / HOLD_HIT_INTERVAL) + 1);
    const lastPulse = Math.min(Math.floor((seconds - entry.start) / HOLD_HIT_INTERVAL), Math.ceil((entry.end - entry.start) / HOLD_HIT_INTERVAL) - 1);
    for (let pulse = firstPulse; pulse <= lastPulse; pulse++) hits.push({ entry, time: entry.start + pulse * HOLD_HIT_INTERVAL, seed: index * 65537 + pulse });
  }
  return hits;
}
