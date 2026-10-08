import { ShaderPipeline } from '../ui/shader-pipeline.ts';
import { SHADER_NAMES } from '../core/shader.ts';
import { previewViewport } from '../core/editor-display.ts';
import { assetUrl } from '../core/asset-url.ts';

const results = document.querySelector<HTMLElement>('#results')!;
// The harness owns these elements in preview-regression.html, so they are non-null by construction.
const source = document.querySelector<HTMLCanvasElement>('#source')!;
const output = document.querySelector<HTMLCanvasElement>('#output')!;
const pipeline = new ShaderPipeline();
const context = source.getContext('2d')!;
// The harness renders a fixed 600x400 image regardless of how the page is laid out, so the canvas'
// measured box is overridden. Only `width`/`height` are read downstream, but the assignment must
// still produce a DOMRect, so the remaining members are filled in from the real rect.
source.getBoundingClientRect = () => {
  const rect = DOMRect.fromRect({ width: 600, height: 400 });
  return rect;
};
const messages: string[] = [];
let failures = 0;
const check = (condition: unknown, description: string): void => { messages.push(`${condition ? 'PASS' : 'FAIL'} ${description}`); if (!condition) failures++; };
try {
  if (!pipeline.ensure(output)) throw new Error('WebGL 不可用');
  const sources = new Map<string, string>();
  const names = [...SHADER_NAMES, ...SHADER_NAMES.slice(20).map(name => `pr/${name}_pr`)];
  for (const name of names) {
    const response = await fetch(assetUrl(`rpe/shaders/${name}.glsl`));
    if (!response.ok) throw new Error(`缺少素材 ${name}`);
    sources.set(name, await response.text());
    const compiled = pipeline.compile(name, sources.get(name)!);
    check(Boolean(compiled), `编译 ${name}${compiled ? '' : ': ' + pipeline.lastError}`);
  }
  // `ensure` returned true above, so a context exists; the harness fails fast otherwise.
  const gl = pipeline.gl!;
  const pixel = (horizontal: number, vertical: number): number[] => {
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
  check(doublePass[0] < singlePass[0] - 20 && doublePass[1] > singlePass[1] + 10 && doublePass[3] === 255, `同类 shader 独立累积 ${singlePass} → ${doublePass}`);
  for (const name of names) {
    context.fillStyle = '#e06020'; context.fillRect(0, 0, 600, 400);
    const rendered = pipeline.render(source, output, [{ shader: name, values: {} }], 0.3, pass => sources.get(pass.shader), previewViewport(600, 400));
    check(rendered && gl.getError() === gl.NO_ERROR, `执行 ${name}`);
  }
  for (const ratio of [1.5, 16 / 9, 9 / 16, 1]) {
    const view = previewViewport(600, 400, ratio);
    context.clearRect(0, 0, 600, 400);
    context.fillStyle = '#f00000'; context.fillRect(view.left, view.top, view.width, view.height);
    const passes = [1, 2, 3].map(() => ({ shader: 'grayscale', values: { factor: 1 } }));
    pipeline.render(source, output, passes, 0, pass => sources.get(pass.shader), view);
    for (const [horizontal, vertical] of [[view.left + 3, view.top + 3], [view.left + view.width - 4, view.top + view.height - 4], [300, 200]]) {
      const color = pixel(horizontal, vertical);
      check(Math.abs(color[0] - color[1]) <= 1 && color[0] > 50 && color[3] === 255, `比例 ${ratio.toFixed(3)} 三通道灰度边缘 ${horizontal.toFixed(0)},${vertical.toFixed(0)} ${color}`);
    }
    if (view.left > 2 || view.top > 2) check(pixel(0, 0)[3] === 0, `比例 ${ratio.toFixed(3)} 不覆盖黑边`);
    context.fillStyle = '#0000ff'; context.fillRect(300, view.top, view.width / 2, view.height);
    for (const shader of ['camera', 'pr/camera_pr']) {
      pipeline.render(source, output, [{ shader, values: { zoom: 1, offset: [0, 0], rotation: 0 } }], 0, pass => sources.get(pass.shader), view);
      const left = pixel(300 - view.width / 4, 200); const right = pixel(300 + view.width / 4, 200);
      check(left[0] > 200 && left[2] < 5 && right[2] > 200 && right[0] < 5, `比例 ${ratio.toFixed(3)} ${shader} 中心和两侧不偏移`);
    }
    check(gl.getError() === gl.NO_ERROR, `比例 ${ratio.toFixed(3)} WebGL 无错误`);
    const chain = [{ shader: 'vignette', values: { extend: 0.25, radius: 10 } }, { shader: 'pr/rain_pr', values: { density: 5, rainColor: [127, 127, 255, 255] } }, { shader: 'chromatic', values: { power: 0.0031 } }];
    for (let count = 1; count <= chain.length; count++) {
      pipeline.render(source, output, chain.slice(0, count), 37.93, pass => sources.get(pass.shader), view);
      const color = pixel(300 - view.width / 4, 200);
      check(color[0] > 100, `组合 ${count} ${color}`);
      if (count === 3 && ratio === 1.5) {
        // The shader was compiled earlier in this run, so both lookups are populated; the check
        // reports a failure rather than throwing if that ever stops holding.
        const program = pipeline.compile('chromatic', sources.get('chromatic')!);
        check(program !== null && gl.getUniform(program.program, program.uniforms.get('sampleCount')!) === 3, '原版色差默认采样数 3');
        pipeline.render(source, output, [chain[2]], 37.93, pass => sources.get(pass.shader), view);
        check(pixel(150, 200)[0] > 100, '单独色差效果不会因缺失采样数黑屏');
      }
    }
    for (let frame = 0; frame < 3; frame++) {
      pipeline.render(source, output, chain, 37.93, pass => sources.get(pass.shader), view);
      const center = pixel(300 - view.width / 4, 200);
      check(center[0] > 100, `比例 ${ratio.toFixed(3)} 原谱三种效果叠加 帧 ${frame}: ${center}`);
    }
  }
} catch (error) { failures++; messages.push(`FAIL ${error instanceof Error ? error.stack : String(error)}`); }
results.textContent = `${failures ? '失败' : '全部通过'}：${messages.length} 项，${failures} 项失败\n${messages.join('\n')}`;
document.title = `预览回归：${failures ? '失败' : '通过'}`;
