import type { JudgeLine } from '../core/types.ts';
import type { PreviewViewport } from '../core/editor-display.ts';
import type { LineState } from '../core/scene.ts';

/**
 * A decoded image as the renderer hands it around.
 *
 * `visual-constants` only exports the sizes, not the image shape, so the structural members this
 * module reads are declared here. The callers legitimately pass more than a bitmap: `preview.ts`
 * draws a `{ source, naturalWidth, naturalHeight }` record as well as a plain `<img>`, and the
 * fallback for the default judge line texture is a literal `{ naturalWidth, naturalHeight }` with
 * no `source` at all. `naturalWidth`/`naturalHeight` are therefore required — every caller supplies
 * them, and `Math.max(1350 / image.naturalWidth, …)` yields `NaN` rather than throwing when they
 * are absent from a live `<img>` that has not decoded yet, which is the behaviour being preserved.
 * `source` is optional because a plain `<img>` is drawn directly.
 */
interface PreviewImage {
  naturalWidth: number;
  naturalHeight: number;
  readonly width?: number;
  readonly height?: number;
  /**
   * The already decoded bitmap; absent for plain `<img>` sources that are drawn directly.
   *
   * Typed `unknown` rather than `CanvasImageSource` on purpose: the value never gets narrowed or
   * used structurally, it is handed straight to `drawImage`, and `CanvasImageSource` is not
   * assignable between its own members under this config, so any narrower type would reject the
   * `{ source, naturalWidth, naturalHeight }` records `platform/images.ts` builds from
   * `createImageBitmap`. This is one of the few places the real type cannot be expressed; see
   * `docs/typescript-migration.md`.
   */
  source?: unknown;
}

/**
 * A value `drawImage` accepts directly at runtime.
 *
 * The DOM lib's `CanvasImageSource` is an alias of the platform classes themselves, not of an
 * interface they share, so a `{ source, naturalWidth, naturalHeight }` record cannot be declared as
 * one. This declares exactly the shape `drawImage` requires from such a value; the binding in
 * {@link PreviewBackground.draw} is what carries the assertion, so no cast is written inline.
 */
interface DrawableSource {
  readonly width: number;
  readonly height: number;
}

/** The members of a sampled line state that {@link textureInViewport} reads. */
type TextureState = Pick<LineState, 'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY'>;

/**
 * Repaints the blurred chart background into an offscreen canvas, and reuses that canvas while the
 * image, size, scale, blur and DPI ratio all stay the same.
 *
 * Fields are declared explicitly rather than inferred from the assignments in `draw`/`clear`: the
 * initial values are `null`, so inference would narrow them to `never` and break `this.image !== image`.
 */
export class PreviewBackground {
  image: PreviewImage | null = null;
  key: string | null = null;
  canvas: HTMLCanvasElement | null = null;

  draw(context: CanvasRenderingContext2D, image: PreviewImage, width: number, height: number, scale: number, blur: number, ratio: number, animated = false): void {
    const paint = (target: CanvasRenderingContext2D): void => {
      const size = Math.max(1350 / image.naturalWidth, 900 / image.naturalHeight) * scale;
      // `image.source ?? image` keeps its original runtime meaning: the decoded bitmap when there is
      // one, otherwise an image object that is a live drawable `<img>` in the browser, and a plain
      // `{ naturalWidth, naturalHeight }` literal in the test suite, which only ever inspects the
      // context's calls. A decoded record is `DrawableSource` structurally — `platform/images.ts`
      // builds it from `createImageBitmap`, whose bitmap carries `width`/`height` — but a plain
      // `<img>` is a different platform class, and the two source shapes are not mutually assignable
      // under this config. That one genuine gap is closed here on a single binding; the
      // `drawImage` call below is written out verbatim.
      const source: DrawableSource = (image.source ?? image) as DrawableSource;
      target.filter = blur > 0 ? `blur(${blur}px)` : 'none';
      target.drawImage(source as CanvasImageSource, (width - image.naturalWidth * size) / 2, (height - image.naturalHeight * size) / 2, image.naturalWidth * size, image.naturalHeight * size);
      target.filter = 'none';
    };
    if (animated || typeof document === 'undefined') { paint(context); return; }
    const key = `${width}:${height}:${scale}:${blur}:${ratio}`;
    if (this.image !== image || this.key !== key) {
      let canvas = this.canvas;
      if (!canvas) { canvas = document.createElement('canvas'); this.canvas = canvas; }
      canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
      const target = canvas.getContext('2d');
      // `getContext('2d')` on a freshly created canvas always yields a context in a browser, and the
      // previous code relied on that by using the result unguarded. There is no type-level proof of
      // it, so narrow explicitly — the throw is unreachable in practice and never runs in tests,
      // where the fake `document.createElement` returns a stub context.
      if (!target) throw new Error('2D 上下文不可用');
      target.setTransform(ratio, 0, 0, ratio, 0, 0);
      paint(target); this.image = image; this.key = key;
    }
    if (!this.canvas) throw new Error('2D 上下文不可用');
    context.drawImage(this.canvas, 0, 0, this.canvas.width / ratio, this.canvas.height / ratio);
  }

  clear(): void { this.image = null; this.canvas = null; this.key = null; }
}

/**
 * Whether a judge line's texture touches the preview viewport, accounting for the line anchor,
 * rotation and negative scaling.
 *
 * `line` only needs `anchor`, so it is typed as that single property: the callers pass a full
 * `JudgeLine` while the test suite passes a bare `{ anchor: [0, 1] }`.
 */
export function textureInViewport(texture: PreviewImage, line: Pick<JudgeLine, 'anchor'>, state: TextureState, width: number, height: number, scale: number, viewport: PreviewViewport): boolean {
  const anchor = line.anchor ?? [0.5, 0.5];
  const left = -texture.naturalWidth * anchor[0] * scale * state.scaleX;
  const right = texture.naturalWidth * (1 - anchor[0]) * scale * state.scaleX;
  const top = -texture.naturalHeight * (1 - anchor[1]) * scale * state.scaleY;
  const bottom = texture.naturalHeight * anchor[1] * scale * state.scaleY;
  const angle = state.rotation * Math.PI / 180; const cosine = Math.cos(angle); const sine = Math.sin(angle);
  const horizontal = width / 2 + state.x * scale; const vertical = height / 2 - state.y * scale;
  const minimumX = horizontal + Math.min(left * cosine, right * cosine) + Math.min(-top * sine, -bottom * sine);
  const maximumX = horizontal + Math.max(left * cosine, right * cosine) + Math.max(-top * sine, -bottom * sine);
  const minimumY = vertical + Math.min(left * sine, right * sine) + Math.min(top * cosine, bottom * cosine);
  const maximumY = vertical + Math.max(left * sine, right * sine) + Math.max(top * cosine, bottom * cosine);
  return maximumX >= viewport.left - 1 && minimumX <= viewport.left + viewport.width + 1
    && maximumY >= viewport.top - 1 && minimumY <= viewport.top + viewport.height + 1;
}
