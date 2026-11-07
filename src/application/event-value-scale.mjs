import { editCapturedSelection } from './batch-edit.mjs';
import { canScaleEventValue, eventScaleKey } from '../core/event-value-scale.mjs';
import { t } from '../i18n.mjs';

export function scaleEventValues(snapshot, columns, rate) {
  if (!Number.isFinite(rate)) throw Error(t('event-scale.invalid'));
  if (rate === 1) {
    const multiEventSelection = new Map();
    for (const entry of snapshot.events) {
      if (!multiEventSelection.has(entry.lineIndex)) multiEventSelection.set(entry.lineIndex, new Set());
      multiEventSelection.get(entry.lineIndex).add(`${entry.type}:${entry.index}`);
    }
    return { chart: snapshot.chart, lineIndex: snapshot.lineIndex, eventLayer: snapshot.eventLayer, focus: snapshot.focus, changes: [],
      selection: new Set(), eventSelection: new Set(multiEventSelection.get(snapshot.lineIndex) ?? []), multiLineSelection: new Map(), multiEventSelection, valueScaleChanged: false };
  }
  let changed = false;
  const result = editCapturedSelection({ ...snapshot, notes: [] }, { event: (event, type, entry) => {
    const column = columns.get(eventScaleKey(entry.lineIndex, type));
    if (!column || !canScaleEventValue(entry)) return event;
    const value = number => {
      const next = column.axis + (number - column.axis) * rate;
      if (!Number.isFinite(next)) throw Error(t('event-scale.invalid'));
      return type === 'alphaEvents' ? Math.trunc(Math.min(255, next)) : next;
    };
    const start = value(event.start), end = value(event.end);
    if (start === event.start && end === event.end) return event;
    changed = true; return { ...event, start, end };
  } });
  return { ...result, valueScaleChanged: changed };
}
