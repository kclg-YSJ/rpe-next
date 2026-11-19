/*
 * Verifies the touch gestures on the timeline with real touch events.
 *
 * 1. drag a finger up the note timeline  -> the playhead must move forward (pan)
 * 2. tap the same area with the Tap tool -> a note must be placed (tap still works)
 * 3. drag with the Tap tool selected     -> no note may be placed (drag is not a tap)
 *
 * Run: node tools/touch-pan-test.mjs
 */
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = resolve(fileURLToPath(new URL('../', import.meta.url)));
const root = join(here, 'www');
const shots = join(here, 'screenshots');
await mkdir(shots, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wasm': 'application/wasm',
  '.bin': 'application/octet-stream', '.glsl': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8'
};

const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
    const file = resolve(root, relative);
    if (!file.startsWith(root)) throw new Error('outside root');
    const body = await readFile(file);
    response.writeHead(200, { 'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream' });
    response.end(body);
  } catch { response.writeHead(404); response.end('not found'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${server.address().port}/`;

const debugPort = 9413;
const browser = spawn('C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', [
  '--headless=new', `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${join(here, '.chrome-profile')}`,
  '--no-first-run', '--disable-extensions', '--hide-scrollbars', 'about:blank'
], { stdio: 'ignore' });

const sleep = ms => new Promise(done => setTimeout(done, ms));

let socketUrl = null;
for (let attempt = 0; attempt < 80 && !socketUrl; attempt++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    socketUrl = list.find(item => item.type === 'page')?.webSocketDebuggerUrl ?? null;
  } catch { /* not ready */ }
  if (!socketUrl) await sleep(250);
}
if (!socketUrl) throw new Error('DevTools endpoint never came up');

const socket = new WebSocket(socketUrl);
await new Promise((done, fail) => {
  socket.addEventListener('open', done, { once: true });
  socket.addEventListener('error', fail, { once: true });
});

let nextId = 0;
const pending = new Map();
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve: ok, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message)); else ok(message.result);
  }
});
function send(method, params = {}) {
  const id = ++nextId;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((ok, fail) => pending.set(id, { resolve: ok, reject: fail }));
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ' ' + (result.exceptionDetails.exception?.description ?? ''));
  return result.result.value;
}

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 800, height: 360, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

const loaded = new Promise(done => {
  const listener = event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Page.loadEventFired') { socket.removeEventListener('message', listener); done(); }
  };
  socket.addEventListener('message', listener);
});
await send('Page.navigate', { url });
await Promise.race([loaded, sleep(30000)]);
await sleep(6000);

// Enter the editor.
await evaluate(`document.getElementById('home-new').click(); true`);
await sleep(9000);

const geometry = JSON.parse(await evaluate(`JSON.stringify((function(){
  const canvas = document.getElementById('notes');
  const box = canvas.getBoundingClientRect();
  const layoutWidth = document.documentElement.clientWidth;
  const scale = innerWidth / layoutWidth;
  // Client (visual) coordinates = layout coordinates * page scale.
  const clientX = (box.left + box.width / 2) * scale;
  const clientY = (box.top + box.height * 0.7) * scale;
  const hit = document.elementFromPoint(clientX, clientY);
  return { layoutWidth, innerWidth, scale, box: { w: Math.round(box.width), h: Math.round(box.height) },
           clientX, clientY, hit: hit ? (hit.id || hit.tagName) : null };
})())`));
console.log('geometry ' + JSON.stringify(geometry));

if (geometry.hit !== 'notes') throw new Error(`touch point does not land on the note timeline (hit ${geometry.hit})`);

const clock = async () => Number((await evaluate(`document.getElementById('clock').textContent`)).match(/([\d.]+)s/)[1]);
const noteCount = async () => (await evaluate(`document.getElementById('note-count').textContent`)).trim();

const results = [];
const before = await clock();
console.log(`start time: ${before}s`);

// --- 1. drag a finger up = pan forward in time -------------------------------------------
const startY = geometry.clientY;
let y = startY;
await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: geometry.clientX, y }] });
for (let step = 0; step < 8; step++) {
  y -= 24;
  await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: geometry.clientX, y }] });
  await sleep(40);
}
await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await sleep(900);
const afterDrag = await clock();
console.log(`after drag: ${afterDrag}s`);
results.push({ name: '拖动平移时间轴', ok: afterDrag > before + 0.01, detail: `${before}s -> ${afterDrag}s` });

// --- 2. tap with the Tap tool places a note -----------------------------------------------
await evaluate(`document.querySelector('[data-tool="1"]').click(); true`);
await sleep(400);
const beforeTap = await noteCount();
const tapY = startY - 40;
await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: geometry.clientX, y: tapY }] });
await sleep(60);
await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await sleep(700);
const afterTap = await noteCount();
console.log(`notes: ${beforeTap} -> ${afterTap}`);
results.push({ name: '轻点放置音符', ok: beforeTap !== afterTap, detail: `${beforeTap} -> ${afterTap}` });

// --- 3. dragging with the Tap tool must not place a note ----------------------------------
const beforeDragWithTool = await noteCount();
let dragY = tapY + 30;
await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: geometry.clientX, y: dragY }] });
for (let step = 0; step < 6; step++) {
  dragY -= 22;
  await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: geometry.clientX, y: dragY }] });
  await sleep(40);
}
await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await sleep(800);
const afterDragWithTool = await noteCount();
const panWithTool = await clock();
console.log(`notes after drag (Tap tool active): ${afterDragWithTool}, time ${panWithTool}s`);
results.push({ name: '选中 Tap 时拖动只平移不放音符', ok: beforeDragWithTool === afterDragWithTool && panWithTool > afterDrag, detail: `${beforeDragWithTool} === ${afterDragWithTool}, ${afterDrag}s -> ${panWithTool}s` });

const shotData = await send('Page.captureScreenshot', { format: 'png' });
await writeFile(join(shots, 'phone-4-touch-pan.png'), Buffer.from(shotData.data, 'base64'));

console.log('');
let failed = 0;
for (const result of results) {
  console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${result.name}  (${result.detail})`);
  if (!result.ok) failed++;
}
console.log(`\n${results.length - failed}/${results.length} passed`);

socket.close(); browser.kill(); server.close();
process.exit(failed ? 1 : 0);
