import { t } from '../i18n.mjs';
import { localPreferences } from './local-preferences.mjs';
import { assertAnimationCurve } from '../core/animation-curve.mjs';

const KEY = 'rpen-animation-curves-v1';
export function readCurveLibrary() {
  const text = localPreferences.getItem(KEY); if (!text) return [];
  return parseCurveLibrary(text);
}
export function parseCurveLibrary(text) {
  if (text.length > 8 * 1024 * 1024) throw Error(t('animation-curve.libraryTooLarge'));
  const file = JSON.parse(text);
  if (!file || file.format !== 'rpen-animation-curves' || file.version !== 1 || !Array.isArray(file.templates) || file.templates.length > 512) throw Error(t('animation-curve.invalidLibrary'));
  const ids = new Set();
  return file.templates.map(entry => {
    if (!entry || typeof entry !== 'object') throw Error(t('animation-curve.invalidLibrary'));
    assertAnimationCurve(entry.curve);
    const id = String(entry.id ?? crypto.randomUUID()).slice(0, 100);
    if (!id || ids.has(id)) throw Error(t('animation-curve.invalidLibrary')); ids.add(id);
    return { id, name: String(entry.name || entry.curve.name || t('animation-curve.unnamed')).slice(0, 160), curve: structuredClone(entry.curve) };
  });
}
export const curveLibraryText = templates => JSON.stringify({ format: 'rpen-animation-curves', version: 1, templates }, null, 2);
export function saveCurveLibrary(templates) { const text = curveLibraryText(templates); const normalized = parseCurveLibrary(text); localPreferences.setItem(KEY, curveLibraryText(normalized)); }
export function addCurveTemplate(templates, name, curve, id) {
  assertAnimationCurve(curve); const base = String(name).trim().slice(0, 140) || 'Curve'; let unique = base, suffix = 2;
  while (templates.some(t => t.id !== id && t.name === unique)) unique = `${base} (${suffix++})`;
  const entry = { id: id ?? crypto.randomUUID(), name: unique, curve: { ...structuredClone(curve), name: unique } };
  const next = id ? templates.map(t => t.id === id ? entry : t) : [...templates, entry];
  if (next.length > 512) throw Error(t('animation-curve.libraryFull'));
  return next;
}
