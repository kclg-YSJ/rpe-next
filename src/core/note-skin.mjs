import { load, dump, CORE_SCHEMA } from './vendor/js-yaml.mjs';
import { t } from '../i18n.mjs';

export const NOTE_SKIN_LIMITS = Object.freeze({ files: 256, bytes: 192 * 1024 * 1024, fileBytes: 48 * 1024 * 1024, pixels: 96 * 1024 * 1024, dimension: 16384 });
export const NOTE_SKIN_IMAGES = ['click.png', 'click_mh.png', 'drag.png', 'drag_mh.png', 'flick.png', 'flick_mh.png', 'hold.png', 'hold_mh.png', 'hit_fx.png'];
export const NOTE_SKIN_SOUNDS = Object.freeze({ tap: 'click.ogg', drag: 'drag.ogg', flick: 'flick.ogg' });
export const NOTE_SKIN_DEFAULTS = Object.freeze({ description: '', hitFxDuration: 0.5, hitFxScale: 1, hitFxRotate: false, hitFxTinted: true, hideParticles: false, holdKeepHead: false, holdRepeat: false, holdCompact: false, colorPerfect: 0xe1ffec9f, colorGood: 0xebb4e1ff });
const fail = message => { throw new Error(t('note-skin.s7ac4dd3') + message); };
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));

export function noteSkinInfo(source) {
  if (!plain(source)) fail(t('note-skin.see68a47'));
  const info = { ...NOTE_SKIN_DEFAULTS };
  for (const key of ['name','author','hitFx','holdAtlas','holdAtlasMH',...Object.keys(NOTE_SKIN_DEFAULTS)]) if (Object.hasOwn(source,key)) info[key]=source[key];
  for (const [key, limit] of [['name',100], ['author',200], ['description',4000]]) {
    if (typeof info[key] !== 'string' || info[key].length > limit || key === 'name' && !info[key].trim()) fail(t('note-skin.sd2c9ac4', { p0: key, p1: key === 'name' ? t('note-skin.s5cdf1b3') : '', p2: limit }));
  }
  for (const key of ['hitFx','holdAtlas','holdAtlasMH']) {
    const minimum = key === 'hitFx' ? 1 : 0;
    if (!Array.isArray(info[key]) || info[key].length !== 2 || !info[key].every(value => Number.isInteger(value) && value >= minimum && value <= 65535)) fail(t('note-skin.sf82447d', { p0: key, p1: minimum ? t('note-skin.sb67ca11') : t('note-skin.s404f4fe') }));
    info[key] = [...info[key]];
  }
  if (info.hitFx[0] * info.hitFx[1] > 10240) fail(t('note-skin.s7783d84'));
  for (const key of ['hitFxDuration','hitFxScale']) if (!Number.isFinite(info[key]) || info[key] <= 0 || info[key] > (key === 'hitFxDuration' ? 120 : 64)) fail(t('note-skin.s2f6567c', { p0: key }));
  for (const key of ['hitFxRotate','hitFxTinted','hideParticles','holdKeepHead','holdRepeat','holdCompact']) if (typeof info[key] !== 'boolean') fail(t('note-skin.s7d24ed9', { p0: key }));
  for (const key of ['colorPerfect','colorGood']) {
    if (typeof info[key] === 'string' && /^(?:0x|#)[\da-f]{6}(?:[\da-f]{2})?$/i.test(info[key])) info[key] = parseInt(info[key].replace(/^(0x|#)/i,''),16);
    if (!Number.isInteger(info[key]) || info[key] < 0 || info[key] > 0xffffffff) fail(t('note-skin.s3719b02', { p0: key }));
  }
  return info;
}

export function parseNoteSkinInfo(text) {
  if (typeof text !== 'string' || text.length > 65536) fail(t('note-skin.sfb815fb'));
  let source;
  try { source = load(text.replace(/^\uFEFF/,''), { schema: CORE_SCHEMA }); }
  catch (error) { fail(t('note-skin.s5aa131b') + error.message); }
  return noteSkinInfo(source);
}

export function serializeNoteSkinInfo(info) {
  return dump(noteSkinInfo(info), { schema: CORE_SCHEMA, noRefs: true, lineWidth: 100, sortKeys: false });
}

export function noteSkinColor(value) {
  return { rgb: [(value >>> 16) & 255, (value >>> 8) & 255, value & 255], alpha: value > 0xffffff ? ((value >>> 24) & 255) / 255 : 1 };
}

function imageSize(bytes, name) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 33 || [137,80,78,71,13,10,26,10].some((value,index) => bytes[index] !== value) || String.fromCharCode(...bytes.subarray(12,16)) !== 'IHDR') fail(t('note-skin.sb147c52', { p0: name }));
  const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength); const width = view.getUint32(16); const height = view.getUint32(20);
  if (!width || !height || width > NOTE_SKIN_LIMITS.dimension || height > NOTE_SKIN_LIMITS.dimension) fail(t('note-skin.s2844a32', { p0: name }));
  return {width,height};
}

export function normalizeNoteSkinFiles(source) {
  if (!(source instanceof Map) || source.size > NOTE_SKIN_LIMITS.files) fail(t('note-skin.s5f616ec'));
  const files = new Map(); let bytes = 0;
  for (const [path,value] of source) {
    if (typeof path !== 'string' || !path || path.startsWith('/') || path.includes('\\') || path.includes(':') || path.includes('\0') || path.split('/').some(part => part === '..' || part === '.')) fail(t('note-skin.s25bc6a8'));
    if (path.endsWith('/') || path.startsWith('__MACOSX/') || path.split('/').at(-1).startsWith('.')) continue;
    if (!(value instanceof Uint8Array) || value.length > NOTE_SKIN_LIMITS.fileBytes) fail(t('note-skin.s7aff15f'));
    bytes += value.length; if (bytes > NOTE_SKIN_LIMITS.bytes) fail(t('note-skin.s41cf753'));
    files.set(path,value);
  }
  const manifests = [...files.keys()].filter(path => /(^|\/)info\.ya?ml$/i.test(path));
  if (manifests.length !== 1) fail(t('note-skin.sdaaa7bd'));
  const manifest = manifests[0]; const prefix = manifest.slice(0,manifest.lastIndexOf('/')+1);
  if (prefix && [...files.keys()].some(path=>!path.startsWith(prefix))) fail(t('note-skin.s4184c64'));
  const normalized = new Map();
  for (const [path,value] of files) {
    let name = path.slice(prefix.length);
    const lower = name.toLowerCase();
    if (NOTE_SKIN_IMAGES.includes(lower) || Object.values(NOTE_SKIN_SOUNDS).includes(lower) || lower === 'ending.ogg') name = lower;
    if (path === manifest) name = 'info.yml';
    if (normalized.has(name)) fail(t('note-skin.sd831117', { p0: name }));
    normalized.set(name,value);
  }
  return normalized;
}

export function parseNoteSkin(source, id = null) {
  const files = normalizeNoteSkinFiles(source); const images = {}; let pixels = 0;
  let text; try { text = new TextDecoder('utf-8',{fatal:true}).decode(files.get('info.yml')); } catch { fail(t('note-skin.s43436e9')); }
  const info = parseNoteSkinInfo(text);
  for (const name of NOTE_SKIN_IMAGES) {
    if (!files.has(name)) fail(t('note-skin.s0da5507', { p0: name }));
    images[name] = imageSize(files.get(name),name); pixels += images[name].width * images[name].height;
  }
  if (pixels > NOTE_SKIN_LIMITS.pixels) fail(t('note-skin.s549cb9c'));
  for (const [name,key] of [['hold.png','holdAtlas'],['hold_mh.png','holdAtlasMH']]) if (info[key][0]+info[key][1] >= images[name].height) fail(t('note-skin.seef0596', { p0: key, p1: name }));
  if (info.hitFx[0] > images['hit_fx.png'].width || info.hitFx[1] > images['hit_fx.png'].height) fail(t('note-skin.s0802cc2'));
  const warnings = [];
  if (images['hit_fx.png'].width % info.hitFx[0] || images['hit_fx.png'].height % info.hitFx[1]) warnings.push(t('note-skin.s8a49e62'));
  if (files.has('ending.ogg')) warnings.push(t('note-skin.sb52dcc1'));
  const sounds = new Map(Object.entries(NOTE_SKIN_SOUNDS).filter(([,name])=>files.has(name)).map(([type,name])=>[type,files.get(name)]));
  return { id, info, files, images, sounds, warnings, bytes:[...files.values()].reduce((sum,value)=>sum+value.length,0) };
}

export function noteSkinFrame(info, age) {
  if (!Number.isFinite(age) || age < 0 || age >= info.hitFxDuration) return null;
  const count = info.hitFx[0]*info.hitFx[1]; const index = Math.min(count-1,Math.floor(age/info.hitFxDuration*count));
  return {index,column:index%info.hitFx[0],row:Math.floor(index/info.hitFx[0])};
}

export function holdSkinLayout(info, image, highlighted, head, tail, width, heightWidth = width, zeroDirection = 1) {
  const [tailPixels,headPixels] = info[highlighted ? 'holdAtlasMH' : 'holdAtlas'];
  const scale = heightWidth / image.width; const headHeight = headPixels * scale; const tailHeight = tailPixels * scale;
  // Coincident endpoints cannot tell above from below, so retain the caller's side.
  const length = Math.abs(tail-head); const direction = length === 0 ? zeroDirection : tail < head ? 1 : -1;
  // Separate the caps when the body collapses so neither texture covers the other.
  const compact = info.holdCompact && length > 0;
  return {direction,length,scale,headHeight,tailHeight,bodyPixels:image.height-tailPixels-headPixels,
    headY:compact ? -headHeight/2 : 0,
    tailY:-length-(compact ? tailHeight/2 : tailHeight),
    bodyTop:-length,bodyHeight:length,tailPixels,headPixels};
}
