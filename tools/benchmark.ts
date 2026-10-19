import { performance } from 'node:perf_hooks';
import { writeFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import { IntervalIndex } from '../src/core/interval-index.ts';
import { TempoMap } from '../src/core/tempo.ts';

const notes = Array.from({ length: 100000 }, (unused, index) => ({ start: index / 16, end: index / 16 + (index % 10 === 0 ? 8 : 0) }));
let start = performance.now();
const index = new IntervalIndex(notes, note => note.start, note => note.end);
const buildMs = performance.now() - start;
const timings = [];
let found = 0;
for (let iteration = 0; iteration < 10000; iteration++) {
  const beat = iteration % 6000;
  start = performance.now();
  found += index.query(beat, beat + 8).length;
  timings.push(performance.now() - start);
}
timings.sort((left, right) => left - right);
const tempo = new TempoMap(Array.from({ length: 1000 }, (unused, index) => ({ startTime: [index * 4, 0, 1], bpm: 60 + index % 180 })));
start = performance.now();
for (let iteration = 0; iteration < 100000; iteration++) tempo.seconds(iteration / 25, 1.5);
const report = { platform: process.platform, architecture: process.arch, node: process.version, cpu: cpus()[0].model,
  notes: notes.length, indexBuildMs: buildMs, queryP50Ms: timings[5000], queryP95Ms: timings[9500], tempo100kMs: performance.now() - start, found,
  scope: 'Core microbenchmark only; not renderer FPS, whole-project memory, or audio drift certification.' };
await writeFile(new URL('../docs/benchmark-report.json', import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
