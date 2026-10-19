import type { WebContents } from 'electron';

/** Measure save responsiveness and media reuse inside the renderer. */
export async function smokeSaving(contents: WebContents): Promise<unknown> {
  return contents.executeJavaScript(`(async () => {
    const check = (value, message) => { if (!value) throw Error(message); };
    const until = async (condition, ms = 15000) => { const end = performance.now() + ms; while (!await condition()) { if (performance.now() > end) throw Error('Saving test startup timeout'); await new Promise(resolve => setTimeout(resolve, 40)); } };
    await until(() => window.rpenMods);
    const e = window.rpenMods.editor, { nativeStorage } = await import('/src/platform/native.ts');
    const library = await import('/src/platform/library.ts'), recovery = await import('/src/platform/recovery.ts');
    const bytes = new Uint8Array(48 * 1024 ** 2); for (let index = 0; index < bytes.length; index += 4096) bytes[index] = index / 4096 % 251;
    const { createChart, createNote } = await import('/src/core/chart.ts');
    const chart = createChart(); chart.judgeLineList[0].notes = Array.from({ length: 3000 }, (_, index) => createNote(1, index / 4, 0));
    const coverCanvas = document.createElement('canvas'); coverCanvas.width = 2400; coverCanvas.height = 1600;
    coverCanvas.getContext('2d').fillRect(0, 0, coverCanvas.width, coverCanvas.height);
    const cover = new Uint8Array(await (await new Promise(resolve => coverCanvas.toBlob(resolve))).arrayBuffer());
    chart.META.background = 'cover.png';
    const project = { id: 'saving-performance-' + crypto.randomUUID(), chart, chartName: 'chart.json', assets: [['music.bin', bytes], ['cover.png', cover]], updated: Date.now() };
    const metrics = []; const call = nativeStorage.call;
    for (const phase of ['first', 'repeat', 'changed']) {
      const calls = {}, durations = {}; let ticks = 0;
      nativeStorage.call = async function(method, ...args) { const start = performance.now(); calls[method] = (calls[method] ?? 0) + 1; try { return await call(method, ...args); } finally { durations[method] = (durations[method] ?? 0) + performance.now() - start; } };
      if (phase === 'changed') bytes[513] = 73;
      const timer = setInterval(() => ticks++, 5), started = performance.now();
      try { await library.storeProject(project); } finally { clearInterval(timer); nativeStorage.call = call; }
      metrics.push({ phase, ms: performance.now() - started, responsiveTicks: ticks, calls, durations });
    }
    const restored = await library.readProject(project.id);
    check(restored.assets[0][1][513] === 73 && bytes.byteLength === 48 * 1024 ** 2, 'Saved media changed or buffer detached');
    check(metrics[0].calls.binaryChunk > 0 && !metrics[1].calls.binaryChunk && metrics[2].calls.binaryChunk > 0, 'Unchanged media was retransmitted, or changed media was reused');
    check((await library.listProjects()).find(item => item.id === project.id).thumbnail instanceof Blob, 'Cover thumbnail was not preserved');
    const { projectThumbnail } = await import('/src/platform/thumbnail.ts');
    const cached = await projectThumbnail(project); check(cached === await projectThumbnail(project), 'Unchanged cover thumbnail was regenerated');
    const backupCalls = {};
    nativeStorage.call = async function(method, ...args) { backupCalls[method] = (backupCalls[method] ?? 0) + 1; return call(method, ...args); };
    const backupStarted = performance.now();
    try { await recovery.saveSnapshot(project.id, project.chartName, project.chart, restored.assets); } finally { nativeStorage.call = call; }
    const backupMs = performance.now() - backupStarted;
    check(!backupCalls.binaryChunk, 'Recovery backup retransmitted saved media');
    const savedDrafts = await recovery.listDrafts(project.id), backup = await recovery.readDraft(savedDrafts[0].id);
    check(backup.assets[0][1][513] === 73, 'Recovery media reference was lost');
    const { createNoiseArea, createNoiseEvent, withNoiseAreas } = await import('/src/core/noise-areas.ts');
    const noiseChart = withNoiseAreas(createChart(), Array.from({ length: 2000 }, (_, index) => ({ ...createNoiseArea(index, index + 4), moveXEvents: [createNoiseEvent(0, 20, index, index + 1)], rotateEvents: [createNoiseEvent(0, 20, index, index + 1, {x:0,y:0})] })));
    const dense = { id: 'dense-saving-' + crypto.randomUUID(), chart: noiseChart, chartName: 'dense.json', assets: [], updated: Date.now() };
    const denseCalls = {}; let ticks = 0;
    nativeStorage.call = async function(method, ...args) { denseCalls[method] = (denseCalls[method] ?? 0) + 1; return call(method, ...args); };
    const denseTimer = setInterval(() => ticks++, 5), denseStarted = performance.now();
    try { await library.storeProject(dense); } finally { clearInterval(denseTimer); nativeStorage.call = call; }
    const denseMs = performance.now() - denseStarted;
    check((await library.readProject(dense.id)).chart.blockAreaList.length === 2000, 'Dense chart save lost noise areas');
    check(!denseCalls.part && denseCalls.parts < 200 && ticks > 0, 'Dense save did not batch or yield');
    return { sizeMiB: 48, metrics, backup: { ms: backupMs, calls: backupCalls }, dense: { ms: denseMs, calls: denseCalls, responsiveTicks: ticks } };
  })()`, true);
}
