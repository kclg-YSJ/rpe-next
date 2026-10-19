import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { collaborationConnectSources } from '../src/core/collaboration-policy.ts';

const root = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const port = Number(process.env.RPE_PORT ?? 4173);
const connectSources = collaborationConnectSources(process.env.RPE_MEDIA_ORIGINS);
const mimeTypes: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.ts': 'text/javascript; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ogg': 'audio/ogg', '.ttf': 'font/ttf', '.json': 'application/json' };
const server = createServer(async (request, response) => {
  try {
    if (!['GET', 'HEAD'].includes(request.method!)) { response.writeHead(405); response.end(); return; }
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(request.headers.host!)) { response.writeHead(403); response.end(); return; }
    const pathname = decodeURIComponent(new URL(request.url!, `http://127.0.0.1:${port}`).pathname);
    const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (!(['index.html','styles.css','protocols/MOD-PROTOCOL.zh-CN.md','protocols/GLOBAL-EVENTS-PROTOCOL.zh-CN.md','protocols/EDITOR-SKIN-PROTOCOL.zh-CN.md','schemas/editor-skin-v1.schema.json','schemas/editor-skin-components.v1.json','schemas/mod-v1.schema.json','schemas/mod-api-v1.d.ts'].includes(relative) || relative.startsWith('src/') || relative.startsWith('assets/'))) throw new Error('Unavailable');
    const path = await realpath(resolve(root, relative));
    if (!path.startsWith(root + sep)) throw new Error('Unavailable');
    const content = await readFile(path);
    response.writeHead(200, { 'Content-Type': mimeTypes[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': `default-src 'self'; script-src 'self' blob:; script-src-elem 'self' blob: 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' blob:; media-src blob: data:; connect-src ${connectSources}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'` });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch { response.writeHead(404); response.end('Not found'); }
});
server.on('error', error => { console.error(`启动失败：${error.message}。可设置 RPE_PORT 更换端口。`); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${port}`;
  console.log(`Re:PhiEdit Next: ${url}\nCtrl+C 停止本地服务。`);
  if (process.argv.includes('--open')) {
    const executable = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const argumentsList = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
    const child = spawn(executable, argumentsList, { windowsHide: true, stdio: 'ignore' });
    child.on('error', () => console.log(`请在浏览器打开 ${url}`));
    child.unref();
  }
});
