import { load, dump, CORE_SCHEMA } from 'js-yaml';
import type { Color } from './types.ts';

export const NOTE_SKIN_LIMITS = Object.freeze({ files: 256, bytes: 192 * 1024 * 1024, fileBytes: 48 * 1024 * 1024, pixels: 96 * 1024 * 1024, dimension: 16384 });
export const NOTE_SKIN_IMAGES = ['click.png', 'click_mh.png', 'drag.png', 'drag_mh.png', 'flick.png', 'flick_mh.png', 'hold.png', 'hold_mh.png', 'hit_fx.png'];
export const NOTE_SKIN_SOUNDS: Readonly<Record<string, string>> = Object.freeze({ tap: 'click.ogg', drag: 'drag.ogg', flick: 'flick.ogg' });
export const NOTE_SKIN_DEFAULTS = Object.freeze({ description: '', hitFxDuration: 0.5, hitFxScale: 1, hitFxRotate: false, hitFxTinted: true, hideParticles: false, holdKeepHead: false, holdRepeat: false, holdCompact: false, colorPerfect: 0xe1ffec9f, colorGood: 0xebb4e1ff });

export interface NoteSkinInfo {
  name: string;
  author: string;
  description: string;
  hitFx: [number, number];
  holdAtlas: [number, number];
  holdAtlasMH: [number, number];
  hitFxDuration: number;
  hitFxScale: number;
  hitFxRotate: boolean;
  hitFxTinted: boolean;
  hideParticles: boolean;
  holdKeepHead: boolean;
  holdRepeat: boolean;
  holdCompact: boolean;
  colorPerfect: number;
  colorGood: number;
  [key: string]: unknown;
}

export interface NoteSkinRecord {
  id: string | null;
  info: NoteSkinInfo;
  files: Map<string, Uint8Array>;
  images: Record<string, { width: number; height: number }>;
  sounds: Map<string, Uint8Array>;
  warnings: string[];
  bytes: number;
  builtin?: boolean;
  originalFiles?: Map<string, Uint8Array>;
}

export interface NoteSkinFrame {
  index: number;
  column: number;
  row: number;
}

export interface HoldSkinLayout {
  direction: number;
  length: number;
  scale: number;
  headHeight: number;
  tailHeight: number;
  bodyPixels: number;
  headY: number;
  tailY: number;
  bodyTop: number;
  bodyHeight: number;
  tailPixels: number;
  headPixels: number;
}

function fail(message: string): never { throw new Error('音符皮肤：' + message); }
const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);
const plain = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

function integerPair(value: unknown, minimum: number, name: string): [number, number] {
  if (!Array.isArray(value) || value.length !== 2) fail(`${name} 须为两个${minimum ? '正' : '非负'}整数`);
  const items: unknown[] = value;
  if (!items.every(item => typeof item === 'number' && Number.isInteger(item) && item >= minimum && item <= 65535)) fail(`${name} 须为两个${minimum ? '正' : '非负'}整数`);
  return [items[0] as number, items[1] as number];
}

export function noteSkinInfo(source: unknown): NoteSkinInfo {
  if (!plain(source)) fail('info.yml 须为属性映射');
  const info: Record<string, unknown> = { ...NOTE_SKIN_DEFAULTS };
  for (const key of ['name', 'author', 'hitFx', 'holdAtlas', 'holdAtlasMH', ...Object.keys(NOTE_SKIN_DEFAULTS)]) if (Object.hasOwn(source, key)) info[key] = source[key];
  for (const [key, limit] of [['name', 100], ['author', 200], ['description', 4000]] as const) {
    const value = info[key];
    if (typeof value !== 'string' || value.length > limit || key === 'name' && !value.trim()) fail(`${key} 须为${key === 'name' ? '非空' : ''}文本，最多 ${limit} 字符`);
  }
  const hitFx = integerPair(info.hitFx, 1, 'hitFx');
  const holdAtlas = integerPair(info.holdAtlas, 0, 'holdAtlas');
  const holdAtlasMH = integerPair(info.holdAtlasMH, 0, 'holdAtlasMH');
  info.hitFx = hitFx; info.holdAtlas = holdAtlas; info.holdAtlasMH = holdAtlasMH;
  if (hitFx[0] * hitFx[1] > 10240) fail('打击动画图集不能超过 10240 帧');
  for (const key of ['hitFxDuration', 'hitFxScale'] as const) {
    const value = info[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > (key === 'hitFxDuration' ? 120 : 64)) fail(`${key} 须为有效正数`);
  }
  for (const key of ['hitFxRotate', 'hitFxTinted', 'hideParticles', 'holdKeepHead', 'holdRepeat', 'holdCompact'] as const) if (typeof info[key] !== 'boolean') fail(`${key} 须为 true 或 false`);
  for (const key of ['colorPerfect', 'colorGood'] as const) {
    let value = info[key];
    if (typeof value === 'string' && /^(?:0x|#)[\da-f]{6}(?:[\da-f]{2})?$/i.test(value)) value = parseInt(value.replace(/^(0x|#)/i, ''), 16);
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 0xffffffff) fail(`${key} 须为 RGB 或 ARGB 十六进制颜色`);
    info[key] = value;
  }
  return info as NoteSkinInfo;
}

export function parseNoteSkinInfo(text: string): NoteSkinInfo {
  if (typeof text !== 'string' || text.length > 65536) fail('info.yml 超过 64 KiB');
  let source: unknown;
  try { source = load(text.replace(/^\uFEFF/, ''), { schema: CORE_SCHEMA }); }
  catch (error) { fail('info.yml 语法错误：' + errorMessage(error)); }
  return noteSkinInfo(source);
}

export function serializeNoteSkinInfo(info: NoteSkinInfo): string {
  return dump(noteSkinInfo(info), { schema: CORE_SCHEMA, noRefs: true, lineWidth: 100, sortKeys: false });
}

export function noteSkinColor(value: number): { rgb: Color; alpha: number } {
  return { rgb: [(value >>> 16) & 255, (value >>> 8) & 255, value & 255], alpha: value > 0xffffff ? ((value >>> 24) & 255) / 255 : 1 };
}

function imageSize(bytes: unknown, name: string): { width: number; height: number } {
  if (!(bytes instanceof Uint8Array) || bytes.length < 33 || [137, 80, 78, 71, 13, 10, 26, 10].some((value, index) => bytes[index] !== value) || String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR') fail(`${name} 不是 PNG 图片`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); const width = view.getUint32(16); const height = view.getUint32(20);
  if (!width || !height || width > NOTE_SKIN_LIMITS.dimension || height > NOTE_SKIN_LIMITS.dimension) fail(`${name} 的图片尺寸无效或过大`);
  return { width, height };
}

export function normalizeNoteSkinFiles(source: unknown): Map<string, Uint8Array> {
  if (!(source instanceof Map) || source.size > NOTE_SKIN_LIMITS.files) fail('文件数量超限');
  const input: Map<unknown, unknown> = source;
  const files = new Map<string, Uint8Array>(); let bytes = 0;
  for (const [path, value] of input) {
    if (typeof path !== 'string' || !path || path.startsWith('/') || path.includes('\\') || path.includes(':') || path.includes('\0') || path.split('/').some(part => part === '..' || part === '.')) fail('包中包含不安全路径');
    if (path.endsWith('/') || path.startsWith('__MACOSX/') || path.split('/').at(-1)?.startsWith('.')) continue;
    if (!(value instanceof Uint8Array) || value.length > NOTE_SKIN_LIMITS.fileBytes) fail('素材文件无效或过大');
    bytes += value.length; if (bytes > NOTE_SKIN_LIMITS.bytes) fail('资源包解压后过大');
    files.set(path, value);
  }
  const manifests = [...files.keys()].filter(path => /(^|\/)info\.ya?ml$/i.test(path));
  if (manifests.length !== 1) fail('资源包需要唯一的 info.yml');
  const manifest = manifests[0]; const prefix = manifest.slice(0, manifest.lastIndexOf('/') + 1);
  if (prefix && [...files.keys()].some(path => !path.startsWith(prefix))) fail('资源包包含皮肤目录以外的文件');
  const normalized = new Map<string, Uint8Array>();
  for (const [path, value] of files) {
    let name = path.slice(prefix.length);
    const lower = name.toLowerCase();
    if (NOTE_SKIN_IMAGES.includes(lower) || Object.values(NOTE_SKIN_SOUNDS).includes(lower) || lower === 'ending.ogg') name = lower;
    if (path === manifest) name = 'info.yml';
    if (normalized.has(name)) fail(`文件名重复：${name}`);
    normalized.set(name, value);
  }
  return normalized;
}

export function parseNoteSkin(source: unknown, id: string | null = null): NoteSkinRecord {
  const files = normalizeNoteSkinFiles(source); const images: Record<string, { width: number; height: number }> = {}; let pixels = 0;
  let text: string; try { text = new TextDecoder('utf-8', { fatal: true }).decode(files.get('info.yml')); } catch { fail('info.yml 需要 UTF-8 编码'); }
  const info = parseNoteSkinInfo(text);
  for (const name of NOTE_SKIN_IMAGES) {
    if (!files.has(name)) fail(`缺少 ${name}`);
    images[name] = imageSize(files.get(name), name); pixels += images[name].width * images[name].height;
  }
  if (pixels > NOTE_SKIN_LIMITS.pixels) fail('贴图总像素数过大');
  for (const [name, key] of [['hold.png', 'holdAtlas'], ['hold_mh.png', 'holdAtlasMH']] as const) if (info[key][0] + info[key][1] >= images[name].height) fail(`${key} 的头尾高度之和必须小于 ${name} 的高度`);
  if (info.hitFx[0] > images['hit_fx.png'].width || info.hitFx[1] > images['hit_fx.png'].height) fail('hitFx 帧数超出图片尺寸');
  const warnings: string[] = [];
  if (images['hit_fx.png'].width % info.hitFx[0] || images['hit_fx.png'].height % info.hitFx[1]) warnings.push('打击动画尺寸不能被帧数整除，将按等分区域读取');
  if (files.has('ending.ogg')) warnings.push('结算音乐保留在皮肤包中，编辑器不播放结算界面');
  const sounds = new Map<string, Uint8Array>();
  for (const [type, name] of Object.entries(NOTE_SKIN_SOUNDS)) { const data = files.get(name); if (data) sounds.set(type, data); }
  return { id, info, files, images, sounds, warnings, bytes: [...files.values()].reduce((sum, value) => sum + value.length, 0) };
}

export function noteSkinFrame(info: NoteSkinInfo, age: number): NoteSkinFrame | null {
  if (!Number.isFinite(age) || age < 0 || age >= info.hitFxDuration) return null;
  const count = info.hitFx[0] * info.hitFx[1]; const index = Math.min(count - 1, Math.floor(age / info.hitFxDuration * count));
  return { index, column: index % info.hitFx[0], row: Math.floor(index / info.hitFx[0]) };
}

export function holdSkinLayout(info: NoteSkinInfo, image: { width: number; height: number }, highlighted: boolean, head: number, tail: number, width: number, heightWidth = width): HoldSkinLayout {
  const [tailPixels, headPixels] = info[highlighted ? 'holdAtlasMH' : 'holdAtlas'];
  const scale = heightWidth / image.width; const headHeight = headPixels * scale; const tailHeight = tailPixels * scale;
  const length = Math.abs(tail - head); const direction = tail <= head ? 1 : -1;
  return { direction, length, scale, headHeight, tailHeight, bodyPixels: image.height - tailPixels - headPixels,
    headY: info.holdCompact ? -headHeight / 2 : 0,
    tailY: -length - (info.holdCompact ? tailHeight / 2 : tailHeight),
    bodyTop: -length, bodyHeight: length, tailPixels, headPixels };
}
