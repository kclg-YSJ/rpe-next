import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { parseEditorSkin, compileEditorSkin, resolveEditorSkin, editorSkinSelector, editorSkinPath, EDITOR_SKIN_COMPONENTS, EDITOR_SKIN_LIMITS, EDITOR_SKIN_API } from '../src/core/editor-skin.mjs';
import { EDITOR_SKIN_DEFAULT_TOKENS } from '../src/ui/editor-skin-base.mjs';
import { importEditorSkin, exportEditorSkin, builtinEditorSkins } from '../src/platform/editor-skins.mjs';
import { editorSkinContext, setEditorCanvasSkin } from '../src/ui/editor-skin-canvas.mjs';
import { readZip, writeZip } from '../src/platform/archive.ts';
import { editorSkinFixture } from './fixtures/editor-skin.mjs';

const encode = value => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));
const manifest = () => ({ protocol: 'rpen-editor-skin', version: 1, id: 'example', name: '测试皮肤' });
const record = (skin, extra = []) => parseEditorSkin(new Map([['skin.json', encode(skin)], ...extra]));
test('协议测试数据可打包、导入并往返导出', async () => {
  const original = editorSkinFixture();
  const archive = exportEditorSkin(original);
  const imported = await importEditorSkin([new File([archive], 'test-skin.rpenskin')]);
  assert.deepEqual(imported.skin, original.skin);
  assert.deepEqual(imported.files, original.files);
  const directory = await importEditorSkin([...original.files].map(([path, bytes]) => ({ name: path.split('/').at(-1), webkitRelativePath: 'Fixture/' + path, size: bytes.length, arrayBuffer: async () => bytes.buffer })), true);
  assert.deepEqual(directory.files, original.files);
  assert.ok(!JSON.parse(await readFile(new URL('../assets/editor-skins/index.json', import.meta.url))).some(entry => entry.directory === original.skin.id));
});

test('Inkline 内置资源完整且可以直接加载，保留作者、颜色参数与字体', async context => {
  context.mock.method(globalThis, 'fetch', async url => new Response(await readFile(new URL(url))));
  const skins = await builtinEditorSkins();
  assert.deepEqual(skins.map(record => record.skin.id), ['inkline']);
  const skin = skins[0]; assert.equal(skin.builtin, true);
  assert.equal(skin.skin.name, '墨线 Inkline'); assert.equal(skin.skin.author, 'cmdysj'); assert.equal(skin.skin.compatibility.minApi, 3);
  const directory = new URL('../assets/editor-skins/inkline/', import.meta.url);
  const files = await readdir(directory, { recursive: true, withFileTypes: true });
  assert.equal(files.filter(entry => entry.isFile()).length, skin.files.size);
  assert.ok(skin.files.get('fonts/ui.woff').length > 0);
  const resolved = resolveEditorSkin(skin.skin, { parameters: { 'event-fill': '#123456' } });
  assert.equal(resolved.canvas.palette['#e58d24'], '#123456');
  assert.equal(skin.skin.canvas.palette['#e58d24'], 'parameter(event-fill)');
});

test('生成的机器可读目录与运行时约定一致', async () => {
  const catalogue = JSON.parse(await readFile(new URL('../schemas/editor-skin-components.v1.json', import.meta.url)));
  assert.deepEqual(catalogue.aliases, EDITOR_SKIN_COMPONENTS);
  assert.deepEqual(catalogue.tokens, EDITOR_SKIN_DEFAULT_TOKENS);
  assert.ok(catalogue.panels.includes('noise-properties'));
  assert.equal(catalogue.aliases['beat-display'], '#beat-display'); assert.equal(catalogue.aliases.clock, '#clock');
  assert.ok(catalogue.movableCommands.includes('time-readouts'));
  const schema = JSON.parse(await readFile(new URL('../schemas/editor-skin-v1.schema.json', import.meta.url)));
  assert.equal(schema.properties.version.const, 1);
});

test('作用域、含逗号的伪类、伪元素和素材宏均正确生成，图标可由主题样式进一步覆盖', () => {
  const skin = { ...manifest(), assets: { icon: { type: 'image', path: 'i.svg' }, ui: { type: 'font', path: 'ui.woff2' } },
    tokens: { 'font-family': 'font(ui)' }, icons: { save: 'icon' },
    motions: { enter: { from: { opacity: '0' }, to: { opacity: '1' } } },
    styles: [{ selector: '@save::before,@open:not(.active,[disabled])::after', set: { content: 'asset(icon)', animation: 'motion(enter) 100ms ease' } }],
  };
  record(skin, [['i.svg', encode('<svg/>')], ['ui.woff2', encode('font')]]);
  const css = compileEditorSkin(skin, { images: new Map([['icon', 'blob:local-test']]), fonts: new Map([['ui', 'skin-example-ui']]) });
  assert.ok(css.includes(':root[data-editor-skin="example"] #save::before,:root[data-editor-skin="example"] #open:not(.active,[disabled])::after'));
  assert.ok(css.includes('content:url("blob:local-test")'));
  assert.ok(css.includes('--rpen-font-family:"skin-example-ui"'));
  assert.ok(css.includes('@keyframes rpen-example-enter'));
  assert.ok(css.includes('animation:rpen-example-enter 100ms ease'));
  assert.ok(!css.includes(':is(#save::before'));
  assert.ok(css.includes('prefers-reduced-motion:reduce'));
  assert.equal(editorSkinSelector('@header > @save'), 'header > #save');
  assert.throws(() => editorSkinSelector('@constructor'), /未知组件/);
});

test('拒绝跨目录、未声明文件、冲突大小写和不支持的包版本', () => {
  for (const path of ['../skin.json', '/skin.json', 'C:/skin.json', 'a\\b.png', 'a//b', 'a/./b', 'a?b', 'a#b']) assert.throws(() => editorSkinPath(path));
  assert.throws(() => record({ ...manifest(), version: 2 }), /version=1/);
  assert.throws(() => record({ ...manifest(), id: 'default' }), /id/);
  assert.throws(() => record({ ...manifest(), id: ['valid'] }), /id/);
  assert.throws(() => record(manifest(), [['run.js', encode('alert(1)')]]), /未声明/);
  assert.throws(() => record(manifest(), [['a.png', encode('x')], ['A.png', encode('x')]]), /大小写/);
  assert.throws(() => record({ ...manifest(), assets: { x: { type: 'script', path: 'x.js' } } }), /类型/);
});

test('皮肤声明不能包含主动代码、远程资源或样式注入', () => {
  for (const value of ['url(https://example.test/image)', 'URL(data:image/svg+xml,x)', 'red;position:fixed', 'red!important', 'var(--x)/*x*/', 'expression(alert(1))', 'image-set("x" 1x)', 'attr(title)', 'env(x)', 'red\\3b', 'https://example.test']) {
    assert.throws(() => record({ ...manifest(), styles: [{ selector: '@header', set: { background: value } }] }), /CSS/);
  }
  for (const selector of ['body{color:red}', 'a:visited', ':host', 'iframe', 'rpen-skin-recovery']) assert.throws(() => record({ ...manifest(), styles: [{ selector, set: { color: 'red' } }] }));
  assert.throws(() => record({ ...manifest(), styles: [{ selector: 'body', set: { all: 'unset' } }] }), /CSS 属性/);
});

test('素材引用、布局白名单和分组唯一性在应用前验证', () => {
  assert.throws(() => record({ ...manifest(), tokens: { background: 'asset(missing)' } }), /引用不存在/);
  assert.throws(() => record({ ...manifest(), styles: [{ selector: '@header', set: { animation: 'motion(constructor) 1s' } }] }), /引用不存在/);
  assert.throws(() => record({ ...manifest(), organize: [{ slot: 'file-actions', items: ['stage'] }] }), /不可移动/);
  assert.throws(() => record({ ...manifest(), organize: [{ slot: 'file-actions', items: ['save', 'save'] }] }), /重复/);
  assert.throws(() => record({ ...manifest(), organize: [{ slot: 'file-actions', label: '组', items: ['save'] }] }), /需要 id/);
  assert.throws(() => record({ ...manifest(), organize: [{ slot: 'file-actions', id: 'group', collapsible: true, items: ['save'] }] }), /label/);
  assert.throws(() => record({ ...manifest(), canvas: { fontScale: 2 } }), /fontScale/);
});

test('hide 支持组件与状态选择器，逐个作用域隔离且覆盖普通显示规则', () => {
  const skin = { ...manifest(), hide: ['@migrate,@recover', '@toolbar .tools button[data-tool="4"]'], styles: [{ selector: '@migrate', set: { display: 'block' } }] };
  record(skin);
  const css = compileEditorSkin(skin);
  assert.ok(css.includes(':root[data-editor-skin="example"] #migrate,:root[data-editor-skin="example"] #recover{display:none!important'));
  assert.ok(css.includes(':root[data-editor-skin="example"] .editor-toolbar .tools button[data-tool="4"]{display:none!important'));
  assert.ok(css.indexOf('display:none!important') > css.indexOf('display:block'));
  assert.throws(() => record({ ...manifest(), hide: '@migrate' }), /hide/);
  assert.throws(() => record({ ...manifest(), hide: Array(301).fill('@migrate') }), /300/);
  assert.throws(() => record({ ...manifest(), hide: ['@unknown'] }), /未知组件/);
  assert.throws(() => record({ ...manifest(), hide: ['rpen-skin-recovery'] }), /选择器/);
});

test('响应式变量、根状态、完整条件规则、属性注册与受限优先级均可编译', () => {
  const skin = { ...manifest(), compatibility: { minApi: 2, maxApi: EDITOR_SKIN_API }, properties: { '--skin-example-progress': { syntax: '<number>', inherits: false, initialValue: '0' } }, styles: [
    { media: '(width <= 900px), (aspect-ratio < 4/3)', rules: [{ selector: '@root[data-rpen-playing=true],html[data-rpen-dirty=true]', set: { '--rpen-inspector-width': '280px', 'color-scheme': 'light' } }] },
    { container: '(width <= 360px)', rules: [{ supports: '(display: grid)', rules: [{ selector: '@panel-title', set: { padding: '8px' }, important: ['padding'] }] }] },
    { startingStyle: true, rules: [{ selector: '@inspector', set: { opacity: '0' } }] },
  ] };
  record(skin); const css = compileEditorSkin(skin);
  assert.ok(css.includes(':root[data-editor-skin="example"][data-rpen-playing=true]'));
  assert.ok(!css.includes('[data-editor-skin="example"] :root'));
  assert.ok(css.includes('@container (width <= 360px){@supports (display: grid)'));
  assert.ok(css.includes('padding:8px!important'));
  assert.ok(css.includes('@starting-style{'));
  assert.ok(css.includes('@property --skin-example-progress{syntax:"<number>";inherits:false;initial-value:0}'));
  assert.throws(() => record({ ...manifest(), styles: [{ selector: '@header', set: { display: 'block' }, important: ['display'] }] }), /important/);
  assert.throws(() => record({ ...manifest(), styles: [{ container: '(width:1px){}body', rules: [] }] }), /条件/);
  assert.throws(() => record({ ...manifest(), styles: [{ media: 'screen', supports: '(display:grid)', rules: [] }] }), /一种条件/);
  assert.throws(() => record({ ...manifest(), compatibility: { minApi: EDITOR_SKIN_API + 1 } }), /不兼容/);
});

test('可调参数和同包变体可独立解析，声明内置图标和高 DPI 素材不要求复制应用资源', () => {
  const skin = { ...manifest(), assets: { save: { type: 'image', builtin: 'save' }, picture: { type: 'image', path: 'i.svg', sources: [{ path: 'i2.svg', scale: 2 }] } }, preview: 'picture',
    parameters: { width: { type: 'number', label: '宽度', min: 200, max: 500, default: 300, unit: 'px' }, accent: { type: 'color', label: '颜色', default: '#123456' } },
    tokens: { 'inspector-width': 'parameter(width)' }, variants: { light: { name: '日间', colorScheme: 'light', tokens: { surface: '#ffffff' } }, dark: { name: '夜间', colorScheme: 'dark', tokens: { surface: '#111111' } } }, systemVariants: { light: 'light', dark: 'dark' },
    icons: [{ selector: '@play[data-playing=true]', asset: 'save' }], decorations: [{ id: 'mark', selector: '@header', asset: 'picture', placement: 'append' }],
  };
  record(skin, [['i.svg', encode('<svg/>')], ['i2.svg', encode('<svg/>')]]);
  const resolved = resolveEditorSkin(skin, { variant: 'dark', parameters: { width: 999, accent: '#abcdef' } });
  assert.equal(resolved.tokens['param-width'], '500px'); assert.equal(resolved.tokens['param-accent'], '#abcdef'); assert.equal(resolved.tokens.surface, '#111111');
  const css = compileEditorSkin(resolved, { images: new Map([['save', 'blob:save']]) });
  assert.ok(css.includes('--rpen-inspector-width:var(--rpen-param-width)'));
  assert.ok(css.includes('#play[data-playing=true]'));
  assert.throws(() => record({ ...manifest(), assets: { save: { type: 'image', builtin: 'not-registered' } } }), /内置素材/);
  assert.throws(() => record({ ...manifest(), preview: 'missing' }), /preview/);
  assert.throws(() => resolveEditorSkin(skin, { variant: 'missing' }), /变体不存在/);
});

test('画布色板可引用颜色参数，解析后交给绘制器的仍是 #rrggbb', () => {
  const parameters = { fill: { type: 'color', label: '底色', default: '#123456' }, undefined: { type: 'color', label: '干扰项', default: '#999999' }, size: { type: 'number', label: '尺寸', min: 0, max: 9, default: 1 } };
  const skin = { ...manifest(), parameters, canvas: { palette: { '#e58d24': 'parameter(fill)', '#ffffff': '#010203' }, targets: { events: { palette: { '#ffa334': 'parameter(fill)' } } } },
    variants: { night: { name: '夜间', canvas: { palette: { '#303030': 'parameter(fill)' } } } } };
  record(skin);
  const base = resolveEditorSkin(skin, { parameters: { fill: '#abcdef' } }).canvas;
  assert.deepEqual(base.palette, { '#e58d24': '#abcdef', '#ffffff': '#010203' }); assert.equal(base.targets.events.palette['#ffa334'], '#abcdef');
  assert.equal(resolveEditorSkin(skin, { parameters: { fill: 'red' } }).canvas.palette['#e58d24'], '#123456');
  assert.equal(resolveEditorSkin(skin, { variant: 'night' }).canvas.palette['#303030'], '#123456');
  assert.throws(() => record({ ...skin, canvas: { palette: { '#e58d24': 'parameter(size)' } } }), /颜色参数/);
  assert.throws(() => record({ ...skin, canvas: { palette: { '#e58d24': 'parameter(missing)' } } }), /颜色参数/);
  assert.throws(() => record({ ...skin, variants: { night: { name: '夜间', canvas: { targets: { notes: { palette: { '#e58d24': 'var(--x)' } } } } } } }), /#rrggbb/);
});

test('分区画布映射处理离屏、渐变、虚线和绘制参数，保持上下文状态与预览隔离', () => {
  const draws = []; const stops = []; const context = { canvas: {}, fillStyle: '', strokeStyle: '', globalAlpha: .8, lineWidth: 2, dash: [],
    fillRect() { draws.push({ color: this.fillStyle, alpha: this.globalAlpha, width: this.lineWidth }); },
    setLineDash(values) { this.dash = values; }, createLinearGradient() { return { addColorStop(position, color) { stops.push([position, color]); } }; },
  };
  try {
    setEditorCanvasSkin({ palette: { '#ffffff': '#aaaaaa' }, targets: { density: { palette: { '#ffffff': '#112233' }, opacity: .5, lineWidthScale: 2, lineDash: [1, 2] }, history: { palette: { '#ffffff': '#445566' } } } });
    const density = editorSkinContext(context, 'density'); density.fillStyle = '#fff'; density.fillRect(0, 0, 1, 1);
    assert.deepEqual(draws[0], { color: '#112233', alpha: .4, width: 4 }); assert.equal(context.globalAlpha, .8); assert.equal(context.lineWidth, 2);
    density.setLineDash([5, 3]); assert.deepEqual(context.dash, [1, 2]); density.setLineDash([]); assert.deepEqual(context.dash, []);
    density.createLinearGradient(0, 0, 1, 1).addColorStop(.5, '#ffffff'); assert.deepEqual(stops[0], [.5, '#112233']);
    editorSkinContext(context, 'history').fillStyle = '#fff'; assert.equal(context.fillStyle, '#445566');
    const preview = { canvas: { id: 'preview' } }; assert.equal(editorSkinContext(preview, 'density'), preview);
  } finally { setEditorCanvasSkin(null); }
});

test('解压及目录导入在资源分配前执行大小与数量上限', async () => {
  const files = new Map([['skin.json', encode(manifest())], ['large.bin', new Uint8Array(100)]]);
  const zip = await writeZip(files).arrayBuffer();
  await assert.rejects(readZip(zip, { maxFiles: 1 }), /数量超限/);
  await assert.rejects(readZip(zip, { maxBytes: 99 }), /大小超限/);
  await assert.rejects(readZip(zip, { maxFileBytes: 90 }), /大小超限/);
  let read = false;
  await assert.rejects(importEditorSkin([{ name: 'x', size: EDITOR_SKIN_LIMITS.fileBytes + 1, arrayBuffer() { read = true; } }], true), /大小超限/);
  assert.equal(read, false);
  const wrapped = new Map([['skin/skin.json', encode(manifest())], ['outside.txt', encode('x')]]);
  await assert.rejects(importEditorSkin([new File([writeZip(wrapped)], 'skin.zip')]), /根目录以外/);
});

test('编辑画布色板保留 alpha，刷新映射且不改变播放预览或原始上下文', () => {
  const context = { canvas: { id: 'notes' }, fillStyle: '', font: '', measureText(text) { return { width: this === context ? text.length : -1 }; } };
  const preview = { canvas: { id: 'preview' } }; const realtime = { canvas: { id: 'realtime-preview' } };
  try {
    setEditorCanvasSkin(null); assert.equal(editorSkinContext(context), context);
    setEditorCanvasSkin({ palette: { '#FFFFFF': '#123456' }, fontScale: 1.2 }, 'custom-ui');
    const proxy = editorSkinContext(context);
    assert.notEqual(proxy, context); assert.equal(editorSkinContext(preview), preview); assert.equal(editorSkinContext(realtime), realtime);
    proxy.fillStyle = 'rgba(255,255,255,0.4)'; assert.equal(context.fillStyle, 'rgba(18,52,86,0.4)');
    proxy.fillStyle = '#fff'; assert.equal(context.fillStyle, '#123456');
    proxy.fillStyle = '#ffffff80'; assert.ok(context.fillStyle.startsWith('rgba(18,52,86,0.5019'));
    proxy.font = 'bold 10px RPE, sans-serif'; assert.equal(context.font, 'bold 12px "custom-ui", sans-serif');
    assert.equal(proxy.measureText('abc').width, 3);
    setEditorCanvasSkin({ palette: { '#ffffff': '#654321' } }); proxy.fillStyle = '#fff'; assert.equal(context.fillStyle, '#654321');
    setEditorCanvasSkin(null); proxy.fillStyle = '#fff'; assert.equal(context.fillStyle, '#fff'); assert.equal(editorSkinContext(context), context);
  } finally { setEditorCanvasSkin(null); }
});
