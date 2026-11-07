// UI-only, bounded by recent event versions. Never stored in charts or sampled
// by playback/rendering; callers update it only during event edit transactions.
export const EVENT_VALUE_MEMORY_LIMIT = 32;
const memories = new WeakMap();
const sameValue = (a, b) => Object.is(a, b) || Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));

export const hasEventValueMemory = (owner, event) => event ? memories.get(owner)?.has(event) === true : memories.has(owner);

export function rememberEventValueChange(owner, before, after, field, location = {}) {
  if (!before || !after || before === after) return;
  let memory = memories.get(owner);
  const previous = memory?.get(before);
  const startChanged = !sameValue(before.start, after.start), endChanged = !sameValue(before.end, after.end);
  const explicit = field === 'start' || field === 'end';
  let edited = previous?.field;
  if (explicit && (field === 'start' ? startChanged : endChanged)) edited = field;
  else if (!explicit && startChanged !== endChanged) edited = startChanged ? 'start' : 'end';
  if (!edited) return;
  if (!memory) { memory = new Map(); memories.set(owner, memory); }
  memory.delete(after);
  memory.set(after, { field: edited, type: location.type ?? previous?.type, index: location.index ?? previous?.index });
  if (memory.size > EVENT_VALUE_MEMORY_LIMIT) memory.delete(memory.keys().next().value);
}

// Cloning a column/noise area already preserves its indices. Transfer only the
// bounded remembered versions, checking source identity so inserts/deletes
// cannot accidentally attach a preference to the next event in the array.
export function copyEventValueMemory(owner, source, target) {
  const memory = memories.get(owner);
  if (!memory) return;
  for (const [event, location] of [...memory]) {
    if (source(location) !== event) continue;
    const next = target(location);
    if (next) rememberEventValueChange(owner, event, next, undefined, location);
  }
}

export function withEventLock(owner, event, locked) {
  if (!locked) return { ...event, inst: 0 };
  const field = memories.get(owner)?.get(event)?.field ?? 'start';
  const value = event[field];
  return { ...event, inst: 1, start: structuredClone(value), end: structuredClone(value) };
}
