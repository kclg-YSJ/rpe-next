import { cp, mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
if (process.platform !== 'win32') throw new Error('当前服务端 GUI 打包脚本需要 Windows');
const require = createRequire(import.meta.url);
const output = join(root, 'release', `rpe-collaboration-server-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15).replace('T', '-')}`);
await mkdir(output, { recursive: true });
await cp(dirname(require('electron')), output, { recursive: true, filter: path => !path.endsWith('default_app.asar') });
await rename(join(output, 'electron.exe'), join(output, 'RPE-Collaboration-Server.exe'));
const application = join(output, 'resources', 'app');
// `src/core` is copied wholesale rather than listed file by file: the server's imports there form a
// self-contained closure (no relative import in `src/core` points outside it), and those modules are
// TypeScript, which Electron's main process type-strips on load just as Node does.
const serverFiles = ['server.mjs', 'asset-store.mjs', 'manager.cjs', 'preload.cjs', 'manager.html', 'manager.css', 'manager.js', 'package.json', 'README.md', 'node_modules/ws'];
for (const name of [...serverFiles.map(name => `collaboration-server/${name}`), 'src/core', 'LICENSE', 'NOTICE']) { await mkdir(dirname(join(application, name)), { recursive: true }); await cp(join(root, name), join(application, name), { recursive: true }); }
await cp(join(root, 'collaboration-server/README.md'), join(output, 'README.md'));
await writeFile(join(application, 'package.json'), JSON.stringify({ name: 'rpe-next-collaboration-server', version: '0.1.0', main: 'collaboration-server/manager.cjs', author: 'cmdysj', license: 'PolyForm-Noncommercial-1.0.0' }));
const permissions = spawnSync('icacls.exe', [output, '/grant', '*S-1-15-2-1:(OI)(CI)(RX)', '/T', '/Q'], { windowsHide: true });
if (permissions.status !== 0) throw new Error('无法设置服务器工具读取权限');
console.log(output);
