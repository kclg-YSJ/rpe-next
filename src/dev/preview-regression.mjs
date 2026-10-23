import { ShaderPipeline } from '../ui/shader-pipeline.mjs';
import { SHADER_NAMES } from '../core/shader.mjs';
import { previewViewport } from '../core/editor-display.mjs';
import { assetUrl } from '../core/asset-url.mjs';
import { t } from '../i18n.mjs';

const results = document.querySelector('#results');
const source = document.querySelector('#source');
const output = document.querySelector('#output');
const pipeline = new ShaderPipeline();
const context = source.getContext('2d');
source.getBoundingClientRect = () => ({ width: 600, height: 400 });
const messages = [];
let failures = 0;
const check = (condition, description) => { messages.push(`${condition ? 'PASS' : 'FAIL'} ${description}`); if (!condition) failures++; };
try {
  if (!pipeline.ensure(output)) throw new Error(t('preview-regression.s652bd05'));
  const sources = new Map();
  const names = [...SHADER_NAMES, ...SHADER_NAMES.slice(20).map(name => `pr/${name}_pr`)];
  for (const name of names) {
    const response = await fetch(assetUrl(`rpe/shaders/${name}.glsl`));
    if (!response.ok) throw new Error(t('preview-regression.sd7823f5', { p0: name }));
    sources.set(name, await response.text());
    const compiled = pipeline.compile(name, sources.get(name));
    check(Boolean(compiled), t('preview-regression.s9a7b508', { p0: name, p1: compiled ? '' : ': ' + pipeline.lastError }));
  }
  const gl = pipeline.gl;
  const pixel = (horizontal, vertical) => {
    const bytes = new Uint8Array(4);
    gl.readPixels(Math.floor(horizontal), 399 - Math.floor(vertical), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    return [...bytes];
  };
  context.fillStyle = '#f00000'; context.fillRect(0, 0, 600, 400);
  const repeated = { shader: 'grayscale', values: { factor: 0.5 } };
  pipeline.render(source, output, [repeated], 0, pass => sources.get(pass.shader), previewViewport(600, 400));
  const singlePass = pixel(300, 200);
  pipeline.render(source, output, [repeated, repeated], 0, pass => sources.get(pass.shader), previewViewport(600, 400));
  const doublePass = pixel(300, 200);
  check(doublePass[0] < singlePass[0] - 20 && doublePass[1] > singlePass[1] + 10 && doublePass[3] === 255, t('preview-regression.s67c2445', { p0: singlePass, p1: doublePass }));
  for (const name of names) {
    context.fillStyle = '#e06020'; context.fillRect(0, 0, 600, 400);
    const rendered = pipeline.render(source, output, [{ shader: name, values: {} }], 0.3, pass => sources.get(pass.shader), previewViewport(600, 400));
    check(rendered && gl.getError() === gl.NO_ERROR, t('preview-regression.s3adc5dc', { p0: name }));
  }
  for (const ratio of [1.5, 16 / 9, 9 / 16, 1]) {
    const view = previewViewport(600, 400, ratio);
    context.clearRect(0, 0, 600, 400);
    context.fillStyle = '#f00000'; context.fillRect(view.left, view.top, view.width, view.height);
    const passes = [1, 2, 3].map(() => ({ shader: 'grayscale', values: { factor: 1 } }));
    pipeline.render(source, output, passes, 0, pass => sources.get(pass.shader), view);
    for (const [horizontal, vertical] of [[view.left + 3, view.top + 3], [view.left + view.width - 4, view.top + view.height - 4], [300, 200]]) {
      const color = pixel(horizontal, vertical);
      check(Math.abs(color[0] - color[1]) <= 1 && color[0] > 50 && color[3] === 255, t('preview-regression.sf749232', { p0: ratio.toFixed(3), p1: horizontal.toFixed(0), p2: vertical.toFixed(0), p3: color }));
    }
    if (view.left > 2 || view.top > 2) check(pixel(0, 0)[3] === 0, t('preview-regression.s4dbae3f', { p0: ratio.toFixed(3) }));
    context.fillStyle = '#0000ff'; context.fillRect(300, view.top, view.width / 2, view.height);
    for (const shader of ['camera', 'pr/camera_pr']) {
      pipeline.render(source, output, [{ shader, values: { zoom: 1, offset: [0, 0], rotation: 0 } }], 0, pass => sources.get(pass.shader), view);
      const left = pixel(300 - view.width / 4, 200); const right = pixel(300 + view.width / 4, 200);
      check(left[0] > 200 && left[2] < 5 && right[2] > 200 && right[0] < 5, t('preview-regression.s6a2122e', { p0: ratio.toFixed(3), p1: shader }));
    }
    check(gl.getError() === gl.NO_ERROR, t('preview-regression.s4b59a2a', { p0: ratio.toFixed(3) }));
    const chain = [{ shader: 'vignette', values: { extend: 0.25, radius: 10 } }, { shader: 'pr/rain_pr', values: { density: 5, rainColor: [127, 127, 255, 255] } }, { shader: 'chromatic', values: { power: 0.0031 } }];
    for (let count = 1; count <= chain.length; count++) {
      pipeline.render(source, output, chain.slice(0, count), 37.93, pass => sources.get(pass.shader), view);
      const color = pixel(300 - view.width / 4, 200);
      check(color[0] > 100, t('preview-regression.s74db5eb', { p0: count, p1: color }));
      if (count === 3 && ratio === 1.5) {
        const program = pipeline.compile('chromatic', sources.get('chromatic'));
        check(gl.getUniform(program.program, program.uniforms.get('sampleCount')) === 3, t('preview-regression.s77745af'));
        pipeline.render(source, output, [chain[2]], 37.93, pass => sources.get(pass.shader), view);
        check(pixel(150, 200)[0] > 100, t('preview-regression.s8322b03'));
      }
    }
    for (let frame = 0; frame < 3; frame++) {
      pipeline.render(source, output, chain, 37.93, pass => sources.get(pass.shader), view);
      const center = pixel(300 - view.width / 4, 200);
      check(center[0] > 100, t('preview-regression.s9d2c1e3', { p0: ratio.toFixed(3), p1: frame, p2: center }));
    }
  }
} catch (error) { failures++; messages.push(`FAIL ${error.stack}`); }
results.textContent = t('preview-regression.sc057145', { p0: failures ? t('preview-regression.s3e3c806') : t('preview-regression.s3b6e5a1'), p1: messages.length, p2: failures, p3: messages.join('\n') });
document.title = t('preview-regression.s8222eed', { p0: failures ? t('preview-regression.s3e3c806') : t('preview-regression.sdcc4233') });
