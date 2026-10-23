import { beatValue, upperBound } from './beat.mjs';
import { t } from '../i18n.mjs';

export class TempoMap {
  constructor(entries) {
    if (!Array.isArray(entries) || !entries.length) throw new Error(t('tempo.sbcd36e9'));
    this.points = entries.map((entry, index) => {
      if (!Number.isFinite(entry.bpm) || entry.bpm <= 0) throw new Error(t('tempo.sd09d4bd', { p0: index }));
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

  seconds(beat, factor = 1) {
    this.checkFactor(factor);
    const value = Array.isArray(beat) ? beatValue(beat) : beat;
    if (!Number.isFinite(value)) throw new Error(t('tempo.s4cf61d1'));
    const point = this.points[Math.max(0, upperBound(this.points, value, entry => entry.beat) - 1)];
    return (point.seconds + (value - point.beat) * point.secondsPerBeat) * factor;
  }

  beat(seconds, factor = 1) {
    this.checkFactor(factor);
    if (!Number.isFinite(seconds)) throw new Error(t('tempo.s4cf61d1'));
    const value = seconds / factor;
    const point = this.points[Math.max(0, upperBound(this.points, value, entry => entry.seconds) - 1)];
    return point.beat + (value - point.seconds) / point.secondsPerBeat;
  }

  checkFactor(factor) {
    if (!Number.isFinite(factor) || factor <= 0) throw new Error(t('tempo.sedf84ee'));
  }
}
