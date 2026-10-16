import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseChart } from '../src/core/chart.ts';
import { TempoMap } from '../src/core/tempo.ts';
import { SceneRuntime } from '../src/core/scene.ts';

const project = fileURLToPath(new URL('../', import.meta.url));
const root = process.argv[2] ?? resolve(project, '../build/Release.win32/VS2015/PhiEditer/Resources');
const report = { scope: 'Read-only runtime finite-value checks; not visual equivalence.', tested: 0, passed: 0, sampledNotes: 0, failures: [] as { path: string; message: string }[] };
for (const directory of await readdir(root, { withFileTypes: true })) {
  if (!directory.isDirectory()) continue;
  for (const name of await readdir(join(root, directory.name))) {
    if (!/\.(json|pec)$/i.test(name)) continue;
    const text = await readFile(join(root, directory.name, name), 'utf8');
    let original;
    try { original = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { continue; }
    if (!original.META || !original.BPMList) continue;
    report.tested++;
    try {
      const chart = parseChart(text);
      const scene = new SceneRuntime();
      scene.compile(chart, new TempoMap(chart.BPMList));
      for (const seconds of [0, 10, 60]) {
        const states = scene.sample(seconds);
        for (const [index, state] of states.entries()) {
          if (!state) throw new Error(`Line ${index} at ${seconds}s: missing state`);
          for (const key of ['x', 'y', 'rotation', 'alpha', 'scaleX', 'scaleY', 'incline', 'floor'] as const) {
            if (!Number.isFinite(state[key])) throw new Error(`Line ${index} at ${seconds}s: ${key} is not finite`);
          }
          if (!Array.isArray(state.color) || state.color.length !== 3 || !state.color.every(Number.isFinite)) throw new Error(`Line ${index}: invalid color`);
          const runtime = scene.lines[index];
          for (const entry of runtime.visibleNotes(seconds, state)) {
            const noteState = runtime.noteState(entry, state, seconds);
            for (const key of ['x', 'y', 'tail', 'size', 'alpha', 'skew'] as const) {
              if (!Number.isFinite(noteState[key])) throw new Error(`Line ${index} at ${seconds}s: note ${key} is not finite`);
            }
            report.sampledNotes++;
          }
        }
      }
      report.passed++;
    } catch (error) { report.failures.push({ path: `${directory.name}/${name}`, message: error instanceof Error ? error.message : String(error) }); }
  }
}
await writeFile(join(project, 'docs/scene-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (report.failures.length) process.exitCode = 1;
