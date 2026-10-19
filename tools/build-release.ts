import { cp, mkdir, readFile, writeFile, readdir, rm, symlink, stat } from 'node:fs/promises';
import { execFileSync, spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { ZipFile } from 'yazl';
import { createHash } from 'node:crypto';
import { dirname, join, resolve, basename, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'vite';
import { extractReleaseZip, verifyReleaseSourceDirectory, verifyReleaseSourceZip } from './release-source.ts';

const require = createRequire(import.meta.url);
const { packager } = require('@electron/packager') as { packager: (options: Record<string, unknown>) => Promise<string[]> };

const root = fileURLToPath(new URL('../', import.meta.url));
const kind = process.argv.includes('--server') ? 'server' : 'editor';
const platform = process.platform, arch = process.arch;
if (!['win32', 'darwin', 'linux'].includes(platform) || !['x64', 'arm64'].includes(arch)) throw Error('Release builds require Windows, macOS or Linux on x64/ARM64');
const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
  name: string; version: string; description: string; author: string; license: string; devDependencies: Record<string, string>;
};
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const tracked = ['desktop', 'src', 'assets', 'index.html', 'styles.css', 'LICENSE', 'NOTICE',
  'protocols', 'schemas', 'tools/smoke-mods.ts', 'tools/smoke-native.ts', 'tools/smoke-asset-library.ts',
  'tools/smoke-settings-renderer.ts', 'tools/smoke-saving.ts'];
const serverFiles = ['collaboration-server/server.ts', 'collaboration-server/asset-store.ts', 'collaboration-server/manager.ts',
  'collaboration-server/diagnostics.ts', 'collaboration-server/preload.ts', 'collaboration-server/manager.html',
  'collaboration-server/manager.css', 'collaboration-server/manager-renderer.ts', 'collaboration-server/README.md',
  'src/core', 'LICENSE', 'NOTICE'];
const sourcePaths = kind === 'server' ? serverFiles : tracked;
execFileSync('git', ['diff', '--exit-code', 'HEAD', '--', 'package.json', ...sourcePaths], { cwd: root, stdio: 'pipe' });
const platformName = ({ win32: 'windows', darwin: 'macos', linux: 'linux' } as Record<string, string>)[platform]!;
const product = kind === 'server' ? 'RePhiEdit Collaboration Server' : 'RePhiEdit Next';
const executableName = kind === 'server' ? 'RPE-Collaboration-Server' : 'RePhiEdit-Next';
const stem = 'rpe-next-' + (kind === 'server' ? 'collaboration-server-' : '') + metadata.version + '-' + platformName + '-' + arch;
const output = join(root, 'release', 'v' + metadata.version);
const work = join(root, 'release', '.build-' + platform + '-' + arch + '-' + kind + '-' + sourceCommit.slice(0, 8)), stage = join(work, 'source');
const packageFolder = join(work, 'packages');
await mkdir(work, { recursive: true });
if (await readdir(work).then(items => items.length)) throw Error('Build workspace already exists; use a fresh checkout or remove this build workspace before rebuilding: ' + work);
await mkdir(stage);
// The editor ships the Vite bundle, which is not tracked and therefore cannot come from `git
// archive`; build it first so the staged tree matches what `npm run build` produces.
if (kind !== 'server') await build({ root });

const sourceZip = join(work, 'source.zip');
execFileSync('git', ['archive', '--format=zip', '-0', '--output=' + sourceZip, 'HEAD', '--', ...sourcePaths], { cwd: root });
await extractReleaseZip(sourceZip, stage);
await verifyReleaseSourceDirectory(root, sourceCommit, sourcePaths, stage);
await rm(sourceZip);
if (kind === 'server') {
  await cp(join(root, 'collaboration-server/node_modules/ws'), join(stage, 'collaboration-server/node_modules/ws'), { recursive: true });
  await writeFile(join(stage, 'collaboration-server/package.json'), JSON.stringify({ type: 'module', version: metadata.version, dependencies: { ws: '8.22.0' } }));
} else {
  await cp(join(root, 'dist'), stage, { recursive: true });
}
await writeFile(join(stage, 'package.json'), JSON.stringify({
  name: kind === 'server' ? 'rpe-next-collaboration-server' : metadata.name,
  version: metadata.version, description: metadata.description, author: metadata.author, license: metadata.license,
  main: kind === 'server' ? 'collaboration-server/manager.ts' : 'desktop/main.ts', type: 'module',
}, null, 2) + '\n');
const buildInfo = { version: metadata.version, kind, platform, arch, sourceCommit, electron: metadata.devDependencies.electron };
await writeFile(join(stage, 'build-info.json'), JSON.stringify(buildInfo, null, 2) + '\n');

let removedLocaleBytes = 0;
async function trimLocales(directory: string, base = directory): Promise<void> {
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
async function directoryBytes(directory: string): Promise<number> {
  let bytes = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const path = join(directory, entry.name);
    bytes += entry.isDirectory() ? await directoryBytes(path) : (await stat(path)).size;
  }
  return bytes;
}
interface RunOptions { timeout?: number; env?: NodeJS.ProcessEnv }
function run(program: string, args: string[], options: RunOptions = {}): Promise<string> {
  return new Promise((accept, reject) => {
    const child = spawn(program, args, { windowsHide: true, ...options });
    let output = '';
    child.stdout?.on('data', (bytes: Buffer) => { output += bytes; process.stdout.write(bytes); });
    child.stderr?.on('data', (bytes: Buffer) => { output += bytes; process.stderr.write(bytes); });
    const timer = setTimeout(() => { child.kill(); reject(Error(program + ' timed out')); }, options.timeout ?? 180000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', code => { clearTimeout(timer); code === 0 ? accept(output) : reject(Error(program + ' exited ' + code + '\n' + output.slice(-5000))); });
  });
}
const packaged = await packager({
  dir: stage, out: packageFolder, name: product, executableName, platform, arch,
  electronVersion: metadata.devDependencies.electron, appVersion: metadata.version,
  appBundleId: kind === 'server' ? 'io.github.kclg-ysj.rpe-next.server' : 'io.github.kclg-ysj.rpe-next',
  appCopyright: 'Copyright 2026 cmdysj', prune: false, asar: false, overwrite: false,
  darwinDarkModeSupport: true,
  ...(platform === 'darwin' ? { osxSign: { identity: '-', identityValidation: false, continueOnError: false } } : {}),
  afterExtract: [async ({ buildPath }: { buildPath: string }) => trimLocales(buildPath)]
});
if (packaged.length !== 1) throw Error('Unexpected package count');
const directory = packaged[0]!;
const bundle = platform === 'darwin' ? join(directory, product + '.app') : directory;
const application = platform === 'darwin' ? join(bundle, 'Contents/Resources/app') : join(directory, 'resources/app');
const sourceFilesVerified = await verifyReleaseSourceDirectory(root, sourceCommit, sourcePaths, application);
const executable = platform === 'darwin' ? join(bundle, 'Contents/MacOS', executableName) : join(directory, executableName + (platform === 'win32' ? '.exe' : ''));
if (platform === 'win32') execFileSync('icacls.exe', [directory, '/grant', '*S-1-15-2-1:(OI)(CI)(RX)', '/T', '/Q'], { windowsHide: true, stdio: 'pipe' });
const args = kind === 'server' ? ['--smoke-test'] : ['--smoke-native', '--mods-off'];
if (platform === 'linux') args.push('--no-sandbox');
if (platform === 'darwin') args.push('--use-angle=metal', '--ignore-gpu-blocklist');
else args.push('--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader');
console.log('Testing packaged application: ' + platform + '/' + arch + ' ' + kind);
const smoke = await run(executable, args, { env: { ...process.env, RPE_NATIVE_TEST_HOME: join(work, 'test-profile') }, timeout: platform === 'darwin' && arch === 'x64' ? 480000 : 240000 });
if (kind === 'editor' ? !smoke.includes('"errors":[]') || !smoke.includes('real native IPC opens image parent') : !smoke.includes('"protocol":1') || !smoke.includes('"errors":[]')) throw Error('Packaged smoke result is incomplete');
if (kind === 'editor' && !smoke.includes('built-in note skin files and images load through the packaged application protocol')) throw Error('Built-in note skin check is missing');
if (platform === 'darwin') execFileSync('codesign', ['--verify', '--deep', '--strict', bundle]);

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
  'Source commit: ' + sourceCommit, '',
].join('\n');
await mkdir(output, { recursive: true });
let archive: string;
if (platform === 'darwin') {
  const image = join(work, 'disk-image'); await mkdir(image);
  await cp(bundle, join(image, basename(bundle)), { recursive: true, dereference: false, verbatimSymlinks: true });
  await symlink('/Applications', join(image, 'Applications'));
  await writeFile(join(image, '使用说明.txt'), help);
  archive = join(output, stem + '.dmg');
  for (let attempt = 0; ; attempt++) {
    try {
      await run('hdiutil', ['create', '-fs', 'HFS+', '-volname', product, '-srcfolder', image, '-format', 'UDZO', '-imagekey', 'zlib-level=9', archive], { timeout: 600000 });
      break;
    } catch (error) {
      if (attempt >= 2 || !/Resource busy/i.test((error as Error).message)) throw error;
      await rm(archive, { force: true });
      await new Promise(resolve => setTimeout(resolve, 3000 * (attempt + 1)));
    }
  }
  await run('hdiutil', ['verify', archive]);
} else {
  await writeFile(join(directory, '使用说明.txt'), '\uFEFF' + help);
  if (platform === 'win32') {
    archive = join(output, stem + '.zip');
    const zip = new ZipFile(), finished = pipeline(zip.outputStream, createWriteStream(archive));
    const add = async (path: string) => {
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
const manifest = { ...buildInfo, file: basename(archive), bytes, sha256: digest.digest('hex'), unpackedBytes: await directoryBytes(directory), removedLocaleBytes, sourceFilesVerified, verified: true };
await writeFile(join(output, stem + '.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest));
