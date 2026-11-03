import { TempoMap } from '../core/tempo.mjs';
import { curveFromEvent } from '../core/animation-curve-edit.mjs';
import { withCustomEasing, eventNumericValue } from '../core/event-easing.mjs';
import { chartWithEventLists, eventListAt } from './event-commands.mjs';
import { t } from '../i18n.mjs';

export function previewCurveEvent(event, curve) {
  if (!event.customEasing) return withCustomEasing(event, curve);
  const next = { ...event, customEasing: { ...event.customEasing, curve } };
  if (typeof event.start === 'number' || Array.isArray(event.start)) { next.start = eventNumericValue(next, 0); next.end = eventNumericValue(next, 1); }
  return next;
}

// Copy edited event tracks only; never visit notes or mutate the editing session.
export function previewSelectedCurve(session, entries, curve, transform = previewCurveEvent) {
  let chart = session.chart;
  const lines = new Map();
  for (const entry of entries) {
    const lineIndex = entry.lineIndex ?? session.lineIndex;
    if (!lines.has(lineIndex)) lines.set(lineIndex, new Map());
    const updates = lines.get(lineIndex);
    if (!updates.has(entry.type)) updates.set(entry.type, [...eventListAt(session, lineIndex, entry.type)]);
    const events = updates.get(entry.type);
    events[entry.index] = transform(events[entry.index], curve);
  }
  for (const [lineIndex, updates] of lines) chart = chartWithEventLists(chart, lineIndex, session.eventLayer, updates);
  return { chart, lineIndex: entries[0]?.lineIndex ?? session.lineIndex };
}

export function previewGlobalCurve(session, column, index, curve) {
  const chart = session.chart, data = chart.globalEvents ?? { version: 1, types: {} }, previous = data.types[column.type.id];
  const events = column.events.map((event, i) => i === index ? previewCurveEvent(event, curve) : event);
  const type = { ...previous, source: column.type.source, columns: { ...previous?.columns, [column.column.id]: { ...previous?.columns?.[column.column.id], events } } };
  return { chart: { ...chart, globalEvents: { ...data, types: { ...data.types, [column.type.id]: type } } }, lineIndex: session.lineIndex };
}

/** One clock for the graph marker and the chart preview. No audio/history writes. */
export class AnimationCurvePlayback {
  constructor({ event, timing, previewChart }) { this.event = event; this.timing = timing; this.previewChart = previewChart; this.active = false; }
  start(curve, timestamp) {
    if (!this.previewChart || !this.timing) throw Error(t('animation-curve.previewUnavailable'));
    const tempo = new TempoMap(this.timing.BPMList), factor = this.timing.factor ?? 1;
    this.startSeconds = tempo.seconds(this.event.startTime, factor); this.endSeconds = tempo.seconds(this.event.endTime, factor);
    this.domain = this.event.customEasing?.domain ?? [0, 1];
    this.period = Math.min(3, Math.max(.3, this.endSeconds - this.startSeconds)) * 1000;
    this.startedAt = timestamp; this.active = true;
    try { this.update(curve); } catch (error) { this.stop(); throw error; }
  }
  update(curve) { if (this.active) { const view = this.previewChart(curve ?? curveFromEvent(this.event)); if (!view?.chart) throw Error(t('animation-curve.previewUnavailable')); this.view = view; } }
  sample(timestamp) {
    if (!this.active) return null;
    const phase = ((timestamp - this.startedAt) % this.period + this.period) % this.period / this.period;
    return { ...this.view, seconds: this.startSeconds + (this.endSeconds - this.startSeconds) * phase, progress: this.domain[0] + (this.domain[1] - this.domain[0]) * phase };
  }
  stop() { this.active = false; this.view = null; }
}
