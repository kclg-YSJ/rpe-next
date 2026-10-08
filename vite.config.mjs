import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// GitHub Pages publishes the site under /rpe-next/; every other target (local preview and the
// Electron desktop build) serves it from the domain root. `--mode pages` selects the subpath.
const PAGES_BASE = '/rpe-next/';
const base = (mode) => (mode === 'pages' ? PAGES_BASE : '/');

// package.json is the single source of truth for the app version. This plugin substitutes the
// %APP_VERSION% token in index.html during both `vite` and `vite build`, and exposes the same
// value to application code as the `__APP_VERSION__` constant.
function appVersion(root) {
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  return {
    name: 'rpe-app-version',
    config: () => ({ define: { __APP_VERSION__: JSON.stringify(version) } }),
    transformIndexHtml: html => html.replaceAll('%APP_VERSION%', version),
  };
}

// Vite only copies publicDir into the build, so the licence files that must travel with every
// distributed copy, and the marker that stops GitHub Pages from running Jekyll, are emitted here.
// Keeping a single source of truth for LICENSE and NOTICE at the repository root.
function distributionExtras(root) {
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

export default defineConfig(({ mode }) => ({
  base: base(mode),
  // Static resources live in public/assets and are copied to dist/ verbatim, because the editor
  // resolves most of them at runtime (textures, easing pictures, shaders, hitsounds) and so they
  // cannot be content-hashed by the bundler.
  publicDir: 'public',
  // The editor is a single document with no client-side routing, so unknown paths must 404
  // instead of falling back to index.html — that keeps the smoke test's asset checks meaningful.
  appType: 'mpa',
  plugins: [vue(), distributionExtras(import.meta.dirname), appVersion(import.meta.dirname)],
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
