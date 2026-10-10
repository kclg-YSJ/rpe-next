import { beatValue } from './beat.mjs';
import { IntervalIndex } from './interval-index.mjs';
import { EVENT_TYPES } from './chart.mjs';
import { SPECIAL_TRACKS } from './editor-display.mjs';
import { shaderEvents } from './shader-events.mjs';

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

  density(lineIndex, layer, extended, duration, height) {
    const bins = Math.max(96, Math.min(900, Math.max(Math.round(height), Math.ceil(duration * 8))));
    const key = `${lineIndex}:${layer}:${extended}:${duration}:${bins}`;
    if (this.densityCache?.key === key) return this.densityCache;
    const noteBins = new Uint32Array(bins); const eventBins = new Uint32Array(bins);
    const add = (target, times) => { for (const seconds of times ?? []) target[Math.max(0, Math.min(bins - 1, Math.floor(seconds / duration * bins)))]++; };
    const line = this.lines[lineIndex];
    add(noteBins, line?.activity.notes);
    add(eventBins, extended ? line?.activity.special.times : line?.activity.layers[layer]?.times);
    if (extended) add(eventBins, line?.shaderTimes);
    this.densityCache = { key, bins, noteBins, eventBins, maximum: Math.max(1, ...noteBins, ...eventBins) };
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
