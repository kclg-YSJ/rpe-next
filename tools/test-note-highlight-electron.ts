// @ts-nocheck - Electron smoke script ported from the JavaScript release tooling.
import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const scratch = path.resolve('.local-tools/note-highlight'); fs.mkdirSync(scratch, { recursive: true });
app.setPath('userData', path.join(scratch, 'profile-' + Date.now()));
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
async function renderer() {
  const check = (value, message) => { if (!value) throw Error(message); };
  const until = async predicate => { const deadline = performance.now() + 8000; while (!await predicate()) { if (performance.now() > deadline) throw Error('Timed out: ' + predicate); await new Promise(resolve => setTimeout(resolve, 20)); } };
  await until(() => window.rpenMods); const e = window.rpenMods.editor; await e.noteSkins.ready; await e.skin.load(); await document.fonts.ready;
  const { parseNoteSkin, NOTE_SKIN_IMAGES } = await import('./src/core/note-skin.ts');
  const { ResourceNoteSkin } = await import('./src/ui/resource-note-skin.ts'), { RpeSkin } = await import('./src/ui/skin.ts');
  const { createChart, createNote } = await import('./src/core/chart.ts'), { TempoMap } = await import('./src/core/tempo.ts');
  const { Preview } = await import('./src/ui/preview.ts');
  const files = new Map([['info.yml', new TextEncoder().encode('name: Highlight Test\nauthor: Local\nhitFx: [1, 1]\nholdAtlas: [12, 18]\nholdAtlasMH: [18, 27]\n')]]);
  for (const name of NOTE_SKIN_IMAGES) {
    const mh = name.includes('_mh'), hold = name.startsWith('hold'), image = document.createElement('canvas');
    image.width = mh ? 240 : 160; image.height = hold ? (mh ? 450 : 300) : (mh ? 60 : 40);
    const c = image.getContext('2d');
    if (hold) { c.fillStyle = '#148cf0'; c.fillRect(0, 0, image.width, image.height); }
    else { if (mh) { c.fillStyle = '#eec451'; c.fillRect((image.width - 160) / 2, (image.height - 32) / 2, 160, 32); } c.fillStyle = '#148cf0'; c.fillRect((image.width - 120) / 2, (image.height - 20) / 2, 120, 20); }
    files.set(name, new Uint8Array(await (await new Promise(resolve => image.toBlob(resolve))).arrayBuffer()));
  }
  const record = parseNoteSkin(files, 'pack-highlight-test-local'), runtime = await ResourceNoteSkin.prepare(record, (_name, image) => image), skin = new RpeSkin(() => {});
  skin.setResourcePack(runtime);
  const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480; const c = canvas.getContext('2d');
  const blueWidth = () => { const pixels = c.getImageData(0, 0, canvas.width, canvas.height).data; let left = canvas.width, right = -1; for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) { const i = (y * canvas.width + x) * 4; if (pixels[i] === 20 && pixels[i + 1] === 140 && pixels[i + 2] === 240 && pixels[i + 3] > 200) { left = Math.min(left, x); right = Math.max(right, x); } } return right - left + 1; };
  const draw = (type, highlight, width = 80, heightWidth = 80) => { c.clearRect(0, 0, 640, 480); skin.head(c, type, 320, 240, width, highlight, undefined, 0, heightWidth); return blueWidth(); };
  const checks = [];
  for (const type of [1, 3, 4]) {
    check(draw(type, false) === 60, 'Normal body pixel width mismatch ' + type);
    check(draw(type, true) === 60, 'Highlighted padded body shrank ' + type);
    check(draw(type, true, 160) === 120, 'Note size width did not apply ' + type);
  }
  checks.push('real padded Tap/Drag/Flick pixels retain the same body size, with larger highlight margins');
  const chart = createChart(); chart.judgeLineList[0].notes = [1, 4, 3, 2].map((type, i) => ({ ...createNote(type, 4, -450 + 300 * i, type === 2 ? 8 : 4), speed: 0 }));
  e.raw.replaceChart(chart, 'highlight-test.json'); e.skin.setResourcePack(await ResourceNoteSkin.prepare(record, e.skin.tintedSource.bind(e.skin))); e.timeline.highlight = true; e.timeline.origin = 4;
  const calls = [];
  const timelineImage = e.timeline.notesCanvas.getContext('2d'), originalDraw = timelineImage.drawImage;
  try {
    timelineImage.drawImage = function(...args) { calls.push(args); return originalDraw.apply(this, args); };
    for (const multi of [false, true]) {
      e.session.setMultiLineEnabled(multi); e.timeline.origin = 4; calls.length = 0; e.timeline.draw(4);
      const base = 68 * e.timeline.renderNoteScale; check(calls.filter(args => args.length === 5).length >= 3 && calls.filter(args => args.length === 5).every(args => Math.abs(args[3] - base * 1.5) < 1e-6), 'Timeline highlight size mismatch ' + multi);
      check(e.timeline.noteWidth(e.session.notes[0]) === base * 1.5, 'Timeline selection width mismatch');
      if (!multi) { const point = { x: e.timeline.noteHorizontal(-450) - base * 0.65, y: e.timeline.vertical(4) }; check(e.timeline.hit(point)?.item.type === 1, 'Expanded highlight click missed ' + JSON.stringify({point, base, result:e.timeline.hit(point), notes:e.session.notes.map(note=>({type:note.type,x:note.positionX,width:e.timeline.noteWidth(note),highlight:e.timeline.simultaneous.has(note)})),visible:e.timeline.visible().length,canvas:e.timeline.notesCanvas.clientWidth})); e.timeline.highlight = false; check(e.timeline.hit(point)?.item.type !== 1, 'Highlight toggle did not restore hit bounds'); e.timeline.highlight = true; }
    }
  } finally { timelineImage.drawImage = originalDraw; e.session.setMultiLineEnabled(false); }
  checks.push('single/multi-line editor draws highlighted widths once; expanded clicking and highlight-off bounds agree');
  const probeCanvas = document.createElement('canvas'); probeCanvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1350, height: 900 });
  const probe = new Preview(probeCanvas); Object.assign(probe, { skin, visible: true, collisionGeometry: true, showHitEffects: false, applyShaders: false, lineNumbers: false, lineArrows: false, lineTint: false });
  probe.draw(chart, new TempoMap(chart.BPMList), 0, 0);
  check(probe.noteHitAreas.length === 4, 'Missing preview notes');
  check(probe.noteHitAreas.every(hit => Math.abs(hit.collisionWidth - probe.noteSize * 1.5) < 1e-6), 'Preview collision dimensions mismatch');
  probe.highlight = false; probe.draw(chart, new TempoMap(chart.BPMList), 0, 0);
  check(probe.noteHitAreas.every(hit => Math.abs(hit.collisionWidth - probe.noteSize) < 1e-6), 'Preview highlight-off dimensions mismatch');
  const before = probe.noteHitAreas.find(hit => hit.type === 1);
  probe.highlight = true; probe.draw(chart, new TempoMap(chart.BPMList), 0, 0);
  check(probe.pickNoteTarget(before.x1 - probe.noteSize * 0.8, before.y1)?.noteIndex === 0, 'Preview picking ignored highlight width');
  checks.push('preview picking and detailed collision geometry match the highlighted rendering');
  e.noteSkins.records.set(record.id, record); await e.noteSkins.open(); await e.noteSkins.select(record.id, true); cancelAnimationFrame(e.noteSkins.frame); e.noteSkins.demoPlaying = false; e.noteSkins.drawDemo(0);
  check(e.noteSkins.previewSkin.noteScale(true) === 1.5, 'Manager preview did not use ratio');
  const managed = e.noteSkins.previewSkin.resourcePack;
  managed.info = { ...managed.info, holdRepeat: true };
  managed.hold(c, 320, 380, 100, 80, true, true, undefined, 80);
  check(managed.noteScale(true) === 1.5, 'Repeat Hold lost ratio');
  const managerCanvas = e.noteSkins.canvas, pixels = managerCanvas.getContext('2d').getImageData(0, 0, managerCanvas.width, managerCanvas.height).data;
  const dpr = globalThis.devicePixelRatio || 1, w = managerCanvas.clientWidth, h = managerCanvas.clientHeight, demoScale = Math.min(w / 680, h / 250), ox = (w - 680 * demoScale) / 2, oy = (h - 250 * demoScale) / 2;
  const demoBlueWidth = (x, y) => {
    let left = managerCanvas.width, right = -1;
    for (let py = Math.max(0, Math.floor((oy + (y - 20) * demoScale) * dpr)); py < Math.min(managerCanvas.height, (oy + (y + 20) * demoScale) * dpr); py++)
      for (let px = Math.max(0, Math.floor((ox + (x - 45) * demoScale) * dpr)); px < Math.min(managerCanvas.width, (ox + (x + 45) * demoScale) * dpr); px++) { const i = (py * managerCanvas.width + px) * 4; if (pixels[i] === 20 && pixels[i + 1] === 140 && pixels[i + 2] === 240) { left = Math.min(left, px); right = Math.max(right, px); } }
    return right - left + 1;
  };
  for (const x of [125, 225, 325]) check(Math.abs(demoBlueWidth(x, 55) - demoBlueWidth(x, 125)) <= 1 && demoBlueWidth(x, 55) > 10, 'Manager preview body still shrunk');
  checks.push('skin manager preview preserves body size in actual pixels; repeated Hold renders with the same scale');
  window.highlightTestImage = e.noteSkins.canvas.toDataURL();
  e.noteSkins.close(true); document.querySelector('#settings-modal').close();
  skin.setResourcePack(null); e.skin.setResourcePack(null); check(e.skin.noteScale(true) === 1, 'Default did not reset scale');
  return { checks };
}
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1440, height: 960, show: false, webPreferences: { backgroundThrottling: false } }), errors = [];
  win.webContents.on('will-prevent-unload', event => event.preventDefault());
  win.webContents.on('console-message', detail => { if (detail.level === 'error' && !/favicon/.test(detail.message)) errors.push(detail.message); });
  try {
    await win.loadURL('http://127.0.0.1:4187/?mods=off');
    const result = await win.webContents.executeJavaScript('(' + renderer.toString() + ')()', true);
    assert.deepEqual(errors, []);
    const picture = await win.webContents.executeJavaScript('window.highlightTestImage');
    fs.writeFileSync(path.join(scratch, 'preview.png'), Buffer.from(picture.split(',')[1], 'base64'));
    console.log(JSON.stringify({ ...result, errors }, null, 2));
  } catch (error) { console.error(error.stack, errors); process.exitCode = 1; }
  finally { win.destroy(); app.exit(process.exitCode || 0); }
}).catch(error => { console.error(error.stack); app.exit(1); });
