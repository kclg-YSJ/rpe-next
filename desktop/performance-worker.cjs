const { parentPort } = require('node:worker_threads');
const os = require('node:os'), { spawn } = require('node:child_process'), { join } = require('node:path'), { existsSync } = require('node:fs');
let previous = null, gpu = null, gpuProcess = null, buffer = '', stopped = false, fallback = false, snapshot = {};
const publish = () => { if (!stopped) parentPort.postMessage({ ...snapshot, gpu: gpu?.gpu ?? null, gpuMemory: gpu?.gpuMemory ?? null, gpuVendor: gpu?.gpuVendor }); };
function sample() {
  const cpus = os.cpus(); let total = 0, idle = 0;
  for (const cpu of cpus) { idle += cpu.times.idle; for (const value of Object.values(cpu.times)) total += value; }
  const systemCpu = previous && total > previous.total ? Math.max(0, Math.min(100, (1 - (idle - previous.idle) / (total - previous.total)) * 100)) : null;
  previous = { total, idle };
  snapshot = { systemCpu, systemMemory: os.totalmem() - os.freemem(), systemMemoryTotal: os.totalmem() }; publish();
}
function windowsGpu() {
  if (process.platform !== 'win32' || stopped || fallback) return;
  fallback = true; buffer = '';
  gpuProcess = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(__dirname, 'performance-gpu.ps1')], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  gpuProcess.on('error', () => { gpuProcess = null; });
  gpuProcess.stdout.on('data', data => {
    buffer += data.toString(); if (buffer.length > 32768) buffer = '';
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, index); buffer = buffer.slice(index + 1); try { gpu = JSON.parse(line); publish(); } catch {} }
  });
}
const candidates = process.platform === 'win32' ? [join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'nvidia-smi.exe'), join(process.env.ProgramFiles ?? 'C:\\Program Files', 'NVIDIA Corporation', 'NVSMI', 'nvidia-smi.exe')] : ['/usr/bin/nvidia-smi', '/usr/local/bin/nvidia-smi'];
const executable = candidates.find(path => existsSync(path));
if (executable) {
  const devices = new Map();
  const current = gpuProcess = spawn(executable, ['--query-gpu=index,utilization.gpu,memory.used', '--format=csv,noheader,nounits', '--loop=1'], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  current.on('error', windowsGpu); current.on('exit', windowsGpu);
  current.stdout.on('data', data => {
    buffer += data.toString(); if (buffer.length > 32768) buffer = '';
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim(); buffer = buffer.slice(index + 1);
      const values = line.split(',').map(value => value.trim()); if (values.length !== 3 || !/^\d+$/.test(values[0])) continue;
      const usage = Number(values[1]), memory = Number(values[2]);
      devices.set(values[0], { usage: Number.isFinite(usage) ? usage : null, memory: Number.isFinite(memory) ? memory * 1024 ** 2 : null });
      const usages = [...devices.values()].map(value => value.usage).filter(Number.isFinite), memories = [...devices.values()].map(value => value.memory).filter(Number.isFinite);
      gpu = { gpuVendor: 'NVIDIA', gpu: usages.length ? Math.max(...usages) : null, gpuMemory: memories.length ? memories.reduce((a, b) => a + b, 0) : null };
      publish();
    }
  });
} else windowsGpu();
sample(); const timer = setInterval(sample, 1000);
parentPort.on('message', message => {
  if (message !== 'stop') return;
  stopped = true; clearInterval(timer); gpuProcess?.stdin.end(); gpuProcess?.kill(); parentPort.close();
});
