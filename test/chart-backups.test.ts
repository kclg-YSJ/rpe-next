// @ts-nocheck - ported integration test with dynamic archive fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isBackupChartFile } from '../src/core/chart-backups.ts';
import { createChart } from '../src/core/chart.ts';
import { DEFAULT_EDITOR_PREFERENCES } from '../src/core/default-settings.ts';
import { normalizeEditorPreferences, readEditorPreferences, writeEditorPreferences } from '../src/platform/editor-preferences.ts';
import { openFiles, createChartExport, packageEntries } from '../src/platform/files.ts';
import { scanMigration, materializeProject } from '../src/platform/migration.ts';
import { readZip, writeZip } from '../src/platform/archive.ts';
import { parseInfo } from '../src/platform/legacy-text.ts';

const encode = value => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));
const backupNames = ['AutoSave_2024_8_10_1_7_14_377.json', 'AUTOSAVE_main.PEC', 'AutoSave_extra_2026_10_18_12_3_4_.json', 'main.json.bak', 'main.pec.backup.2'];
const fixture = () => new Map([['main.json', encode(createChart())], ...backupNames.map(name => [name, encode(createChart())]),
  ['extra.json', encode({ effects: [] })], ['music.ogg', new Uint8Array([1, 2])], ['AutoSave_cover.png', new Uint8Array([3])],
  ['textures/backup.png', new Uint8Array([4])], ['AutoSave_pictures/image.png', new Uint8Array([5])], ['backup-song.json', encode(createChart())]]);
const entry = (path, bytes) => ({ path, getFile: async () => new File([bytes], path.split('/').at(-1)) });

test('识别 RPE 新旧自动保存和附属 extra 备份，不按目录或媒体名称误判', () => {
  for (const name of backupNames) for (const prefix of ['', 'folder/', 'Resources\\1\\']) assert.equal(isBackupChartFile(prefix + name), true, prefix + name);
  for (const name of ['AutoSave_cover.png', 'backup.json', 'backup-song.json', 'extra.json', 'AutoSave_folder/main.json', 'main.bak.png']) assert.equal(isBackupChartFile(name), false, name);
});

test('全局包含备份设置默认关闭，布尔值可正常持久化', () => {
  assert.equal(DEFAULT_EDITOR_PREFERENCES.includeBackupCharts, false);
  assert.deepEqual(normalizeEditorPreferences({ includeBackupCharts: 'true' }), {});
  const values = new Map(), storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  for (const includeBackupCharts of [true, false]) {
    writeEditorPreferences({ includeBackupCharts }, storage);
    assert.equal(readEditorPreferences(storage).includeBackupCharts, includeBackupCharts);
  }
});

test('PEZ 和 ZIP 默认不解压备份、不保留为素材，开启后可以导入备份', async () => {
  for (const extension of ['pez', 'zip']) for (const includeBackupCharts of [false, true]) {
    const files = fixture(), archive = writeZip(files);
    const loaded = await openFiles([new File([archive], 'test.' + extension)], { includeBackupCharts });
    for (const name of backupNames) assert.equal(loaded.assets.has(name), includeBackupCharts, name);
    assert.equal(loaded.candidates.length, includeBackupCharts ? 7 : 2);
    assert.deepEqual(loaded.assets.get('music.ogg'), files.get('music.ogg'));
    assert.ok(loaded.assets.has('AutoSave_cover.png')); assert.ok(loaded.assets.has('AutoSave_pictures/image.png'));
  }
  const files = fixture(), buffer = await writeZip(files).arrayBuffer(), info = new DataView(buffer);
  // Corrupt an ignored backup's payload. Import must skip decompression/CRC of it.
  const { inspectZip } = await import('../src/platform/archive.ts');
  const backup = inspectZip(buffer).entries.find(entry => entry.name === backupNames[0]);
  info.setUint8(backup.dataOffset, info.getUint8(backup.dataOffset) ^ 1);
  assert.equal((await openFiles([new File([buffer], 'test.pez')])).candidates.length, 2);
  await assert.rejects(openFiles([new File([buffer], 'test.pez')], { includeBackupCharts: true }), /校验失败/);
});

test('散文件默认不读取备份内容，允许显式开启以恢复备份', async () => {
  const main = new File([encode(createChart())], 'main.json');
  const ignored = { name: backupNames[0], arrayBuffer: () => { throw new Error('不应读取'); } };
  assert.equal((await openFiles([main, ignored])).assets.size, 1);
  await assert.rejects(openFiles([ignored]), /自动保存及备份/);
  const backup = new File([encode(createChart())], backupNames[0]);
  assert.equal((await openFiles([backup], { includeBackupCharts: true })).candidates[0].name, backupNames[0]);
});

test('迁移对主谱、候选列表和复制素材统一过滤，开启后保留备份', async () => {
  for (const withInfo of [false, true]) for (const includeBackupCharts of [false, true]) {
    const files = fixture(); if (withInfo) files.set('info.txt', encode('Chart: main.json'));
    const entries = [...files].map(([name, bytes]) => entry('Resources/1/' + name, bytes));
    const plan = await scanMigration(entries, 'RPE', { includeBackupCharts });
    assert.equal(plan.projects.length, includeBackupCharts ? withInfo ? 6 : 7 : withInfo ? 1 : 2);
    const project = await materializeProject(plan, plan.projects.find(project => project.path.endsWith('/main.json'))), assets = new Map(project.assets);
    for (const name of backupNames) assert.equal(assets.has(name), includeBackupCharts, name);
    assert.ok(assets.has('AutoSave_cover.png')); assert.ok(assets.has('extra.json'));
  }
  const ignored = { path: 'Resources/1/' + backupNames[0], getFile: () => { throw new Error('不应读取备份'); } };
  const onlyBackups = await scanMigration([ignored], 'RPE');
  assert.equal(onlyBackups.projects.length, 0); assert.deepEqual(onlyBackups.ignored, [ignored.path]);
  const plan = await scanMigration([entry('Resources/1/main.json', encode(createChart())), ignored], 'RPE');
  await materializeProject(plan, plan.projects[0]);
  const referenced = await scanMigration([entry('Resources/2/info.txt', encode('Chart: ' + backupNames[0])), { ...ignored, path: 'Resources/2/' + backupNames[0] }], 'RPE');
  assert.equal(referenced.projects.length, 0); assert.equal(referenced.failures.length, 0);
});

test('Next 和原 RPE 的 PEZ 默认过滤旧素材中的备份，开启后包含，当前谱面不会丢失', async () => {
  for (const compatibility of ['next', 'rpe']) for (const includeBackupCharts of [false, true]) {
    const assets = fixture(), original = new Map(assets);
    const result = createChartExport(createChart(), assets, 'main.json', { compatibility, includeBackupCharts, includeUnusedFiles: true });
    const files = await readZip(await result.blob.arrayBuffer());
    for (const name of backupNames) assert.equal(files.has(name), includeBackupCharts, name);
    assert.ok(files.has('AutoSave_cover.png')); assert.ok(files.has('extra.json')); assert.ok(files.has('backup-song.json'));
    const info = parseInfo(new TextDecoder().decode(files.get('info.txt')));
    assert.equal(info.Chart, 'main.json'); assert.ok(JSON.parse(new TextDecoder().decode(files.get(info.Chart))).META);
    assert.deepEqual(assets, original);
  }
  for (const converted of [false, true]) {
    const chart = createChart(); if (converted) chart.rpeNextLegacySource = { text: 'original' };
    const assets = fixture(); assets.set('nested/chart.json', encode('preserve this file'));
    const source = 'nested/' + backupNames[0]; assets.set(source, encode(chart));
    assets.set('nested/info.txt', encode('Chart: ' + backupNames[0]));
    const files = packageEntries(chart, assets, source, { includeUnusedFiles: true });
    assert.ok(![...files.keys()].some(isBackupChartFile));
    const root = parseInfo(new TextDecoder().decode(files.get('info.txt'))), nested = parseInfo(new TextDecoder().decode(files.get('nested/info.txt')));
    assert.ok(files.has(root.Chart)); assert.equal(root.Chart, 'nested/' + nested.Chart);
    assert.ok(JSON.parse(new TextDecoder().decode(files.get(root.Chart))).META);
    assert.equal(new TextDecoder().decode(files.get('nested/chart.json')), 'preserve this file');
  }
});
