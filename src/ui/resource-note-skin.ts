import { NOTE_SKIN_IMAGES, holdSkinLayout, noteSkinColor, noteSkinFrame } from '../core/note-skin.ts';
import { hitParticles } from '../core/editor-display.ts';
import type { Color, NoteType } from '../core/types.ts';
import type { DrawableImage } from './skin.ts';
import type { ResourceNoteSkin as ResourceNoteSkinContract } from './skin.ts';

interface SkinImage {
  readonly naturalWidth?: number;
  readonly naturalHeight?: number;
  readonly width?: number;
  readonly height?: number;
}

export interface NoteSkinInfo {
  name: string;
  author: string;
  description: string;
  hitFx: [number, number];
  holdAtlas: [number, number];
  holdAtlasMH: [number, number];
  hitFxDuration: number;
  hitFxScale: number;
  hitFxRotate: boolean;
  hitFxTinted: boolean;
  hideParticles: boolean;
  holdKeepHead: boolean;
  holdRepeat: boolean;
  holdCompact: boolean;
  colorPerfect: number;
  colorGood: number;
  [key: string]: unknown;
}

export interface NoteSkinRecord {
  id: string;
  info: NoteSkinInfo;
  files: Map<string, Uint8Array>;
  images: Record<string, { width: number; height: number }>;
  sounds: Map<string, Uint8Array>;
  warnings: string[];
  bytes: number;
  builtin?: boolean;
  originalFiles?: Map<string, Uint8Array>;
}

interface SkinSize { width: number; height: number }
interface HoldSkinLayout {
  direction: number;
  length: number;
  scale: number;
  headHeight: number;
  tailHeight: number;
  bodyPixels: number;
  headY: number;
  tailY: number;
  bodyTop: number;
  bodyHeight: number;
  tailPixels: number;
  headPixels: number;
}
interface NoteSkinFrame { index: number; column: number; row: number }
interface NoteSkinColor { rgb: Color; alpha: number }
interface HitDrawOptions {
  age: number;
  x: number;
  y: number;
  size: number;
  rotation?: number;
  color?: Color;
  seed?: number;
  good?: boolean;
}

const names = { 1: 'click', 2: 'hold', 3: 'flick', 4: 'drag' } as const satisfies Record<NoteType, string>;
const dimensions = (image: SkinImage): SkinSize => ({ width: image.naturalWidth ?? image.width ?? 0, height: image.naturalHeight ?? image.height ?? 0 });
const tint = (color: Color | undefined): Color => Array.isArray(color) && color.length === 3 && color.every(Number.isFinite) ? color : [255, 255, 255];
const HIT_FRAME_BYTES = 64 * 1024 * 1024;
const HIT_FRAME_COUNT = 512;

export class ResourceNoteSkin implements ResourceNoteSkinContract {
  id: string;
  info: NoteSkinInfo;
  images: Map<string, HTMLImageElement>;
  tintSource: (name: string, source: SkinImage | null | undefined, color: Color) => DrawableImage | null;
  crops: Map<string, HTMLCanvasElement | DrawableImage>;
  patterns: WeakMap<CanvasRenderingContext2D, Map<string, CanvasPattern>>;
  hitFrames: Map<string, HTMLCanvasElement>;
  hitFrameBytes: number;
  highlightScale: number;

  constructor(record: NoteSkinRecord, images: Map<string, HTMLImageElement>, tintSource: (name: string, source: SkinImage | null | undefined, color: Color) => DrawableImage | null) {
    this.id = record.id; this.info = record.info; this.images = images; this.tintSource = tintSource; this.crops = new Map(); this.patterns = new WeakMap();
    this.hitFrames = new Map(); this.hitFrameBytes = 0;
    const normal = images.get('click.png') ?? record.images?.['click.png'], highlighted = images.get('click_mh.png') ?? record.images?.['click_mh.png'];
    const width = (image: { naturalWidth?: number; width?: number } | undefined): number => image?.naturalWidth ?? image?.width ?? 0;
    const ratio = width(highlighted as { naturalWidth?: number; width?: number } | undefined) / width(normal as { naturalWidth?: number; width?: number } | undefined);
    // The Tap texture width ratio is shared by every highlighted note type.
    this.highlightScale = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  }
  static async prepare(record: NoteSkinRecord, tintSource: (name: string, source: SkinImage | null | undefined, color: Color) => DrawableImage | null): Promise<ResourceNoteSkin> {
    const images = new Map(await Promise.all(NOTE_SKIN_IMAGES.map(async (name: string): Promise<[string, HTMLImageElement]> => {
      const bytes = record.files.get(name);
      if (!bytes) throw new Error('无法解码音符皮肤图片：' + name);
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/png' })); const picture = new Image();
      try { picture.src = url; await picture.decode(); return [name, picture]; }
      catch { throw new Error('无法解码音符皮肤图片：' + name); }
      finally { URL.revokeObjectURL(url); }
    })));
    return new ResourceNoteSkin(record, images, tintSource);
  }
  dispose(): void { this.images.clear(); this.crops.clear(); this.patterns = new WeakMap(); this.hitFrames.clear(); this.hitFrameBytes = 0; }
  setInfo(info: NoteSkinInfo): void {
    if (info.hitFx.join(',') !== this.info.hitFx.join(',')) { this.hitFrames.clear(); this.hitFrameBytes = 0; }
    if (info.hitFx.join(',') !== this.info.hitFx.join(',') || info.holdAtlas.join(',') !== this.info.holdAtlas.join(',') || info.holdAtlasMH.join(',') !== this.info.holdAtlasMH.join(',')) { this.crops.clear(); this.patterns = new WeakMap(); }
    this.info = info;
  }
  source(name: string, color: Color | undefined): DrawableImage | null { const picture = this.images.get(name); return this.tintSource(`${this.id}:${name}`, picture, tint(color)); }
  get hitLifetime(): number { return this.info.hitFxDuration; }
  get perfectColor(): NoteSkinColor { return noteSkinColor(this.info.colorPerfect) as NoteSkinColor; }
  noteImage(type: NoteType, highlight = false): SkinImage | undefined { return this.images.get(names[type] + (highlight ? '_mh' : '') + '.png'); }
  noteScale(highlight = false): number { return highlight ? this.highlightScale : 1; }
  head(context: CanvasRenderingContext2D, type: NoteType, x: number, y: number, width: number, highlight = false, color?: Color, heightWidth = width): boolean {
    const scale = this.noteScale(highlight); width *= scale; heightWidth *= scale;
    if (type === 2) {
      const name = 'hold' + (highlight ? '_mh' : '') + '.png'; const picture = this.source(name, color)!; const size = dimensions(picture); const layout = holdSkinLayout(this.info, size, highlight, 0, -1, width, heightWidth) as HoldSkinLayout;
      if (layout.headPixels) context.drawImage(picture as CanvasImageSource, 0, size.height - layout.headPixels, size.width, layout.headPixels, x - width / 2, y - layout.headHeight / 2, width, layout.headHeight);
      return true;
    }
    const name = names[type] + (highlight ? '_mh' : '') + '.png'; const picture = this.source(name, color); if (!picture) return false;
    const size = dimensions(picture); const height = heightWidth * size.height / size.width;
    context.drawImage(picture as CanvasImageSource, x - width / 2, y - height / 2, width, height); return true;
  }
  hold(context: CanvasRenderingContext2D, x: number, head: number, tail: number, width: number, highlight = false, showHead = true, color?: Color, heightWidth = width): boolean {
    const scale = this.noteScale(highlight); width *= scale; heightWidth *= scale;
    const name = 'hold' + (highlight ? '_mh' : '') + '.png'; const picture = this.source(name, color); if (!picture) return false;
    const size = dimensions(picture); const layout = holdSkinLayout(this.info, size, highlight, head, tail, width, heightWidth) as HoldSkinLayout;
    context.save(); context.translate(x, head); context.scale(1, layout.direction);
    if (this.info.holdRepeat && layout.length > 0) {
      const key = name + ':' + layout.tailPixels + ':' + layout.headPixels + ':' + tint(color).join(',');
      let body = this.crops.get(key) as HTMLCanvasElement | undefined;
      if (!body) {
        body = document.createElement('canvas'); const reduction = Math.min(1, 1024 / size.width, 2048 / layout.bodyPixels); body.width = Math.max(1, Math.round(size.width * reduction)); body.height = Math.max(1, Math.round(layout.bodyPixels * reduction)); body.getContext('2d')!.drawImage(picture as CanvasImageSource, 0, layout.tailPixels, size.width, layout.bodyPixels, 0, 0, body.width, body.height); if (this.crops.size >= 64) this.crops.delete(this.crops.keys().next().value!); this.crops.set(key, body);
      }
      let patterns = this.patterns.get(context); if (!patterns) { patterns = new Map(); this.patterns.set(context, patterns); }
      let pattern = patterns.get(key); if (!pattern) { const created = context.createPattern(body, 'repeat'); if (created) { pattern = created; if (patterns.size >= 32) patterns.delete(patterns.keys().next().value!); patterns.set(key, pattern); } }
      if (pattern) { const unit = width / body.width, unitY = heightWidth / body.width; context.save(); context.translate(-width / 2, -layout.length); context.scale(unit, unitY); context.fillStyle = pattern; context.fillRect(0, 0, body.width, layout.length / unitY); context.restore(); }
    } else if (layout.length > 0) context.drawImage(picture as CanvasImageSource, 0, layout.tailPixels, size.width, layout.bodyPixels, -width / 2, layout.bodyTop, width, layout.bodyHeight);
    if (layout.tailPixels) context.drawImage(picture as CanvasImageSource, 0, 0, size.width, layout.tailPixels, -width / 2, layout.tailY, width, layout.tailHeight);
    if ((showHead || this.info.holdKeepHead) && layout.headPixels) context.drawImage(picture as CanvasImageSource, 0, size.height - layout.headPixels, size.width, layout.headPixels, -width / 2, layout.headY, width, layout.headHeight);
    context.restore(); return true;
  }
  drawHit(context: CanvasRenderingContext2D, { age, x, y, size, rotation = 0, color, seed = 0, good = false }: HitDrawOptions): boolean {
    const frame = noteSkinFrame(this.info, age) as NoteSkinFrame | null; if (!frame) return true;
    const sheet = this.images.get('hit_fx.png')!; const sheetSize = dimensions(sheet); const frameWidth = sheetSize.width / this.info.hitFx[0]; const frameHeight = sheetSize.height / this.info.hitFx[1];
    const base = noteSkinColor(this.info[good ? 'colorGood' : 'colorPerfect']) as NoteSkinColor; const rgb: number[] = this.info.hitFxTinted ? tint(color ?? base.rgb).map(value => Math.round(Math.max(0, Math.min(255, value)))) : [255, 255, 255];
    const key = frame.index + ':' + rgb.join(','); let picture = this.hitFrames.get(key);
    if (!picture) {
      const crop = document.createElement('canvas'); const resolution = Math.min(1, 512 / frameWidth, 512 / frameHeight); crop.width = Math.max(1, Math.ceil(frameWidth * resolution)); crop.height = Math.max(1, Math.ceil(frameHeight * resolution));
      const cropContext = crop.getContext('2d')!;
      const draw = (): void => cropContext.drawImage(sheet, frame.column * frameWidth, frame.row * frameHeight, frameWidth, frameHeight, 0, 0, crop.width, crop.height);
      draw();
      if (rgb.some(value => value !== 255)) {
        cropContext.globalCompositeOperation = 'multiply'; cropContext.fillStyle = `rgb(${rgb.join(',')})`; cropContext.fillRect(0, 0, crop.width, crop.height);
        cropContext.globalCompositeOperation = 'destination-in'; draw(); cropContext.globalCompositeOperation = 'source-over';
      }
      const bytes = crop.width * crop.height * 4;
      while (this.hitFrames.size && (this.hitFrameBytes + bytes > HIT_FRAME_BYTES || this.hitFrames.size >= HIT_FRAME_COUNT)) {
        const oldest = this.hitFrames.keys().next().value!; const previous = this.hitFrames.get(oldest)!;
        this.hitFrameBytes -= previous.width * previous.height * 4; this.hitFrames.delete(oldest);
      }
      picture = crop; this.hitFrames.set(key, picture); this.hitFrameBytes += bytes;
    } else {
      this.hitFrames.delete(key); this.hitFrames.set(key, picture);
    }
    const progress = age / this.info.hitFxDuration; const alpha = progress < 0.5 ? 1 - progress * 0.6 : 1.4 * (1 - progress);
    const width = size * this.info.hitFxScale; const height = width * frameHeight / frameWidth;
    context.save(); context.translate(x, y); if (this.info.hitFxRotate) context.rotate(rotation); context.globalAlpha *= alpha * (this.info.hitFxTinted ? base.alpha : 1);
    context.drawImage(picture as CanvasImageSource, -width / 2, -height / 2, width, height); context.restore();
    if (!this.info.hideParticles) {
      context.save(); context.fillStyle = `rgb(${rgb.join(',')})`;
      for (const particle of hitParticles(progress * 2 / 3, seed, size / 1.4 * this.info.hitFxScale) as { x: number; y: number; radius: number }[]) { context.globalAlpha = alpha * (this.info.hitFxTinted ? base.alpha : 1); context.fillRect(x + particle.x - particle.radius, y + particle.y - particle.radius, particle.radius * 2, particle.radius * 2); }
      context.restore();
    }
    return true;
  }
}
