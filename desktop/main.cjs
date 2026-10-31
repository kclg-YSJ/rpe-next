const { app, BrowserWindow, dialog, net, protocol, shell, ipcMain, safeStorage, utilityProcess, systemPreferences } = require('electron');
const { realpath, readFile } = require('node:fs/promises');
const { mkdirSync } = require('node:fs');
const { resolve, sep, dirname } = require('node:path');
const { pathToFileURL } = require('node:url');
const { NativeService } = require('./native-service.cjs');

const origin = 'rpe://app';
const smokeSettings = process.argv.includes('--smoke-settings');
const smokeMedia = process.argv.includes('--smoke-media');
const smokeMods = process.argv.includes('--smoke-mods');
const smokeNative = process.argv.includes('--smoke-native');
const smokeSaving = process.argv.includes('--smoke-saving');
const smokeAgent = process.argv.includes('--smoke-agent');
const smokeAudio = process.argv.includes('--smoke-audio');
const smokeMapper = process.argv.includes('--smoke-mapper');
const smoke = process.argv.includes('--smoke-test') || smokeSettings || smokeMedia || smokeMods || smokeNative || smokeSaving || smokeAgent || smokeAudio || smokeMapper;
app.setName('RePhiEdit Next');
app.setPath('userData', (smokeNative || smokeSaving || smokeAgent || smokeAudio || smokeMapper) && process.env.RPE_NATIVE_TEST_HOME ? resolve(process.env.RPE_NATIVE_TEST_HOME) : smoke ? resolve(app.getPath('temp'), 'rpe-next-smoke-' + Date.now()) : resolve(app.getPath('appData'), 'rpe-next-desktop'));
mkdirSync(app.getPath('userData'), { recursive: true });
protocol.registerSchemesAsPrivileged([{ scheme: 'rpe', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

if (!app.requestSingleInstanceLock()) app.quit();
else {
  let mainWindow;
  const cancelAgentNetwork = require('./agent-network.cjs').installAgentNetwork({ ipcMain, net, origin, window: () => mainWindow });
  require('./agent-capture.cjs').installAgentCapture({ ipcMain, origin, window: () => mainWindow });
  const stopPerformanceMonitor = require('./performance-monitor.cjs').installPerformanceMonitor({ app, ipcMain, origin, window: () => mainWindow });
  app.on('before-quit', cancelAgentNetwork);
  let native, closing = false, relocating = false;
  app.on('before-quit', event => {
    if (!native || closing) return;
    event.preventDefault();
    if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.close(); return; }
    closing = true; native.close().catch(console.error).finally(() => app.quit());
  });
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show(); mainWindow.focus();
  });
  app.on('window-all-closed', () => app.quit());
  app.whenReady().then(async () => {
    const root = await realpath(resolve(__dirname, '..'));
    const { DesktopUpdates, installDesktopUpdates } = await import(pathToFileURL(resolve(__dirname, 'app-update.mjs')).href);
    const { createUpdateFetcher } = await import(pathToFileURL(resolve(__dirname, 'update-network.mjs')).href);
    const updateTarget = process.platform === 'darwin' ? resolve(dirname(process.execPath), '../..') : dirname(process.execPath);
    const updater = await new DesktopUpdates({ statePath: resolve(app.getPath('userData'), 'app-updates.json'), target: updateTarget,
      version: JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')).version, packaged: app.isPackaged,
      fetcher: createUpdateFetcher(net), restart: () => app.quit(),
      protectedPaths: () => [app.getPath('userData'), nativeRoot, dictation.root, audioSeparation.root, audioOnsets.root, audioMapper.root, audioSeparation.dataRoot, audioOnsets.dataRoot, audioMapper.dataRoot],
      progress: value => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('rpen-app-update-progress', value); },
    }).initialize();
    installDesktopUpdates({ ipcMain, service: updater, window: () => mainWindow, origin, dialog, startupJob: process.argv.find(value => value.startsWith('--rpen-update-job='))?.slice('--rpen-update-job='.length) });
    app.on('will-quit', () => updater.approveQuit());
    app.on('before-quit', () => updater.cancelDownload());
    const { MicrophonePermissions } = await import(pathToFileURL(resolve(root, 'desktop/microphone-permissions.mjs')).href);
    const microphone = await new MicrophonePermissions(resolve(app.getPath('userData'), 'dictation-microphone.json'), { window: () => mainWindow, origin, systemPreferences, shell }).initialize();
    const { DictationService, installDictation } = await import(pathToFileURL(resolve(root, 'desktop/dictation.mjs')).href);
    const dictation = await new DictationService(resolve(app.getPath('userData'), 'dictation.json'), { utilityProcess, fetcher: (...args) => net.fetch(...args), progress: value => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('rpen-dictation-progress', value); } }).initialize();
    installDictation({ ipcMain, service: dictation, window: () => mainWindow, origin, dialog, shell, microphone });
    app.on('before-quit', () => dictation.close());
    const { AgentWorkspaceService, installAgentWorkspace } = await import(pathToFileURL(resolve(__dirname, 'agent-workspace.mjs')).href);
    const agentWorkspace = new AgentWorkspaceService(resolve(app.getPath('userData'), 'agent-workspaces'), { fetcher: (...args) => net.fetch(...args), openFolder: async path => { const error = await shell.openPath(path); if (error) throw Error(error); } });
    app.on('before-quit', installAgentWorkspace({ ipcMain, service: agentWorkspace, origin, window: () => mainWindow }));
    const { atomicJson } = await import(pathToFileURL(resolve(__dirname, 'native-store.mjs')).href);
    const { AudioStorage, installAudioStorage } = await import(pathToFileURL(resolve(__dirname, 'audio-storage.mjs')).href);
    const audioRoots = {
      separation: smokeAudio && process.env.RPE_AUDIO_TEST_CACHE ? resolve(process.env.RPE_AUDIO_TEST_CACHE) : resolve(app.getPath('userData'), 'audio-separation'),
      onsets: smokeAudio && process.env.RPE_ONSET_TEST_CACHE ? resolve(process.env.RPE_ONSET_TEST_CACHE) : resolve(app.getPath('userData'), 'audio-onsets'),
      mapper: (smokeAudio || smokeMapper) && process.env.RPE_MAPPER_TEST_CACHE ? resolve(process.env.RPE_MAPPER_TEST_CACHE) : resolve(app.getPath('userData'), 'audio-mapper')
    };
    const audioStorage = await new AudioStorage(resolve(app.getPath('userData'), 'audio-storage.json'), audioRoots, { progress: value => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('rpen-audio-storage-progress', value); } }).initialize();
    installAudioStorage({ ipcMain, service: audioStorage, origin, window: () => mainWindow, dialog, shell });
    const { AudioSeparationService, installAudioSeparation } = await import(pathToFileURL(resolve(__dirname, 'audio-separation.mjs')).href);
    const audioSeparation = new AudioSeparationService(audioRoots.separation, { script: resolve(__dirname, 'separate-audio.py'), python: smokeAudio ? process.env.RPE_AUDIO_TEST_PYTHON : undefined, fetcher: (...args) => net.fetch(...args), progress: value => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('rpen-audio-separation-progress', value); } });
    audioStorage.attach('separation', audioSeparation); if (!audioStorage.error) await audioSeparation.initialize();
    installAudioSeparation({ ipcMain, service: audioSeparation, origin, window: () => mainWindow, dialog });
    app.on('before-quit', () => audioSeparation.close());
    const { AudioOnsetService, installAudioOnsets } = await import(pathToFileURL(resolve(__dirname, 'audio-onsets.mjs')).href);
    const audioOnsets = new AudioOnsetService(audioRoots.onsets, { script: resolve(__dirname, 'detect-onsets.py'), python: smokeAudio ? process.env.RPE_ONSET_TEST_PYTHON : undefined, progress: value => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('rpen-audio-onsets-progress', value); } });
    audioStorage.attach('onsets', audioOnsets); if (!audioStorage.error) await audioOnsets.initialize();
    installAudioOnsets({ ipcMain, service: audioOnsets, origin, window: () => mainWindow, dialog });
    app.on('before-quit', () => audioOnsets.close());
    const { AudioMapperService, installAudioMapper } = await import(pathToFileURL(resolve(__dirname, 'audio-mapper.mjs')).href);
    const audioMapper = new AudioMapperService(audioRoots.mapper, { script: resolve(__dirname, 'map-audio.py'), python: smokeAudio || smokeMapper ? process.env.RPE_MAPPER_TEST_PYTHON : undefined, source: smokeAudio || smokeMapper ? process.env.RPE_MAPPER_TEST_SOURCE : undefined, progress: value => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('rpen-audio-mapper-progress', value); } });
    audioStorage.attach('mapper', audioMapper); if (!audioStorage.error) await audioMapper.initialize();
    installAudioMapper({ ipcMain, service: audioMapper, origin, window: () => mainWindow, dialog });
    app.on('before-quit', () => audioMapper.close());
    const { AgentCredentialVault, installAgentCredentials } = await import(pathToFileURL(resolve(__dirname, 'agent-credentials.mjs')).href);
    const agentCredentials = new AgentCredentialVault(resolve(app.getPath('userData'), 'agent-credentials.json'), { safeStorage, writeJson: atomicJson });
    installAgentCredentials({ ipcMain, vault: agentCredentials, origin, window: () => mainWindow });
    const configPath = resolve(app.getPath('userData'), 'native-storage.json');
    let config; try { config = JSON.parse(await readFile(configPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    let nativeRoot = config?.root ?? (smoke ? resolve(app.getPath('userData'), 'Library') : resolve(app.getPath('documents'), 'RePhiEdit Next', 'Library'));
    for (;;) {
      native = new NativeService(nativeRoot);
      try { await native.ready; break; }
      catch (error) {
        await native.close().catch(() => {}); native = null;
        if (smoke) throw error;
        const choice = await dialog.showMessageBox({ type: 'error', title: '无法打开桌面谱面库', message: error.message, detail: `原路径：${nativeRoot}\n原有数据保留。可选择已有的完整库，或选择另一个文件夹建立新库。`, buttons: ['选择文件夹', '退出'], defaultId: 0, cancelId: 1 });
        if (choice.response !== 0) { app.quit(); return; }
        const selected = await dialog.showOpenDialog({ title: '选择已有谱面库，或新库的上级文件夹', properties: ['openDirectory', 'createDirectory'] });
        if (selected.canceled) { app.quit(); return; }
        const candidate = resolve(selected.filePaths[0]);
        let marker; try { marker = JSON.parse(await readFile(resolve(candidate, 'library.json'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        nativeRoot = marker ? candidate : resolve(candidate, 'RPENLibrary');
      }
    }
    if (!config || config.root !== nativeRoot) { config = { ...config, version: 1, root: nativeRoot }; await atomicJson(configPath, config); }
    const tokens = new Set(); let rendererGeneration = 0;
    const allowed = new Set(['begin', 'part', 'parts', 'binaryBegin', 'binaryChunk', 'commit', 'abort', 'blob', 'read', 'list', 'remove', 'restore', 'purge', 'collect', 'status', 'rebuild', 'listDrafts', 'readRevision', 'migrationDone', 'markMigration', 'setLocalPreference']);
    ipcMain.handle('rpen-native-storage', async (event, request) => {
      try {
        if (event.sender !== mainWindow?.webContents || event.senderFrame !== event.sender.mainFrame || !event.senderFrame.url.startsWith(origin + '/')) throw Error('无权限');
        const { method, args = [] } = request ?? {};
        const generation = rendererGeneration;
        if (relocating || closing) throw Object.assign(Error('谱面库正在迁移或关闭，请稍后重试'), { name: 'StorageBusyError' });
        if (!Array.isArray(args)) throw Error('存储参数无效');
        let result;
        if (method === 'legacyMigrationPending') result = !config.legacyMigrated;
        else if (method === 'migrationComplete') { const next = { ...config, legacyMigrated: true }; await atomicJson(configPath, next); config = next; result = true; }
        else if (method === 'openRoot') { const status = await native.call('status'); const error = await shell.openPath(status.root); if (error) throw Error(error); result = true; }
        else if (method === 'openProjectFolder') { const path = await native.call('projectFolder', args[0]); const error = await shell.openPath(path); if (error) throw Error(error); result = true; }
        else if (method === 'openAssetFolder') { const path = await native.call('assetFolder', ...args); const error = await shell.openPath(path); if (error) throw Error(error); result = true; }
        else if (['chooseRoot', 'backupFolder', 'useRoot'].includes(method)) {
          const selected = await dialog.showOpenDialog(mainWindow, { title: method === 'useRoot' ? '选择包含 library.json 的已有谱面库或完整备份' : method === 'chooseRoot' ? '选择新谱面库的上级文件夹' : '选择独立备份文件夹', properties: ['openDirectory', 'createDirectory'] });
          if (selected.canceled) return { ok: true, result: null };
          const destination = method === 'useRoot' ? resolve(selected.filePaths[0]) : resolve(selected.filePaths[0], method === 'chooseRoot' ? 'RPENLibrary' : 'RPENBackup-' + new Date().toISOString().replace(/[:.]/g, '-'));
          if (relocating) throw Error('已有谱面库操作正在进行');
          if (tokens.size) throw Error('正在保存，请保存结束后再迁移或备份');
          relocating = true;
          let next;
          try {
            if (method === 'useRoot') {
              const marker = JSON.parse(await readFile(resolve(destination, 'library.json'), 'utf8'));
              if (marker.format !== 'rpen-native-library' || marker.version !== 1) throw Error('请选择有效的谱面库文件夹');
            } else result = await native.call('copyTo', destination);
            if (method !== 'backupFolder') {
              next = new NativeService(destination); await next.ready;
              const nextConfig = { ...config, version: 1, root: destination }; await atomicJson(configPath, nextConfig); config = nextConfig;
              const previous = native; native = next; next = null;
              await previous.close(); result = await native.call('status');
            }
          } finally { await next?.close().catch(() => {}); relocating = false; }
        } else {
          if (!allowed.has(method)) throw Error('不支持的存储操作');
          if (['part', 'parts', 'binaryBegin', 'binaryChunk', 'commit', 'abort'].includes(method) && !tokens.has(args[0])) throw Error('无效的存储操作凭据');
          result = await native.call(method, ...args);
          if (method === 'begin') {
            if (generation !== rendererGeneration) { await native.call('abort', result); throw Error('窗口已重新载入，保存操作已取消'); }
            tokens.add(result);
          }
          if (method === 'commit' || method === 'abort') tokens.delete(args[0]);
        }
        return { ok: true, result };
      } catch (error) { return { ok: false, error: { name: error.name, message: error.message, code: error.code, projectId: error.projectId, expectedRevision: error.expectedRevision, actualRevision: error.actualRevision } }; }
    });
    const { collaborationConnectSources } = await import(pathToFileURL(resolve(root, 'src/core/collaboration-policy.mjs')).href);
    const connectSources = collaborationConnectSources(process.env.RPE_MEDIA_ORIGINS);
    let agentSourceBundle;
    protocol.handle('rpe', async request => {
      try {
        const url = new URL(request.url);
        if (url.host !== 'app' || !['GET', 'HEAD'].includes(request.method)) return new Response('Forbidden', { status: 403 });
        if (smokeNative && url.pathname === '/__native-test-seed') return new Response('<!doctype html><html><body>Native migration fixture</body></html>', { headers: { 'Content-Type': 'text/html' } });
        const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
        if (relative === 'assets/agent-source.json') {
          if (!agentSourceBundle) agentSourceBundle = import(pathToFileURL(resolve(root, 'desktop/agent-source.mjs')).href).then(module => module.createAgentSourceBundle(root)).then(bundle => JSON.stringify(bundle)).catch(error => { agentSourceBundle = null; throw error; });
          const content = await agentSourceBundle; return new Response(request.method === 'HEAD' ? null : content, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
        }
        if (!['index.html', 'styles.css', 'protocols/MOD-PROTOCOL.zh-CN.md', 'protocols/GLOBAL-EVENTS-PROTOCOL.zh-CN.md', 'protocols/EDITOR-SKIN-PROTOCOL.zh-CN.md', 'protocols/DESKTOP-STORAGE.zh-CN.md', 'protocols/AUDIO-SEPARATION.zh-CN.md', 'schemas/editor-skin-v1.schema.json', 'schemas/editor-skin-components.v1.json', 'schemas/mod-v1.schema.json', 'schemas/mod-api-v1.d.ts'].includes(relative) && !relative.startsWith('src/') && !relative.startsWith('assets/')) return new Response('Not found', { status: 404 });
        const path = await realpath(resolve(root, relative));
        if (!path.startsWith(root + sep)) return new Response('Not found', { status: 404 });
        const response = await net.fetch(pathToFileURL(path).href);
        const headers = new Headers(response.headers);
        headers.set('Content-Security-Policy', `default-src 'self'; script-src 'self' blob:; script-src-elem 'self' blob: 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' blob:; media-src 'self' blob: data:; connect-src ${connectSources}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`);
        headers.set('X-Content-Type-Options', 'nosniff');
        if (path.endsWith('.mjs')) headers.set('Content-Type', 'text/javascript; charset=utf-8');
        return new Response(request.method === 'HEAD' ? null : response.body, { status: response.status, headers });
      } catch { return new Response('Not found', { status: 404 }); }
    });
    mainWindow = new BrowserWindow({
      width: 1440, height: 960, minWidth: 1000, minHeight: 680,
      title: 'Re:PhiEdit Next', backgroundColor: '#171c25', show: false,
      autoHideMenuBar: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, preload: resolve(__dirname, 'preload.cjs'), spellcheck: false, backgroundThrottling: !smoke }
    });
    mainWindow.removeMenu();
    microphone.install(mainWindow.webContents.session);
    mainWindow.webContents.on('did-start-loading', () => dictation.closeWorker());
    mainWindow.webContents.on('did-start-loading', cancelAgentNetwork);
    mainWindow.webContents.on('did-start-loading', stopPerformanceMonitor);
    mainWindow.webContents.on('render-process-gone', stopPerformanceMonitor);
    mainWindow.webContents.on('destroyed', stopPerformanceMonitor);
    mainWindow.webContents.on('did-start-loading', () => audioSeparation.close());
    mainWindow.webContents.on('did-start-loading', () => audioOnsets.close());
    mainWindow.webContents.on('did-start-loading', () => audioMapper.close());
    mainWindow.webContents.on('render-process-gone', cancelAgentNetwork);
    let preferenceFlush = false;
    mainWindow.on('close', event => {
      if (preferenceFlush || mainWindow.isDestroyed()) return;
      event.preventDefault();
      mainWindow.webContents.executeJavaScript('globalThis.rpenPrepareClose?.() ?? globalThis.rpenFlushPreferences?.()').then(() => agentCredentials.flush()).then(() => {
        preferenceFlush = true; mainWindow.close();
      }).catch(error => {
        const choice = dialog.showMessageBoxSync(mainWindow, { type: 'warning', title: '设置尚未保存', message: error.message, buttons: ['继续编辑', '仍然退出'], defaultId: 0, cancelId: 0 });
        if (choice === 1) { preferenceFlush = true; mainWindow.close(); }
        else updater.cancelInstall();
      });
    });
    const abortTokens = () => { rendererGeneration++; for (const token of tokens) native.call('abort', token).catch(() => {}); tokens.clear(); };
    mainWindow.webContents.on('render-process-gone', abortTokens);
    mainWindow.webContents.on('destroyed', abortTokens);
    mainWindow.webContents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => { if (isMainFrame) abortTokens(); });
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      const address = new URL(url);
      if (address.protocol === 'https:' && ['github.com', 'kclg-ysj.github.io'].includes(address.hostname)) shell.openExternal(url);
      return { action: 'deny' };
    });
    mainWindow.webContents.on('will-navigate', (event, url) => { if (!url.startsWith(`${origin}/`)) event.preventDefault(); });
    mainWindow.webContents.on('will-prevent-unload', event => {
      const choice = dialog.showMessageBoxSync(mainWindow, {
        type: 'question', buttons: ['继续编辑', '放弃未保存修改并退出'], defaultId: 0, cancelId: 0,
        title: '尚未保存', message: '当前谱面有未保存的修改，是否退出？'
      });
      if (choice === 1) event.preventDefault(); else { preferenceFlush = false; updater.cancelInstall(); }
    });
    const errors = [];
    mainWindow.webContents.on('console-message', details => { if (details.level === 'error') errors.push(details.message); });
    if (smokeNative && process.env.RPE_NATIVE_TEST_PHASE !== 'restart') {
      await mainWindow.loadURL(`${origin}/__native-test-seed`);
      await (await import(pathToFileURL(resolve(root, 'tools/smoke-native.mjs')).href)).prepareNative(mainWindow.webContents);
    }
    await mainWindow.loadURL(`${origin}/${process.argv.includes('--mods-off')?'?mods=off':''}`);
    if (smoke) {
      const result = await mainWindow.webContents.executeJavaScript(`(async () => {
        await document.fonts.ready;
        await new Promise(resolve => setTimeout(resolve, 1000));
        const resources = await Promise.all(['/src/ui/app.mjs', '/assets/rpe/Texture/Tap2.png', '/assets/rpe/fonts/cmdysj.ttf', '/assets/agent-source.json'].map(async path => { const response = await fetch(path); return { path, status: response.status, bytes: (await response.arrayBuffer()).byteLength }; }));
        const { AgentSourceReader } = await import('/src/platform/agent-source.mjs');
        const source = await new AgentSourceReader().query({ action: 'search', path: 'src/application/', query: 'trajectoryChart' });
        if (!source.matches.some(entry => entry.path === 'src/application/trajectory-commands.mjs')) throw Error('桌面源码查询烟测失败');
        const forbidden = await fetch('/desktop/main.cjs');
        const { CollaborationMedia } = await import('/src/platform/collaboration-media.mjs');
        const media = new CollaborationMedia(); const hashPhases = [];
        media.addEventListener('diagnostic', event => hashPhases.push(event.detail.phase));
        const mediaHash = await media.hash(new Uint8Array([1, 2, 3]), undefined, { fileIndex: 0, kind: 'image' });
        if (mediaHash !== '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81' || !hashPhases.includes('media-hash-worker-complete')) throw new Error('桌面后台校验或诊断烟测失败');
        const canvas = document.createElement('canvas');
        const database = await new Promise((resolve, reject) => { const request = indexedDB.open('desktop-smoke'); request.onsuccess = () => { request.result.close(); resolve(true); }; request.onerror = () => reject(request.error); });
        return { title: document.title, secure: isSecureContext, libraryVisible: Boolean(document.querySelector('#home') && !document.querySelector('#home').hidden), directoryPicker: typeof showDirectoryPicker === 'function', webgl: Boolean(canvas.getContext('webgl2')), database, resources, forbidden: forbidden.status, hashPhases };
      })()`);
      if (smokeSettings) result.settings = await mainWindow.webContents.executeJavaScript(await require('node:fs/promises').readFile(resolve(root, 'tools/smoke-settings-renderer.js'), 'utf8'));
      if (smokeMedia) result.media = await (await import(pathToFileURL(resolve(root, 'tools/smoke-media.mjs')).href)).smokeMediaTransfer(mainWindow.webContents);
      if (smokeMods) result.mods = await (await import(pathToFileURL(resolve(root, 'tools/smoke-mods.mjs')).href)).smokeMods(mainWindow.webContents);
      if (smokeSaving) result.saving = await (await import(pathToFileURL(resolve(root, 'tools/smoke-saving.mjs')).href)).smokeSaving(mainWindow.webContents);
      if (smokeAgent) result.agent = await (await import(pathToFileURL(resolve(root, 'tools/smoke-agent.mjs')).href)).smokeAgent(mainWindow.webContents, { userData: app.getPath('userData'), phase: process.env.RPE_AGENT_TEST_PHASE ?? 'save' });
      if (smokeAudio) result.audio = await (await import(pathToFileURL(resolve(root, 'tools/smoke-audio.mjs')).href)).smokeAudio(mainWindow.webContents, process.env.RPE_AUDIO_TEST_FIXTURE);
      if (smokeMapper) result.mapper = await (await import(pathToFileURL(resolve(root, 'tools/smoke-audio.mjs')).href)).smokeMapper(mainWindow.webContents, process.env.RPE_AUDIO_TEST_FIXTURE);
      if (smokeNative) result.native = await (await import(pathToFileURL(resolve(root, 'tools/smoke-native.mjs')).href)).smokeNative(mainWindow.webContents, native, {
        service: () => native,
        selectFolder: async (path, action) => {
          const previous = dialog.showOpenDialog; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
          try { return await action(); } finally { dialog.showOpenDialog = previous; }
        },
        openedFolders: async (action, expected = 1) => {
          const previous = shell.openPath, paths = [];
          shell.openPath = async path => { paths.push(path); return ''; };
          try {
            await action();
            const deadline = Date.now() + 15000;
            while (paths.length < expected) { if (Date.now() > deadline) throw Error('等待打开素材文件夹超时'); await new Promise(resolve => setTimeout(resolve, 25)); }
            return paths;
          } finally { shell.openPath = previous; }
        },
      });
      console.log(JSON.stringify({ ...result, errors }));
      const passed = result.secure && result.libraryVisible && result.webgl && result.database && result.resources.every(resource => resource.status === 200 && resource.bytes > 0) && result.forbidden === 404 && !errors.length;
      await native.close(); closing = true; app.exit(passed ? 0 : 1);
    } else { mainWindow.maximize(); mainWindow.show(); }
  }).catch(error => { console.error(error); if (!smoke) dialog.showErrorBox('启动失败', error.message); app.exit(1); });
}
