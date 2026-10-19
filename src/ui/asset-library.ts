import { showDialog } from './dialog.ts';
import { assetPath, mediaType } from '../platform/files.ts';
import { IMAGE_EXTENSION, slashPath, pathKey, parentFolder, withinFolder, validAssetPath, collectAssetFolders,
  noiseSkinRoots, skinOwnedPath, libraryImages, libraryFolders, assertImageFolder, moveLibraryPaths } from '../core/asset-library.ts';
import type { Chart } from '../core/types.ts';

/** The asset map the library edits: archive-relative path to raw bytes. */
export type Assets = Map<string, Uint8Array>;

/** The folders the library shows, as a set of archive-relative paths. */
export type Folders = Set<string>;

/** What the panel reads off the editor when it renders or mutates. */
export interface AssetLibraryContext {
  assets: Assets;
  folders?: Folders;
  chart?: Chart;
  chartName?: string;
}

/** One node of the folder tree `render` builds. */
interface AssetFolderNode {
  folders: Map<string, AssetFolderNode>;
  files: AssetFileEntry[];
}

/** One image asset: its archive path, its display name and its bytes. */
type AssetFileEntry = [name: string, file: string, bytes: Uint8Array];

/** A file picker input that also accepts a directory, as Chrome implements it. */
interface DirectoryInput extends HTMLInputElement {
  webkitdirectory: boolean;
}

/** The callbacks the panel is constructed with. */
export interface AssetLibraryOptions {
  notify?: (message: string, level?: string) => void;
  onChange?: (assets: Assets, folders: Folders, paths: Map<string, string> | undefined) => void;
  openFolder?: (path: string, folder: boolean) => unknown;
}

/** An object URL for one asset, typed with the media type its name implies. */
function createUrl(bytes: Uint8Array, name: string): string {
  return URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: mediaType(name) }));
}

/** A caught value's message, matching the `error.message` reads the handlers use. */
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

export class AssetLibraryPanel {
  host: HTMLElement;
  getContext: () => AssetLibraryContext;
  notify: (message: string, level?: string) => void;
  onChange: (assets: Assets, folders: Folders, paths: Map<string, string> | undefined) => void;
  openFolder?: (path: string, folder: boolean) => unknown;
  selected: string | null;
  selectedFolder: string | null;
  urls: string[];
  collapsed: Set<string>;

  constructor(host: HTMLElement, getContext: () => AssetLibraryContext, { notify = () => {}, onChange = () => {}, openFolder }: AssetLibraryOptions = {}) {
    this.host = host; this.getContext = getContext; this.notify = notify; this.onChange = onChange; this.openFolder = openFolder;
    this.selected = null; this.selectedFolder = null; this.urls = []; this.collapsed = new Set();
  }

  disposeUrls(): void { for (const url of this.urls) URL.revokeObjectURL(url); this.urls = []; }

  async mutate(mutator: (next: Assets, folders: Folders) => Map<string, string> | void | Promise<Map<string, string> | void>, message = '素材库已更新'): Promise<void> {
    const context = this.getContext(), next = new Map(context.assets ?? []), folders = new Set(context.folders ?? []);
    const paths = await mutator(next, folders);
    if (this.getContext().assets !== context.assets) throw Error('素材库已变化，请重新执行此操作');
    await this.changed(next, folders, paths ?? undefined, message);
  }

  async changed(assets: Assets, folders: Folders, paths: Map<string, string> | undefined, message: string): Promise<void> {
    await this.onChange(assets, folders, paths);
    this.notify(message, 'success'); this.render();
  }

  action(label: string, callback: () => unknown, host: HTMLElement): HTMLButtonElement {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
    button.onclick = () => {
      try { Promise.resolve(callback()).catch(error => this.notify(errorMessage(error), 'error')); }
      catch (error) { this.notify(errorMessage(error), 'error'); }
    };
    host.append(button); return button;
  }

  async addFiles(files: FileList | null, destination = this.selectedFolder ?? parentFolder(this.selected ?? '')): Promise<void> {
    const images = [...files ?? []].filter(file => IMAGE_EXTENSION.test(file.name));
    if (!images.length) return this.notify('没有找到支持的图片格式', 'warning');
    return this.mutate(async (next, folders) => {
      let first: string | undefined;
      for (const file of images) {
        let path = validAssetPath((destination ? destination + '/' : '') + slashPath(file.webkitRelativePath || file.name));
        if (skinOwnedPath(path, noiseSkinRoots(next, this.getContext().chart, this.getContext().chartName))) throw Error('请勿把图片添加到噪域皮肤文件夹');
        const occupied = new Set([...next.keys(), ...folders].map(pathKey));
        const dot = path.lastIndexOf('.'), stem = path.slice(0, dot), extension = path.slice(dot); let index = 2;
        while (occupied.has(pathKey(path))) path = stem + '-' + index++ + extension;
        for (let parent = parentFolder(path); parent; parent = parentFolder(parent)) if ([...next.keys()].some(name => pathKey(name) === pathKey(parent))) throw Error('目标路径中存在同名文件');
        next.set(path, new Uint8Array(await file.arrayBuffer())); collectAssetFolders(path, folders); first ??= path;
      }
      this.selected = first ?? null; this.selectedFolder = null;
    }, '已添加 ' + images.length + ' 个图片素材');
  }

  dialog(title: string, description: string, control: HTMLElement, callback: () => unknown): void {
    const content = showDialog(title, description); content.append(control);
    const apply = document.querySelector<HTMLButtonElement>('#modal-apply')!; apply.hidden = false; apply.onclick = async () => {
      apply.disabled = true;
      try { await callback(); document.querySelector<HTMLDialogElement>('#modal')!.close(); }
      catch (error) { document.querySelector<HTMLElement>('#modal-error')!.textContent = errorMessage(error); }
      finally { apply.disabled = false; }
    };
    control.focus();
  }

  createFolder(parent = this.selectedFolder ?? ''): void {
    const input = document.createElement('input'); input.type = 'text'; input.value = parent ? parent + '/' : '';
    input.placeholder = '例如：lines/season-1'; input.setAttribute('aria-label', '素材文件夹名称');
    this.dialog('新建素材文件夹', '可以输入多级文件夹路径。', input, () => this.mutate((next, folders) => {
      const name = validAssetPath(input.value), roots = noiseSkinRoots(next, this.getContext().chart, this.getContext().chartName);
      if (skinOwnedPath(name, roots)) throw Error('不能在噪域皮肤中创建素材文件夹');
      if ([...libraryFolders(next, folders), ...next.keys()].some(path => pathKey(path) === pathKey(name))) throw Error('同名文件或文件夹已存在');
      for (let path = name; path; path = parentFolder(path)) if ([...next.keys()].some(item => pathKey(item) === pathKey(path))) throw Error('目标路径中存在同名文件');
      collectAssetFolders(name + '/_', folders); this.selected = null; this.selectedFolder = name;
    }, '已新建素材文件夹'));
  }

  async movePath(from: string, to: string, folder = false): Promise<void> {
    const result = moveLibraryPaths(this.getContext(), from, to, folder);
    if (folder) { this.selected = null; this.selectedFolder = to; this.collapsed.delete(to); }
    else { this.selected = to; this.selectedFolder = null; }
    await this.changed(result.assets, result.folders, result.paths, folder ? '文件夹已更新' : '图片位置已更新');
  }

  renamePath(name: string, folder = false): void {
    const input = document.createElement('input'); input.type = 'text'; input.value = name.split('/').at(-1) ?? ''; input.setAttribute('aria-label', '新素材名称');
    this.dialog(folder ? '重命名素材文件夹' : '重命名图片素材', '会同步更新引用这些图片的贴图和曲绘路径。', input, () => {
      const leaf = validAssetPath(input.value); if (leaf.includes('/')) throw Error('请输入名称；更换所在文件夹请使用“移动到”');
      const parent = parentFolder(name); return this.movePath(name, (parent ? parent + '/' : '') + leaf, folder);
    });
  }

  moveDialog(name: string, folder = false): void {
    const context = this.getContext(), select = document.createElement('select'); select.setAttribute('aria-label', '目标素材文件夹');
    select.append(new Option('根目录', ''));
    for (const path of [...libraryFolders(context.assets, context.folders, context.chart, context.chartName)].sort()) {
      if (folder && (pathKey(path) === pathKey(name) || withinFolder(path, name))) continue;
      select.append(new Option(path, path));
    }
    select.value = parentFolder(name);
    this.dialog(folder ? '移动素材文件夹' : '移动图片素材', '选择目标文件夹，已有引用会同步更新。', select,
      () => this.movePath(name, (select.value ? select.value + '/' : '') + (name.split('/').at(-1) ?? ''), folder));
  }

  deletePath(name: string, folder = false): void {
    const context = this.getContext(); if (folder) assertImageFolder(context, name);
    const names = [...context.assets.keys()].filter(path => folder ? withinFolder(path, name) : path === name);
    const content = document.createElement('p'); content.textContent = folder ? '将删除 ' + names.length + ' 张图片及子文件夹。' : name;
    this.dialog(folder ? '删除素材文件夹？' : '删除图片素材？', '已引用的图片将缺失；取消可保留素材。', content,
      () => this.mutate((next, folders) => {
        names.forEach(path => next.delete(path));
        if (folder) for (const path of folders) if (path === name || withinFolder(path, name)) folders.delete(path);
        this.selected = null; this.selectedFolder = null;
      }, folder ? '素材文件夹已删除' : '图片素材已删除'));
  }

  editImage(name: string): void {
    const bytes = this.getContext().assets.get(name); if (!bytes) return;
    const content = showDialog('编辑图片素材', '支持旋转、翻转和亮度调整；应用后保存为 PNG。');
    const canvas = document.createElement('canvas'); canvas.className = 'asset-editor-canvas'; content.append(canvas);
    const controls = document.createElement('div'); controls.className = 'asset-editor-controls';
    const rotation = document.createElement('select'); [['0', '旋转 0°'], ['90', '旋转 90°'], ['180', '旋转 180°'], ['270', '旋转 270°']].forEach(([value, label]) => rotation.append(new Option(label, value)));
    const flip = document.createElement('select'); [['none', '不翻转'], ['x', '水平翻转'], ['y', '垂直翻转']].forEach(([value, label]) => flip.append(new Option(label, value)));
    const brightness = document.createElement('input'); brightness.type = 'range'; brightness.min = '0'; brightness.max = '200'; brightness.value = '100'; brightness.setAttribute('aria-label', '亮度');
    controls.append(rotation, flip, brightness); content.append(controls);
    const source = new Image(), url = createUrl(bytes, name); source.src = url;
    const modal = document.querySelector<HTMLDialogElement>('#modal')!;
    modal.addEventListener('close', () => URL.revokeObjectURL(url), { once: true });
    const draw = (): void => {
      if (!source.naturalWidth) return;
      const angle = Number(rotation.value), quarter = angle % 180 !== 0, width = quarter ? source.naturalHeight : source.naturalWidth, height = quarter ? source.naturalWidth : source.naturalHeight;
      const scale = Math.min(1, 900 / width, 650 / height); canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
      const context = canvas.getContext('2d')!; context.save(); context.translate(canvas.width / 2, canvas.height / 2); context.rotate(angle * Math.PI / 180);
      context.scale((flip.value === 'x' ? -1 : 1) * scale, (flip.value === 'y' ? -1 : 1) * scale); context.filter = 'brightness(' + brightness.value + '%)';
      context.drawImage(source, -source.naturalWidth / 2, -source.naturalHeight / 2); context.restore();
    };
    source.onload = draw; rotation.onchange = draw; flip.onchange = draw; brightness.oninput = draw;
    const apply = document.querySelector<HTMLButtonElement>('#modal-apply')!; apply.hidden = false; apply.onclick = async () => {
      apply.disabled = true;
      try {
        if (!source.naturalWidth) throw Error('图片尚未加载完成');
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png')); if (!blob) throw Error('图片导出失败');
        const editedName = /\.png$/i.test(name) ? name : name.replace(/\.[^.]+$/, '') + '.png';
        const updated = new Uint8Array(await blob.arrayBuffer());
        await this.mutate((next, folders) => {
          if (name !== editedName && [...next.keys(), ...folders].some(path => pathKey(path) === pathKey(editedName))) throw Error('同名 PNG 已存在，请先重命名图片');
          next.delete(name); next.set(editedName, updated); this.selected = editedName; collectAssetFolders(editedName, folders);
          return new Map([[name, editedName]]);
        }, '图片编辑已应用');
        modal.close();
      } catch (error) { document.querySelector<HTMLElement>('#modal-error')!.textContent = errorMessage(error); }
      finally { apply.disabled = false; }
    };
  }

  boundLines(name: string): string[] {
    const context = this.getContext();
    return (context.chart?.judgeLineList ?? []).flatMap((line, index) =>
      assetPath(context.assets, line.Texture, context.chartName) === name ? [String(index)] : []);
  }

  render(): void {
    const context = this.getContext(); if (!context) return;
    const scroll = this.host.querySelector<HTMLElement>('.asset-tree')?.scrollTop ?? 0;
    this.disposeUrls(); this.host.replaceChildren();
    const entries = libraryImages(context.assets, context.chart, context.chartName).sort(([a], [b]) => a.localeCompare(b));
    const title = document.createElement('div'); title.className = 'panel-title'; const count = document.createElement('small'); count.textContent = entries.length + ' 张图片'; title.append('素材库', count); this.host.append(title);
    const actions = document.createElement('div'); actions.className = 'asset-library-actions';
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'; input.multiple = true; input.hidden = true;
    input.onchange = () => this.addFiles(input.files).catch(error => this.notify(errorMessage(error), 'error'));
    this.action('添加图片', () => input.click(), actions);
    const directory = document.createElement('input') as DirectoryInput; directory.type = 'file'; directory.multiple = true; directory.webkitdirectory = true; directory.hidden = true;
    directory.onchange = () => this.addFiles(directory.files).catch(error => this.notify(errorMessage(error), 'error'));
    this.action('扫描文件夹', () => directory.click(), actions); this.action('新建文件夹', () => this.createFolder(), actions); this.host.append(actions, input, directory);
    const tree = document.createElement('div'); tree.className = 'asset-tree';
    const root: AssetFolderNode = { folders: new Map(), files: [] }, ensureFolder = (node: AssetFolderNode, parts: string[]): AssetFolderNode => {
      for (const part of parts) { if (!node.folders.has(part)) node.folders.set(part, { folders: new Map(), files: [] }); node = node.folders.get(part)!; } return node;
    };
    for (const folderPath of libraryFolders(context.assets, context.folders, context.chart, context.chartName)) ensureFolder(root, slashPath(folderPath).split('/'));
    for (const [name, bytes] of entries) { const parts = slashPath(name).split('/'), file = parts.pop()!; ensureFolder(root, parts).files.push([name, file, bytes]); }
    const createRow = ([name, file, bytes]: AssetFileEntry): HTMLButtonElement => {
      const row = document.createElement('button'); row.type = 'button'; row.dataset.assetPath = name; row.className = 'asset-row' + (this.selected === name ? ' selected' : '');
      const url = createUrl(bytes, name); this.urls.push(url); const thumb = document.createElement('img'); thumb.src = url; thumb.alt = file; thumb.loading = 'lazy';
      const label = document.createElement('span'); label.textContent = file; const bindings = this.boundLines(name), usage = document.createElement('small');
      usage.textContent = bindings.length ? '绑定：' + bindings.join('、') : '未绑定'; row.append(thumb, label, usage); row.title = name;
      row.onclick = () => { this.selected = name; this.selectedFolder = null; this.render(); }; return row;
    };
    const countFiles = (node: AssetFolderNode): number => node.files.length + [...node.folders.values()].reduce((sum, child) => sum + countFiles(child), 0);
    const renderNode = (node: AssetFolderNode, label: string, path = ''): HTMLElement => {
      const group = document.createElement('details'); group.open = !this.collapsed.has(path);
      group.className = 'asset-folder' + (this.selectedFolder === path ? ' selected' : ''); group.dataset.assetFolder = path;
      const summary = document.createElement('summary'); summary.textContent = label + ' · ' + countFiles(node) + ' 张';
      summary.onclick = event => {
        event.preventDefault(); this.selectedFolder = path; this.selected = null;
        if (group.open) this.collapsed.add(path); else this.collapsed.delete(path);
        this.render();
      };
      group.append(summary);
      if (node.files.length) { const rows = document.createElement('div'); rows.className = 'asset-folder-items'; node.files.forEach(file => rows.append(createRow(file))); group.append(rows); }
      for (const [childName, child] of [...node.folders.entries()].sort(([a], [b]) => a.localeCompare(b))) group.append(renderNode(child, childName, (path ? path + '/' : '') + childName));
      return group;
    };
    tree.append(renderNode(root, '根目录'));
    if (!entries.length) { const empty = document.createElement('p'); empty.className = 'hint'; empty.textContent = '暂无图片素材。可以添加图片或扫描一个文件夹。'; tree.append(empty); }
    this.host.append(tree); tree.scrollTop = scroll;
    if (this.selected && entries.some(([name]) => name === this.selected)) this.renderDetails(this.selected, context.assets.get(this.selected)!);
    else if (this.selectedFolder !== null) this.renderFolder(this.selectedFolder, entries);
  }

  openAction(path: string, folder: boolean, actions: HTMLElement): void {
    if (!this.openFolder) return;
    const button = this.action(folder ? '打开文件夹' : '打开所在文件夹', () => this.openFolder?.(path, folder), actions);
    button.title = '打开已保存素材的本地查看副本；修改文件后需重新导入编辑器';
  }

  renderDetails(name: string, bytes: Uint8Array): void {
    const details = document.createElement('div'); details.className = 'asset-details'; const image = document.createElement('img');
    const url = createUrl(bytes, name); this.urls.push(url); image.src = url; image.alt = name;
    const heading = document.createElement('strong'); heading.textContent = name; const usage = document.createElement('p'), lines = this.boundLines(name);
    usage.textContent = lines.length ? '绑定判定线：' + lines.join('、') : '当前没有判定线使用此素材';
    const actions = document.createElement('div'); actions.className = 'asset-detail-actions';
    this.action('重命名', () => this.renamePath(name), actions); this.action('移动到', () => this.moveDialog(name), actions);
    this.action('编辑图片', () => this.editImage(name), actions); this.action('删除', () => this.deletePath(name), actions); this.openAction(name, false, actions);
    details.append(heading, image, usage, actions); this.host.append(details);
  }

  renderFolder(path: string, entries: [string, Uint8Array][]): void {
    const details = document.createElement('div'); details.className = 'asset-details'; const heading = document.createElement('strong'); heading.textContent = path || '根目录';
    const count = document.createElement('p'); count.textContent = entries.filter(([name]) => withinFolder(name, path)).length + ' 张图片（含子文件夹）';
    const actions = document.createElement('div'); actions.className = 'asset-detail-actions';
    this.action('新建子文件夹', () => this.createFolder(path), actions);
    if (path) {
      this.action('重命名', () => this.renamePath(path, true), actions); this.action('移动到', () => this.moveDialog(path, true), actions);
      this.action('删除文件夹', () => this.deletePath(path, true), actions);
    }
    this.openAction(path, true, actions); details.append(heading, count, actions); this.host.append(details);
  }
}
