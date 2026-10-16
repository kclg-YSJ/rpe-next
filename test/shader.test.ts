import test from 'node:test';
import assert from 'node:assert/strict';
import { createChart } from '../src/core/chart.ts';
import { TempoMap } from '../src/core/tempo.ts';
import { canonicalShaderName, ShaderRuntime } from '../src/core/shader.ts';
import { shaderViewport, fragmentSource, shaderDefaults } from '../src/ui/shader-pipeline.ts';
import { previewViewport } from '../src/core/editor-display.ts';

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
