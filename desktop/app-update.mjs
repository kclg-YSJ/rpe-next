import { mkdir, readFile, writeFile, rename, lstat, realpath, rm, access, copyFile, statfs, readdir } from 'node:fs/promises';
import { createWriteStream, constants, writeFileSync } from 'node:fs';
import { join, dirname, resolve, basename, relative } from 'node:path';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { APP_VERSION, officialUpdateUrl, updateChecksum, compareUpdateVersions } from '../src/core/app-update.mjs';
import { UpdateChecker, limitedResponseText } from '../src/platform/app-update.mjs';
import { insideUpdatePath, assertUpdateJob } from './update-install.mjs';
import { updateApplicationPaths } from './update-package.mjs';

const here = dirname(fileURLToPath(import.meta.url)), idPattern = /^[a-f0-9-]{36}$/;
const fail = code => Object.assign(Error(code), { code });
async function json(path) { if (!(await lstat(path)).isFile() || (await lstat(path)).isSymbolicLink()) throw fail('UPDATE_STORAGE'); return JSON.parse(await readFile(path, 'utf8')); }
async function atomic(path, data) {
  await mkdir(dirname(path), { recursive: true }); const tmp = path + '.' + randomUUID();
  try { await writeFile(tmp, JSON.stringify(data), { flag: 'wx', mode: 0o600 }); await rename(tmp, path); }
  finally { await rm(tmp, { force: true }).catch(() => {}); }
}
export async function trustedUpdateFetch(fetcher, address, options = {}, asset = false) {
  const validate = (url, options) => { try { return officialUpdateUrl(url, options); } catch { throw fail('UPDATE_ADDRESS'); } };
  let url = validate(address, { asset });
  for (let i = 0; i < 6; i++) {
    const response = await fetcher(url, { ...options, redirect: 'manual', credentials: 'omit' });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location'); await response.body?.cancel();
    if (!asset || !location) throw fail('UPDATE_REDIRECT');
    let destination; try { destination = new URL(location, url); } catch { throw fail('UPDATE_ADDRESS'); }
    url = validate(destination, { asset: true, redirect: true });
  }
  throw fail('UPDATE_REDIRECT');
}
function backgroundTask(data, progress) {
  return new Promise((accept, reject) => {
    const worker = new Worker(new URL('./update-worker.mjs', import.meta.url), { workerData: data }); let complete = false;
    worker.on('message', value => { if (value.progress !== undefined) progress?.(value.progress); else { complete = true; value.error ? reject(fail(value.error.code)) : accept(value.result); } });
    worker.on('error', reject); worker.on('exit', code => { if (!complete) reject(fail('UPDATE_PACKAGE')); });
  });
}

export class DesktopUpdates {
  constructor({ statePath, target, version = APP_VERSION, platform = process.platform, arch = process.arch, packaged = false, fetcher, progress = () => {}, restart = () => {}, protectedPaths = () => [], task = backgroundTask, launchHelper } = {}) {
    Object.assign(this, { statePath, target: resolve(target), version, platform, arch, packaged, fetcher, progress, restart, protectedPaths, task, launchHelper });
    this.identity = createHash('sha256').update(this.target).digest('hex').slice(0, 24);
    this.state = { packages: [] }; this.phase = 'idle'; this.transfer = null;
  }
  async initialize() {
    try { this.state = await json(this.statePath); if (!this.state || typeof this.state !== 'object' || Array.isArray(this.state)) throw fail('UPDATE_STORAGE'); } catch (error) { this.state = {}; if (error.code !== 'ENOENT') this.error = 'UPDATE_STORAGE'; }
    this.state.packages = (Array.isArray(this.state.packages) ? this.state.packages : []).filter(p => p && idPattern.test(p.id) && typeof p.name === 'string' && !/[\\/]/.test(p.name) && /^[a-f0-9]{64}$/.test(p.sha256) && /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(p.version)).slice(0, 200);
    await this.recoverDownloads();
    this.checker = new UpdateChecker({ version: this.version, platform: this.platform, arch: this.arch, fetcher: (url, options) => trustedUpdateFetch(this.fetcher, url, options), state: this.state.checker, persist: async state => { this.state.checker = state; await this.persist(); } });
    // Development/source trees and unexpected executable layouts are never
    // replacement targets, even when a renderer asks to install a package.
    this.supported = Boolean(this.packaged && ['win32', 'darwin', 'linux'].includes(this.platform) && ['x64', 'arm64'].includes(this.arch));
    if (this.supported) {
      const paths = updateApplicationPaths(this.target, this.platform);
      try { const meta = await json(join(paths.application, 'package.json')); if (meta.name !== 'rpe-next' || meta.main !== 'desktop/main.cjs' || meta.version !== this.version || resolve(paths.executable) !== resolve(process.execPath)) this.supported = false; }
      catch { this.supported = false; }
    }
    return this;
  }
  persist() {
    // Serialize small metadata writes; no application or media buffers enter
    // this queue. A failed write must not poison later preference changes.
    this.writing = (this.writing ?? Promise.resolve()).catch(() => {}).then(() => atomic(this.statePath, this.state)); return this.writing;
  }
  info() {
    const startupNotes = this.state.releaseNotes;
    return { ...this.checker.info(), platform: this.platform, arch: this.arch, desktop: true, canInstall: this.supported, phase: this.phase, transfer: this.transfer, error: this.error ?? null,
      startupNotes: startupNotes?.version === this.version && startupNotes.shown !== true && typeof startupNotes.notes === 'string' ? { version: startupNotes.version, notes: startupNotes.notes.slice(0, 100000) } : null,
      packages: this.state.packages.map(({ id, version, name, size, ready }) => ({ id, version, name, size, ready: Boolean(ready) })) };
  }
  emit() { this.progress(this.info()); }
  async setAuto(value) { await this.checker.setAuto(value); this.emit(); return this.info(); }
  async check(manual = false) {
    if (this.busy) return this.info();
    if (this.checking) return this.checking;
    this.checking = (async () => { this.phase = 'checking'; this.error = null; this.emit();
      try { await this.checker.check(manual); }
      catch (error) { this.error = error.code ?? 'UPDATE_NETWORK'; }
      finally { this.phase = 'idle'; this.checking = null; this.emit(); }
      return this.info();
    })(); return this.checking;
  }
  cacheRoot() { return this.state.cacheRoot ?? join(dirname(this.target), '.rpen-updates', this.identity); }
  async recoverDownloads() {
    let root; try { root = await this.ownedCache(); } catch { return; }
    const known = new Set(this.state.packages.map(p => p.id)); let changed = false;
    for (const entry of (await readdir(root, { withFileTypes: true })).slice(0, 1000)) {
      if (!entry.isDirectory() || !idPattern.test(entry.name) || known.has(entry.name)) continue;
      const directory = join(root, entry.name);
      let marker; try { marker = await json(join(directory, 'package.json')); } catch { continue; }
      if (marker.id !== entry.name || marker.identity !== this.identity || !/^[a-f0-9]{64}$/.test(marker.sha256 ?? '') || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(marker.version ?? '') || typeof marker.name !== 'string' || !/^rpe-next-[\w.-]+\.(?:zip|dmg|tar\.xz)$/.test(marker.name)) continue;
      const archive = join(directory, marker.name), file = await lstat(archive).catch(() => null);
      if (file?.isFile() && !file.isSymbolicLink() && file.size === marker.size) {
        this.state.packages.push({ id: marker.id, version: marker.version, name: marker.name, size: marker.size, sha256: marker.sha256, ready: Boolean(marker.source && Array.isArray(marker.files) && marker.files.length) }); changed = true;
      } else if (!file) {
        // Interrupted partial transfers are owned by this exact marker. Never
        // scan/delete arbitrary temp directories or a completed archive.
        const partial = archive + '.part', info = await lstat(partial).catch(() => null);
        if (info?.isFile() && !info.isSymbolicLink()) await rm(partial);
      }
    }
    if (changed) await this.persist();
  }
  async ownedCache(create = false) {
    const root = resolve(this.cacheRoot());
    if (root === this.target || insideUpdatePath(this.target, root) || insideUpdatePath(root, this.target)) throw fail('UPDATE_LOCATION');
    if (create) {
      await mkdir(root, { recursive: true, mode: 0o700 });
      if ((await lstat(root)).isSymbolicLink()) throw fail('UPDATE_LOCATION');
      const marker = join(root, 'owner.json');
      try { await writeFile(marker, JSON.stringify({ format: 'rpen-update-cache', installation: this.target, identity: this.identity }), { flag: 'wx', mode: 0o600 }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    const marker = await json(join(root, 'owner.json'));
    if (marker.format !== 'rpen-update-cache' || marker.identity !== this.identity || marker.installation !== this.target || (await lstat(root)).isSymbolicLink() || resolve(root) !== await realpath(root)) throw fail('UPDATE_LOCATION');
    return root;
  }
  async chooseCache(parent) {
    if (this.busy || this.state.packages.length) throw fail('UPDATE_BUSY');
    const previous = this.state.cacheRoot; this.state.cacheRoot = join(await realpath(parent), 'RPEN-Updates-' + this.identity);
    try { await this.ownedCache(true); await this.persist(); }
    catch (error) { this.state.cacheRoot = previous; throw fail('UPDATE_LOCATION'); }
    this.error = null; this.emit(); return this.info();
  }
  async packageRecord(id) {
    if (!idPattern.test(id ?? '')) throw fail('UPDATE_PACKAGE');
    const record = this.state.packages.find(entry => entry.id === id); if (!record) throw fail('UPDATE_PACKAGE');
    const root = await this.ownedCache(), directory = join(root, id);
    if (!insideUpdatePath(root, directory) || (await lstat(directory)).isSymbolicLink() || await realpath(directory) !== directory) throw fail('UPDATE_LOCATION');
    const marker = await json(join(directory, 'package.json'));
    if (marker.id !== id || marker.identity !== this.identity || marker.sha256 !== record.sha256 || marker.name !== record.name || marker.version !== record.version) throw fail('UPDATE_PACKAGE');
    return { ...record, directory, archive: join(directory, record.name), metadata: marker };
  }
  async download() {
    if (!this.supported) throw fail('UPDATE_UNSUPPORTED');
    if (this.busy || this.checking) throw fail('UPDATE_BUSY');
    const release = this.checker.state.latest;
    if (!release?.asset || compareUpdateVersions(release.version, this.version) <= 0) throw fail('UPDATE_NO_RELEASE');
    const existing = this.state.packages.find(p => p.version === release.version && p.ready); if (existing) return { ...this.info(), downloadedId: existing.id };
    this.busy = true; this.controller = new AbortController(); this.error = null; this.phase = 'downloading'; this.transfer = { bytes: 0, total: release.asset.size }; this.emit();
    let directory, partial, record;
    try {
      let root; try { root = await this.ownedCache(true); } catch { throw fail('UPDATE_LOCATION'); }
      const disk = await statfs(root); if (Number(disk.bavail) * Number(disk.bsize) < release.asset.size * 4 + 512 * 1024 ** 2) throw fail('UPDATE_SPACE');
      const id = randomUUID(); directory = join(root, id); await mkdir(directory, { recursive: false, mode: 0o700 });
      const signal = this.controller.signal, options = { signal, headers: { Accept: 'application/octet-stream' } };
      let sha256 = release.asset.sha256;
      if (!sha256) {
        if (!release.checksumsUrl) throw fail('UPDATE_CHECKSUM');
        const sums = await trustedUpdateFetch(this.fetcher, release.checksumsUrl, { ...options, signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]) }, true);
        if (!sums.ok) throw fail('UPDATE_NETWORK');
        sha256 = updateChecksum(await limitedResponseText(sums, 100000), release.asset.name);
      }
      const marker = { id, version: release.version, name: release.asset.name, size: release.asset.size, sha256, ready: false, identity: this.identity, release };
      await atomic(join(directory, 'package.json'), marker);
      const response = await trustedUpdateFetch(this.fetcher, release.asset.url, options, true);
      if (!response.ok || !response.body) throw fail('UPDATE_NETWORK');
      const declared = response.headers.get('content-length'); if (declared && Number(declared) !== release.asset.size) { await response.body.cancel(); throw fail('UPDATE_PACKAGE'); }
      const archive = join(directory, release.asset.name); partial = archive + '.part'; let bytes = 0, last = 0; const hash = createHash('sha256');
      const count = new Transform({ transform: (chunk, encoding, done) => {
        bytes += chunk.length; if (bytes > release.asset.size) return done(fail('UPDATE_PACKAGE')); hash.update(chunk);
        const now = Date.now(); if (now - last >= 150) { last = now; this.transfer = { bytes, total: release.asset.size }; this.progress({ phase: this.phase, transfer: this.transfer }); } done(null, chunk);
      } });
      await pipeline(Readable.fromWeb(response.body), count, createWriteStream(partial, { flags: 'wx', mode: 0o600 }), { signal });
      if (bytes !== release.asset.size || hash.digest('hex') !== sha256) throw fail('UPDATE_CHECKSUM');
      await rename(partial, archive); partial = null;
      record = { id, version: release.version, name: release.asset.name, size: bytes, sha256, ready: false };
      await atomic(join(directory, 'package.json'), { ...record, identity: this.identity, release });
      this.state.packages.push(record); await this.persist();
      this.phase = 'preparing'; this.controller = null; this.transfer = { fraction: 0 }; this.emit();
      const prepared = await this.task({ action: 'prepare', archive, sha256, release, platform: this.platform, arch: this.arch, output: join(directory, 'unpacked') }, fraction => { this.transfer = { fraction }; this.progress({ phase: this.phase, transfer: this.transfer }); });
      const metadata = await json(join(directory, 'package.json')); metadata.source = relative(directory, prepared.source); metadata.files = prepared.files;
      await atomic(join(directory, 'package.json'), metadata); record.ready = true; await this.persist();
      return { downloadedId: id };
    } catch (error) {
      const canceled = this.controller?.signal.aborted; this.error = canceled ? null : error.code?.startsWith('UPDATE_') ? error.code : 'UPDATE_NETWORK';
      if (partial) await rm(partial, { force: true }).catch(() => {});
      // A completed archive is retained on preparation failure for inspection
      // or explicit deletion. Only our newly created, incomplete job is removed.
      if (directory && !record) await rm(directory, { recursive: true, force: true }).catch(() => {});
      if (!canceled) throw fail(this.error);
      return this.info();
    } finally { this.controller = null; this.busy = false; this.phase = 'idle'; this.transfer = null; this.emit(); }
  }
  cancelDownload() { this.controller?.abort(); return this.info(); }
  async deletePackage(id) {
    if (this.busy || this.installPending) throw fail('UPDATE_BUSY');
    const record = await this.packageRecord(id);
    const mount = await lstat(join(record.directory, 'mount')).catch(() => null);
    if (mount && (mount.isSymbolicLink() || mount.dev !== (await lstat(record.directory)).dev)) throw fail('UPDATE_BUSY');
    const helper = await json(join(record.directory, 'helper-ready.json')).catch(() => null);
    if (Number.isSafeInteger(helper?.pid) && helper.pid > 0) {
      let alive = true; try { process.kill(helper.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; }
      if (alive) throw fail('UPDATE_BUSY');
    }
    // Never remove a running helper, installed program, or old program backup.
    await rm(record.directory, { recursive: true, force: false });
    this.state.packages = this.state.packages.filter(p => p.id !== id); await this.persist(); this.emit(); return this.info();
  }
  async install(id) {
    if (!this.supported) throw fail('UPDATE_UNSUPPORTED');
    if (this.busy || this.installPending) throw fail('UPDATE_BUSY');
    this.busy = true; this.phase = 'verifying'; this.error = null; this.emit();
    try {
      for (const path of this.protectedPaths().filter(Boolean)) {
        const canonical = await realpath(resolve(path)).catch(() => resolve(path));
        if (canonical === this.target || insideUpdatePath(this.target, canonical)) throw fail('UPDATE_DATA_LOCATION');
      }
      const record = await this.packageRecord(id); if (!record.ready) throw fail('UPDATE_PACKAGE');
      if (compareUpdateVersions(record.version, this.version) <= 0) throw fail('UPDATE_NO_RELEASE');
      const source = resolve(record.directory, record.metadata.source ?? ''); if (!insideUpdatePath(join(record.directory, 'unpacked'), source)) throw fail('UPDATE_PACKAGE');
      await access(dirname(this.target), constants.W_OK);
      await this.task({ action: 'verify', archive: record.archive, sha256: record.sha256, source, files: record.metadata.files });
      const token = randomBytes(32).toString('hex'), transaction = randomUUID(), parent = await realpath(dirname(this.target));
      const job = { format: 'rpen-update-job', id: transaction, token, pid: process.pid, version: record.version, directory: record.directory, target: this.target, source, executable: updateApplicationPaths(this.target, this.platform).executable,
        replacement: join(parent, '.rpen-new-' + transaction), backup: join(parent, '.rpen-previous-' + transaction), files: record.metadata.files };
      await atomic(join(record.directory, 'job.json'), job); await assertUpdateJob(job);
      for (const name of ['helper-ready.json', 'app-ready.json', 'install-approved.json', 'install-canceled.json']) await rm(join(record.directory, name), { force: true });
      await copyFile(join(here, 'update-install.mjs'), join(record.directory, 'install.mjs'));
      let child;
      if (this.launchHelper) child = await this.launchHelper(job);
      else {
        const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }; delete env.NODE_OPTIONS;
        child = spawn(updateApplicationPaths(source, this.platform).executable, [join(record.directory, 'install.mjs'), join(record.directory, 'job.json')], { cwd: record.directory, env, detached: true, windowsHide: true, stdio: 'ignore' });
        await once(child, 'spawn'); child.unref();
      }
      this.helper = child;
      let ready = false;
      for (let i = 0; i < 100; i++) {
        const receipt = await json(join(record.directory, 'helper-ready.json')).catch(() => null); if (receipt?.token === token) { ready = true; break; }
        if (child?.exitCode !== null && child?.exitCode !== undefined) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (!ready) { child?.kill(); throw fail('UPDATE_INSTALL'); }
      this.installPending = job; this.phase = 'installing'; this.emit(); this.restart(); return this.info();
    } catch (error) { this.error = error.code?.startsWith('UPDATE_') ? error.code : 'UPDATE_INSTALL'; throw fail(this.error); }
    finally { this.busy = false; if (!this.installPending) this.phase = 'idle'; this.emit(); }
  }
  approveQuit() {
    try { if (this.installPending) writeFileSync(join(this.installPending.directory, 'install-approved.json'), JSON.stringify({ token: this.installPending.token }), { mode: 0o600 }); }
    catch { /* Without the approval receipt the helper keeps the old program. */ }
  }
  cancelInstall() {
    if (!this.installPending) return;
    try { writeFileSync(join(this.installPending.directory, 'install-canceled.json'), JSON.stringify({ token: this.installPending.token })); } catch {}
    this.helper?.kill(); this.helper = null; this.installPending = null; this.phase = 'idle'; this.emit();
  }
  async acknowledge(path) {
    if (!this.packaged || !path || basename(path) !== 'job.json') return;
    try {
      const job = await json(path), record = this.state.packages.find(p => join(this.cacheRoot(), p.id, 'job.json') === resolve(path));
      if (!record || job.directory !== dirname(resolve(path)) || job.target !== this.target || job.version !== this.version || job.version !== record.version) return;
      await this.packageRecord(record.id); await assertUpdateJob(job);
      const approved = await json(join(job.directory, 'install-approved.json'));
      const canceled = await json(join(job.directory, 'install-canceled.json')).catch(() => null);
      if (approved.token !== job.token || canceled?.token === job.token) return;
      if (this.state.releaseNotes?.job !== job.id) {
        const downloaded = await this.packageRecord(record.id);
        this.state.releaseNotes = { job: job.id, version: job.version, notes: String(downloaded.metadata.release?.notes ?? '').slice(0, 100000), shown: false };
        await this.persist();
      }
      await atomic(join(job.directory, 'app-ready.json'), { token: job.token });
    } catch { /* Invalid or foreign launch receipts have no filesystem effects. */ }
  }
  async notesSeen(version) {
    const notes = this.state.releaseNotes;
    if (notes?.version === this.version && version === this.version && notes.shown !== true) {
      notes.shown = true; await this.persist(); this.emit();
    }
    return this.info();
  }
}

export function installDesktopUpdates({ ipcMain, service, window, origin, dialog, startupJob }) {
  ipcMain.handle('rpen-app-update', async (event, request) => {
    try {
      const win = window();
      if (event.sender !== win?.webContents || event.senderFrame !== event.sender.mainFrame || !event.senderFrame.url.startsWith(origin + '/')) throw fail('UPDATE_FORBIDDEN');
      const { action, value } = request ?? {}; let result;
      if (action === 'status') result = service.info();
      else if (action === 'check') result = await service.check(value === true);
      else if (action === 'auto') result = await service.setAuto(value === true);
      else if (action === 'download') result = await service.download();
      else if (action === 'cancel') result = service.cancelDownload();
      else if (action === 'install') result = await service.install(value);
      else if (action === 'delete') result = await service.deletePackage(value);
      else if (action === 'ready') { await service.acknowledge(startupJob); result = service.info(); }
      else if (action === 'notes-seen') result = await service.notesSeen(value);
      else if (action === 'location') {
        const selected = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
        result = selected.canceled ? service.info() : await service.chooseCache(selected.filePaths[0]);
      } else throw fail('UPDATE_FORBIDDEN');
      return { ok: true, result };
    } catch (error) { return { ok: false, error: { code: error.code?.startsWith('UPDATE_') ? error.code : 'UPDATE_INSTALL' } }; }
  });
}
