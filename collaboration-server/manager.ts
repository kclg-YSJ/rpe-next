import { app, BrowserWindow, ipcMain, dialog, protocol, shell } from 'electron';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import type { ChildProcess } from 'node:child_process';
import type { NetworkInterfaceInfo } from 'node:os';
import type { CollaborationService } from './server.ts';
import { createDiagnostics } from './diagnostics.ts';

// Electron loads this as an ES module, which has no `__dirname`; derive it from the module URL.
const here = dirname(fileURLToPath(import.meta.url));
const origin = 'rpe-server://app';
const smoke = process.argv.includes('--smoke-test');
app.setPath('userData', join(app.getPath('appData'), smoke ? 'rpe-next-server-smoke' : 'rpe-next-server'));
mkdirSync(app.getPath('userData'), { recursive: true });
const configPath = join(app.getPath('userData'), 'preferences.json');
const diagnosticPath = join(app.getPath('userData'), 'collaboration-diagnostics.log');
const diagnostics = createDiagnostics(diagnosticPath);
const diagnostic = (entry: Record<string, unknown>): void => diagnostics.write(entry);
interface ManagerPreferences { port?: number; lan?: boolean; tunnelPath?: string }
/** The dynamically imported server entry point, typed at the module boundary. */
interface ServerModule {
  startCollaborationServer(options: { port: number; host?: string; creationKey?: string; onDiagnostic?: (entry: Record<string, unknown>) => void; onStatus?: (value: { rooms: number; users: number }) => void }): Promise<CollaborationService>;
}
let preferences: ManagerPreferences = {};
try { preferences = JSON.parse(readFileSync(configPath, 'utf8')) as unknown as ManagerPreferences; } catch {}
let window: BrowserWindow | null = null; let service: CollaborationService | null = null; let tunnel: ChildProcess | null = null; let tunnelPath = ''; let publicAddress = ''; let counts = { rooms: 0, users: 0 }; let message = '服务未启动';
tunnelPath = typeof preferences.tunnelPath === 'string' ? preferences.tunnelPath : '';
app.setName('RPE Next 协作服务器');
// The manager window loads `manager-renderer.ts` through this scheme. Chromium refuses to execute a
// `.ts` script tag — it maps the extension to the `video/vnd.dlna.mpeg-tts` MIME type and blocks it —
// so the script is served with its types stripped and a JavaScript content type instead. This is the
// same transform Node applies when it loads the file directly, and it keeps the whole package in
// TypeScript without a separate build step for one browser script.
protocol.registerSchemesAsPrivileged([{ scheme: 'rpe-server', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const state = () => ({ running: Boolean(service), port: service?.port, preferences: { port: preferences.port ?? 4182, lan: preferences.lan ?? false }, tunnel: Boolean(tunnel), tunnelPath, publicAddress, ...counts, message, localAddresses: Object.values(networkInterfaces()).flat().filter((entry): entry is NetworkInterfaceInfo => entry !== undefined && entry.family === 'IPv4' && !entry.internal).map(entry => `ws://${entry.address}:${service?.port ?? 4182}/collab`) });
const update = () => { if (window && !window.isDestroyed()) window.webContents.send('server-state', state()); };
ipcMain.handle('server-action', async (event, action: string, values: Record<string, unknown> = {}) => {
  if (event.sender !== window?.webContents) throw new Error('无权限');
  try {
    if (action === 'start' && !service) {
      const port = Number(values.port); if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('端口须为 1024–65535');
      const module = await import(pathToFileURL(join(here, 'server.ts')).href) as unknown as ServerModule;
      service = await module.startCollaborationServer({ port, host: values.lan ? '0.0.0.0' : '127.0.0.1', creationKey: String(values.key ?? ''), onDiagnostic: diagnostic, onStatus: (value: { rooms: number; users: number }) => { counts = value; update(); } });
      diagnostic({ phase: 'service-start', framed: true, acknowledgementWindow: 16, maximumWindow: 128, compression: true, assetDelivery: true });
      preferences = { port, lan: Boolean(values.lan), tunnelPath }; writeFileSync(configPath, JSON.stringify(preferences));
      message = '服务已启动。公网协作请启动隧道或配置固定公网入口。';
    } else if (action === 'stop') {
      tunnel?.kill(); tunnel = null; if (service) await service!.close(); service = null; counts = { rooms: 0, users: 0 }; publicAddress = ''; message = '服务已停止';
    } else if (action === 'diagnostics') {
      await diagnostics.flush(); await shell.showItemInFolder(diagnosticPath);
    } else if (action === 'download-tunnel') {
      await shell.openExternal('https://github.com/cloudflare/cloudflared/releases/latest');
    } else if (action === 'choose-tunnel') {
      const result = await dialog.showOpenDialog(window, { title: '选择从 Cloudflare 官方下载的 cloudflared.exe', filters: [{ name: 'Cloudflare Tunnel', extensions: ['exe'] }], properties: ['openFile'] });
      if (!result.canceled) { tunnelPath = result.filePaths[0]; preferences.tunnelPath = tunnelPath; writeFileSync(configPath, JSON.stringify(preferences)); }
    } else if (action === 'tunnel') {
      if (!service || !tunnelPath) throw new Error('请先启动服务并选择 cloudflared.exe');
      if (tunnel) return state();
      const args = values.token ? ['tunnel', '--no-autoupdate', 'run'] : ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${service.port}`];
      const env = { ...process.env }; delete env.TUNNEL_TOKEN; if (values.token) env.TUNNEL_TOKEN = String(values.token);
      const child = spawn(tunnelPath, args, { windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] }); tunnel = child;
      message = values.token ? '固定隧道正在启动；请使用已配置的域名。令牌仅在本次运行使用。' : '临时公网入口正在申请，通常需要数秒。';
      const onData = (bytes: Buffer | string): void => {
        const text = String(bytes); const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
        if (match) { publicAddress = match[0].replace('https:', 'wss:') + '/collab'; message = '临时公网入口已生成，复制地址到编辑器即可。临时入口重启会变化。'; update(); }
        if (/Registered tunnel connection/.test(text)) { message = '公网隧道已连接'; update(); }
      };
      child.stdout.on('data', onData); child.stderr.on('data', onData);
      child.on('error', () => { if (tunnel === child) tunnel = null; message = '隧道启动失败，请检查工具路径与网络'; update(); });
      child.on('exit', () => { if (tunnel === child) { tunnel = null; message = '公网隧道已停止；本地服务仍可使用'; update(); } });
    } else if (action !== 'state' && action !== 'start') throw new Error('未知操作');
  } catch (error) { message = error instanceof Error ? error.message : String(error); }
  update(); return state();
});
app.whenReady().then(async () => {
  // The sandboxed preload cannot contain type syntax, so ship it as stripped JavaScript written
  // beside the preferences; the source stays typed and the sandbox keeps working.
  const preloadPath = join(app.getPath('userData'), 'preload.cjs');
  writeFileSync(preloadPath, stripTypeScriptTypes(readFileSync(join(here, 'preload.ts'), 'utf8'), { mode: 'strip' }));
  window = new BrowserWindow({ width: 840, height: 760, minWidth: 660, minHeight: 580, show: !smoke, autoHideMenuBar: true, backgroundColor: '#242424', webPreferences: { preload: preloadPath, contextIsolation: true, nodeIntegration: false, sandbox: true } });
  const errors: string[] = []; window.webContents.on('console-message', (details: { level: string; message: string }) => { if (details.level === 'error') errors.push(details.message); });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  // Serve the window's own files. Only `manager-renderer.ts` needs the type-stripping transform;
  // every other asset is returned verbatim with the content type its extension implies.
  const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.ts': 'text/javascript; charset=utf-8' };
  protocol.handle('rpe-server', async request => {
    try {
      const url = new URL(request.url);
      const relative = url.pathname === '/' ? 'manager.html' : decodeURIComponent(url.pathname.slice(1));
      // Contain every request to this directory, so the scheme cannot be used to read elsewhere.
      const path = resolve(here, relative);
      if (!path.startsWith(here + sep)) return new Response('Forbidden', { status: 403 });
      const extension = extname(path);
      const body = await readFile(path, 'utf8');
      return new Response(extension === '.ts' ? stripTypeScriptTypes(body, { mode: 'strip' }) : body, {
        status: 200,
        headers: { 'Content-Type': types[extension] ?? 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' },
      });
    } catch { return new Response('Not found', { status: 404 }); }
  });
  await window.loadURL(`${origin}/manager.html`);
  if (smoke) {
    const module = await import(pathToFileURL(join(here, 'server.ts')).href) as unknown as ServerModule;
    service = await module.startCollaborationServer({ port: 0 });
    const health = await fetch(`http://127.0.0.1:${service!.port}/health`).then(response => response.json()) as { protocol?: number };
    const ui = (await window.webContents.executeJavaScript('({ title: document.title, bridge: typeof window.serverManager?.action, start: Boolean(document.querySelector("#start")), status: document.querySelector("#status")?.textContent })')) as unknown as { title: string; bridge: string; start: boolean; status: string | null };
    await service!.close(); service = null;
    console.log(JSON.stringify({ health, ui, errors })); app.exit(health.protocol === 1 && ui.bridge === 'function' && ui.start && !errors.length ? 0 : 1);
  }
}).catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); app.exit(1); });
let quitting = false;
app.on('before-quit', event => {
  if (quitting) return;
  event.preventDefault(); quitting = true; tunnel?.kill();
  Promise.resolve(service?.close()).catch(() => {}).finally(() => app.quit());
});
app.on('window-all-closed', () => app.quit());
