import { parseNoiseSkin, skinSize } from '../core/noise-skin.mjs';
import { noisePadding, noiseTargetFrame, paddedNoiseShader, NOISE_SAMPLER_PREFIX, NOISE_RECT_PREFIX } from '../core/noise-skin-padding.mjs';
import { t } from '../i18n.mjs';

const vertex = `#version 300 es
in vec2 position; out highp vec2 uv; uniform vec4 rpenUvRect;
void main(){uv=rpenUvRect.xy+(position*.5+.5)*rpenUvRect.zw;gl_Position=vec4(position,0,1);}`;
const fragment = source => '#version 300 es\n' + source.replace(/^\s*#version[^\n]*\n/gm, '').replace(/\bvarying\b/g, 'in').replace(/\btexture2D\b/g, 'texture').replace(/\bgl_FragColor\b/g, 'skinOutput').replace(/(precision\s+\w+\s+float\s*;)/, '$1\nout vec4 skinOutput;');
const copy = 'precision highp float; varying highp vec2 uv; uniform sampler2D screenTexture; void main(){gl_FragColor=texture2D(screenTexture,uv);}';
const maskFragment = 'precision highp float; uniform float bitValue; void main(){gl_FragColor=vec4(bitValue,0,0,1);}';
const downsample = `precision highp float; varying highp vec2 uv; uniform sampler2D screenTexture; uniform vec2 screenSize;
void main(){ivec2 p=ivec2(floor(uv*screenSize));gl_FragColor=texelFetch(screenTexture,p,0);}`;
const imageConvert = `precision highp float; varying highp vec2 uv; uniform sampler2D screenTexture; uniform float srgb; uniform float premult;
void main(){vec4 c=texture2D(screenTexture,uv);if(srgb>.5)c.rgb=mix(c.rgb/12.92,pow((c.rgb+.055)/1.055,vec3(2.4)),step(vec3(.04045),c.rgb));if(premult>.5)c.rgb*=c.a;gl_FragColor=c;}`;
// Overlay mode only: skin shaders take an opaque scene and hand the whole frame
// back. The render studio draws the noise above the HUD, so compare against the
// untouched capture and keep only the pixels the skin actually changed.
const cutout = `precision highp float; varying highp vec2 uv; uniform sampler2D screenTexture; uniform sampler2D sceneTexture;
void main(){
  vec4 c=texture2D(screenTexture,uv);
  vec3 s=texture2D(sceneTexture,uv).rgb;
  float delta=max(max(abs(c.r-s.r),abs(c.g-s.g)),abs(c.b-s.b));
  float keep=smoothstep(0.003,0.022,delta);
  gl_FragColor=vec4(c.rgb*keep,keep);
}`;

// Owns GPU resources only. Chart geometry, timing and layer order stay with NoisePreview.
export class NoiseSkinRenderer {
  dispose() { this.clearSkins(); this.lost = true; this.gl?.getExtension('WEBGL_lose_context')?.loseContext(); if (this.canvas) this.canvas.width = this.canvas.height = 1; }
  // overlay=false keeps the historical behaviour: the skin owns the whole frame
  // and the playfield is cleared before it is blitted back. Only the render
  // studio opts in; the editor preview must stay on the default path.
  constructor(invalidate, report, { overlay = false } = {}) {
    this.invalidate = invalidate; this.report = report; this.overlay = overlay; this.skins = new Map(); this.instances = new Map(); this.errors = new Set();
    this.canvas = document.createElement('canvas'); this.capture = document.createElement('canvas');
    this.captureContext = this.capture.getContext('2d');
    this.gl = this.canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: overlay, antialias: false, preserveDrawingBuffer: true, depth: false, stencil: true });
    if (!this.gl) return;
    this.canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); this.lost = true; });
    this.canvas.addEventListener('webglcontextrestored', () => { this.lost = false; this.skins.clear(); this.instances.clear(); this.initialize(); this.invalidate?.(); });
    this.initialize();
  }
  initialize() {
    const gl = this.gl; this.maximum = gl.getParameter(gl.MAX_TEXTURE_SIZE); this.maximumSamplers = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS);
    this.quad = new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]);
    this.quadBuffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer); gl.bufferData(gl.ARRAY_BUFFER, this.quad, gl.STATIC_DRAW);
    this.buffer = gl.createBuffer(); this.vertexCapacity = 0; this.touchPoints = new Float32Array(128);
    this.copy = this.program(copy); this.crop = this.program(copy, true); this.maskProgram = this.program(maskFragment); this.downsample = this.program(downsample, true); this.imageConvert = this.program(imageConvert);
    this.cutout = this.overlay ? this.program(cutout, true) : null;
  }
  program(source, guarded = false) {
    const gl = this.gl;
    const compile = (type, text) => {
      const shader = gl.createShader(type); gl.shaderSource(shader, text); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { const message = gl.getShaderInfoLog(shader); gl.deleteShader(shader); throw new Error(message); }
      return shader;
    };
    if (guarded) source = paddedNoiseShader(source);
    const program = gl.createProgram(); const shaders = [compile(gl.VERTEX_SHADER, vertex), compile(gl.FRAGMENT_SHADER, fragment(/precision\s+\w+\s+float/.test(source) ? source : 'precision highp float;\n' + source))];
    for (const shader of shaders) gl.attachShader(program, shader);
    gl.linkProgram(program); for (const shader of shaders) gl.deleteShader(shader);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { const message = gl.getProgramInfoLog(program); gl.deleteProgram(program); throw new Error(message); }
    const uniforms = new Map();
    for (let index = 0; index < gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS); index++) { const info = gl.getActiveUniform(program, index); const name = info.name.replace(/\[0\]$/, '').replace(new RegExp('^' + NOISE_SAMPLER_PREFIX), ''); uniforms.set(name, { location: gl.getUniformLocation(program, info.name), type: info.type }); }
    return { program, uniforms, guarded, position: gl.getAttribLocation(program, 'position') };
  }
  texture(width, height, format = 'rgba8', filter = 'nearest') {
    const gl = this.gl; const texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
    const [internal, channels] = format === 'r8' ? [gl.R8, gl.RED] : format === 'rg8' ? [gl.RG8, gl.RG] : [gl.RGBA8, gl.RGBA];
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, channels, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter === 'linear' ? gl.LINEAR : gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter === 'linear' ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const framebuffer = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { gl.deleteTexture(texture); gl.deleteFramebuffer(framebuffer); throw new Error(t('noise-skin-renderer.s97c0838') + format); }
    const target = { texture, framebuffer, width, height, format, size: [width, height], texelSize: [1 / width, 1 / height] }; this.clear(target); return target;
  }
  destroy(target) { if (!target) return; const gl = this.gl; gl.deleteTexture(target.texture); gl.deleteFramebuffer(target.framebuffer); if (target.stencil) gl.deleteRenderbuffer(target.stencil); }
  clear(target) { const gl = this.gl; gl.disable(gl.SCISSOR_TEST); gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer); gl.colorMask(true,true,true,true); gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT); }
  bind(program, target, vertices = this.quad) {
    const gl = this.gl; gl.bindFramebuffer(gl.FRAMEBUFFER, target?.framebuffer ?? null); gl.viewport(0, 0, target?.width ?? this.canvas.width, target?.height ?? this.canvas.height);
    gl.useProgram(program.program); gl.bindBuffer(gl.ARRAY_BUFFER, vertices === this.quad ? this.quadBuffer : this.buffer);
    if (vertices !== this.quad) {
      if (vertices.byteLength > this.vertexCapacity) { this.vertexCapacity = Math.max(256, this.vertexCapacity * 2, vertices.byteLength); gl.bufferData(gl.ARRAY_BUFFER, this.vertexCapacity, gl.DYNAMIC_DRAW); }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertices);
    }
    gl.enableVertexAttribArray(program.position); gl.vertexAttribPointer(program.position, 2, gl.FLOAT, false, 0, 0);
    if (this.guardSides !== undefined) {
      if (program.guarded && target?.padding && (target.padding[0] || target.padding[1])) {
        const [x,y] = target.padding, [w,h] = target.logicalSize, sides = this.guardSides;
        gl.enable(gl.SCISSOR_TEST); gl.scissor(sides&1 ? 0 : x, sides&4 ? 0 : y, w+(sides&1 ? x : 0)+(sides&2 ? x : 0), h+(sides&4 ? y : 0)+(sides&8 ? y : 0));
      } else gl.disable(gl.SCISSOR_TEST);
    }
    if (program.uniforms) {
      this.uniform(program, 'rpenUvRect', program.guarded && target?.outputRect || [0,0,1,1]);
      if (program.guarded) {
        this.uniform(program, 'rpenGuardOrigin', target?.padding ?? [0,0]);
        this.uniform(program, 'rpenGuardLogicalSize', target?.logicalSize ?? [this.canvas.width,this.canvas.height]);
      }
    }
  }
  uniform(program, name, value) {
    const gl = this.gl; const entry = program.uniforms.get(name); if (!entry) return;
    if (typeof value === 'number') { if (entry.value === value) return; entry.value = value; }
    else {
      let unchanged = entry.values?.length === value.length;
      if (unchanged) for (let index = 0; index < value.length; index++) if (entry.values[index] !== value[index]) { unchanged = false; break; }
      if (unchanged) return;
      if (entry.values?.length !== value.length) entry.values = new Float64Array(value.length);
      entry.values.set(value);
    }
    if (entry.type === gl.INT || entry.type === gl.BOOL || entry.type === gl.SAMPLER_2D) gl.uniform1i(entry.location, value);
    else if (entry.type === gl.FLOAT_VEC2) gl.uniform2fv(entry.location, value);
    else if (entry.type === gl.FLOAT_VEC4) gl.uniform4fv(entry.location, value);
    else if (entry.type === gl.FLOAT) gl.uniform1f(entry.location, value);
  }
  sampler(program, name, target, unit) {
    if (!program.uniforms.has(name)) return unit;
    const gl = this.gl; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, target.texture); this.uniform(program, name, unit); this.uniform(program, name + 'Size', target.logicalSize ?? target.size);
    if (program.guarded) this.uniform(program, NOISE_RECT_PREFIX + name, target.sampleRect ?? [0,0,1,1]);
    return unit + 1;
  }
  blit(source, target, program = target ? this.copy : this.crop) { this.bind(program, target); this.sampler(program, 'screenTexture', source, 0); this.uniform(program, 'screenSize', source.logicalSize ?? source.size); this.gl.drawArrays(this.gl.TRIANGLES, 0, 6); }
  skin(root, assets) {
    const files = new Map([...assets].filter(([name]) => name.startsWith(root + '/')).map(([name, bytes]) => [name.slice(root.length + 1), bytes]));
    let cached = this.skins.get(root);
    if (cached && cached.files.size === files.size && [...files].every(([name, bytes]) => cached.files.get(name) === bytes)) return cached;
    if (cached) { for (const program of cached.programs?.values() ?? []) this.gl.deleteProgram(program.program); for (const texture of cached.images?.values() ?? []) this.destroy(texture); }
    cached = { files, pending: true, programs: new Map(), images: new Map() }; this.skins.set(root, cached);
    try {
      cached.definition = parseNoiseSkin(files);
      for (const [name, source] of cached.definition.sources) { try { cached.programs.set(name, this.program(source, true)); } catch (error) { throw new Error(name + ': ' + error.message); } }
      const textures = new Map([...cached.definition.textures.values()].flat().map(image => [JSON.stringify(image), image]));
      cached.ready = Promise.all([...textures].map(async ([key, image]) => {
        const bitmap = await createImageBitmap(new Blob([files.get(image.path)]), { premultiplyAlpha: 'none', colorSpaceConversion: 'none', imageOrientation: 'flipY' });
        if (this.skins.get(root) !== cached || this.lost) { bitmap.close(); return; }
        if (bitmap.width > this.maximum || bitmap.height > this.maximum) { bitmap.close(); throw new Error(t('noise-skin-renderer.sa4d193e') + image.path); }
        const gl = this.gl; const raw = this.texture(bitmap.width, bitmap.height); gl.bindTexture(gl.TEXTURE_2D, raw.texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
        gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,gl.RGBA,gl.UNSIGNED_BYTE,bitmap); bitmap.close();
        const target = this.texture(raw.width,raw.height,'rgba8',image.filter);
        gl.disable(gl.BLEND); gl.disable(gl.STENCIL_TEST); gl.disable(gl.SCISSOR_TEST); gl.colorMask(true,true,true,true);
        this.bind(this.imageConvert,target); this.sampler(this.imageConvert,'screenTexture',raw,0); this.uniform(this.imageConvert,'srgb',image.colorspace==='srgb'?1:0); this.uniform(this.imageConvert,'premult',image.alphaMode==='premult'?1:0); gl.drawArrays(gl.TRIANGLES,0,6); this.destroy(raw); gl.bindTexture(gl.TEXTURE_2D,target.texture);
        const wrap = { repeat: gl.REPEAT, mirror: gl.MIRRORED_REPEAT, clamp: gl.CLAMP_TO_EDGE }[image.wrap]; gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,wrap); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,wrap); cached.images.set(key, target);
      })).then(() => { cached.pending = false; this.invalidate?.(); }).catch(error => { cached.error = error; cached.pending = false; this.invalidate?.(); });
    } catch (error) { cached.error = error; cached.pending = false; }
    return cached;
  }
  disposeInstance(instance) { for (const target of [...instance.resources,...(instance.history?.values()??[])]) this.destroy(target); }
  reset() { for (const instance of this.instances.values()) this.disposeInstance(instance); this.instances.clear(); }
  clearSkins() { this.reset(); for (const skin of this.skins.values()) { for (const program of skin.programs.values()) this.gl.deleteProgram(program.program); for (const target of skin.images.values()) this.destroy(target); } this.skins.clear(); this.errors.clear(); }
  prune(ids) { for (const [id, instance] of this.instances) if (!ids.has(id)) { this.disposeInstance(instance); this.instances.delete(id); } }
  prepare(layer, assets, width, height) {
    const skin = this.skin(layer.skin, assets), definition = skin.definition;
    const channel = layer.channel === 'low' && definition?.low || definition?.normal;
    return { skin, padding: noisePadding(channel?.padding, width, height) };
  }
  instance(layer, skin, width, height) {
    const channel = layer.channel === 'low' && skin.definition.low ? skin.definition.low : skin.definition.normal;
    let instance = this.instances.get(layer.id);
    if (instance && (instance.skin !== skin || instance.channel !== channel || instance.width !== width || instance.height !== height)) { this.disposeInstance(instance); this.instances.delete(layer.id); instance = null; }
    if (instance) return instance;
    const padding = noisePadding(channel.padding, width, height);
    const sizes = new Map(Object.entries(channel.targets).map(([name,spec])=>[name,skinSize(width,height,spec,this.maximum)]));
    const [mw,mh] = skinSize(width,height,channel.blockMask,this.maximum);
    const screenPadded = (padding[0] > 0 || padding[1] > 0) && channel.padding?.screen !== false;
    instance = { skin, channel, width, height, padding, screenPadded, targets: new Map(), resources: [] };
    const allocate = (w,h,format,filter,guarded = true) => {
      const frame = noiseTargetFrame(width,height,w,h,guarded ? padding : [0,0]);
      if (frame.size.some(size => size > this.maximum)) throw new Error(t('noise-skin-renderer.s995058d'));
      const target = Object.assign(this.texture(...frame.size,format,filter),frame); instance.resources.push(target); return target;
    };
    try {
    instance.screens = [allocate(width,height,'rgba8','linear',screenPadded), allocate(width,height,'rgba8','linear',screenPadded)];
    for (const [name, spec] of Object.entries(channel.targets)) { const [w,h] = sizes.get(name); instance.targets.set(name, { spec, front: allocate(w,h,spec.format,spec.filter), back: allocate(w,h,spec.format,spec.filter) }); }
    instance.fullMask = allocate(width,height,'r8');
    if (screenPadded) instance.scene = allocate(width,height,'rgba8','linear',false);
    const gl = this.gl; gl.bindFramebuffer(gl.FRAMEBUFFER,instance.fullMask.framebuffer); const stencil = gl.createRenderbuffer(); instance.fullMask.stencil = stencil; gl.bindRenderbuffer(gl.RENDERBUFFER,stencil); gl.renderbufferStorage(gl.RENDERBUFFER,gl.STENCIL_INDEX8,instance.fullMask.width,instance.fullMask.height); gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.STENCIL_ATTACHMENT,gl.RENDERBUFFER,stencil);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE) throw new Error(t('noise-skin-renderer.s9f767fb'));
    instance.mask = allocate(mw,mh,'r8');
    instance.history = new Map();
    instance.passes = channel.passes.map(pass => {
      const program = skin.programs.get(pass.shader);
      const inputs = Object.entries(pass.inputs).filter(([name]) => program.uniforms.has(name)).map(([name, input]) => ({ name, target: input === '$screen' ? null : instance.targets.get(input) }));
      const images = (skin.definition.textures.get(pass.shader) ?? []).filter(image => program.uniforms.has(image.name)).map(image => ({ name: image.name, target: skin.images.get(JSON.stringify(image)) }));
      if (Number(program.uniforms.has('screenTexture')) + Number(program.uniforms.has('blockMask')) + inputs.length + images.length > this.maximumSamplers) throw new Error(t('noise-skin-renderer.sa303613'));
      return { program, target: instance.targets.get(pass.output), component: pass.component, inputs, images, constants: Object.entries(pass.constants), parameters: skin.definition.parameters.filter(parameter => program.uniforms.has(parameter.name)) };
    });
    instance.clipGuard = channel.padding?.geometryOnly && !screenPadded && ![...instance.targets.values()].some(target => target.spec.noClear);
    this.instances.set(layer.id,instance); return instance;
    } catch(error) { this.disposeInstance(instance); throw error; }
  }
  geometryMask(instance, entries, viewport, scale, canvasWidth, canvasHeight) {
    const gl = this.gl; const target = instance.fullMask; this.clear(target);
    for (let bit = 0; bit < 6; bit++) {
      const group = Math.floor(bit/2); const inverted = bit % 2 === 1;
      const vertices = [];
      for (const entry of entries) {
        if (Boolean(entry.area.isInvert) !== inverted || !(group === 0 ? entry.state === 'active' : group === 1 ? entry.state !== 'active' : entry.state === 'ready')) continue;
        const points = entry.points.map(point => [2*((canvasWidth/2 + point.x*scale - viewport.left)/viewport.width*instance.width + instance.padding[0])/target.width-1, 1-2*((canvasHeight/2-point.y*scale-viewport.top)/viewport.height*instance.height + instance.padding[1])/target.height]);
        for (let index = 1; index + 1 < points.length; index++) vertices.push(...points[0], ...points[index], ...points[index + 1]);
      }
      if (!vertices.length) continue;
      gl.enable(gl.STENCIL_TEST); gl.stencilMask(255); gl.clearStencil(0); gl.clear(gl.STENCIL_BUFFER_BIT); gl.stencilFunc(gl.ALWAYS,0,255); gl.stencilOp(gl.KEEP,gl.KEEP,gl.INCR); gl.colorMask(false,false,false,false);
      this.bind(this.maskProgram,target,new Float32Array(vertices)); gl.drawArrays(gl.TRIANGLES,0,vertices.length/2);
      gl.colorMask(true,true,true,true); gl.stencilMask(0); gl.stencilOp(gl.KEEP,gl.KEEP,gl.KEEP); gl.stencilFunc(inverted ? gl.EQUAL : gl.LEQUAL,1,255);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE,gl.ONE); this.bind(this.maskProgram,target); this.uniform(this.maskProgram,'bitValue',(1<<bit)/255); gl.drawArrays(gl.TRIANGLES,0,6); gl.disable(gl.BLEND); gl.disable(gl.STENCIL_TEST);
    }
    if (this.guardSides !== undefined) this.clear(instance.mask);
    this.blit(target,instance.mask,this.downsample);
  }
  render(context, layer, assets, entries, seconds, viewport, scale, canvasWidth, canvasHeight, preparedSkin) {
    if (!this.gl || this.lost) return false;
    try {
      const skin = preparedSkin ?? this.skin(layer.skin,assets); if (skin.error) throw skin.error; if (skin.pending) return false;
      const ratio = context.canvas.width / canvasWidth; const width = Math.max(1,Math.round(viewport.width*ratio)); const height = Math.max(1,Math.round(viewport.height*ratio));
      if (width > this.maximum || height > this.maximum) throw new Error(t('noise-skin-renderer.s995058d'));
      const gl = this.gl; gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.SCISSOR_TEST); gl.disable(gl.STENCIL_TEST); gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE); gl.colorMask(true,true,true,true);
      if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
      const instance = this.instance(layer,skin,width,height);
      // Only skins declaring geometry-bounded spill may omit unused guard bands.
      // Historical/fully padded screen passes keep the complete dependency area.
      this.guardSides = undefined;
      if (instance.clipGuard) {
        let sides = 0;
        for (const entry of entries) for (const point of entry.points) {
          const x = (canvasWidth/2+point.x*scale-viewport.left)*ratio, y = (viewport.top+viewport.height-canvasHeight/2+point.y*scale)*ratio;
          if (x < instance.padding[0]) sides |= 1; if (x > width-instance.padding[0]) sides |= 2;
          if (y < instance.padding[1]) sides |= 4; if (y > height-instance.padding[1]) sides |= 8;
        }
        if (instance.guardSides !== sides) for (const target of instance.targets.values()) this.clear(target.back);
        instance.guardSides = this.guardSides = sides;
      }
      // Repaints at a paused time sample the same history; seeking starts a fresh history.
      const signature = JSON.stringify(layer.parameters ?? {});
      if (!instance.parameters || signature !== instance.signature) {
        instance.parameters = new Map(skin.definition.parameters.map(parameter => {
          const value = layer.parameters?.[parameter.name] ?? parameter.value; const values = Array.isArray(value) ? value : [value];
          if (values.some(item => !Number.isFinite(item)) || values.length !== (parameter.type === 'float' ? 1 : Number(parameter.type.slice(3))) || parameter.name === 'touchReleaseDuration' && value < 0) throw new Error(t('noise-skin-renderer.s9cf0d9a') + parameter.name);
          return [parameter.name, value];
        }));
      }
      if (instance.seconds !== undefined && (seconds < instance.seconds || Math.abs(seconds-instance.seconds)>1 || signature !== instance.signature)) for (const target of instance.targets.values()) this.clear(target.front);
      const repeated = seconds === instance.seconds && signature === instance.signature;
      if (repeated) for (const [name, snapshot] of instance.history) this.blit(snapshot,instance.targets.get(name).front);
      else for (const [name, target] of instance.targets) if (target.spec.noClear) {
        if (!instance.history.has(name)) instance.history.set(name, this.texture(target.front.width, target.front.height, target.front.format));
        this.blit(target.front, instance.history.get(name));
      }
      instance.seconds = seconds; instance.signature = signature;
      if (this.capture.width !== width || this.capture.height !== height) { this.capture.width = width; this.capture.height = height; }
      else this.captureContext.clearRect(0, 0, width, height);
      this.captureContext.drawImage(context.canvas,viewport.left*ratio,viewport.top*ratio,viewport.width*ratio,viewport.height*ratio,0,0,width,height);
      let screen = instance.screens[0]; let other = instance.screens[1];
      const scene = instance.screenPadded ? instance.scene : screen;
      gl.bindTexture(gl.TEXTURE_2D,scene.texture); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false); gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,gl.NONE); gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,gl.RGBA,gl.UNSIGNED_BYTE,this.capture); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
      if (instance.screenPadded) this.blit(scene,screen,this.crop);
      this.geometryMask(instance,entries,viewport,scale,canvasWidth,canvasHeight);
      for (const target of instance.targets.values()) if (!target.spec.noClear) this.clear(target.front);
      if (this.overlay && !instance.screenPadded) {
        // Untouched frame: reference for the cutout and source of the pixels that
        // are not part of the noise area.
        if (!instance.scene||instance.scene.width!==width||instance.scene.height!==height) {
          if (instance.scene) { this.destroy(instance.scene); const index=instance.resources.indexOf(instance.scene); if (index>=0) instance.resources.splice(index,1); }
          instance.scene=this.texture(width,height,'rgba8','linear'); instance.resources.push(instance.scene);
        }
        this.blit(screen,instance.scene);
      }
      for (const pass of instance.passes) {
        const target = pass.target; const output = target ? target.back : other;
        if (pass.component) this.blit(target.front,output);
        const program = pass.program; this.bind(program,output); let unit = 0;
        unit = this.sampler(program,'screenTexture',screen,unit); unit = this.sampler(program,'blockMask',instance.mask,unit);
        for (const input of pass.inputs) unit = this.sampler(program,input.name,input.target ? input.target.front : screen,unit);
        for (const image of pass.images) unit = this.sampler(program,image.name,image.target,unit);
        this.uniform(program,'screenSize',instance.screens[0].logicalSize ?? instance.screens[0].size); this.uniform(program,'targetSize',output.logicalSize ?? output.size); this.uniform(program,'targetTexelSize',output.logicalTexelSize ?? output.texelSize); this.uniform(program,'time',seconds); this.uniform(program,'touchCount',0); this.uniform(program,'touchPoints',this.touchPoints);
        for (const parameter of pass.parameters) this.uniform(program,parameter.name,instance.parameters.get(parameter.name));
        for (const [name,value] of pass.constants) this.uniform(program,name,value);
        if (pass.component) gl.colorMask(...'rgba'.split('').map(c=>c===pass.component));
        gl.drawArrays(gl.TRIANGLES,0,6); gl.colorMask(true,true,true,true);
        if (target) [target.front,target.back] = [target.back,target.front]; else [screen,other] = [other,screen];
      }
      context.save(); context.globalAlpha = 1;
      if (this.overlay) {
        // Composite only the changed pixels above the scene and the HUD; several
        // noise layers add up instead of erasing each other.
        this.bind(this.cutout,null);
        const cutoutUnit=this.sampler(this.cutout,'screenTexture',screen,0);
        this.sampler(this.cutout,'sceneTexture',instance.scene,cutoutUnit);
        gl.drawArrays(gl.TRIANGLES,0,6);
        context.drawImage(this.canvas,viewport.left,viewport.top,viewport.width,viewport.height);
      } else {
        this.blit(screen,null);
        context.clearRect(viewport.left,viewport.top,viewport.width,viewport.height);
        context.drawImage(this.canvas,viewport.left,viewport.top,viewport.width,viewport.height);
      }
      context.restore(); return true;
    } catch (error) { const message = t('noise-skin-renderer.s8875622')+layer.skin+'：'+error.message; if (!this.errors.has(message)) { this.errors.add(message); this.report?.(message); console.warn(message); } return false; }
    finally { this.guardSides = undefined; }
  }
  snapshot(source) { const target = this.texture(source.width,source.height,source.format); this.blit(source,target); return target; }
}
