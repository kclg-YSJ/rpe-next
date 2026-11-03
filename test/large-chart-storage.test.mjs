import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, lstat, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import yazl from 'yazl';
import { LargeChartPreviewService, previewCacheRoot } from '../desktop/large-chart-preview.mjs';
import { insideLargeChartDirectory, largeChartSaveDestination, largeChartSpace } from '../desktop/large-chart-paths.mjs';
import { installLargeChartPreview } from '../desktop/large-chart-preview.mjs';
import { createNote } from '../src/core/chart.mjs';

async function scratch(t, parent = tmpdir(), services = []) {
  await mkdir(parent, { recursive: true }); const actualParent = await realpath(parent);
  const root = await realpath(await mkdtemp(join(actualParent, 'rpen-large-storage-')));
  t.after(async () => {
    for (const service of services) await service.close({ discard: true });
    assert.equal(dirname(root), actualParent); assert.equal((await lstat(root)).isSymbolicLink(), false);
    await rm(root, { recursive: true, force: true });
  });
  return root;
}
async function archive(root) {
  const source = join(root, 'source.zip'), zip = new yazl.ZipFile();
  zip.addBuffer(Buffer.from('175\nbp 0 120\ncv 0 0 10\nca 0 0 255\nn1 0 1 0 1\nn2 0 2 4 100 1\n'), 'chart.pec');
  zip.end(); await pipeline(zip.outputStream, createWriteStream(source)); return source;
}
function ipc(service, { choose, save } = {}) {
  let handler;
  const contents = { mainFrame: {} }, owner = { webContents: contents };
  installLargeChartPreview({ ipcMain: { handle: (_name, fn) => { handler = fn; } }, service, window: () => owner, origin: 'rpe://app',
    dialog: { showOpenDialog: choose, showSaveDialog: save }, shell: { openPath: async () => '' } });
  return request => handler({ sender: contents, senderFrame: Object.assign(contents.mainFrame, { url: 'rpe://app/' }) }, request);
}

test('cache configuration accepts the system temporary volume and preserves its marker/configuration across restart', async t => {
  const root = await scratch(t), state = join(root, 'config.json'), service = new LargeChartPreviewService(state);
  const cache = await service.configure(root);
  assert.equal(dirname(cache), root); assert.equal(service.root, cache);
  assert.equal(JSON.parse(await readFile(state, 'utf8')).parent, root);
  assert.equal(JSON.parse(await readFile(join(cache, '.rpen-cache.json'), 'utf8')).format, 'rpen-large-preview-v1');
  assert.deepEqual(await readdir(cache), ['.rpen-cache.json']);
  assert.equal(await new LargeChartPreviewService(state).configure(root), cache);
  await assert.rejects(largeChartSpace(root, Number.MAX_SAFE_INTEGER), /空间不足/);
});

test('cache directory links remain rejected, while saves use canonical paths outside the cache', async t => {
  const root = await scratch(t), target = join(root, 'target'); await mkdir(target);
  const link = join(root, 'linked-parent'); await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(previewCacheRoot(link), /链接|重定向/);
  const parent = join(root, 'parent'); await mkdir(parent);
  await symlink(target, join(parent, 'RPEN-LargeChartPreview'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(previewCacheRoot(parent), /链接|重定向/);
  const cache = await previewCacheRoot(root), child = join(cache, 'child'); await mkdir(child);
  await assert.rejects(largeChartSaveDestination(join(cache, 'project.rpenlarge'), cache), /缓存目录之外/);
  await assert.rejects(largeChartSaveDestination(join(child, 'project.rpenlarge'), cache), /缓存目录之外/);
  const alias = join(root, 'cache-alias'); await symlink(child, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(largeChartSaveDestination(join(alias, 'project.rpenlarge'), cache), /缓存目录之外/);
  const sibling = join(root, 'RPEN-LargeChartPreview-saved'); await mkdir(sibling);
  assert.equal(await largeChartSaveDestination(join(sibling, 'project.rpenlarge'), cache), join(sibling, 'project.rpenlarge'));
  await assert.rejects(largeChartSaveDestination('relative.rpenlarge', cache), /完整/);
  await assert.rejects(largeChartSaveDestination(sibling, cache), /普通文件/);
  if (process.platform !== 'win32') assert.equal(insideLargeChartDirectory(join(root, 'Cache'), join(root, 'cache')), false);
});

test('IPC chooses an unrestricted cache folder, then saves, overwrites and reopens a project at another location', async t => {
  const services = [], root = await scratch(t, tmpdir(), services), destinationRoot = await scratch(t, resolve('.local-tools'), services);
  const source = await archive(root), state = join(root, 'config.json'), service = new LargeChartPreviewService(state);
  services.push(service);
  const destination = join(destinationRoot, '跨位置工程.rpenlarge'); let folders = 0, saves = 0;
  const request = ipc(service, {
    choose: async (_window, options) => {
      if (options.properties.includes('openFile')) return { canceled: false, filePaths: [source] };
      folders++; assert.equal(options.defaultPath, dirname(source)); assert.doesNotMatch(options.title, /E 盘|E:/);
      return { canceled: false, filePaths: [root] };
    },
    save: async (_window, options) => { saves++; assert.equal(dirname(options.defaultPath), root); return { canceled: false, filePath: destination }; },
  });
  let opened = await request({ action: 'choose' }); assert.equal(opened.ok, true, opened.error); assert.equal(folders, 1);
  let summary = opened.result;
  await service.command(summary.id, 'editable');
  summary = await service.command(summary.id, 'edit', { revision: 0, changes: [{ line: 0, note: createNote(1, 3, 50) }] });
  let saved = await request({ action: 'save', id: summary.id }); assert.equal(saved.ok, true, saved.error); assert.equal(saves, 1); assert.equal(saved.result.savedPath, destination);
  assert.equal(saved.result.dirty, false);
  summary = await service.command(summary.id, 'edit', { revision: saved.result.revision, changes: [{ line: 0, note: createNote(3, 5, 75) }] });
  saved = await request({ action: 'save', id: summary.id }); assert.equal(saved.ok, true, saved.error); assert.equal(saves, 1, 'ordinary save reuses a non-E destination');
  assert.equal(saved.result.total, 4); await service.close();
  const restarted = new LargeChartPreviewService(state); services.push(restarted);
  await restarted.configure(root);
  const reopened = await restarted.open(destination); assert.equal(reopened.total, 4); assert.equal(reopened.dirty, false);
  assert.equal(reopened.savedPath, destination);
  const page = await restarted.command(reopened.id, 'page', { lines: [0], start: 5, end: 5 });
  assert.ok(page.notes.some(entry => entry.note.positionX === 75));
});

test('saving into the cache is rejected through IPC and preserves unsaved edits', async t => {
  const services = [], root = await scratch(t, tmpdir(), services), service = new LargeChartPreviewService(join(root, 'config.json'));
  services.push(service);
  await service.configure(root); let summary = await service.open(await archive(root));
  await service.command(summary.id, 'editable');
  summary = await service.command(summary.id, 'edit', { revision: 0, changes: [{ line: 0, note: createNote(1, 3, 25) }] });
  const request = ipc(service, { save: async () => ({ canceled: false, filePath: join(service.root, 'unsafe.rpenlarge') }) });
  const result = await request({ action: 'save', id: summary.id }); assert.equal(result.ok, false); assert.match(result.error, /缓存目录之外/);
  assert.equal(service.job.savedPath, undefined);
  const current = await service.command(summary.id, 'editable'); assert.equal(current.dirty, true); assert.equal(current.total, 3);
  await assert.rejects(lstat(join(service.root, 'unsafe.rpenlarge')), /ENOENT/);
});
