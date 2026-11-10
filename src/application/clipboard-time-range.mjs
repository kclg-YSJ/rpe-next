const cache = new WeakMap();

// Clipboard arrays are replaced on copy, history selection and clear. Only
// those changes or a different chart clock need to scan the clipboard again.
export function clipboardTimeRange(session, tempo) {
  const notes = session.clipboard, events = session.eventClipboard, lines = session.chart.judgeLineList;
  const previous = cache.get(session), noteLines = session.clipboardNoteLines, eventLines = session.eventClipboardLines;
  if (previous && previous.notes === notes && previous.events === events && previous.noteLines === noteLines && previous.eventLines === eventLines && previous.lines === lines && previous.tempo === tempo && previous.lineIndex === session.lineIndex && previous.bounds === session.clipboardBounds) return previous.range;
  let start = Infinity, end = -Infinity;
  const include = (item, line, hold) => {
    const factor = lines[line]?.bpmfactor ?? 1;
    const first = tempo.seconds(item.startTime, factor), last = tempo.seconds(hold ? item.endTime : item.startTime, factor);
    start = Math.min(start, first, last); end = Math.max(end, first, last);
  };
  if (session.clipboardBounds && notes.some(note => note._rpenLargeClipboard)) {
    ({ start, end } = session.clipboardBounds);
  } else {
    for (const [index, note] of notes.entries()) include(note, noteLines?.[index] ?? session.lineIndex, note.type === 2);
    for (const [index, { event }] of events.entries()) include(event, eventLines?.[index] ?? session.lineIndex, true);
  }
  const range = Number.isFinite(start) && Number.isFinite(end) ? { start, end } : null;
  cache.set(session, { notes, events, noteLines, eventLines, lines, tempo, lineIndex: session.lineIndex, bounds: session.clipboardBounds, range });
  return range;
}
