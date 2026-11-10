import { beatValue } from './beat.mjs';
import { IntervalIndex } from './interval-index.mjs';
import { EVENT_TYPES } from './chart.mjs';
import { SPECIAL_TRACKS } from './editor-display.mjs';
import { shaderEvents } from './shader-events.mjs';
import { densityWindow } from './timeline-strip-settings.mjs';

const trackIndex = events => new IntervalIndex(events, event => beatValue(event.startTime), event => beatValue(event.endTime));

class LineActivity {
  constructor(line, tempo) {
    const factor = line.bpmfactor ?? 1;
    this.duration = 0;
    const times = events => events.map(event => {
      const start = tempo.seconds(event.startTime, factor);
      this.duration = Math.max(this.duration, start, tempo.seconds(event.endTime, factor));
      return start;
    });
    const track = (layer, types) => {
      const events = types.flatMap(type => layer?.[type] ?? []);
      return { times: times(events), index: trackIndex(events) };
    };
    this.notes = times(line.notes ?? []);
    this.layers = (line.eventLayers ?? []).map(layer => track(layer, EVENT_TYPES));
    this.special = track(line.extended, SPECIAL_TRACKS.map(track => track.key).filter(type => type !== 'paintEvents'));
  }
}

export class TimelineActivity {
  constructor() { this.cache = new WeakMap(); }

  compile(chart, tempo) {
    if (this.chart === chart && this.tempo === tempo) return;
    if (this.tempo !== tempo) this.cache = new WeakMap();
    this.chart = chart; this.tempo = tempo; this.densityCache = null; this.duration = 1;
    for (const area of chart.blockAreaList ?? []) this.duration = Math.max(this.duration, tempo.seconds(area.disappearTime));
    this.lines = chart.judgeLineList.map((line, index) => {
      if (!this.cache.has(line)) this.cache.set(line, new LineActivity(line, tempo));
      const activity = this.cache.get(line);
      const effects = shaderEvents(chart, index);
      const shaderTimes = effects.map(event => {
        const start = tempo.seconds(event.startTime, line.bpmfactor ?? 1);
        this.duration = Math.max(this.duration, start, tempo.seconds(event.endTime, line.bpmfactor ?? 1));
        return start;
      });
      this.duration = Math.max(this.duration, activity.duration);
      return { activity, shaderTimes, shaderIndex: trackIndex(effects) };
    });
  }

  density(lineIndex, layer, extended, duration, height, windowSeconds = 1) {
    windowSeconds = densityWindow(windowSeconds);
    const bins = Math.max(96, Math.min(900, Math.max(Math.round(height), Math.ceil(duration * 8))));
    const indices = Array.isArray(lineIndex) ? lineIndex : [lineIndex];
    const key = `${indices.join(',')}:${layer}:${extended}:${duration}:${bins}:${windowSeconds}`;
    if (this.densityCache?.key === key) return this.densityCache;
    // Difference arrays reproduce Classic's centred one-second window in
    // O(objects + bins), independent of chart duration and without sorting.
    const noteDelta = new Float64Array(bins + 1), eventDelta = new Float64Array(bins + 1), unit = duration / bins, radius = windowSeconds / 2;
    const add = (target, times) => { for (const seconds of times ?? []) {
      if (!Number.isFinite(seconds) || seconds + radius < 0 || seconds - radius > duration) continue;
      const first = Math.max(0, Math.ceil((seconds - radius) / unit - .5));
      const last = Math.min(bins - 1, Math.floor((seconds + radius) / unit - .5));
      if (first <= last) { target[first]++; target[last + 1]--; }
    } };
    for (const index of indices) {
      const line = this.lines[index];
      add(noteDelta, line?.activity.notes);
      add(eventDelta, extended ? line?.activity.special.times : line?.activity.layers[layer]?.times);
      if (extended) add(eventDelta, line?.shaderTimes);
    }
    const noteBins = new Float64Array(bins), eventBins = new Float64Array(bins);
    let notes = 0, events = 0, noteMaximum = 1, eventMaximum = 1;
    for (let i = 0; i < bins; i++) {
      noteBins[i] = notes += noteDelta[i]; eventBins[i] = events += eventDelta[i];
      noteMaximum = Math.max(noteMaximum, notes); eventMaximum = Math.max(eventMaximum, events);
    }
    this.densityCache = { key, bins, noteBins, eventBins, noteMaximum, eventMaximum, maximum: Math.max(noteMaximum, eventMaximum), windowSeconds };
    return this.densityCache;
  }

  layerState(lineIndex, layer, extended, start, end, shaderStart, shaderEnd) {
    const line = this.lines[lineIndex];
    const index = extended ? line?.activity.special.index : line?.activity.layers[layer]?.index;
    const shaders = extended ? line?.shaderIndex : null;
    if (!index?.entries.length && !shaders?.entries.length) return 'empty';
    return index?.has(start, end) || shaders?.has(shaderStart, shaderEnd) ? 'visible' : 'outside';
  }
}
