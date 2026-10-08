import { cp, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { build } from 'vite';

if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('当前打包脚本需要在 Windows x64 上运行。');
const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const runtime = dirname(require('electron'));
const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15).replace('T', '-');
const output = join(root, 'release', `rpe-next-${metadata.version}-win-x64-${stamp}`);

// The desktop shell serves the Vite build verbatim, so rebuild it here rather than packaging a
// stale dist/ from an earlier run. Going through Vite's JS API keeps this identical under node and
// bun, with no dependency on how the CLI happens to be launched.
await build({ root });

await mkdir(output, { recursive: true });
await cp(runtime, output, { recursive: true, filter: path => !path.endsWith('default_app.asar') });
await rename(join(output, 'electron.exe'), join(output, 'RePhiEdit-Next.exe'));
const application = join(output, 'resources', 'app');
await mkdir(application, { recursive: true });
// desktop/main.cjs serves resources/app itself as the site root, so the Vite output has to land
// directly there — packaging it under a nested dist/ would 404 every request.
await cp(join(root, 'dist'), application, { recursive: true });
await cp(join(root, 'desktop'), join(application, 'desktop'), { recursive: true });
// `desktop/main.cjs` builds its Content-Security-Policy with `collaborationConnectSources`, which it
// imports from the source tree. The Vite output carries no source tree of its own, so that one
// dependency-free module is copied in at the path the shell resolves it from. Everything else the
// renderer needs is already bundled into dist/.
const policy = join(application, 'src', 'core');
await mkdir(policy, { recursive: true });
await cp(join(root, 'src', 'core', 'collaboration-policy.mjs'), join(policy, 'collaboration-policy.mjs'));
await writeFile(join(application, 'package.json'), JSON.stringify({
  name: metadata.name, version: metadata.version, author: metadata.author, license: metadata.license,
  description: metadata.description, main: 'desktop/main.cjs'
}, null, 2) + '\n');
await writeFile(join(output, '使用说明.txt'), '\uFEFF' + [
  'Re:PhiEdit Next — Windows x64 桌面测试版',
  '作者：cmdysj。在原 Re:PhiEdit（RPE）基础上，使用 AI（GPT）重构。',
  '',
  '解压整个文件夹，双击 RePhiEdit-Next.exe；无需另装 Node.js 或浏览器。',
  '请保留同目录下全部文件，不能单独移动 exe。',
  '谱面、配置和自动备份保存在 %APPDATA%\\rpe-next-desktop。',
  '桌面版与网页版谱面库独立；可导入 PEZ 或在谱面库迁移原 RPE 文件夹。',
  '退出前请保存，建议定期导出 PEZ 备份。',
  '测试包未进行代码签名。仅限非商业用途，详见 resources/app/LICENSE 和 NOTICE。',
  '', `构建时间：${new Date().toISOString()}`
].join('\r\n'));
const permissions = spawnSync('icacls.exe', [output, '/grant', '*S-1-15-2-1:(OI)(CI)(RX)', '/T', '/Q'], { windowsHide: true, encoding: 'utf8' });
if (permissions.status !== 0) throw new Error(permissions.stderr || permissions.stdout || '无法配置桌面包的沙箱读取权限');
console.log(output);
