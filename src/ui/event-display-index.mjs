import { beatValue } from '../core/beat.ts';
import { eventChains } from '../core/editor-display.ts';
import { IntervalIndex } from '../core/interval-index.ts';

// Chart edits replace event lists. Keep geometry-independent work until that chart changes.
export function eventDisplayIndex(owner, events, chart) {
  if (owner.eventDisplayChart !== chart) {
    owner.eventDisplayChart = chart;
    owner.eventDisplayCache = new WeakMap();
  }
  owner.eventDisplayCache ??= new WeakMap();
  let display = owner.eventDisplayCache.get(events);
  if (!display || display.length !== events.length) {
    const groups = eventChains(events); const ranges = new Map(); const unmergeable = new Set();
    for (const group of groups) for (const { event, index } of group.entries) {
      ranges.set(index, group);
      if (Number(event.linkgroup ?? 0) > 0 || event.inst === true || Number(event.inst) === 1) unmergeable.add(group);
    }
    display = { length: events.length, groups, ranges, unmergeable,
      index: new IntervalIndex(events, event => beatValue(event.startTime), event => beatValue(event.endTime)) };
    owner.eventDisplayCache.set(events, display);
  }
  return display;
}

export function selectedEventGroups(selection, type, ranges) {
  const groups = new Set(); const prefix = type + ':';
  for (const key of selection) if (key.startsWith(prefix)) {
    const group = ranges.get(Number(key.slice(prefix.length)));
    if (group) groups.add(group);
  }
  return groups;
}
