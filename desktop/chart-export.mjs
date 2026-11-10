import { readFile, writeFile, rename, unlink, mkdir } from 'node:fs/promises';
import { dirname, basename, join, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';

export class ChartExportDestination {
  constructor(statePath, fallback) { this.statePath = statePath; this.fallback = fallback; }
  async initialize() {
    try { const state = JSON.parse(await readFile(this.statePath, 'utf8')); if (typeof state.directory === 'string' && isAbsolute(state.directory)) this.directory = state.directory; } catch { /* First export uses Downloads. */ }
    return this;
  }
  async save(name, bytes, choose) {
    if (typeof name !== 'string' || name !== basename(name) || /[\\/\0]/.test(name) || !/\.(json|pez)$/i.test(name) || !(bytes instanceof Uint8Array)) throw Error('谱面导出内容无效');
    const selected = await choose({ defaultPath: join(this.directory ?? this.fallback, name), filters: [{ name: name.toLowerCase().endsWith('.json') ? 'JSON' : 'PEZ', extensions: [name.split('.').at(-1)] }] });
    if (selected.canceled || !selected.filePath) return null;
    const temporary = join(dirname(selected.filePath), '.rpen-export-' + randomUUID());
    try { await writeFile(temporary, bytes, { flag: 'wx' }); await rename(temporary, selected.filePath); }
    finally { await unlink(temporary).catch(() => {}); }
    this.directory = dirname(selected.filePath);
    const stateTemp = this.statePath + '.' + randomUUID() + '.partial';
    try { await mkdir(dirname(this.statePath), { recursive: true }); await writeFile(stateTemp, JSON.stringify({ directory: this.directory })); await rename(stateTemp, this.statePath); }
    catch { /* The exported chart succeeded; keep the directory for this run. */ }
    finally { await unlink(stateTemp).catch(() => {}); }
    return basename(selected.filePath);
  }
}

export function installChartExport({ ipcMain, service, window, origin, dialog }) {
  ipcMain.handle('rpen-chart-export', async (event, name, bytes) => {
    try {
      if (!window() || event.sender !== window().webContents || event.senderFrame !== event.sender.mainFrame || !event.senderFrame.url.startsWith(origin + '/')) throw Error('无效的谱面导出来源');
      return { ok: true, result: await service.save(name, bytes, options => dialog.showSaveDialog(window(), options)) };
    } catch (error) { return { ok: false, error: error.message }; }
  });
}
