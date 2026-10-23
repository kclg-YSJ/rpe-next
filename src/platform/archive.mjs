import { t } from '../i18n.mjs';
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const ZIP64_MARKER = 0xffffffff;
const crcTable = Uint32Array.from({ length: 256 }, (unused, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function checkPath(name) {
  if (!name || name.startsWith('/') || name.includes('\\') || name.includes('\0') || name.includes(':') || name.split('/').includes('..')) {
    throw new Error(t('archive.sb60c19c', { p0: name }));
  }
}

export function inspectZip(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let trailer = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (view.getUint32(offset, true) === 0x06054b50 && offset + 22 + view.getUint16(offset + 20, true) === bytes.length) { trailer = offset; break; }
  }
  if (trailer < 0) throw new Error(t('archive.s80d8994'));
  const count = view.getUint16(trailer + 10, true);
  if (view.getUint16(trailer + 4, true) || view.getUint16(trailer + 6, true) || count === 0xffff || view.getUint32(trailer + 12, true) === ZIP64_MARKER || view.getUint32(trailer + 16, true) === ZIP64_MARKER) throw new Error(t('archive.sc601e2a'));
  const entries = [], names = new Set();
  let offset = view.getUint32(trailer + 16, true), declaredBytes = 0, largestFile = 0, largestRatio = 0;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > trailer || view.getUint32(offset, true) !== 0x02014b50) throw new Error(t('archive.sd581b8f'));
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const checksum = view.getUint32(offset + 16, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    declaredBytes += size;
    largestFile = Math.max(largestFile, size);
    if (size > 32 * 1024 * 1024) largestRatio = Math.max(largestRatio, size / Math.max(1, compressedSize));
    const nameSize = view.getUint16(offset + 28, true);
    const extraSize = view.getUint16(offset + 30, true);
    const commentSize = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    if (flags & 1 || size === ZIP64_MARKER || compressedSize === ZIP64_MARKER || localOffset === ZIP64_MARKER) throw new Error(t('archive.s0d62ed2'));
    if (offset + 46 + nameSize + extraSize + commentSize > trailer) throw new Error(t('archive.s81d2c4b'));
    const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameSize);
    const name = (flags & 0x800 ? decoder : new TextDecoder('gb18030')).decode(nameBytes);
    checkPath(name);
    if (names.has(name)) throw new Error(t('archive.sc9b6bff', { p0: name }));
    names.add(name);
    if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== 0x04034b50) throw new Error(t('archive.s740ea3d'));
    const dataOffset = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    if (dataOffset + compressedSize > offset) throw new Error(t('archive.sca71961'));
    if (method === 0 && size !== compressedSize) throw new Error(t('archive.s772efff'));
    entries.push({ name, method, checksum, size, compressedSize, dataOffset });
    offset += 46 + nameSize + extraSize + commentSize;
  }
  return { entries, count, declaredBytes, largestFile, largestRatio, compressedBytes: bytes.length };
}

export async function readZip(buffer, { maxFiles = Infinity, maxBytes = Infinity, maxFileBytes = Infinity, includeEntry = () => true } = {}) {
  const bytes = new Uint8Array(buffer), directory = inspectZip(buffer), files = new Map();
  if (directory.count > maxFiles) throw new Error(t('archive.s211f44d'));
  if (directory.declaredBytes > maxBytes || directory.largestFile > maxFileBytes) throw new Error(t('archive.s3af86c2'));
  for (const { name, method, checksum, size, compressedSize, dataOffset } of directory.entries) {
    if (!includeEntry(name)) continue;
    let contents = method === 0 ? bytes.slice(dataOffset, dataOffset + compressedSize) : bytes.subarray(dataOffset, dataOffset + compressedSize);
    if (method === 8) {
      const reader = new Blob([contents]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
      const chunks = [];
      let length = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.length;
        if (length > size) { await reader.cancel(); throw new Error(t('archive.s772efff')); }
        chunks.push(chunk.value);
      }
      contents = new Uint8Array(length);
      let cursor = 0;
      for (const chunk of chunks) { contents.set(chunk, cursor); cursor += chunk.length; }
    } else if (method !== 0) throw new Error(t('archive.scb60a92', { p0: method }));
    if (contents.length !== size || crc32(contents) !== checksum) throw new Error(t('archive.s0b72d37', { p0: name }));
    files.set(name, contents);
  }
  return files;
}

export async function writeBlobZip(files) {
  if (files.size >= 0xffff) throw new Error(t('archive.s882fdc1'));
  const records = [], directories = []; let offset = 0;
  for (const [name, source] of files) {
    checkPath(name); const blob = source instanceof Blob ? source : new Blob([source]);
    const nameBytes = encoder.encode(name);
    if (nameBytes.length > 65535 || blob.size >= ZIP64_MARKER || offset + 30 + nameBytes.length + blob.size >= ZIP64_MARKER) throw new Error(t('archive.s7abd10a'));
    let crc = 0xffffffff, processed = 0; const reader = blob.stream().getReader();
    try { while (true) {
      const { value, done } = await reader.read(); if (done) break;
      for (const byte of value) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
      processed += value.length;
      if (processed >= 4 * 1024 ** 2) { processed = 0; await new Promise(resolve => setTimeout(resolve, 0)); }
    } }
    finally { reader.releaseLock(); }
    const record = new Uint8Array(30 + nameBytes.length), view = new DataView(record.buffer);
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x800, true);
    view.setUint32(14, (crc ^ 0xffffffff) >>> 0, true); view.setUint32(18, blob.size, true); view.setUint32(22, blob.size, true); view.setUint16(26, nameBytes.length, true); record.set(nameBytes, 30);
    const directory = new Uint8Array(46 + nameBytes.length), central = new DataView(directory.buffer);
    central.setUint32(0, 0x02014b50, true); central.setUint16(4, 20, true); directory.set(record.subarray(4, 30), 6); central.setUint32(42, offset, true); directory.set(nameBytes, 46);
    records.push(record, blob); directories.push(directory); offset += record.length + blob.size;
  }
  const trailer = new Uint8Array(22), view = new DataView(trailer.buffer), size = directories.reduce((sum, entry) => sum + entry.length, 0);
  if (offset + size >= ZIP64_MARKER) throw new Error(t('archive.s7abd10a'));
  view.setUint32(0, 0x06054b50, true); view.setUint16(8, files.size, true); view.setUint16(10, files.size, true); view.setUint32(12, size, true); view.setUint32(16, offset, true);
  return new Blob([...records, ...directories, trailer], { type: 'application/zip' });
}

export function writeZip(files) {
  if (files.size >= 0xffff) throw new Error(t('archive.s882fdc1'));
  const records = [];
  const directories = [];
  let offset = 0;
  for (const [name, contents] of files) {
    checkPath(name);
    const nameBytes = encoder.encode(name);
    if (nameBytes.length > 65535) throw new Error(t('archive.se754674'));
    if (contents.length >= ZIP64_MARKER || offset + 30 + nameBytes.length + contents.length >= ZIP64_MARKER) throw new Error(t('archive.s6e559a4'));
    const record = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(record.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
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
  if (directorySize >= ZIP64_MARKER) throw new Error(t('archive.s461e2ea'));
  view.setUint32(12, directorySize, true);
  view.setUint32(16, offset, true);
  return new Blob([...records, ...directories, trailer], { type: 'application/zip' });
}
