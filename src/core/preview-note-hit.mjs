import { holdSkinLayout } from './note-skin.mjs';

const widthOf = image => image?.naturalWidth ?? image?.width ?? 0;
const heightOf = image => image?.naturalHeight ?? image?.height ?? 0;
const inRectangle = (x, y, width, top, height, padding) => Math.abs(x) <= Math.abs(width) / 2 + padding &&
  y >= Math.min(top, top + height) - padding && y <= Math.max(top, top + height) + padding;

// Work in the sprite's local coordinates, with a small CSS-pixel tolerance.
// This runs only on pointer queries; no pixel readbacks or extra draw passes.
export function previewNoteHit(area, point, skin, padding = 4) {
  const dx = point.x - area.x1, dy = point.y - area.y1;
  if (!Number.isFinite(area.pickWidth)) {
    // Retain support for hit areas supplied by existing mods/tools.
    const sx = area.x2 - area.x1, sy = area.y2 - area.y1, length = sx * sx + sy * sy;
    const amount = length ? Math.max(0, Math.min(1, (dx * sx + dy * sy) / length)) : 0;
    return Math.hypot(dx - amount * sx, dy - amount * sy) <= area.radius;
  }
  const cosine = area.pickCosine ?? Math.cos(area.rotation ?? 0), sine = area.pickSine ?? Math.sin(area.rotation ?? 0);
  const x = dx * cosine + dy * sine, y = -dx * sine + dy * cosine;
  const width = area.pickWidth, heightWidth = area.pickHeightWidth;
  if (area.type !== 2) {
    if (!area.pickSkew && Math.abs(x) > Math.abs(width) / 2 + padding) return false;
    const image = skin?.noteImage?.(area.type, area.pickHighlight);
    const height = widthOf(image) ? Math.max(skin?.resourcePack ? 0 : 5, heightWidth * heightOf(image) / widthOf(image)) : 4;
    return inRectangle(x - y * area.pickSkew, y, width, -height / 2, height, padding);
  }

  const tail = -(area.x2 - area.x1) * sine + (area.y2 - area.y1) * cosine;
  const pack = skin?.resourcePack ?? skin;
  if (pack?.info?.holdAtlas) {
    const image = skin?.noteImage?.(2, area.pickHighlight);
    if (widthOf(image)) {
      const layout = holdSkinLayout(pack.info, { width: widthOf(image), height: heightOf(image) }, area.pickHighlight, 0, tail, width, heightWidth, area.pickSide);
      const localY = y * layout.direction;
      return layout.length > 0 && inRectangle(x, localY, width, layout.bodyTop, layout.bodyHeight, padding) ||
        layout.tailPixels > 0 && inRectangle(x, localY, width, layout.tailY, layout.tailHeight, padding) ||
        (area.pickShowHead || pack.info.holdKeepHead && layout.length > 0) && layout.headPixels > 0 && inRectangle(x, localY, width, layout.headY, layout.headHeight, padding);
    }
  }
  const images = skin?.images;
  const body = images?.get(area.pickHighlight ? 'HoldHL' : images.has('Hold3') ? 'Hold3' : 'Hold');
  const length = Math.abs(tail), direction = length === 0 ? area.pickSide : tail < 0 ? 1 : -1;
  const localY = y * direction;
  if (length > 0 && inRectangle(x, localY, width, -length, length, padding)) return true;
  if (widthOf(body)) {
    const unit = width / widthOf(body), unitY = heightWidth / widthOf(body);
    const end = images.get('HoldEnd'), head = images.get(area.pickHighlight ? 'HoldHeadHL' : 'HoldHead');
    if (end && inRectangle(x, localY, widthOf(end) * unit, -length - heightOf(end) * unitY, heightOf(end) * unitY, padding)) return true;
    return Boolean(area.pickShowHead && head && inRectangle(x, localY, widthOf(head) * unit, 0, heightOf(head) * unitY, padding));
  }
  return Boolean(area.pickShowHead && inRectangle(x, y, width, -2, 4, padding));
}
