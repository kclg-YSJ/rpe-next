import { assetBytes, resourceReferences, mediaType } from './files.ts';
import type { ArchiveEntries } from './archive.ts';
import type { ResourceReferences } from './files.ts';
import type { Chart } from '../core/types.ts';

/**
 * A texture's decode source.
 *
 * Animated art and environments without `createImageBitmap` decode through `<img>`; every other
 * asset decodes to an `ImageBitmap`. The two shapes differ in more than `close()` — a bitmap has
 * `width`/`height`, an `<img>` has `naturalWidth`/`naturalHeight` — which is why the union is
 * carried explicitly and narrowed where the difference matters.
 */
type ImageSource = ImageBitmap | HTMLImageElement;

/**
 * A decoded texture as the renderer consumes it.
 *
 * `preview.ts` reads `source`/`naturalWidth`/`naturalHeight` off this record, `skin.ts` accepts it
 * through its own structural `Picture` interface, and `preview-background.ts` draws it as a
 * `PreviewImage`. `source` is non-null only on records that finished decoding; `nullable` would
 * misdescribe it, because every consumer that reaches a record's `source` has guarded on `image`.
 */
export interface DecodedImage {
  source: ImageSource;
  naturalWidth: number;
  naturalHeight: number;
}

/** A single texture's bytes plus the decode state the loader tracks for it. */
export interface TextureRecord {
  name: string;
  bytes: Uint8Array;
  /**
   * The image's own pixel size.
   *
   * Optional because `pngDimensions` returns `{}` for a PNG shorter than its header or without the
   * PNG signature, and the record is built by spreading that result — so a non-PNG asset (or a
   * truncated one) carries no dimensions until `decode` fills them in. `preview.ts` reads them as
   * `descriptor?.naturalWidth`, which already tolerates their absence.
   */
  naturalWidth?: number;
  naturalHeight?: number;
  animated: boolean;
  lastUsed: number;
  requestedScale: number;
  generation: number;
  /** Decoded bytes stamped with the generation they belong to. */
  cost?: number;
  /** The scale the decoded bitmap was rasterized at. */
  scale?: number;
  image?: DecodedImage | null;
  failed?: boolean;
  pending?: Promise<void> | null;
  complete?: () => void;
}

/**
 * Whether an image asset is animated, and so must bypass the static texture cache.
 *
 * Extensions are trusted first; APNG is detected from the PNG chunk stream, which is why the
 * `acTL` chunk is matched before any `IDAT`/`IEND` chunk is reached.
 */
export function animatedImage(name: string, bytes: Uint8Array): boolean {
  if (/\.(gif|webp|avif|apng)$/i.test(name)) return true;
  if (!/\.png$/i.test(name) || bytes.length < 8) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const type = view.getUint32(offset + 4);
    if (type === 0x6163544c) return true;
    if (type === 0x49444154 || type === 0x49454e44) return false;
    offset += view.getUint32(offset) + 12;
  }
  return false;
}

/**
 * Releases a decoded bitmap if the source has a `close`, which only `ImageBitmap` does.
 *
 * The `'close' in source` test is the narrowing binding that replaces the original `source.close?.()`
 * optional call. `close()` is declared on `ImageBitmap` but not on `HTMLImageElement`, so the union
 * has no `close` member at all; an `in` check gives TypeScript the discriminated union it needs
 * without a cast, and preserves the original behaviour of closing only bitmap sources.
 */
function releaseSource(source: ImageSource | undefined): void {
  if (source && 'close' in source) source.close();
}

export class ProjectImages {
  invalidate: () => void;
  report: (message: string) => void;
  images: Map<string, DecodedImage>;
  records: Map<string, TextureRecord>;
  generation: number;
  background: DecodedImage | null;
  /**
   * The background asset's name, set by `load`.
   *
   * It is `undefined` before the first `load`, and that is load-bearing rather than incidental:
   * `decode` compares `record.name === this.backgroundName`, which is simply false for every record
   * until a load has happened. Declaring it optional keeps that exact comparison.
   */
  backgroundName?: string;
  backgroundAnimated = false;
  queue: TextureRecord[];
  activeLoads: number;
  decodedBytes: number;
  budget: number;

  constructor(invalidate: () => void, report: (message: string) => void = () => {}) {
    this.invalidate = invalidate; this.report = report; this.images = new Map(); this.records = new Map();
    this.generation = 0; this.background = null; this.queue = []; this.activeLoads = 0; this.decodedBytes = 0; this.budget = 384 * 1024 ** 2;
  }

  async load(chart: Chart, assets: ArchiveEntries, chartName: string, info?: Record<string, string>): Promise<void> {
    this.clear();
    const references: ResourceReferences = resourceReferences(chart, assets, chartName, info);
    this.backgroundName = references.background;
    const names = new Set([references.background, ...(chart.judgeLineList ?? []).map(line => line.Texture)].filter(Boolean));
    for (const name of names) {
      const bytes = assetBytes(assets, name, chartName);
      if (!bytes) { if (name !== 'line.png') this.report(`未找到图片：${name}`); continue; }
      const dimensions = pngDimensions(bytes);
      this.records.set(name, { name, bytes, ...dimensions, animated: animatedImage(name, bytes), lastUsed: 0, requestedScale: 0, generation: this.generation });
    }
    const background = this.records.get(this.backgroundName);
    if (background) {
      const display = Math.max(globalThis.innerWidth || 1920, globalThis.innerHeight || 1080) * (globalThis.devicePixelRatio || 1);
      this.texture(this.backgroundName, Math.min(1, display / Math.max(background.naturalWidth || display, background.naturalHeight || display)));
      await background.pending;
    }
    this.invalidate();
  }

  describe(name: string): TextureRecord | undefined { return this.records.get(name); }

  texture(name: string, scale = 1): DecodedImage | null {
    const record = this.records.get(name);
    if (!record || record.failed) return null;
    record.lastUsed = performance.now();
    const desired = textureScale(scale);
    record.requestedScale = Math.max(record.requestedScale, desired);
    if (!record.pending && (!record.image || Number(record.scale) < desired)) {
      record.pending = new Promise(resolve => { record.complete = resolve; });
      this.queue.push(record); this.pump();
    }
    return record.image ?? null;
  }

  pump(): void {
    while (this.activeLoads < 2 && this.queue.length) {
      // `shift()` cannot be undefined inside the length check; the non-null form is erased by
      // Node's type stripper, so it costs nothing at runtime.
      const record = this.queue.shift()!;
      // `complete` is always installed by `texture` before a record is queued, so it is called
      // unguarded here, exactly as before.
      if (record.generation !== this.generation) { record.complete!(); continue; }
      this.activeLoads++;
      this.decode(record).finally(() => { this.activeLoads--; record.pending = null; record.complete!(); this.pump(); });
    }
  }

  async decode(record: TextureRecord): Promise<void> {
    const scale = record.requestedScale;
    let source: ImageSource | undefined;
    // A `Uint8Array` is a valid `BlobPart` at runtime, but its default `ArrayBufferLike` backing
    // buffer is not assignable to `BlobPart`'s `ArrayBuffer` — `SharedArrayBuffer` is excluded by
    // the DOM type and cannot occur here, since these bytes come from `File.arrayBuffer()` or a ZIP
    // entry. The DOM types cannot express that, so the gap is closed on this binding exactly as
    // `thumbnail.ts` and `archive.ts` do; nothing else about the bytes changes.
    const part = record.bytes as BlobPart;
    try {
      const blob = new Blob([part], { type: mediaType(record.name) });
      if (record.animated || typeof createImageBitmap !== 'function') {
        const url = URL.createObjectURL(blob);
        let image: HTMLImageElement;
        try { image = new Image(); source = image; image.src = url; await image.decode(); }
        finally { URL.revokeObjectURL(url); }
        record.naturalWidth = image.naturalWidth; record.naturalHeight = image.naturalHeight;
      } else {
        const naturalWidth = record.naturalWidth ?? 0; const naturalHeight = record.naturalHeight ?? 0;
        const options: ImageBitmapOptions = naturalWidth ? { resizeWidth: Math.max(1, Math.ceil(naturalWidth * scale)), resizeHeight: Math.max(1, Math.ceil(naturalHeight * scale)), resizeQuality: 'high' } : {};
        source = await createImageBitmap(blob, options);
        if (!record.naturalWidth) { record.naturalWidth = source.width; record.naturalHeight = source.height; }
      }
      if (record.generation !== this.generation) { releaseSource(source); return; }
      this.release(record);
      // Dimensions are written by both branches above, so they are numbers by this point. They are
      // read through `Number(...)`, which is the identity for the numbers the branches assign and
      // keeps `width / naturalWidth` evaluating to `NaN` rather than throwing.
      const naturalWidth = Number(record.naturalWidth); const naturalHeight = Number(record.naturalHeight);
      const width = source.width || naturalWidth; const height = source.height || naturalHeight;
      const image: DecodedImage = { source, naturalWidth, naturalHeight };
      record.scale = record.animated ? 1 : width / naturalWidth;
      record.image = image;
      record.cost = width * height * 4;
      this.decodedBytes += record.cost; this.images.set(record.name, image);
      if (record.name === this.backgroundName) { this.background = image; this.backgroundAnimated = record.animated; }
      this.trim(); this.invalidate();
    } catch {
      releaseSource(source);
      if (record.generation === this.generation) { record.failed = true; this.report(`图片无法解码：${record.name}，请检查文件内容或改用 PNG/JPEG/WebP`); }
    }
  }

  release(record: TextureRecord): void {
    if (!record.image) return;
    releaseSource(record.image.source); this.decodedBytes -= record.cost ?? 0;
    this.images.delete(record.name); record.image = null; record.scale = 0; record.requestedScale = 0;
  }

  trim(): void {
    if (this.decodedBytes <= this.budget) return;
    const cutoff = performance.now() - 1000;
    const candidates = [...this.records.values()].filter(record => record.image && record.name !== this.backgroundName && record.lastUsed < cutoff).sort((left, right) => left.lastUsed - right.lastUsed);
    for (const record of candidates) { if (this.decodedBytes <= this.budget) break; this.release(record); }
  }

  clear(): void {
    this.generation++;
    for (const record of this.records.values()) this.release(record);
    for (const record of this.queue) record.complete!();
    this.queue = []; this.records.clear(); this.images.clear(); this.background = null; this.backgroundAnimated = false;
  }
}

export function textureScale(scale: number): number {
  if (!Number.isFinite(scale) || scale >= 1) return 1;
  return 2 ** Math.ceil(Math.log2(Math.max(1 / 64, scale)));
}

export function pngDimensions(bytes: Uint8Array): { naturalWidth?: number; naturalHeight?: number } {
  if (bytes.length < 24) return {};
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0) !== 0x89504e47 || view.getUint32(4) !== 0x0d0a1a0a) return {};
  return { naturalWidth: view.getUint32(16), naturalHeight: view.getUint32(20) };
}
