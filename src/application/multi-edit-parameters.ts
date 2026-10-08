// The multi-edit panel's parameter document: the current draft per kind, the applied history and
// the named favourites. Everything here is persisted to `localStorage` and read back from it, so
// the shapes stay loose and `parameters` below re-validates every field before it is copied.

const storageKey = 'rpe-next-multi-edit-v1';
const kinds = ['notes', 'events'] as const;

export type BatchKind = typeof kinds[number];

/**
 * One per-channel offset set (X / Y / rotation / alpha).
 *
 * The panel reads and writes these keys dynamically (`channels[type][name]`), so an index
 * signature is the honest shape; every leaf that survives `parameters` is a string or a number.
 */
export interface BatchChannelParameters {
  lower?: string | number;
  upper?: string | number;
  easingType?: string | number;
  cycle?: string | number;
  disturbance?: string | number;
  [name: string]: string | number | undefined;
}

/**
 * A sanitized multi-edit parameter set.
 *
 * The numeric-looking fields are `string | number`: the form controls hand over strings, while
 * stored JSON (and the panel's own `read()`) can hold numbers, and `parameters` copies both.
 * `eventApplicationMode` and `division` are written by the panel but not present in the defaults,
 * so `parameters` drops them again — they stay optional here.
 *
 * The index signature mirrors how the object is built (one entry per key of the defaults), which
 * is what lets `parameters` copy scalar fields by key. The named members above still take
 * precedence for property access.
 */
export interface BatchParameters {
  mode: string; field: string; operation: string;
  lower: string | number; upper: string | number; easingType: string | number;
  cycle: string | number; disturbance: string | number;
  noteType: string | number; eventType: string; condition: string;
  seed: number; targets: string; increment: string | number;
  retainSource: boolean; channels: Record<string, BatchChannelParameters>; script: string;
  eventApplicationMode?: string; division?: number;
  [key: string]: string | number | boolean | undefined | Record<string, BatchChannelParameters>;
}

/** A named favourite, as it is listed and stored. */
export interface SavedBatchParameters {
  name: string;
  value: BatchParameters;
}

/** The storage surface this module needs, so tests can pass a stub. */
export interface BatchParameterStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The parsed document. Only its object-ness is checked up front; each field is validated on use. */
interface StoredMultiEditParameters {
  drafts?: Record<string, unknown>;
  history?: Record<string, unknown>;
  saved?: Record<string, unknown>;
}

/** A stored favourite whose `name` has been checked to be a string. */
interface StoredSavedEntry {
  name: string;
  value: unknown;
}

export function defaultBatchParameters(kind: BatchKind): BatchParameters {
  return { mode: 'form', field: kind === 'notes' ? 'x' : 'both', operation: 'By', lower: '0', upper: '0', easingType: 1,
    cycle: '1', disturbance: '0', noteType: 0, eventType: 'all', condition: '', seed: 1, targets: '0', increment: '0', retainSource: true, channels: {},
    script: kind === 'notes' ? 'x = lerp(-500, 500, u);\nsize = 1 + 0.25 * sin(u * pi);' : 'start += 20 * sin(u * pi);\nend += 20 * sin(u * pi);' };
}

/** Coerces stored or form input into a full parameter set, keeping the defaults for whatever is missing. */
function parameters(kind: BatchKind, value: unknown): BatchParameters {
  const defaults = defaultBatchParameters(kind); const result: BatchParameters = { ...defaults };
  if (!value || typeof value !== 'object') return result;
  const source = value as Record<string, unknown>;
  for (const key of Object.keys(defaults)) {
    if (key === 'retainSource') result.retainSource = source.retainSource !== false;
    else if (key === 'channels') {
      result.channels = {};
      // Indexed dynamically below; any non-object source answers `undefined` for every channel
      // name, which is exactly what the original `value.channels?.[type]` probe did.
      const channels = source.channels as Record<string, Record<string, unknown>> | undefined;
      for (const type of ['moveXEvents', 'moveYEvents', 'rotateEvents', 'alphaEvents']) if (channels?.[type]) {
        const channel = channels[type]; result.channels[type] = {};
        for (const name of ['lower', 'upper', 'easingType', 'cycle', 'disturbance']) if (['string', 'number'].includes(typeof channel[name])) result.channels[type][name] = channel[name] as string | number;
      }
    } else if (['string', 'number'].includes(typeof source[key])) result[key] = source[key] as string | number;
  }
  return result;
}

export class MultiEditParameters {
  storage: BatchParameterStorage;
  onError: (message: string) => void;
  drafts: Record<BatchKind, BatchParameters>;
  history: Record<BatchKind, BatchParameters[]>;
  saved: Record<BatchKind, SavedBatchParameters[]>;

  constructor(storage: BatchParameterStorage = globalThis.localStorage, onError: (message: string) => void = () => {}) {
    // The loop below writes both kinds into every record, so the empty literals only stand in for
    // the entries that are filled immediately afterwards.
    this.storage = storage; this.onError = onError; this.drafts = {} as Record<BatchKind, BatchParameters>; this.history = {} as Record<BatchKind, BatchParameters[]>; this.saved = {} as Record<BatchKind, SavedBatchParameters[]>;
    let stored: unknown;
    try { stored = JSON.parse(storage?.getItem(storageKey) ?? '{}'); } catch { stored = {}; }
    if (!stored || typeof stored !== 'object') stored = {};
    const document = stored as StoredMultiEditParameters;
    for (const kind of kinds) {
      this.drafts[kind] = parameters(kind, document.drafts?.[kind]);
      const storedHistory: unknown = document.history?.[kind];
      const history: unknown[] = Array.isArray(storedHistory) ? storedHistory : [];
      this.history[kind] = history.slice(-50).map(value => parameters(kind, value));
      const storedSaved: unknown = document.saved?.[kind];
      const saved: unknown[] = Array.isArray(storedSaved) ? storedSaved : [];
      this.saved[kind] = saved.filter((entry): entry is StoredSavedEntry => typeof (entry as StoredSavedEntry | undefined)?.name === 'string').map(entry => ({ name: entry.name.slice(0, 80), value: parameters(kind, entry.value) }));
    }
  }

  persist(): void {
    try { this.storage?.setItem(storageKey, JSON.stringify({ drafts: this.drafts, history: this.history, saved: this.saved })); }
    catch { this.onError('批量参数无法写入本机存储，请检查可用空间；当前参数仍保留在本次会话。'); }
  }
  read(kind: BatchKind): BatchParameters { return structuredClone(this.drafts[kind]); }
  update(kind: BatchKind, value: unknown): void { this.drafts[kind] = parameters(kind, value); this.persist(); }
  reset(kind: BatchKind): void { this.update(kind, defaultBatchParameters(kind)); }
  remember(kind: BatchKind, value: unknown): number {
    const next = parameters(kind, value); const signature = JSON.stringify(next);
    this.history[kind] = this.history[kind].filter(entry => JSON.stringify(entry) !== signature);
    this.history[kind].push(next); this.history[kind] = this.history[kind].slice(-50); this.persist();
    return this.history[kind].length - 1;
  }
  save(kind: BatchKind, name: string, value: unknown): SavedBatchParameters {
    name = name.trim().slice(0, 80); if (!name) throw new Error('请填写参数名称');
    const entry = { name, value: parameters(kind, value) }; const index = this.saved[kind].findIndex(candidate => candidate.name === name);
    if (index < 0) this.saved[kind].push(entry); else this.saved[kind][index] = entry;
    this.persist(); return entry;
  }
  remove(kind: BatchKind, name: string): void { this.saved[kind] = this.saved[kind].filter(entry => entry.name !== name); this.persist(); }
}
