import { rebaseCustomEventValues } from '../core/event-easing.mjs';
import { chartWithEventLists, eventKey, eventListAt } from './event-commands.mjs';

// Source line + track + index identify an object. Destination line is separate:
// build all removals/replacements from the original lists before appending moves.
export function assembleSelectionEdits(snapshot, changes, { lineIndex = snapshot.lineIndex, removeSource = false } = {}) {
  changes = changes.map(change => change.kind === 'events' && change.before && change.after ? { ...change, after: rebaseCustomEventValues(change.before, change.after) } : change);
  const tracks = new Map();
  const keyFor = (kind, line, type) => `${kind}:${line}:${type ?? ''}`;
  const trackFor = (kind, line, type) => {
    const key = keyFor(kind, line, type);
    if (!tracks.has(key)) tracks.set(key, { kind, line, type, selected: new Set(), updates: new Map(), append: [],
      original: kind === 'notes' ? snapshot.chart.judgeLineList[line]?.notes ?? [] : eventListAt(snapshot, line, type, snapshot.eventLayer) });
    return tracks.get(key);
  };
  for (const entry of snapshot.notes) trackFor('notes', entry.lineIndex ?? snapshot.lineIndex).selected.add(entry.index);
  for (const entry of snapshot.events) trackFor('events', entry.lineIndex ?? snapshot.lineIndex, entry.type).selected.add(entry.index);
  for (const change of changes) {
    const sourceLine = change.sourceLineIndex ?? snapshot.lineIndex;
    const source = trackFor(change.kind, sourceLine, change.type);
    const target = trackFor(change.kind, change.lineIndex, change.type);
    if (!change.copy) source.updates.set(change.index, change);
    if (change.copy || source !== target) target.append.push(change);
  }
  const multiLineSelection = new Map(), multiEventSelection = new Map();
  const noteLists = new Map(), eventLists = new Map();
  for (const track of tracks.values()) {
    const { kind, line, type } = track;
    const items = [], selected = new Set();
    track.original.forEach((item, index) => {
      const change = track.updates.get(index);
      if (removeSource && kind === 'events' && track.selected.has(index) || change && change.lineIndex !== line) return;
      if (track.selected.has(index)) selected.add(kind === 'notes' ? items.length : eventKey(type, items.length));
      items.push(change?.after ?? item);
    });
    for (const change of track.append) {
      selected.add(kind === 'notes' ? items.length : eventKey(type, items.length));
      items.push(change.after);
    }
    const selections = kind === 'notes' ? multiLineSelection : multiEventSelection;
    if (selected.size) {
      if (!selections.has(line)) selections.set(line, new Set());
      for (const index of selected) selections.get(line).add(index);
    }
    if (!track.updates.size && !track.append.length && !(removeSource && kind === 'events' && track.selected.size)) continue;
    if (kind === 'notes') noteLists.set(line, items);
    else {
      if (!eventLists.has(line)) eventLists.set(line, new Map());
      eventLists.get(line).set(type, items);
    }
  }
  let chart = snapshot.chart;
  if (noteLists.size) chart = { ...chart, judgeLineList: chart.judgeLineList.map((line, index) => noteLists.has(index)
    ? { ...line, notes: noteLists.get(index), numOfNotes: noteLists.get(index).length } : line) };
  for (const [line, lists] of eventLists) chart = chartWithEventLists(chart, line, snapshot.eventLayer, lists);
  return { chart, lineIndex, eventLayer: snapshot.eventLayer, focus: snapshot.focus, changes,
    selection: new Set(multiLineSelection.get(lineIndex) ?? []), eventSelection: new Set(multiEventSelection.get(lineIndex) ?? []),
    multiLineSelection, multiEventSelection };
}
