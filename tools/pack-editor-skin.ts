import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
import { parseEditorSkin } from '../src/core/editor-skin.ts';
import { writeZip } from '../src/platform/archive.ts';

if (!process.argv[2]) throw new Error('请指定皮肤目录：node tools/pack-editor-skin.ts <目录> [输出文件]');
const directory = resolve(process.argv[2]);
const files = new Map();
for (const entry of await readdir(directory, { recursive: true, withFileTypes: true })) if (entry.isFile()) {
  const path = resolve(entry.parentPath, entry.name); files.set(relative(directory, path).replaceAll('\\', '/'), new Uint8Array(await readFile(path)));
}
const record = parseEditorSkin(files);
const output = resolve(process.argv[3] ?? `release/editor-skins/${record.skin.id}.rpenskin`);
await mkdir(dirname(output), { recursive: true }); await writeFile(output, new Uint8Array(await writeZip(files).arrayBuffer()));
console.log(output);
