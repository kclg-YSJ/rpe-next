import { localPreferences } from './local-preferences.mjs';
import { normalizeSampling } from '../core/sampling-grid.mjs';
let cached;
export function samplingPreferences() { if (!cached) { try { cached = normalizeSampling(JSON.parse(localPreferences.getItem('rpen-sampling-v1') || '{}')); } catch { cached = normalizeSampling(); } } return cached; }
export function saveSamplingPreferences(change) { const next = normalizeSampling({ ...samplingPreferences(), ...change }); localPreferences.setItem('rpen-sampling-v1', JSON.stringify(next)); cached=next; return cached; }
