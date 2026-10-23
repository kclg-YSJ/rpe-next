import { t } from '../i18n.mjs';
export const NOISE_LAYER_VERSION = 230;
export const DEFAULT_NOISE_LAYER = 'default';
export const noiseLayers = chart => chart.noiseAreaLayers?.length ? chart.noiseAreaLayers : [{ id: DEFAULT_NOISE_LAYER, name: t('noise-skin.s5f3a1c4'), skin: '', parameters: {} }];
export const noiseLayerId = area => area.layerId ?? DEFAULT_NOISE_LAYER;
export function withNoiseLayers(chart, layers, areas = chart.blockAreaList ?? []) {
  const next = { ...chart, META: { ...chart.META, RPEVersion: Math.max(chart.META.RPEVersion ?? 0, NOISE_LAYER_VERSION) }, noiseAreaLayers: layers, blockAreaList: areas };
  validateNoiseLayers(next); return next;
}
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
function validateSkinSettings(settings) {
  if (!object(settings)) throw new Error(t('noise-skin.s646972e'));
  if (settings.channel !== undefined && !['normal', 'low'].includes(settings.channel)) throw new Error(t('noise-skin.scbb064a'));
  if (settings.parameters !== undefined && (!object(settings.parameters) || Object.values(settings.parameters).some(value => !(finite(value) || Array.isArray(value) && [2, 4].includes(value.length) && value.every(finite))))) throw new Error(t('noise-skin.s393a979'));
  if (settings.parameters?.touchReleaseDuration < 0) throw new Error(t('noise-skin.s11eaf8c'));
}
export function skinPath(path) {
  if (typeof path !== 'string' || !path || /[\\:\x00-\x1f?#]/.test(path) || path.startsWith('/') || path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error(t('noise-skin.s26f8cfb') + path);
  return path;
}
export function validateNoiseLayers(chart) {
  if (chart.noiseAreaLayers === undefined) { if ((chart.blockAreaList??[]).some(area=>noiseLayerId(area)!==DEFAULT_NOISE_LAYER)) throw new Error(t('noise-skin.s04778b4')); return; }
  if (!Array.isArray(chart.noiseAreaLayers) || !chart.noiseAreaLayers.length) throw new Error(t('noise-skin.saa4b600'));
  const ids = new Set();
  for (const layer of chart.noiseAreaLayers) {
    if (!object(layer) || typeof layer.id !== 'string' || !layer.id || ids.has(layer.id) || typeof layer.name !== 'string') throw new Error(t('noise-skin.s2e9bf32'));
    ids.add(layer.id);
    if (layer.skin) { skinPath(layer.skin); if (!/^shader\/[^/]+$/.test(layer.skin)) throw new Error(t('noise-skin.sfee17b6')); }
    validateSkinSettings(layer);
    if (layer.skinPresets !== undefined) {
      if (!object(layer.skinPresets)) throw new Error(t('noise-skin.seaa4763'));
      for (const [root, settings] of Object.entries(layer.skinPresets)) {
        skinPath(root); if (!/^shader\/[^/]+$/.test(root)) throw new Error(t('noise-skin.s28f4694'));
        validateSkinSettings(settings);
      }
    }
  }
  for (const area of chart.blockAreaList ?? []) if (!ids.has(noiseLayerId(area))) throw new Error(t('noise-skin.s04778b4'));
}
export function noiseSkinModified(settings = {}, definition) {
  if (settings.channel === 'low' && (!definition || definition.low)) return true;
  return Object.entries(settings.parameters ?? {}).some(([name, value]) => {
    const parameter = definition?.parameters.find(entry => entry.name === name);
    return !parameter || JSON.stringify(value) !== JSON.stringify(parameter.value);
  });
}
export function rememberedNoiseSkinSettings(layer) {
  const presets = structuredClone(layer.skinPresets ?? {});
  if (layer.skin && (Object.keys(layer.parameters ?? {}).length || layer.channel === 'low')) presets[layer.skin] = { parameters: structuredClone(layer.parameters ?? {}), channel: layer.channel ?? 'normal' };
  return presets;
}
export function switchNoiseSkin(layer, skin, modified = false) {
  const skinPresets = rememberedNoiseSkinSettings(layer);
  const settings = modified ? skinPresets[skin] : null;
  return { ...layer, skin, parameters: structuredClone(settings?.parameters ?? {}), channel: settings?.channel ?? 'normal', skinPresets };
}
export function updateNoiseSkinSettings(layer, patch, definition) {
  const skinPresets = rememberedNoiseSkinSettings(layer); const next = { ...layer, ...patch };
  if (next.skin) {
    if (noiseSkinModified(next, definition)) skinPresets[next.skin] = { parameters: structuredClone(next.parameters ?? {}), channel: next.channel ?? 'normal' };
    else { delete skinPresets[next.skin]; next.parameters = {}; next.channel = 'normal'; }
  }
  return { ...next, skinPresets };
}
export function skinParameters(source) {
  const parameters = [];
  for (const match of source.matchAll(/uniform\s+(float|vec2|vec4)\s+(\w+)\s*;[^\r\n]*?\/\/\s*%([^%\r\n]+)%([^\r\n]*)/g)) {
    const [, type, name, raw, suffix] = match; const values = raw.split(',').map(value => Number(value.trim()));
    const count = type === 'float' ? 1 : Number(type.slice(3));
    if (values.length !== count || values.some(value => !finite(value))) throw new Error(t('noise-skin.sfe90c55') + name);
    const range = suffix.match(/(-?\d+(?:\.\d+)?)\s*\.\.\s*(-?\d+(?:\.\d+)?)/);
    if (range && (Number(range[1]) > Number(range[2]) || values.some(value => value < Number(range[1]) || value > Number(range[2])))) throw new Error(t('noise-skin.s44da685') + name);
    if (automatic(name)) throw new Error(t('noise-skin.s8b2403d') + name);
    parameters.push({ name, type, value: count === 1 ? values[0] : values, ...(range ? { min: Number(range[1]), max: Number(range[2]) } : {}) });
  }
  const release = parameters.find(parameter => parameter.name === 'touchReleaseDuration');
  if (!release || release.type !== 'float' || release.value < 0) throw new Error(t('noise-skin.sba74671'));
  if (new Set(parameters.map(parameter => parameter.name)).size !== parameters.length) throw new Error(t('noise-skin.s76b23a6'));
  return parameters;
}
export function skinTextures(source, file) {
  return [...source.matchAll(/uniform\s+sampler2D\s+(\w+)\s*;\s*\/\/\s*@texture\s+(\S+)([^\r\n]*)/g)].map(([, name, path, options]) => {
    const settings = { wrap: 'clamp', filter: 'linear', colorspace: 'linear', alphaMode: 'straight' };
    for (const option of options.trim().split(/\s+/).filter(Boolean)) {
      const [key, value] = option.split('=');
      if (!({ wrap: ['clamp', 'repeat', 'mirror'], filter: ['nearest', 'linear'], colorspace: ['linear', 'srgb'], alphaMode: ['straight', 'premult'] }[key]?.includes(value))) throw new Error(t('noise-skin.s01d7db2') + option);
      settings[key] = value;
    }
    skinPath(path); const directory = file.includes('/') ? file.slice(0, file.lastIndexOf('/') + 1) : '';
    return { name, path: skinPath(directory + path), ...settings };
  });
}
export function skinSize(screenWidth, screenHeight, specification = {}, maximum = Infinity) {
  const sizes = [screenWidth, screenHeight].map((size, index) => {
    const scale = specification[index ? 'scaleY' : 'scaleX'] ?? 1;
    if (!finite(scale) || scale <= 0) throw new Error(t('noise-skin.s3970236'));
    const result = Math.floor(size * scale);
    if (result < 1 || result > maximum) throw new Error(t('noise-skin.s157ad91'));
    return result;
  });
  return sizes;
}
const automatic = name => ['screenTexture', 'blockMask', 'screenSize', 'targetSize', 'targetTexelSize', 'time', 'touchCount', 'touchPoints', 'screenTextureSize', 'blockMaskSize'].includes(name);
function noiseSkinConfig(files) {
  const bytes = files.get('config.json');
  const config = bytes === undefined ? { version: 1, targets: {}, passes: [{ shader: 'main.glsl', output: '$screen' }] }
    : JSON.parse(typeof bytes === 'string' ? bytes : new TextDecoder().decode(bytes));
  if (!object(config)) throw new Error(t('noise-skin.sd77133c'));
  if (config.author !== undefined && typeof config.author !== 'string') throw new Error(t('noise-skin.s467098a'));
  return config;
}
export function noiseSkinLabel(name, author = '') { return author.trim() ? `${name}(${author.trim()})` : name; }
export function noiseSkinAuthor(files) { return noiseSkinConfig(files).author?.trim() ?? ''; }
export function parseNoiseSkin(files) {
  for (const path of files.keys()) skinPath(path);
  const decoder = new TextDecoder();
  const text = name => { skinPath(name); const bytes = files.get(name); if (!bytes) throw new Error(t('noise-skin.sdce3193') + name); return typeof bytes === 'string' ? bytes : decoder.decode(bytes); };
  const main = text('main.glsl'); const parameters = skinParameters(main);
  const config = noiseSkinConfig(files);
  if (config.version !== 1) throw new Error(t('noise-skin.s0584b46'));
  const sources = new Map([['main.glsl', main]]); const textures = new Map();
  const channel = (value, low = false) => {
    if (!object(value) || !Array.isArray(value.passes) || !value.passes.length || (!low && !object(value.targets))) throw new Error(t('noise-skin.s1d73f62'));
    const targets = value.targets ?? {}; if (!object(targets)) throw new Error(t('noise-skin.sd7c2141'));
    for (const [name, target] of Object.entries(targets)) {
      if (!name || name === '$screen' || name.includes('.') || !object(target)) throw new Error(t('noise-skin.s4f25714'));
      if (!['r8', 'rg8', 'rgba8'].includes(target.format ?? 'rgba8') || !['nearest', 'linear'].includes(target.filter ?? 'nearest') || target.noClear !== undefined && typeof target.noClear !== 'boolean') throw new Error(t('noise-skin.sa6ab0d8') + name);
      for (const key of ['scaleX', 'scaleY']) if (target[key] !== undefined && (!finite(target[key]) || target[key] <= 0)) throw new Error(t('noise-skin.s2553e0a'));
    }
    const blockMask = value.blockMask ?? {};
    if (!object(blockMask)) throw new Error(t('noise-skin.s26d75b1'));
    for (const scale of [blockMask.scaleX ?? 1, blockMask.scaleY ?? 1]) if (!finite(scale) || scale <= 0) throw new Error(t('noise-skin.s5e4ad4e'));
    const written = new Set();
    const passes = value.passes.map(pass => {
      if (!object(pass) || typeof pass.output !== 'string') throw new Error(t('noise-skin.s6c441ca'));
      const source = text(pass.shader); if (!pass.shader.endsWith('.glsl')) throw new Error(t('noise-skin.s4b5ad15')); sources.set(pass.shader, source);
      const images = skinTextures(source, pass.shader); textures.set(pass.shader, images);
      for (const image of images) if (!files.has(image.path)) throw new Error(t('noise-skin.se4df7ae') + image.path);
      const [output, component, extra] = pass.output.split('.'); const target = targets[output];
      if (output !== '$screen' && !Object.hasOwn(targets, output) || extra || component && (output === '$screen' || !target || !(target.format === 'r8' ? 'r' : target.format === 'rg8' ? 'rg' : 'rgba').includes(component) || component.length !== 1)) throw new Error(t('noise-skin.sf6d4dcf') + pass.output);
      const inputs = pass.inputs ?? {}; const constants = pass.constants ?? {};
      if (!object(inputs) || !object(constants)) throw new Error(t('noise-skin.seaec010'));
      const uniforms = new Map([...source.matchAll(/uniform\s+(?:highp\s+|mediump\s+|lowp\s+)?(\w+)\s+(\w+)/g)].map(([, type, name]) => [name, type]));
      const reservedSizes = new Set([...Object.keys(inputs), ...images.map(image=>image.name)].map(name=>name+'Size'));
      for (const [name, input] of Object.entries(inputs)) {
        if (automatic(name) || uniforms.get(name) !== 'sampler2D' || images.some(image => image.name === name)) throw new Error(t('noise-skin.sf956895') + name);
        if (input !== '$screen' && (!Object.hasOwn(targets, input) || !targets[input].noClear && (!written.has(input) || input === output))) throw new Error(t('noise-skin.s7424fee') + input);
      }
      for (const [name, value] of Object.entries(constants)) {
        const type = finite(value) ? 'float' : Array.isArray(value) && [2, 4].includes(value.length) && value.every(finite) ? 'vec' + value.length : null;
        if (!type || automatic(name) || reservedSizes.has(name) || name === 'touchReleaseDuration' || uniforms.get(name) !== type) throw new Error(t('noise-skin.s3dcda5a') + name);
      }
      for (const parameter of parameters) if (uniforms.has(parameter.name) && uniforms.get(parameter.name) !== parameter.type || automatic(parameter.name) || reservedSizes.has(parameter.name)) throw new Error(t('noise-skin.s1f1f5c2') + parameter.name);
      for (const [name,type] of Object.entries({screenTexture:'sampler2D',blockMask:'sampler2D',time:'float',screenSize:'vec2',targetSize:'vec2',targetTexelSize:'vec2',screenTextureSize:'vec2',blockMaskSize:'vec2',touchCount:'int',touchPoints:'vec4',...Object.fromEntries([...reservedSizes].map(name=>[name,'vec2']))})) if (uniforms.has(name)&&uniforms.get(name)!==type) throw new Error(t('noise-skin.s71013e4')+name);
      for (const [name, type] of uniforms) if (type === 'sampler2D' && !['screenTexture', 'blockMask'].includes(name) && !Object.hasOwn(inputs, name) && !images.some(image => image.name === name)) throw new Error(t('noise-skin.s737565e') + name);
      written.add(output); return { ...pass, inputs, constants, output, component };
    });
    return { targets, passes, blockMask };
  };
  return { author: config.author?.trim() ?? '', parameters, sources, textures, files, normal: channel(config), low: config.lowPerformance === undefined ? null : channel(config.lowPerformance, true) };
}
export function maskWord(normal, subtract) {
  return (normal[0] ? 1 : 0) | (subtract[0] === 1 ? 2 : 0) | (normal[1] ? 4 : 0) | (subtract[1] === 1 ? 8 : 0) | (normal[2] ? 16 : 0) | (subtract[2] === 1 ? 32 : 0);
}
