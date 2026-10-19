import type { Chart, NoiseArea, NoiseLayer, NoiseSkinSettings } from './types.ts';

export const NOISE_LAYER_VERSION = 230;
export const DEFAULT_NOISE_LAYER = 'default';

/** One shader parameter declared by `main.glsl`. */
export interface NoiseSkinParameter {
  name: string;
  type: 'float' | 'vec2' | 'vec4';
  value: number | number[];
  min?: number;
  max?: number;
}

/** One `@texture` declaration inside a pass shader. */
export interface NoiseSkinTexture {
  name: string;
  path: string;
  wrap: 'clamp' | 'repeat' | 'mirror';
  filter: 'nearest' | 'linear';
  colorspace: 'linear' | 'srgb';
  alphaMode: 'straight' | 'premult';
}

/** One render target a pass may read from or write to. */
export interface NoiseSkinTarget {
  format: 'r8' | 'rg8' | 'rgba8';
  filter: 'nearest' | 'linear';
  noClear: boolean;
  scaleX?: number;
  scaleY?: number;
}

/** One full-screen pass. */
export interface NoiseSkinPass {
  shader: string;
  output: string;
  component?: string;
  inputs: Record<string, string>;
  constants: Record<string, number | number[]>;
}

/** One colour channel of a skin: its targets and its passes. */
export interface NoiseSkinChannel {
  targets: Record<string, NoiseSkinTarget>;
  passes: NoiseSkinPass[];
  /** Block-mask resolution multipliers; a low-performance channel may omit it entirely. */
  blockMask: { scaleX?: number; scaleY?: number };
}

/** A parsed noise skin package. */
export interface NoiseSkinDefinition {
  author: string;
  parameters: NoiseSkinParameter[];
  sources: Map<string, string>;
  textures: Map<string, NoiseSkinTexture[]>;
  files: Map<string, Uint8Array | string>;
  normal: NoiseSkinChannel;
  low: NoiseSkinChannel | null;
}

/** The `config.json` a skin package may carry. */
interface NoiseSkinConfig {
  version?: number;
  author?: string;
  targets?: Record<string, unknown>;
  passes?: unknown[];
  lowPerformance?: unknown;
  blockMask?: unknown;
}

type Files = Map<string, Uint8Array | string>;

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export const noiseLayers = (chart: Chart): NoiseLayer[] => chart.noiseAreaLayers?.length ? chart.noiseAreaLayers : [{ id: DEFAULT_NOISE_LAYER, name: '默认层', skin: '', parameters: {} }];
export const noiseLayerId = (area: NoiseArea): string => area.layerId ?? DEFAULT_NOISE_LAYER;
export function withNoiseLayers(chart: Chart, layers: NoiseLayer[], areas: NoiseArea[] = chart.blockAreaList ?? []): Chart {
  const next: Chart = { ...chart, META: { ...chart.META, RPEVersion: Math.max(chart.META.RPEVersion ?? 0, NOISE_LAYER_VERSION) }, noiseAreaLayers: layers, blockAreaList: areas };
  validateNoiseLayers(next); return next;
}
function validateSkinSettings(settings: unknown): asserts settings is NoiseSkinSettings {
  if (!object(settings)) throw new Error('噪域皮肤配置必须为对象');
  if (settings.channel !== undefined && !['normal', 'low'].includes(String(settings.channel))) throw new Error('噪域皮肤通道无效');
  if (settings.parameters !== undefined && (!object(settings.parameters) || Object.values(settings.parameters).some(value => !(finite(value) || Array.isArray(value) && [2, 4].includes(value.length) && value.every(finite))))) throw new Error('噪域皮肤参数无效');
  const parameters = settings.parameters as Record<string, unknown> | undefined;
  if (finite(parameters?.touchReleaseDuration) && parameters.touchReleaseDuration < 0) throw new Error('touchReleaseDuration 不得为负数');
}
export function skinPath(path: unknown): string {
  if (typeof path !== 'string' || !path || /[\\:\x00-\x1f?#]/.test(path) || path.startsWith('/') || path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('皮肤路径无效：' + String(path));
  return path;
}
export function validateNoiseLayers(chart: Chart): void {
  if (chart.noiseAreaLayers === undefined) { if ((chart.blockAreaList ?? []).some(area => noiseLayerId(area) !== DEFAULT_NOISE_LAYER)) throw new Error('噪域引用了不存在的层'); return; }
  if (!Array.isArray(chart.noiseAreaLayers) || !chart.noiseAreaLayers.length) throw new Error('至少保留一个噪域层');
  const ids = new Set<string>();
  for (const layer of chart.noiseAreaLayers) {
    if (!object(layer) || typeof layer.id !== 'string' || !layer.id || ids.has(layer.id) || typeof layer.name !== 'string') throw new Error('噪域层名称或标识无效');
    ids.add(layer.id);
    if (layer.skin) { skinPath(layer.skin); if (!/^shader\/[^/]+$/.test(layer.skin)) throw new Error('噪域皮肤必须位于 shader/皮肤名'); }
    validateSkinSettings(layer);
    if (layer.skinPresets !== undefined) {
      if (!object(layer.skinPresets)) throw new Error('噪域皮肤参数记录必须为对象');
      for (const [root, settings] of Object.entries(layer.skinPresets)) {
        skinPath(root); if (!/^shader\/[^/]+$/.test(root)) throw new Error('皮肤参数记录路径无效');
        validateSkinSettings(settings);
      }
    }
  }
  for (const area of chart.blockAreaList ?? []) if (!ids.has(noiseLayerId(area))) throw new Error('噪域引用了不存在的层');
}
export function noiseSkinModified(settings: NoiseSkinSettings = {}, definition?: NoiseSkinDefinition | null): boolean {
  if (settings.channel === 'low' && (!definition || definition.low)) return true;
  return Object.entries(settings.parameters ?? {}).some(([name, value]) => {
    const parameter = definition?.parameters.find(entry => entry.name === name);
    return !parameter || JSON.stringify(value) !== JSON.stringify(parameter.value);
  });
}
export function rememberedNoiseSkinSettings(layer: NoiseLayer): Record<string, NoiseSkinSettings> {
  const presets: Record<string, NoiseSkinSettings> = structuredClone(layer.skinPresets ?? {});
  if (layer.skin && (Object.keys(layer.parameters ?? {}).length || layer.channel === 'low')) presets[layer.skin] = { parameters: structuredClone(layer.parameters ?? {}), channel: layer.channel ?? 'normal' };
  return presets;
}
export function switchNoiseSkin(layer: NoiseLayer, skin: string, modified = false): NoiseLayer {
  const skinPresets = rememberedNoiseSkinSettings(layer);
  const settings = modified ? skinPresets[skin] : null;
  return { ...layer, skin, parameters: structuredClone(settings?.parameters ?? {}), channel: settings?.channel ?? 'normal', skinPresets };
}
export function updateNoiseSkinSettings(layer: NoiseLayer, patch: Partial<NoiseLayer>, definition?: NoiseSkinDefinition | null): NoiseLayer {
  const skinPresets = rememberedNoiseSkinSettings(layer); const next: NoiseLayer = { ...layer, ...patch };
  if (next.skin) {
    if (noiseSkinModified(next, definition)) skinPresets[next.skin] = { parameters: structuredClone(next.parameters ?? {}), channel: next.channel ?? 'normal' };
    else { delete skinPresets[next.skin]; next.parameters = {}; next.channel = 'normal'; }
  }
  return { ...next, skinPresets };
}
export function skinParameters(source: string): NoiseSkinParameter[] {
  const parameters: NoiseSkinParameter[] = [];
  for (const match of source.matchAll(/uniform\s+(float|vec2|vec4)\s+(\w+)\s*;[^\r\n]*?\/\/\s*%([^%\r\n]+)%([^\r\n]*)/g)) {
    const [, type, name, raw, suffix] = match as unknown as [string, 'float' | 'vec2' | 'vec4', string, string, string];
    const values = raw.split(',').map(value => Number(value.trim()));
    const count = type === 'float' ? 1 : Number(type.slice(3));
    if (values.length !== count || values.some(value => !finite(value))) throw new Error('皮肤参数默认值无效：' + name);
    const range = suffix.match(/(-?\d+(?:\.\d+)?)\s*\.\.\s*(-?\d+(?:\.\d+)?)/);
    if (range && (Number(range[1]) > Number(range[2]) || values.some(value => value < Number(range[1]) || value > Number(range[2])))) throw new Error('皮肤参数范围无效：' + name);
    if (automatic(name)) throw new Error('皮肤参数名称保留：' + name);
    parameters.push({ name, type, value: count === 1 ? values[0]! : values, ...(range ? { min: Number(range[1]), max: Number(range[2]) } : {}) });
  }
  const release = parameters.find(parameter => parameter.name === 'touchReleaseDuration');
  if (!release || release.type !== 'float' || Number(release.value) < 0) throw new Error('main.glsl 必须声明非负的 touchReleaseDuration 参数');
  if (new Set(parameters.map(parameter => parameter.name)).size !== parameters.length) throw new Error('皮肤参数重复');
  return parameters;
}
export function skinTextures(source: string, file: string): NoiseSkinTexture[] {
  const options: Record<'wrap' | 'filter' | 'colorspace' | 'alphaMode', readonly string[]> = { wrap: ['clamp', 'repeat', 'mirror'], filter: ['nearest', 'linear'], colorspace: ['linear', 'srgb'], alphaMode: ['straight', 'premult'] };
  return [...source.matchAll(/uniform\s+sampler2D\s+(\w+)\s*;\s*\/\/\s*@texture\s+(\S+)([^\r\n]*)/g)].map(([, name, path, rest]) => {
    const settings: NoiseSkinTexture = { name, path: '', wrap: 'clamp', filter: 'linear', colorspace: 'linear', alphaMode: 'straight' };
    for (const option of rest.trim().split(/\s+/).filter(Boolean)) {
      const [rawKey, value] = option.split('=') as [keyof typeof options, string | undefined];
      if (value === undefined || !(options[rawKey]?.includes(value))) throw new Error('纹理选项无效：' + option);
      settings[rawKey] = value as never;
    }
    const directory = file.includes('/') ? file.slice(0, file.lastIndexOf('/') + 1) : '';
    settings.path = skinPath(directory + path);
    return settings;
  });
}
export function skinSize(screenWidth: number, screenHeight: number, specification: { scaleX?: number; scaleY?: number } = {}, maximum = Infinity): number[] {
  return [screenWidth, screenHeight].map((size, index) => {
    const scale = (index ? specification.scaleY : specification.scaleX) ?? 1;
    if (!finite(scale) || scale <= 0) throw new Error('皮肤分辨率倍率必须大于零');
    const result = Math.floor(size * scale);
    if (result < 1 || result > maximum) throw new Error('皮肤纹理尺寸超出设备范围');
    return result;
  });
}
const automatic = (name: string): boolean => ['screenTexture', 'blockMask', 'screenSize', 'targetSize', 'targetTexelSize', 'time', 'touchCount', 'touchPoints', 'screenTextureSize', 'blockMaskSize'].includes(name);
function noiseSkinConfig(files: Files): NoiseSkinConfig {
  const bytes = files.get('config.json');
  const config: unknown = bytes === undefined
    ? { version: 1, targets: {}, passes: [{ shader: 'main.glsl', output: '$screen' }] }
    : JSON.parse(typeof bytes === 'string' ? bytes : new TextDecoder().decode(bytes));
  if (!object(config)) throw new Error('皮肤 config.json 必须为对象');
  if (config.author !== undefined && typeof config.author !== 'string') throw new Error('皮肤 author 必须为作者名文本');
  return config as NoiseSkinConfig;
}
export function noiseSkinLabel(name: string, author = ''): string { return author.trim() ? `${name}(${author.trim()})` : name; }
export function noiseSkinAuthor(files: Files): string { return noiseSkinConfig(files).author?.trim() ?? ''; }
export function parseNoiseSkin(files: Files): NoiseSkinDefinition {
  for (const path of files.keys()) skinPath(path);
  const decoder = new TextDecoder();
  const text = (name: string): string => { skinPath(name); const bytes = files.get(name); if (!bytes) throw new Error('皮肤缺少文件：' + name); return typeof bytes === 'string' ? bytes : decoder.decode(bytes); };
  const main = text('main.glsl'); const parameters = skinParameters(main);
  const config = noiseSkinConfig(files);
  if (config.version !== 1) throw new Error('仅支持噪域皮肤协议 version=1');
  const sources = new Map<string, string>([['main.glsl', main]]); const textures = new Map<string, NoiseSkinTexture[]>();
  const channel = (value: unknown, low = false): NoiseSkinChannel => {
    if (!object(value) || !Array.isArray(value.passes) || !value.passes.length || (!low && !object(value.targets))) throw new Error('皮肤通道缺少 targets 或 passes');
    const targets = (value.targets ?? {}) as Record<string, unknown>; if (!object(targets)) throw new Error('皮肤 targets 必须为对象');
    const parsedTargets: Record<string, NoiseSkinTarget> = {};
    for (const [name, target] of Object.entries(targets)) {
      if (!name || name === '$screen' || name.includes('.') || !object(target)) throw new Error('皮肤 Target 名称无效');
      const format = (target.format ?? 'rgba8') as string; const filter = (target.filter ?? 'nearest') as string;
      if (!['r8', 'rg8', 'rgba8'].includes(format) || !['nearest', 'linear'].includes(filter) || target.noClear !== undefined && typeof target.noClear !== 'boolean') throw new Error('皮肤 Target 配置无效：' + name);
      for (const key of ['scaleX', 'scaleY']) { const number = target[key]; if (number !== undefined && (!finite(number) || number <= 0)) throw new Error('Target 倍率无效'); }
      parsedTargets[name] = { format: format as NoiseSkinTarget['format'], filter: filter as NoiseSkinTarget['filter'], noClear: target.noClear === true,
        ...(finite(target.scaleX) ? { scaleX: target.scaleX } : {}), ...(finite(target.scaleY) ? { scaleY: target.scaleY } : {}) };
    }
    const blockMask = (value.blockMask ?? {}) as Record<string, unknown>;
    if (!object(blockMask)) throw new Error('blockMask 必须为对象');
    for (const scale of [blockMask.scaleX ?? 1, blockMask.scaleY ?? 1]) if (!finite(scale) || scale <= 0) throw new Error('blockMask 倍率无效');
    const written = new Set<string>();
    const passes = (value.passes as unknown[]).map(pass => {
      if (!object(pass) || typeof pass.output !== 'string') throw new Error('皮肤 Pass 无效');
      const shader = pass.shader; if (typeof shader !== 'string' || !shader.endsWith('.glsl')) throw new Error('Pass 必须引用 GLSL 文件');
      const source = text(shader); sources.set(shader, source);
      const images = skinTextures(source, shader); textures.set(shader, images);
      for (const image of images) if (!files.has(image.path)) throw new Error('皮肤缺少图片：' + image.path);
      const [output, component, extra] = pass.output.split('.') as [string, string | undefined, string | undefined]; const target = parsedTargets[output];
      if (output !== '$screen' && !Object.hasOwn(parsedTargets, output) || extra || component && (output === '$screen' || !target || !(target.format === 'r8' ? 'r' : target.format === 'rg8' ? 'rg' : 'rgba').includes(component) || component.length !== 1)) throw new Error('Pass 输出无效：' + pass.output);
      const inputs = (pass.inputs ?? {}) as Record<string, string>; const constants = (pass.constants ?? {}) as Record<string, number | number[]>;
      if (!object(inputs) || !object(constants)) throw new Error('Pass inputs/constants 必须为对象');
      const uniforms = new Map<string, string>([...source.matchAll(/uniform\s+(?:highp\s+|mediump\s+|lowp\s+)?(\w+)\s+(\w+)/g)].map(match => [match[2]!, match[1]!]));
      const reservedSizes = new Set([...Object.keys(inputs), ...images.map(image => image.name)].map(name => name + 'Size'));
      for (const [name, input] of Object.entries(inputs)) {
        if (automatic(name) || uniforms.get(name) !== 'sampler2D' || images.some(image => image.name === name)) throw new Error('Pass 采样器无效：' + name);
        if (input !== '$screen' && (!Object.hasOwn(parsedTargets, input) || !parsedTargets[input]!.noClear && (!written.has(input) || input === output))) throw new Error('Target 在写入前读取：' + input);
      }
      for (const [name, value] of Object.entries(constants)) {
        const type = finite(value) ? 'float' : Array.isArray(value) && [2, 4].includes(value.length) && value.every(finite) ? 'vec' + value.length : null;
        if (!type || automatic(name) || reservedSizes.has(name) || name === 'touchReleaseDuration' || uniforms.get(name) !== type) throw new Error('Pass 常量无效：' + name);
      }
      for (const parameter of parameters) if (uniforms.has(parameter.name) && uniforms.get(parameter.name) !== parameter.type || automatic(parameter.name) || reservedSizes.has(parameter.name)) throw new Error('皮肤参数类型或名称冲突：' + parameter.name);
      for (const [name, type] of Object.entries({ screenTexture: 'sampler2D', blockMask: 'sampler2D', time: 'float', screenSize: 'vec2', targetSize: 'vec2', targetTexelSize: 'vec2', screenTextureSize: 'vec2', blockMaskSize: 'vec2', touchCount: 'int', touchPoints: 'vec4', ...Object.fromEntries([...reservedSizes].map(name => [name, 'vec2'])) })) if (uniforms.has(name) && uniforms.get(name) !== type) throw new Error('自动 uniform 类型错误：' + name);
      for (const [name, type] of uniforms) if (type === 'sampler2D' && !['screenTexture', 'blockMask'].includes(name) && !Object.hasOwn(inputs, name) && !images.some(image => image.name === name)) throw new Error('未绑定采样器：' + name);
      written.add(output); return { shader, output, ...(component === undefined ? {} : { component }), inputs, constants };
    });
    return { targets: parsedTargets, passes, blockMask };
  };
  return { author: config.author?.trim() ?? '', parameters, sources, textures, files, normal: channel(config), low: config.lowPerformance === undefined ? null : channel(config.lowPerformance, true) };
}
export function maskWord(normal: ArrayLike<number>, subtract: ArrayLike<number>): number {
  return (normal[0] ? 1 : 0) | (subtract[0] === 1 ? 2 : 0) | (normal[1] ? 4 : 0) | (subtract[1] === 1 ? 8 : 0) | (normal[2] ? 16 : 0) | (subtract[2] === 1 ? 32 : 0);
}
