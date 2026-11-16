import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const pngSize = path => {
  const bytes = readFileSync(new URL(path, root));
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
};

test('PWA manifest is installable and references valid icons', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.equal(manifest.name, 'Re:PhiEdit Next');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.theme_color, '#303030');
  assert.equal(manifest.background_color, '#303030');
  const icons = manifest.icons ?? [];
  for (const [sizes, purpose] of [['192x192', 'any'], ['512x512', 'any'], ['512x512', 'maskable']]) {
    const icon = icons.find(item => item.sizes === sizes && String(item.purpose).split(/\s+/).includes(purpose));
    assert.ok(icon, `missing ${sizes} ${purpose} icon`);
    assert.ok(existsSync(fileURLToPath(new URL(icon.src, root))), `missing ${icon.src}`);
    assert.deepEqual(pngSize(icon.src), { width: Number(sizes.split('x')[0]), height: Number(sizes.split('x')[1]) });
  }
});

test('index declares the manifest, theme and app icons', () => {
  const html = read('index.html');
  assert.match(html, /<link rel="manifest" href="\.\/manifest\.webmanifest">/);
  assert.match(html, /<meta name="theme-color" content="#303030">/);
  assert.match(html, /<link rel="apple-touch-icon" href="\.\/assets\/pwa\/apple-touch-icon\.png">/);
  assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes">/);
});

test('precache manifest covers every source and asset file', () => {
  const precache = JSON.parse(read('pwa-precache.json'));
  const listed = new Set(precache.files.map(path => path.slice(2)));
  const actual = ['index.html', 'styles.css', 'manifest.webmanifest', 'pwa-precache.json'];
  const walk = directory => {
    for (const entry of readdirSync(fileURLToPath(new URL(directory + '/', root)), { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (path !== 'assets/agent-source.json' && !path.startsWith('src/dev/')) actual.push(path);
    }
  };
  walk('src'); walk('assets');
  assert.deepEqual([...listed].sort(), [...new Set(actual)].sort());
  for (const path of listed) assert.ok(existsSync(fileURLToPath(new URL(path, root))), `missing ${path}`);
});

test('service worker precaches existing shell files and registers lazily', () => {
  const worker = read('sw.js');
  const shell = worker.match(/const SHELL = \[([\s\S]*?)\];/)?.[1] ?? '';
  const paths = [...shell.matchAll(/'([^']+)'/g)].map(match => match[1]);
  assert.ok(paths.includes('./index.html'));
  assert.ok(paths.includes('./styles.css'));
  assert.ok(paths.includes('./manifest.webmanifest'));
  for (const path of paths) {
    const target = path === './' ? 'index.html' : path.slice(2);
    assert.ok(existsSync(fileURLToPath(new URL(target, root))), `missing precache file ${path}`);
  }
  assert.match(worker, /addEventListener\('install'/);
  assert.match(worker, /addEventListener\('activate'/);
  assert.match(worker, /addEventListener\('fetch'/);
  assert.match(worker, /mode === 'navigate'/);
  assert.match(worker, /startsWith\('rpe-static-'\)/);
  assert.match(read('src/platform/pwa.mjs'), /serviceWorker\.register/);
  assert.match(read('src/ui/app.mjs'), /registerPwa\(\);/);
});
