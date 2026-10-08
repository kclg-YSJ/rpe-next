// A minimal ZIP reader/writer for PEZ chart packages.
//
// Only what PEZ files actually use is supported: stored and deflate-raw entries, no encryption, no
// multi-disk and no ZIP64. Anything outside that raises a specific Chinese error rather than
// producing a half-read archive, because these messages surface in the import dialog.

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const ZIP64_MARKER = 0xffffffff;
const crcTable = Uint32Array.from({ length: 256 }, (unused, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

/** The entries of an archive, keyed by their in-archive path. */
export type ArchiveEntries = Map<string, Uint8Array>;

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Rejects entry names that could escape the archive when extracted.
 *
 * Even though the editor keeps entries in a Map rather than writing them to disk, the migration
 * and export paths reuse these names as relative paths, so traversal has to be refused here.
 */
function checkPath(name: string): void {
  if (!name || name.startsWith('/') || name.includes('\\') || name.includes('\0') || name.includes(':') || name.split('/').includes('..')) {
    throw new Error(`ZIP 包含不安全路径：${name}`);
  }
}

/** Reads a ZIP archive into a map of entry name to uncompressed bytes. */
export async function readZip(buffer: ArrayBuffer | Uint8Array): Promise<ArchiveEntries> {
  const bytes = new Uint8Array(buffer as ArrayBuffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let trailer = -1;
  // The end-of-central-directory record sits at the very end, but a trailing archive comment of up
  // to 64 KiB may follow it, so scan backwards for the signature that lands exactly at the end.
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (view.getUint32(offset, true) === 0x06054b50 && offset + 22 + view.getUint16(offset + 20, true) === bytes.length) { trailer = offset; break; }
  }
  if (trailer < 0) throw new Error('无效 ZIP/PEZ 目录');
  const count = view.getUint16(trailer + 10, true);
  if (view.getUint16(trailer + 4, true) || view.getUint16(trailer + 6, true) || count === 0xffff || view.getUint32(trailer + 12, true) === ZIP64_MARKER || view.getUint32(trailer + 16, true) === ZIP64_MARKER) throw new Error('不支持分卷或 ZIP64');
  const files: ArchiveEntries = new Map();
  let offset = view.getUint32(trailer + 16, true);
  for (let index = 0; index < count; index++) {
    if (offset + 46 > trailer || view.getUint32(offset, true) !== 0x02014b50) throw new Error('ZIP 目录损坏');
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const checksum = view.getUint32(offset + 16, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameSize = view.getUint16(offset + 28, true);
    const extraSize = view.getUint16(offset + 30, true);
    const commentSize = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    if (flags & 1 || size === ZIP64_MARKER || compressedSize === ZIP64_MARKER || localOffset === ZIP64_MARKER) throw new Error('不支持加密 ZIP 或 ZIP64');
    if (offset + 46 + nameSize + extraSize + commentSize > trailer) throw new Error('ZIP 文件名越界');
    const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameSize);
    // RPE archives written on Chinese Windows often store names in GB18030 rather than UTF-8, and
    // signal that only by leaving the language-encoding flag clear.
    const name = (flags & 0x800 ? decoder : new TextDecoder('gb18030')).decode(nameBytes);
    checkPath(name);
    if (files.has(name)) throw new Error(`ZIP 重复文件名：${name}`);
    if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== 0x04034b50) throw new Error('ZIP 文件头损坏');
    const dataOffset = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    if (dataOffset + compressedSize > offset) throw new Error('ZIP 文件内容越界');
    let contents = bytes.slice(dataOffset, dataOffset + compressedSize);
    if (method === 8) {
      const reader = new Blob([contents as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        const value = chunk.value as Uint8Array;
        length += value.length;
        if (length > size) { await reader.cancel(); throw new Error('ZIP 解压大小与目录不一致'); }
        chunks.push(value);
      }
      const inflated = new Uint8Array(length);
      let cursor = 0;
      for (const chunk of chunks) { inflated.set(chunk, cursor); cursor += chunk.length; }
      contents = inflated;
    } else if (method !== 0) throw new Error(`不支持 ZIP 压缩方式 ${method}`);
    if (contents.length !== size || crc32(contents) !== checksum) throw new Error(`ZIP 校验失败：${name}`);
    files.set(name, contents);
    offset += 46 + nameSize + extraSize + commentSize;
  }
  return files;
}

/** Writes entries as a stored (uncompressed) ZIP archive. */
export function writeZip(files: ArchiveEntries): Blob {
  if (files.size >= 0xffff) throw new Error('此文件数量需要 ZIP64，暂不支持');
  const records: (Uint8Array | Uint8Array<ArrayBuffer>)[] = [];
  const directories: Uint8Array[] = [];
  let offset = 0;
  for (const [name, contents] of files) {
    checkPath(name);
    const nameBytes = encoder.encode(name);
    if (nameBytes.length > 65535) throw new Error('ZIP 文件名过长');
    if (contents.length >= ZIP64_MARKER || offset + 30 + nameBytes.length + contents.length >= ZIP64_MARKER) throw new Error('此包需要 ZIP64，暂不支持');
    const record = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(record.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    // Always advertise UTF-8 names; the reader honours this flag in preference to GB18030.
    view.setUint16(6, 0x800, true);
    view.setUint32(14, crc32(contents), true);
    view.setUint32(18, contents.length, true);
    view.setUint32(22, contents.length, true);
    view.setUint16(26, nameBytes.length, true);
    record.set(nameBytes, 30);
    const directory = new Uint8Array(46 + nameBytes.length);
    const central = new DataView(directory.buffer);
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    directory.set(record.subarray(4, 30), 6);
    central.setUint32(42, offset, true);
    directory.set(nameBytes, 46);
    records.push(record, contents);
    directories.push(directory);
    offset += record.length + contents.length;
  }
  const trailer = new Uint8Array(22);
  const view = new DataView(trailer.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, files.size, true);
  view.setUint16(10, files.size, true);
  const directorySize = directories.reduce((total, entry) => total + entry.length, 0);
  if (directorySize >= ZIP64_MARKER) throw new Error('此目录需要 ZIP64，暂不支持');
  view.setUint32(12, directorySize, true);
  view.setUint32(16, offset, true);
  return new Blob([...records, ...directories, trailer] as BlobPart[], { type: 'application/zip' });
}
