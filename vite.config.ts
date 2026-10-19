import { readFileSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';

// GitHub Pages publishes the site under /rpe-next/; every other target (local preview and the
// Electron desktop build) serves it from the domain root. `--mode pages` selects the subpath.
const PAGES_BASE = '/rpe-next/';
const base = (mode: string): string => (mode === 'pages' ? PAGES_BASE : '/');

// package.json is the single source of truth for the app version. This plugin substitutes the
// %APP_VERSION% token in index.html during both `vite` and `vite build`, and exposes the same
// value to application code as the `__APP_VERSION__` constant.
function appVersion(root: string): Plugin {
  const version = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as unknown as { version: string }).version;
  return {
    name: 'rpe-app-version',
    config: () => ({ define: { __APP_VERSION__: JSON.stringify(version) } }),
    transformIndexHtml: (html: string) => html.replaceAll('%APP_VERSION%', version),
  };
}

// Vite only copies publicDir into the build, so the licence files that must travel with every
// distributed copy, and the marker that stops GitHub Pages from running Jekyll, are emitted here.
// Keeping a single source of truth for LICENSE and NOTICE at the repository root.
function distributionExtras(root: string): Plugin {
  return {
    name: 'rpe-distribution-extras',
    apply: 'build',
    buildStart() {
      for (const name of ['LICENSE', 'NOTICE']) {
        this.emitFile({ type: 'asset', fileName: name, source: readFileSync(join(root, name), 'utf8') });
      }
      this.emitFile({ type: 'asset', fileName: '.nojekyll', source: '' });
    },
  };
}

// The built-in editor and noise skins live in the repository-root `assets/` directory and are
// resolved at runtime through `assetUrl()` (see src/core/asset-url.ts), so they cannot be
// bundled or content-hashed. publicDir only mirrors `public/assets`, which holds the legacy RPE
// resources, so copy these skin packages into dist/assets/ to keep every built target — local
// preview, GitHub Pages and the Electron package — able to load them.
function skinAssets(root: string): Plugin {
  const directories = ['editor-skins', 'noise-skins', 'mods', 'note-skins'];
  const walk = async (directory: string): Promise<string[]> => {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = await Promise.all(entries.map(entry => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? walk(path) : [path];
    }));
    return files.flat();
  };
  return {
    name: 'rpe-skin-assets',
    apply: 'build',
    async buildStart() {
      const assetsRoot = join(root, 'assets');
      for (const name of directories) {
        if (!existsSync(join(assetsRoot, name))) continue;
        for (const file of await walk(join(assetsRoot, name))) {
          const emitted = relative(assetsRoot, file).split(sep).join('/');
          this.emitFile({ type: 'asset', fileName: `assets/${emitted}`, source: await readFile(file) });
        }
      }
    },
  };
}

// Protocols and machine-readable schemas are fetched at runtime by the mod and skin managers, so
// they travel with every build just like the skin packages.
function documentAssets(root: string): Plugin {
  const walk = async (directory: string): Promise<string[]> => {
    const entries = await readdir(directory, { withFileTypes: true });
    return (await Promise.all(entries.map(entry => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? walk(path) : [path];
    }))).flat();
  };
  return {
    name: 'rpe-document-assets',
    apply: 'build',
    async buildStart() {
      for (const name of ['protocols', 'schemas']) {
        if (!existsSync(join(root, name))) continue;
        for (const file of await walk(join(root, name))) {
          this.emitFile({ type: 'asset', fileName: relative(root, file).split(sep).join('/'), source: await readFile(file) });
        }
      }
    },
  };
}

export default defineConfig(({ mode }) => ({
  base: base(mode),
  // Static resources live in public/assets and are copied to dist/ verbatim, because the editor
  // resolves most of them at runtime (textures, easing pictures, shaders, hitsounds) and so they
  // cannot be content-hashed by the bundler.
  publicDir: 'public',
  // The editor is a single document with no client-side routing, so unknown paths must 404
  // instead of falling back to index.html — that keeps the smoke test's asset checks meaningful.
  appType: 'mpa',
  plugins: [vue(), distributionExtras(import.meta.dirname), skinAssets(import.meta.dirname), documentAssets(import.meta.dirname), appVersion(import.meta.dirname)],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // The editor is a plain ES module app and the desktop/Pages builds are smoke tested against
    // the emitted file names, so keep the bundle modern and predictable.
    target: 'es2022',
    // Report the gzip size next to the raw size. The raw number is what lands on disk, but the
    // gzip number is what a browser actually downloads from a compression-enabled host such as
    // GitHub Pages, and without it a ~360 kB bundle reads as far worse than it is.
    reportCompressedSize: true,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
  },
}));
