import { validateCurvePreset } from './curve-trajectory.ts';
import type { CurvePreset } from './curve-trajectory.ts';

/**
 * A curve preset as the preset list stores it.
 *
 * `validateCurvePreset` returns the validated, structured-cloned record; this alias names that
 * result so the list, the storage round-trip and the panel all agree on one shape.
 */
export type StoredCurvePreset = CurvePreset;

export function parseCurvePreset(source: string): StoredCurvePreset {
  // `JSON.parse` can answer anything, so the text stays `unknown` until `validateCurvePreset` proves
  // it; the caught failure is the `SyntaxError` JSON.parse throws, which the original read `.message`
  // off unguarded.
  let value: unknown;
  try { value = JSON.parse(source); }
  catch (error) { throw new Error(`JSON 语法错误：${(error as Error).message}`); }
  return validateCurvePreset(value);
}

export function saveCurvePreset(presets: StoredCurvePreset[], preset: unknown, originalName: string | null = null): StoredCurvePreset[] {
  const valid = validateCurvePreset(preset);
  const index = originalName === null ? -1 : presets.findIndex(entry => entry.name === originalName);
  if (originalName !== null && index < 0) throw new Error('原预设已不存在，请作为新预设保存');
  if (presets.some((entry, position) => entry.name === valid.name && position !== index)) throw new Error('已有同名预设，请修改 name 或先编辑已有预设');
  const result = [...presets];
  if (index < 0) result.push(valid); else result[index] = valid;
  return result;
}

export function deleteCurvePreset(presets: StoredCurvePreset[], name: string): StoredCurvePreset[] {
  return presets.filter(entry => entry.name !== name);
}

export function copyCurvePreset(presets: StoredCurvePreset[], preset: unknown): StoredCurvePreset {
  const valid = validateCurvePreset(preset);
  let name = valid.name; let index = 1;
  while (presets.some(entry => entry.name === name)) {
    const suffix = `（副本 ${index++}）`;
    name = valid.name.slice(0, 80 - suffix.length) + suffix;
  }
  const copy: StoredCurvePreset = { ...valid, name };
  return copy;
}
