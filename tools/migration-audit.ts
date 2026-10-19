import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanMigration } from '../src/platform/migration.ts';
import type { MigrationEntry } from '../src/platform/migration.ts';

const project = fileURLToPath(new URL('../', import.meta.url));
const root = process.argv[2] ?? resolve(project, '../build/Release.win32/VS2015/PhiEditer');
const entries: MigrationEntry[] = [];
async function collect(directory: string, prefix = ''): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = prefix + entry.name;
    if (entry.isDirectory()) {
      if (prefix || entry.name === 'Resources') await collect(join(directory, entry.name), path + '/');
    } else if (prefix || ['Settings.json', 'Settings.txt', 'Hotkey.txt', 'UI.txt', 'Chartlist.txt'].includes(entry.name)) {
      entries.push({ path, getFile: async () => {
        const source = join(root, path);
        const info = await stat(source);
        // scanMigration only reads size and arrayBuffer from an entry's file; a full File is not
        // available under Node, so the entry carries the minimal shape the scanner consumes.
        const file = { size: info.size, arrayBuffer: async () => {
          const bytes = await readFile(source); return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        } };
        return file as unknown as File;
      } });
    }
  }
}
await collect(root);
const plan = await scanMigration(entries, 'PhiEditer');
const report = { projects: plan.projects.length, importable: plan.projects.filter(item => !item.error).length,
  failures: plan.failures, settings: plan.preferences.report, scope: 'Read-only scan; does not copy user assets into browser storage.' };
await writeFile(join(project, 'docs/migration-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (report.failures.length) process.exitCode = 1;
