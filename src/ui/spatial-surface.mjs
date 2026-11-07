import { ShaderPipeline } from './shader-pipeline.mjs';

// A transformed transparent WebGL canvas must carry premultiplied colour all
// the way into browser composition. Keep the ordinary preview context intact.
export class SpatialShaderSurface {
  constructor(renderer) {
    this.renderer = renderer;
    this.originalCanvas = renderer.shaderCanvas;
    this.originalPipeline = renderer.shaderPipeline;
    this.canvas = this.originalCanvas.cloneNode(false);
    this.canvas.style.visibility = 'hidden';
    this.pipeline = new ShaderPipeline(() => renderer.invalidate?.(), { premultipliedAlpha: true });
    this.pipeline.report = message => renderer.shaderRuntime.report(message);
    this.originalCanvas.replaceWith(this.canvas);
    renderer.shaderCanvas = this.canvas;
    renderer.shaderPipeline = this.pipeline;
  }
  restore() {
    if (this.restored) return;
    this.restored = true;
    const renderer = this.renderer;
    if (renderer.shaderCanvas === this.canvas) {
      this.canvas.replaceWith(this.originalCanvas);
      renderer.shaderCanvas = this.originalCanvas;
    }
    if (renderer.shaderPipeline === this.pipeline) renderer.shaderPipeline = this.originalPipeline;
    this.pipeline.dispose();
    renderer.invalidate?.();
  }
}
