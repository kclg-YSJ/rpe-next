/**
 * The settings smoke test, executed inside the renderer by `desktop/main.ts`.
 *
 * It is a plain function rather than a module-level IIFE so the type checker can see it: the main
 * process serialises `toString()` (Node has already stripped the annotations) and evaluates it in
 * the page, where the `/src/...` specifiers resolve against the dev server.
 */
export async function smokeSettingsRenderer(): Promise<Record<string, unknown>> {
  const $ = <T extends Element = HTMLElement>(selector: string): T => document.querySelector(selector) as T;
  function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
  const waitFor = async (predicate: () => unknown): Promise<void> => {
    for (let attempt = 0; attempt < 100; attempt++) { if (await predicate()) return; await new Promise<void>(resolve => setTimeout(resolve, 50)); }
    throw new Error('设置测试等待超时');
  };
  const { showHotkeySettings } = await import('/src/ui/hotkey-settings.ts' as string) as typeof import('../src/ui/hotkey-settings.ts');
  const { migratePreferences, shortcutAction } = await import('/src/core/preferences.ts' as string) as typeof import('../src/core/preferences.ts');
  const library = await import('/src/platform/library.ts' as string) as typeof import('../src/platform/library.ts');
  const { createChart } = await import('/src/core/chart.ts' as string) as typeof import('../src/core/chart.ts');
  const { readEditorPreferences } = await import('/src/platform/editor-preferences.ts' as string) as typeof import('../src/platform/editor-preferences.ts');
  const previousPreferences = await library.readPreferences();
  const { localPreferences } = await import('/src/platform/local-preferences.ts' as string) as typeof import('../src/platform/local-preferences.ts');
  const previousEditor = localPreferences.getItem('rpe-next-editor-v1');
  const modal = $<HTMLDialogElement>('#modal');
  let saved: unknown;
  const projectId = `settings-smoke-${crypto.randomUUID()}`;
  try {
    $<HTMLElement>('#home-new').click();
    const thickness = $<HTMLInputElement>('#default-line-thickness'); thickness.value = '2.2'; thickness.dispatchEvent(new Event('change', { bubbles: true }));
    check(readEditorPreferences().lineScale === 2.2, '线宽未持久化');
    showHotkeySettings(migratePreferences(), async next => { await library.storePreferences(next); saved = next; });
    const apply = $<HTMLButtonElement>('#modal-apply');
    check(!apply.disabled, '默认热键被误报为冲突');
    const input = $<HTMLInputElement>('#hotkey-Save'); input.value = 'Ctrl+Z'; input.dispatchEvent(new Event('input'));
    check(apply.disabled && input.getAttribute('aria-invalid') === 'true', '重复快捷键未阻止应用');
    input.value = 'CTRL&&K'; input.dispatchEvent(new Event('input')); check(apply.disabled, '语法错误未阻止应用');
    $<HTMLElement>('[data-action="Save"] button').click();
    (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true }));
    check(input.value === 'Ctrl + K', '按键录入失败');
    check(!apply.disabled, '合法快捷键无法应用');
    $<HTMLElement>('[data-action="AddDrag"] button:nth-of-type(2)').click();
    apply.click(); await waitFor(() => saved);
    const stored = await library.readPreferences() as { originalHotkeys: Record<string, unknown> };
    const reloaded = migratePreferences('{}', Object.entries(stored.originalHotkeys).map(([action, value]) => `${action} ${String(value)}`).join('\n'));
    check(shortcutAction({ key: 'k', ctrlKey: true }, reloaded) === 'Save' && reloaded.hotkeys.AddDrag === '', '热键重载不一致');
    const search = $<HTMLInputElement>('.hotkey-toolbar input[type=search]'); search.value = '保存谱面'; search.dispatchEvent(new Event('input'));
    check([...document.querySelectorAll<HTMLElement>('.hotkey-row')].filter(row => !row.hidden).length === 1, '快捷键搜索无效');
    search.value = ''; search.dispatchEvent(new Event('input'));
    const overflow = [...document.querySelectorAll<HTMLElement>('.hotkey-row')].some(row => row.scrollWidth > row.clientWidth + 2);
    check(!overflow, '快捷键行横向溢出');
    modal.close();

    const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32; canvas.getContext('2d')!.fillRect(0, 0, 32, 32);
    const cover = new Uint8Array(await (await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('无法生成封面')), 'image/png'))).arrayBuffer());
    const chart = createChart(); chart.META.background = 'cover.png';
    const assets: [string, Uint8Array][] = [['cover.png', cover], ['audio.bin', new Uint8Array(8 * 1024 * 1024)]];
    const project = { id: projectId, chart, chartName: 'chart.json', assets, updated: Date.now() };
    let responsiveTicks = 0;
    const timer = setInterval(() => { responsiveTicks++; }, 5);
    try { await library.storeProject(project); } finally { clearInterval(timer); }
    const restored = await library.readProject(projectId);
    check(restored, '存档未写入');
    check(restored.assets[1]![1].byteLength === 8 * 1024 * 1024 && project.assets[1]![1].byteLength === 8 * 1024 * 1024, '后台保存未保留媒体或分离了活动缓冲区');
    const summary = (await library.listProjects())?.find(item => item.id === projectId);
    check(summary, '存档摘要缺失');
    check(summary.thumbnail instanceof Blob && summary.thumbnail.size > 0, '后台缩略图未保存');
    check(responsiveTicks > 0, '保存期间事件循环未响应');
    let failed = false;
    try { await library.storeProject({ ...project, chart: { ...chart, judgeLineList: 'invalid' as unknown as typeof chart.judgeLineList } }); } catch { failed = true; }
    check(failed, '无效存档应失败');
    check((await library.readProject(projectId))!.chart.META.background === 'cover.png', '失败写入破坏了旧存档');
    const competing = await Promise.allSettled([
      library.storeProject({ ...project, chart: { ...chart, META: { ...chart.META, name: 'older' } } }),
      library.storeProject({ ...project, assets: [], chart: { ...chart, META: { ...chart.META, name: 'newer' } } }),
    ]);
    check(competing[0]!.status === 'fulfilled' && competing[1]!.status === 'rejected' && (competing[1] as PromiseRejectedResult).reason.name === 'ProjectConflictError', '旧快照未被版本检测阻止');
    const latest = await library.readProject(projectId);
    await library.storeProject({ ...latest!, assets: [], chart: { ...chart, META: { ...chart.META, name: 'newer' } } });
    check((await library.readProject(projectId))!.chart.META.name === 'newer', '基于最新版本的后续保存失败');
    return { hotkeys: true, thickness: true, backgroundSave: true, atomicRollback: true, savedMediaBytes: restored.assets[1]![1].byteLength, responsiveTicks };
  } finally {
    if (modal.open) modal.close();
    await library.storePreferences(previousPreferences ?? migratePreferences());
    if (previousEditor === null) localPreferences.removeItem('rpe-next-editor-v1'); else localPreferences.setItem('rpe-next-editor-v1', previousEditor);
    const { nativeStorage } = await import('/src/platform/native.ts' as string) as typeof import('../src/platform/native.ts');
    if (nativeStorage) {
      const savedProject = await library.readProject(projectId);
      if (savedProject) { await library.deleteProject(projectId, savedProject.storageRevision); const head = await library.readProjectRevision(projectId); await nativeStorage.call('purge', projectId, head!.revision); }
    } else await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('rpe-next-library'); request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const connection = request.result; const transaction = connection.transaction(['projects', 'summaries'], 'readwrite');
        transaction.objectStore('projects').delete(projectId); transaction.objectStore('summaries').delete(projectId);
        transaction.oncomplete = () => { connection.close(); resolve(); }; transaction.onabort = () => { connection.close(); reject(transaction.error); };
      };
    });
  }
}
