import { assetUrl } from '../core/asset-url.ts';
import type { Color, NoteType } from '../core/types.ts';

/**
 * The hit-effect frames `load` preloads, and the note texture each note kind draws its head from.
 *
 * `Record<NoteType, string>` keeps the numeric keys tied to the four note kinds **without adding
 * any key at runtime**: `as const` only narrows the literal type, and a type assertion is erased, so
 * the object that reaches `Object.values` is the same one as before.
 */
const names = { 1: 'Tap2', 2: 'HoldHead', 3: 'Flick2', 4: 'Drag2' } as const satisfies Record<NoteType, string>;
const highlights = { 1: 'Tap2HL', 2: 'HoldHeadHL', 3: 'Flick2HL', 4: 'DragHL' } as const satisfies Record<NoteType, string>;

/**
 * The callers hand in more than one kind of picture, so the members this module reads are declared
 * here and no member is required: `load` stores decoded `<img>` elements that carry both sizes,
 * `preview.ts` passes the `{ source, naturalWidth, naturalHeight }` records built in
 * `platform/images.ts` (the texture itself, which most of the drawing happens on, is the optional
 * `source`), and `timeline.ts` supplies a bare `{ naturalWidth, naturalHeight }` literal with no
 * `source` at all. Nothing reads a size in `tintedSource` without the `?? source.width` fallback
 * that is already in the code, so a partial shape is the accurate one.
 */
interface SkinImage {
  readonly naturalWidth?: number;
  readonly naturalHeight?: number;
  readonly width?: number;
  readonly height?: number;
  /** The already decoded bitmap, when the record wraps one instead of being drawn directly. */
  readonly source?: SkinImage;
}

/**
 * Whatever `tinted`/`tintedSource` hand back to `drawImage`: an `<img>` from `images` in the common
 * case, or the offscreen canvas `tinted` paints. Callers pass the result straight to `drawImage` or
 * forward it back into `tintedSource`, and the test suite substitutes plain stand-ins, so only the
 * members that path reads are declared.
 */
export interface DrawableImage extends SkinImage {
  readonly source?: SkinImage;
  /** Cleared by `platform/images.ts` when it releases a decoded record. */
  close?: () => void;
}

/**
 * The decoded artwork the RPE note textures are drawn from, plus the small tinted canvases derived
 * from them.
 *
 * Every field is declared explicitly: `images`/`tints`/`sourceIds` start as empty collections in the
 * constructor, so inference would narrow them to the empty `Map`/`WeakMap` types and every use would
 * fail; the key and value types are also load-bearing for `preview.ts` and `timeline.ts`.
 */
export class RpeSkin {
  /** Texture name to decoded picture, filled by `load`. */
  images: Map<string, SkinImage>;
  /** Cache key to tinted canvas, capped at 192 entries by `tinted`/`tintedSource`. */
  tints: Map<string | number, DrawableImage>;
  /** A stable small integer per source picture, used to build the `source:` cache keys. */
  sourceIds: WeakMap<SkinImage, number>;
  nextSourceId: number;
  /** Called after a load finishes; `app.ts` uses it to schedule a repaint. */
  invalidate: () => void;

  constructor(invalidate: () => void) { this.images = new Map(); this.tints = new Map(); this.sourceIds = new WeakMap(); this.nextSourceId = 1; this.invalidate = invalidate; }

  async load(): Promise<void> {
    // The built-in RPE textures: the two note-head tables above, a handful of named extras, and the
    // 31 hit-effect frames. The `<img>` and the decode are set up exactly as before.
    await Promise.all([...new Set([...Object.values(names), ...Object.values(highlights), 'Hold', 'Hold3', 'HoldHL', 'HoldEnd', 'line', 'Pause', 'Arrow2', ...Array.from({ length: 31 }, (unused, index) => `img-${index + 1}`)])].map(async (name: string): Promise<void> => {
      const picture = new Image(); picture.src = assetUrl(`rpe/Texture/${name}.png`);
      try { await picture.decode(); this.images.set(name, picture); } catch { return; }
    }));
    this.invalidate();
  }

  tinted(name: string, color: Color): DrawableImage | null {
    const picture = this.images.get(name);
    if (!picture) return null;
    const rgb = color.map((value: number): number => Math.round(Math.max(0, Math.min(255, value))));
    const key = `${name}:${rgb.join(',')}`;
    if (!this.tints.has(key)) {
      // The map never runs dry here, so `value` is a real key; the guard is what removes the
      // `undefined` that `IteratorResult` adds for the exhaustive case.
      const oldest = this.tints.keys().next().value;
      if (this.tints.size >= 192 && oldest !== undefined) this.tints.delete(oldest);
      const canvas = document.createElement('canvas'); canvas.width = picture.naturalWidth ?? 0; canvas.height = picture.naturalHeight ?? 0;
      // `getContext('2d')` only returns null for a context type the canvas cannot provide, and the
      // next two lines have always assumed the browser's 2D context; the throw keeps the code
      // honest without inventing a silent fallback that would change behaviour.
      const context = canvas.getContext('2d');
      if (!context) throw new Error('2D 上下文不可用');
      context.drawImage(picture as CanvasImageSource, 0, 0);
      context.globalCompositeOperation = 'multiply'; context.fillStyle = `rgb(${rgb.join(',')})`; context.fillRect(0, 0, canvas.width, canvas.height);
      context.globalCompositeOperation = 'destination-in'; context.drawImage(picture as CanvasImageSource, 0, 0);
      this.tints.set(key, canvas);
    }
    const tinted = this.tints.get(key);
    return tinted ?? null;
  }

  tintedSource(name: string, source: SkinImage | null | undefined, color: Color): DrawableImage | null {
    if (!source) return null;
    const rgb = color.map((value: number): number => Math.round(Math.max(0, Math.min(255, value))));
    if (rgb.every((value: number): boolean => value === 255)) return source;
    const stored = this.sourceIds.get(source);
    const sourceId = stored !== undefined ? stored : this.nextSourceId;
    if (stored === undefined) this.sourceIds.set(source, this.nextSourceId++);
    const key = `source:${name}:${sourceId}:${rgb.join(',')}`;
    if (!this.tints.has(key)) {
      const oldest = this.tints.keys().next().value;
      if (this.tints.size >= 192 && oldest !== undefined) this.tints.delete(oldest);
      const width = source.naturalWidth ?? source.width; const height = source.naturalHeight ?? source.height;
      if (!width || !height) return source;
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('2D 上下文不可用');
      context.drawImage(source as CanvasImageSource, 0, 0);
      context.globalCompositeOperation = 'multiply'; context.fillStyle = `rgb(${rgb.join(',')})`; context.fillRect(0, 0, width, height);
      context.globalCompositeOperation = 'destination-in'; context.drawImage(source as CanvasImageSource, 0, 0);
      this.tints.set(key, canvas);
    }
    return this.tints.get(key) ?? null;
  }

  head(context: CanvasRenderingContext2D, type: NoteType, horizontal: number, vertical: number, width: number, highlight = false, color?: Color): boolean {
    const name = (highlight ? highlights : names)[type];
    const picture = this.images.get(name);
    if (!picture) return false;
    const height = Math.max(5, width * (picture.naturalHeight ?? 0) / (picture.naturalWidth ?? 1));
    const customTint = Array.isArray(color) && color.length === 3 && color.every(Number.isFinite) && color.some((value: number): boolean => value !== 255);
    context.drawImage((customTint ? this.tinted(name, color) : picture) as CanvasImageSource, horizontal - width / 2, vertical - height / 2, width, height);
    return true;
  }

  hold(context: CanvasRenderingContext2D, horizontal: number, head: number, tail: number, width: number, highlight = false, showHead = true, color?: Color): boolean {
    const bodyName = highlight ? 'HoldHL' : this.images.has('Hold3') ? 'Hold3' : 'Hold';
    const body = this.images.get(bodyName);
    const end = this.images.get('HoldEnd');
    if (!body) return false;
    const direction = tail <= head ? 1 : -1;
    const headPicture = this.images.get(highlight ? 'HoldHeadHL' : 'HoldHead');
    const customTint = Array.isArray(color) && color.length === 3 && color.every(Number.isFinite) && color.some((value: number): boolean => value !== 255);
    const texture = (name: string): DrawableImage | null | undefined => customTint ? this.tinted(name, color) : this.images.get(name);
    const unit = width / (body.naturalWidth ?? 1);
    context.save(); context.translate(horizontal, head); context.scale(1, direction);
    context.drawImage(texture(bodyName) as CanvasImageSource, -width / 2, -Math.abs(tail - head), width, Math.max(1, Math.abs(tail - head)));
    if (end) context.drawImage(texture('HoldEnd') as CanvasImageSource, -(end.naturalWidth ?? 0) * unit / 2, -Math.abs(tail - head) - (end.naturalHeight ?? 0) * unit, (end.naturalWidth ?? 0) * unit, (end.naturalHeight ?? 0) * unit);
    if (showHead && headPicture) context.drawImage(texture(highlight ? 'HoldHeadHL' : 'HoldHead') as CanvasImageSource, -(headPicture.naturalWidth ?? 0) * unit / 2, 0, (headPicture.naturalWidth ?? 0) * unit, (headPicture.naturalHeight ?? 0) * unit);
    context.restore();
    return true;
  }
}
