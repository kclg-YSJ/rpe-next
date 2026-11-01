import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, readdir, rm, realpath, lstat } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { ZipFile } from 'yazl';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { APP_VERSION, compareUpdateVersions, officialUpdateUrl, selectUpdateRelease, updateChecksum, UPDATE_RELEASES_URL, UPDATE_INTERVAL } from '../src/core/app-update.mjs';
import { UpdateChecker } from '../src/platform/app-update.mjs';
import { DesktopUpdates, trustedUpdateFetch } from '../desktop/app-update.mjs';
import { extractUpdateZip, extractUpdateTar, prepareUpdatePackage, updateEntryName, validateUpdateApplication } from '../desktop/update-package.mjs';
import { applicationInventory, verifyApplicationInventory, replaceApplication, assertUpdateJob } from '../desktop/update-install.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const assetUrl = name => 'https://github.com/kclg-YSJ/rpe-next/releases/download/v0.14.0/' + name;
function release(version = '0.14.0', platform = 'windows', arch = 'x64', bytes = Buffer.from('fixture')) {
  const name = `rpe-next-${version}-${platform}-${arch}.${platform === 'windows' ? 'zip' : platform === 'macos' ? 'dmg' : 'tar.xz'}`;
  return { tag_name: 'v' + version, body: '# Update\nChanges', prerelease: true, assets: [{ name, size: bytes.length, browser_download_url: assetUrl(name), digest: 'sha256:' + sha(bytes) }, { name: 'SHA256SUMS.txt', browser_download_url: assetUrl('SHA256SUMS.txt') }] };
}
async function scratch(context) { const parent = resolve('.local-tools'); await mkdir(parent, { recursive: true }); const path = await mkdtemp(join(parent, 'update-unit-')); context.after(async () => { assert.ok(path.startsWith(parent + (process.platform === 'win32' ? '\\' : '/'))); await rm(path, { recursive: true, force: true }); }); return realpath(path); }
async function zipBytes(files) { const zip = new ZipFile(), chunks = []; zip.outputStream.on('data', bytes => chunks.push(bytes)); const done = new Promise((accept, reject) => { zip.outputStream.on('end', accept); zip.outputStream.on('error', reject); }); for (const [name, bytes] of files) zip.addBuffer(Buffer.from(bytes), name); zip.end(); await done; return Buffer.concat(chunks); }
const applicationFiles = (version = '0.14.0', platform = 'win32', arch = 'x64') => [
  ['RePhiEdit-Next.exe', 'new executable'], ['resources/app/package.json', JSON.stringify({ name: 'rpe-next', version, main: 'desktop/main.cjs' })],
  ['resources/app/build-info.json', JSON.stringify({ version, kind: 'editor', platform, arch })], ['resources/app/desktop/main.cjs', '// main'], ['resources/app/assets/中文素材.png', 'utf8 file'],
];
async function packageBytes() { return zipBytes(applicationFiles().map(([name, bytes]) => ['RePhiEdit Next-win32-x64/' + name, bytes])); }
async function updater(context, data, extra = {}) {
  const root = await scratch(context), target = join(root, 'editor'); await mkdir(target);
  await writeFile(join(target, 'original.txt'), 'old application');
  const calls = [], source = release('0.14.0', 'windows', 'x64', data);
  const service = await new DesktopUpdates({ statePath: join(root, 'profile', 'updates.json'), target, platform: 'win32', arch: 'x64', fetcher: async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url) === UPDATE_RELEASES_URL) return Response.json([source], { headers: { etag: 'fixture' } });
    if (String(url) === source.assets[0].browser_download_url) return new Response(data, { headers: { 'content-length': String(data.length) } });
    throw Error('Unexpected network request');
  }, ...extra }).initialize();
  service.supported = true; await service.check(true); return { service, root, target, calls, source };
}

test('update versions compare numeric fields and prerelease precedence', () => {
  for (const [a, b] of [['0.14.0', '0.13.9'], ['0.13.10', '0.13.2'], ['1.0.0', '1.0.0-rc.3'], ['1.0.0-rc.10', '1.0.0-rc.2'], ['1.0.0-rc', '1.0.0-1']]) assert.equal(compareUpdateVersions(a, b), 1);
  assert.equal(compareUpdateVersions('v0.13.0', '0.13.0'), 0); assert.throws(() => compareUpdateVersions('latest', '0.13.0'));
});
test('application version agrees with package metadata and footer', async () => {
  assert.equal(APP_VERSION, JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version);
  assert.ok((await readFile(new URL('../index.html', import.meta.url), 'utf8')).includes('id="app-version" type="button">Re:PhiEdit Next · ' + APP_VERSION));
});
test('release selection includes published numeric prereleases, skips drafts and incomplete platforms', () => {
  const data = [release('0.14.0'), { ...release('9.0.0'), draft: true }, release('0.15.0', 'linux')];
  assert.equal(selectUpdateRelease(data, 'win32', 'x64').version, '0.14.0'); assert.equal(selectUpdateRelease(data, 'web', '').version, '0.15.0');
  for (const [platform, label] of [['win32', 'windows'], ['darwin', 'macos'], ['linux', 'linux']]) for (const arch of ['x64', 'arm64']) assert.ok(selectUpdateRelease([release('0.14.0', label, arch)], platform, arch).asset.name.includes(arch));
});
test('update URLs and checksums are limited to the official repository and release CDN', async () => {
  for (const url of ['http://github.com/kclg-YSJ/rpe-next/releases/download/v1/a', 'https://github.com/other/repo/releases/download/v1/a', 'https://github.com.evil.test/kclg-YSJ/rpe-next/releases/download/v1/a', 'https://user@github.com/kclg-YSJ/rpe-next/releases/download/v1/a']) assert.throws(() => officialUpdateUrl(url, { asset: true }));
  const hash = 'a'.repeat(64); assert.equal(updateChecksum(hash + '  名字.zip\r\n', '名字.zip'), hash); assert.throws(() => updateChecksum(hash + '  other.zip', '名字.zip'));
  let calls = 0; await assert.rejects(trustedUpdateFetch(async () => { calls++; return new Response(null, { status: 302, headers: { location: 'https://evil.test/payload' } }); }, assetUrl('fixture.zip'), {}, true)); assert.equal(calls, 1);
});
test('checker caches ETags, throttles checks, persists disabled automatic checking, never downloads', async () => {
  let now = 1000000, count = 0, persisted; const source = release();
  const checker = new UpdateChecker({ now: () => now, platform: 'win32', arch: 'x64', persist: async state => { persisted = structuredClone(state); }, fetcher: async (url, options) => { assert.equal(url, UPDATE_RELEASES_URL); count++; if (count > 1) { assert.equal(options.headers['If-None-Match'], 'etag'); return new Response(null, { status: 304 }); } return Response.json([source], { headers: { etag: 'etag' } }); } });
  assert.equal((await checker.check()).available, true); await checker.check(true); assert.equal(count, 1);
  now += UPDATE_INTERVAL; await checker.check(); assert.equal(count, 2); assert.equal(checker.state.checked, now);
  await checker.setAuto(false); now += UPDATE_INTERVAL; await checker.check(); assert.equal(count, 2);
  const restarted = new UpdateChecker({ state: persisted, platform: 'win32', arch: 'x64' }); assert.equal(restarted.info().autoCheck, false); assert.equal(restarted.info().latest.version, '0.14.0');
});
test('GitHub rate limits and failed network requests back off without discarding cached releases', async () => {
  let now = 1000000, calls = 0; const checker = new UpdateChecker({ now: () => now, fetcher: async () => { calls++; return new Response(null, { status: 429, headers: { 'retry-after': '120' } }); } });
  await assert.rejects(checker.check(true), { code: 'UPDATE_RATE_LIMIT' }); now += 61000; await checker.check(true); assert.equal(calls, 1); now += 60000; await assert.rejects(checker.check(true)); assert.equal(calls, 2);
});
test('cached metadata cannot introduce foreign download addresses', () => {
  const source = release(); source.assets[0].browser_download_url = 'https://evil.test/file.zip'; const checker = new UpdateChecker({ state: { releases: [source] }, platform: 'win32', arch: 'x64' }); assert.equal(checker.info().latest, null);
});
test('archive path validation rejects traversal, devices, absolute paths and alternate streams', () => {
  for (const name of ['../a', '/a', 'a/../../x', 'a\\b', 'C:/file', 'a/NUL.txt', 'a/file:stream', 'a/./b', 'a/x.']) assert.throws(() => updateEntryName(name));
  assert.equal(updateEntryName('目录/中文.png'), '目录/中文.png');
});
test('background package preparation verifies hash, Unicode names, product, platform and inventory', async context => {
  const root = await scratch(context), data = await packageBytes(), archive = join(root, 'package.zip'); await writeFile(archive, data);
  const prepared = await prepareUpdatePackage({ archive, sha256: sha(data), release: { version: '0.14.0' }, platform: 'win32', arch: 'x64', output: join(root, 'output') });
  assert.equal(await readFile(join(prepared.source, 'resources/app/assets/中文素材.png'), 'utf8'), 'utf8 file'); await verifyApplicationInventory(prepared.source, prepared.files);
  await assert.rejects(validateUpdateApplication(prepared.source, { version: '0.14.0' }, 'win32', 'arm64'));
  await writeFile(join(prepared.source, 'RePhiEdit-Next.exe'), 'tampered'); await assert.rejects(verifyApplicationInventory(prepared.source, prepared.files));
  await assert.rejects(prepareUpdatePackage({ archive, sha256: '0'.repeat(64), output: join(root, 'wrong') }), { code: 'UPDATE_CHECKSUM' });
});
test('ZIP extraction rejects traversals and duplicate case aliases before writing outside its root', async context => {
  const root = await scratch(context), bytes = await zipBytes([['OK/file.txt', 'safe']]);
  let text = bytes.toString('latin1').replaceAll('OK/file.txt', '../file.txt'); const archive = join(root, 'bad.zip'), output = join(root, 'unpack'); await mkdir(output); await writeFile(archive, Buffer.from(text, 'latin1'));
  await assert.rejects(extractUpdateZip(archive, output)); assert.deepEqual(await readdir(output), []); await assert.rejects(lstat(join(root, 'file.txt')), { code: 'ENOENT' });
  await writeFile(archive, await zipBytes([['Root/Name', 'a'], ['Root/name', 'b']])); await assert.rejects(extractUpdateZip(archive, output), /Duplicate/);
});

function tarFixture(entries) {
  const parts = [];
  for (const { name, data = '', type = '0', link = '' } of entries) {
    const content = Buffer.from(data), header = Buffer.alloc(512); header.write(name, 0, 100, 'utf8');
    const octal = (value, offset, length) => header.write(value.toString(8).padStart(length - 1, '0') + '\0', offset, length, 'ascii');
    octal(type === '5' ? 0o755 : 0o644, 100, 8); octal(0, 108, 8); octal(0, 116, 8); octal(content.length, 124, 12); octal(0, 136, 12);
    header.fill(32, 148, 156); header.write(type, 156, 1); header.write(link, 157, 100, 'utf8'); header.write('ustar\0', 257); header.write('00', 263);
    const sum = header.reduce((a, b) => a + b, 0); header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
    parts.push(header, content); if (content.length % 512) parts.push(Buffer.alloc(512 - content.length % 512));
  }
  return Buffer.concat([...parts, Buffer.alloc(1024)]);
}
function decompressor(data) {
  const child = new EventEmitter(); child.exitCode = null;
  child.stdout = Readable.from(Array.from({ length: Math.ceil(data.length / 97) }, (_, i) => data.subarray(i * 97, (i + 1) * 97)));
  child.stdout.once('end', () => { child.exitCode = 0; child.emit('close', 0); }); child.kill = () => { child.stdout.destroy(); child.exitCode = 1; child.emit('close', 1); }; return child;
}
test('tar extraction handles chunk boundaries, file modes and Unicode paths without buffering the archive', async context => {
  const root = await scratch(context), output = join(root, 'unpack'); await mkdir(output);
  const data = tarFixture([{ name: 'editor/', type: '5' }, { name: 'editor/resources/中文.txt', data: 'safe Unicode data' }, { name: 'editor/executable', data: 'binary' }]);
  await extractUpdateTar('fixture.tar.xz', output, () => {}, { decompress: () => decompressor(data) });
  assert.equal(await readFile(join(output, 'editor/resources/中文.txt'), 'utf8'), 'safe Unicode data');
});
test('tar extraction rejects unsafe names, hardlinks, escaping links, malformed PAX and damaged headers', async context => {
  const root = await scratch(context);
  const fixtures = [tarFixture([{ name: '../escape' }]), tarFixture([{ name: 'editor/link', type: '1', link: '/file' }]), tarFixture([{ name: 'editor/link', type: '2', link: '../../../escape' }]), tarFixture([{ name: 'entry', type: 'x', data: '999 path=../../escape\n' }])];
  const corrupt = tarFixture([{ name: 'editor/file' }]); corrupt[0] ^= 1; fixtures.push(corrupt);
  for (const [i, data] of fixtures.entries()) { const output = join(root, String(i)); await mkdir(output); await assert.rejects(extractUpdateTar('fixture.tar.xz', output, () => {}, { decompress: () => decompressor(data) })); }
  await assert.rejects(lstat(join(root, 'escape')), { code: 'ENOENT' });
});
test('download is explicit, integrity checked off-thread and retained across process restarts', async context => {
  const data = await packageBytes(), { service, target, root, calls } = await updater(context, data);
  assert.equal(calls.length, 1); assert.equal(service.info().available, true);
  const result = await service.download(), record = await service.packageRecord(result.downloadedId);
  assert.equal(record.ready, true); assert.deepEqual(await readFile(record.archive), data); assert.equal(await readFile(join(target, 'original.txt'), 'utf8'), 'old application');
  assert.ok(service.cacheRoot().startsWith(root)); assert.ok(!service.cacheRoot().startsWith(target));
  const restarted = await new DesktopUpdates({ target, statePath: service.statePath, platform: 'win32', arch: 'x64' }).initialize();
  assert.equal(restarted.info().packages.length, 1); assert.deepEqual(await readFile((await restarted.packageRecord(result.downloadedId)).archive), data);
  await restarted.deletePackage(result.downloadedId); assert.equal(restarted.info().packages.length, 0); assert.equal(await readFile(join(target, 'original.txt'), 'utf8'), 'old application');
});
test('partial cancellation removes only partial update files and leaves the application untouched', async context => {
  const data = await packageBytes(), { service, source, target } = await updater(context, data);
  service.fetcher = async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(data.subarray(0, 50)); }, cancel() {} }), { headers: { 'content-length': String(data.length) } });
  const pending = service.download(); for (let i = 0; i < 200 && !service.transfer?.bytes; i++) await new Promise(resolve => setTimeout(resolve, 5)); service.cancelDownload(); await pending;
  assert.equal(service.info().packages.length, 0); assert.deepEqual(await readdir(service.cacheRoot()), ['owner.json']); assert.equal(await readFile(join(target, 'original.txt'), 'utf8'), 'old application');
});
test('checksum failure never prepares or installs an archive', async context => {
  const data = await packageBytes(), { service, source, target } = await updater(context, data); service.checker.state.latest.asset.sha256 = '0'.repeat(64);
  await assert.rejects(service.download(), { code: 'UPDATE_CHECKSUM' }); assert.equal(service.info().packages.length, 0); assert.equal(await readFile(join(target, 'original.txt'), 'utf8'), 'old application');
});
test('unpack failure retains complete download and permits explicit deletion', async context => {
  const data = Buffer.from('invalid ZIP'), { service } = await updater(context, data); await assert.rejects(service.download(), { code: 'UPDATE_PACKAGE' });
  const record = await service.packageRecord(service.info().packages[0].id); assert.equal(record.ready, false); assert.deepEqual(await readFile(record.archive), data); await service.deletePackage(record.id);
});
test('completed downloads survive an interrupted metadata write and are recovered on startup', async context => {
  const data = await packageBytes(), { service, target } = await updater(context, data); const { downloadedId } = await service.download();
  const state = JSON.parse(await readFile(service.statePath, 'utf8')); state.packages = []; await writeFile(service.statePath, JSON.stringify(state));
  const restarted = await new DesktopUpdates({ target, statePath: service.statePath, platform: 'win32', arch: 'x64' }).initialize();
  assert.equal(restarted.info().packages[0].id, downloadedId); assert.equal(restarted.info().packages[0].ready, true); assert.deepEqual(await readFile((await restarted.packageRecord(downloadedId)).archive), data);
});
test('source checkouts refuse installation and owned-cache validation prevents foreign deletion', async context => {
  const data = await packageBytes(), { service, root } = await updater(context, data); service.supported = false; await assert.rejects(service.download(), { code: 'UPDATE_UNSUPPORTED' });
  service.supported = true; const { downloadedId } = await service.download(); const foreign = join(root, 'foreign'); await mkdir(foreign); await writeFile(join(foreign, 'important.txt'), 'keep');
  service.state.cacheRoot = foreign; await assert.rejects(service.deletePackage(downloadedId)); assert.equal(await readFile(join(foreign, 'important.txt'), 'utf8'), 'keep');
});
test('restart handoff requires helper readiness and actual quit approval; cancel retains package', async context => {
  let restarts = 0, helperKilled = 0; const data = await packageBytes();
  const { service, target } = await updater(context, data, { restart: () => restarts++, launchHelper: async job => { await writeFile(join(job.directory, 'helper-ready.json'), JSON.stringify({ token: job.token })); return { exitCode: null, kill() { helperKilled++; } }; } });
  const { downloadedId } = await service.download(); await service.install(downloadedId); assert.equal(restarts, 1);
  const firstJob = service.installPending; await assert.rejects(lstat(join(firstJob.directory, 'install-approved.json')), { code: 'ENOENT' }); service.cancelInstall(); assert.equal(helperKilled, 1);
  assert.equal(await readFile(join(target, 'original.txt'), 'utf8'), 'old application'); assert.equal((await service.packageRecord(downloadedId)).ready, true);
  await service.install(downloadedId); assert.notEqual(firstJob.token, service.installPending.token); service.approveQuit(); assert.equal(JSON.parse(await readFile(join(firstJob.directory, 'install-approved.json'), 'utf8')).token, service.installPending.token); service.cancelInstall();
});
test('only an acknowledged successful update records installed-version notes, and showing them survives restart', async context => {
  const data = await packageBytes(), { service, target } = await updater(context, data, { launchHelper: async job => { await writeFile(join(job.directory, 'helper-ready.json'), JSON.stringify({ token: job.token })); return { exitCode: null, kill() {} }; } });
  assert.equal(service.info().startupNotes, null);
  const { downloadedId } = await service.download(); assert.equal(service.info().startupNotes, null);
  await service.install(downloadedId); const job = service.installPending, jobPath = join(job.directory, 'job.json'); service.approveQuit();
  const installed = await new DesktopUpdates({ statePath: service.statePath, target, version: '0.14.0', platform: 'win32', arch: 'x64', packaged: true }).initialize();
  await installed.acknowledge(jobPath);
  assert.deepEqual(installed.info().startupNotes, { version: '0.14.0', notes: '# Update\nChanges' });
  assert.equal(JSON.parse(await readFile(join(job.directory, 'app-ready.json'), 'utf8')).token, job.token);
  installed.checker.state.latest = { version: '0.15.0', notes: 'A newer release' };
  assert.equal(installed.info().startupNotes.version, '0.14.0'); assert.equal(installed.info().startupNotes.notes, '# Update\nChanges');
  await installed.notesSeen('0.15.0'); assert.ok(installed.info().startupNotes);
  await installed.notesSeen('0.14.0'); assert.equal(installed.info().startupNotes, null);
  const restarted = await new DesktopUpdates({ statePath: service.statePath, target, version: '0.14.0', platform: 'win32', arch: 'x64', packaged: true }).initialize();
  await restarted.acknowledge(jobPath); assert.equal(restarted.info().startupNotes, null);
});
test('canceled or unapproved installation never triggers first-start release notes', async context => {
  const data = await packageBytes(), { service, target } = await updater(context, data, { launchHelper: async job => { await writeFile(join(job.directory, 'helper-ready.json'), JSON.stringify({ token: job.token })); return { exitCode: null, kill() {} }; } });
  const { downloadedId } = await service.download(); await service.install(downloadedId); const job = service.installPending, jobPath = join(job.directory, 'job.json');
  const installed = await new DesktopUpdates({ statePath: service.statePath, target, version: '0.14.0', platform: 'win32', arch: 'x64', packaged: true }).initialize();
  await installed.acknowledge(jobPath); assert.equal(installed.info().startupNotes, null);
  service.approveQuit(); service.cancelInstall(); await installed.acknowledge(jobPath); assert.equal(installed.info().startupNotes, null);
  await assert.rejects(lstat(join(job.directory, 'app-ready.json')), { code: 'ENOENT' });
});
test('active data folders under the application directory block replacement', async context => {
  const data = await packageBytes(), { service, target } = await updater(context, data); const { downloadedId } = await service.download(); service.protectedPaths = () => [join(target, 'MyCharts')];
  await assert.rejects(service.install(downloadedId), { code: 'UPDATE_DATA_LOCATION' }); assert.equal(await readFile(join(target, 'original.txt'), 'utf8'), 'old application');
});

async function transaction(context) {
  const root = await scratch(context), directory = join(root, 'download'), source = join(directory, 'source'), target = join(root, 'editor');
  await mkdir(source, { recursive: true }); await mkdir(target); await writeFile(join(target, 'old.txt'), 'old'); await writeFile(join(target, 'user-added.txt'), 'private file'); await writeFile(join(source, 'new.txt'), 'new');
  const id = randomUUID(), job = { format: 'rpen-update-job', id, token: randomBytes(32).toString('hex'), pid: process.pid, directory, source, target, replacement: join(root, '.rpen-new-' + id), backup: join(root, '.rpen-previous-' + id), executable: join(target, 'app.exe'), files: await applicationInventory(source) };
  await writeFile(join(directory, 'job.json'), JSON.stringify(job)); return job;
}
test('installation replaces only the application, preserving the entire previous directory', async context => {
  const job = await transaction(context); await replaceApplication(job); assert.equal(await readFile(join(job.target, 'new.txt'), 'utf8'), 'new'); assert.equal(await readFile(join(job.backup, 'user-added.txt'), 'utf8'), 'private file');
});
for (const stage of ['afterBackup', 'afterInstall', 'launch']) test('installation rollback preserves old application and user files on ' + stage + ' failure', async context => {
  const job = await transaction(context); await assert.rejects(replaceApplication(job, { fault: async point => { if (point === stage) throw Error('test failure'); }, launch: async () => { if (stage === 'launch') throw Error('startup failed'); } }));
  assert.equal(await readFile(join(job.target, 'old.txt'), 'utf8'), 'old'); assert.equal(await readFile(join(job.target, 'user-added.txt'), 'utf8'), 'private file'); assert.equal(await readFile(join(job.source, 'new.txt'), 'utf8'), 'new');
});
test('install helper rejects modified identities, unsafe destinations and changed staging files', async context => {
  const job = await transaction(context); await assert.rejects(assertUpdateJob({ ...job, target: dirname(job.target) })); await assert.rejects(assertUpdateJob({ ...job, token: '0'.repeat(64) }));
  await writeFile(join(job.source, 'new.txt'), 'changed'); await assert.rejects(replaceApplication(job)); assert.equal(await readFile(join(job.target, 'old.txt'), 'utf8'), 'old');
});
