import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

test('发布校验要求其余六个包完整，保留 macOS 安装签名校验且排除 Intel 包', async context => {
  const directory = await mkdtemp(join(tmpdir(), 'rpen-release-assets-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const sourceCommit = 'a'.repeat(40);
  const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const bytes = Buffer.alloc(10 * 1024 ** 2, 42), sha256 = createHash('sha256').update(bytes).digest('hex');
  const targets = [
    ['editor', 'win32', 'x64'], ['editor', 'win32', 'arm64'], ['editor', 'darwin', 'arm64'],
    ['editor', 'linux', 'x64'], ['editor', 'linux', 'arm64'], ['server', 'win32', 'x64']
  ];
  const manifests = targets.map(([kind, platform, arch]) => ({
    kind, platform, arch, version, sourceCommit, file: [kind, platform, arch].join('-') + '.zip',
    bytes: bytes.length, sha256, sourceFilesVerified: 1, verified: true,
    ...(platform === 'darwin' ? { macOSVerification: { signedProcesses: 5, installedFromDmg: true } } : {})
  }));
  const save = info => writeFile(join(directory, info.file + '.json'), JSON.stringify(info));
  for (const info of manifests) { await writeFile(join(directory, info.file), bytes); await save(info); }
  const verify = () => spawnSync(process.execPath, [fileURLToPath(new URL('../tools/verify-release-assets.mjs', import.meta.url)), directory, sourceCommit], { encoding: 'utf8' });
  let result = verify(); assert.equal(result.status, 0, result.stderr);
  const verified = JSON.parse(await readFile(join(directory, 'verified-assets.json'), 'utf8'));
  assert.equal(verified.assets.length, 6);
  assert.equal((await readFile(join(directory, 'SHA256SUMS.txt'), 'utf8')).trim().split('\n').length, 6);
  // These are generated outputs, not input manifests for the next check.
  await rm(join(directory, 'verified-assets.json')); await rm(join(directory, 'SHA256SUMS.txt'));

  const missing = manifests.find(info => info.platform === 'linux' && info.arch === 'arm64');
  await rm(join(directory, missing.file + '.json')); await rm(join(directory, missing.file));
  result = verify(); assert.notEqual(result.status, 0); assert.match(result.stderr, /Missing platform artifacts: editor-linux-arm64/);
  await writeFile(join(directory, missing.file), bytes); await save(missing);

  const mac = manifests.find(info => info.platform === 'darwin');
  await save({ ...mac, macOSVerification: undefined });
  result = verify(); assert.notEqual(result.status, 0); assert.match(result.stderr, /Missing macOS signing or installed DMG verification/);
  await save(mac);

  const intel = { ...mac, arch: 'x64', file: 'editor-darwin-x64.zip' };
  await writeFile(join(directory, intel.file), bytes); await save(intel);
  result = verify(); assert.notEqual(result.status, 0); assert.match(result.stderr, /Unexpected or unverified artifact/);
});
