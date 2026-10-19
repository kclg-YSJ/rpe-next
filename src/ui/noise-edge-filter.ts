const vertexSource = `
attribute vec2 position;
varying vec2 coordinate;
void main() {
  coordinate = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;
const fragmentSource = `
precision highp float;
uniform sampler2D coverage;
uniform sampler2D strokes;
uniform vec2 radius;
uniform vec3 color;
varying vec2 coordinate;
float sampleCoverage(vec2 offset) {
  vec2 point = coordinate + offset * radius;
  if (point.x < 0.0 || point.x > 1.0 || point.y < 0.0 || point.y > 1.0) return 0.0;
  return texture2D(coverage, point).a;
}
void main() {
  float covered = sampleCoverage(vec2(0.0));
  float interior = covered;
  interior *= sampleCoverage(vec2(1.0, 0.0));
  interior *= sampleCoverage(vec2(0.70710678, 0.70710678));
  interior *= sampleCoverage(vec2(0.0, 1.0));
  interior *= sampleCoverage(vec2(-0.70710678, 0.70710678));
  interior *= sampleCoverage(vec2(-1.0, 0.0));
  interior *= sampleCoverage(vec2(-0.70710678, -0.70710678));
  interior *= sampleCoverage(vec2(0.0, -1.0));
  interior *= sampleCoverage(vec2(0.70710678, -0.70710678));
  float alpha = texture2D(strokes, coordinate).a * covered * (1.0 - interior);
  gl_FragColor = vec4(color * alpha, alpha);
}`;

/**
 * The GPU edge pass for the noise areas.
 *
 * Only `disabled`, `gl`, `uploadCanvases` and `textureSize` are set by the constructor; the rest are
 * filled in by `ensure` / `render`, so they carry a definite-assignment marker rather than an
 * initializer the original never wrote.
 */
export class NoiseEdgeFilter {
  disabled: boolean;
  gl: WebGLRenderingContext | null;
  uploadCanvases: HTMLCanvasElement[];
  textureSize: string[];
  canvas!: HTMLCanvasElement;
  textures!: (WebGLTexture | null)[];
  radius!: WebGLUniformLocation | null;
  color!: WebGLUniformLocation | null;
  maximumSize!: number;
  constructor() { this.disabled = false; this.gl = null; this.uploadCanvases = []; this.textureSize = []; }
  ensure(): boolean {
    if (this.disabled) return false;
    if (this.gl) return !this.gl.isContextLost();
    try {
      this.canvas = document.createElement('canvas');
      this.canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); this.disabled = true; });
      this.canvas.addEventListener('webglcontextrestored', () => { this.disabled = false; this.gl = null; });
      const gl = this.canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false });
      if (!gl) { this.disabled = true; return false; }
      const shaders: (WebGLShader | null)[] = [];
      const program = gl.createProgram();
      try {
        const stages: [number, string][] = [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragmentSource]];
        for (const [type, source] of stages) {
          // `createShader` is typed as nullable, but it only returns `null` when the context is lost,
          // which `gl` being non-null above rules out; the throw below is the real failure path.
          const shader = gl.createShader(type) as WebGLShader; shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader);
          if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('Noise edge shader compilation failed');
          gl.attachShader(program, shader);
        }
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Noise edge shader linking failed');
      } finally { for (const shader of shaders) gl.deleteShader(shader); }
      gl.useProgram(program);
      const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program, 'position'); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      this.textures = [0, 1].map(unit => {
        const texture = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        return texture;
      });
      gl.uniform1i(gl.getUniformLocation(program, 'coverage'), 0); gl.uniform1i(gl.getUniformLocation(program, 'strokes'), 1);
      this.radius = gl.getUniformLocation(program, 'radius'); this.color = gl.getUniformLocation(program, 'color');
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      this.maximumSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)); this.gl = gl;
      return true;
    } catch { this.disabled = true; return false; }
  }
  render(coverage: HTMLCanvasElement, strokes: HTMLCanvasElement, radiusX: number, radiusY: number, color: number[], quality = 1): HTMLCanvasElement | null {
    if (!this.ensure() || coverage.width > this.maximumSize || coverage.height > this.maximumSize) return null;
    // `ensure` has just stored the live context; the field stays nullable because a lost context
    // clears it, so the assertion mirrors the guard above rather than changing the read.
    const gl = this.gl!;
    try {
      quality = Math.max(0.25, Math.min(1, Number.isFinite(quality) ? quality : 1));
      const width = Math.max(1, Math.round(coverage.width * quality));
      const height = Math.max(1, Math.round(coverage.height * quality));
      const sources = quality === 1 ? [coverage, strokes] : [coverage, strokes].map((source, index) => {
        let canvas = this.uploadCanvases[index];
        if (!canvas) { canvas = document.createElement('canvas'); this.uploadCanvases[index] = canvas; }
        if (canvas.width !== width || canvas.height !== height) canvas.width = width, canvas.height = height;
        const context = canvas.getContext('2d')!;
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, width, height);
        context.drawImage(source, 0, 0, width, height);
        return canvas;
      });
      if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; this.textureSize = []; }
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      for (const [unit, source] of sources.entries()) {
        gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, this.textures[unit]);
        if (this.textureSize[unit] !== width + 'x' + height) {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
          this.textureSize[unit] = width + 'x' + height;
        }
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
      }
      gl.uniform2f(this.radius, radiusX, radiusY); gl.uniform3f(this.color, color[0] / 255, color[1] / 255, color[2] / 255);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return gl.isContextLost() ? null : this.canvas;
    } catch { this.disabled = true; return null; }
  }
}
