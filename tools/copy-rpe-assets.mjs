import { mkdir, copyFile, readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const project = fileURLToPath(new URL('../', import.meta.url));
const source = resolve(project, '../build/Release.win32/VS2015/PhiEditer/Resources');
const textures = ['Tap2', 'Tap2HL', 'Drag2', 'DragHL', 'Flick2', 'Flick2HL', 'Hold', 'Hold3', 'HoldHL', 'HoldHead', 'HoldHeadHL', 'HoldEnd', 'line', 'Pause', 'Arrow2'];
const icons = ['play', 'pause1', 'replay', 'save', 'folder', 'setting', 'info', 'addline', 'tree', 'copy', 'paste', 'shear', 'delete0', 'bezier', 'waves', 'showback', 'layout', 'help', 'return', 'plus', 'minus', 'import1', 'edit', 'switch', 'jump'];
const shaderRoot = join(source, 'shaders');
const shaderPaths = (await readdir(shaderRoot, { withFileTypes: true }))
  .filter(entry => entry.isFile() && /\.(glsl|vsh)$/i.test(entry.name))
  .map(entry => `shaders/${entry.name}`);
const shaderPrRoot = join(shaderRoot, 'pr');
const shaderPrPaths = (await readdir(shaderPrRoot, { withFileTypes: true }))
  .filter(entry => entry.isFile() && /\.glsl$/i.test(entry.name))
  .map(entry => `shaders/pr/${entry.name}`);
const paths = [...textures.map(name => `Texture/${name}.png`), ...icons.map(name => `Texture/icon/${name}.png`),
  ...Array.from({ length: 31 }, (unused, index) => `Texture/img-${index + 1}.png`),
  ...shaderPaths, ...shaderPrPaths,
  'fonts/cmdysj.ttf', 'icons/rpelogo.png', 'SE/tap.ogg', 'SE/drag.ogg', 'SE/flick.ogg'];
const manifest = { source: 'Original RPE Resources, reused with owner permission; originals are read only.', files: [] };
const shaderFixes = {
  'shaders/oil_painting.glsl': text => text.replace('float m = -1; m <= 1;', 'float m = -1.0; m <= 1.0;').replace('float n = -1; n <= 1;', 'float n = -1.0; n <= 1.0;'),
  'shaders/lightning.glsl': text => text.replace('float i = 0; i < numBolts;', 'float i = 0.0; i < numBolts;'),
  'shaders/heat_distortion.glsl': text => text.replace(') * 2 - 1.0;', ') * 2.0 - 1.0;'),
};
for (const path of paths) {
  const destination = join(project, 'public/assets/rpe', path);
  await mkdir(resolve(destination, '..'), { recursive: true });
  await copyFile(join(source, path), destination);
  if (shaderFixes[path]) await writeFile(destination, shaderFixes[path](await readFile(destination, 'utf8')));
  const bytes = await readFile(destination);
  manifest.files.push({ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
await writeFile(join(project, 'public/assets/rpe/manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`Copied ${paths.length} original assets into the independent project.`);
