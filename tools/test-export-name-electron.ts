// @ts-nocheck - Electron smoke script ported from the JavaScript release tooling.
import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const scratch = path.resolve('.local-tools/export-name-' + Date.now()); fs.mkdirSync(path.join(scratch, 'downloads'), { recursive: true });
app.setPath('userData', path.join(scratch, 'profile'));
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
async function renderer() {
  const check = (value, message) => { if (!value) throw Error(message); };
  const until = async predicate => { const deadline = performance.now() + 8000; while (!predicate()) { if (performance.now() > deadline) throw Error('Timed out: ' + predicate); await new Promise(resolve => setTimeout(resolve, 20)); } };
  await until(() => window.rpenMods); const e = window.rpenMods.editor;
  const { createChart } = await import('./src/core/chart.ts');
  const { chartExportStem } = await import('./src/core/export-filename.ts');
  const chart = createChart(); chart.META.name = '雪: / A?* 🎵.'; const stem = chartExportStem(chart);
  e.raw.replaceChart(chart, 'nested/not-the-title.json');
  const dialog = () => document.querySelector('#modal'), input = () => document.querySelector('#modal input[aria-label="文件名（不含扩展名）"]');
  const chooseFormat = value => { const select = document.querySelector('#modal select[aria-label="导出格式"]'); select.value = value; select.dispatchEvent(new Event('change')); };
  const open = () => document.querySelector('#export').click();
  const apply = async () => { document.querySelector('#modal-apply').click(); await until(() => !dialog().open); await new Promise(resolve => setTimeout(resolve, 150)); };
  open(); check(input().value === stem, 'Default did not use sanitized chart title'); await apply();
  open(); check(input().value === stem + ' (2)', 'Repeated PEZ default did not get suffix'); await apply();
  open(); chooseFormat('next:json'); check(input().value === stem, 'JSON default incorrectly reused PEZ suffix'); await apply();
  open(); chooseFormat('rpe:json'); check(input().value === stem + ' (2)', 'RPE JSON shares the destination namespace'); await apply();
  open(); input().value = 'CON?demo'; chooseFormat('next:json'); check(input().value === 'CON?demo', 'Format change discarded user filename'); await apply();
  open(); chooseFormat('next:json'); input().value = 'same:name'; await apply();
  open(); chooseFormat('rpe:json'); input().value = 'same?name'; await apply();
  check(e.chart.META.name === chart.META.name && !e.dirty, 'Export changed chart metadata or dirty state');
  check(document.querySelector('footer').textContent.includes('0.12.2'), 'Wrong displayed release version');
  return { stem, title: chart.META.name, checks: ['title-based defaults, special characters, repeated JSON/PEZ exports and sanitization collisions', 'format changes preserve manual filename edits, metadata remains unchanged and version is 0.12.2'] };
}
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1440, height: 960, show: false, webPreferences: { backgroundThrottling: false } }), errors = [], downloads = [];
  win.webContents.on('will-prevent-unload', event => event.preventDefault());
  win.webContents.on('console-message', detail => { if (detail.level === 'error' && !/favicon/.test(detail.message)) errors.push(detail.message); });
  win.webContents.session.on('will-download', (_event, item) => {
    const name = item.getFilename(); item.setSavePath(path.join(scratch, 'downloads', name));
    downloads.push(new Promise((resolve, reject) => item.once('done', (_event, state) => state === 'completed' ? resolve(name) : reject(Error('Download ' + state)))));
  });
  try {
    await win.loadURL('http://127.0.0.1:4187/?mods=off');
    const result = await win.webContents.executeJavaScript('(' + renderer.toString() + ')()', true);
    const filenames = await Promise.all(downloads);
    assert.deepEqual(filenames, [result.stem + '.pez', result.stem + ' (2).pez', result.stem + '.json', result.stem + ' (2).json', 'CON_demo.json', 'same_name.json', 'same_name (2).json']);
    const json = JSON.parse(fs.readFileSync(path.join(scratch, 'downloads', filenames[2]), 'utf8'));
    assert.equal(json.META.name, result.title); assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ...result, filenames, errors }, null, 2));
  } catch (error) { console.error(error.stack, errors); process.exitCode = 1; }
  finally { win.destroy(); app.exit(process.exitCode || 0); }
}).catch(error => { console.error(error.stack); app.exit(1); });
