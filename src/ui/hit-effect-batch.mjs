const VERTEX = `#version 300 es
in vec2 position;
in vec3 texturePosition;
in vec4 color;
uniform vec2 resolution;
out vec3 uv;
out vec4 tint;
void main() {
  gl_Position = vec4(position / resolution * vec2(2.0, -2.0) + vec2(-1.0, 1.0), 0.0, 1.0);
  uv = texturePosition;
  tint = color;
}`;
const FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray pictures;
in vec3 uv;
in vec4 tint;
out vec4 outputColor;
void main() {
  vec4 pixel = uv.z < 0.0 ? vec4(1.0) : texture(pictures, uv);
  outputColor = pixel * vec4(tint.rgb * tint.a, tint.a);
}`;

export class HitEffectBatch {
  constructor({ antialias = false, fragment = FRAGMENT } = {}) { this.antialias = antialias; this.fragment = fragment; this.vertices = new Float32Array(9 * 6 * 4096); this.images = new WeakMap(); this.failed = false; }
  initialize() {
    if (this.gl || this.failed) return;
    try {
      this.canvas = document.createElement('canvas');
      const gl = this.canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: this.antialias, depth: false, stencil: false });
      if (!gl) throw Error('WebGL2 unavailable');
      this.canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); this.failed = true; });
      const shader = (type, source) => {
        const result = gl.createShader(type); gl.shaderSource(result, source); gl.compileShader(result);
        if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(result));
        return result;
      };
      const vertex = shader(gl.VERTEX_SHADER, VERTEX), fragment = shader(gl.FRAGMENT_SHADER, this.fragment), program = gl.createProgram();
      gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program); gl.deleteShader(vertex); gl.deleteShader(fragment);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program));
      this.gl = gl; this.program = program; this.resolution = gl.getUniformLocation(program, 'resolution'); this.buffer = gl.createBuffer();
      gl.useProgram(program); gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      for (const [name, size, offset] of [['position', 2, 0], ['texturePosition', 3, 2], ['color', 4, 5]]) {
        const attribute = gl.getAttribLocation(program, name); gl.enableVertexAttribArray(attribute); gl.vertexAttribPointer(attribute, size, gl.FLOAT, false, 36, offset * 4);
      }
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.uniform1i(gl.getUniformLocation(program, 'pictures'), 0);
    } catch { this.failed = true; }
  }
  begin(context, width, height, skin) {
    if (context.globalCompositeOperation !== 'source-over' || context.filter && context.filter !== 'none' || context.shadowBlur || context.shadowOffsetX || context.shadowOffsetY) return null;
    this.initialize(); if (this.failed) return null;
    this.target = context; this.width = width; this.height = height;
    if (this.canvas.width !== context.canvas.width || this.canvas.height !== context.canvas.height) { this.canvas.width = context.canvas.width; this.canvas.height = context.canvas.height; }
    const gl = this.gl; gl.viewport(0, 0, this.canvas.width, this.canvas.height); gl.useProgram(this.program); gl.uniform2f(this.resolution, width, height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    const identity = skin.resourcePack ?? skin;
    if (this.skin !== identity) { this.resetTexture(); this.skin = identity; }
    this.expectedFrames = (skin.resourcePack?.info.hitFx.reduce((total, value) => total * value, 1) ?? 31) + 1;
    this.used = 0; this.matrix = [1, 0, 0, 1, 0, 0]; this.globalAlpha = context.globalAlpha; this.fillStyle = '#ffffff'; this.stack = []; return this;
  }
  resetTexture() {
    if (this.texture) this.gl.deleteTexture(this.texture);
    this.texture = null; this.images = new WeakMap(); this.layers = 0;
  }
  allocate(width, height) {
    this.resetTexture(); const gl = this.gl;
    this.textureWidth = Math.max(256, width); this.textureHeight = Math.max(256, height);
    this.capacity = Math.max(1, Math.min(128, this.expectedFrames, gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS), Math.floor(64 * 1024 ** 2 / (this.textureWidth * this.textureHeight * 4))));
    this.texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture); gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, this.textureWidth, this.textureHeight, this.capacity, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  }
  image(picture) {
    let image = this.images.get(picture); if (image) return image;
    const width = picture.naturalWidth ?? picture.width, height = picture.naturalHeight ?? picture.height;
    if (!this.texture || width > this.textureWidth || height > this.textureHeight || this.layers >= this.capacity) {
      this.flush(); this.allocate(Math.max(width, this.textureWidth ?? 0), Math.max(height, this.textureHeight ?? 0));
    }
    image = { layer: this.layers++, width: width / this.textureWidth, height: height / this.textureHeight };
    const gl = this.gl; gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture); gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, image.layer, width, height, 1, gl.RGBA, gl.UNSIGNED_BYTE, picture);
    this.images.set(picture, image); return image;
  }
  save() { this.stack.push([this.matrix, this.globalAlpha, this.fillStyle]); this.matrix = [...this.matrix]; }
  restore() { [this.matrix, this.globalAlpha, this.fillStyle] = this.stack.pop(); }
  translate(offsetX, offsetY) { const matrix = this.matrix; matrix[4] += matrix[0] * offsetX + matrix[2] * offsetY; matrix[5] += matrix[1] * offsetX + matrix[3] * offsetY; }
  rotate(angle) {
    const [first, second, third, fourth] = this.matrix, cosine = Math.cos(angle), sine = Math.sin(angle);
    this.matrix[0] = first * cosine + third * sine; this.matrix[1] = second * cosine + fourth * sine; this.matrix[2] = third * cosine - first * sine; this.matrix[3] = fourth * cosine - second * sine;
  }
  quad(left, top, width, height, image, color) {
    if (this.used + 54 > this.vertices.length) { const expanded = new Float32Array(this.vertices.length * 2); expanded.set(this.vertices); this.vertices = expanded; }
    const matrix = this.matrix, alpha = this.globalAlpha, layer = image?.layer ?? -1;
    const append = (horizontal, vertical) => {
      const offset = this.used, positionX = left + horizontal * width, positionY = top + vertical * height;
      this.vertices[offset] = matrix[0] * positionX + matrix[2] * positionY + matrix[4]; this.vertices[offset + 1] = matrix[1] * positionX + matrix[3] * positionY + matrix[5];
      this.vertices[offset + 2] = horizontal * (image?.width ?? 0); this.vertices[offset + 3] = vertical * (image?.height ?? 0); this.vertices[offset + 4] = layer;
      this.vertices[offset + 5] = color[0]; this.vertices[offset + 6] = color[1]; this.vertices[offset + 7] = color[2]; this.vertices[offset + 8] = alpha; this.used += 9;
    };
    append(0, 0); append(1, 0); append(0, 1); append(0, 1); append(1, 0); append(1, 1);
  }
  drawImage(picture, left, top, width, height) { this.quad(left, top, width, height, this.image(picture), [1, 1, 1]); }
  fillRect(left, top, width, height) {
    if (this.lastFillStyle !== this.fillStyle) { this.lastFillStyle = this.fillStyle; this.fillColor = this.fillStyle.match(/-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi).slice(0, 3).map(value => Math.max(0, Math.min(255, Number(value))) / 255); }
    this.quad(left, top, width, height, null, this.fillColor);
  }
  flush() {
    if (!this.used) return;
    const gl = this.gl; if (!this.texture) this.allocate(256, 256);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture); gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer); gl.bufferData(gl.ARRAY_BUFFER, this.vertices.subarray(0, this.used), gl.DYNAMIC_DRAW); gl.drawArrays(gl.TRIANGLES, 0, this.used / 9); this.used = 0;
  }
  end() {
    this.flush(); if (this.gl.isContextLost()) { this.failed = true; return false; }
    this.target.save(); this.target.globalAlpha = 1; this.target.drawImage(this.canvas, 0, 0, this.width, this.height); this.target.restore(); return true;
  }
}
