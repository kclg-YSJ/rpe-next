import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { DesktopGraphics, installGraphics, inspectGraphics } from '../desktop/graphics.cjs';

const integrated = { vendorId: 0x8086, deviceString: 'Intel(R) UHD Graphics 770', active: true };
const discrete = { vendorId: 0x10de, deviceString: 'NVIDIA GeForce RTX 4070', active: false };
const report = renderer => ({ gpuDevice: [integrated, discrete], auxAttributes: { glRenderer: renderer } });
const app = (flags = []) => {
  const switches = new Set(flags);
  return { switches, commandLine: { hasSwitch: name => switches.has(name), appendSwitch: name => switches.add(name) }, getGPUInfo: async () => report('ANGLE (Intel, Intel(R) UHD Graphics 770, D3D11)'), getGPUFeatureStatus: () => ({ gpu_compositing: 'enabled', webgl: 'enabled' }) };
};

test('显卡提示依据渲染器，不把混合输出、其他独显、禁用或未知设备误认为核显渲染', () => {
  assert.equal(inspectGraphics(report('ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11)')).needsWarning, false);
  assert.equal(inspectGraphics(report('ANGLE (Intel, Intel(R) UHD Graphics 770 Direct3D11)')).reason, 'integrated');
  assert.equal(inspectGraphics(report('ANGLE (AMD, Radeon RX 7800 XT Direct3D11)')).needsWarning, false);
  assert.equal(inspectGraphics(report('ANGLE (Intel, Intel(R) Arc A770 Graphics Direct3D11)')).needsWarning, false);
  assert.equal(inspectGraphics(report('ANGLE (Intel, Intel Iris Xe MAX Graphics Direct3D11)')).needsWarning, false);
  assert.equal(inspectGraphics({ gpuDevice: [integrated], auxAttributes: { glRenderer: 'Intel UHD Graphics 770' } }).needsWarning, false);
  assert.equal(inspectGraphics({ gpuDevice: [discrete], auxAttributes: {} }).needsWarning, false);
  assert.equal(inspectGraphics(report('Unknown renderer')).needsWarning, false);
  assert.equal(inspectGraphics({ ...report('Intel UHD Graphics 770'), gpuDevice: [integrated, { ...discrete, active: true }] }).needsWarning, false);
});

test('软件渲染和可用但未枚举的 NVIDIA 能被识别，软件状态不被硬件名称掩盖', () => {
  assert.equal(inspectGraphics(report('ANGLE (Google, Vulkan (SwiftShader Device))')).reason, 'software');
  assert.equal(inspectGraphics({ gpuDevice: [integrated], auxAttributes: { glRenderer: 'Intel UHD Graphics 770' } }, {}, [discrete]).needsWarning, true);
  assert.equal(inspectGraphics({ gpuDevice: [{ ...discrete, active: true }] }, { gpu_compositing: 'disabled_software', webgl: 'disabled_software' }).reason, 'software');
});

test('独显偏好在启动前生效，尊重显式低功耗和禁用 GPU，配置跨更新目录继承', async t => {
  await mkdir(fileURLToPath(new URL('../.local-tools/', import.meta.url)), { recursive: true });
  const root = await mkdtemp(fileURLToPath(new URL('../.local-tools/graphics-test-', import.meta.url))); t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'graphics.json'), first = app(), service = new DesktopGraphics({ app: first, statePath: path, platform: 'win32' });
  assert.ok(first.switches.has('force_high_performance_gpu')); assert.ok(first.switches.has('force-high-performance-gpu'));
  await Promise.all([service.update({ preferDiscrete: false }), service.update({ warnOnIntegrated: false })]);
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { preferDiscrete: false, warnOnIntegrated: false }); assert.equal(service.status().restartNeeded, true);
  const next = app(), restarted = new DesktopGraphics({ app: next, statePath: path, platform: 'win32' }); assert.equal(next.switches.size, 0); assert.equal(restarted.status().restartNeeded, false);
  for (const explicit of ['force_low_power_gpu', 'force-low-power-gpu', 'disable-gpu']) { const host = app([explicit]); new DesktopGraphics({ app: host, statePath: join(root, 'missing'), platform: 'win32' }); assert.deepEqual([...host.switches], [explicit]); }
  const other = app(); new DesktopGraphics({ app: other, statePath: path, platform: 'linux' }); assert.equal(other.switches.size, 0);
});

test('检测只按需运行、并发合并且缓存；配置失败不改变当前值', async () => {
  const host = app(); let queries = 0, inventories = 0;
  host.getGPUInfo = async () => { queries++; return { gpuDevice: [integrated], auxAttributes: { glRenderer: 'Intel UHD Graphics 770' } }; };
  const service = new DesktopGraphics({ app: host, statePath: '', platform: 'win32', inventory: async () => { inventories++; return [discrete]; }, save: async () => { throw Error('disk'); } });
  assert.equal(queries, 0); const results = await Promise.all([service.check(), service.check()]); assert.equal(queries, 1); assert.equal(inventories, 1); assert.deepEqual(results[0], results[1]); assert.equal(results[0].detection.needsWarning, true);
  await service.check(); assert.equal(queries, 1);
  await assert.rejects(service.update({ preferDiscrete: false }), /disk/); assert.equal(service.preferences.preferDiscrete, true);
  await assert.rejects(service.update({ path: 'bad' }), /Invalid/);
});

test('图形 IPC 只接受当前主框架，系统设置地址与复制路径不能由外部页面控制', async () => {
  const handlers = new Map(), contents = { mainFrame: { url: 'rpe://app/' } }, opened = [], copied = [];
  const service = new DesktopGraphics({ app: app(), platform: 'win32', statePath: '' });
  installGraphics({ ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, service, window: () => ({ webContents: contents }), origin: 'rpe://app', shell: { openExternal: value => opened.push(value) }, clipboard: { writeText: value => copied.push(value) }, executable: 'E:\\rpen\\RePhiEdit-Next.exe' });
  const call = request => handlers.get('rpen-graphics')({ sender: contents, senderFrame: contents.mainFrame }, request);
  await call({ action: 'open-settings', value: 'https://bad/' }); await call({ action: 'copy-path', value: 'bad' }); assert.deepEqual(opened, ['ms-settings:display-advancedgraphics']); assert.deepEqual(copied, ['E:\\rpen\\RePhiEdit-Next.exe']);
  await assert.rejects(handlers.get('rpen-graphics')({ sender: contents, senderFrame: { url: 'https://bad/' } }, { action: 'check' }), /Forbidden/);
});
