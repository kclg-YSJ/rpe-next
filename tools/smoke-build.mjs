import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const directory = fileURLToPath(new URL('../dist/', import.meta.url));
const port = 4174;
const child = spawn(process.execPath, ['tools/serve.mjs'], { cwd: directory, windowsHide: true, env: { ...process.env, RPE_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
child.stdout.on('data', data => { output += data; });
child.stderr.on('data', data => { output += data; });
try {
  for (let attempt = 0; attempt < 50 && !output.includes('Re:PhiEdit Next:'); attempt++) {
    if (child.exitCode !== null) throw new Error(output || '构建产物启动失败');
    await delay(100);
  }
  if (!output.includes('Re:PhiEdit Next:')) throw new Error('构建产物启动超时');
  for (const path of ['/', '/styles.css', '/src/ui/app.mjs', '/src/ui/help.mjs', '/src/core/scene.mjs', '/src/ui/line-dialog.mjs', '/src/ui/event-interaction.mjs', '/src/ui/event-inspector.mjs', '/src/platform/hitsounds.mjs', '/assets/rpe/Texture/Tap2.png', '/assets/rpe/fonts/cmdysj.ttf', '/assets/rpe/SE/tap.ogg']) {
    const response = await fetch(`http://127.0.0.1:${port}${path}`);
    if (response.status !== 200 || !(await response.text()).length) throw new Error(`${path} 不可读取`);
  }
  const denied = await fetch(`http://127.0.0.1:${port}/docs/original-baseline.json`);
  for (const path of ['/src/ui/home.mjs', '/src/ui/settings.mjs', '/src/application/autosave.mjs', '/src/core/editor-display.mjs', '/src/platform/recovery.mjs', '/src/platform/thumbnail.mjs', '/src/application/playback.mjs', '/src/core/edit-grid.mjs', '/src/platform/editor-preferences.mjs', '/assets/rpe/Texture/img-31.png', '/assets/rpe/Texture/NoiseDomain/BlockNoise1.png', '/assets/easing/29.svg']) {
    const response = await fetch(`http://127.0.0.1:${port}${path}`);
    if (response.status !== 200 || !(await response.arrayBuffer()).byteLength) throw new Error(`${path} 不可读取`);
    if (path.endsWith('.svg') && !response.headers.get('content-type')?.includes('image/svg+xml')) throw new Error('缓动 SVG 类型错误');
  }
  if (denied.status !== 404) throw new Error('服务暴露了允许列表之外的文件');
  console.log('dist 启动、入口及模块读取通过；服务允许列表生效。');
} finally {
  child.kill();
}
