import { shaderSourceBody } from './shader-source-info.mjs';

export const SHADER_SYSTEM_UNIFORMS = new Set(['screenTexture', 'screenSize', 'resolution', 'time', 'u_time', 'Model', 'Projection', 'UVScale']);
export function shaderUniforms(source) {
  source = shaderSourceBody(source);
  // Keep declaration-line defaults, but never treat commented-out code as a uniform.
  const text = source.replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\r\n]/g, ' ')).replace(/\/\/([^\r\n]*)/g, (_, comment) => /%[^%]+%/.test(comment) ? ' // ' + comment.replace(/uniform/g, '') : '');
  return [...text.matchAll(/\buniform\s+(?:(?:lowp|mediump|highp)\s+)?(\w+)\s+(\w+)\s*;([^\r\n]*)/g)]
    .filter(([, , name]) => !SHADER_SYSTEM_UNIFORMS.has(name))
    .map(([, type, name, comment]) => {
      const dimensions = /^vec[234]$/.test(type) ? Number(type.at(-1)) : 1;
      const defaults = comment.match(/%([^%]+)%/)?.[1].split(',').map(value => value.trim());
      const validDefault = !!defaults && defaults.length === dimensions && defaults.every(value => value && Number.isFinite(Number(value)));
      const values = validDefault ? defaults.map(Number) : Array(dimensions).fill(0);
      return { name, type, dimensions, validDefault, value: dimensions === 1 ? values[0] : values };
    });
}
const schemas = new WeakMap();
export function shaderUniformSchema(bytes) {
  if (!schemas.has(bytes)) schemas.set(bytes, Object.fromEntries(shaderUniforms(new TextDecoder().decode(bytes)).map(parameter => [parameter.name, { type: parameter.type, dimensions: parameter.dimensions }])));
  return schemas.get(bytes);
}
export function shaderVariableProblems(event, schema) {
  const result = [];
  for (const [name, value] of Object.entries(event.vars ?? {})) {
    const parameter = Object.hasOwn(schema, name) ? schema[name] : null;
    if (!parameter) { result.push({ name, code: 'shaderUniformMissing' }); continue; }
    const track = Array.isArray(value) && value[0] && typeof value[0] === 'object';
    const valid = sample => parameter.dimensions === 1 ? typeof sample === 'number' && Number.isFinite(sample) : Array.isArray(sample) && sample.length === parameter.dimensions && sample.every(v => typeof v === 'number' && Number.isFinite(v));
    const invalid = track ? value.some(segment => !valid(segment?.start) || !valid(segment?.end) || segment.customEasing && typeof segment.customEasing === 'object' && 'sourceStart' in segment.customEasing && (!valid(segment.customEasing.sourceStart) || !valid(segment.customEasing.sourceEnd))) : !valid(value);
    if (invalid) result.push({ name, code: 'shaderUniformType', type: parameter.type });
  }
  return result;
}
