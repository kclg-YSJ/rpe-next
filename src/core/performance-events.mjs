import { upperBound } from './beat.mjs';

const BASE_TRACKS = [
  ['moveXEvents', 'perf.event.moveX'],
  ['moveYEvents', 'perf.event.moveY'],
  ['rotateEvents', 'perf.event.rotate'],
  ['alphaEvents', 'perf.event.alpha'],
  ['speedEvents', 'perf.event.speed'],
];
const EXTENDED_TRACKS = [
  ['scaleXEvents', 'perf.event.scaleX'],
  ['scaleYEvents', 'perf.event.scaleY'],
  ['inclineEvents', 'perf.event.incline'],
  ['colorEvents', 'perf.event.color'],
  ['textEvents', 'perf.event.text'],
];

function activeEntries(track, seconds) {
  const events = track?.events;
  if (!events?.length) return [];
  const position = Math.max(0, upperBound(events, seconds, entry => entry.start) - 1);
  const active = [];
  for (let index = position; index < events.length; index++) {
    const entry = events[index];
    if (entry.start > seconds) break;
    if (entry.end > entry.start && entry.start <= seconds && entry.end >= seconds) active.push(entry);
  }
  return active;
}

// Counts only; this is intentionally not a per-event detail list.
export function collectActiveLineEventCounts(scene, seconds, lineIndices) {
  const counts = {};
  let total = 0;
  const add = key => { counts[key] = (counts[key] ?? 0) + 1; total++; };
  for (const lineIndex of lineIndices) {
    const runtime = scene?.lines?.[lineIndex];
    if (!runtime) continue;
    const layers = Math.max(runtime.tracks.moveXEvents?.length ?? 0, runtime.tracks.alphaEvents?.length ?? 0, runtime.speeds?.length ?? 0);
    for (const [type, labelKey] of BASE_TRACKS) {
      for (let layer = 0; layer < layers; layer++) {
        const track = type === 'speedEvents' ? runtime.speeds?.[layer] : runtime.tracks?.[type]?.[layer];
        for (const unused of activeEntries(track, seconds)) add(labelKey);
      }
    }
    for (const [type, labelKey] of EXTENDED_TRACKS) {
      for (const unused of activeEntries(runtime.extended?.[type], seconds)) add(labelKey);
    }
  }
  return { total, counts };
}
