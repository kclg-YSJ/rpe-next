import { noiseLayers, noiseLayerId, withNoiseLayers, parseNoiseSkin, skinPath, noiseSkinAuthor, noiseSkinLabel, noiseSkinModified, rememberedNoiseSkinSettings, switchNoiseSkin, updateNoiseSkinSettings } from '../core/noise-skin.mjs';
import { readZip } from '../platform/archive.ts';
import { loadBuiltinNoiseSkins, installBuiltinNoiseSkin, builtinNoiseSkinRoot } from '../platform/noise-skins.mjs';

const action = (text, run) => { const button = document.createElement('button'); button.type = 'button'; button.textContent = text; button.onclick = run; return button; };

export class NoiseLayerPanel {
  constructor(editor) {
    this.editor = editor; this.expanded = new Map(); this.parametersExpanded = new Map();
    this.builtins = []; this.builtinState = 'idle';
    this.element = document.createElement('section'); this.element.className = 'noise-layer-panel';
  }
  change(layer, patch, label = '编辑噪域层') {
    const editor = this.editor; editor.flush();
    const layers = noiseLayers(editor.context.session.chart);
    if (!layers.some(entry => entry.id === layer.id)) throw new Error('噪域层已删除');
    editor.commit(label, withNoiseLayers(editor.context.session.chart, layers.map(entry => entry.id === layer.id ? typeof patch === 'function' ? patch(entry) : { ...entry, ...patch } : entry)));
    editor.render(); editor.invalidate();
  }
  field(host, text, control) {
    const label = document.createElement('label'); label.className = 'noise-field'; label.append(text, control); host.append(label); return control;
  }
  loadBuiltins() {
    if (this.builtinState === 'loading' || this.builtinState === 'ready') return;
    this.builtinState = 'loading'; this.builtinError = null;
    this.builtinReady = loadBuiltinNoiseSkins().then(skins => { this.builtins = skins; this.builtinState = 'ready'; }, error => { this.builtinState = 'failed'; this.builtinError = error.message; })
      .then(() => { this.signature = null; this.render(); this.editor.invalidate(); });
  }
  useBuiltin(name, layer) {
    const editor = this.editor;
    try {
      editor.flush();
      if (!noiseLayers(editor.context.session.chart).some(entry => entry.id === layer.id)) throw new Error('接收皮肤的噪域层已删除');
      const builtin = this.builtins.find(skin => skin.name === name); if (!builtin) throw new Error('内置皮肤尚未载入');
      const { root, entries } = installBuiltinNoiseSkin(builtin, editor.getAssets());
      if (entries.size) editor.onAssets(entries);
      this.change(layer, current => switchNoiseSkin(current, root), '更换噪域皮肤');
    } catch (error) { editor.report(error); }
  }
  async import(files, zipped, layerId) {
    const editor = this.editor;
    try {
      const source = zipped ? await readZip(await files[0].arrayBuffer()) : new Map(await Promise.all([...files].map(async file => [file.webkitRelativePath || file.name, new Uint8Array(await file.arrayBuffer())])));
      const roots = [...source.keys()].filter(name => /(^|\/)main\.glsl$/.test(name));
      if (!roots.length) throw new Error('未找到 main.glsl，请选择完整的皮肤文件夹或 ZIP 包');
      const collected = new Map(); const packages = [];
      for (const main of roots) {
        const prefix = main.slice(0, -'main.glsl'.length); const name = prefix.split('/').filter(Boolean).at(-1) ?? files[0].name.replace(/\.zip$/i, '');
        const root = skinPath('shader/' + name); const relative = new Map([...source].filter(([path]) => path.startsWith(prefix) && !path.endsWith('/')).map(([path, bytes]) => [skinPath(path.slice(prefix.length)), bytes]));
        parseNoiseSkin(relative);
        if ([...relative].some(([path]) => editor.getAssets().has(root + '/' + path)) && !confirm('皮肤“' + name + '”已存在，替换其资源？')) continue;
        for (const [path, bytes] of relative) collected.set(root + '/' + path, bytes);
        packages.push(root);
      }
      if (!packages.length) return;
      const layer = noiseLayers(editor.chart).find(entry => entry.id === layerId);
      if (!layer) throw new Error('接收皮肤的噪域层已删除');
      editor.onAssets(collected); this.expanded.set(layer.id, true);
      this.change(layer, current => switchNoiseSkin(current, packages[0]), '导入噪域皮肤');
      editor.notify('已导入 ' + packages.length + ' 套噪域皮肤', 'success');
    } catch (error) { editor.report(error); }
  }
  render() {
    if (this.builtinState === 'idle') this.loadBuiltins();
    const editor = this.editor; const layers = noiseLayers(editor.chart);
    const signature = JSON.stringify([layers, [...editor.hiddenLayers], [...editor.simpleLayers], this.builtinState]); const resources = [...editor.getAssets()].filter(([path]) => path.startsWith('shader/'));
    if (this.signature === signature && resources.length === (this.resources?.length ?? 0) && resources.every(([path, bytes], index) => path === this.resources[index][0] && bytes === this.resources[index][1])) return;
    for (const card of this.element.querySelectorAll('[data-noise-layer]')) {
      this.expanded.set(card.dataset.noiseLayer, card.open);
      this.parametersExpanded.set(card.dataset.noiseLayer, card.querySelector('.noise-skin-parameters')?.open ?? false);
    }
    const scrollTop = this.element.scrollTop;
    this.signature = signature; this.resources = resources; this.element.replaceChildren();
    const actions = document.createElement('div'); actions.className = 'noise-layer-actions';
    actions.append(action('添加噪域层', () => {
      editor.flush(); const id = crypto.randomUUID(); this.expanded.set(id, true);
      editor.commit('添加噪域层', withNoiseLayers(editor.context.session.chart, [...noiseLayers(editor.context.session.chart), { id, name: '噪域层 ' + (layers.length + 1), skin: '', parameters: {} }]));
      editor.render(); editor.invalidate();
    }));
    this.element.append(actions);
    if (this.builtinState === 'failed') {
      const hint = document.createElement('p'); hint.className = 'hint'; hint.textContent = this.builtinError;
      actions.append(action('重试载入内置皮肤', () => { this.loadBuiltins(); this.signature = null; this.render(); })); this.element.append(hint);
    }
    for (const layer of layers) this.renderLayer(layer, layers);
    this.element.scrollTop = scrollTop;
  }
  renderLayer(layer, layers) {
    const editor = this.editor; const card = document.createElement('details'); card.className = 'noise-layer-card'; card.dataset.noiseLayer = layer.id;
    card.open = this.expanded.get(layer.id) ?? layers.length === 1;
    const summary = document.createElement('summary'); summary.textContent = layer.name;
    const hidden = document.createElement('input'); hidden.type = 'checkbox'; hidden.checked = editor.hiddenLayers.has(layer.id); hidden.setAttribute('aria-label', '隐藏预览：' + layer.name);
    const visibility = document.createElement('label'); visibility.className = 'noise-layer-visibility'; visibility.title = '仅隐藏预览，编辑区照常显示；本次编辑会话内有效'; visibility.append(hidden, '隐藏');
    visibility.onclick = event => event.stopPropagation();
    hidden.onchange = () => { if (hidden.checked) editor.hiddenLayers.add(layer.id); else editor.hiddenLayers.delete(layer.id); this.signature = null; editor.invalidate(); };
    const simple = document.createElement('input'); simple.type = 'checkbox'; simple.checked = Boolean(layer.skin) && editor.simpleLayers.has(layer.id); simple.disabled = !layer.skin; simple.setAttribute('aria-label', '暂用简易渲染：' + layer.name);
    const simpleLabel = document.createElement('label'); simpleLabel.className = 'noise-layer-visibility'; simpleLabel.title = layer.skin ? '暂时忽略本层皮肤，使用简易预览；本次编辑会话内有效' : '本层未应用皮肤，已使用简易渲染'; simpleLabel.append(simple, '暂用简易渲染');
    simpleLabel.onclick = event => event.stopPropagation();
    simple.onchange = () => { if (!layer.skin) return; if (simple.checked) editor.simpleLayers.add(layer.id); else editor.simpleLayers.delete(layer.id); this.signature = null; editor.invalidate(); };
    const toggles = document.createElement('span'); toggles.className = 'noise-layer-toggles'; toggles.append(simpleLabel, visibility); summary.append(toggles);
    card.append(summary); this.element.append(card);
    const name = document.createElement('input'); name.type = 'text'; name.value = layer.name; name.setAttribute('aria-label', '噪域层名称');
    name.onchange = () => this.change(layer, { name: name.value.trim() || layer.name }, '重命名噪域层'); this.field(card, '层名称', name);
    const assets = editor.getAssets(); const skins = [...assets.keys()].filter(path => /^shader\/[^/]+\/main\.glsl$/.test(path)).map(path => path.slice(0, -10));
    if (layer.skin && !skins.includes(layer.skin)) skins.push(layer.skin);
    for (const root of Object.keys(layer.skinPresets ?? {})) if (!skins.includes(root)) skins.push(root);
    const choices = new Map(this.builtins.map(entry => [builtinNoiseSkinRoot(entry, assets), { builtin: entry, label: noiseSkinLabel(entry.name, entry.author), definition: parseNoiseSkin(entry.files) }]));
    for (const root of skins) {
      if (choices.has(root)) continue;
      const files = new Map([...assets].filter(([path]) => path.startsWith(root + '/')).map(([path, bytes]) => [path.slice(root.length + 1), bytes]));
      let author = ''; let definition; try { author = noiseSkinAuthor(files); definition = parseNoiseSkin(files); } catch {}
      choices.set(root, { label: noiseSkinLabel(root.slice(7), author), definition });
    }
    const presets = rememberedNoiseSkinSettings(layer);
    const skin = document.createElement('select'); skin.setAttribute('aria-label', '噪域层皮肤'); skin.append(new Option('简易渲染', ''));
    for (const [root, entry] of choices) {
      skin.append(new Option(entry.label, root));
      if (presets[root] && noiseSkinModified(presets[root], entry.definition)) skin.append(new Option(entry.label + ' · 已修改', 'modified:' + root));
    }
    skin.value = layer.skin && noiseSkinModified(layer, choices.get(layer.skin)?.definition) ? 'modified:' + layer.skin : layer.skin ?? '';
    skin.title = skin.selectedOptions[0]?.textContent ?? '';
    skin.onchange = () => {
      if (skin.value.startsWith('modified:')) this.change(layer, current => switchNoiseSkin(current, skin.value.slice(9), true), '恢复已修改的皮肤参数');
      else if (choices.get(skin.value)?.builtin) this.useBuiltin(choices.get(skin.value).builtin.name, layer);
      else this.change(layer, current => switchNoiseSkin(current, skin.value), '更换噪域皮肤');
    }; this.field(card, '皮肤', skin);
    const imports = document.createElement('div'); imports.className = 'noise-layer-actions';
    for (const [title, directory] of [['导入文件夹', true], ['导入 ZIP', false]]) {
      const input = document.createElement('input'); input.type = 'file'; input.hidden = true;
      if (directory) { input.webkitdirectory = true; input.multiple = true; } else input.accept = '.zip';
      input.onchange = () => { if (input.files.length) this.import(input.files, !directory, layer.id); };
      imports.append(action(title, () => input.click()), input);
    }
    imports.append(action('删除层', () => {
      const available = noiseLayers(editor.context.session.chart);
      if (available.length < 2) { editor.notify('至少保留一个噪域层', 'warning'); return; }
      const target = available.find(entry => entry.id !== layer.id); const count = editor.areas().filter(area => noiseLayerId(area) === layer.id).length;
      if (!confirm('删除层“' + layer.name + '”？' + (count ? '其中 ' + count + ' 个噪域将移至“' + target.name + '”。' : ''))) return;
      editor.flush();
      editor.commit('删除噪域层', withNoiseLayers(editor.context.session.chart, available.filter(entry => entry.id !== layer.id), editor.areas().map(area => noiseLayerId(area) === layer.id ? { ...area, layerId: target.id } : area)));
      editor.render(); editor.invalidate();
    })); card.append(imports);
    if (!layer.skin) return;
    try {
      const prefix = layer.skin + '/'; const definition = parseNoiseSkin(new Map([...editor.getAssets()].filter(([path]) => path.startsWith(prefix)).map(([path, bytes]) => [path.slice(prefix.length), bytes])));
      if (definition.low) {
        const channel = document.createElement('select'); channel.setAttribute('aria-label', '皮肤性能通道'); channel.append(new Option('普通', 'normal'), new Option('低性能', 'low')); channel.value = layer.channel ?? 'normal';
        channel.onchange = () => this.change(layer, current => updateNoiseSkinSettings(current, { channel: channel.value }, definition), '更换皮肤通道'); this.field(card, '渲染通道', channel);
      }
      const details = document.createElement('details'); details.className = 'noise-skin-parameters';
      details.open = this.parametersExpanded.get(layer.id) ?? false;
      const heading = document.createElement('summary'); heading.textContent = '皮肤参数'; details.append(heading); card.append(details);
      for (const parameter of definition.parameters) {
        const label = document.createElement('label'); label.className = 'noise-skin-parameter'; label.append(parameter.name);
        const controls = document.createElement('span'); const value = layer.parameters?.[parameter.name] ?? parameter.value; const values = Array.isArray(value) ? value : [value];
        const inputs = values.map((component, index) => {
          const input = document.createElement('input'); input.type = 'number'; input.step = 'any'; input.value = component; input.setAttribute('aria-label', parameter.name + (values.length > 1 ? ' ' + index : ''));
          if (parameter.min !== undefined) input.min = parameter.min; if (parameter.max !== undefined) input.max = parameter.max; controls.append(input); return input;
        });
        for (const input of inputs) input.onchange = () => {
          const next = inputs.map(entry => Number(entry.value));
          if (inputs.some(entry => !entry.value.trim() || !entry.checkValidity()) || next.some(value => !Number.isFinite(value)) || parameter.name === 'touchReleaseDuration' && next[0] < 0) { editor.notify('皮肤参数数值无效', 'error'); return; }
          this.change(layer, current => updateNoiseSkinSettings(current, { parameters: { ...current.parameters, [parameter.name]: values.length === 1 ? next[0] : next } }, definition), '编辑皮肤参数');
        };
        label.append(controls); details.append(label);
      }
      details.append(action('恢复皮肤默认参数', () => this.change(layer, current => switchNoiseSkin(current, current.skin), '恢复皮肤默认参数')));
    } catch (error) { const hint = document.createElement('p'); hint.className = 'hint'; hint.textContent = error.message; card.append(hint); }
  }
}
