import test from 'node:test';
import assert from 'node:assert/strict';
import { noiseLayers, noiseLayerId, withNoiseLayers, validateNoiseLayers, parseNoiseSkin, noiseSkinAuthor, noiseSkinLabel, skinParameters, skinTextures, skinPath, skinSize, maskWord } from '../src/core/noise-skin.mjs';
import { createChart, parseChart, serializeChart } from '../src/core/chart.ts';
import { createNoiseArea } from '../src/core/noise-areas.ts';
import { packageEntries, legacyChart } from '../src/platform/files.ts';
import { normalizeEditorPreferences } from '../src/platform/editor-preferences.ts';
import { noiseSkinModified, rememberedNoiseSkinSettings, switchNoiseSkin, updateNoiseSkinSettings } from '../src/core/noise-skin.mjs';
import { EditorSession } from '../src/application/session.ts';

const main = 'precision highp float; varying highp vec2 uv; uniform float touchReleaseDuration; // %0.1% 0..1\nuniform vec4 tint; // %1,0,0,1% 0..1\nvoid main(){gl_FragColor=tint;}';
const files = config => new Map([['main.glsl', main], ...(config ? [['config.json', JSON.stringify(config)]] : [])]);

test('旧谱面隐式默认层和显式层数据往返', () => {
  const chart = createChart(); chart.blockAreaList = [createNoiseArea()];
  assert.equal(noiseLayers(chart)[0].id, noiseLayerId(chart.blockAreaList[0]));
  chart.noiseAreaLayers = [{ id: 'default', name: '默认层', skin: 'shader/Test', parameters: { tint: [0,1,0,1] }, channel: 'low' }];
  assert.equal(withNoiseLayers(chart,chart.noiseAreaLayers).META.RPEVersion,230);
  const result = parseChart(serializeChart(chart));
  assert.equal(result.META.RPEVersion, 230); assert.deepEqual(result.noiseAreaLayers, chart.noiseAreaLayers);
  assert.throws(() => validateNoiseLayers({ ...chart, noiseAreaLayers: [] }), /至少/);
  assert.throws(() => validateNoiseLayers({ ...chart, blockAreaList: [{ ...chart.blockAreaList[0], layerId: 'missing' }] }), /不存在/);
  assert.throws(() => validateNoiseLayers({ ...chart, noiseAreaLayers: [{ id:'default', name:'X', channel:'other' }] }), /通道/);
  assert.throws(() => validateNoiseLayers({ ...chart, noiseAreaLayers: [{ id:'default', name:'X', parameters:{touchReleaseDuration:-1} }] }), /负数/);
});

test('皮肤参数声明、范围与必需参数校验', () => {
  assert.equal(skinParameters(main).length, 2);
  assert.throws(() => skinParameters(main.replace('%0.1%', '%-1%')), /范围|非负/);
  assert.throws(() => skinParameters(main.replace('0..1', '2..1')), /范围/);
  assert.throws(() => skinParameters('void main(){}'), /touchReleaseDuration/);
  assert.throws(() => skinParameters(main+'\nuniform float time; // %0%'), /保留/);
});

test('皮肤作者从 config 读取并安全显示，旧皮肤未填作者仍兼容', () => {
  const configured = files({ version: 1, author: '  Stellate  ', targets: {}, passes: [{ shader: 'main.glsl', output: '$screen' }] });
  assert.equal(parseNoiseSkin(configured).author, 'Stellate'); assert.equal(noiseSkinAuthor(configured), 'Stellate');
  assert.equal(noiseSkinLabel('Ocean', noiseSkinAuthor(configured)), 'Ocean(Stellate)');
  assert.equal(parseNoiseSkin(files()).author, ''); assert.equal(noiseSkinLabel('Custom', '   '), 'Custom');
  const malicious = '<img src=x onerror=alert(1)>';
  assert.equal(noiseSkinLabel('Test', malicious), `Test(${malicious})`);
  assert.throws(() => parseNoiseSkin(files({ version: 1, author: {}, targets: {}, passes: [] })), /author/);
  assert.throws(() => parseNoiseSkin(new Map([['main.glsl', main], ['config.json', 'null']])), /config.json/);
});

test('切换原始与已修改皮肤可恢复各自参数，简易渲染不丢弃记录', () => {
  const definition = parseNoiseSkin(files()); const source = { id: 'default', name: '层', skin: 'shader/A', parameters: {} };
  let layer = updateNoiseSkinSettings(source, { parameters: { tint: [0, 1, 0, 1] } }, definition);
  assert.equal(noiseSkinModified(layer, definition), true);
  const saved = structuredClone(layer.skinPresets['shader/A']);
  layer = switchNoiseSkin(layer, 'shader/A'); assert.deepEqual(layer.parameters, {});
  assert.deepEqual(layer.skinPresets['shader/A'], saved);
  layer = switchNoiseSkin(layer, 'shader/B');
  layer = updateNoiseSkinSettings(layer, { parameters: { touchReleaseDuration: 0.4 } }, definition);
  layer = switchNoiseSkin(layer, ''); assert.equal(layer.skin, '');
  layer = switchNoiseSkin(layer, 'shader/A', true); assert.deepEqual(layer.parameters, saved.parameters);
  layer = switchNoiseSkin(layer, 'shader/B', true); assert.deepEqual(layer.parameters, { touchReleaseDuration: 0.4 });
  assert.equal(source.skinPresets, undefined); assert.deepEqual(source.parameters, {});
});

test('参数与默认值相同不标记已修改，旧谱面当前参数可自动记住且不同层独立', () => {
  const definition = parseNoiseSkin(files());
  assert.equal(noiseSkinModified({ parameters: { tint: [1, 0, 0, 1], touchReleaseDuration: 0.1 } }, definition), false);
  const legacy = { id: 'a', name: '层 A', skin: 'shader/A', parameters: { tint: [0.5, 0, 0, 1] } };
  const switched = switchNoiseSkin(legacy, 'shader/B');
  assert.deepEqual(switchNoiseSkin(switched, 'shader/A', true).parameters, legacy.parameters);
  const independent = switchNoiseSkin({ id: 'b', name: '层 B', skin: 'shader/A', parameters: {} }, 'shader/A', true);
  assert.deepEqual(independent.parameters, {});
  assert.equal(legacy.skinPresets, undefined);
  const restoredDefault = updateNoiseSkinSettings(legacy, { parameters: { tint: [1, 0, 0, 1] } }, definition);
  assert.deepEqual(restoredDefault.parameters, {}); assert.deepEqual(restoredDefault.skinPresets, {});
  assert.deepEqual(rememberedNoiseSkinSettings(legacy)['shader/A'].parameters, legacy.parameters);
});

test('皮肤参数记录随谱面持久化，当前用原始皮肤或简易渲染也可恢复，操作可撤销', () => {
  const definition = parseNoiseSkin(files()); const chart = createChart();
  let layer = updateNoiseSkinSettings({ id: 'default', name: '层', skin: 'shader/Test', parameters: {} }, { parameters: { tint: [0, 1, 0, 1] } }, definition);
  chart.noiseAreaLayers = [switchNoiseSkin(layer, '')];
  const restored = parseChart(serializeChart(chart));
  assert.deepEqual(switchNoiseSkin(restored.noiseAreaLayers[0], 'shader/Test', true).parameters, { tint: [0, 1, 0, 1] });
  const assets = new Map([['shader/Test/main.glsl', new TextEncoder().encode(main)]]);
  const exported = packageEntries(restored, assets, 'chart.json');
  const packed = parseChart(new TextDecoder().decode(exported.get('chart.json')));
  assert.deepEqual(packed.noiseAreaLayers[0].skinPresets, restored.noiseAreaLayers[0].skinPresets);
  const session = new EditorSession(restored); const original = session.chart;
  layer = switchNoiseSkin(original.noiseAreaLayers[0], 'shader/Test', true);
  session.commit('恢复皮肤参数', withNoiseLayers(original, [layer]));
  session.travel('undo'); assert.equal(session.chart, original);
  session.travel('redo'); assert.deepEqual(session.chart.noiseAreaLayers[0].parameters, { tint: [0, 1, 0, 1] });
});

test('皮肤性能通道跟随记录，非法参数记录不能导入谱面', () => {
  const definition = parseNoiseSkin(files({ version: 1, targets: {}, passes: [{ shader: 'main.glsl', output: '$screen' }], lowPerformance: { passes: [{ shader: 'main.glsl', output: '$screen' }] } }));
  const layer = updateNoiseSkinSettings({ id: 'default', name: '层', skin: 'shader/Test', parameters: {} }, { channel: 'low' }, definition);
  assert.equal(noiseSkinModified(layer, definition), true);
  assert.equal(switchNoiseSkin(switchNoiseSkin(layer, ''), 'shader/Test', true).channel, 'low');
  const chart = createChart(); chart.noiseAreaLayers = [layer];
  for (const bad of [[], { '../private': {} }, { 'shader/Test': { parameters: { tint: [NaN, 0] } } }, { 'shader/Test': { channel: 'bad' } }, { 'shader/Test': { parameters: { touchReleaseDuration: -1 } } }]) {
    assert.throws(() => validateNoiseLayers({ ...chart, noiseAreaLayers: [{ ...layer, skinPresets: bad }] }));
  }
});

test('皮肤路径严格按相对路径解析，纹理选项独立', () => {
  for (const path of ['/a','../a','a/../b','a\\b','C:/a','a//b','a?b']) assert.throws(() => skinPath(path));
  const images = skinTextures('uniform sampler2D foam;\n// @texture tex/Foam.png wrap=mirror filter=nearest colorspace=srgb alphaMode=premult', 'effects/main.glsl');
  assert.deepEqual(images[0], { name:'foam',path:'effects/tex/Foam.png',wrap:'mirror',filter:'nearest',colorspace:'srgb',alphaMode:'premult' });
  assert.throws(() => skinTextures('uniform sampler2D image; // @texture a.png wrap=bad', 'main.glsl'), /选项/);
});

test('分辨率必须向下取整，允许放大，不允许空纹理', () => {
  assert.deepEqual(skinSize(1366,768,{scaleX:.125,scaleY:.125}), [170,96]);
  assert.deepEqual(skinSize(1366,768,{scaleX:.25,scaleY:.25}), [341,192]);
  assert.deepEqual(skinSize(10,20,{scaleX:2,scaleY:3}), [20,60]);
  assert.throws(() => skinSize(3,3,{scaleX:.1})); assert.throws(() => skinSize(100,100,{},64));
});

test('六位掩码统计恰好一次反转，Ready 同时计入合并集合', () => {
  assert.equal(maskWord([0,0,0],[0,0,0]),0);
  assert.equal(maskWord([1,0,0],[1,0,0]),3);
  assert.equal(maskWord([0,0,0],[2,0,0]),0);
  assert.equal(maskWord([0,0,0],[3,0,0]),0);
  assert.equal(maskWord([0,1,1],[0,0,0]),20);
  assert.equal(maskWord([0,0,0],[0,1,1]),40);
  assert.equal(maskWord([0,0,0],[0,2,1]),32);
});

test('默认单 Pass 和低性能通道不继承普通配置', () => {
  const simple = parseNoiseSkin(files()); assert.equal(simple.normal.passes.length,1); assert.equal(simple.normal.passes[0].output,'$screen');
  const skin = parseNoiseSkin(files({version:1,blockMask:{scaleX:.125},targets:{normal:{format:'r8'}},passes:[{shader:'main.glsl',output:'normal'}],lowPerformance:{passes:[{shader:'main.glsl',output:'$screen'}]}}));
  assert.deepEqual(skin.low.targets,{}); assert.deepEqual(skin.low.blockMask,{});
});

test('多 Pass 读取时序、历史自读和通道输出校验', () => {
  const source = 'uniform sampler2D historyRT; void main(){gl_FragColor=vec4(1.);}';
  const configured = (target,passes) => { const data=files({version:1,targets:{history:target},passes});data.set('step.glsl',source);return data; };
  const pass={shader:'step.glsl',output:'history.g',inputs:{historyRT:'history'}};
  assert.doesNotThrow(()=>parseNoiseSkin(configured({format:'rg8',noClear:true},[pass])));
  assert.throws(()=>parseNoiseSkin(configured({format:'rg8'},[pass])),/写入前/);
  assert.throws(()=>parseNoiseSkin(configured({format:'r8',noClear:true},[pass])),/输出/);
  assert.throws(()=>parseNoiseSkin(configured({},[{shader:'main.glsl',output:'missing.g'}])),/输出/);
  assert.throws(()=>parseNoiseSkin(files({version:2,targets:{},passes:[]})),/version/);
  const reserved = files(); reserved.set('main.glsl',main+'\nuniform sampler2D data;\nuniform float dataSize; // %0%'); reserved.set('config.json',JSON.stringify({version:1,targets:{history:{noClear:true}},passes:[{shader:'main.glsl',output:'$screen',inputs:{data:'history'}}]}));
  assert.throws(()=>parseNoiseSkin(reserved),/冲突|类型/);
});

test('PEZ 保留完整皮肤路径和内容，兼容导出不残留层元数据', () => {
  const chart=createChart();chart.noiseAreaLayers=[{id:'default',name:'默认层',skin:'shader/Test'}];
  const bytes=new TextEncoder().encode(main);const assets=new Map([['shader/Test/main.glsl',bytes]]);
  assert.deepEqual(packageEntries(chart,assets,'chart.json').get('shader/Test/main.glsl'),bytes);
  assert.equal(legacyChart(chart).noiseAreaLayers,undefined);
  assert.deepEqual(normalizeEditorPreferences({forceSimpleNoise:true}),{forceSimpleNoise:true});
});
