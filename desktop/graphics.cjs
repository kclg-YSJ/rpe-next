const { readFileSync, statSync } = require('node:fs');
const { writeFile, rename, rm } = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { join } = require('node:path');

const DEFAULTS = Object.freeze({ preferDiscrete: true, warnOnIntegrated: true });
const clean = value => typeof value === 'string' ? value.replace(/[\r\n\0]/g, ' ').trim().slice(0, 256) : '';
const vendor = value => typeof value === 'number' ? value : /^0x/i.test(String(value)) ? parseInt(value, 16) : Number(value);
const nvidia = device => vendor(device.vendorId) === 0x10de || /\bNVIDIA\b/i.test(device.deviceString ?? device.name ?? '');
const name = device => clean(device.deviceString || device.name) || (nvidia(device) ? 'NVIDIA GPU' : '');

function readPreferences(path) {
  try {
    if (statSync(path).size > 4096) return { ...DEFAULTS };
    const value = JSON.parse(readFileSync(path, 'utf8'));
    return Object.fromEntries(Object.entries(DEFAULTS).map(([key, fallback]) => [key, typeof value?.[key] === 'boolean' ? value[key] : fallback]));
  } catch { return { ...DEFAULTS }; }
}

function inspectGraphics(info = {}, features = {}, inventory = []) {
  const devices = Array.isArray(info.gpuDevice) ? info.gpuDevice : [];
  const candidates = [...new Set([...devices, ...inventory].filter(nvidia).map(name).filter(Boolean))];
  const active = devices.filter(device => device.active === true);
  const actualRenderer = clean(info.auxAttributes?.glRenderer);
  const renderer = actualRenderer || (active.length === 1 ? name(active[0]) : '');
  const software = /SwiftShader|llvmpipe|softpipe|\bWARP\b|Microsoft Basic Render|GDI Generic/i.test(renderer)
    || !actualRenderer && features.gpu_compositing === 'disabled_software' && /software|disabled/.test(features.webgl ?? '');
  const integrated = /Intel.*(?:UHD|HD Graphics|Iris|Xe Graphics)/i.test(renderer) && !/\bArc\b|Iris.*\bMAX\b/i.test(renderer)
    || /(?:AMD|Radeon).*(?:Vega|Radeon\(TM\) Graphics|\b[6789]\d\dM\b)/i.test(renderer);
  // The display adapter may be Intel while ANGLE renders on NVIDIA. Renderer
  // evidence wins; conflicting or incomplete adapter reports never prompt.
  const conflicting = !software && integrated && active.some(nvidia);
  const reason = candidates.length && (software || !/\bNVIDIA\b/i.test(renderer)) && !conflicting ? software ? 'software' : integrated ? 'integrated' : null : null;
  return { renderer: renderer || null, candidates, reason, needsWarning: reason !== null };
}

function windowsNvidiaInventory() {
  return new Promise(resolve => {
    const script = "[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); @(Get-CimInstance Win32_VideoController -ErrorAction Stop | Where-Object { $_.ConfigManagerErrorCode -eq 0 -and $_.PNPDeviceID -match 'VEN_10DE' } | ForEach-Object { [pscustomobject]@{name=$_.Name;vendorId=4318} }) | ConvertTo-Json -Compress";
    execFile(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 6000, maxBuffer: 65536, encoding: 'utf8' }, (error, output) => {
      if (error) { resolve([]); return; }
      try { const data = JSON.parse(output || '[]'); resolve((Array.isArray(data) ? data : [data]).filter(value => value && typeof value === 'object')); }
      catch { resolve([]); }
    });
  });
}

class DesktopGraphics {
  constructor({ app, statePath, platform = process.platform, inventory = windowsNvidiaInventory, save } = {}) {
    Object.assign(this, { app, statePath, platform, inventory });
    this.preferences = readPreferences(statePath); this.runningPreference = this.preferences.preferDiscrete;
    this.save = save ?? (async value => {
      const temporary = statePath + '.write-' + randomUUID();
      try { await writeFile(temporary, JSON.stringify(value), { flag: 'wx' }); await rename(temporary, statePath); }
      finally { await rm(temporary, { force: true }).catch(() => {}); }
    });
    if (platform === 'win32' && this.preferences.preferDiscrete && !['force_low_power_gpu', 'force-low-power-gpu', 'disable-gpu'].some(flag => app.commandLine.hasSwitch(flag))) {
      // Electron's platform preference and Chromium's ANGLE preference must be
      // set before app.ready, before any GPU process or WebGL context exists.
      app.commandLine.appendSwitch('force_high_performance_gpu');
      app.commandLine.appendSwitch('force-high-performance-gpu');
    }
  }
  status() {
    return { platform: this.platform, preferences: { ...this.preferences }, restartNeeded: this.runningPreference !== this.preferences.preferDiscrete, detection: this.detection ?? null };
  }
  async update(value) {
    if (!value || typeof value !== 'object' || Object.keys(value).some(key => !Object.hasOwn(DEFAULTS, key) || typeof value[key] !== 'boolean')) throw Error('Invalid graphics preferences');
    const patch = { ...value };
    const pending = (this.saving ?? Promise.resolve()).catch(() => {}).then(async () => { const next = { ...this.preferences, ...patch }; await this.save(next); this.preferences = next; });
    this.saving = pending; await pending; return this.status();
  }
  check() {
    if (this.pending) return this.pending;
    if (this.checked && Date.now() - this.checked < 5000) return Promise.resolve(this.status());
    this.pending = (async () => {
      let timer, info = {}, features = {};
      try {
        info = await Promise.race([this.app.getGPUInfo('complete'), new Promise(resolve => { timer = setTimeout(() => resolve({}), 8000); })]) || {};
        features = this.app.getGPUFeatureStatus();
      } catch { /* Device queries can be unavailable during a driver restart. */ }
      finally { clearTimeout(timer); }
      if (this.platform === 'win32' && !(info.gpuDevice ?? []).some(nvidia)) this.devices ??= await this.inventory().catch(() => []);
      this.detection = inspectGraphics(info, features, this.devices);
      this.checked = Date.now(); return this.status();
    })().finally(() => { this.pending = null; });
    return this.pending;
  }
}

function installGraphics({ ipcMain, service, window: getWindow, origin, shell, clipboard, executable = process.execPath }) {
  ipcMain.handle('rpen-graphics', async (event, request) => {
    const win = getWindow();
    if (event.sender !== win?.webContents || event.senderFrame !== event.sender.mainFrame || !event.senderFrame.url.startsWith(origin + '/')) throw Error('Forbidden');
    if (request?.action === 'status') return service.status();
    if (request?.action === 'check') return service.check();
    if (request?.action === 'preferences') return service.update(request.value);
    if (request?.action === 'copy-path') { clipboard.writeText(executable); return service.status(); }
    if (request?.action === 'open-settings' && service.platform === 'win32') { await shell.openExternal('ms-settings:display-advancedgraphics'); return service.status(); }
    throw Error('Unknown graphics action');
  });
}

module.exports = { DesktopGraphics, installGraphics, inspectGraphics, readPreferences };
