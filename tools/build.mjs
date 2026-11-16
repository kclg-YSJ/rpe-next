import { mkdir, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createAgentSourceBundle } from '../desktop/agent-source.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'dist');
const pages = process.argv.includes('--pages');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const name of ['src/core', 'src/application', 'src/platform', 'src/ui', 'src/locales', 'src/i18n.mjs', 'assets', 'index.html', 'styles.css', 'manifest.webmanifest', 'pwa-precache.json', 'sw.js', 'LICENSE', 'NOTICE', 'protocols', 'schemas']) {
  await mkdir(join(output, name, '..'), { recursive: true });
  if (pages && name === 'protocols') {
    await mkdir(join(output, name), { recursive: true });
    await cp(join(root, name, 'ANIMATION-CURVES-PROTOCOL.zh-CN.md'), join(output, name, 'ANIMATION-CURVES-PROTOCOL.zh-CN.md'));
    await cp(join(root, name, 'VIDEO-RENDER.zh-CN.md'), join(output, name, 'VIDEO-RENDER.zh-CN.md'));
    for (const protocol of ['EDITOR-SKIN', 'MOD', 'GLOBAL-EVENTS', 'AI-AGENT']) await cp(join(root, name, protocol + '-PROTOCOL.zh-CN.md'), join(output, name, protocol + '-PROTOCOL.zh-CN.md'));
    await cp(join(root, name, 'CHART-VERSION-CONTROL.zh-CN.md'), join(output, name, 'CHART-VERSION-CONTROL.zh-CN.md'));
    await cp(join(root, name, 'AUDIO-SEPARATION.zh-CN.md'), join(output, name, 'AUDIO-SEPARATION.zh-CN.md'));
  } else await cp(join(root, name), join(output, name), { recursive: true });
}
await writeFile(join(output, '.nojekyll'), '');
await writeFile(join(output, 'assets/agent-source.json'), JSON.stringify(await createAgentSourceBundle(root)));
const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
let commit = '';
try { commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(); } catch { /* builds without git still work */ }
const serviceWorker = await readFile(join(output, 'sw.js'), 'utf8');
await writeFile(join(output, 'sw.js'), serviceWorker.replace("const VERSION = 'rpe-next-v1';", `const VERSION = 'rpe-next-${metadata.version}${commit ? `-${commit}` : ''}';`));
if (!pages) {
  for (const name of ['start.cmd', 'README.md', 'README.en.md', 'GUIDE.zh-CN.md', 'screenshots']) await cp(join(root, name), join(output, name), { recursive: true });
  await mkdir(join(output, 'collaboration-server'), { recursive: true });
  await cp(join(root, 'collaboration-server/README.md'), join(output, 'collaboration-server/README.md'));
  await mkdir(join(output, 'tools'), { recursive: true });
  await cp(join(root, 'tools/serve.mjs'), join(output, 'tools/serve.mjs'));
  metadata.scripts = { start: 'node tools/serve.mjs --open', serve: 'node tools/serve.mjs' };
  await writeFile(join(output, 'package.json'), JSON.stringify(metadata, null, 2) + '\n');
  console.log('dist/ 已生成，可复制后用 Node.js 22+ 和现代浏览器运行。');
} else console.log('dist/ 静态网站已生成，仅包含运行文件、内置素材及许可声明。');
