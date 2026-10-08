import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { parseChart, serializeChart } from '../src/core/chart.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = process.argv[2] ?? resolve(root, '../build/Release.win32/VS2015/PhiEditer/Resources');
const report = { source: 'Original Resources (read only)', tested: 0, passed: 0, versions: {} as Record<string, number>, notes: 0, failures: [] as { file: string; error: string }[], skipped: 0 };
for (const directory of await readdir(source, { withFileTypes: true })) {
  if (!directory.isDirectory()) continue;
  for (const name of await readdir(join(source, directory.name))) {
    if (!/\.(json|pec)$/i.test(name)) continue;
    const text = await readFile(join(source, directory.name, name), 'utf8');
    let original;
    try { original = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { report.skipped++; continue; }
    if (!original.BPMList || !original.META) { report.skipped++; continue; }
    report.tested++;
    try {
      const chart = parseChart(text);
      const output = JSON.parse(serializeChart(chart));
      if (!isDeepStrictEqual(original, output)) throw new Error('Roundtrip changed data');
      report.passed++;
      const version = original.META?.RPEVersion ?? 'unknown';
      report.versions[version] = (report.versions[version] ?? 0) + 1;
      report.notes += (original.judgeLineList ?? []).reduce((sum: number, line: { notes?: unknown[] }) => sum + (line.notes?.length ?? 0), 0);
    } catch (error) { report.failures.push({ file: `${directory.name}/${name}`, error: error instanceof Error ? error.message : String(error) }); }
  }
}
await writeFile(join(root, 'docs/compatibility-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, failures: report.failures.slice(0, 10) }, null, 2));
if (report.failures.length) process.exitCode = 1;
