import { packager } from '@electron/packager';
import { cp, mkdir, readFile, writeFile, readdir, rm, symlink, stat } from 'node:fs/promises';
import { execFileSync, spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { ZipFile } from 'yazl';
import { createHash } from 'node:crypto';
import { dirname, join, resolve, basename, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractReleaseZip, verifyReleaseSourceDirectory, verifyReleaseSourceZip } from './release-source.mjs';
import { EDITOR_PACKAGE_SOURCES, SERVER_PACKAGE_SOURCES } from './package-sources.mjs';
import { macOSAdHocSignOptions, verifyMacOSAdHocSigning } from './macos-signing.mjs';
import { prepareUpdatePackage } from '../desktop/update-package.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const stageSeconds = {};
async function measureStage(name, action) {
  const start = performance.now();
  console.log('Release stage started: ' + name);
  try { return await action(); }
  finally {
    stageSeconds[name] = Math.round((performance.now() - start) / 10) / 100;
    console.log('Release stage finished: ' + name + ' (' + stageSeconds[name] + 's)');
  }
}
const kind = process.argv.includes('--server') ? 'server' : 'editor';
const platform = process.platform, arch = process.arch;
if (!['win32', 'darwin', 'linux'].includes(platform) || !['x64', 'arm64'].includes(arch)) throw Error('Release builds require Windows, macOS or Linux on x64/ARM64');
const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const sourcePaths = kind === 'server' ? SERVER_PACKAGE_SOURCES : EDITOR_PACKAGE_SOURCES;
execFileSync('git', ['diff', '--exit-code', 'HEAD', '--', 'package.json', ...sourcePaths], { cwd: root, stdio: 'pipe' });
const platformName = { win32: 'windows', darwin: 'macos', linux: 'linux' }[platform];
const product = kind === 'server' ? 'RePhiEdit Collaboration Server' : 'RePhiEdit Next';
const executableName = kind === 'server' ? 'RPE-Collaboration-Server' : 'RePhiEdit-Next';
const stem = 'rpe-next-' + (kind === 'server' ? 'collaboration-server-' : '') + metadata.version + '-' + platformName + '-' + arch;
const output = join(root, 'release', 'v' + metadata.version);
const work = join(root, 'release', '.build-' + platform + '-' + arch + '-' + kind + '-' + sourceCommit.slice(0, 8)), stage = join(work, 'source');
const packageFolder = join(work, 'packages');
await mkdir(work, { recursive: true });
if (await readdir(work).then(items => items.length)) throw Error('Build workspace already exists; use a fresh checkout or remove this build workspace before rebuilding: ' + work);
await mkdir(stage);
const sourceZip = join(work, 'source.zip');
execFileSync('git', ['archive', '--format=zip', '-0', '--output=' + sourceZip, 'HEAD', '--', ...sourcePaths], { cwd: root });
await extractReleaseZip(sourceZip, stage);
await verifyReleaseSourceDirectory(root, sourceCommit, sourcePaths, stage);
await rm(sourceZip);
if (kind === 'server') {
  await cp(join(root, 'collaboration-server/node_modules/ws'), join(stage, 'collaboration-server/node_modules/ws'), { recursive: true });
  await writeFile(join(stage, 'collaboration-server/package.json'), JSON.stringify({ type: 'module', version: metadata.version, dependencies: { ws: '8.22.0' } }));
}
await writeFile(join(stage, 'package.json'), JSON.stringify({
  name: kind === 'server' ? 'rpe-next-collaboration-server' : metadata.name,
  version: metadata.version, description: metadata.description, author: metadata.author, license: metadata.license,
  main: kind === 'server' ? 'collaboration-server/manager.cjs' : 'desktop/main.cjs', type: 'module'
}, null, 2) + '\n');
const buildInfo = { version: metadata.version, kind, platform, arch, sourceCommit, electron: metadata.devDependencies.electron };
await writeFile(join(stage, 'build-info.json'), JSON.stringify(buildInfo, null, 2) + '\n');

let removedLocaleBytes = 0;
async function trimLocales(directory, base = directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory() && entry.name === 'locales') {
      for (const locale of await readdir(path, { withFileTypes: true })) if (locale.isFile() && locale.name.endsWith('.pak') && !['en-US.pak', 'zh-CN.pak', 'zh-TW.pak'].includes(locale.name)) {
        removedLocaleBytes += (await stat(join(path, locale.name))).size;
        await rm(join(path, locale.name));
      }
    } else if (entry.isDirectory() && entry.name.endsWith('.lproj') && !['en.lproj', 'en_US.lproj', 'zh_CN.lproj', 'zh_TW.lproj', 'Base.lproj'].includes(entry.name)) {
      const target = resolve(path), child = relative(resolve(base), target);
      if (!child || isAbsolute(child) || child === '..' || child.startsWith('..' + (process.platform === 'win32' ? '\\' : '/'))) throw Error('Locale directory escaped the package');
      removedLocaleBytes += await directoryBytes(path); await rm(target, { recursive: true });
    } else if (entry.isDirectory()) await trimLocales(path, base);
  }
}
async function directoryBytes(directory) {
  let bytes = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const path = join(directory, entry.name);
    bytes += entry.isDirectory() ? await directoryBytes(path) : (await stat(path)).size;
  }
  return bytes;
}
function run(program, args, options = {}) {
  return new Promise((accept, reject) => {
    const child = spawn(program, args, { windowsHide: true, ...options });
    let output = '';
    child.stdout?.on('data', bytes => { output += bytes; process.stdout.write(bytes); });
    child.stderr?.on('data', bytes => { output += bytes; process.stderr.write(bytes); });
    const timer = setTimeout(() => { child.kill(); reject(Error(program + ' timed out')); }, options.timeout ?? 180000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', code => { clearTimeout(timer); code === 0 ? accept(output) : reject(Error(program + ' exited ' + code + '\n' + output.slice(-5000))); });
  });
}
const packaged = await measureStage('package-and-sign', () => packager({
  dir: stage, out: packageFolder, name: product, executableName, platform, arch,
  electronVersion: metadata.devDependencies.electron, appVersion: metadata.version,
  appBundleId: kind === 'server' ? 'io.github.kclg-ysj.rpe-next.server' : 'io.github.kclg-ysj.rpe-next',
  appCopyright: 'Copyright 2026 cmdysj', prune: false, asar: false, overwrite: false,
  darwinDarkModeSupport: true,
  ...(kind === 'editor' && platform === 'darwin' ? { extendInfo: { NSMicrophoneUsageDescription: '按住语音输入快捷键时，在本机识别麦克风音频并填入文本框。Microphone audio is transcribed locally while the dictation key is held.' } } : {}),
  ...(platform === 'darwin' ? { osxSign: macOSAdHocSignOptions() } : {}),
  afterExtract: [async ({ buildPath }) => trimLocales(buildPath)]
}));
if (packaged.length !== 1) throw Error('Unexpected package count');
const directory = packaged[0];
const bundle = platform === 'darwin' ? join(directory, product + '.app') : directory;
const application = platform === 'darwin' ? join(bundle, 'Contents/Resources/app') : join(directory, 'resources/app');
const sourceFilesVerified = await verifyReleaseSourceDirectory(root, sourceCommit, sourcePaths, application);
const executable = platform === 'darwin' ? join(bundle, 'Contents/MacOS', executableName) : join(directory, executableName + (platform === 'win32' ? '.exe' : ''));
if (platform === 'win32') execFileSync('icacls.exe', [directory, '/grant', '*S-1-15-2-1:(OI)(CI)(RX)', '/T', '/Q'], { windowsHide: true, stdio: 'pipe' });
const args = kind === 'server' ? ['--smoke-test'] : ['--smoke-native', '--mods-off'];
if (platform === 'linux') args.push('--no-sandbox');
const softwareGraphics = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
let verificationGraphics = platform === 'darwin' ? 'metal' : 'swiftshader';
if (platform === 'darwin' && arch === 'x64') {
  // Hosted Intel VMs differ in their exposed graphics APIs. Probe the signed
  // package before the full checks, and reuse the working backend at all three
  // installation stages. The archive and user graphics settings stay intact.
  const candidates = [
    ['opengl', ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist']],
    ['default', ['--ignore-gpu-blocklist']],
    ['swiftshader', softwareGraphics],
    ['swiftshader-in-process', [...softwareGraphics, '--in-process-gpu']]
  ];
  let selected;
  for (const [name, flags] of candidates) {
    try {
      const result = await measureStage('graphics-probe-' + name, () => run(executable, ['--smoke-test', '--mods-off', ...flags], { timeout: 60000 }));
      if (!result.includes('"webgl":true') || !result.includes('"errors":[]')) throw Error('WebGL package probe did not pass');
      selected = flags; verificationGraphics = name; break;
    } catch (error) { console.log('Package graphics backend unavailable: ' + name + '\n' + error.message.slice(-1500)); }
  }
  if (!selected) throw Error('No verified WebGL backend available on the Intel macOS build host');
  args.push(...selected);
} else if (platform === 'darwin') args.push('--use-angle=metal', '--ignore-gpu-blocklist');
else args.push(...softwareGraphics);
console.log('Testing packaged application: ' + platform + '/' + arch + ' ' + kind);
async function smokeApplication(path, profile, stage) {
  const smoke = await measureStage(stage, () => run(path, args, { env: { ...process.env, RPE_NATIVE_TEST_HOME: profile }, timeout: platform === 'darwin' && arch === 'x64' ? 480000 : 240000 }));
  if (kind === 'editor' ? !smoke.includes('"errors":[]') || !smoke.includes('real native IPC opens image parent') : !smoke.includes('"protocol":1') || !smoke.includes('"errors":[]')) throw Error('Packaged smoke result is incomplete');
  if (kind === 'editor' && !smoke.includes('built-in note skin files and images load through the packaged application protocol')) throw Error('Built-in note skin check is missing');
}
if (platform === 'darwin') await verifyMacOSAdHocSigning(bundle);
await smokeApplication(executable, join(work, 'test-profile'), 'packaged-application-test');

const help = [
  product + ' ' + metadata.version, '',
  kind === 'server' ? '运行 RPE-Collaboration-Server，启动服务后将公网地址发给协作者。Cloudflare Tunnel 可在界面中单独选择。' :
    '运行 RePhiEdit-Next。macOS 将应用拖入 Applications；Linux 解压后运行同名程序；Windows 保留整个文件夹。',
  '谱面与编辑器设置保存在系统用户目录中的原生谱面库，不随程序更新覆盖。',
  'macOS 首次打开可在“系统设置 → 隐私与安全性”中允许此应用。',
  'Linux 需在桌面会话中运行；请以普通用户启动。',
  '', '许可：PolyForm Noncommercial 1.0.0。程序及第三方许可随包保留。',
  '在线版：https://kclg-ysj.github.io/rpe-next/',
  '源码：https://github.com/kclg-YSJ/rpe-next',
  'Source commit: ' + sourceCommit, ''
].join('\n');
await mkdir(output, { recursive: true });
let archive, macOSVerification;
if (platform === 'darwin') {
  const image = join(work, 'disk-image'); await mkdir(image);
  await cp(bundle, join(image, basename(bundle)), { recursive: true, dereference: false, verbatimSymlinks: true });
  await symlink('/Applications', join(image, 'Applications'));
  await writeFile(join(image, '使用说明.txt'), help);
  archive = join(output, stem + '.dmg');
  for (let attempt = 0; ; attempt++) {
    try {
      await measureStage('create-dmg', () => run('hdiutil', ['create', '-fs', 'HFS+', '-volname', product, '-srcfolder', image, '-format', 'UDZO', '-imagekey', 'zlib-level=9', archive], { timeout: 600000 }));
      break;
    } catch (error) {
      if (attempt >= 2 || !/Resource busy/i.test(error.message)) throw error;
      await rm(archive, { force: true });
      await new Promise(resolve => setTimeout(resolve, 3000 * (attempt + 1)));
    }
  }
  await run('hdiutil', ['verify', archive]);
  // Test what users install, including the framework symlinks and the actual
  // signed entitlements after both the DMG and application copy operations.
  const mount = join(work, 'mounted-image'), installed = join(work, 'installed', basename(bundle));
  await mkdir(mount);
  await run('hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, archive]);
  try {
    await run('ditto', [join(mount, basename(bundle)), installed]);
  } finally {
    await run('hdiutil', ['detach', mount]);
  }
  await verifyReleaseSourceDirectory(root, sourceCommit, sourcePaths, join(installed, 'Contents/Resources/app'));
  const signedProcesses = await verifyMacOSAdHocSigning(installed);
  await smokeApplication(join(installed, 'Contents/MacOS', executableName), join(work, 'installed-test-profile'), 'dmg-installed-application-test');
  macOSVerification = { signedProcesses, installedFromDmg: true };
} else {
  await writeFile(join(directory, '使用说明.txt'), '\uFEFF' + help);
  if (platform === 'win32') {
    archive = join(output, stem + '.zip');
    const zip = new ZipFile(), finished = pipeline(zip.outputStream, createWriteStream(archive));
    const add = async path => {
      for (const entry of await readdir(path, { withFileTypes: true })) {
        const file = join(path, entry.name);
        if (entry.isDirectory()) await add(file);
        else if (entry.isFile()) zip.addFile(file, relative(dirname(directory), file).replaceAll('\\', '/'), { compressionLevel: 9 });
        else throw Error('Unexpected package file type: ' + file);
      }
    };
    await add(directory); zip.end(); await finished;
    await verifyReleaseSourceZip(root, sourceCommit, sourcePaths, archive, basename(directory) + '/resources/app/');
  } else {
    archive = join(output, stem + '.tar.xz');
    await run('tar', ['-cJf', archive, '-C', dirname(directory), basename(directory)], { env: { ...process.env, XZ_OPT: '-9e -T2' }, timeout: 900000 });
    await run('xz', ['--test', archive], { timeout: 300000 });
  }
}
const digest = createHash('sha256'); for await (const chunk of createReadStream(archive)) digest.update(chunk);
const bytes = (await stat(archive)).size;
const sha256 = digest.digest('hex');
let updateVerification;
if (kind === 'editor') {
  const prepared = await prepareUpdatePackage({ archive, sha256, release: { version: metadata.version }, platform, arch, output: join(work, 'update-verification') });
  const application = join(prepared.source, platform === 'darwin' ? 'Contents/Resources/app' : 'resources/app');
  await verifyReleaseSourceDirectory(root, sourceCommit, sourcePaths, application);
  const installedExecutable = join(prepared.source, platform === 'darwin' ? 'Contents/MacOS/RePhiEdit-Next' : platform === 'win32' ? 'RePhiEdit-Next.exe' : 'RePhiEdit-Next');
  await smokeApplication(installedExecutable, join(work, 'update-test-profile'), 'updated-application-test');
  updateVerification = { packagePrepared: true, sourceVerified: true, applicationStarts: true };
}
const manifest = { ...buildInfo, file: basename(archive), bytes, sha256, unpackedBytes: await directoryBytes(directory), removedLocaleBytes, sourceFilesVerified, verified: true, stageSeconds, verificationGraphics, ...(macOSVerification ? { macOSVerification } : {}), ...(updateVerification ? { updateVerification } : {}) };
await writeFile(join(output, stem + '.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest));
