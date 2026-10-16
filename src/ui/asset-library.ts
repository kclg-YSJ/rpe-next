import { showDialog } from './dialog.ts';
import { mediaType } from '../platform/files.ts';
import type { Chart } from '../core/types.ts';

/** The image formats the library accepts, matched against the asset name. */
const IMAGE_EXTENSIONS = /\.(png|jpe?g|webp|gif|bmp|avif)$/i;

/** The asset map the library edits: archive-relative path to raw bytes. */
type Assets = Map<string, Uint8Array>;

/** The folders the library shows, as a set of archive-relative paths. */
type Folders = Set<string>;

/** What the panel reads off the editor when it renders or mutates. */
export interface AssetLibraryContext {
  assets: Assets;
  /**
   * Optional because the panel keeps the `?? []` fallbacks the original code had: the caller always
   * supplies a set, but the reads below tolerate its absence.
   */
  folders?: Folders;
  chart: Chart;
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

/** A file the browser handed over, carrying its picker-relative path. */
interface BrowserFile extends File {
  webkitRelativePath: string;
}

/** Normalizes an asset name to forward slashes; a missing name becomes the empty string. */
function imageName(path: string | null | undefined): string { return String(path ?? '').replaceAll('\\', '/'); }

/** The image entries of an asset map, in map order. */
function imageEntries(assets: Assets | undefined): [string, Uint8Array][] { return [...(assets ?? [])].filter(([name]) => IMAGE_EXTENSIONS.test(imageName(name))); }

/** An object URL for one asset, typed with the media type its name implies. */
function createUrl(bytes: Uint8Array, name: string): string {
  // `Blob` accepts any buffer view at runtime; the cast names the backing store `Uint8Array` is
  // generic over under the current `lib`, which `BlobPart` does not spell out.
  return URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: mediaType(name) }));
}

export class AssetLibraryPanel {
  // Every field is declared explicitly: an unannotated field would be inferred too narrowly (a
  // `null` literal, or an empty array inferring `never[]`), which cascades into the callers.
  host: HTMLElement;
  getContext: () => AssetLibraryContext;
  notify: (message: string, level?: string) => void;
  onChange: (assets: Assets, folders: Folders) => void;
  onTexture: (name: string, nextName?: string) => void;
  selected: string | null;
  urls: string[];

  constructor(host: HTMLElement, getContext: () => AssetLibraryContext, { notify = () => {}, onChange = () => {}, onTexture = () => {} }: {
    notify?: (message: string, level?: string) => void;
    onChange?: (assets: Assets, folders: Folders) => void;
    onTexture?: (name: string, nextName?: string) => void;
  } = {}) {
    this.host = host; this.getContext = getContext; this.notify = notify; this.onChange = onChange; this.onTexture = onTexture;
    this.selected = null; this.urls = [];
  }

  disposeUrls(): void { for (const url of this.urls) URL.revokeObjectURL(url); this.urls = []; }

  async mutate(mutator: (next: Assets, folders: Folders) => void | Promise<void>, message = '素材库已更新'): Promise<void> {
    const context = this.getContext(); const next = new Map(context.assets ?? []); const folders = new Set(context.folders ?? []);
    await mutator(next, folders);
    this.onChange(next, folders); this.notify(message, 'success'); this.render();
  }

  imagePath(file: BrowserFile): string {
    const relative = imageName(file.webkitRelativePath || file.name).replace(/^\/+/, '');
    return relative || file.name;
  }

  collectFolders(path: string, folders: Folders): void {
    const parts = imageName(path).split('/'); parts.pop();
    for (let index = 1; index <= parts.length; index++) folders.add(parts.slice(0, index).join('/'));
  }

  addFiles(files: FileList | null): unknown {
    const images = [...files ?? []].filter(file => IMAGE_EXTENSIONS.test(file.name));
    if (!images.length) return this.notify('没有找到支持的图片格式', 'warning');
    return this.mutate(async (next, folders) => {
      for (const file of images as BrowserFile[]) {
        let path = this.imagePath(file); const bytes = new Uint8Array(await file.arrayBuffer());
        if (next.has(path)) { const dot = path.lastIndexOf('.'); const stem = dot < 0 ? path : path.slice(0, dot); const extension = dot < 0 ? '' : path.slice(dot); let index = 2; while (next.has(`${stem}-${index}${extension}`)) index++; path = `${stem}-${index}${extension}`; }
        next.set(path, bytes); this.collectFolders(path, folders);
      }
      this.selected = imageName(this.imagePath(images[0] as BrowserFile));
    }, `已添加 ${images.length} 个图片素材`);
  }

  createFolder(): void {
    const content = showDialog('新建素材文件夹', '文件夹用于整理素材，名称只允许使用普通路径字符。');
    const input = document.createElement('input'); input.type = 'text'; input.placeholder = '例如：lines/season-1'; input.setAttribute('aria-label', '素材文件夹名称'); content.append(input);
    const apply = modalApply(); apply.hidden = false; apply.onclick = () => {
      const name = imageName(input.value).replace(/^\/+|\/+$/g, '');
      if (!name || name.split('/').some(part => !part || part === '.' || part === '..')) { modalError().textContent = '请输入有效的文件夹名称'; return; }
      this.mutate((next, folders) => { this.collectFolders(`${name}/placeholder.png`, folders); folders.add(name); }, '已新建素材文件夹').then(() => modal().close()).catch(error => { modalError().textContent = errorMessage(error); });
    };
    input.focus();
  }

  renameImage(name: string): void {
    const content = showDialog('重命名图片素材', '会同步更新引用该素材的判定线贴图。');
    const input = document.createElement('input'); input.type = 'text'; input.value = name; input.setAttribute('aria-label', '新素材名称'); content.append(input);
    const apply = modalApply(); apply.hidden = false; apply.onclick = () => {
      const nextName = imageName(input.value).replace(/^\/+|\/+$/g, '');
      if (!nextName || !IMAGE_EXTENSIONS.test(nextName) || nextName.includes('..')) { modalError().textContent = '请输入带图片扩展名的有效名称'; return; }
      this.mutate((next, folders) => {
        if (nextName !== name && next.has(nextName)) throw new Error('目标文件名已存在');
        const bytes = next.get(name) as Uint8Array; next.delete(name); next.set(nextName, bytes); this.collectFolders(nextName, folders);
        this.onTexture(name, nextName);
        this.selected = nextName;
      }, '已重命名图片素材').then(() => modal().close()).catch(error => { modalError().textContent = errorMessage(error); });
    };
    input.focus();
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
    const source = new Image(); const url = createUrl(bytes, name); this.urls.push(url); source.src = url;
    const draw = () => {
      if (!source.naturalWidth) return;
      const angle = Number(rotation.value); const quarter = angle % 180 !== 0; const width = quarter ? source.naturalHeight : source.naturalWidth; const height = quarter ? source.naturalWidth : source.naturalHeight;
      canvas.width = Math.min(900, width); canvas.height = Math.min(650, height); const context = canvas.getContext('2d')!; context.save(); context.translate(canvas.width / 2, canvas.height / 2); context.rotate(angle * Math.PI / 180); const scale = Math.min(canvas.width / source.naturalWidth, canvas.height / source.naturalHeight); context.scale((flip.value === 'x' ? -1 : 1) * scale, (flip.value === 'y' ? -1 : 1) * scale); context.filter = `brightness(${brightness.value}%)`; context.drawImage(source, -source.naturalWidth / 2, -source.naturalHeight / 2); context.restore();
    };
    source.onload = draw; rotation.onchange = draw; flip.onchange = draw; brightness.oninput = draw;
    const apply = modalApply(); apply.hidden = false; apply.onclick = async () => {
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob) { modalError().textContent = '图片导出失败'; return; }
      const editedName = /\.png$/i.test(name) ? name : name.replace(/\.[^.]+$/, '') + '.png';
      const updated = new Uint8Array(await blob.arrayBuffer());
      await this.mutate((next, folders) => { next.delete(name); next.set(editedName, updated); this.selected = editedName; this.collectFolders(editedName, folders); this.onTexture(name, editedName); }, '图片编辑已应用');
      modal().close();
    };
  }

  boundLines(name: string): string[] {
    const context = this.getContext(); const normalized = imageName(name).toLowerCase(); const base = normalized.split('/').at(-1);
    return (context.chart?.judgeLineList ?? []).flatMap((line, index) => {
      const texture = imageName(line.Texture ?? '').toLowerCase();
      return texture === normalized || texture.split('/').at(-1) === base ? [String(index)] : [];
    });
  }

  render(): void {
    const context = this.getContext(); if (!context) return; this.disposeUrls(); this.host.replaceChildren();
    const title = document.createElement('div'); title.className = 'panel-title'; const count = document.createElement('small'); count.textContent = `${imageEntries(context.assets).length} 张图片`; title.append('素材库', count); this.host.append(title);
    const actions = document.createElement('div'); actions.className = 'asset-library-actions';
    const add = document.createElement('button'); add.type = 'button'; add.textContent = '添加图片'; const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'; input.multiple = true; input.hidden = true; input.onchange = () => this.addFiles(input.files); add.onclick = () => input.click();
    const scan = document.createElement('button'); scan.type = 'button'; scan.textContent = '扫描文件夹'; const directory = document.createElement('input') as DirectoryInput; directory.type = 'file'; directory.multiple = true; directory.webkitdirectory = true; directory.hidden = true; directory.onchange = () => this.addFiles(directory.files); scan.onclick = () => directory.click();
    const folder = document.createElement('button'); folder.type = 'button'; folder.textContent = '新建文件夹'; folder.onclick = () => this.createFolder(); actions.append(add, scan, folder); this.host.append(actions); this.host.append(input, directory);
    const tree = document.createElement('div'); tree.className = 'asset-tree'; const entries = imageEntries(context.assets).sort(([left], [right]) => left.localeCompare(right));
    const root: AssetFolderNode = { folders: new Map(), files: [] }; const ensureFolder = (node: AssetFolderNode, parts: string[]): AssetFolderNode => { for (const part of parts) { if (!node.folders.has(part)) node.folders.set(part, { folders: new Map(), files: [] }); node = node.folders.get(part)!; } return node; };
    for (const folderPath of context.folders ?? []) ensureFolder(root, imageName(folderPath).split('/').filter(Boolean));
    for (const [name, bytes] of entries) { const parts = imageName(name).split('/'); const file = parts.pop()!; ensureFolder(root, parts).files.push([name, file, bytes]); }
    const createRow = ([name, file, bytes]: AssetFileEntry) => {
      const row = document.createElement('button'); row.type = 'button'; row.className = `asset-row${this.selected === name ? ' selected' : ''}`; const url = createUrl(bytes, name); this.urls.push(url); const thumb = document.createElement('img'); thumb.src = url; thumb.alt = file; const label = document.createElement('span'); label.textContent = file; const bindings = this.boundLines(name); const usage = document.createElement('small'); usage.textContent = bindings.length ? `绑定：${bindings.join('、')}` : '未绑定'; row.append(thumb, label, usage); row.title = bindings.length ? bindings.join('、') : '未绑定判定线'; row.onclick = () => { this.selected = name; this.onTexture(name); this.render(); }; return row;
    };
    const countFiles = (node: AssetFolderNode): number => node.files.length + [...node.folders.values()].reduce((sum, child) => sum + countFiles(child), 0);
    const renderNode = (node: AssetFolderNode, label: string, rootNode = false): HTMLElement => {
      const group = document.createElement('details'); group.open = true; group.className = 'asset-folder'; const summary = document.createElement('summary'); summary.textContent = `${label} · ${countFiles(node)} 张`; group.append(summary);
      if (node.files.length) { const rows = document.createElement('div'); rows.className = 'asset-folder-items'; node.files.forEach(file => rows.append(createRow(file))); group.append(rows); }
      for (const [childName, child] of [...node.folders.entries()].sort(([left], [right]) => left.localeCompare(right))) group.append(renderNode(child, childName));
      return group;
    };
    // `folders` is a `Set`, so the original `(context.folders ?? []).length` read was always
    // `undefined` and this condition has always been decided by `entries.length` alone. The read is
    // kept verbatim (through an `unknown` local) rather than corrected, because changing it would
    // change when the root folder appears.
    const folderCount: unknown = (context.folders ?? ([] as unknown[])) as unknown;
    if (entries.length || (folderCount as { length?: number }).length) tree.append(renderNode(root, '根目录', true));
    if (!entries.length) { const empty = document.createElement('p'); empty.className = 'hint'; empty.textContent = '暂无图片素材。可以添加图片或扫描一个文件夹。'; tree.append(empty); }
    this.host.append(tree);
    if (this.selected && context.assets.has(this.selected)) this.renderDetails(this.selected, context.assets.get(this.selected) as Uint8Array);
  }

  renderDetails(name: string, bytes: Uint8Array): void {
    const details = document.createElement('div'); details.className = 'asset-details'; const image = document.createElement('img'); const url = createUrl(bytes, name); this.urls.push(url); image.src = url; image.alt = name; const heading = document.createElement('strong'); heading.textContent = name; const usage = document.createElement('p'); usage.textContent = this.boundLines(name).length ? `绑定判定线：${this.boundLines(name).join('、')}` : '当前没有判定线使用此素材'; const actions = document.createElement('div'); actions.className = 'asset-detail-actions'; for (const [label, callback] of [['重命名', () => this.renameImage(name)], ['编辑图片', () => this.editImage(name)], ['删除', () => this.mutate((next) => { next.delete(name); this.selected = null; }, '图片素材已删除')]] as [string, () => void][]) { const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.onclick = callback; actions.append(button); } details.append(heading, image, usage, actions); this.host.append(details);
  }
}

/** The modal's apply button, which the dialogs above wire up after `showDialog` opens them. */
function modalApply(): HTMLButtonElement { return document.querySelector('#modal-apply') as HTMLButtonElement; }
/** The modal's inline error line, where the validation branches above report. */
function modalError(): HTMLElement { return document.querySelector('#modal-error') as HTMLElement; }

/** The modal dialog element itself, closed once an apply handler finishes. */
function modal(): HTMLDialogElement { return document.querySelector('#modal') as HTMLDialogElement; }

/** A caught value's message, matching the `error.message` reads the handlers used before. */
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
