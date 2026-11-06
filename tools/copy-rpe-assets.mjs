import { mkdir, copyFile, readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const project = fileURLToPath(new URL('../', import.meta.url));
const source = resolve(project, '../build/Release.win32/VS2015/PhiEditer/Resources');
const textures = ['Tap2', 'Tap2HL', 'Drag2', 'DragHL', 'Flick2', 'Flick2HL', 'Hold', 'Hold3', 'HoldHL', 'HoldHead', 'HoldHeadHL', 'HoldEnd', 'line', 'Pause', 'Arrow2'];
const icons = ['play', 'pause1', 'replay', 'save', 'folder', 'setting', 'info', 'addline', 'tree', 'copy', 'paste', 'shear', 'delete0', 'bezier', 'waves', 'showback', 'layout', 'help', 'return', 'plus', 'minus', 'import1', 'edit', 'switch', 'jump'];
const paths = [...textures.map(name => `Texture/${name}.png`), ...icons.map(name => `Texture/icon/${name}.png`),
  ...Array.from({ length: 31 }, (unused, index) => `Texture/img-${index + 1}.png`),
  'fonts/cmdysj.ttf', 'icons/rpelogo.png', 'SE/tap.ogg', 'SE/drag.ogg', 'SE/flick.ogg'];
const manifest = { source: 'Original RPE Resources, reused with owner permission; originals are read only.', files: [] };
for (const path of paths) {
  const destination = join(project, 'assets/rpe', path);
  await mkdir(resolve(destination, '..'), { recursive: true });
  await copyFile(join(source, path), destination);
  const bytes = await readFile(destination);
  manifest.files.push({ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
// Shader sources are maintained in the unified Phira format; never overwrite
// them with the two legacy copies from the reference project.
for (const entry of await readdir(join(project, 'assets/rpe/shaders'), { withFileTypes: true })) {
  if (!entry.isFile()) continue;
  const path = 'shaders/' + entry.name, bytes = await readFile(join(project, 'assets/rpe', path));
  manifest.files.push({ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
await writeFile(join(project, 'assets/rpe/manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`Copied ${paths.length} original assets into the independent project.`);
