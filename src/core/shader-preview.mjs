import { beatValue } from './beat.mjs';
import { shaderIdentity } from './shader.mjs';

export const SHADER_PREVIEW_DRAFT = 'rpen:shader-code-draft';
const numberBeat = value => Array.isArray(value) ? beatValue(value) : Number(value) || 0;
export const shaderPreviewKey = effect => JSON.stringify([effect.sourceName, effect.shader, effect.line, effect.startBeat, effect.endBeat, effect.order]);
export function shaderPreviewTargets(entries) {
  return new Set(entries.map(({ event, lineIndex }) => shaderPreviewKey({ sourceName: String(event.shader ?? event.name ?? ''), shader: shaderIdentity(event), line: lineIndex,
    startBeat: numberBeat(event.startTime ?? event.start), endBeat: numberBeat(event.endTime ?? event.end), order: Number(event.order ?? 0) })));
}
// Substitute in place, preserving pass order, event values and local/global
// placement. The old source must never be applied below its edited draft.
export function shaderPreviewPasses(effects, matches, defaults = {}, parameters = {}) {
  let found = false, values = { ...defaults, ...parameters };
  const result = effects.map(effect => {
    if (!matches(effect)) return effect;
    if (!found) values = { ...defaults, ...effect.values, ...parameters };
    found = true;
    return { ...effect, shader: SHADER_PREVIEW_DRAFT, sourceName: SHADER_PREVIEW_DRAFT, values: { ...effect.values, ...parameters } };
  });
  if (!found) result.push({ shader: SHADER_PREVIEW_DRAFT, sourceName: SHADER_PREVIEW_DRAFT, global: true, order: Infinity, values: parameters });
  return { effects: result, values };
}
