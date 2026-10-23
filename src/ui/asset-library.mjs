import { showDialog } from './dialog.mjs';
import { assetPath, mediaType } from '../platform/files.mjs';
import { IMAGE_EXTENSION, slashPath, pathKey, parentFolder, withinFolder, validAssetPath, collectAssetFolders,
  noiseSkinRoots, skinOwnedPath, libraryImages, libraryFolders, assertImageFolder, moveLibraryPaths } from '../core/asset-library.mjs';
import { t } from '../i18n.mjs';

function createUrl(bytes, name) { return URL.createObjectURL(new Blob([bytes], { type: mediaType(name) })); }

export class AssetLibraryPanel {
  constructor(host, getContext, { notify = () => {}, onChange = () => {}, openFolder } = {}) {
    this.host = host; this.getContext = getContext; this.notify = notify; this.onChange = onChange; this.openFolder = openFolder;
    this.selected = null; this.selectedFolder = null; this.urls = []; this.collapsed = new Set();
  }

  disposeUrls() { for (const url of this.urls) URL.revokeObjectURL(url); this.urls = []; }

  async mutate(mutator, message = t('asset-library.s1ba86ae')) {
    const context = this.getContext(), next = new Map(context.assets ?? []), folders = new Set(context.folders ?? []);
    const paths = await mutator(next, folders);
    if (this.getContext().assets !== context.assets) throw Error(t('asset-library.sd2ebbb3'));
    await this.changed(next, folders, paths, message);
  }

  async changed(assets, folders, paths, message) {
    await this.onChange(assets, folders, paths);
    this.notify(message, 'success'); this.render();
  }

  action(label, callback, host) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
    button.onclick = () => {
      try { Promise.resolve(callback()).catch(error => this.notify(error.message, 'error')); }
      catch (error) { this.notify(error.message, 'error'); }
    };
    host.append(button); return button;
  }

  async addFiles(files, destination = this.selectedFolder ?? parentFolder(this.selected ?? '')) {
    const images = [...files].filter(file => IMAGE_EXTENSION.test(file.name));
    if (!images.length) return this.notify(t('asset-library.sd5bd4ef'), 'warning');
    return this.mutate(async (next, folders) => {
      let first;
      for (const file of images) {
        let path = validAssetPath((destination ? destination + '/' : '') + slashPath(file.webkitRelativePath || file.name));
        if (skinOwnedPath(path, noiseSkinRoots(next, this.getContext().chart, this.getContext().chartName))) throw Error(t('asset-library.sdc0551f'));
        const occupied = new Set([...next.keys(), ...folders].map(pathKey));
        const dot = path.lastIndexOf('.'), stem = path.slice(0, dot), extension = path.slice(dot); let index = 2;
        while (occupied.has(pathKey(path))) path = stem + '-' + index++ + extension;
        for (let parent = parentFolder(path); parent; parent = parentFolder(parent)) if ([...next.keys()].some(name => pathKey(name) === pathKey(parent))) throw Error(t('asset-library.s537d637'));
        next.set(path, new Uint8Array(await file.arrayBuffer())); collectAssetFolders(path, folders); first ??= path;
      }
      this.selected = first; this.selectedFolder = null;
    }, t('asset-library.scb9c5ec') + images.length + t('asset-library.s32c3e5b'));
  }

  dialog(title, description, control, callback) {
    const content = showDialog(title, description); content.append(control);
    const apply = document.querySelector('#modal-apply'); apply.hidden = false; apply.onclick = async () => {
      apply.disabled = true;
      try { await callback(); document.querySelector('#modal').close(); }
      catch (error) { document.querySelector('#modal-error').textContent = error.message; }
      finally { apply.disabled = false; }
    };
    control.focus();
  }

  createFolder(parent = this.selectedFolder ?? '') {
    const input = document.createElement('input'); input.type = 'text'; input.value = parent ? parent + '/' : '';
    input.placeholder = t('asset-library.s3190d2c'); input.setAttribute('aria-label', t('asset-library.sc9121d4'));
    this.dialog(t('asset-library.sd1f3790'), t('asset-library.sce101e7'), input, () => this.mutate((next, folders) => {
      const name = validAssetPath(input.value), roots = noiseSkinRoots(next, this.getContext().chart, this.getContext().chartName);
      if (skinOwnedPath(name, roots)) throw Error(t('asset-library.s0876f24'));
      if ([...libraryFolders(next, folders), ...next.keys()].some(path => pathKey(path) === pathKey(name))) throw Error(t('asset-library.s24010b7'));
      for (let path = name; path; path = parentFolder(path)) if ([...next.keys()].some(item => pathKey(item) === pathKey(path))) throw Error(t('asset-library.s537d637'));
      collectAssetFolders(name + '/_', folders); this.selected = null; this.selectedFolder = name;
    }, t('asset-library.s52145d5')));
  }

  async movePath(from, to, folder = false) {
    const result = moveLibraryPaths(this.getContext(), from, to, folder);
    if (folder) { this.selected = null; this.selectedFolder = to; this.collapsed.delete(to); }
    else { this.selected = to; this.selectedFolder = null; }
    await this.changed(result.assets, result.folders, result.paths, folder ? t('asset-library.s828fd71') : t('asset-library.scd23aea'));
  }

  renamePath(name, folder = false) {
    const input = document.createElement('input'); input.type = 'text'; input.value = name.split('/').at(-1); input.setAttribute('aria-label', t('asset-library.sdd74a1b'));
    this.dialog(folder ? t('asset-library.s6c29bd8') : t('asset-library.sd54b676'), t('asset-library.s4369781'), input, () => {
      const leaf = validAssetPath(input.value); if (leaf.includes('/')) throw Error(t('asset-library.sab4d974'));
      const parent = parentFolder(name); return this.movePath(name, (parent ? parent + '/' : '') + leaf, folder);
    });
  }

  moveDialog(name, folder = false) {
    const context = this.getContext(), select = document.createElement('select'); select.setAttribute('aria-label', t('asset-library.sb3bdd5d'));
    select.append(new Option(t('asset-library.s18755ac'), ''));
    for (const path of [...libraryFolders(context.assets, context.folders, context.chart, context.chartName)].sort()) {
      if (folder && (pathKey(path) === pathKey(name) || withinFolder(path, name))) continue;
      select.append(new Option(path, path));
    }
    select.value = parentFolder(name);
    this.dialog(folder ? t('asset-library.s0a848c0') : t('asset-library.s063dd7e'), t('asset-library.s848923c'), select,
      () => this.movePath(name, (select.value ? select.value + '/' : '') + name.split('/').at(-1), folder));
  }

  deletePath(name, folder = false) {
    const context = this.getContext(); if (folder) assertImageFolder(context, name);
    const names = [...context.assets.keys()].filter(path => folder ? withinFolder(path, name) : path === name);
    const content = document.createElement('p'); content.textContent = folder ? t('asset-library.s3818597') + names.length + t('asset-library.sbaff198') : name;
    this.dialog(folder ? t('asset-library.s235bf79') : t('asset-library.s536ae02'), t('asset-library.s6f2c401'), content,
      () => this.mutate((next, folders) => {
        names.forEach(path => next.delete(path));
        if (folder) for (const path of folders) if (path === name || withinFolder(path, name)) folders.delete(path);
        this.selected = null; this.selectedFolder = null;
      }, folder ? t('asset-library.s0dc77cb') : t('asset-library.sac20814')));
  }

  editImage(name) {
    const bytes = this.getContext().assets.get(name); if (!bytes) return;
    const content = showDialog(t('asset-library.s8d45b68'), t('asset-library.sedb6a16'));
    const canvas = document.createElement('canvas'); canvas.className = 'asset-editor-canvas'; content.append(canvas);
    const controls = document.createElement('div'); controls.className = 'asset-editor-controls';
    const rotation = document.createElement('select'); [['0', t('asset-library.s320fe78')], ['90', t('asset-library.s8067702')], ['180', t('asset-library.sd07fa32')], ['270', t('asset-library.sabddd77')]].forEach(([value, label]) => rotation.append(new Option(label, value)));
    const flip = document.createElement('select'); [['none', t('asset-library.s70aef66')], ['x', t('asset-library.s46ed193')], ['y', t('asset-library.s43c9862')]].forEach(([value, label]) => flip.append(new Option(label, value)));
    const brightness = document.createElement('input'); brightness.type = 'range'; brightness.min = 0; brightness.max = 200; brightness.value = 100; brightness.setAttribute('aria-label', t('asset-library.s5d41988'));
    controls.append(rotation, flip, brightness); content.append(controls);
    const source = new Image(), url = createUrl(bytes, name); source.src = url;
    const modal = document.querySelector('#modal');
    modal.addEventListener('close', () => URL.revokeObjectURL(url), { once: true });
    const draw = () => {
      if (!source.naturalWidth) return;
      const angle = Number(rotation.value), quarter = angle % 180 !== 0, width = quarter ? source.naturalHeight : source.naturalWidth, height = quarter ? source.naturalWidth : source.naturalHeight;
      const scale = Math.min(1, 900 / width, 650 / height); canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
      const context = canvas.getContext('2d'); context.save(); context.translate(canvas.width / 2, canvas.height / 2); context.rotate(angle * Math.PI / 180);
      context.scale((flip.value === 'x' ? -1 : 1) * scale, (flip.value === 'y' ? -1 : 1) * scale); context.filter = 'brightness(' + brightness.value + '%)';
      context.drawImage(source, -source.naturalWidth / 2, -source.naturalHeight / 2); context.restore();
    };
    source.onload = draw; rotation.onchange = draw; flip.onchange = draw; brightness.oninput = draw;
    const apply = document.querySelector('#modal-apply'); apply.hidden = false; apply.onclick = async () => {
      apply.disabled = true;
      try {
        if (!source.naturalWidth) throw Error(t('asset-library.saf6b449'));
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png')); if (!blob) throw Error(t('asset-library.s67878ed'));
        const editedName = /\.png$/i.test(name) ? name : name.replace(/\.[^.]+$/, '') + '.png';
        const updated = new Uint8Array(await blob.arrayBuffer());
        await this.mutate((next, folders) => {
          if (name !== editedName && [...next.keys(), ...folders].some(path => pathKey(path) === pathKey(editedName))) throw Error(t('asset-library.s7eb79df'));
          next.delete(name); next.set(editedName, updated); this.selected = editedName; collectAssetFolders(editedName, folders);
          return new Map([[name, editedName]]);
        }, t('asset-library.s3daf4e2'));
        modal.close();
      } catch (error) { document.querySelector('#modal-error').textContent = error.message; }
      finally { apply.disabled = false; }
    };
  }

  boundLines(name) {
    const context = this.getContext();
    return (context.chart?.judgeLineList ?? []).flatMap((line, index) =>
      assetPath(context.assets, line.Texture, context.chartName) === name ? [String(index)] : []);
  }

  render() {
    const context = this.getContext(); if (!context) return;
    const scroll = this.host.querySelector('.asset-tree')?.scrollTop ?? 0;
    this.disposeUrls(); this.host.replaceChildren();
    const entries = libraryImages(context.assets, context.chart, context.chartName).sort(([a], [b]) => a.localeCompare(b));
    const title = document.createElement('div'); title.className = 'panel-title'; const count = document.createElement('small'); count.textContent = entries.length + t('asset-library.s5d8bb92'); title.append(t('asset-library.s885200a'), count); this.host.append(title);
    const actions = document.createElement('div'); actions.className = 'asset-library-actions';
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'; input.multiple = true; input.hidden = true;
    input.onchange = () => this.addFiles(input.files).catch(error => this.notify(error.message, 'error'));
    this.action(t('asset-library.se539301'), () => input.click(), actions);
    const directory = document.createElement('input'); directory.type = 'file'; directory.multiple = true; directory.webkitdirectory = true; directory.hidden = true;
    directory.onchange = () => this.addFiles(directory.files).catch(error => this.notify(error.message, 'error'));
    this.action(t('asset-library.s6b64de2'), () => directory.click(), actions); this.action(t('asset-library.s95cf3cd'), () => this.createFolder(), actions); this.host.append(actions, input, directory);
    const tree = document.createElement('div'); tree.className = 'asset-tree';
    const root = { folders: new Map(), files: [] }, ensureFolder = (node, parts) => {
      for (const part of parts) { if (!node.folders.has(part)) node.folders.set(part, { folders: new Map(), files: [] }); node = node.folders.get(part); } return node;
    };
    for (const folderPath of libraryFolders(context.assets, context.folders, context.chart, context.chartName)) ensureFolder(root, slashPath(folderPath).split('/'));
    for (const [name, bytes] of entries) { const parts = slashPath(name).split('/'), file = parts.pop(); ensureFolder(root, parts).files.push([name, file, bytes]); }
    const createRow = ([name, file, bytes]) => {
      const row = document.createElement('button'); row.type = 'button'; row.dataset.assetPath = name; row.className = 'asset-row' + (this.selected === name ? ' selected' : '');
      const url = createUrl(bytes, name); this.urls.push(url); const thumb = document.createElement('img'); thumb.src = url; thumb.alt = file; thumb.loading = 'lazy';
      const label = document.createElement('span'); label.textContent = file; const bindings = this.boundLines(name), usage = document.createElement('small');
      usage.textContent = bindings.length ? t('asset-library.scc8abc1') + bindings.join('、') : t('asset-library.s3bf179d'); row.append(thumb, label, usage); row.title = name;
      row.onclick = () => { this.selected = name; this.selectedFolder = null; this.render(); }; return row;
    };
    const countFiles = node => node.files.length + [...node.folders.values()].reduce((sum, child) => sum + countFiles(child), 0);
    const renderNode = (node, label, path = '') => {
      const group = document.createElement('details'); group.open = !this.collapsed.has(path);
      group.className = 'asset-folder' + (this.selectedFolder === path ? ' selected' : ''); group.dataset.assetFolder = path;
      const summary = document.createElement('summary'); summary.textContent = label + ' · ' + countFiles(node) + t('asset-library.s972cc4b');
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
    tree.append(renderNode(root, t('asset-library.s18755ac')));
    if (!entries.length) { const empty = document.createElement('p'); empty.className = 'hint'; empty.textContent = t('asset-library.s25c3efc'); tree.append(empty); }
    this.host.append(tree); tree.scrollTop = scroll;
    if (this.selected && entries.some(([name]) => name === this.selected)) this.renderDetails(this.selected, context.assets.get(this.selected));
    else if (this.selectedFolder !== null) this.renderFolder(this.selectedFolder, entries);
  }

  openAction(path, folder, actions) {
    if (!this.openFolder) return;
    const button = this.action(folder ? t('asset-library.s3120403') : t('asset-library.sba54ce3'), () => this.openFolder(path, folder), actions);
    button.title = t('asset-library.s1a75e22');
  }

  renderDetails(name, bytes) {
    const details = document.createElement('div'); details.className = 'asset-details'; const image = document.createElement('img');
    const url = createUrl(bytes, name); this.urls.push(url); image.src = url; image.alt = name;
    const heading = document.createElement('strong'); heading.textContent = name; const usage = document.createElement('p'), lines = this.boundLines(name);
    usage.textContent = lines.length ? t('asset-library.s239c1de') + lines.join('、') : t('asset-library.s6cc7aa5');
    const actions = document.createElement('div'); actions.className = 'asset-detail-actions';
    this.action(t('asset-library.s1cd80fd'), () => this.renamePath(name), actions); this.action(t('asset-library.sac9d34f'), () => this.moveDialog(name), actions);
    this.action(t('asset-library.s496f841'), () => this.editImage(name), actions); this.action(t('asset-library.s3755f56'), () => this.deletePath(name), actions); this.openAction(name, false, actions);
    details.append(heading, image, usage, actions); this.host.append(details);
  }

  renderFolder(path, entries) {
    const details = document.createElement('div'); details.className = 'asset-details'; const heading = document.createElement('strong'); heading.textContent = path || t('asset-library.s18755ac');
    const count = document.createElement('p'); count.textContent = entries.filter(([name]) => withinFolder(name, path)).length + t('asset-library.s432f6e8');
    const actions = document.createElement('div'); actions.className = 'asset-detail-actions';
    this.action(t('asset-library.sa48b827'), () => this.createFolder(path), actions);
    if (path) {
      this.action(t('asset-library.s1cd80fd'), () => this.renamePath(path, true), actions); this.action(t('asset-library.sac9d34f'), () => this.moveDialog(path, true), actions);
      this.action(t('asset-library.s0bc1638'), () => this.deletePath(path, true), actions);
    }
    this.openAction(path, true, actions); details.append(heading, count, actions); this.host.append(details);
  }
}
