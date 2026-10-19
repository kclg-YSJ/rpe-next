import test from 'node:test';
import assert from 'node:assert/strict';
import { chartExportStem, safeExportStem, safeDownloadName, DownloadNames } from '../src/core/export-filename.ts';
import { createChartExport } from '../src/platform/files.ts';
import { createChart } from '../src/core/chart.ts';

test('all export formats default to the chart title, with a source-name fallback for missing titles', () => {
  const chart = createChart(); chart.META.name = '曲名 Ω 🎵';
  for (const format of ['json', 'pez'] as const) for (const compatibility of ['next', 'rpe'] as const) {
    assert.equal(createChartExport(chart, new Map(), 'folder/chart.json', { format, compatibility }).name, '曲名 Ω 🎵.' + format);
  }
  assert.equal(chartExportStem({ META: { name: '   ' } }, 'folder/source.pez'), 'source');
  assert.equal(chartExportStem({}, 'C:\\folder\\source.json'), 'source');
  assert.equal(chartExportStem({}, ''), 'Untitled');
});

test('unsafe characters, reserved Windows names, dot-only names and trailing spaces are converted without changing chart metadata', () => {
  const chart = createChart(); chart.META.name = '  曲名: / A\\B?*<>"|\n下一行.  ';
  const title = chart.META.name;
  const output = createChartExport(chart, new Map(), 'chart.json', { format: 'json' });
  assert.equal(output.name, '曲名_ _ A_B_______下一行.json');
  assert.equal(chart.META.name, title);
  for (const value of ['CON', 'nul', 'COM1.txt', 'LPT²']) assert.ok(safeExportStem(value).startsWith('_'));
  assert.equal(safeExportStem('...'), 'Untitled');
  assert.equal(safeExportStem('Name.json.json'), 'Name');
  assert.equal(safeDownloadName('音符.rpe.json'), '音符.rpe.json');
  assert.equal(safeDownloadName('pack.json.zip'), 'pack.json.zip');
  assert.throws(() => createChartExport(chart, new Map(), 'chart.json', { name: '  ' }), /文件名/);
});

test('long Unicode titles keep whole code points, leave room for extensions and remain usable after conversion', () => {
  const stem = safeExportStem('中文😀'.repeat(300)), name = safeDownloadName(stem + '.pez');
  assert.ok(new TextEncoder().encode(stem).length <= 180);
  assert.ok(new TextEncoder().encode(name).length < 255);
  assert.ok(!stem.includes('\ufffd')); assert.ok(stem.length > 0);
});

test('duplicate downloads, case variants, Unicode equivalents and sanitization collisions get numeric suffixes', () => {
  const names = new DownloadNames();
  assert.equal(names.suggest('曲名.pez'), '曲名.pez');
  assert.equal(names.reserve('曲名.pez'), '曲名.pez');
  assert.equal(names.suggest('曲名.pez'), '曲名 (2).pez');
  assert.equal(names.reserve('曲名.pez'), '曲名 (2).pez');
  assert.equal(names.reserve('曲名.pez'), '曲名 (3).pez');
  assert.equal(names.reserve('曲名.json'), '曲名.json');
  assert.equal(names.reserve('a:b.pez'), 'a_b.pez');
  assert.equal(names.reserve('a?b.pez'), 'a_b (2).pez');
  assert.equal(names.reserve('A_B.pez'), 'A_B (3).pez');
  assert.equal(names.reserve('é.json'), 'é.json');
  assert.equal(names.reserve('e\u0301.json'), 'é (2).json');
  assert.equal(names.reserve('曲名 (2).pez'), '曲名 (2) (2).pez');
});
