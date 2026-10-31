const { Worker } = require('node:worker_threads');
const { join } = require('node:path');

function installPerformanceMonitor({ app, ipcMain, origin, window: getWindow, createWorker = () => new Worker(join(__dirname, 'performance-worker.cjs')) }) {
  let worker = null, latest = null, active = false, lastRequest = 0, cpuTime = null, processors = 1;
  const stop = () => { active = false; latest = null; lastRequest = 0; cpuTime = null; worker?.postMessage('stop'); worker = null; };
  const start = () => {
    if (active) return;
    active = true;
    processors = require('node:os').cpus().length || 1;
    const current = worker = createWorker();
    worker.on('message', value => { if (active && worker === current) latest = value; });
    worker.on('error', () => { if (worker === current) latest = null; });
  };
  ipcMain.handle('rpen-performance', (event, action) => {
    const win = getWindow();
    if (event.sender !== win?.webContents || event.senderFrame !== event.sender.mainFrame || !event.senderFrame.url.startsWith(origin + '/')) throw Error('Forbidden');
    if (action === 'stop') { stop(); return null; }
    if (!['start', 'sample'].includes(action)) throw Error('Unknown performance action');
    if (action === 'start') start();
    if (!active) return null;
    const now = Date.now();
    if (now - lastRequest < 750) return latest;
    lastRequest = now;
    const metrics = app.getAppMetrics(), current = new Map(metrics.map(value => [value.pid, value.cpu?.cumulativeCPUUsage]));
    let appCpu = null;
    if (cpuTime && now > cpuTime.now) {
      let seconds = 0, cumulative = false;
      for (const [pid, value] of current) if (Number.isFinite(value) && Number.isFinite(cpuTime.values.get(pid))) { seconds += Math.max(0, value - cpuTime.values.get(pid)); cumulative = true; }
      appCpu = Math.min(100, cumulative ? seconds * 100000 / ((now - cpuTime.now) * processors) : metrics.reduce((sum, value) => sum + (value.cpu?.percentCPUUsage ?? 0), 0));
    }
    cpuTime = { now, values: current };
    const appMemory = metrics.reduce((sum, value) => sum + (value.memory?.workingSetSize ?? 0) * 1024, 0);
    return { ...latest, appCpu, appMemory };
  });
  app.on('before-quit', stop);
  return stop;
}
module.exports = { installPerformanceMonitor };
