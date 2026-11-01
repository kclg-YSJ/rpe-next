import { open } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInflateRaw, crc32 } from 'node:zlib';
import { Transform, Readable } from 'node:stream';

const safeName = name => name && !name.startsWith('/') && !/[\\:\0]/.test(name) && !name.split('/').some(part => part === '..' || part === '.');
export async function largeArchiveDirectory(path) {
  const handle = await open(path, 'r');
  try {
    const size = (await handle.stat()).size, tail = Buffer.alloc(Math.min(size, 65557));
    await handle.read(tail, 0, tail.length, size - tail.length);
    let trailer = -1;
    for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50 && i + 22 + tail.readUInt16LE(i + 20) === tail.length) { trailer = i; break; }
    if (trailer < 0) throw Error('压缩包目录损坏');
    const count = tail.readUInt16LE(trailer + 10), bytes = tail.readUInt32LE(trailer + 12), offset = tail.readUInt32LE(trailer + 16);
    if (tail.readUInt16LE(trailer + 4) || tail.readUInt16LE(trailer + 6) || count !== tail.readUInt16LE(trailer + 8) || count > 4096 || bytes > 8 * 1024 ** 2 || offset + bytes !== size - tail.length + trailer) throw Error('实验预览暂不支持此压缩包结构');
    const directory = Buffer.alloc(bytes); await handle.read(directory, 0, bytes, offset);
    const entries = [], names = new Set(); let cursor = 0;
    for (let i = 0; i < count; i++) {
      if (cursor + 46 > bytes || directory.readUInt32LE(cursor) !== 0x02014b50) throw Error('压缩包目录损坏');
      const flags = directory.readUInt16LE(cursor + 8), method = directory.readUInt16LE(cursor + 10), checksum = directory.readUInt32LE(cursor + 16);
      const compressed = directory.readUInt32LE(cursor + 20), length = directory.readUInt32LE(cursor + 24), nameLength = directory.readUInt16LE(cursor + 28), extra = directory.readUInt16LE(cursor + 30), comment = directory.readUInt16LE(cursor + 32), local = directory.readUInt32LE(cursor + 42);
      if (cursor + 46 + nameLength + extra + comment > bytes || flags & 1 || directory.readUInt16LE(cursor + 34) || [compressed, length, local].includes(0xffffffff) || ![0, 8].includes(method)) throw Error('实验预览暂不支持 ZIP64、加密或此压缩方法');
      const name = new TextDecoder(flags & 2048 ? 'utf-8' : 'gb18030').decode(directory.subarray(cursor + 46, cursor + 46 + nameLength));
      if (!safeName(name) || names.has(name.toLowerCase())) throw Error('压缩包中存在无效或重复路径'); names.add(name.toLowerCase());
      const header = Buffer.alloc(30); await handle.read(header, 0, 30, local);
      if (local + 30 > offset || header.readUInt32LE(0) !== 0x04034b50 || header.readUInt16LE(8) !== method || header.readUInt16LE(6) !== flags) throw Error('压缩包文件头损坏');
      const start = local + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
      if (start + compressed > offset || method === 0 && compressed !== length) throw Error('压缩包文件范围无效');
      entries.push({ name, method, checksum, compressed, length, start }); cursor += 46 + nameLength + extra + comment;
    }
    if (cursor !== bytes) throw Error('压缩包目录不完整');
    return entries;
  } finally { await handle.close(); }
}

export function largeEntryStream(path, entry, signal) {
  const input = entry.compressed ? createReadStream(path, { start: entry.start, end: entry.start + entry.compressed - 1, highWaterMark: 256 * 1024, signal }) : Readable.from([]);
  const decoded = entry.method === 8 ? input.pipe(createInflateRaw({ chunkSize: 256 * 1024 })) : input;
  if (decoded !== input) input.on('error', error => decoded.destroy(error));
  let bytes = 0, checksum = 0;
  const verify = new Transform({ transform(chunk, encoding, callback) {
    bytes += chunk.length;
    if (bytes > entry.length) { callback(Error('解压数据超出声明长度')); return; }
    checksum = crc32(chunk, checksum); callback(null, chunk);
  }, flush(callback) { callback(bytes === entry.length && checksum === entry.checksum ? null : Error('压缩包长度或 CRC 校验失败')); } });
  decoded.on('error', error => verify.destroy(error)); verify.on('close', () => { input.destroy(); if (decoded !== input) decoded.destroy(); });
  return decoded.pipe(verify);
}
