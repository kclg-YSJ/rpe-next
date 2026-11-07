import test from 'node:test';
import assert from 'node:assert/strict';
import { createChart } from '../src/core/chart.mjs';
import { TempoMap } from '../src/core/tempo.mjs';
import { canonicalShaderName, ShaderRuntime } from '../src/core/shader.mjs';
import { ShaderPipeline, shaderViewport, fragmentSource, shaderDefaults } from '../src/ui/shader-pipeline.mjs';
test('空间前景Shader保留输入覆盖率，变体不影响普通Shader',()=>{
  const shader='uniform sampler2D screenTexture; varying vec2 uv; void main(){gl_FragColor=vec4(texture2D(screenTexture,uv).rgb,1.0);}';
  const plain=fragmentSource(shader),spatial=fragmentSource(shader,false,false,true),modern=fragmentSource(shader,true,false,true);
  assert.ok(!plain.includes('rpenCoverage'));assert.ok(spatial.includes('rpenCoverage = max(rpenCoverage, pixel.a)'));assert.ok(spatial.includes('gl_FragColor.a = min'));assert.ok(modern.includes('rpeFragColor.a = min'));
  assert.ok(!plain.includes('rpenOutputStraight'));
  assert.ok(spatial.includes('uniform float rpenOutputStraight'));
  assert.ok(spatial.includes('gl_FragColor.a) / rpenAlpha'));
  assert.ok(modern.includes('rpeFragColor.a) / rpenAlpha'));
});

test('shader 连续渲染复用输入纹理和中间纹理，仅在尺寸变化时重新分配', () => {
  const allocations = [], uploads = [], draws = [];
  const pipeline = new ShaderPipeline();
  pipeline.gl = {
    UNPACK_FLIP_Y_WEBGL: 1, TEXTURE_2D: 2, RGBA: 3, UNSIGNED_BYTE: 4, FRAMEBUFFER: 5,
    pixelStorei() {}, bindTexture() {}, bindFramebuffer() {}, flush() {},
    texSubImage2D(...args) { uploads.push(args); },
  };
  pipeline.sourceTexture = {}; pipeline.pingTexture = {}; pipeline.pongTexture = {};
  pipeline.ensure = () => true;
  pipeline.resizeTexture = (texture, width, height) => allocations.push({ texture, width, height });
  pipeline.compile = () => ({});
  pipeline.drawQuad = (...args) => draws.push(args);
  const source = { width: 800, height: 600 }, target = { width: 0, height: 0, style: {} };
  const passes = [{ shader: 'test', values: {} }];
  assert.equal(pipeline.render(source, target, passes, 1, () => 'source'), true);
  assert.equal(allocations.length, 3); assert.equal(uploads.length, 1);
  assert.equal(pipeline.render(source, target, passes, 2, () => 'source'), true);
  assert.equal(allocations.length, 3); assert.equal(uploads.length, 2); assert.equal(draws.length, 2);
  source.width = 1024; source.height = 768;
  pipeline.render(source, target, passes, 3, () => 'source');
  assert.equal(allocations.length, 6); assert.equal(uploads.length, 3);
  assert.ok(allocations.slice(3).every(entry => entry.width === 1024 && entry.height === 768));
});

test('空间透明合成只在切换模式时更改上传格式，回到普通预览恢复且不新增纹理', () => {
  const modes=[],allocations=[],programModes=[];
  const pipeline=new ShaderPipeline();
  pipeline.gl={UNPACK_FLIP_Y_WEBGL:1,UNPACK_PREMULTIPLY_ALPHA_WEBGL:2,TEXTURE_2D:3,RGBA:4,UNSIGNED_BYTE:5,FRAMEBUFFER:6,COLOR_ATTACHMENT0:7,
    pixelStorei(key,value){if(key===2)modes.push(value);},bindTexture(){},bindFramebuffer(){},framebufferTexture2D(){},texSubImage2D(){},flush(){}};
  pipeline.sourceTexture={};pipeline.pingTexture={};pipeline.pongTexture={};pipeline.framebuffer={};pipeline.ensure=()=>true;
  pipeline.resizeTexture=(texture,w,h)=>allocations.push([w,h]);pipeline.compile=(name,source,overflow,alpha)=>{programModes.push(Boolean(alpha));return{};};pipeline.drawQuad=()=>{};
  const source={width:800,height:600},target={width:0,height:0,style:{}},passes=[{shader:'a',values:{}},{shader:'b',values:{}}];
  for(const spatial of [false,true,true,false,false,true])assert.equal(pipeline.render(source,target,passes,0,()=>'source',undefined,undefined,spatial?{preserveAlpha:true}:undefined),true);
  assert.deepEqual(modes,[true,false,true]);assert.equal(allocations.length,3);
  assert.deepEqual(programModes,[false,false,true,true,true,true,false,false,false,false,true,true]);
});

test('空间多段 Shader 的中间纹理保持预乘颜色，最终输出遵守实际画布合成属性', () => {
  const values=[],pipeline=new ShaderPipeline();
  pipeline.gl={FRAMEBUFFER:1,ARRAY_BUFFER:2,TEXTURE0:3,TEXTURE_2D:4,TRIANGLE_STRIP:5,
    bindFramebuffer(){},viewport(){},useProgram(){},bindBuffer(){},activeTexture(){},bindTexture(){},drawArrays(){},uniform1f(location,value){values.push([location,value]);}};
  pipeline.setUniforms=()=>{};
  const program={program:{},attributes:{position:-1,texCoord:-1},uniforms:new Map([['rpenOutputStraight',0]]),preserveAlpha:true};
  pipeline.drawQuad(program,{}, {},{},0,800,600,{},[]);pipeline.drawQuad(program,{},null,{},0,800,600,{},[]);
  pipeline.drawQuad({...program,preserveAlpha:false},{},null,{},0,800,600,{},[]);
  pipeline.drawQuad({...program,uniforms:new Map()},{},null,{},0,800,600,{},[]);
  pipeline.outputStraight=false;
  pipeline.drawQuad(program,{},null,{},0,800,600,{},[]);
  pipeline.outputStraight=true;
  pipeline.drawQuad(program,{},null,{},0,800,600,{},[]);
  assert.deepEqual(values,[[0,0],[0,1],[0,0],[0,1]]);
});

test('复用或浏览器提供的 WebGL 上下文以实际合成属性为准，不能假定请求值生效', () => {
  for(const premultipliedAlpha of [true,false]) {
    const pipeline=new ShaderPipeline(),requests=[];
    const gl={createBuffer:()=>({}),bindBuffer(){},bufferData(){},createTexture:()=>({}),createFramebuffer:()=>({}),getContextAttributes:()=>({premultipliedAlpha})};
    pipeline.configureTexture=()=>{};
    const canvas={getContext(kind,options){requests.push([kind,options]);return gl;}};
    assert.equal(pipeline.ensure(canvas),true);
    assert.equal(requests[0][1].premultipliedAlpha,false);
    assert.equal(pipeline.outputStraight,!premultipliedAlpha);
    assert.equal(pipeline.ensure(canvas),true);assert.equal(requests.length,1);
  }
});

test('侧边 shader 与主流程共用程序，缓存上传与模糊结果并保留独立的主视窗纹理', () => {
  const uploads = [], draws = [], allocations = [];
  const pipeline = new ShaderPipeline();
  let textureId = 0;
  pipeline.gl = { TEXTURE0: 0, TEXTURE1: 1, TEXTURE_2D: 2, FRAMEBUFFER: 3, COLOR_ATTACHMENT0: 4, RGBA: 5, UNSIGNED_BYTE: 6,
    createTexture: () => ({ id: textureId++ }), activeTexture() {}, bindTexture() {}, bindFramebuffer() {}, framebufferTexture2D() {},
    texSubImage2D(...args) { uploads.push(args.at(-1)); },
  };
  pipeline.framebuffer = {}; pipeline.configureTexture = () => {};
  pipeline.resizeTexture = (texture, width, height) => allocations.push({ texture, width, height });
  pipeline.compile = (name, source) => ({ name, source });
  pipeline.drawQuad = (program, input, framebuffer, values, seconds, width, height) => draws.push({ name: program.name, input, framebuffer, values, width, height });
  const source = { width: 512, height: 224 }, overlay = { width: 512, height: 224 }, mainTexture = {};
  const filter = { sourceCanvas: source, sourceRevision: 1, overlayCanvas: overlay, blur: 37.5, brightness: .85,
    effects: [{ shader: 'grayscale', global: false, values: {} }, { shader: 'glitch', global: true, values: {} }] };
  const rect = { min: [.2, 0], max: [.8, 1] };
  const render = () => pipeline.drawOverflowFilter(mainTexture, 2400, 1050, 180, rect, [1350, 900], filter, [], effect => effect.shader);
  assert.equal(render(), true);
  assert.deepEqual(uploads, [source, overlay]);
  assert.deepEqual(draws.map(draw => draw.name), ['grayscale', 'overflow-overlay', 'glitch', 'overflow-filter', 'overflow-filter', 'overflow-compose']);
  assert.ok(draws.slice(0, -1).every(draw => draw.width === 512 && draw.height === 224));
  assert.equal(draws.at(-1).input, mainTexture); assert.equal(draws.at(-1).framebuffer, null);
  assert.deepEqual(draws.at(-1).values.filterKeepMin, rect.min);
  const count = allocations.length;
  draws.length = 0;
  render();
  assert.equal(allocations.length, count); assert.equal(uploads.length, 2);
  assert.deepEqual(draws.map(draw => draw.name), ['overflow-compose']);
  filter.sourceRevision++;
  draws.length = 0; render();
  assert.equal(uploads.length, 4); assert.equal(draws.length, 6);
});

test('侧边合成融合到最后一个 shader，中央画面不经过额外全屏中间纹理', () => {
  const draws = [], bindings = [], stages = [];
  const pipeline = new ShaderPipeline();
  pipeline.gl = {
    UNPACK_FLIP_Y_WEBGL: 1, TEXTURE_2D: 2, RGBA: 3, UNSIGNED_BYTE: 4, FRAMEBUFFER: 5, TEXTURE1: 6,
    pixelStorei() {}, bindFramebuffer() {}, framebufferTexture2D() {}, flush() {}, texSubImage2D() {}, activeTexture() {},
    bindTexture(target, texture) { bindings.push(texture); },
  };
  pipeline.sourceTexture = {}; pipeline.pingTexture = {}; pipeline.pongTexture = {}; pipeline.framebuffer = {};
  pipeline.ensure = () => true; pipeline.resizeTexture = () => {};
  pipeline.compile = (name, source, overflow) => ({ name, overflow });
  const filtered = {};
  pipeline.prepareOverflowFilter = () => { stages.push('prepare'); return filtered; };
  pipeline.drawOverflowFilter = () => assert.fail('不应额外进行全屏合成');
  pipeline.drawQuad = (program, input, framebuffer, values) => { stages.push(program.name); draws.push({ program, input, framebuffer, values }); };
  const passes = [{ shader: 'grayscale', values: { factor: 1 } }, { shader: 'vignette', values: { radius: 30 } }];
  const source = { width: 800, height: 600 }, target = { width: 0, height: 0, style: {} };
  const filter = { sourceCanvas: {}, blur: 25, brightness: 0.85, keepInside: true };
  assert.equal(pipeline.render(source, target, passes, 180, pass => pass.shader, undefined, undefined, filter), true);
  assert.deepEqual(stages, ['prepare', 'grayscale', 'vignette']);
  assert.equal(draws[0].framebuffer, pipeline.framebuffer); assert.equal(draws[1].framebuffer, null);
  assert.equal(draws[1].input, pipeline.pingTexture); assert.equal(draws[1].program.overflow, true);
  assert.equal(draws[1].values.rpenOverflowTexture, 1); assert.equal(bindings.at(-1), filtered);
  assert.deepEqual(passes[1].values, { radius: 30 }); assert.equal(pipeline.filterApplied, true);
});

test('融合 shader 仅替换窗口外输出，保留中央采样坐标并兼容 WebGL 两种版本', () => {
  const source = 'varying vec2 uv; uniform sampler2D screenTexture; void main(){gl_FragColor=texture2D(screenTexture,uv);}';
  const normal = fragmentSource(source), merged = fragmentSource(source, false, true), merged2 = fragmentSource(source, true, true);
  assert.doesNotMatch(normal, /rpenOverflowTexture/);
  assert.match(merged, /gl_FragColor = texture2D\(rpenOverflowTexture, v_texCoord\)/);
  assert.match(merged2, /rpeFragColor = texture\(rpenOverflowTexture, v_texCoord\)/);
  assert.match(merged, /rpeSample\(u_texture,rpeCoordinate\)/);
});
import { previewViewport } from '../src/core/editor-display.mjs';

test('原版 Shader 名称和 effects 事件保持可解析并按拍数插值', () => {
  assert.equal(canonicalShaderName('/radialBlur_pr.glsl'), 'radial_blur');
  assert.equal(canonicalShaderName('oldTV'), 'old_tv');
  const chart = createChart();
  chart.effects = [{ start: [0, 0, 1], end: [4, 0, 1], shader: 'grayscale', global: true,
    vars: { factor: [{ startTime: [0, 0, 1], endTime: [4, 0, 1], start: 0, end: 1, easingType: 1 }] } }];
  const runtime = new ShaderRuntime(); runtime.compile(chart, new TempoMap(chart.BPMList));
  const active = runtime.active(0.5);
  assert.equal(active.length, 1);
  assert.equal(active[0].shader, 'grayscale');
  assert.equal(active[0].global, true);
  assert.equal(active[0].values.factor, 0.25);
});

test('Shader 坐标从实际预览矩形映射，兼容横竖比例和两套原始接口', () => {
  for (const ratio of [1.5, 16 / 9, 9 / 16, 1]) {
    const view = previewViewport(1000, 600, ratio); const rect = shaderViewport(view, 1000, 600);
    assert.ok(Math.abs((rect.max[0] - rect.min[0]) * 1000 - view.width) < 1e-8);
    assert.ok(Math.abs((rect.max[1] - rect.min[1]) * 600 - view.height) < 1e-8);
    assert.ok(Math.abs((rect.min[0] + rect.max[0]) / 2 - 0.5) < 1e-8);
  }
  const adapted = fragmentSource('#version 100\nvarying lowp vec2 uv;\nuniform sampler2D screenTexture;\nvoid main(){ gl_FragColor = texture2D(screenTexture, uv); }');
  assert.doesNotMatch(adapted, /varying lowp vec2|screenTexture|#version/);
  assert.match(adapted, /rpeSample\(u_texture, rpeCoordinate\)/);
});

test('Shader 默认值注释不跨行读取，采样数、强度和向量分别解析', () => {
  const source = 'uniform float sampleCount; // %3% int 1..64\r\nuniform float power; // %0.01%\r\nuniform vec4 color; // %1,0.5,0,1%';
  assert.deepEqual(shaderDefaults(source), { sampleCount: 3, power: 0.01, color: [1, 0.5, 0, 1] });
});

test('custom fragment pixel coordinates and screenSize share the preview image domain, independent of canvas padding and DPI', () => {
  const source = 'precision highp float;uniform sampler2D screenTexture;uniform vec2 screenSize;void main(){vec4 pixel=gl_FragCoord;gl_FragColor=texture2D(screenTexture,vec2(pixel.x/screenSize.x,gl_FragCoord.y/screenSize.y));}';
  for (const modern of [false, true]) {
    const adapted = fragmentSource(source, modern);
    assert.match(adapted, /vec4 pixel=rpenFragCoord/); assert.match(adapted, /rpenFragCoord\.y\/screenSize\.y/);
    assert.match(adapted, /rpenFragCoord = vec4\(gl_FragCoord\.xy - rpeRectMin \* rpenSurfaceSize, gl_FragCoord\.zw\)/);
  }
  const pipeline = new ShaderPipeline(), values = new Map(), names = ['screenSize', 'rpenSurfaceSize', 'rpeRectMin', 'rpeRectMax'];
  pipeline.gl = { FLOAT: 1, SAMPLER_2D: 2, INT: 3, BOOL: 4, uniform2fv: (name, value) => values.set(name, value) };
  const program = { builtin: false, uniforms: new Map(names.map(name => [name, name])), types: new Map(), defaults: {} };
  pipeline.setUniforms(program, {}, 0, 1200, 900, { min: [.1, .2], max: [.7, .8] }, [1350, 900]);
  assert.ok(Math.abs(values.get('screenSize')[0] - 720) < 1e-9); assert.ok(Math.abs(values.get('screenSize')[1] - 540) < 1e-9); assert.deepEqual(values.get('rpenSurfaceSize'), [1200, 900]);
  program.builtin = true; pipeline.setUniforms(program, {}, 0, 1200, 900, { min: [.1, .2], max: [.7, .8] }, [1350, 900]);
  assert.deepEqual(values.get('screenSize'), [1350, 900]);
  const builtin = fragmentSource('// @rpen-builtin\n' + source);
  assert.doesNotMatch(builtin, /uniform highp vec2 rpenSurfaceSize/);
});
