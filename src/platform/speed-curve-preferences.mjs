import { localPreferences } from './local-preferences.mjs';

const KEY = 'rpen-speed-curve-view-v1';
const number = (value, fallback, low, high) => typeof value === 'number' && Number.isFinite(value) ? Math.max(low, Math.min(high, value)) : fallback;
export function normalizeSpeedCurvePreferences(value = {}) {
  value = value && typeof value === 'object' ? value : {};
  return {
    width: number(value.width, 740, 300, 4000), height: number(value.height, 414, 340, 4000),
    left: number(value.left, null, -100000, 100000), top: number(value.top, null, -100000, 100000),
    span: number(value.span, 8, .25, 4096), offset: number(value.offset, -6.4, -1e7, 1e7),
    limit: number(value.limit, 1600, 200, 100000), snapY: value.snapY !== false,
    snapStep: number(value.snapStep, 100, .001, 1000000), layer: Math.round(number(value.layer, 0, 0, 1000)),
  };
}
export function readSpeedCurvePreferences(storage = localPreferences) {
  try { return normalizeSpeedCurvePreferences(JSON.parse(storage.getItem(KEY))); } catch { return normalizeSpeedCurvePreferences(); }
}
export function writeSpeedCurvePreferences(value, storage = localPreferences) {
  storage.setItem(KEY, JSON.stringify(normalizeSpeedCurvePreferences(value)));
}
