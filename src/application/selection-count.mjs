const countLines = selections => [...(selections?.values() ?? [])].reduce((total, values) => total + values.size, 0);

// Per-line selections already include the current line; do not count its alias twice.
export function selectionCounts(session) {
  return {
    notes: session.largeDocument?.selectedCount ?? (session.multiLineActive && session.multiLineMode === 'notes'
      ? countLines(session.multiLineSelection) : session.selection.size),
    events: session.multiLineActive && session.multiLineMode === 'events'
      ? Math.max(session.eventSelection.size, countLines(session.multiEventSelection)) : session.eventSelection.size,
  };
}
