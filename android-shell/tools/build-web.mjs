/*
 * Runs the editor's static web build (../../tools/build.mjs --pages) from the shell directory.
 *
 * The Android shell never bundles its own copy of the editor: `cap sync` copies `dist/` from the
 * repository root into the APK, so the app can never drift from the source next to it.
 *
 * Run: node tools/build-web.mjs
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const repo = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const result = spawnSync(process.execPath, ['tools/build.mjs', '--pages'], { cwd: repo, stdio: 'inherit' });
process.exit(result.status ?? 1);
