const identity = [0, 0, 1, 1];
export function noisePadding(spec = 32, width, height) {
  const value = typeof spec === 'number' ? { pixels: spec } : spec;
  return [Math.ceil((value.pixels ?? 0) + width * (value.screenWidth ?? 0)), Math.ceil((value.pixels ?? 0) + height * (value.screenHeight ?? 0))];
}
export function noiseTargetFrame(width, height, logicalWidth, logicalHeight, padding) {
  const x = Math.ceil(padding[0] * logicalWidth / width), y = Math.ceil(padding[1] * logicalHeight / height);
  const size = [logicalWidth + 2 * x, logicalHeight + 2 * y];
  return { size, padding: [x, y], logicalSize: [logicalWidth, logicalHeight], logicalTexelSize: [1 / logicalWidth, 1 / logicalHeight],
    sampleRect: x || y ? [x / size[0], y / size[1], logicalWidth / size[0], logicalHeight / size[1]] : identity,
    outputRect: x || y ? [-x / logicalWidth, -y / logicalHeight, size[0] / logicalWidth, size[1] / logicalHeight] : identity };
}
export const NOISE_SAMPLER_PREFIX = 'rpenGuardSampler_';
export const NOISE_RECT_PREFIX = 'rpenGuardRect_';

// Sampler aliases expand *after* macro argument collection. Thus texture helper
// functions and macros both carry the sampling rectangle alongside the sampler.
export function paddedNoiseShader(source) {
  // Derive UV from integer pixel centres, rather than interpolating a larger
  // quad. Otherwise floor/nearest reads can jump one texel when padding changes.
  const hasUV = /\bvarying\s+(?:(?:lowp|mediump|highp)\s+)?vec2\s+uv\s*;/.test(source);
  if (hasUV) source = source.replace(/\bvarying\s+(?:(?:lowp|mediump|highp)\s+)?vec2\s+uv\s*;/, 'highp vec2 uv;')
    .replace(/\bvoid\s+main\s*\(\s*(?:void\s*)?\)/, 'void rpenGuardMain()');
  const tokens = [...source.matchAll(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|^[ \t]*#[^\r\n]*(?:\\\r?\n[^\r\n]*)*|[A-Za-z_]\w*|[^\s]/gm)]
    .filter(match => !/^\s*#|^\/\*|^\/\//.test(match[0])).map(match => ({ text: match[0], start: match.index, end: match.index + match[0].length }));
  const edits = [], globals = new Set(), declarations = new Map();
  const insert = (at, text, priority = 0) => edits.push({ start: at, end: at, text, priority });
  const define = names => [...names].map(name => `#define ${name} ${NOISE_SAMPLER_PREFIX}${name}, ${NOISE_RECT_PREFIX}${name}\n`).join('');
  const undefine = names => [...names].map(name => `#undef ${name}\n`).join('');
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i].text !== 'sampler2D') continue;
    const name = tokens[i + 1], before = tokens[i - 1]?.text, uniform = before === 'uniform' || /^(lowp|mediump|highp)$/.test(before) && tokens[i - 2]?.text === 'uniform';
    declarations.set(i + 1, { name: name.text, uniform });
    edits.push({ start: name.start, end: name.end, text: NOISE_SAMPLER_PREFIX + name.text + (uniform ? '' : `, highp vec4 ${NOISE_RECT_PREFIX}${name.text}`) });
    if (uniform) {
      globals.add(name.text); let end = i + 2; while (end < tokens.length && tokens[end].text !== ';') end++;
      if (tokens[end]) insert(tokens[end].end, `\nuniform highp vec4 ${NOISE_RECT_PREFIX}${name.text};\n`);
    }
  }
  const pairs = new Map(), parentheses = [], braces = [];
  for (let i = 0; i < tokens.length; i++) {
    const value = tokens[i].text;
    if (value === '(') parentheses.push(i); else if (value === ')') { const start = parentheses.pop(); pairs.set(i, start); pairs.set(start, i); }
    if (value === '{') braces.push(i); else if (value === '}') { const start = braces.pop(); pairs.set(start, i); }
  }
  let firstGlobal = tokens.find(token => token.text === 'uniform')?.start ?? 0;
  const type = word => /^(?:float|int|uint|bool|[biu]?vec[234]|mat[234](?:x[234])?)$/.test(word);
  // Functions get a lexical alias set; ordinary parameters may shadow a global
  // sampler name, and sampler parameters can shadow it with a different binding.
  for (let i = 0, depth = 0; i < tokens.length; i++) {
    const value = tokens[i].text;
    if (value === '{' && depth++ === 0 && tokens[i - 1]?.text === ')') {
      const opening = pairs.get(i - 1), closing = pairs.get(i); if (opening === undefined || closing === undefined) continue;
      let start = opening - 2; while (start > 0 && /^(lowp|mediump|highp)$/.test(tokens[start - 1].text)) start--;
      firstGlobal = Math.min(firstGlobal, tokens[start].start);
      const names = new Set(globals), parameters = new Set();
      for (let j = opening + 1; j < i - 1; j++) {
        const declaration = declarations.get(j);
        if (declaration) { parameters.add(declaration.name); names.add(declaration.name); }
        else if (/^(?:float|int|bool|[biu]?vec[234]|mat[234])$/.test(tokens[j - 1]?.text)) names.delete(tokens[j].text);
      }
      insert(tokens[start].start, '\n' + undefine(globals), 1); insert(tokens[i].end, '\n' + define(names), -1);
      insert(tokens[closing].start, '\n' + undefine(new Set([...globals, ...parameters])), 1); insert(tokens[closing].end, '\n' + define(globals), -1);
      // A local variable may shadow a uniform or sampler argument. Its macro
      // alias must follow the same lexical scope, including nested blocks.
      const scopes = [{ end: closing, names }];
      for (let j = i + 1; j < closing; j++) {
        if (j === scopes.at(-1).end) {
          const previous = scopes.pop(), parent = scopes.at(-1);
          if (parent) insert(tokens[j].end, '\n' + define([...parent.names].filter(name => !previous.names.has(name))), -1);
        }
        if (tokens[j].text === '{') scopes.push({ end: pairs.get(j), names: new Set(scopes.at(-1).names) });
        const scope = scopes.at(-1), name = tokens[j].text;
        if (type(tokens[j - 1]?.text) && scope.names.has(name)) {
          insert(tokens[j].start, '\n' + undefine([name]), 1); scope.names.delete(name);
        }
      }
    } else if (value === '}') depth--;
    else if (depth === 0 && value === ';' && tokens[i - 1]?.text === ')') {
      const opening = pairs.get(i - 1);
      if (opening !== undefined && tokens[opening - 2]?.text !== '=') {
        let start = opening - 2; while (start > 0 && /^(lowp|mediump|highp)$/.test(tokens[start - 1].text)) start--;
        if (type(tokens[start]?.text) || tokens[start]?.text === 'void') {
          firstGlobal = Math.min(firstGlobal, tokens[start].start);
          insert(tokens[start].start, '\n' + undefine(globals), 1); insert(tokens[i].end, '\n' + define(globals), -1);
        }
      }
    }
  }
  // Global aliases can be declared first: declarations use the renamed sampler.
  insert(firstGlobal, '\n' + define(globals), -2);
  for (const edit of edits.sort((a, b) => b.start - a.start || b.end - a.end || (b.priority ?? 0) - (a.priority ?? 0))) source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  const helpers = `
uniform highp vec2 rpenGuardOrigin;
uniform highp vec2 rpenGuardLogicalSize;
vec4 rpenGuardFragment(){return vec4(gl_FragCoord.xy-rpenGuardOrigin,gl_FragCoord.zw);}
vec4 rpenGuardSample(sampler2D s,vec4 r,vec2 p){return texture(s,r.xy+p*r.zw);}
vec4 rpenGuardSample(sampler2D s,vec4 r,vec2 p,float b){return texture(s,r.xy+p*r.zw,b);}
vec4 rpenGuardProj(sampler2D s,vec4 r,vec3 p){return rpenGuardSample(s,r,p.xy/p.z);}
vec4 rpenGuardProj(sampler2D s,vec4 r,vec4 p){return rpenGuardSample(s,r,p.xy/p.w);}
vec4 rpenGuardProj(sampler2D s,vec4 r,vec3 p,float b){return rpenGuardSample(s,r,p.xy/p.z,b);}
vec4 rpenGuardProj(sampler2D s,vec4 r,vec4 p,float b){return rpenGuardSample(s,r,p.xy/p.w,b);}
ivec2 rpenGuardSize(sampler2D s,vec4 r,int l){return ivec2(round(vec2(textureSize(s,l))*r.zw));}
vec4 rpenGuardFetch(sampler2D s,vec4 r,ivec2 p,int l){return texelFetch(s,p+ivec2(round(r.xy*vec2(textureSize(s,l)))),l);}
vec4 rpenGuardLod(sampler2D s,vec4 r,vec2 p,float l){return textureLod(s,r.xy+p*r.zw,l);}
vec4 rpenGuardGrad(sampler2D s,vec4 r,vec2 p,vec2 x,vec2 y){return textureGrad(s,r.xy+p*r.zw,x*r.zw,y*r.zw);}
#define gl_FragCoord rpenGuardFragment()
#define texture rpenGuardSample
#define textureProj rpenGuardProj
#define textureSize rpenGuardSize
#define texelFetch rpenGuardFetch
#define textureLod rpenGuardLod
#define textureGrad rpenGuardGrad
`;
  // Helpers precede aliases, and precision must precede their float uniforms.
  source = source.replace(/^\s*#version[^\n]*(?:\n|$)/m, '');
  return 'precision highp float;\n' + helpers + source + (hasUV ? '\nvoid main(){uv=rpenGuardFragment().xy/rpenGuardLogicalSize;rpenGuardMain();}\n' : '');
}
