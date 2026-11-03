// 渲染器专用的噪域适配层。
//
// 宿主 NoisePreview / NoiseSkinRenderer 的默认行为属于编辑器预览，这里一个都
// 不去改：
// - 几何：用 NoisePreview.transformGeometry 钩子，在渲染器自己的预览实例上
//   按 R(-r) → S → R 缩放，编辑器预览仍走原来的 previewNoiseGeometry；
// - 皮肤：用 noise-skin-renderer 的 overlay 模式，只把噪域变化过的像素叠回
//   场景与 HUD 之上，编辑器仍用原来的整帧覆盖路径；
// - 默认皮肤：只作用在传给 draw 的谱面副本上，不写 NoisePreview.defaultSkin。
import { noiseLayers } from '../../core/noise-skin.mjs';
import { NoiseSkinRenderer } from '../noise-skin-renderer.mjs';

/**
 * 噪域几何：3:2 舞台 → 游玩区。
 * 只缩放噪域自身的长宽（局部轴）与中心，旋转角保持不变。
 * noise-areas 的 rotate() 是 R(-θ)（屏幕 y 向下），所以先取它的逆回到局部坐标。
 */
export function scaledNoiseGeometry(sample, positionScale) {
  if (!sample || !positionScale || positionScale.x === 1 && positionScale.y === 1) return sample;
  const center = { x: sample.center.x * positionScale.x, y: sample.center.y * positionScale.y };
  const rotation = Number(sample.rotation) || 0;
  const cos = Math.cos(rotation), sin = Math.sin(rotation);
  const points = sample.points.map(point => {
    const deltaX = point.x - sample.center.x, deltaY = point.y - sample.center.y;
    const localX = cos * deltaX - sin * deltaY, localY = sin * deltaX + cos * deltaY;
    const scaledX = localX * positionScale.x, scaledY = localY * positionScale.y;
    return { x: center.x + cos * scaledX + sin * scaledY, y: center.y - sin * scaledX + cos * scaledY };
  });
  return { ...sample, points, center, rotation };
}

/** 没写 skin 的噪域层补上默认皮肤；谱面本身不改。 */
export function withDefaultNoiseSkin(chart, skin) {
  if (!skin || !chart) return chart;
  const layers = noiseLayers(chart);
  if (!layers.length) return chart;
  return { ...chart, noiseAreaLayers: layers.map(layer => layer.skin ? layer : { ...layer, skin }) };
}

/**
 * 把渲染器的预览接到 overlay 噪域渲染器上。
 * positionScale 是 3:2 舞台到游玩区的比例，由渲染器按当前画幅给出。
 */
export function attachStudioNoise(preview, { positionScale = () => ({ x: 1, y: 1 }), report } = {}) {
  const target = preview?.noisePreview;
  if (!target || typeof target.draw !== 'function') return null;
  let defaultSkin = null;
  const originalDraw = target.draw;
  const renderer = new NoiseSkinRenderer(() => preview.invalidate?.(), report, { overlay: true });
  target.gpu?.dispose?.();
  target.gpu = renderer;
  target.forceSimple = false;
  target.draw = function draw(context, chart, tempo, seconds, width, height, scale, selected, viewport, options = {}) {
    const previous = this.transformGeometry;
    this.transformGeometry = entry => scaledNoiseGeometry(entry, positionScale());
    try {
      // positionScale 交给宿主会把矩形剪成平行四边形，缩放在 transformGeometry 里做。
      originalDraw.call(this, context, withDefaultNoiseSkin(chart, defaultSkin), tempo, seconds, width, height, scale, selected, viewport,
        { ...options, positionScale: null });
    } finally {
      this.transformGeometry = previous;
    }
  };
  return { renderer, setDefaultSkin(skin) { defaultSkin = skin; } };
}
