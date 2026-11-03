import { assertEventEasing } from './event-easing.mjs';
export const ANIMATION_CURVE_VERSION = 250;

// Walk event tracks only. Notes and media are never visited.
export function* chartCurveEvents(chart) {
  const shader = function* (effects) { for (const effect of Array.isArray(effects) ? effects : []) for (const value of Object.values(effect?.vars ?? {})) if (Array.isArray(value) && value[0]?.startTime) yield* value; };
  for (const line of chart.judgeLineList ?? []) for (const layer of [...(line.eventLayers ?? []), line.extended]) for (const [type, events] of Object.entries(layer ?? {})) {
    if (!Array.isArray(events)) continue;
    if (type === 'paintEvents') yield* shader(events); else yield* events.filter(e => e?.startTime);
  }
  for (const area of chart.blockAreaList ?? []) for (const events of Object.values(area)) if (Array.isArray(events) && events[0]?.startTime) yield* events;
  for (const type of Object.values(chart.globalEvents?.types ?? {})) for (const column of Object.values(type.columns ?? {})) yield* column.events ?? [];
  yield* shader(chart.effects); yield* shader(chart.shaderEvents); yield* shader(chart.META?.effects);
}
export function chartHasAnimationCurves(chart) { for (const e of chartCurveEvents(chart)) if (e.customEasing) return true; return false; }
export function internChartAnimationCurves(chart) {
  const curves = new Map();
  for (const event of chartCurveEvents(chart)) if (event.customEasing) { assertEventEasing(event); const key = JSON.stringify(event.customEasing.curve); if (!curves.has(key)) curves.set(key, event.customEasing.curve); else event.customEasing.curve = curves.get(key); }
  return chart;
}
