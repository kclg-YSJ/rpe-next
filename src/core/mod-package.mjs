import { parse } from './vendor/acorn.mjs';
import { parseShortcut } from './shortcut-spec.mjs';
import { isLocalizedMap, t } from '../i18n.mjs';

export const MOD_API_VERSION = 1;
export const MOD_LIMITS = Object.freeze({ files: 2048, bytes: 128 * 1024 * 1024, fileBytes: 32 * 1024 * 1024, codeBytes: 4 * 1024 * 1024 });
const identifier = /^[a-z][a-z0-9-]{0,63}$/;
const fail = message => { throw new Error(t('mod-package.s64b3ca6') + message); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
// Manifest text may be a plain string or a per-locale map
// (`{ "zh-CN": "…", "en-US": "…" }`), matching editor skins.
const textLimit = (value, limit, required = false) => isLocalizedMap(value)
  ? Object.keys(value).length > 0 && Object.values(value).every(text => typeof text === 'string' && text.length <= limit && (!required || text.trim()))
  : typeof value === 'string' && value.length <= limit && (!required || Boolean(value.trim()));
export function modPath(path) {
  if (typeof path !== 'string' || !path || path.length > 240 || /[\\:\x00-\x1f?#]/.test(path) || path.startsWith('/') || path.split('/').some(part => !part || part === '.' || part === '..')) fail(t('mod-package.saf5bc9e') + path);
  return path;
}
export function modManifest(source) {
  if (!object(source) || source.protocol !== 'rpen-mod' || source.api !== MOD_API_VERSION) fail(t('mod-package.s3dd952a'));
  if (!identifier.test(source.id)) fail(t('mod-package.sa8a8ec6'));
  for (const [key,limit] of [['name',100],['version',60],['author',160],['description',4000]]) if (!textLimit(source[key], limit, key === 'name' || key === 'version')) fail(key + t('mod-package.s6f488df'));
  if (!/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(source.version)) fail(t('mod-package.sdd67d4a'));
  modPath(source.entry); if (!/\.(m?js)$/.test(source.entry)) fail(t('mod-package.s9f26be6'));
  for (const key of ['dependencies','conflicts']) if (source[key] !== undefined && (!Array.isArray(source[key]) || source[key].length > 64 || source[key].some(id => !identifier.test(id) || id === source.id))) fail(key + t('mod-package.s499f31c'));
  if (source.settings !== undefined && (!object(source.settings) || Object.keys(source.settings).length > 100)) fail(t('mod-package.s1daf273'));
  for (const [key,definition] of Object.entries(source.settings ?? {})) {
    if (!identifier.test(key) || !object(definition) || !textLimit(definition.label, 120, true) || !['boolean','number','text','color','select','shortcut'].includes(definition.type)) fail(t('mod-package.s9a6842c') + key);
    if (definition.description !== undefined && !textLimit(definition.description, 2000)) fail(t('mod-package.s9a6842c') + key);
    if (definition.type === 'select' && (!object(definition.options) || !Object.keys(definition.options).length || Object.keys(definition.options).length>200 || Object.entries(definition.options).some(([key,label])=>key.length>2000||!textLimit(label,2000)))) fail(t('mod-package.sa9e55a1'));
    if (definition.type === 'number' && (!Number.isFinite(definition.min) || !Number.isFinite(definition.max) || definition.min > definition.max)) fail(t('mod-package.sce0b9c5'));
    if (definition.step!==undefined&&(!Number.isFinite(definition.step)||definition.step<=0))fail(t('mod-package.sc2ef5f2'));
    modSettingValue(definition,definition.default,key);
  }
  return { ...source, dependencies: [...new Set(source.dependencies ?? [])], conflicts: [...new Set(source.conflicts ?? [])], settings: source.settings ?? {} };
}
export function modSettingValue(definition,value,key='') {
  if(!definition)fail(t('mod-package.s3d58418')+key);
  if (definition.type === 'boolean' && typeof value !== 'boolean' || definition.type === 'number' && (!Number.isFinite(value) || value < definition.min || value > definition.max) || ['text','color','select','shortcut'].includes(definition.type) && (typeof value !== 'string' || value.length > 2000) || definition.type === 'color' && !/^#[\da-f]{6}$/i.test(value) || definition.type === 'select' && !Object.hasOwn(definition.options,value)) fail(t('mod-package.s11f8ea4') + key);
  if(definition.type==='shortcut'&&parseShortcut(value).error)fail(t('mod-package.s386d06a')+key);
  return value;
}
export function parseModPackage(source) {
  if (!(source instanceof Map) || source.size > MOD_LIMITS.files) fail(t('mod-package.s5f616ec'));
  let bytes=0;const entries=new Map();
  for (const [name,data] of source) {
    if (name.endsWith('/') || name.startsWith('__MACOSX/') || name.split('/').at(-1).startsWith('.')) continue;
    modPath(name);if (!(data instanceof Uint8Array) || data.length > MOD_LIMITS.fileBytes) fail(t('mod-package.s8558ea2') + name);
    bytes+=data.length;if(bytes>MOD_LIMITS.bytes)fail(t('mod-package.s2e0acb0'));entries.set(name,data);
  }
  const manifests=[...entries.keys()].filter(name=>name==='mod.json'||name.endsWith('/mod.json'));if(manifests.length!==1)fail('需要唯一的 mod.json');
  const prefix=manifests[0].slice(0,-8);if([...entries.keys()].some(name=>!name.startsWith(prefix)))fail(t('mod-package.s6a5f873'));
  const files=new Map([...entries].map(([name,data])=>[name.slice(prefix.length),data]));let manifest;
  try {manifest=modManifest(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(files.get('mod.json'))));}catch(error){fail('mod.json：'+error.message);}
  if (!files.has(manifest.entry)) fail(t('mod-package.sb37276a') + manifest.entry);
  for (const [name,data] of files) if (/\.(m?js)$/.test(name)) {
    if(data.length>MOD_LIMITS.codeBytes)fail(t('mod-package.sae1f583'));
    try {parse(new TextDecoder('utf-8',{fatal:true}).decode(data),{ecmaVersion:'latest',sourceType:'module'});} catch(error){fail(t('mod-package.s2ac621c', { p0: name, p1: error.message }));}
  }
  return {manifest,files,bytes};
}
export function resolveModImport(specifier,from,files,prefix,baseUrl) {
  if (typeof specifier !== 'string') fail(t('mod-package.sb383706'));
  if (specifier === '@rpen/api') return new URL('src/ui/mod-api.mjs',baseUrl).href;
  if (specifier.startsWith('@rpen/')) {const path=modPath(specifier.slice(6));if(!/^(core|application|platform|ui)\/.+\.mjs$/.test(path))fail(t('mod-package.scfa9164'));return new URL('src/'+path,baseUrl).href;}
  if (!specifier.startsWith('.')) {
    if(/^(https?:|data:|blob:)/.test(specifier))return specifier;
    fail(t('mod-package.s98f3600')+specifier+t('mod-package.sf680f5b'));
  }
  const parts=from.split('/').slice(0,-1);
  for(const part of specifier.split('/'))if(part==='..'){if(!parts.length)fail(t('mod-package.s7a53a67'));parts.pop();}else if(part!=='.'&&part)parts.push(part);
  const path=modPath(parts.join('/'));if(!files.has(path))fail(t('mod-package.sb780157')+path);
  if(!/\.(m?js|json)$/.test(path))fail(t('mod-package.se50d7c2'));
  return prefix+path;
}
export function rewriteModModule(source,path,resolve,loadId) {
  const ast=parse(source,{ecmaVersion:'latest',sourceType:'module'});const edits=[];
  const visit=node=>{
    if(!node||typeof node!=='object')return;
    if(['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration'].includes(node.type)&&node.source)edits.push([node.source.start,node.source.end,JSON.stringify(resolve(node.source.value,path))]);
    if(node.type==='ImportExpression'){
      if(node.source.type==='Literal')edits.push([node.source.start,node.source.end,JSON.stringify(resolve(node.source.value,path))]);
      else {edits.push([node.source.start,node.source.start,`globalThis.rpenMods.resolveModule(${JSON.stringify(loadId)},(`]);edits.push([node.source.end,node.source.end,`),${JSON.stringify(path)})`]);}
    }
    if(node.type==='MemberExpression'&&!node.computed&&node.object?.type==='MetaProperty'&&node.object.meta.name==='import'&&node.property?.name==='resolve')edits.push([node.start,node.end,`(specifier=>globalThis.rpenMods.resolveModule(${JSON.stringify(loadId)},specifier,${JSON.stringify(path)}))`]);
    for(const [key,value]of Object.entries(node))if(!['start','end','loc'].includes(key)){if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')visit(value);}
  };visit(ast);
  edits.sort((a,b)=>b[0]-a[0]||b[1]-a[1]);let rewritten=source;
  for(const [start,end,replacement]of edits)rewritten=rewritten.slice(0,start)+replacement+rewritten.slice(end);
  return rewritten;
}
