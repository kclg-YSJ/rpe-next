import { localPreferences } from './local-preferences.mjs';

const KEY = 'rpen-animation-curve-view-v2';
const finite = (v, fallback, min, max) => Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;
export function normalizeCurvePreferences(value) {
  value = value && typeof value === 'object' ? value : {};
  const x0 = finite(value.view?.x0, 0, 0, .98), x1 = finite(value.view?.x1, 1, x0 + .02, 1);
  const y0 = finite(value.view?.y0, -.2, -20000, 19999), y1 = finite(value.view?.y1, Math.max(1.2, y0 + 1.4), y0 + .01, y0 + 20000);
  return {
    view: { x0, x1, y0, y1 }, snap: finite(value.snap, 0, 0, .5),
    left: finite(value.left, null, -100000, 100000), top: finite(value.top, null, -100000, 100000),
    width: finite(value.width, 1080, 480, 4000), height: finite(value.height, 700, 360, 4000),
    maximized: value.maximized === true, realValues: value.realValues === true,
  };
}
export function readCurvePreferences(storage = localPreferences) {
  let value;
  try { value = JSON.parse(storage.getItem(KEY) ?? storage.getItem('rpen-animation-curve-view-v1')); } catch {}
  return normalizeCurvePreferences(value);
}
export function writeCurvePreferences(value, storage = localPreferences) { storage.setItem(KEY, JSON.stringify(normalizeCurvePreferences(value))); }
