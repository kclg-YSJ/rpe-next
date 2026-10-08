import { beatValue, upperBound } from './beat.ts';
import type { Beat, BpmEntry } from './types.ts';

/** A tempo entry resolved to absolute beats, with its precomputed wall-clock position. */
interface TempoPoint {
  beat: number;
  secondsPerBeat: number;
  seconds: number;
}

/**
 * Converts between beats and seconds under a piecewise-constant tempo, per line BPM factor.
 *
 * Tempo changes only ever apply from their own beat onward, so the map sorts its entries once and
 * then integrates them into cumulative `seconds`, which makes every later lookup a binary search
 * plus one linear step rather than a walk over the whole list.
 */
export class TempoMap {
  points: TempoPoint[];

  constructor(entries: BpmEntry[]) {
    if (!Array.isArray(entries) || !entries.length) throw new Error('BPMList: 至少需要一个 BPM');
    this.points = entries.map((entry, index) => {
      if (!Number.isFinite(entry.bpm) || entry.bpm <= 0) throw new Error(`BPMList[${index}].bpm: 必须大于零`);
      return { beat: beatValue(entry.startTime, `BPMList[${index}].startTime`), secondsPerBeat: 60 / entry.bpm, seconds: 0 };
    }).sort((left, right) => left.beat - right.beat);
    let previousBeat = 0;
    let previousSeconds = 0;
    let previousRate = this.points[0].secondsPerBeat;
    for (let index = 0; index < this.points.length; index++) {
      const point = this.points[index];
      point.seconds = previousSeconds + (point.beat - previousBeat) * previousRate;
      previousBeat = point.beat;
      previousSeconds = point.seconds;
      previousRate = point.secondsPerBeat;
    }
  }

  seconds(beat: number | Beat, factor = 1): number {
    this.checkFactor(factor);
    const value = Array.isArray(beat) ? beatValue(beat) : beat;
    if (!Number.isFinite(value)) throw new Error('时间必须为有限数字');
    const point = this.points[Math.max(0, upperBound(this.points, value, entry => entry.beat) - 1)];
    return (point.seconds + (value - point.beat) * point.secondsPerBeat) * factor;
  }

  beat(seconds: number, factor = 1): number {
    this.checkFactor(factor);
    if (!Number.isFinite(seconds)) throw new Error('时间必须为有限数字');
    const value = seconds / factor;
    const point = this.points[Math.max(0, upperBound(this.points, value, entry => entry.seconds) - 1)];
    return point.beat + (value - point.seconds) / point.secondsPerBeat;
  }

  checkFactor(factor: number): void {
    if (!Number.isFinite(factor) || factor <= 0) throw new Error('bpmfactor 必须大于零');
  }
}
