import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { access } from 'node:fs/promises';
import { preview } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
await access(join(root, 'dist', 'index.html')).catch(() => { throw new Error('dist/ 不存在，请先运行 npm run build。'); });

// Driving the preview server through Vite's JS API instead of spawning its CLI keeps this check
// identical whichever runtime executes it (node or bun), and needs no readiness polling or port
// guessing: preview() resolves once the server is listening and reports the URL it bound.
const server = await preview({ root, logLevel: 'warn' });
const origin = server.resolvedUrls?.local?.[0]?.replace(/\/$/, '');
if (!origin) { await server.close(); throw new Error('无法确定预览服务器地址'); }
const get = (path: string): Promise<Response> => fetch(`${origin}${path}`);
try {
  const html = await (await get('/')).text();
  const script = html.match(/src="([^"]+\.js)"/)?.[1];
  const style = html.match(/href="([^"]+\.css)"/)?.[1];
  if (!script || !style) throw new Error('入口页面没有引用打包后的脚本与样式');

  for (const path of ['/', script, style, '/assets/rpe/Texture/Tap2.png', '/assets/rpe/fonts/cmdysj.ttf', '/assets/rpe/SE/tap.ogg', '/assets/easing/29.svg']) {
    const response = await get(path);
    if (response.status !== 200 || !(await response.arrayBuffer()).byteLength) throw new Error(`${path} 不可读取`);
    if (path.endsWith('.svg') && !response.headers.get('content-type')?.includes('image/svg+xml')) throw new Error('缓动 SVG 类型错误');
  }
  // The bundle must replace the raw sources; a served module means the build leaked them.
  if ((await get('/src/ui/app.ts')).status === 200) throw new Error('构建产物暴露了未打包的源码');
  console.log('dist 入口、打包脚本与样式、内置素材读取通过；未暴露源码。');
} finally {
  await server.close();
}
