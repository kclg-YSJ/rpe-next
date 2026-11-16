import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const fixed = ['index.html', 'styles.css', 'manifest.webmanifest', 'pwa-precache.json'];
const files = [];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (relative(root, path).replaceAll(sep, '/') === 'assets/agent-source.json') continue;
      await walk(path);
    } else if (await stat(path).then(item => item.isFile())) {
      files.push(relative(root, path).replaceAll(sep, '/'));
    }
  }
}

await walk(join(root, 'src'));
await walk(join(root, 'assets'));
const paths = [...new Set([...fixed, ...files.filter(path => !path.startsWith('src/dev/') && path !== 'assets/agent-source.json')])].sort();
const list = paths.map(path => './' + path);
await writeFile(join(root, 'pwa-precache.json'), JSON.stringify({ version: metadata.version, files: list }, null, 2) + '\n');
console.log(`pwa-precache.json: ${list.length} files`);
