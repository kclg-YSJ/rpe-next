import { assetBytes, resourceReferences, mediaType } from './files.ts';
import type { ArchiveEntries } from './archive.ts';
import type { StoredProject } from './library.ts';

/**
 * The dimension pair both image sources expose, under different names.
 *
 * An `ImageBitmap` has `width`/`height`; an `HTMLImageElement` has `naturalWidth`/`naturalHeight`.
 * Reading through this shape is what lets the page and worker branches below share one code path,
 * and it is deliberately structural because the worker branch has no `HTMLImageElement` constructor
 * to test against.
 */
interface DimensionedSource {
  width: number;
  height: number;
  naturalWidth?: number;
  naturalHeight?: number;
}

/** The canvas members each branch offers; `convertToBlob` is the offscreen `toBlob`. */
interface BlobCapableCanvas {
  convertToBlob?: (options?: ImageEncodeOptions) => Promise<Blob>;
  toBlob?: (callback: (blob: Blob | null) => void, type?: string, quality?: number) => void;
}

/**
 * Renders a project's illustration into a small JPEG for the chart library.
 *
 * The image is centre-cropped to 16:9 rather than letterboxed, so every card in the library grid
 * has the same composition. Any failure — no illustration, undecodable bytes, no canvas — yields
 * `null`, because a missing thumbnail is a normal state and not an error worth surfacing.
 *
 * It runs in a worker as well as on the page, so it uses `OffscreenCanvas` and `createImageBitmap`
 * when there is no `document`.
 */
export async function projectThumbnail(project: StoredProject): Promise<Blob | null> {
  if (typeof document === 'undefined' && typeof OffscreenCanvas === 'undefined') return null;
  const assets: ArchiveEntries = new Map(project.assets);
  const reference = resourceReferences(project.chart, assets, project.chartName, project.info).background;
  const bytes = assetBytes(assets, reference, project.chartName); if (!bytes) return null;
  const blob = new Blob([bytes as BlobPart], { type: mediaType(reference) });
  let url: string | undefined;
  let image: ImageBitmap | HTMLImageElement | undefined;
  try {
    if (typeof document === 'undefined') image = await createImageBitmap(blob);
    else { url = URL.createObjectURL(blob); image = new Image(); image.src = url; await image.decode(); }
    const canvas: HTMLCanvasElement | OffscreenCanvas = typeof document === 'undefined' ? new OffscreenCanvas(480, 270) : document.createElement('canvas'); canvas.width = 480; canvas.height = 270;
    const dimensions = image as unknown as DimensionedSource;
    const width = dimensions.naturalWidth ?? dimensions.width; const height = dimensions.naturalHeight ?? dimensions.height;
    const ratio = Math.max(canvas.width / width, canvas.height / height);
    canvas.getContext('2d')!.drawImage(image, (480 - width * ratio) / 2, (270 - height * ratio) / 2, width * ratio, height * ratio);
    const encoder = canvas as BlobCapableCanvas;
    if (encoder.convertToBlob) return await encoder.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
    return await new Promise<Blob | null>(resolve => encoder.toBlob!(resolve, 'image/jpeg', 0.8));
  } catch { return null; } finally { if (url) URL.revokeObjectURL(url); (image as ImageBitmap | undefined)?.close?.(); }
}
