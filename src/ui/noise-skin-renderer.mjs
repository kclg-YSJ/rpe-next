import { parseNoiseSkin, skinSize } from '../core/noise-skin.mjs';
import { t } from '../i18n.mjs';

const vertex = `#version 300 es
in vec2 position; out highp vec2 uv;
void main(){uv=position*.5+.5;gl_Position=vec4(position,0,1);}`;
const fragment = source => '#version 300 es\n' + source.replace(/^\s*#version[^\n]*\n/gm, '').replace(/\bvarying\b/g, 'in').replace(/\btexture2D\b/g, 'texture').replace(/\bgl_FragColor\b/g, 'skinOutput').replace(/(precision\s+\w+\s+float\s*;)/, '$1\nout vec4 skinOutput;');
const copy = 'precision highp float; varying highp vec2 uv; uniform sampler2D screenTexture; void main(){gl_FragColor=texture2D(screenTexture,uv);}';
const maskFragment = 'precision highp float; uniform float bitValue; void main(){gl_FragColor=vec4(bitValue,0,0,1);}';
const downsample = `precision highp float; varying highp vec2 uv; uniform sampler2D screenTexture; uniform vec2 screenSize;
void main(){ivec2 p=ivec2(min(floor(uv*screenSize),screenSize-1.));gl_FragColor=texelFetch(screenTexture,p,0);}`;
const imageConvert = `precision highp float; varying highp vec2 uv; uniform sampler2D screenTexture; uniform float srgb; uniform float premult;
void main(){vec4 c=texture2D(screenTexture,uv);if(srgb>.5)c.rgb=mix(c.rgb/12.92,pow((c.rgb+.055)/1.055,vec3(2.4)),step(vec3(.04045),c.rgb));if(premult>.5)c.rgb*=c.a;gl_FragColor=c;}`;

// Owns GPU resources only. Chart geometry, timing and layer order stay with NoisePreview.
export class NoiseSkinRenderer {
  constructor(invalidate, report) {
    this.invalidate = invalidate; this.report = report; this.skins = new Map(); this.instances = new Map(); this.errors = new Set();
    this.canvas = document.createElement('canvas'); this.capture = document.createElement('canvas');
    this.gl = this.canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false, antialias: false, preserveDrawingBuffer: true, depth: false, stencil: true });
    if (!this.gl) return;
    this.canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); this.lost = true; });
    this.canvas.addEventListener('webglcontextrestored', () => { this.lost = false; this.skins.clear(); this.instances.clear(); this.initialize(); this.invalidate?.(); });
    this.initialize();
  }
  initialize() {
    const gl = this.gl; this.maximum = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this.buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    this.quad = new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]);
    this.copy = this.program(copy); this.maskProgram = this.program(maskFragment); this.downsample = this.program(downsample); this.imageConvert = this.program(imageConvert);
  }
  program(source) {
    const gl = this.gl;
    const compile = (type, text) => {
      const shader = gl.createShader(type); gl.shaderSource(shader, text); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { const message = gl.getShaderInfoLog(shader); gl.deleteShader(shader); throw new Error(message); }
      return shader;
    };
    const program = gl.createProgram(); const shaders = [compile(gl.VERTEX_SHADER, vertex), compile(gl.FRAGMENT_SHADER, fragment(/precision\s+\w+\s+float/.test(source) ? source : 'precision highp float;\n' + source))];
    for (const shader of shaders) gl.attachShader(program, shader);
    gl.linkProgram(program); for (const shader of shaders) gl.deleteShader(shader);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { const message = gl.getProgramInfoLog(program); gl.deleteProgram(program); throw new Error(message); }
    const uniforms = new Map();
    for (let index = 0; index < gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS); index++) { const info = gl.getActiveUniform(program, index); const name = info.name.replace(/\[0\]$/, ''); uniforms.set(name, { location: gl.getUniformLocation(program, info.name), type: info.type }); }
    return { program, uniforms, position: gl.getAttribLocation(program, 'position') };
  }
  texture(width, height, format = 'rgba8', filter = 'nearest') {
    const gl = this.gl; const texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
    const [internal, channels] = format === 'r8' ? [gl.R8, gl.RED] : format === 'rg8' ? [gl.RG8, gl.RG] : [gl.RGBA8, gl.RGBA];
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, channels, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter === 'linear' ? gl.LINEAR : gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter === 'linear' ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const framebuffer = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { gl.deleteTexture(texture); gl.deleteFramebuffer(framebuffer); throw new Error(t('noise-skin-renderer.s97c0838') + format); }
    const target = { texture, framebuffer, width, height, format }; this.clear(target); return target;
  }
  destroy(target) { if (!target) return; const gl = this.gl; gl.deleteTexture(target.texture); gl.deleteFramebuffer(target.framebuffer); if (target.stencil) gl.deleteRenderbuffer(target.stencil); }
  clear(target) { const gl = this.gl; gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer); gl.colorMask(true,true,true,true); gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT); }
  bind(program, target, vertices = this.quad) {
    const gl = this.gl; gl.bindFramebuffer(gl.FRAMEBUFFER, target?.framebuffer ?? null); gl.viewport(0, 0, target?.width ?? this.canvas.width, target?.height ?? this.canvas.height);
    gl.useProgram(program.program); gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer); gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STREAM_DRAW);
    gl.enableVertexAttribArray(program.position); gl.vertexAttribPointer(program.position, 2, gl.FLOAT, false, 0, 0);
  }
  uniform(program, name, value) {
    const gl = this.gl; const entry = program.uniforms.get(name); if (!entry) return;
    if (entry.type === gl.INT || entry.type === gl.BOOL || entry.type === gl.SAMPLER_2D) gl.uniform1i(entry.location, value);
    else if (entry.type === gl.FLOAT_VEC2) gl.uniform2fv(entry.location, value);
    else if (entry.type === gl.FLOAT_VEC4) gl.uniform4fv(entry.location, value);
    else if (entry.type === gl.FLOAT) gl.uniform1f(entry.location, value);
  }
  sampler(program, name, target, unit) {
    if (!program.uniforms.has(name)) return unit;
    const gl = this.gl; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, target.texture); this.uniform(program, name, unit); this.uniform(program, name + 'Size', [target.width, target.height]); return unit + 1;
  }
  blit(source, target, program = this.copy) { this.bind(program, target); this.sampler(program, 'screenTexture', source, 0); this.uniform(program, 'screenSize', [source.width, source.height]); this.gl.drawArrays(this.gl.TRIANGLES, 0, 6); }
  skin(root, assets) {
    const files = new Map([...assets].filter(([name]) => name.startsWith(root + '/')).map(([name, bytes]) => [name.slice(root.length + 1), bytes]));
    let cached = this.skins.get(root);
    if (cached && cached.files.size === files.size && [...files].every(([name, bytes]) => cached.files.get(name) === bytes)) return cached;
    if (cached) { for (const program of cached.programs?.values() ?? []) this.gl.deleteProgram(program.program); for (const texture of cached.images?.values() ?? []) this.destroy(texture); }
    cached = { files, pending: true, programs: new Map(), images: new Map() }; this.skins.set(root, cached);
    try {
      cached.definition = parseNoiseSkin(files);
      for (const [name, source] of cached.definition.sources) { try { cached.programs.set(name, this.program(source)); } catch (error) { throw new Error(name + ': ' + error.message); } }
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
  instance(layer, skin, width, height) {
    const channel = layer.channel === 'low' && skin.definition.low ? skin.definition.low : skin.definition.normal;
    let instance = this.instances.get(layer.id);
    if (instance && (instance.skin !== skin || instance.channel !== channel || instance.width !== width || instance.height !== height)) { this.disposeInstance(instance); this.instances.delete(layer.id); instance = null; }
    if (instance) return instance;
    const sizes = new Map(Object.entries(channel.targets).map(([name,spec])=>[name,skinSize(width,height,spec,this.maximum)]));
    const [mw,mh] = skinSize(width,height,channel.blockMask,this.maximum);
    instance = { skin, channel, width, height, targets: new Map(), resources: [] };
    const allocate = (w,h,format,filter) => { const target = this.texture(w,h,format,filter); instance.resources.push(target); return target; };
    try {
    instance.screens = [allocate(width,height,'rgba8','linear'), allocate(width,height,'rgba8','linear')];
    for (const [name, spec] of Object.entries(channel.targets)) { const [w,h] = sizes.get(name); instance.targets.set(name, { spec, front: allocate(w,h,spec.format,spec.filter), back: allocate(w,h,spec.format,spec.filter) }); }
    instance.fullMask = allocate(width,height,'r8');
    const gl = this.gl; gl.bindFramebuffer(gl.FRAMEBUFFER,instance.fullMask.framebuffer); const stencil = gl.createRenderbuffer(); instance.fullMask.stencil = stencil; gl.bindRenderbuffer(gl.RENDERBUFFER,stencil); gl.renderbufferStorage(gl.RENDERBUFFER,gl.STENCIL_INDEX8,width,height); gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.STENCIL_ATTACHMENT,gl.RENDERBUFFER,stencil);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE) throw new Error(t('noise-skin-renderer.s9f767fb'));
    instance.mask = allocate(mw,mh,'r8');
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
        const points = entry.points.map(point => [2*((canvasWidth/2 + point.x*scale - viewport.left)/viewport.width)-1, 1-2*((canvasHeight/2-point.y*scale-viewport.top)/viewport.height)]);
        for (let index = 1; index + 1 < points.length; index++) vertices.push(...points[0], ...points[index], ...points[index + 1]);
      }
      if (!vertices.length) continue;
      gl.enable(gl.STENCIL_TEST); gl.stencilMask(255); gl.clearStencil(0); gl.clear(gl.STENCIL_BUFFER_BIT); gl.stencilFunc(gl.ALWAYS,0,255); gl.stencilOp(gl.KEEP,gl.KEEP,gl.INCR); gl.colorMask(false,false,false,false);
      this.bind(this.maskProgram,target,new Float32Array(vertices)); gl.drawArrays(gl.TRIANGLES,0,vertices.length/2);
      gl.colorMask(true,true,true,true); gl.stencilMask(0); gl.stencilOp(gl.KEEP,gl.KEEP,gl.KEEP); gl.stencilFunc(inverted ? gl.EQUAL : gl.LEQUAL,1,255);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE,gl.ONE); this.bind(this.maskProgram,target); this.uniform(this.maskProgram,'bitValue',(1<<bit)/255); gl.drawArrays(gl.TRIANGLES,0,6); gl.disable(gl.BLEND); gl.disable(gl.STENCIL_TEST);
    }
    this.blit(target,instance.mask,this.downsample);
  }
  render(context, layer, assets, entries, seconds, viewport, scale, canvasWidth, canvasHeight) {
    if (!this.gl || this.lost) return false;
    try {
      const skin = this.skin(layer.skin,assets); if (skin.error) throw skin.error; if (skin.pending) return false;
      const ratio = context.canvas.width / canvasWidth; const width = Math.max(1,Math.round(viewport.width*ratio)); const height = Math.max(1,Math.round(viewport.height*ratio));
      if (width > this.maximum || height > this.maximum) throw new Error(t('noise-skin-renderer.s995058d'));
      const gl = this.gl; gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.SCISSOR_TEST); gl.disable(gl.STENCIL_TEST); gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE); gl.colorMask(true,true,true,true);
      if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
      const instance = this.instance(layer,skin,width,height);
      // Repaints at a paused time sample the same history; seeking starts a fresh history.
      const signature = JSON.stringify(layer.parameters ?? {});
      if (instance.seconds !== undefined && (seconds < instance.seconds || Math.abs(seconds-instance.seconds)>1 || signature !== instance.signature)) for (const target of instance.targets.values()) this.clear(target.front);
      const repeated = seconds === instance.seconds && signature === instance.signature;
      const snapshots = repeated ? instance.history : new Map([...instance.targets].filter(([,t])=>t.spec.noClear).map(([name,t])=>[name,this.snapshot(t.front)]));
      if (repeated && snapshots) for (const [name, snapshot] of snapshots) this.blit(snapshot,instance.targets.get(name).front);
      if (!repeated) { for (const target of instance.history?.values() ?? []) this.destroy(target); instance.history = snapshots; }
      instance.seconds = seconds; instance.signature = signature;
      this.capture.width = width; this.capture.height = height; this.capture.getContext('2d').drawImage(context.canvas,viewport.left*ratio,viewport.top*ratio,viewport.width*ratio,viewport.height*ratio,0,0,width,height);
      let screen = instance.screens[0]; let other = instance.screens[1]; gl.bindTexture(gl.TEXTURE_2D,screen.texture); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false); gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,gl.NONE); gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,gl.RGBA,gl.UNSIGNED_BYTE,this.capture); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
      this.geometryMask(instance,entries,viewport,scale,canvasWidth,canvasHeight);
      for (const target of instance.targets.values()) if (!target.spec.noClear) this.clear(target.front);
      for (const pass of instance.channel.passes) {
        const target = instance.targets.get(pass.output); const output = target ? target.back : other;
        if (pass.component) this.blit(target.front,output);
        const program = skin.programs.get(pass.shader); this.bind(program,output); let unit = 0;
        unit = this.sampler(program,'screenTexture',screen,unit); unit = this.sampler(program,'blockMask',instance.mask,unit);
        for (const [name,input] of Object.entries(pass.inputs)) unit = this.sampler(program,name,input === '$screen' ? screen : instance.targets.get(input).front,unit);
        for (const image of skin.definition.textures.get(pass.shader) ?? []) unit = this.sampler(program,image.name,skin.images.get(JSON.stringify(image)),unit);
        if (unit > gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)) throw new Error(t('noise-skin-renderer.sa303613'));
        this.uniform(program,'screenSize',[width,height]); this.uniform(program,'targetSize',[output.width,output.height]); this.uniform(program,'targetTexelSize',[1/output.width,1/output.height]); this.uniform(program,'time',seconds); this.uniform(program,'touchCount',0); this.uniform(program,'touchPoints',new Float32Array(128));
        for (const parameter of skin.definition.parameters) { const value = layer.parameters?.[parameter.name] ?? parameter.value; const values = Array.isArray(value) ? value : [value]; if (values.some(v=>!Number.isFinite(v)) || values.length !== (parameter.type === 'float' ? 1 : Number(parameter.type.slice(3))) || parameter.name === 'touchReleaseDuration' && value < 0) throw new Error(t('noise-skin-renderer.s9cf0d9a')+parameter.name); this.uniform(program,parameter.name,value); }
        for (const [name,value] of Object.entries(pass.constants)) this.uniform(program,name,value);
        if (pass.component) gl.colorMask(...'rgba'.split('').map(c=>c===pass.component));
        gl.drawArrays(gl.TRIANGLES,0,6); gl.colorMask(true,true,true,true);
        if (target) [target.front,target.back] = [target.back,target.front]; else [screen,other] = [other,screen];
      }
      this.blit(screen,null);
      context.save(); context.globalAlpha = 1; context.clearRect(viewport.left,viewport.top,viewport.width,viewport.height); context.drawImage(this.canvas,viewport.left,viewport.top,viewport.width,viewport.height); context.restore(); return true;
    } catch (error) { const message = t('noise-skin-renderer.s8875622')+layer.skin+'：'+error.message; if (!this.errors.has(message)) { this.errors.add(message); this.report?.(message); console.warn(message); } return false; }
  }
  snapshot(source) { const target = this.texture(source.width,source.height,source.format); this.blit(source,target); return target; }
}
