/*
 * Stages the static web build for the Android shell.
 *
 * 1. copies rpe-next-main/dist into www/
 * 2. adds the blob-save bridge used on Android
 * 3. injects the bridge <script> before the editor module
 * 4. replaces the viewport with a wide, scaled-down desktop layout
 *
 * Why the viewport change: the editor is a desktop UI whose own breakpoints (<=900px,
 * <=700px) reflow the header and transport into extra rows. On a phone in landscape the
 * CSS viewport is only ~360px tall, so that reflow pushes the note timeline to 0px height
 * and there is nowhere to tap. Declaring a ~1280px layout width makes Chrome scale the whole
 * desktop layout down to fit the screen instead: one-row chrome plus a real timeline again.
 *
 * Run: node tools/patch-web.mjs
 */
import { cp, readFile, rm, writeFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('../', import.meta.url));
const dist = resolve(here, '../dist');
const www = resolve(here, 'www');
const bridge = resolve(here, 'app-shell/native-bridge.js');

// Layout width the editor is designed for. Chrome scales this to the device width, so the
// effective CSS height grows as the screen gets shorter (a 16:9 phone gets ~720 CSS px tall).
const LAYOUT_WIDTH = 1280;

await access(join(dist, 'index.html'));

await rm(www, { recursive: true, force: true });
await cp(dist, www, { recursive: true });

const bridgeSource = await readFile(bridge, 'utf8');
await writeFile(join(www, 'native-bridge.js'), bridgeSource);

const index = join(www, 'index.html');
let html = await readFile(index, 'utf8');
const marker = '<script type="module" src="./src/ui/app.mjs"></script>';
if (!html.includes(marker)) throw new Error('index.html 结构与预期不符，找不到编辑器入口脚本');
if (!html.includes('native-bridge.js')) {
  html = html.replace(marker, '<script src="./native-bridge.js"></script>' + marker);
}

const viewportPattern = /<meta name="viewport"[^>]*>/;
if (!viewportPattern.test(html)) throw new Error('index.html 中找不到 viewport 声明');
html = html.replace(viewportPattern,
  `<meta name="viewport" content="width=${LAYOUT_WIDTH}, minimum-scale=0.2, maximum-scale=3, user-scalable=yes">`);

await writeFile(index, html);

console.log(`www/ 已就绪：${www}（布局宽度 ${LAYOUT_WIDTH}px）`);
