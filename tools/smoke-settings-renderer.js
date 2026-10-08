(async () => {
  const check = (value, message) => { if (!value) throw new Error(message); };
  const waitFor = async predicate => {
    for (let attempt = 0; attempt < 100; attempt++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
    throw new Error('设置测试等待超时');
  };
  const { showHotkeySettings } = await import('/src/ui/hotkey-settings.ts');
  const { migratePreferences, shortcutAction } = await import('/src/core/preferences.ts');
  const library = await import('/src/platform/library.ts');
  const { createChart } = await import('/src/core/chart.ts');
  const { readEditorPreferences } = await import('/src/platform/editor-preferences.ts');
  const previousPreferences = await library.readPreferences();
  const previousEditor = localStorage.getItem('rpe-next-editor-v1');
  const modal = document.querySelector('#modal');
  let saved;
  const projectId = `settings-smoke-${crypto.randomUUID()}`;
  try {
    document.querySelector('#home-new').click();
    const thickness = document.querySelector('#default-line-thickness'); thickness.value = '2.2'; thickness.dispatchEvent(new Event('change', { bubbles: true }));
    check(readEditorPreferences().lineScale === 2.2, '线宽未持久化');
    showHotkeySettings(migratePreferences(), async next => { await library.storePreferences(next); saved = next; });
    const apply = document.querySelector('#modal-apply');
    check(!apply.disabled, '默认热键被误报为冲突');
    const input = document.querySelector('#hotkey-Save'); input.value = 'Ctrl+Z'; input.dispatchEvent(new Event('input'));
    check(apply.disabled && input.getAttribute('aria-invalid') === 'true', '重复快捷键未阻止应用');
    input.value = 'CTRL&&K'; input.dispatchEvent(new Event('input')); check(apply.disabled, '语法错误未阻止应用');
    document.querySelector('[data-action="Save"] button').click();
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true }));
    check(input.value === 'Ctrl + K', '按键录入失败');
    check(!apply.disabled, '合法快捷键无法应用');
    document.querySelector('[data-action="AddDrag"] button:nth-of-type(2)').click();
    apply.click(); await waitFor(() => saved);
    const stored = await library.readPreferences();
    const reloaded = migratePreferences('{}', Object.entries(stored.originalHotkeys).map(([action, value]) => `${action} ${value}`).join('\n'));
    check(shortcutAction({ key: 'k', ctrlKey: true }, reloaded) === 'Save' && reloaded.hotkeys.AddDrag === '', '热键重载不一致');
    const search = document.querySelector('.hotkey-toolbar input[type=search]'); search.value = '保存谱面'; search.dispatchEvent(new Event('input'));
    check([...document.querySelectorAll('.hotkey-row')].filter(row => !row.hidden).length === 1, '快捷键搜索无效');
    search.value = ''; search.dispatchEvent(new Event('input'));
    const overflow = [...document.querySelectorAll('.hotkey-row')].some(row => row.scrollWidth > row.clientWidth + 2);
    check(!overflow, '快捷键行横向溢出');
    modal.close();

    const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32; canvas.getContext('2d').fillRect(0, 0, 32, 32);
    const cover = new Uint8Array(await (await new Promise(resolve => canvas.toBlob(resolve))).arrayBuffer());
    const chart = createChart(); chart.META.background = 'cover.png';
    const project = { id: projectId, chart, chartName: 'chart.json', assets: [['cover.png', cover], ['audio.bin', new Uint8Array(8 * 1024 * 1024)]], updated: Date.now() };
    let responsiveTicks = 0;
    const timer = setInterval(() => { responsiveTicks++; }, 5);
    try { await library.storeProject(project); } finally { clearInterval(timer); }
    const restored = await library.readProject(projectId);
    check(restored.assets[1][1].byteLength === 8 * 1024 * 1024 && project.assets[1][1].byteLength === 8 * 1024 * 1024, '后台保存未保留媒体或分离了活动缓冲区');
    const summary = (await library.listProjects()).find(item => item.id === projectId);
    check(summary.thumbnail instanceof Blob && summary.thumbnail.size > 0, '后台缩略图未保存');
    check(responsiveTicks > 0, '保存期间事件循环未响应');
    let failed = false;
    try { await library.storeProject({ ...project, chart: { ...chart, judgeLineList: 'invalid' } }); } catch { failed = true; }
    check(failed, '无效存档应失败');
    check((await library.readProject(projectId)).chart.META.background === 'cover.png', '失败写入破坏了旧存档');
    await Promise.all([
      library.storeProject({ ...project, chart: { ...chart, META: { ...chart.META, name: 'older' } } }),
      library.storeProject({ ...project, assets: [], chart: { ...chart, META: { ...chart.META, name: 'newer' } } }),
    ]);
    check((await library.readProject(projectId)).chart.META.name === 'newer', '同一谱面的后续保存被旧请求覆盖');
    return { hotkeys: true, thickness: true, backgroundSave: true, atomicRollback: true, savedMediaBytes: restored.assets[1][1].byteLength, responsiveTicks };
  } finally {
    if (modal.open) modal.close();
    await library.storePreferences(previousPreferences ?? migratePreferences());
    if (previousEditor === null) localStorage.removeItem('rpe-next-editor-v1'); else localStorage.setItem('rpe-next-editor-v1', previousEditor);
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('rpe-next-library'); request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const connection = request.result; const transaction = connection.transaction(['projects', 'summaries'], 'readwrite');
        transaction.objectStore('projects').delete(projectId); transaction.objectStore('summaries').delete(projectId);
        transaction.oncomplete = () => { connection.close(); resolve(); }; transaction.onabort = () => { connection.close(); reject(transaction.error); };
      };
    });
  }
})()
