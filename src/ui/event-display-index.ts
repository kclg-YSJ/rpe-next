import { beatValue } from '../core/beat.ts';
import { eventChains } from '../core/editor-display.ts';
import { IntervalIndex } from '../core/interval-index.ts';
import type { EventChain } from '../core/editor-display.ts';
import type { Chart, ChartEvent } from '../core/types.ts';

/** The merged display data one event list yields. */
export interface EventDisplay {
  length: number;
  groups: EventChain[];
  ranges: Map<number, EventChain>;
  unmergeable: Set<EventChain>;
  index: IntervalIndex<ChartEvent>;
}

/** The owner field the index caches against; the panels store it on themselves. */
export interface EventDisplayOwner {
  eventDisplayChart?: Chart;
}

/**
 * Per-owner display caches.
 *
 * Keeping the event-list cache out of the owner avoids requiring every panel to declare a
 * `WeakMap` field just so this helper can memoise against its chart.
 */
const caches = new WeakMap<EventDisplayOwner, WeakMap<ChartEvent[], EventDisplay>>();

// Chart edits replace event lists. Keep geometry-independent work until that chart changes.
export function eventDisplayIndex(owner: EventDisplayOwner, events: ChartEvent[], chart: Chart): EventDisplay {
  if (owner.eventDisplayChart !== chart) {
    owner.eventDisplayChart = chart;
    caches.set(owner, new WeakMap());
  }
  let cache = caches.get(owner); if (!cache) { cache = new WeakMap(); caches.set(owner, cache); }
  let display = cache.get(events);
  if (!display || display.length !== events.length) {
    const groups = eventChains(events); const ranges = new Map<number, EventChain>(); const unmergeable = new Set<EventChain>();
    for (const group of groups) for (const { event, index } of group.entries) {
      ranges.set(index, group);
      if (Number(event.linkgroup ?? 0) > 0 || event.inst === true || Number(event.inst) === 1) unmergeable.add(group);
    }
    display = { length: events.length, groups, ranges, unmergeable,
      index: new IntervalIndex(events, event => beatValue(event.startTime), event => beatValue(event.endTime)) };
    cache.set(events, display);
  }
  return display;
}

export function selectedEventGroups(selection: Iterable<string>, type: string, ranges: Map<number, EventChain>): Set<EventChain> {
  const groups = new Set<EventChain>(); const prefix = type + ':';
  for (const key of selection) if (key.startsWith(prefix)) {
    const group = ranges.get(Number(key.slice(prefix.length)));
    if (group) groups.add(group);
  }
  return groups;
}
