import { defaultShaderUniform } from '../core/shader.ts';
import type { PreviewViewport } from '../core/editor-display.ts';

/**
 * The clip rectangle a shader pass samples, normalised to 0..1 over the source canvas.
 *
 * `min`/`max` are plain number pairs rather than `PreviewViewport`, which is the pixel-space input
 * `shaderViewport` converts from.
 */
export interface ShaderRect {
  min: number[];
  max: number[];
}

/** A parameter value as it can arrive from a chart: a scalar, a vector, or a name this module ignores. */
type UniformValue = unknown;

/**
 * The canvas surface the pipeline binds to.
 *
 * Declared as `HTMLCanvasElement` rather than a narrower shape because the pipeline needs the real
 * 2D/WebGL drawing surface for `getContext`, `style` and `width`/`height`; the geometry-only reads
 * that the test doubles supply go through the `CanvasMetrics` boundary below.
 */
type ShaderCanvas = HTMLCanvasElement;

/**
 * The two reads `render` makes of the source canvas' on-page geometry.
 *
 * The test doubles pass a `{ width, height }` stand-in, so the boundary is kept structural and the
 * declared `getBoundingClientRect` is optional to match the original's own `?.` call.
 */
interface CanvasMetrics {
  getBoundingClientRect?: () => { width: number; height: number };
}

/** A canvas the pipeline can also read its on-page rectangle from. */
type MeasuredCanvas = ShaderCanvas & CanvasMetrics;

/**
 * One rendering pass: the shader to run and the parameters the chart supplied for it.
 *
 * Deliberately not an index-signature bag: the effects this receives at runtime are
 * `ActiveShaderEffect` records from `core/shader.ts`, and an interface without an index signature
 * cannot satisfy one. `render` and `setUniforms` read only these two members.
 */
export interface ShaderPass {
  shader: string;
  values: Record<string, unknown>;
}

/**
 * A compiled program plus everything `setUniforms` needs to bind it.
 *
 * `uniforms` and `types` are `Map`s because the pipeline iterates them directly: `Object.entries`
 * over a `Map` yields nothing, so the container type is load-bearing here.
 */
export interface ShaderProgram {
  program: WebGLProgram;
  uniforms: Map<string, WebGLUniformLocation | null>;
  types: Map<string, number>;
  defaults: Record<string, number | number[]>;
}

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

export function fragmentSource(source: string, webgl2 = false): string {
  const portable = /uniform\s+sampler2D\s+screenTexture\b/.test(source);
  const origin = portable ? 'vec2(0.0)' : 'vec2(0.0, 0.0333)';
  const size = portable ? 'vec2(1.0)' : 'vec2(0.7031, 1.0 / 1.2)';
  const coordinate = portable ? 'uv' : 'v_texCoord';
  let body = source.replace(/^\s*#version[^\n]*\n/, '').replaceAll('CC_Texture0', 'u_texture')
    .replace(/\bscreenTexture\b/g, 'u_texture').replace(/\bscreenSize\b/g, 'resolution');
  body = body.replace(/uniform\s+sampler2D\s+\w+\s*;/g, '');
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
  if (v_texCoord.x < rpeRectMin.x || v_texCoord.x > rpeRectMax.x || v_texCoord.y < rpeRectMin.y || v_texCoord.y > rpeRectMax.y) gl_FragColor = vec4(0.0);
  else {
    rpeCoordinate = ${origin} + (v_texCoord - rpeRectMin) / (rpeRectMax - rpeRectMin) * ${size};
    rpeMain();
  }
}
`;
  return webgl2 ? '#version 300 es\n' + adapted.replace(/varying\b/g, 'in').replace(/gl_FragColor\b/g, 'rpeFragColor')
    .replace(/texture2D\b/g, 'texture').replace('uniform sampler2D u_texture;', 'out vec4 rpeFragColor;\nuniform sampler2D u_texture;') : adapted;
}

export function shaderViewport(view: PreviewViewport, width: number, height: number): ShaderRect {
  return { min: [view.left / width, 1 - (view.top + view.height) / height], max: [(view.left + view.width) / width, 1 - view.top / height] };
}

export function shaderDefaults(source: string): Record<string, number | number[]> {
  return Object.fromEntries([...source.matchAll(/uniform\s+\w+\s+(\w+)\s*;[^\r\n%]*%([^%\r\n]+)%/g)].map(([, name, value]): [string, number | number[]] => {
    const numbers = value.split(',').map(Number); return [name, numbers.length === 1 ? numbers[0] : numbers];
  }).filter(([, value]) => (Array.isArray(value) ? value : [value]).every(Number.isFinite)));
}

function normaliseUniformValue(name: string, value: UniformValue): UniformValue {
  if (!Array.isArray(value)) return value;
  const result = value.map(Number);
  if (result.length === 4 && (name === 'color' || name.endsWith('Color') || result.some(entry => Math.abs(entry) > 1))) {
    if (result.some(entry => Math.abs(entry) > 1)) return result.map(entry => entry / 255);
  }
  return result;
}

export class ShaderPipeline {
  /**
   * Every field is declared explicitly: the GL handles start as `null` until `ensure` runs, and the
   * programs/textures are keyed collections, so inference from the constructor alone would narrow
   * each one to the type of its first assignment and break every later use.
   */
  /** Called whenever the pipeline needs a repaint; `preview.ts` installs an invalidate callback. */
  invalidate: () => void;
  /** The context in use, `null` before `ensure` runs or when WebGL is unavailable. */
  gl: WebGLRenderingContext | null;
  /** The canvas `gl` was created from, used to detect a swap without recreating the context. */
  canvas: ShaderCanvas | null;
  /** GLSL source to its compiled program; the source string is the cache key. */
  programs: Map<string, ShaderProgram>;
  sourceTexture: WebGLTexture | null;
  pingTexture: WebGLTexture | null;
  pongTexture: WebGLTexture | null;
  framebuffer: WebGLFramebuffer | null;
  /** The full-screen quad's vertex buffer. */
  buffer: WebGLBuffer | null;
  /** Set when the context could not be created; the caller falls back to the 2D path. */
  disabled: boolean;
  /** True when the context came from `getContext('webgl2')`, which needs the GLSL 300 sources. */
  webgl2: boolean;
  /** The last shader/program info log, read back by the regression harness. */
  lastError: string | undefined;
  /** The size the ping/pong textures currently hold, so they are only reallocated on a change. */
  textureWidth: number | undefined;
  textureHeight: number | undefined;

  constructor(invalidate: () => void = () => {}) { this.invalidate = invalidate; this.gl = null; this.canvas = null; this.programs = new Map(); this.sourceTexture = null; this.pingTexture = null; this.pongTexture = null; this.framebuffer = null; this.buffer = null; this.disabled = false; this.webgl2 = false; }

  ensure(canvas: ShaderCanvas): boolean {
    if (this.canvas === canvas && this.gl) return true;
    this.canvas = canvas;
    try {
      const options = { alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: false };
      // `getContext` is typed as a union of every context kind; the requested string determines
      // which member comes back, so each call is narrowed to the WebGL context it asked for.
      this.gl = canvas.getContext('webgl2', options) as WebGL2RenderingContext | null; this.webgl2 = Boolean(this.gl);
      this.gl ??= canvas.getContext('webgl', options) as WebGLRenderingContext | null;
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

  configureTexture(texture: WebGLTexture | null): void {
    // These two only run on textures the pipeline just created after `ensure` succeeded, matching
    // the original's unguarded dereference; the assertion is erased at runtime.
    const gl = this.gl!; gl.bindTexture(gl.TEXTURE_2D, texture); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  resizeTexture(texture: WebGLTexture | null, width: number, height: number): void {
    const gl = this.gl!; gl.bindTexture(gl.TEXTURE_2D, texture); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  }

  compile(name: string, source: string): ShaderProgram | null {
    const key = source;
    if (this.programs.has(key)) return this.programs.get(key)!;
    const gl = this.gl!; const vertex = gl.createShader(gl.VERTEX_SHADER)!; const fragment = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(vertex, this.webgl2 ? '#version 300 es\n' + VERTEX_SOURCE.replace(/attribute\b/g, 'in').replace(/varying\b/g, 'out') : VERTEX_SOURCE); gl.compileShader(vertex);
    gl.shaderSource(fragment, fragmentSource(source, this.webgl2)); gl.compileShader(fragment);
    if (!gl.getShaderParameter(vertex, gl.COMPILE_STATUS) || !gl.getShaderParameter(fragment, gl.COMPILE_STATUS)) { this.lastError = (gl.getShaderInfoLog(vertex) ?? '') + (gl.getShaderInfoLog(fragment) ?? ''); gl.deleteShader(vertex); gl.deleteShader(fragment); return null; }
    const program = gl.createProgram(); gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program); gl.deleteShader(vertex); gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { this.lastError = gl.getProgramInfoLog(program) ?? undefined; gl.deleteProgram(program); return null; }
    const uniforms: Map<string, WebGLUniformLocation | null> = new Map(); const types: Map<string, number> = new Map();
    // An active uniform's record is only null past the end of the list, which the loop bound excludes.
    for (let index = 0; index < gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS); index++) { const info = gl.getActiveUniform(program, index)!; const name = info.name.replace(/\[0\]$/, ''); uniforms.set(name, gl.getUniformLocation(program, info.name)); types.set(name, info.type); }
    const defaults = shaderDefaults(source);
    const result = { program, uniforms, types, defaults }; this.programs.set(key, result); return result;
  }

  setUniforms(result: ShaderProgram, values: Record<string, unknown>, seconds: number, width: number, height: number,
    rect: ShaderRect, resolution: [number, number]): void {
    const gl = this.gl!;
    const set = (name: string, value: unknown): void => {
      const location = result.uniforms.get(name); if (location === null || location === undefined) return;
      let normalised = normaliseUniformValue(name, value);
      if (result.types.get(name) === gl.FLOAT && Array.isArray(normalised)) normalised = normalised[0];
      const type = result.types.get(name);
      // Integer-like uniform types take the `uniform1i` path; comparing against the wide `number`
      // the map stores needs the list to be widened to number[], which the literal GL enums are not.
      if (type !== undefined && ([gl.SAMPLER_2D, gl.INT, gl.BOOL] as number[]).includes(type)) { gl.uniform1i(location, Number(normalised) || 0); return; }
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

  drawQuad(result: ShaderProgram, inputTexture: WebGLTexture | null, framebuffer: WebGLFramebuffer | null,
    values: Record<string, unknown>, seconds: number, width: number, height: number, rect: ShaderRect, resolution: [number, number]): void {
    const gl = this.gl!; gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer); gl.viewport(0, 0, width, height); gl.useProgram(result.program); gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    const position = gl.getAttribLocation(result.program, 'a_position'); const texCoord = gl.getAttribLocation(result.program, 'a_texCoord');
    if (position >= 0) { gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 16, 0); }
    if (texCoord >= 0) { gl.enableVertexAttribArray(texCoord); gl.vertexAttribPointer(texCoord, 2, gl.FLOAT, false, 16, 8); }
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, inputTexture); this.setUniforms(result, values, seconds, width, height, rect, resolution); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /**
   * Runs the passes and composites the result into the target canvas.
   *
   * Generic over the pass type because the caller's records are richer than `ShaderPass` (they also
   * carry the shader's source name, which `sourceFor` reads) and an interface without an index
   * signature cannot satisfy a narrower structural view. Only `shader` and `values` are read here.
   */
  render<P extends ShaderPass>(sourceCanvas: ShaderCanvas, targetCanvas: ShaderCanvas, passes: P[], seconds: number,
    sourceFor: (pass: P) => string | undefined, viewport: PreviewViewport): boolean {
    if (!passes.length || !this.ensure(targetCanvas)) return false;
    const gl = this.gl!; const width = sourceCanvas.width; const height = sourceCanvas.height;
    if (targetCanvas.width !== width || targetCanvas.height !== height || this.textureWidth !== width || this.textureHeight !== height) {
      targetCanvas.width = width; targetCanvas.height = height;
      this.resizeTexture(this.pingTexture, width, height); this.resizeTexture(this.pongTexture, width, height);
      this.textureWidth = width; this.textureHeight = height;
    }
    const display = sourceCanvas.getBoundingClientRect?.() ?? { width, height };
    const view = viewport ?? { left: 0, top: 0, width: display.width, height: display.height, scale: 1 };
    const rect = shaderViewport(view, display.width, display.height);
    const resolution: [number, number] = [view.width / (view.scale || 1), view.height / (view.scale || 1)];
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceCanvas);
    let input = this.sourceTexture; let output = this.pingTexture; let rendered = 0;
    const usable: { pass: ShaderPass; program: ShaderProgram }[] = [];
    for (const pass of passes) { const source = sourceFor(pass); const program = source && this.compile(pass.shader, source); if (program) usable.push({ pass, program }); }
    for (let index = 0; index < usable.length; index++) {
      const { pass, program } = usable[index]; const final = index === usable.length - 1; const framebuffer = final ? null : this.framebuffer;
      if (!final) { gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, output, 0); }
      this.drawQuad(program, input, framebuffer, pass.values, seconds, width, height, rect, resolution); rendered++;
      if (!final) { input = output; output = output === this.pingTexture ? this.pongTexture : this.pingTexture; }
    }
    if (!rendered) return false;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.flush(); targetCanvas.style.visibility = 'visible'; return true;
  }
}
