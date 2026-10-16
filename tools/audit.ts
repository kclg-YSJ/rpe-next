import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));
const original = resolve(project, '..');
const manifestPath = join(project, 'docs', 'original-baseline.json');

async function collect(directory: string): Promise<string[]> {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await collect(path));
    else if (/\.(cpp|h|vcxproj|filters|sln|cmake)$/i.test(entry.name) || entry.name === 'CMakeLists.txt') paths.push(path);
  }
  return paths;
}

async function fingerprint(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

if (process.argv.includes('--verify')) {
  const baseline = JSON.parse(await readFile(manifestPath, 'utf8'));
  const changed: string[] = [];
  for (const [path, hash] of Object.entries(baseline.files)) {
    try { if (await fingerprint(join(original, path)) !== hash) changed.push(path); }
    catch { changed.push(path); }
  }
  console.log(JSON.stringify({ checked: Object.keys(baseline.files).length, changed }, null, 2));
  if (changed.length) process.exitCode = 1;
} else {
  const paths = [...await collect(join(original, 'tests/cpp-empty-test/Classes')),
    ...await collect(join(original, 'tests/cpp-empty-test/proj.win32')),
    join(original, 'tests/cpp-empty-test/CMakeLists.txt'), join(original, 'build/cocos2d-win32.sln'),
    ...['UI.txt', 'Hotkey.txt', 'Settings.json'].map(name => join(original, 'build/Release.win32/VS2015/PhiEditer', name))];
  const files: Record<string, string> = {};
  for (const path of paths.sort()) files[relative(original, path).replaceAll('\\', '/')] = await fingerprint(path);
  await writeFile(manifestPath, JSON.stringify({ created: new Date().toISOString(), files }, null, 2), { flag: 'wx' });
  console.log(`Recorded ${paths.length} original files; existing baselines are never overwritten.`);
}
