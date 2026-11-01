const size = image => ({ width: image.naturalWidth ?? image.width, height: image.naturalHeight ?? image.height });
const HEADS = { 1: 'Tap2', 3: 'Flick2', 4: 'Drag2' }, HIGH = { 1: 'Tap2HL', 3: 'Flick2HL', 4: 'DragHL' };
const PACK_HEADS = { 1: 'click', 3: 'flick', 4: 'drag' };

// Reuse texture/layout preparation while retaining native atlas sampling,
// source-over blending and painter order, including translucent stacked Holds.
export class EditorNotePainter {
  constructor() { this.plans = new Map(); this.bytes = 0; }
  begin(skin, context, width, height) {
    if (!skin?.noteBatchCompatible || context.shadowBlur || context.shadowOffsetX || context.shadowOffsetY || context.filter && context.filter !== 'none' || context.imageSmoothingQuality === 'high') return null;
    const matrix = context.getTransform?.();
    if (matrix && (matrix.b || matrix.c || matrix.e || matrix.f || matrix.a <= 0 || matrix.d <= 0)) return null;
    this.matrix = matrix;
    const identity = skin.resourcePack ?? skin;
    if (this.identity !== identity || this.info !== identity.info || this.images !== identity.images || this.imageCount !== identity.images?.size) {
      this.identity = identity; this.info = identity.info; this.images = identity.images; this.imageCount = identity.images?.size; this.plans.clear(); this.bytes = 0; this.last = null;
    }
    Object.assign(this, { skin, width, height }); return this;
  }
  horizontalPadding(baseWidth) {
    const pack = this.skin.resourcePack, scale = Math.max(1, this.skin.noteScale?.(true) ?? 1);
    if (pack) return baseWidth * scale;
    const images = this.skin.images, body = images?.get('Hold3') ?? images?.get('Hold'), highBody = images?.get('HoldHL') ?? body;
    const bodyWidth = Math.min(body?.naturalWidth ?? 1, highBody?.naturalWidth ?? 1);
    const capWidth = Math.max(images?.get('HoldHead')?.naturalWidth ?? 0, images?.get('HoldHeadHL')?.naturalWidth ?? 0, images?.get('HoldEnd')?.naturalWidth ?? 0);
    return baseWidth * (scale + Math.max(1, capWidth / Math.max(1, bodyWidth))) / 2;
  }
  plan(type, width, highlight, color, minimumHeight, heightWidth) {
    const tint = Array.isArray(color) && color.length === 3 && color.every(Number.isFinite) ? color : [255, 255, 255];
    const scale = this.skin.resourcePack?.noteScale(highlight) ?? 1;
    const last = this.last;
    if (last && last.type === type && last.width === width && last.highlight === highlight && last.scale === scale && last.minimumHeight === minimumHeight
      && last.heightWidth === heightWidth && last.red === tint[0] && last.green === tint[1] && last.blue === tint[2]) return last.plan;
    const key = `${type}:${width}:${highlight ? 1 : 0}:${scale}:${tint.join(',')}:${minimumHeight}:${heightWidth}`;
    const remember = plan => { this.last = { type, width: originalWidth, highlight, scale, minimumHeight, heightWidth: originalHeightWidth, red: tint[0], green: tint[1], blue: tint[2], plan }; return plan; };
    const originalWidth = width, originalHeightWidth = heightWidth;
    if (this.plans.has(key)) return remember(this.plans.get(key));
    const skin = this.skin, pack = skin.resourcePack; let plan;
    if (pack) {
      width *= scale; heightWidth *= scale;
      const source = pack.source(type === 2 ? `hold${highlight ? '_mh' : ''}.png` : `${PACK_HEADS[type]}${highlight ? '_mh' : ''}.png`, tint);
      if (!source) return null;
      const dimensions = size(source);
      if (type === 2) {
        const [tailPixels, headPixels] = pack.info[highlight ? 'holdAtlasMH' : 'holdAtlas'], bodyPixels = dimensions.height - tailPixels - headPixels;
        const body = bodyPixels > 0 ? source : null, head = headPixels > 0 ? source : null, tail = tailPixels > 0 ? source : null;
        const unit = heightWidth / dimensions.width;
        plan = { body, head, tail, width, headWidth: width, tailWidth: width, headHeight: headPixels * unit, tailHeight: tailPixels * unit, compact: pack.info.holdCompact,
          bodyCrop: [0, tailPixels, dimensions.width, bodyPixels], headCrop: [0, dimensions.height - headPixels, dimensions.width, headPixels], tailCrop: [0, 0, dimensions.width, tailPixels] };
      } else plan = { image: source, width, height: heightWidth * dimensions.height / dimensions.width };
    } else if (type === 2) {
      const bodyName = highlight ? 'HoldHL' : skin.images.has('Hold3') ? 'Hold3' : 'Hold', body = skin.images.get(bodyName);
      if (!body) return null;
      const texture = name => tint.some(value => value !== 255) ? skin.tinted(name, tint) : skin.images.get(name);
      const head = texture(highlight ? 'HoldHeadHL' : 'HoldHead'), tail = texture('HoldEnd');
      const unit = width / body.naturalWidth, unitY = heightWidth / body.naturalWidth;
      const headSize = head ? size(head) : { width: 0, height: 0 }, tailSize = tail ? size(tail) : { width: 0, height: 0 };
      plan = { body: texture(bodyName), head, tail, width, headWidth: headSize.width * unit, tailWidth: tailSize.width * unit,
        headHeight: headSize.height * unitY, tailHeight: tailSize.height * unitY, compact: false, minimumBody: true };
    } else {
      const name = (highlight ? HIGH : HEADS)[type], image = tint.some(value => value !== 255) ? skin.tinted(name, tint) : skin.images.get(name);
      if (!image) return null;
      const dimensions = size(image); plan = { image, width, height: Math.max(minimumHeight, heightWidth * dimensions.height / dimensions.width) };
    }
    plan.bytes = [...new Set([plan.image, plan.body, plan.head, plan.tail].filter(Boolean))].reduce((total, image) => { const dimensions = size(image); return total + dimensions.width * dimensions.height * 4; }, 0);
    if (plan.bytes > 64 * 1024 ** 2) return plan;
    while (this.plans.size && (this.plans.size >= 128 || this.bytes + plan.bytes > 64 * 1024 ** 2)) {
      const first = this.plans.keys().next().value; this.bytes -= this.plans.get(first).bytes; this.plans.delete(first);
    }
    this.bytes += plan.bytes;
    this.plans.set(key, plan); return remember(plan);
  }
  image(context, image, x, y, width, height, crop, originX = 0, originY = 0) {
    if (!image || originX + x + width < -2 || originX + x > this.width + 2 || originY + y + height < -2 || originY + y > this.height + 2) return;
    if (crop) context.drawImage(image, crop[0], crop[1], crop[2], crop[3], x, y, width, height);
    else context.drawImage(image, x, y, width, height);
  }
  draw(context, type, x, head, tail, width, highlight, color, minimumHeight, heightWidth) {
    // A reverse Hold needs a reflected texture, so retain its existing path.
    if (type === 2 && tail > head) return false;
    const plan = this.plan(type, width, highlight, color, minimumHeight, heightWidth); if (!plan) return false;
    if (type !== 2) this.image(context, plan.image, x - plan.width / 2, head - plan.height / 2, plan.width, plan.height);
    else {
      const length = Math.abs(tail - head), compact = plan.compact && length > 0;
      if (!this.matrix) context.save();
      context.translate(x, head); context.scale(1, 1);
      if (length > 0) this.image(context, plan.body, -plan.width / 2, -length, plan.width, plan.minimumBody ? Math.max(1, length) : length, plan.bodyCrop, x, head);
      this.image(context, plan.tail, -plan.tailWidth / 2, -length - (compact ? plan.tailHeight / 2 : plan.tailHeight), plan.tailWidth, plan.tailHeight, plan.tailCrop, x, head);
      this.image(context, plan.head, -plan.headWidth / 2, compact ? -plan.headHeight / 2 : 0, plan.headWidth, plan.headHeight, plan.headCrop, x, head);
      if (this.matrix) context.setTransform(this.matrix);
      else context.restore();
    }
    return true;
  }
}
