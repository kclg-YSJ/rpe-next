import { localPreferences } from '../platform/local-preferences.mjs';
import { t } from '../i18n.mjs';
const storageKey = 'rpe-next-multi-edit-v1';
const kinds = ['notes', 'events'];

export function defaultBatchParameters(kind) {
  return { mode: 'form', field: kind === 'notes' ? 'x' : 'both', operation: 'By', lower: '0', upper: '0', easingType: 1,
    cycle: '1', disturbance: '0', noteType: 0, eventType: 'all', condition: '', seed: 1, targets: '0', increment: '0', retainSource: true, channels: {},
    script: kind === 'notes' ? 'x = lerp(-500, 500, u);\nsize = 1 + 0.25 * sin(u * pi);' : 'start += 20 * sin(u * pi);\nend += 20 * sin(u * pi);' };
}

function parameters(kind, value) {
  const defaults = defaultBatchParameters(kind); const result = { ...defaults };
  if (!value || typeof value !== 'object') return result;
  for (const key of Object.keys(defaults)) {
    if (key === 'retainSource') result.retainSource = value.retainSource !== false;
    else if (key === 'channels') {
      result.channels = {};
      for (const type of ['moveXEvents', 'moveYEvents', 'rotateEvents', 'alphaEvents']) if (value.channels?.[type]) {
        const channel = value.channels[type]; result.channels[type] = {};
        for (const name of ['lower', 'upper', 'easingType', 'cycle', 'disturbance']) if (['string', 'number'].includes(typeof channel[name])) result.channels[type][name] = channel[name];
      }
    } else if (['string', 'number'].includes(typeof value[key])) result[key] = value[key];
  }
  return result;
}

export class MultiEditParameters {
  constructor(storage = localPreferences, onError = () => {}) {
    this.storage = storage; this.onError = onError; this.drafts = {}; this.history = {}; this.saved = {};
    let stored;
    try { stored = JSON.parse(storage?.getItem(storageKey) ?? '{}'); } catch { stored = {}; }
    if (!stored || typeof stored !== 'object') stored = {};
    for (const kind of kinds) {
      this.drafts[kind] = parameters(kind, stored.drafts?.[kind]);
      this.history[kind] = Array.isArray(stored.history?.[kind]) ? stored.history[kind].slice(-50).map(value => parameters(kind, value)) : [];
      this.saved[kind] = Array.isArray(stored.saved?.[kind]) ? stored.saved[kind].filter(entry => typeof entry?.name === 'string').map(entry => ({ name: entry.name.slice(0, 80), value: parameters(kind, entry.value) })) : [];
    }
  }

  persist() {
    try { this.storage?.setItem(storageKey, JSON.stringify({ drafts: this.drafts, history: this.history, saved: this.saved })); }
    catch { this.onError(t('multi-edit-parameters.s2303fd5')); }
  }
  read(kind) { return structuredClone(this.drafts[kind]); }
  update(kind, value) { this.drafts[kind] = parameters(kind, value); this.persist(); }
  reset(kind) { this.update(kind, defaultBatchParameters(kind)); }
  remember(kind, value) {
    const next = parameters(kind, value); const signature = JSON.stringify(next);
    this.history[kind] = this.history[kind].filter(entry => JSON.stringify(entry) !== signature);
    this.history[kind].push(next); this.history[kind] = this.history[kind].slice(-50); this.persist();
    return this.history[kind].length - 1;
  }
  save(kind, name, value) {
    name = name.trim().slice(0, 80); if (!name) throw new Error(t('multi-edit-parameters.s47937ce'));
    const entry = { name, value: parameters(kind, value) }; const index = this.saved[kind].findIndex(candidate => candidate.name === name);
    if (index < 0) this.saved[kind].push(entry); else this.saved[kind][index] = entry;
    this.persist(); return entry;
  }
  remove(kind, name) { this.saved[kind] = this.saved[kind].filter(entry => entry.name !== name); this.persist(); }
}
