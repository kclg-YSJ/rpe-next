import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { readZip } from '../src/platform/archive.ts';

export async function extractReleaseZip(archive: string, destination: string): Promise<number> {
  const files = await readZip(await readFile(archive));
  const root = resolve(destination) + sep;
  for (const [name, bytes] of files) {
    if (name.endsWith('/')) continue;
    const target = resolve(destination, name);
    if (!target.startsWith(root) || target === resolve(destination)) throw Error('Release archive path escaped destination: ' + name);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  return files.size;
}

type SourceReader = (path: string, mode: string) => Promise<Uint8Array | undefined>;

async function verifySources(root: string, ref: string, paths: string[], read: SourceReader): Promise<number> {
  const tree = execFileSync('git', ['ls-tree', '-rz', '--full-tree', ref, '--', ...paths], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 ** 2 });
  let files = 0;
  for (const record of tree.split('\0').filter(Boolean)) {
    const entry = /^(\d{6}) blob ([a-f0-9]{40})\t([\s\S]+)$/.exec(record);
    if (!entry) throw Error('Unsupported release source entry: ' + record);
    const [, mode, expected, path] = entry;
    let bytes: Uint8Array | undefined;
    try { bytes = await read(path!, mode!); }
    catch (cause) { throw Error('Missing release source file: ' + path, { cause }); }
    if (!bytes) throw Error('Missing release source file: ' + path);
    const actual = blobHash(bytes);
    if (actual !== expected) throw Error('Release source content mismatch: ' + path);
    files++;
  }
  if (!files) throw Error('Release source selection is empty');
  return files;
}

function blobHash(bytes: Uint8Array): string {
  const source = Buffer.from(bytes);
  // Git's core.autocrlf may rewrite tracked text files while extracting the
  // archive on Windows. Normalize only valid UTF-8 text; binary assets remain
  // byte-for-byte verified.
  let normalized = source;
  if (!source.includes(0)) {
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(source);
      normalized = Buffer.from(text.replace(/\r\n?/g, '\n'));
    } catch { /* binary or non-UTF-8 content */ }
  }
  return createHash('sha1').update('blob ' + normalized.length + '\0').update(normalized).digest('hex');
}

export function verifyReleaseSourceDirectory(root: string, ref: string, paths: string[], directory: string): Promise<number> {
  return verifySources(root, ref, paths, async (path, mode) => mode === '120000'
    ? Buffer.from(await readlink(join(directory, path))) : readFile(join(directory, path)));
}

export async function verifyReleaseSourceZip(root: string, ref: string, paths: string[], archive: string, prefix: string): Promise<number> {
  const files = await readZip(await readFile(archive), { includeEntry: name => name.startsWith(prefix) });
  return verifySources(root, ref, paths, path => Promise.resolve(files.get(prefix + path)));
}
