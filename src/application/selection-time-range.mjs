import { selectedEventEntries } from './event-commands.mjs';

// Called only when the chart/selection changes. Drawing reads cached bounds;
// a disk selection uses its complete stored summary, never just loaded notes.
export function selectionTimeRange(session, tempo) {
  let start = Infinity, end = -Infinity, count = 0;
  const groups = new Map();
  const include = (a, b, key) => {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return;
    const low = Math.min(a, b), high = Math.max(a, b), previous = groups.get(key);
    if (previous) { previous.start = Math.min(previous.start, low); previous.end = Math.max(previous.end, high); }
    else groups.set(key, { start: low, end: high });
    start = Math.min(start, low); end = Math.max(end, high); count++;
  };
  const logical = session.largeDocument?.logicalSelection;
  if (logical?.total > 0 && Number.isFinite(logical.firstSeconds) && Number.isFinite(logical.lastSeconds)) {
    include(logical.firstSeconds, logical.lastSeconds, 'disk'); count = logical.total;
  } else for (const { note, lineIndex } of session.selectedNoteEntries()) {
    const factor = session.chart.judgeLineList[lineIndex]?.bpmfactor ?? 1;
    include(tempo.seconds(note.startTime, factor), tempo.seconds(note.type === 2 ? note.endTime : note.startTime, factor), `notes:${lineIndex}`);
  }
  for (const { event, lineIndex } of selectedEventEntries(session)) {
    const factor = session.chart.judgeLineList[lineIndex]?.bpmfactor ?? 1;
    include(tempo.seconds(event.startTime, factor), tempo.seconds(event.endTime, factor), `events:${lineIndex}`);
  }
  return count ? { start, end, count, ranges: [...groups.values()] } : null;
}
