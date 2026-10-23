import { mkdir, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'dist');
const pages = process.argv.includes('--pages');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const name of ['src/core', 'src/application', 'src/platform', 'src/ui', 'src/locales', 'src/i18n.mjs', 'assets', 'index.html', 'styles.css', 'LICENSE', 'NOTICE', 'protocols', 'schemas']) {
  await mkdir(join(output, name, '..'), { recursive: true });
  if (pages && name === 'protocols') {
    await mkdir(join(output, name), { recursive: true });
    for (const protocol of ['EDITOR-SKIN', 'MOD', 'GLOBAL-EVENTS']) await cp(join(root, name, protocol + '-PROTOCOL.zh-CN.md'), join(output, name, protocol + '-PROTOCOL.zh-CN.md'));
    await cp(join(root, name, 'CHART-VERSION-CONTROL.zh-CN.md'), join(output, name, 'CHART-VERSION-CONTROL.zh-CN.md'));
  } else await cp(join(root, name), join(output, name), { recursive: true });
}
await writeFile(join(output, '.nojekyll'), '');
if (!pages) {
  for (const name of ['start.cmd', 'README.md']) await cp(join(root, name), join(output, name));
  await mkdir(join(output, 'tools'), { recursive: true });
  await cp(join(root, 'tools/serve.mjs'), join(output, 'tools/serve.mjs'));
  const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  metadata.scripts = { start: 'node tools/serve.mjs --open', serve: 'node tools/serve.mjs' };
  await writeFile(join(output, 'package.json'), JSON.stringify(metadata, null, 2) + '\n');
  console.log('dist/ 已生成，可复制后用 Node.js 22+ 和现代浏览器运行。');
} else console.log('dist/ 静态网站已生成，仅包含运行文件、内置素材及许可声明。');
