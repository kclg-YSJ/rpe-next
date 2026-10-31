import { assetUrl } from '../core/asset-url.mjs';

const names = { 1: 'Tap2', 2: 'HoldHead', 3: 'Flick2', 4: 'Drag2' };
const highlights = { 1: 'Tap2HL', 2: 'HoldHeadHL', 3: 'Flick2HL', 4: 'DragHL' };

export class RpeSkin {
  constructor(invalidate) { this.images = new Map(); this.tints = new Map(); this.sourceIds = new WeakMap(); this.nextSourceId = 1; this.invalidate = invalidate; }

  async load() {
    await Promise.all([...new Set([...Object.values(names), ...Object.values(highlights), 'Hold', 'Hold3', 'HoldHL', 'HoldEnd', 'line', 'Pause', 'Arrow2', ...Array.from({ length: 31 }, (unused, index) => `img-${index + 1}`)])].map(async name => {
      const picture = new Image(); picture.src = assetUrl(`rpe/Texture/${name}.png`);
      try { await picture.decode(); this.images.set(name, picture); } catch { return; }
    }));
    this.invalidate();
  }

  setResourcePack(pack) {
    if (this.resourcePack !== pack) this.resourcePack?.dispose();
    this.resourcePack = pack; this.tints.clear(); this.invalidate();
  }
  get hitLifetime() { return this.resourcePack?.hitLifetime; }
  get hitBatchCompatible() { return this.drawHit === nativeHitDraw && (!this.resourcePack || this.resourcePack.hitBatchCompatible); }
  get noteBatchCompatible() { return this.head === nativeHeadDraw && this.hold === nativeHoldDraw && (!this.resourcePack || this.resourcePack.noteBatchCompatible); }
  hitRadius(size) { return this.hitBatchCompatible ? this.resourcePack?.hitRadius(size) ?? size : Infinity; }
  drawHit(context, options) { return this.resourcePack?.drawHit(context, options) ?? false; }
  noteImage(type, highlight = false) { return this.resourcePack?.noteImage(type, highlight) ?? this.images.get((highlight ? highlights : names)[type]); }
  noteScale(highlight = false) { return this.resourcePack?.noteScale?.(highlight) ?? 1; }

  tinted(name, color) {
    const picture = this.images.get(name);
    if (!picture) return null;
    const rgb = color.map(value => Math.round(Math.max(0, Math.min(255, value))));
    const key = `${name}:${rgb.join(',')}`;
    if (!this.tints.has(key)) {
      if (this.tints.size >= 192) this.tints.delete(this.tints.keys().next().value);
      const canvas = document.createElement('canvas'); canvas.width = picture.naturalWidth; canvas.height = picture.naturalHeight;
      const context = canvas.getContext('2d'); context.drawImage(picture, 0, 0);
      context.globalCompositeOperation = 'multiply'; context.fillStyle = `rgb(${rgb.join(',')})`; context.fillRect(0, 0, canvas.width, canvas.height);
      context.globalCompositeOperation = 'destination-in'; context.drawImage(picture, 0, 0);
      this.tints.set(key, canvas);
    }
    return this.tints.get(key);
  }

  tintedSource(name, source, color) {
    if (!source) return null;
    const rgb = color.map(value => Math.round(Math.max(0, Math.min(255, value))));
    if (rgb.every(value => value === 255)) return source;
    if (!this.sourceIds.has(source)) this.sourceIds.set(source, this.nextSourceId++);
    const key = `source:${name}:${this.sourceIds.get(source)}:${rgb.join(',')}`;
    if (!this.tints.has(key)) {
      if (this.tints.size >= 192) this.tints.delete(this.tints.keys().next().value);
      const width = source.naturalWidth ?? source.width; const height = source.naturalHeight ?? source.height;
      if (!width || !height) return source;
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d'); context.drawImage(source, 0, 0);
      context.globalCompositeOperation = 'multiply'; context.fillStyle = `rgb(${rgb.join(',')})`; context.fillRect(0, 0, width, height);
      context.globalCompositeOperation = 'destination-in'; context.drawImage(source, 0, 0);
      this.tints.set(key, canvas);
    }
    return this.tints.get(key);
  }

  head(context, type, horizontal, vertical, width, highlight = false, color, minimumHeight = 5, heightWidth = width) {
    if (this.resourcePack) return this.resourcePack.head(context, type, horizontal, vertical, width, highlight, color, heightWidth);
    const name = (highlight ? highlights : names)[type];
    const picture = this.images.get(name);
    if (!picture) return false;
    const height = Math.max(minimumHeight, heightWidth * picture.naturalHeight / picture.naturalWidth);
    const customTint = Array.isArray(color) && color.length === 3 && color.every(Number.isFinite) && color.some(value => value !== 255);
    context.drawImage(customTint ? this.tinted(name, color) : picture, horizontal - width / 2, vertical - height / 2, width, height);
    return true;
  }

  hold(context, horizontal, head, tail, width, highlight = false, showHead = true, color, heightWidth = width, zeroDirection = 1) {
    if (this.resourcePack) return this.resourcePack.hold(context, horizontal, head, tail, width, highlight, showHead, color, heightWidth, zeroDirection);
    const bodyName = highlight ? 'HoldHL' : this.images.has('Hold3') ? 'Hold3' : 'Hold';
    const body = this.images.get(bodyName);
    const end = this.images.get('HoldEnd');
    if (!body) return false;
    const direction = tail === head ? zeroDirection : tail < head ? 1 : -1;
    const headPicture = this.images.get(highlight ? 'HoldHeadHL' : 'HoldHead');
    const customTint = Array.isArray(color) && color.length === 3 && color.every(Number.isFinite) && color.some(value => value !== 255);
    const texture = name => customTint ? this.tinted(name, color) : this.images.get(name);
    const unit = width / body.naturalWidth, unitY = heightWidth / body.naturalWidth;
    const length = Math.abs(tail - head);
    context.save(); context.translate(horizontal, head); context.scale(1, direction);
    if (length > 0) context.drawImage(texture(bodyName), -width / 2, -length, width, Math.max(1, length));
    if (end) context.drawImage(texture('HoldEnd'), -end.naturalWidth * unit / 2, -length - end.naturalHeight * unitY, end.naturalWidth * unit, end.naturalHeight * unitY);
    if (showHead && headPicture) context.drawImage(texture(highlight ? 'HoldHeadHL' : 'HoldHead'), -headPicture.naturalWidth * unit / 2, 0, headPicture.naturalWidth * unit, headPicture.naturalHeight * unitY);
    context.restore();
    return true;
  }
}

const nativeHitDraw = RpeSkin.prototype.drawHit;
const nativeHeadDraw = RpeSkin.prototype.head, nativeHoldDraw = RpeSkin.prototype.hold;
