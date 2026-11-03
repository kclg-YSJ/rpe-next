import { defaultShaderUniform } from '../core/shader.mjs';

const VERTEX_SOURCE = `
attribute vec2 a_position;
attribute vec2 a_texCoord;
varying vec2 v_texCoord;
varying vec4 v_fragmentColor;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord = a_texCoord;
  v_fragmentColor = vec4(1.0);
}`;

const OVERFLOW_FILTER_SOURCE = `precision mediump float;
varying vec2 uv;
uniform sampler2D screenTexture;
uniform vec2 filterDirection;
uniform float filterBrightness;
uniform vec2 filterKeepMin;
uniform vec2 filterKeepMax;
void main() {
  if (filterKeepMax.x > filterKeepMin.x && uv.x >= filterKeepMin.x && uv.x <= filterKeepMax.x && uv.y >= filterKeepMin.y && uv.y <= filterKeepMax.y) {
    gl_FragColor = texture2D(screenTexture, uv); return;
  }
  vec4 result = texture2D(screenTexture, uv) * 0.199676;
  result += (texture2D(screenTexture, uv + filterDirection * 0.5) + texture2D(screenTexture, uv - filterDirection * 0.5)) * 0.176213;
  result += (texture2D(screenTexture, uv + filterDirection) + texture2D(screenTexture, uv - filterDirection)) * 0.121109;
  result += (texture2D(screenTexture, uv + filterDirection * 1.5) + texture2D(screenTexture, uv - filterDirection * 1.5)) * 0.064826;
  result += (texture2D(screenTexture, uv + filterDirection * 2.0) + texture2D(screenTexture, uv - filterDirection * 2.0)) * 0.027023;
  result += (texture2D(screenTexture, uv + filterDirection * 2.5) + texture2D(screenTexture, uv - filterDirection * 2.5)) * 0.008773;
  result += (texture2D(screenTexture, uv + filterDirection * 3.0) + texture2D(screenTexture, uv - filterDirection * 3.0)) * 0.002218;
  gl_FragColor = vec4(result.rgb * filterBrightness, result.a);
}`;

const COPY_SOURCE = `precision mediump float;
varying vec2 uv;
uniform sampler2D screenTexture;
void main(){gl_FragColor=texture2D(screenTexture,uv);}`;

const OVERFLOW_COMPOSE_SOURCE = `precision mediump float;
varying vec2 uv;
uniform sampler2D screenTexture;
uniform sampler2D overflowTexture;
uniform vec2 filterKeepMin;
uniform vec2 filterKeepMax;
void main(){
  if(uv.x>=filterKeepMin.x&&uv.x<=filterKeepMax.x&&uv.y>=filterKeepMin.y&&uv.y<=filterKeepMax.y)gl_FragColor=texture2D(screenTexture,uv);
  else gl_FragColor=texture2D(overflowTexture,uv);
}`;

const OVERLAY_SOURCE = `precision mediump float;
varying vec2 uv;
uniform sampler2D screenTexture;
uniform sampler2D overlayTexture;
void main(){
  vec4 back=texture2D(screenTexture,uv),front=texture2D(overlayTexture,uv);
  float alpha=front.a+back.a*(1.0-front.a);
  gl_FragColor=vec4((front.rgb*front.a+back.rgb*back.a*(1.0-front.a))/max(alpha,0.00001),alpha);
}`;

export function fragmentSource(source, webgl2 = false, overflow = false) {
  const portable = /uniform\s+sampler2D\s+screenTexture\b/.test(source);
  const origin = portable ? 'vec2(0.0)' : 'vec2(0.0, 0.0333)';
  const size = portable ? 'vec2(1.0)' : 'vec2(0.7031, 1.0 / 1.2)';
  const coordinate = portable ? 'uv' : 'v_texCoord';
  let body = source.replace(/^\s*#version[^\n]*\n/, '').replaceAll('CC_Texture0', 'u_texture')
    .replace(/\bscreenTexture\b/g, 'u_texture').replace(/\bscreenSize\b/g, 'resolution');
  body = body.replace(/uniform\s+sampler2D\s+u_texture\s*;/g, '');
  body = body.replace(/gl_FragCoord\.xy/g, '((v_texCoord - rpeRectMin) / (rpeRectMax - rpeRectMin) * resolution)');
  if (portable) body = body.replace(/\btime\b/g, 'u_time');
  body = body.replace(new RegExp(`varying\\s+(?:(?:lowp|mediump|highp)\\s+)?vec2\\s+${coordinate}\\s*;`), '')
    .replace(new RegExp(`\\b${coordinate}\\b`, 'g'), 'rpeCoordinate')
    .replace(/\btexture2DProj\s*\(/g, 'rpeSampleProj(').replace(/\btexture2D\s*\(/g, 'rpeSample(')
    .replace(/void\s+main\s*\(\s*(?:void)?\s*\)/, 'void rpeMain()');
  if (!portable) body = body.replace(/const\s+vec2\s+rectMin\s*=\s*vec2\([^;]+\);/, `const vec2 rectMin = ${origin};`)
    .replace(/const\s+vec2\s+rectMax\s*=\s*vec2\([^;]+\);/, `const vec2 rectMax = ${origin} + ${size};`);
  const adapted = `precision mediump float;
uniform sampler2D u_texture;
${overflow ? 'uniform sampler2D rpenOverflowTexture;' : ''}
varying vec2 v_texCoord;
uniform vec2 rpeRectMin;
uniform vec2 rpeRectMax;
vec2 rpeCoordinate;
vec4 rpeSample(sampler2D source, vec2 coordinate) {
  vec2 local = (coordinate - ${origin}) / ${size};
  if (local.x < 0.0 || local.x > 1.0 || local.y < 0.0 || local.y > 1.0) return vec4(0.0);
  return texture2D(source, mix(rpeRectMin, rpeRectMax, local));
}
vec4 rpeSampleProj(sampler2D source, vec4 coordinate) { return rpeSample(source, coordinate.xy / coordinate.w); }
vec4 rpeSampleProj(sampler2D source, vec3 coordinate) { return rpeSample(source, coordinate.xy / coordinate.z); }
${body}
void main() {
  if (v_texCoord.x < rpeRectMin.x || v_texCoord.x > rpeRectMax.x || v_texCoord.y < rpeRectMin.y || v_texCoord.y > rpeRectMax.y) gl_FragColor = ${overflow ? 'texture2D(rpenOverflowTexture, v_texCoord)' : 'vec4(0.0)'};
  else {
    rpeCoordinate = ${origin} + (v_texCoord - rpeRectMin) / (rpeRectMax - rpeRectMin) * ${size};
    rpeMain();
  }
}
`;
  return webgl2 ? '#version 300 es\n' + adapted.replace(/varying\b/g, 'in').replace(/gl_FragColor\b/g, 'rpeFragColor')
    .replace(/texture2D\b/g, 'texture').replace('uniform sampler2D u_texture;', 'out vec4 rpeFragColor;\nuniform sampler2D u_texture;') : adapted;
}

export function shaderViewport(view, width, height) {
  return { min: [view.left / width, 1 - (view.top + view.height) / height], max: [(view.left + view.width) / width, 1 - view.top / height] };
}

export function shaderDefaults(source) {
  return Object.fromEntries([...source.matchAll(/uniform\s+\w+\s+(\w+)\s*;[^\r\n%]*%([^%\r\n]+)%/g)].map(([, name, value]) => {
    const numbers = value.split(',').map(Number); return [name, numbers.length === 1 ? numbers[0] : numbers];
  }).filter(([, value]) => (Array.isArray(value) ? value : [value]).every(Number.isFinite)));
}

function normaliseUniformValue(name, value) {
  if (!Array.isArray(value)) return value;
  const result = value.map(Number);
  if (result.length === 4 && (name === 'color' || name.endsWith('Color') || result.some(entry => Math.abs(entry) > 1))) {
    if (result.some(entry => Math.abs(entry) > 1)) return result.map(entry => entry / 255);
  }
  return result;
}

export class ShaderPipeline {
  dispose() {
    this.gl?.getExtension('WEBGL_lose_context')?.loseContext();
    if (this.canvas) this.canvas.width = this.canvas.height = 1;
    this.programs.clear(); this.gl = null; this.canvas = null; this.sourceTexture = this.pingTexture = this.pongTexture = this.framebuffer = this.buffer = null;
  }
  constructor(invalidate = () => {}) { this.invalidate = invalidate; this.gl = null; this.canvas = null; this.programs = new Map(); this.sourceTexture = null; this.pingTexture = null; this.pongTexture = null; this.framebuffer = null; this.buffer = null; this.disabled = false; }

  ensure(canvas) {
    if (this.canvas === canvas && this.gl) return true;
    this.canvas = canvas;
    try {
      const options = { alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: false };
      this.gl = canvas.getContext('webgl2', options); this.webgl2 = Boolean(this.gl);
      this.gl ??= canvas.getContext('webgl', options);
    }
    catch { this.gl = null; }
    if (!this.gl) { this.disabled = true; return false; }
    const gl = this.gl;
    this.buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 0, 0, 1, -1, 1, 0, -1, 1, 0, 1, 1, 1, 1, 1]), gl.STATIC_DRAW);
    this.sourceTexture = gl.createTexture(); this.pingTexture = gl.createTexture(); this.pongTexture = gl.createTexture(); this.framebuffer = gl.createFramebuffer();
    for (const texture of [this.sourceTexture, this.pingTexture, this.pongTexture]) this.configureTexture(texture);
    return true;
  }

  configureTexture(texture) {
    const gl = this.gl; gl.bindTexture(gl.TEXTURE_2D, texture); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  resizeTexture(texture, width, height) {
    const gl = this.gl; gl.bindTexture(gl.TEXTURE_2D, texture); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  }

  compile(name, source, overflow = false) {
    const key = overflow ? '\0overflow\n' + source : source;
    if (this.programs.has(key)) return this.programs.get(key);
    const gl = this.gl; const vertex = gl.createShader(gl.VERTEX_SHADER); const fragment = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(vertex, this.webgl2 ? '#version 300 es\n' + VERTEX_SOURCE.replace(/attribute\b/g, 'in').replace(/varying\b/g, 'out') : VERTEX_SOURCE); gl.compileShader(vertex);
    gl.shaderSource(fragment, fragmentSource(source, this.webgl2, overflow)); gl.compileShader(fragment);
    if (!gl.getShaderParameter(vertex, gl.COMPILE_STATUS) || !gl.getShaderParameter(fragment, gl.COMPILE_STATUS)) { this.lastError = gl.getShaderInfoLog(vertex) + gl.getShaderInfoLog(fragment); gl.deleteShader(vertex); gl.deleteShader(fragment); return null; }
    const program = gl.createProgram(); gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program); gl.deleteShader(vertex); gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { this.lastError = gl.getProgramInfoLog(program); gl.deleteProgram(program); return null; }
    const uniforms = new Map(); const types = new Map();
    for (let index = 0; index < gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS); index++) { const info = gl.getActiveUniform(program, index); const name = info.name.replace(/\[0\]$/, ''); uniforms.set(name, gl.getUniformLocation(program, info.name)); types.set(name, info.type); }
    const defaults = shaderDefaults(source);
    const attributes = { position: gl.getAttribLocation(program, 'a_position'), texCoord: gl.getAttribLocation(program, 'a_texCoord') };
    const result = { program, uniforms, types, defaults, attributes }; this.programs.set(key, result); return result;
  }

  setUniforms(result, values, seconds, width, height, rect, resolution) {
    const gl = this.gl;
    const set = (name, value) => {
      const location = result.uniforms.get(name); if (location === null || location === undefined) return;
      let normalised = normaliseUniformValue(name, value);
      if (result.types.get(name) === gl.FLOAT && Array.isArray(normalised)) normalised = normalised[0];
      if ([gl.SAMPLER_2D, gl.INT, gl.BOOL].includes(result.types.get(name))) { gl.uniform1i(location, Number(normalised) || 0); return; }
      if (Array.isArray(normalised)) {
        if (normalised.length === 2) gl.uniform2fv(location, normalised);
        else if (normalised.length === 3) gl.uniform3fv(location, normalised);
        else if (normalised.length === 4) gl.uniform4fv(location, normalised);
        else if (normalised.length === 1) gl.uniform1f(location, normalised[0]);
      } else if (typeof normalised === 'number' && Number.isFinite(normalised)) gl.uniform1f(location, normalised);
    };
    set('u_texture', 0); set('u_time', seconds); set('resolution', resolution ?? [1350, 900]); set('rpeRectMin', rect?.min ?? [0, 0]); set('rpeRectMax', rect?.max ?? [1, 1]);
    for (const [name, location] of result.uniforms) {
      if (['u_texture', 'u_time', 'resolution', 'rpeRectMin', 'rpeRectMax'].includes(name)) continue;
      const fallback = name === 'offset' && result.types.get(name) === gl.FLOAT_VEC2 ? [0, 0] : defaultShaderUniform(name, resolution);
      set(name, values[name] ?? result.defaults[name] ?? fallback);
    }
  }

  drawQuad(result, inputTexture, framebuffer, values, seconds, width, height, rect, resolution) {
    const gl = this.gl; gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer); gl.viewport(0, 0, width, height); gl.useProgram(result.program); gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    const { position, texCoord } = result.attributes;
    if (position >= 0) { gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 16, 0); }
    if (texCoord >= 0) { gl.enableVertexAttribArray(texCoord); gl.vertexAttribPointer(texCoord, 2, gl.FLOAT, false, 16, 8); }
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, inputTexture); this.setUniforms(result, values, seconds, width, height, rect, resolution); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  prepareOverflowFilter(input, width, height, seconds, resolution, filter, passes, sourceFor) {
    const blur = Math.max(0, filter.blur), ratio = blur > 0 ? Math.min(1, 8 / Math.max(8, blur), Math.sqrt(480000 / (width * height))) : 1;
    const textureWidth = filter.sourceCanvas?.width ?? Math.max(1, Math.round(width * ratio)), textureHeight = filter.sourceCanvas?.height ?? Math.max(1, Math.round(height * ratio));
    const gl = this.gl, copy = this.compile('overflow-copy', COPY_SOURCE), smooth = this.compile('overflow-filter', OVERFLOW_FILTER_SOURCE);
    if (!copy || !smooth) return null;
    if (!this.overflowTextures) {
      this.overflowTextures = Array.from({ length: 3 }, () => gl.createTexture());
      this.overflowInputTexture = gl.createTexture(); this.configureTexture(this.overflowInputTexture);
      this.overflowOverlayTexture = gl.createTexture(); this.configureTexture(this.overflowOverlayTexture);
      for (const texture of this.overflowTextures) this.configureTexture(texture);
    }
    if (this.overflowWidth !== textureWidth || this.overflowHeight !== textureHeight) {
      for (const texture of [...this.overflowTextures, this.overflowInputTexture, this.overflowOverlayTexture]) this.resizeTexture(texture, textureWidth, textureHeight);
      this.overflowUploadRevision = undefined;
      this.overflowFilteredRevision = undefined;
      this.overflowWidth = textureWidth; this.overflowHeight = textureHeight;
    }
    const fullRect = { min: [0, 0], max: [1, 1] };
    const drawTo = (program, source, target, values) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
      this.drawQuad(program, source, this.framebuffer, values, seconds, textureWidth, textureHeight, fullRect, resolution);
    };
    const [small, horizontal, filtered] = this.overflowTextures;
    if (filter.sourceCanvas && this.overflowFilteredRevision === filter.sourceRevision && this.overflowFilteredSource === filter.sourceCanvas && this.overflowFilterBlur === blur && this.overflowFilterBrightness === filter.brightness) return filtered;
    let lowInput = small;
    const extraResolution = filter.resolution ?? resolution;
    if (filter.sourceCanvas) {
      if (this.overflowUploadRevision !== filter.sourceRevision || this.overflowUploadSource !== filter.sourceCanvas) {
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.overflowInputTexture);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, filter.sourceCanvas);
        if (filter.overlayCanvas) { gl.bindTexture(gl.TEXTURE_2D, this.overflowOverlayTexture); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, filter.overlayCanvas); }
        this.overflowUploadRevision = filter.sourceRevision; this.overflowUploadSource = filter.sourceCanvas;
      }
      lowInput = this.overflowInputTexture;
      let output = small;
      const effects = filter.effects ?? passes;
      const stages = [...effects.filter(pass => !pass.global), ...(filter.overlayCanvas ? [null] : []), ...effects.filter(pass => pass.global)];
      for (const pass of stages) {
        if (!pass) {
          const overlay = this.compile('overflow-overlay', OVERLAY_SOURCE);
          if (overlay) {
            gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.overflowOverlayTexture);
            drawTo(overlay, lowInput, output, { overlayTexture: 1 });
            lowInput = output; output = output === small ? horizontal : small;
          }
          continue;
        }
        const source = sourceFor(pass), program = source && this.compile(pass.shader, source);
        if (program) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, output, 0);
          this.drawQuad(program, lowInput, this.framebuffer, pass.values, seconds, textureWidth, textureHeight, fullRect, extraResolution);
          lowInput = output; output = output === small ? horizontal : small;
        }
      }
    } else drawTo(copy, input, small, {});
    const keep = { filterKeepMin: [0, 0], filterKeepMax: [0, 0] };
    const temporary = lowInput === horizontal ? small : horizontal;
    drawTo(smooth, lowInput, temporary, { ...keep, filterDirection: [blur / width, 0], filterBrightness: 1 });
    drawTo(smooth, temporary, filtered, { ...keep, filterDirection: [0, blur / height], filterBrightness: filter.brightness });
    this.overflowFilteredRevision = filter.sourceRevision; this.overflowFilteredSource = filter.sourceCanvas;
    this.overflowFilterBlur = blur; this.overflowFilterBrightness = filter.brightness;
    return filtered;
  }

  drawOverflowFilter(input, width, height, seconds, rect, resolution, filter, passes, sourceFor) {
    const filtered = this.prepareOverflowFilter(input, width, height, seconds, resolution, filter, passes, sourceFor);
    const compose = filtered && this.compile('overflow-compose', OVERFLOW_COMPOSE_SOURCE);
    if (!compose) return false;
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, filtered);
    this.drawQuad(compose, input, null, { filterKeepMin: rect.min, filterKeepMax: rect.max, overflowTexture: 1 }, seconds, width, height, { min: [0, 0], max: [1, 1] }, resolution);
    this.filterApplied = true;
    return true;
  }

  render(sourceCanvas, targetCanvas, passes, seconds, sourceFor, viewport, displaySize, filter) {
    const applyFilter = Number.isFinite(filter?.blur) && Number.isFinite(filter?.brightness);
    if (!passes.length && !applyFilter || !this.ensure(targetCanvas)) return false;
    const gl = this.gl; const width = sourceCanvas.width; const height = sourceCanvas.height;
    if (targetCanvas.width !== width || targetCanvas.height !== height || this.textureWidth !== width || this.textureHeight !== height) {
      targetCanvas.width = width; targetCanvas.height = height;
      this.resizeTexture(this.pingTexture, width, height); this.resizeTexture(this.pongTexture, width, height);
      this.resizeTexture(this.sourceTexture, width, height);
      this.textureWidth = width; this.textureHeight = height;
    }
    const rectangle = sourceCanvas.getBoundingClientRect?.();
    const ratio = globalThis.devicePixelRatio || 1;
    const display = displaySize ?? (rectangle?.width > 0 && rectangle?.height > 0 ? rectangle : { width: width / ratio, height: height / ratio });
    const view = viewport ?? { left: 0, top: 0, width: display.width, height: display.height, scale: 1 };
    const rect = shaderViewport(view, display.width, display.height);
    const resolution = [view.width / (view.scale || 1), view.height / (view.scale || 1)];
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, sourceCanvas);
    let input = this.sourceTexture; let output = this.pingTexture; let rendered = 0;
    const usable = [];
    this.filterApplied = false;
    for (const pass of passes) { const source = sourceFor(pass); const program = source && this.compile(pass.shader, source); if (program) usable.push({ pass, program }); }
    const boundedFilter = applyFilter && filter.keepInside;
    let mergedOverflow = null;
    if (boundedFilter && filter.sourceCanvas && usable.length) {
      const last = usable.at(-1), program = this.compile(last.pass.shader, sourceFor(last.pass), true);
      if (program) {
        mergedOverflow = this.prepareOverflowFilter(input, width, height, seconds, resolution, filter, passes, sourceFor);
        if (mergedOverflow) last.program = program;
      }
    }
    if (applyFilter && !boundedFilter) {
      const program = this.compile('overflow-filter', OVERFLOW_FILTER_SOURCE);
      if (program) {
        this.filterApplied = true;
        const fullRect = { min: [0, 0], max: [1, 1] };
        const keep = filter.keepInside ? { filterKeepMin: rect.min, filterKeepMax: rect.max } : { filterKeepMin: [0, 0], filterKeepMax: [0, 0] };
        usable.push({ pass: { values: { ...keep, filterDirection: [Math.max(0, filter.blur) / width, 0], filterBrightness: 1 } }, program, rect: fullRect });
        usable.push({ pass: { values: { ...keep, filterDirection: [0, Math.max(0, filter.blur) / height], filterBrightness: filter.brightness } }, program, rect: fullRect });
      }
    }
    for (let index = 0; index < usable.length; index++) {
      const { pass, program, rect: passRect } = usable[index]; const final = index === usable.length - 1 && (!boundedFilter || mergedOverflow); const framebuffer = final ? null : this.framebuffer;
      if (!final) { gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, output, 0); }
      if (final && mergedOverflow) { gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, mergedOverflow); }
      this.drawQuad(program, input, framebuffer, final && mergedOverflow ? { ...pass.values, rpenOverflowTexture: 1 } : pass.values, seconds, width, height, passRect ?? rect, resolution); rendered++;
      if (!final) { input = output; output = output === this.pingTexture ? this.pongTexture : this.pingTexture; }
    }
    if (mergedOverflow) this.filterApplied = true;
    else if (boundedFilter && this.drawOverflowFilter(input, width, height, seconds, rect, resolution, filter, passes, sourceFor)) rendered++;
    if (!rendered) return false;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.flush(); targetCanvas.style.visibility = 'visible'; return true;
  }
}
