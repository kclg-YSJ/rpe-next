import test from 'node:test';
import assert from 'node:assert/strict';
import { NoiseSkinRenderer } from '../src/ui/noise-skin-renderer.mjs';

test('皮肤 uniform 复用稳定值，向量原地修改和多 Pass 不同常量仍会更新', () => {
  const calls = [];
  const gl = { INT: 1, BOOL: 2, SAMPLER_2D: 3, FLOAT_VEC2: 4, FLOAT_VEC4: 5, FLOAT: 6 };
  for (const method of ['uniform1i', 'uniform2fv', 'uniform4fv', 'uniform1f']) gl[method] = (location, value) => calls.push([method, location, typeof value === 'number' ? value : [...value]]);
  const renderer = Object.assign(Object.create(NoiseSkinRenderer.prototype), { gl });
  const program = { uniforms: new Map([['sampler', { location: 'sampler', type: gl.SAMPLER_2D }], ['size', { location: 'size', type: gl.FLOAT_VEC2 }], ['weight', { location: 'weight', type: gl.FLOAT }]]) };
  const size = [640, 480];
  for (let frame = 0; frame < 120; frame++) { renderer.uniform(program, 'sampler', 0); renderer.uniform(program, 'size', size); renderer.uniform(program, 'weight', 0.5); }
  assert.equal(calls.length, 3);
  size[0] = 800; renderer.uniform(program, 'size', size); renderer.uniform(program, 'weight', 0.75); renderer.uniform(program, 'weight', 0.5); renderer.uniform(program, 'sampler', 1);
  assert.deepEqual(calls.slice(3), [['uniform2fv', 'size', [800, 480]], ['uniform1f', 'weight', 0.75], ['uniform1f', 'weight', 0.5], ['uniform1i', 'sampler', 1]]);
});

test('全屏顶点不会逐 Pass 上传，几何缓冲仅在容量增长时重新分配', () => {
  const allocations = [], uploads = [], buffers = [];
  const gl = { ARRAY_BUFFER: 1, DYNAMIC_DRAW: 2, FLOAT: 3, FRAMEBUFFER: 4, bindFramebuffer() {}, viewport() {}, useProgram() {}, enableVertexAttribArray() {}, vertexAttribPointer() {}, bindBuffer: (kind, buffer) => buffers.push(buffer), bufferData: (kind, bytes) => allocations.push(bytes), bufferSubData: (kind, offset, data) => uploads.push([...data]) };
  const renderer = Object.assign(Object.create(NoiseSkinRenderer.prototype), { gl, canvas: { width: 640, height: 480 }, quad: new Float32Array(12), quadBuffer: 'quad', buffer: 'geometry', vertexCapacity: 0 });
  for (let pass = 0; pass < 30; pass++) renderer.bind({ position: 0 }, null);
  assert.equal(allocations.length, 0); assert.ok(buffers.every(buffer => buffer === 'quad'));
  const vertices = new Float32Array([1, 2, 3, 4]);
  for (let frame = 0; frame < 30; frame++) renderer.bind({ position: 0 }, null, vertices);
  assert.equal(allocations.length, 1); assert.equal(uploads.length, 30); assert.deepEqual(uploads[0], [...vertices]);
  renderer.bind({ position: 0 }, null, new Float32Array(512)); assert.equal(allocations.length, 2);
});

test('皮肤仅裁剪无依赖方向的余量，最终合成恢复完整视口且不影响几何模板', () => {
  const calls=[],uniforms=[];
  const gl={SCISSOR_TEST:1,ARRAY_BUFFER:2,FLOAT:3,FRAMEBUFFER:4,bindFramebuffer(){},viewport(){},useProgram(){},enableVertexAttribArray(){},vertexAttribPointer(){},bindBuffer(){},enable:v=>calls.push(['enable',v]),disable:v=>calls.push(['disable',v]),scissor:(...rect)=>calls.push(['rect',...rect])};
  const renderer=Object.assign(Object.create(NoiseSkinRenderer.prototype),{gl,canvas:{width:400,height:300},quad:new Float32Array(12),guardSides:1|8,uniform:(program,name,value)=>uniforms.push([name,value])});
  const target={width:464,height:364,padding:[32,32],logicalSize:[400,300],outputRect:[-.08,-32/300,1.16,364/300]};
  renderer.bind({position:0,guarded:true,uniforms:new Map()},target);
  assert.deepEqual(calls,[['enable',1],['rect',0,32,432,332]]);
  assert.deepEqual(uniforms.find(([name])=>name==='rpenGuardLogicalSize'),['rpenGuardLogicalSize',[400,300]]);
  renderer.bind({position:0,guarded:false},target);
  assert.deepEqual(calls.at(-1),['disable',1]);
  renderer.bind({position:0,guarded:true},null);
  assert.deepEqual(calls.at(-1),['disable',1]);
});

test('播放复用捕获画布和历史纹理，同刻重绘恢复历史输入，跳转和参数变化清空历史', () => {
  const events = [], sizes = []; let allocated = 0;
  const capture = { getContext() { assert.fail('稳定播放不应反复获取上下文'); } };
  for (const field of ['width', 'height']) { let value = 0; Object.defineProperty(capture, field, { get: () => value, set: next => { value = next; sizes.push([field, next]); } }); }
  const front = { width: 64, height: 64, format: 'rgba8' };
  const instance = { targets: new Map([['history', { spec: { noClear: true }, front }]]), history: new Map(), screens: [{ texture: 'input' }, { texture: 'output' }], passes: [], resources: [] };
  const gl = {};
  for (const method of ['disable', 'colorMask', 'bindTexture', 'pixelStorei', 'texSubImage2D']) gl[method] = () => {};
  const renderer = Object.assign(Object.create(NoiseSkinRenderer.prototype), {
    gl, canvas: { width: 64, height: 64 }, capture, maximum: 1024, errors: new Set(),
    captureContext: { clearRect() { events.push('capture-clear'); }, drawImage() {} },
    skin: () => ({ definition: { parameters: [{ name: 'amount', type: 'float', value: 1 }] } }),
    instance: () => instance, geometryMask() {},
    texture() { allocated++; return { id: 'snapshot' }; },
    blit(source, target) { if (target) events.push(source === front ? 'save-history' : 'restore-history'); },
    clear() { events.push('clear-history'); },
    destroy(target) { events.push('destroy-' + target.id); },
  });
  const context = { canvas: { width: 64 }, save() {}, restore() {}, clearRect() {}, drawImage() {} };
  const layer = { skin: 'shader/Test', parameters: {} }, viewport = { left: 0, top: 0, width: 64, height: 64 };
  for (const seconds of [0, 0.1, 0.1, 0.2, -1]) assert.equal(renderer.render(context, layer, new Map(), [], seconds, viewport, 1, 64, 64), true);
  assert.equal(allocated, 1); assert.deepEqual(sizes, [['width', 64], ['height', 64]]);
  assert.equal(events.filter(event => event === 'restore-history').length, 1);
  assert.equal(events.filter(event => event === 'save-history').length, 4);
  assert.equal(events.filter(event => event === 'clear-history').length, 1);
  layer.parameters.amount = 2;
  assert.equal(renderer.render(context, layer, new Map(), [], -1, viewport, 1, 64, 64), true);
  assert.equal(events.filter(event => event === 'clear-history').length, 2);
  assert.equal(instance.parameters.get('amount'), 2);
  renderer.disposeInstance(instance); assert.equal(events.filter(event => event === 'destroy-snapshot').length, 1);
});
