/*
 * Headless smoke test for the packaged web app.
 *
 * Serves www/ over HTTP (same asset layout as the APK payload), drives Chrome through the
 * DevTools protocol, boots the editor, records console errors and page exceptions, and
 * saves a screenshot.
 *
 * Run: node tools/smoke.mjs [--out screenshot.png] [--wait 12000]
 */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = resolve(fileURLToPath(new URL('../', import.meta.url)));
const root = join(here, 'www');
const outIndex = process.argv.indexOf('--out');
const shot = outIndex > 0 ? resolve(process.argv[outIndex + 1]) : join(here, 'screenshots', 'web-smoke.png');
const waitIndex = process.argv.indexOf('--wait');
const settleMs = waitIndex > 0 ? Number(process.argv[waitIndex + 1]) : 12000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wasm': 'application/wasm',
  '.bin': 'application/octet-stream',
  '.glsl': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
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
  } catch {
    response.writeHead(404);
    response.end('not found');
  }
});

await new Promise(done => server.listen(0, '127.0.0.1', done));
const port = server.address().port;
const url = `http://127.0.0.1:${port}/`;
console.log(`serving ${root} at ${url}`);

// Any Chromium build works; the editor is Chrome-first, so Chrome and Edge are tried in turn.
// Override with CHROME_PATH when the browser lives somewhere else.
const candidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].filter(Boolean);
let browserPath = null;
for (const candidate of candidates) {
  try { await readFile(candidate); browserPath = candidate; break; } catch { /* try next */ }
}
if (!browserPath) throw new Error('No Chromium browser found');

const debugPort = 9411;
const profile = join(here, '.chrome-profile');
await mkdir(profile, { recursive: true });
const browser = spawn(browserPath, [
  '--headless=new',
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--disable-background-networking',
  '--hide-scrollbars',
  '--window-size=1440,900',
  '--force-device-scale-factor=1',
  'about:blank'
], { stdio: 'ignore' });

const sleep = ms => new Promise(done => setTimeout(done, ms));

async function targetSocket() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      const page = list.find(item => item.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch { /* not ready */ }
    await sleep(250);
  }
  throw new Error('DevTools endpoint never came up');
}

const socketUrl = await targetSocket();
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

const problems = [];
const pageErrors = [];
const failedRequests = [];

socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    problems.push(message.params.args.map(arg => arg.value ?? arg.description ?? arg.type).join(' '));
  }
  if (message.method === 'Runtime.exceptionThrown') {
    const details = message.params.exceptionDetails;
    pageErrors.push(details.exception?.description ?? details.text);
  }
  if (message.method === 'Network.loadingFailed' && !message.params.canceled) {
    failedRequests.push(`${message.params.errorText} ${message.params.requestId}`);
  }
});

await send('Runtime.enable');
await send('Page.enable');
await send('Network.enable');
await send('Log.enable');

const loaded = new Promise(done => {
  const listener = event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Page.loadEventFired') { socket.removeEventListener('message', listener); done(); }
  };
  socket.addEventListener('message', listener);
});
await send('Page.navigate', { url });
await Promise.race([loaded, sleep(30000)]);
await sleep(settleMs);

const probe = await send('Runtime.evaluate', {
  expression: `(function(){
    const cards = document.querySelectorAll('#project-cards *').length;
    const version = document.getElementById('app-version');
    return JSON.stringify({
      title: document.title,
      home: !!document.getElementById('home'),
      homeHidden: document.getElementById('home')?.hidden ?? null,
      editor: !!document.getElementById('notes'),
      projectCards: cards,
      status: (document.getElementById('status')?.textContent || '').trim().slice(0, 80),
      version: version ? version.textContent.trim() : null,
      bridge: !!window.RpenNativeSave,
      nativeBridgeLoaded: !!document.querySelector('script[src="./native-bridge.js"]')
    });
  })()`,
  returnByValue: true
});

await mkdir(resolve(shot, '..'), { recursive: true });
const shotData = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
const { writeFile } = await import('node:fs/promises');
await writeFile(shot, Buffer.from(shotData.data, 'base64'));

console.log('PAGE ' + probe.result.value);
console.log(`console errors: ${problems.length}`);
for (const item of problems.slice(0, 25)) console.log('  ! ' + item);
console.log(`page exceptions: ${pageErrors.length}`);
for (const item of pageErrors.slice(0, 20)) console.log('  !! ' + String(item).split('\n')[0]);
console.log(`failed requests: ${failedRequests.length}`);
for (const item of failedRequests.slice(0, 20)) console.log('  - ' + item);
console.log('screenshot: ' + shot);

socket.close();
browser.kill();
server.close();
process.exit(problems.length + pageErrors.length > 0 ? 1 : 0);

