// 渲染器专用的噪域适配层。
//
// - 几何：与编辑器共用 previewNoiseGeometry，保留后续摄像机投影钩子；
// - 皮肤：用 noise-skin-renderer 的 overlay 模式，只把噪域变化过的像素叠回
//   场景与 HUD 之上，编辑器仍用原来的整帧覆盖路径；
// - 默认皮肤：只作用在传给 draw 的谱面副本上，不写 NoisePreview.defaultSkin。
import { noiseLayers } from '../../core/noise-skin.mjs';
import { NoiseSkinRenderer } from '../noise-skin-renderer.mjs';
export { previewNoiseGeometry as scaledNoiseGeometry } from '../../core/editor-display.mjs';

/** 没写 skin 的噪域层补上默认皮肤；谱面本身不改。 */
export function withDefaultNoiseSkin(chart, skin) {
  if (!skin || !chart) return chart;
  const layers = noiseLayers(chart);
  if (!layers.length) return chart;
  return { ...chart, noiseAreaLayers: layers.map(layer => layer.skin ? layer : { ...layer, skin }) };
}

/**
 * 把渲染器的预览接到 overlay 噪域渲染器上。
 * 几何由共用 NoisePreview 处理，不能覆盖 transformGeometry 或重复缩放。
 */
export function attachStudioNoise(preview, { report } = {}) {
  const target = preview?.noisePreview;
  if (!target || typeof target.draw !== 'function') return null;
  let defaultSkin = null;
  const originalDraw = target.draw;
  const renderer = new NoiseSkinRenderer(() => preview.invalidate?.(), report, { overlay: true });
  target.gpu?.dispose?.();
  target.gpu = renderer;
  target.forceSimple = false;
  let sourceChart, sourceSkin, patchedChart;
  target.draw = function draw(context, chart, tempo, seconds, width, height, scale, selected, viewport, options = {}) {
    if (sourceChart !== chart || sourceSkin !== defaultSkin) {
      sourceChart = chart; sourceSkin = defaultSkin; patchedChart = withDefaultNoiseSkin(chart, defaultSkin);
    }
    return originalDraw.call(this, context, patchedChart, tempo, seconds, width, height, scale, selected, viewport, options);
  };
  return { renderer, setDefaultSkin(skin) { defaultSkin = skin; } };
}
