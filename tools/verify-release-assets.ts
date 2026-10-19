// @ts-nocheck - ported release smoke script.
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

const directory = process.argv[2], sourceCommit = process.argv[3];
const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
if (!directory || !/^[a-f0-9]{40}$/.test(sourceCommit ?? '')) throw Error('Usage: node tools/verify-release-assets.ts DIRECTORY SOURCE_COMMIT');
const expected = new Set(['editor-win32-x64', 'editor-win32-arm64', 'editor-darwin-x64', 'editor-darwin-arm64', 'editor-linux-x64', 'editor-linux-arm64', 'server-win32-x64']);
const names = await readdir(directory), checksums = [], summary = [];
for (const name of names.filter(name => name.endsWith('.json'))) {
  const info = JSON.parse(await readFile(join(directory, name), 'utf8')), target = [info.kind, info.platform, info.arch].join('-');
  if (!expected.delete(target) || info.sourceCommit !== sourceCommit || info.version !== version || !info.verified || !Number.isInteger(info.sourceFilesVerified) || info.sourceFilesVerified <= 0) throw Error('Unexpected or unverified artifact: ' + name);
  if (info.file !== basename(info.file) || !/\.(?:zip|dmg|tar\.xz)$/.test(info.file) || !names.includes(info.file)) throw Error('Invalid archive reference: ' + name);
  const path = join(directory, info.file), actualSize = (await stat(path)).size;
  if (actualSize !== info.bytes || actualSize < 10 * 1024 ** 2 || actualSize >= 2 * 1024 ** 3) throw Error('Unexpected package size: ' + info.file);
  const hash = createHash('sha256'); for await (const bytes of createReadStream(path)) hash.update(bytes);
  const sha256 = hash.digest('hex'); if (sha256 !== info.sha256) throw Error('Package checksum mismatch: ' + info.file);
  checksums.push(sha256 + '  ' + info.file);
  summary.push({ file: info.file, bytes: actualSize, sha256, unpackedBytes: info.unpackedBytes, removedLocaleBytes: info.removedLocaleBytes });
}
if (expected.size) throw Error('Missing platform artifacts: ' + [...expected].join(', '));
if (names.filter(name => /\.(zip|dmg|tar\.xz)$/.test(name)).length !== summary.length) throw Error('Unmanifested archive in artifacts');
await writeFile(join(directory, 'SHA256SUMS.txt'), checksums.sort().join('\n') + '\n');
await writeFile(join(directory, 'verified-assets.json'), JSON.stringify({ sourceCommit, assets: summary }, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
