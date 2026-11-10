import { TempoMap } from '../core/tempo.mjs';
import { eventListAt } from './event-commands.mjs';

const clocks = new WeakMap();

// Inspect only selected indices in changed lists, once per committed edit.
// Deleted objects use the old selection; time moves cover both old and new.
export function recentEditRange(session, before, beforeSelection, afterSelection, label) {
  const chart = session.chart;
  let clock = clocks.get(session);
  if (clock?.entries !== chart.BPMList) {
    clock = { entries: chart.BPMList, tempo: before.BPMList === chart.BPMList && session.tempo || new TempoMap(chart.BPMList) };
    clocks.set(session, clock);
  }
  const ranges = new Map();
  const include = (item, lineIndex, hold) => {
    if (!item) return;
    try {
      const factor = chart.judgeLineList[lineIndex]?.bpmfactor ?? before.judgeLineList[lineIndex]?.bpmfactor ?? 1;
      const a = clock.tempo.seconds(item.startTime, factor), b = clock.tempo.seconds(hold ? item.endTime : item.startTime, factor);
      const range = ranges.get(lineIndex) ?? { lineIndex, start: Infinity, end: -Infinity };
      range.start = Math.min(range.start, a, b); range.end = Math.max(range.end, a, b); ranges.set(lineIndex, range);
    } catch { /* Invalid legacy time fields remain editable and diagnosable. */ }
  };
  const visit = (source, other, state) => {
    const multi = state.multiLineEnabled && state.multiLineIndices?.length;
    const notes = multi && state.multiLineMode === 'notes' ? state.multiLineSelection : [[state.lineIndex, state.selection]];
    for (const [lineIndex, indices] of notes ?? []) {
      const list = source.judgeLineList[lineIndex]?.notes;
      if (list === other.judgeLineList[lineIndex]?.notes) continue;
      for (const index of indices) include(list?.[index], lineIndex, list?.[index]?.type === 2);
    }
    const events = multi && state.multiLineMode === 'events' ? state.multiEventSelection : [[state.lineIndex, state.eventSelection]];
    const lists = new Map();
    for (const [lineIndex, keys] of events ?? []) for (const key of keys) {
      const [type, rawIndex] = key.split(':'), index = Number(rawIndex);
      const id = `${lineIndex}:${type}`;
      if (!lists.has(id)) { const list = eventListAt({ chart: source, eventLayer: state.eventLayer }, lineIndex, type); lists.set(id, list === eventListAt({ chart: other, eventLayer: state.eventLayer }, lineIndex, type) ? null : list); }
      const list = lists.get(id); if (!list) continue;
      include(list[index], lineIndex, true);
    }
  };
  visit(before, chart, beforeSelection); visit(chart, before, afterSelection);
  if (!ranges.size) {
    const time = Number.isFinite(session.editSeconds) ? session.editSeconds : 0;
    return { start: time, end: time, label, lineIndex: session.lineIndex, point: true };
  }
  const values = [...ranges.values()];
  return { label, start: Math.min(...values.map(range => range.start)), end: Math.max(...values.map(range => range.end)), ranges: values, point: false };
}
