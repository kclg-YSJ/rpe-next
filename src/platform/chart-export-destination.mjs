import { download } from './files.mjs';

// Only chart exports use this destination; other downloads retain their own
// names and browser behaviour. A picker ID lets supporting browsers remember
// the selected directory without exposing its path to the page.
export async function saveChartExport(blob, name, host = globalThis) {
  if (host.rpenChartExport?.version === 1) {
    const response = await host.rpenChartExport.save(name, new Uint8Array(await blob.arrayBuffer()));
    if (!response.ok) throw Error(response.error);
    return response.result;
  }
  if (typeof host.showSaveFilePicker === 'function') {
    const extension = name.toLowerCase().endsWith('.json') ? '.json' : '.pez';
    let handle;
    try { handle = await host.showSaveFilePicker({ id: 'rpen-chart-export', suggestedName: name, types: [{ description: extension === '.json' ? 'JSON' : 'PEZ', accept: { [extension === '.json' ? 'application/json' : 'application/zip']: [extension] } }] }); }
    catch (error) { if (error.name === 'AbortError') return null; throw error; }
    const stream = await handle.createWritable();
    try { await stream.write(blob); await stream.close(); } catch (error) { await stream.abort().catch(() => {}); throw error; }
    return handle.name;
  }
  return download(blob, name);
}
