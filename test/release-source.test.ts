// @ts-nocheck - ported integration test with dynamic archive fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeZip } from '../src/platform/archive.ts';
import { extractReleaseZip, verifyReleaseSourceDirectory, verifyReleaseSourceZip } from '../tools/release-source.ts';

async function fixture(context) {
  const root = await mkdtemp(join(tmpdir(), 'rpen-release-source-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git('init');
  const name = 'assets/中文皮肤/BY虹之梦-かな-é.png';
  await mkdir(join(root, 'assets/中文皮肤'), { recursive: true });
  await writeFile(join(root, name), new Uint8Array([0, 255, 128, 42]));
  await writeFile(join(root, 'private.txt'), 'not selected');
  git('add', '--', 'assets', 'private.txt');
  git('-c', 'user.name=Release Test', '-c', 'user.email=release-test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'Fixture');
  const archive = join(root, 'source.zip'), stage = join(root, 'stage');
  git('archive', '--format=zip', '-0', '--output=' + archive, 'HEAD', '--', 'assets');
  await mkdir(stage); await extractReleaseZip(archive, stage);
  return { root, name, stage };
}

test('发布源码在不同区域设置下保留中文目录、混合字符文件名和二进制内容', async context => {
  const { root, name, stage } = await fixture(context);
  assert.deepEqual(await readFile(join(stage, name)), Buffer.from([0, 255, 128, 42]));
  assert.equal(await verifyReleaseSourceDirectory(root, 'HEAD', ['assets'], stage), 1);
  await assert.rejects(readFile(join(stage, 'private.txt')), { code: 'ENOENT' });
  await rename(join(stage, name), join(stage, 'assets/中文皮肤/mojibake.png'));
  await assert.rejects(verifyReleaseSourceDirectory(root, 'HEAD', ['assets'], stage), /Missing release source file/);
});

test('发布源码校验拒绝被修改的素材内容', async context => {
  const { root, name, stage } = await fixture(context);
  await writeFile(join(stage, name), 'corrupted');
  await assert.rejects(verifyReleaseSourceDirectory(root, 'HEAD', ['assets'], stage), /content mismatch/);
});

test('发布 ZIP 校验实际归档的中文路径和内容，拒绝打包后的乱码路径', async context => {
  const { root, name, stage } = await fixture(context);
  const prefix = 'Application/resources/app/';
  for (const damaged of [false, true]) {
    const archive = join(root, damaged ? 'bad.zip' : 'good.zip');
    const zip = writeZip(new Map([[prefix + (damaged ? 'assets/incorrect.png' : name), new Uint8Array(await readFile(join(stage, name)))] ]));
    await writeFile(archive, new Uint8Array(await zip.arrayBuffer()));
    if (damaged) await assert.rejects(verifyReleaseSourceZip(root, 'HEAD', ['assets'], archive, prefix), /Missing release source file/);
    else assert.equal(await verifyReleaseSourceZip(root, 'HEAD', ['assets'], archive, prefix), 1);
  }
});
