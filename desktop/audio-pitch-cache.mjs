import { mkdir, readFile, writeFile, readdir, lstat, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// Shares the existing movable audio-analysis cache; no new runtime-root schema.
export function installAudioPitchCache({ ipcMain, storage, origin, window }) {
  ipcMain.handle('rpen-audio-pitch-cache', async (event, { action, key, bytes } = {}) => {
    try {
      const url = new URL(event.senderFrame.url);
      if (event.sender !== window()?.webContents || event.senderFrame !== event.sender.mainFrame || `${url.protocol}//${url.host}` !== origin) throw Error('Invalid audio cache origin');
      if (!['read', 'write', 'clear'].includes(action) || action !== 'clear' && !/^[a-f0-9]{64}$/.test(key ?? '')) throw Error('Invalid audio cache request');
      if (action === 'write' && (!(bytes instanceof Uint8Array) || bytes.length > 2 * 1024 ** 2 || bytes.length < 32)) throw Error('Invalid pitch cache size');
      if (!await storage.prepare()) return { ok: true, result: null };
      const result = await storage.access(async () => {
        const root = join(await storage.directory('onsets', 'cache'), 'pitch-v1'); await mkdir(root, { recursive: true });
        const info = await lstat(root); if (info.isSymbolicLink() || !info.isDirectory()) throw Error('Invalid pitch cache directory');
        const file = join(root, key + '.bin');
        if (action === 'read') {
          try { const info = await lstat(file); if (!info.isFile() || info.isSymbolicLink() || info.size > 2 * 1024 ** 2) return null; return new Uint8Array(await readFile(file)); }
          catch (error) { if (error.code === 'ENOENT') return null; throw error; }
        }
        const entries = [];
        for (const name of await readdir(root)) if (/^[a-f0-9]{64}\.bin$/.test(name)) { const path = join(root, name), stat = await lstat(path); if (stat.isFile() && !stat.isSymbolicLink()) entries.push({ path, size: stat.size, time: stat.mtimeMs }); }
        if (action === 'clear') { for (const entry of entries) await unlink(entry.path); return true; }
        const temporary = join(root, '.pitch-' + randomUUID());
        try { await writeFile(temporary, bytes, { flag: 'wx' }); await rename(temporary, file); }
        finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
        let size = bytes.length, count = 1;
        for (const entry of entries.sort((a, b) => b.time - a.time)) if (entry.path !== file) { size += entry.size; if (size > 32 * 1024 ** 2 || ++count > 32) await unlink(entry.path); }
        return true;
      });
      return { ok: true, result };
    } catch (error) { return { ok: false, error: { name: error.name, message: error.message } }; }
  });
}
