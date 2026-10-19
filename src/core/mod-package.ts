import { parse } from 'acorn';
import { parseShortcut } from './shortcut-spec.ts';

export const MOD_API_VERSION = 1;
export const MOD_LIMITS = Object.freeze({ files: 2048, bytes: 128 * 1024 * 1024, fileBytes: 32 * 1024 * 1024, codeBytes: 4 * 1024 * 1024 });
const identifier = /^[a-z][a-z0-9-]{0,63}$/;
const settingTypes = ['boolean', 'number', 'text', 'color', 'select', 'shortcut'] as const;
function fail(message: string): never { throw new Error('模组：' + message); }
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

export type ModSettingDefinition =
  | { label: string; description?: string; type: 'boolean'; default: boolean }
  | { label: string; description?: string; type: 'number'; default: number; min: number; max: number; step?: number }
  | { label: string; description?: string; type: 'text' | 'color' | 'shortcut'; default: string }
  | { label: string; description?: string; type: 'select'; default: string; options: Record<string, string> };

export interface ModManifest {
  protocol: string;
  api: number;
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  entry: string;
  dependencies: string[];
  conflicts: string[];
  settings: Record<string, ModSettingDefinition>;
}

export interface ModPackage {
  manifest: ModManifest;
  files: Map<string, Uint8Array>;
  bytes: number;
}

export function modPath(path: unknown): string {
  if (typeof path !== 'string' || !path || path.length > 240 || /[\\:\x00-\x1f?#]/.test(path) || path.startsWith('/') || path.split('/').some(part => !part || part === '.' || part === '..')) fail('无效的包内路径：' + String(path));
  return path;
}

export function modManifest(source: unknown): ModManifest {
  if (!object(source) || source.protocol !== 'rpen-mod' || source.api !== MOD_API_VERSION) fail('需要 rpen-mod 协议 api=1');
  const id = source.id;
  if (typeof id !== 'string' || !identifier.test(id)) fail('id 需要小写字母开头，使用字母、数字和连字符');
  for (const [key, limit] of [['name', 100], ['version', 60], ['author', 160], ['description', 4000]] as const) {
    const value = source[key];
    if (typeof value !== 'string' || value.length > limit || (key === 'name' || key === 'version') && !value.trim()) fail(key + ' 文本无效');
  }
  const version = source.version;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(version)) fail('version 须为语义化版本号，例如 1.0.0');
  const entry = modPath(source.entry); if (!/\.(m?js)$/.test(entry)) fail('entry 需要为 .mjs / .js ES 模块');
  for (const key of ['dependencies', 'conflicts'] as const) {
    const list = source[key];
    if (list !== undefined && (!Array.isArray(list) || list.length > 64 || list.some(value => typeof value !== 'string' || !identifier.test(value) || value === source.id))) fail(key + ' 须为其他模组 id 的数组');
  }
  const settings = source.settings ?? {};
  if (!object(settings) || Object.keys(settings).length > 100) fail('settings 无效');
  for (const [key, definition] of Object.entries(settings)) {
    if (!identifier.test(key) || !object(definition) || typeof definition.label !== 'string' || definition.label.length > 120) fail('无效的设置项：' + key);
    const type = definition.type;
    if (typeof type !== 'string' || !(settingTypes as readonly string[]).includes(type)) fail('无效的设置项：' + key);
    if (type === 'select') {
      const options = definition.options;
      if (!object(options) || !Object.keys(options).length || Object.keys(options).length > 200 || Object.entries(options).some(([option, label]) => option.length > 2000 || typeof label !== 'string' || label.length > 2000)) fail('select 缺少有效的 options');
    }
    if (type === 'number') {
      const min = definition.min, max = definition.max;
      if (typeof min !== 'number' || !Number.isFinite(min) || typeof max !== 'number' || !Number.isFinite(max) || min > max) fail('number 需要有效的 min/max');
    }
    const step = definition.step;
    if (step !== undefined && (typeof step !== 'number' || !Number.isFinite(step) || step <= 0)) fail('step 必须为正数');
    modSettingValue(definition, definition.default, key);
  }
  const dependencies = Array.isArray(source.dependencies) ? source.dependencies as string[] : [];
  const conflicts = Array.isArray(source.conflicts) ? source.conflicts as string[] : [];
  return { ...(source as unknown as ModManifest), dependencies: [...new Set(dependencies)], conflicts: [...new Set(conflicts)], settings: settings as Record<string, ModSettingDefinition> };
}

export function modSettingValue(definition: unknown, value: unknown, key = ''): unknown {
  if (!definition) fail('未知设置项：' + key);
  if (!object(definition)) return value;
  const type = definition.type;
  switch (type) {
    case 'boolean':
      if (typeof value !== 'boolean') fail('设置值无效：' + key);
      break;
    case 'number': {
      const min = definition.min, max = definition.max;
      if (typeof value !== 'number' || !Number.isFinite(value) || (typeof min === 'number' && value < min) || (typeof max === 'number' && value > max)) fail('设置值无效：' + key);
      break;
    }
    case 'color':
      if (typeof value !== 'string' || value.length > 2000 || !/^#[\da-f]{6}$/i.test(value)) fail('设置值无效：' + key);
      break;
    case 'select': {
      const options = definition.options;
      if (typeof value !== 'string' || value.length > 2000 || !object(options) || !Object.hasOwn(options, value)) fail('设置值无效：' + key);
      break;
    }
    case 'text':
    case 'shortcut':
      if (typeof value !== 'string' || value.length > 2000) fail('设置值无效：' + key);
      break;
  }
  if (type === 'shortcut' && parseShortcut(value).error) fail('快捷键无效：' + key);
  return value;
}

export function parseModPackage(source: unknown): ModPackage {
  if (!(source instanceof Map) || source.size > MOD_LIMITS.files) fail('文件数量超限');
  const input: Map<unknown, unknown> = source;
  let bytes = 0; const entries = new Map<string, Uint8Array>();
  for (const [name, data] of input) {
    if (typeof name !== 'string') fail('无效的包内路径：' + String(name));
    if (name.endsWith('/') || name.startsWith('__MACOSX/') || name.split('/').at(-1)?.startsWith('.')) continue;
    modPath(name); if (!(data instanceof Uint8Array) || data.length > MOD_LIMITS.fileBytes) fail('文件无效或过大：' + name);
    bytes += data.length; if (bytes > MOD_LIMITS.bytes) fail('解压后超过 128 MiB'); entries.set(name, data);
  }
  const manifests = [...entries.keys()].filter(name => name === 'mod.json' || name.endsWith('/mod.json')); if (manifests.length !== 1) fail('需要唯一的 mod.json');
  const prefix = manifests[0].slice(0, -8); if ([...entries.keys()].some(name => !name.startsWith(prefix))) fail('存在模组目录以外的文件');
  const files = new Map<string, Uint8Array>([...entries].map(([name, data]) => [name.slice(prefix.length), data] as [string, Uint8Array])); let manifest: ModManifest;
  try { manifest = modManifest(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(files.get('mod.json')))); } catch (error) { fail('mod.json：' + errorMessage(error)); }
  if (!files.has(manifest.entry)) fail('入口文件不存在：' + manifest.entry);
  for (const [name, data] of files) if (/\.(m?js)$/.test(name)) {
    if (data.length > MOD_LIMITS.codeBytes) fail('代码文件超过 4 MiB');
    try { parse(new TextDecoder('utf-8', { fatal: true }).decode(data), { ecmaVersion: 'latest', sourceType: 'module' }); } catch (error) { fail(`${name} 语法错误：${errorMessage(error)}`); }
  }
  return { manifest, files, bytes };
}

export function resolveModImport(specifier: unknown, from: string, files: Map<string, Uint8Array>, prefix: string, baseUrl: string | URL): string {
  if (typeof specifier !== 'string') fail('动态 import 路径须为字符串');
  if (specifier === '@rpen/api') return new URL('src/ui/mod-api.ts', baseUrl).href;
  if (specifier.startsWith('@rpen/')) { const path = modPath(specifier.slice(6)).replace(/\.mjs$/, '.ts'); if (!/^(core|application|platform|ui)\/.+\.ts$/.test(path)) fail('内部模块路径无效'); return new URL('src/' + path, baseUrl).href; }
  if (!specifier.startsWith('.')) {
    if (/^(https?:|data:|blob:)/.test(specifier)) return specifier;
    fail('未知模块名：' + specifier + '；请使用包内相对路径或 @rpen/');
  }
  const parts = from.split('/').slice(0, -1);
  for (const part of specifier.split('/')) if (part === '..') { if (!parts.length) fail('模块导入超出包根目录'); parts.pop(); } else if (part !== '.' && part) parts.push(part);
  const path = modPath(parts.join('/')); if (!files.has(path)) fail('模块不存在：' + path);
  if (!/\.(m?js|json)$/.test(path)) fail('import 仅用于 JS/JSON 模块，素材请用 api.package.url');
  return prefix + path;
}

export function rewriteModModule(source: string, path: string, resolve: (specifier: string, from: string) => string, loadId: string): string {
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }); const edits: [number, number, string][] = [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const item = node as Record<string, unknown>;
    const type = item.type;
    if ((type === 'ImportDeclaration' || type === 'ExportNamedDeclaration' || type === 'ExportAllDeclaration') && item.source) {
      const spec = item.source as Record<string, unknown>;
      if (typeof spec.start === 'number' && typeof spec.end === 'number' && typeof spec.value === 'string') edits.push([spec.start, spec.end, JSON.stringify(resolve(spec.value, path))]);
    }
    if (type === 'ImportExpression') {
      const spec = item.source as Record<string, unknown> | null | undefined;
      if (spec && spec.type === 'Literal' && typeof spec.start === 'number' && typeof spec.end === 'number' && typeof spec.value === 'string') edits.push([spec.start, spec.end, JSON.stringify(resolve(spec.value, path))]);
      else if (spec && typeof spec.start === 'number' && typeof spec.end === 'number') { edits.push([spec.start, spec.start, `globalThis.rpenMods.resolveModule(${JSON.stringify(loadId)},(`]); edits.push([spec.end, spec.end, `),${JSON.stringify(path)})`]); }
    }
    if (type === 'MemberExpression' && !item.computed) {
      const object = item.object as Record<string, unknown> | null | undefined;
      const property = item.property as Record<string, unknown> | null | undefined;
      const meta = object?.type === 'MetaProperty' ? object.meta as Record<string, unknown> | null | undefined : undefined;
      if (meta?.name === 'import' && property?.name === 'resolve' && typeof item.start === 'number' && typeof item.end === 'number') edits.push([item.start, item.end, `(specifier=>globalThis.rpenMods.resolveModule(${JSON.stringify(loadId)},specifier,${JSON.stringify(path)}))`]);
    }
    for (const [key, value] of Object.entries(item)) if (!['start', 'end', 'loc'].includes(key)) { if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === 'object') visit(value); }
  }; visit(ast);
  edits.sort((a, b) => b[0] - a[0] || b[1] - a[1]); let rewritten = source;
  for (const [start, end, replacement] of edits) rewritten = rewritten.slice(0, start) + replacement + rewritten.slice(end);
  return rewritten;
}
