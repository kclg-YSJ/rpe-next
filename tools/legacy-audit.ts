import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from '../src/core/formats.ts';
import { decodeLegacy } from '../src/platform/legacy-text.ts';

const project = fileURLToPath(new URL('../', import.meta.url));
const root = process.argv[2] ?? resolve(project, '../build/Release.win32/VS2015/PhiEditer/Resources');
const report = { scope: 'Read-only text parsing; visual equivalence is not certified.', tested: 0, passed: 0, failures: [] as { path: string; message: string }[] };
for (const directory of await readdir(root, { withFileTypes: true })) {
  if (!directory.isDirectory()) continue;
  for (const name of await readdir(join(root, directory.name))) {
    if (!/\.pec$/i.test(name)) continue;
    const text = decodeLegacy(await readFile(join(root, directory.name, name)));
    if (text.trimStart().startsWith('{')) continue;
    report.tested++;
    try { parseDocument(text); report.passed++; }
    catch (error) { report.failures.push({ path: `${directory.name}/${name}`, message: error instanceof Error ? error.message : String(error) }); }
  }
}
await writeFile(join(project, 'docs/legacy-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (report.failures.length) process.exitCode = 1;
