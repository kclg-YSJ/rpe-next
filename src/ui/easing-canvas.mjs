import { editorSkinContext } from './editor-skin-canvas.mjs';

// Drawing and hit testing share this logical viewport. CSS may resize it, but
// both axes use one scale and the backing store follows the display's density.
export const EASING_VIEW = { width: 260, height: 100, left: 10, bottom: 80, plotWidth: 240, plotHeight: 60 };

export function createEasingCanvas(canvas, role, paint) {
  const view = EASING_VIEW;
  canvas.width = view.width; canvas.height = view.height;
  const layout = () => {
    const rect = canvas.getBoundingClientRect();
    const width = rect.width ? rect.width - (canvas.clientLeft || 0) * 2 : view.width;
    const height = rect.height ? rect.height - (canvas.clientTop || 0) * 2 : view.height;
    const scale = Math.min(width / view.width, height / view.height);
    return { rect, width, height, scale, x: (width - view.width * scale) / 2, y: (height - view.height * scale) / 2 };
  };
  const draw = () => {
    const { width, height, scale, x, y } = layout();
    const ratio = globalThis.devicePixelRatio || 1;
    const pixelWidth = Math.max(1, Math.round(width * ratio)), pixelHeight = Math.max(1, Math.round(height * ratio));
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    const context = editorSkinContext(canvas.getContext('2d'), role);
    context.setTransform(1, 0, 0, 1, 0, 0); context.clearRect(0, 0, canvas.width, canvas.height);
    context.setTransform(scale * pixelWidth / width, 0, 0, scale * pixelHeight / height, x * pixelWidth / width, y * pixelHeight / height);
    context.save(); paint(context); context.restore();
  };
  const point = pointer => {
    const { rect, scale, x, y } = layout();
    return { x: (pointer.clientX - rect.left - (canvas.clientLeft || 0) - x) / scale,
      y: (pointer.clientY - rect.top - (canvas.clientTop || 0) - y) / scale };
  };
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(draw);
  observer?.observe(canvas);
  let density;
  const watchDensity = () => {
    density?.removeEventListener('change', onDensity);
    density = globalThis.window?.matchMedia?.(`(resolution: ${globalThis.devicePixelRatio || 1}dppx)`);
    density?.addEventListener('change', onDensity);
  };
  const onDensity = () => { draw(); watchDensity(); };
  watchDensity(); draw();
  return { draw, point, dispose: () => { observer?.disconnect(); density?.removeEventListener('change', onDensity); } };
}
