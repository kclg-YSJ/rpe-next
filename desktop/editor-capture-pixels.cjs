// NativeImage's pixel order is platform-dependent. Probe a known opaque red
// PNG once per task instead of guessing from the OS or swapping every pixel.
const RED_PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';
const MAX_PIXELS = 32 * 1024 ** 2, MAX_BYTES = 128 * 1024 ** 2;

function bitmapFormat(nativeImage) {
  try {
    const pixel = nativeImage?.createFromBuffer(Buffer.from(RED_PIXEL, 'base64')).toBitmap();
    if (pixel?.length !== 4 || pixel[1] !== 0 || pixel[3] !== 255) return null;
    if (pixel[0] === 0 && pixel[2] === 255) return 'BGRA';
    if (pixel[0] === 255 && pixel[2] === 0) return 'RGBA';
  } catch { /* Older/unknown native representations use the PNG path. */ }
  return null;
}
function validateSize(width, height, bytes) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || width * height > MAX_PIXELS || bytes > MAX_BYTES) throw Error('编辑器画面超过截图内存预算');
}
function capturePixels(image, format) {
  if (format) {
    const factors = image.getScaleFactors();
    const scaleFactor = factors.reduce((nearest, f) => Math.abs(f - 1) < Math.abs(nearest - 1) ? f : nearest, factors[0] ?? 1);
    const size = image.getSize(scaleFactor);
    validateSize(size.width, size.height, 0);
    const bytes = image.toBitmap({ scaleFactor });
    // Current Electron returns pixel dimensions. Accommodate representations
    // that report DIP, but never infer an aspect ratio from a buffer length.
    for (const [width, height] of [[size.width, size.height], [Math.round(size.width * scaleFactor), Math.round(size.height * scaleFactor)]]) {
      if (bytes.length === width * height * 4) { validateSize(width, height, bytes.length); return { width, height, format, stride: width * 4, bytes }; }
    }
  }
  const bytes = image.toPNG(), width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  validateSize(width, height, bytes.length);
  return { width, height, format: 'png', bytes };
}

function validateFence(fence) {
  if (!fence) return;
  for (const key of ['x', 'y', 'width', 'height', 'viewportWidth', 'viewportHeight']) if (!Number.isFinite(fence[key])) throw Error('录制帧标记无效');
  if (fence.width <= 0 || fence.width > 512 || fence.height <= 0 || fence.height > 64 || fence.viewportWidth <= 0 || fence.viewportHeight <= 0 || fence.x < 0 || fence.y < 0 || fence.x + fence.width > fence.viewportWidth || fence.y + fence.height > fence.viewportHeight || !Number.isInteger(fence.code) || fence.code < 0 || fence.code > 2047) throw Error('录制帧标记超出范围');
}
function matchesFence(bytes, width, height, fence) {
  if (!fence) return true;
  const sx = width / fence.viewportWidth, sy = height / fence.viewportHeight;
  let code = 0;
  for (let bit = 0; bit < 11; bit++) {
    const x = Math.min(width - 1, Math.floor((fence.x + (bit + .5) * fence.width / 11) * sx));
    const y = Math.min(height - 1, Math.floor((fence.y + fence.height / 2) * sy));
    const offset = (y * width + x) * 4;
    // The marker is opaque neutral gray, independent of RGBA/BGRA order.
    if (bytes[offset] > 128) code |= 1 << bit;
  }
  return code === fence.code;
}
module.exports = { bitmapFormat, capturePixels, validateFence, matchesFence };
