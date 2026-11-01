import { open } from 'node:fs/promises';

// Inspect bounded headers before a browser decoder can allocate a huge bitmap.
export async function boundedPreviewCover(path) {
  const file = await open(path, 'r');
  try {
    const bytes = Buffer.alloc(65536), { bytesRead } = await file.read(bytes, 0, bytes.length, 0), data = bytes.subarray(0, bytesRead);
    let width = 0, height = 0;
    if (data.length >= 24 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) { width = data.readUInt32BE(16); height = data.readUInt32BE(20); }
    else if (data[0] === 255 && data[1] === 216) {
      let cursor = 2;
      while (cursor + 9 <= data.length) {
        if (data[cursor++] !== 255) break;
        while (data[cursor] === 255) cursor++;
        const code = data[cursor++]; if ([0xd8, 0xd9, 0xda].includes(code)) break;
        if (code === 1 || code >= 0xd0 && code <= 0xd7) continue;
        const length = data.readUInt16BE(cursor); if (length < 2 || cursor + length > data.length) break;
        if ([0xc0, 0xc1, 0xc2].includes(code)) { height = data.readUInt16BE(cursor + 3); width = data.readUInt16BE(cursor + 5); break; } cursor += length;
      }
    }
    return width > 0 && height > 0 && width * height <= 4 * 1024 ** 2;
  } finally { await file.close(); }
}
