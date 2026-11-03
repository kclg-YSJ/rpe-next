const { open, rename, rm, stat, statfs } = require('node:fs/promises');
const { dirname, basename, join } = require('node:path');
const { randomUUID } = require('node:crypto');

// The renderer receives a token, never arbitrary file-system write access.
// Every write goes to a new sibling temporary file; commit replaces the chosen
// destination only after flush. Abort leaves an existing destination intact.
class RenderOutputService {
  constructor(choose, { openFolder } = {}) { this.choose = choose; this.openFolder = openFolder; this.tasks = new Map(); this.completed = new Map(); }
  async call(owner, action, value = {}) {
    if (action === 'openFolder') {
      const saved = this.completed.get(owner);
      if (!saved || saved.id !== value.id) throw Error('Video output is no longer available');
      const folder = dirname(saved.target);
      if (!(await stat(folder)).isDirectory()) throw Error('Video output folder is unavailable');
      if (!this.openFolder) throw Error('Opening video output folders is unavailable');
      await this.openFolder(folder); return true;
    }
    if (action === 'begin') {
      if ([...this.tasks.values()].some(task => task.owner === owner)) throw Error('A video output is already open');
      if (typeof value.name !== 'string' || value.name.length > 180 || /[\\/\x00]/.test(value.name)) throw Error('Invalid video name');
      const target = await this.choose(value.name); if (!target) return null;
      const id = randomUUID(), temporary = join(dirname(target), '.' + basename(target) + '.' + id + '.part');
      const handle = await open(temporary, 'wx');
      this.tasks.set(id, { owner, target, temporary, handle, size: 0, checked: 0, closed: false });
      return { id, name: basename(target), path: target };
    }
    const task = this.tasks.get(value.id);
    if (!task || task.owner !== owner) { if (action === 'abort') return true; throw Error('Video output is closed'); }
    if (action === 'abort') { await this.remove(value.id); return true; }
    if (action === 'write') {
      const bytes = value.data;
      if (task.closed || !(bytes instanceof Uint8Array) || !bytes.length || bytes.byteLength > 1024 ** 2 || !Number.isSafeInteger(value.position) || value.position < 0 || value.position + bytes.length > 128 * 1024 ** 3) throw Error('Video write exceeds output budget');
      if (task.size - task.checked >= 32 * 1024 ** 2 || !task.checked) {
        const space = await statfs(dirname(task.target));
        if (Number(space.bavail) * Number(space.bsize) < bytes.length + 32 * 1024 ** 2) throw Error('Insufficient free space for video');
        task.checked = Math.max(1, task.size);
      }
      for (let offset = 0; offset < bytes.length;) { const part = await task.handle.write(bytes, offset, bytes.length - offset, value.position + offset); if (!part.bytesWritten) throw Error('Incomplete video write'); offset += part.bytesWritten; }
      task.size = Math.max(task.size, value.position + bytes.length); return task.size;
    }
    if (action === 'close' || action === 'commit') {
      if (!task.closed) { await task.handle.sync(); await task.handle.close(); task.closed = true; }
      if (action === 'close') return task.size;
      if (!task.size) throw Error('Empty video output');
      await rename(task.temporary, task.target); this.tasks.delete(value.id);
      this.completed.set(owner, { id: value.id, target: task.target });
      return { status: 'saved', id: value.id, name: basename(task.target), path: task.target, bytes: task.size };
    }
    throw Error('Unknown video output operation');
  }
  async remove(id) { const task=this.tasks.get(id);if(!task)return;this.tasks.delete(id);if(!task.closed)await task.handle.close().catch(()=>{});await rm(task.temporary,{force:true}); }
  async dispose(owner) { if(owner===undefined)this.completed.clear();else this.completed.delete(owner);for (const [id,task] of this.tasks) if(owner===undefined||task.owner===owner)await this.remove(id); }
}
module.exports = { RenderOutputService };
