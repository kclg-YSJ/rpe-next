import { noiseLayers, noiseLayerId, withNoiseLayers, parseNoiseSkin, skinPath, noiseSkinAuthor, noiseSkinLabel, noiseSkinModified, rememberedNoiseSkinSettings, switchNoiseSkin, updateNoiseSkinSettings } from '../core/noise-skin.mjs';
import { readZip } from '../platform/archive.mjs';
import { loadBuiltinNoiseSkins, installBuiltinNoiseSkin, builtinNoiseSkinRoot } from '../platform/noise-skins.mjs';
import { t } from '../i18n.mjs';

const action = (text, run) => { const button = document.createElement('button'); button.type = 'button'; button.textContent = text; button.onclick = run; return button; };

export class NoiseLayerPanel {
  constructor(editor) {
    this.editor = editor; this.expanded = new Map(); this.parametersExpanded = new Map();
    this.builtins = []; this.builtinState = 'idle';
    this.element = document.createElement('section'); this.element.className = 'noise-layer-panel';
  }
  change(layer, patch, label = t('noise-layer-panel.s06de13f')) {
    const editor = this.editor; editor.flush();
    const layers = noiseLayers(editor.context.session.chart);
    if (!layers.some(entry => entry.id === layer.id)) throw new Error(t('noise-layer-panel.s6177fbf'));
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
      if (!noiseLayers(editor.context.session.chart).some(entry => entry.id === layer.id)) throw new Error(t('noise-layer-panel.sf7e51b0'));
      const builtin = this.builtins.find(skin => skin.name === name); if (!builtin) throw new Error(t('noise-layer-panel.s32175a7'));
      const { root, entries } = installBuiltinNoiseSkin(builtin, editor.getAssets());
      if (entries.size) editor.onAssets(entries);
      this.change(layer, current => switchNoiseSkin(current, root), t('noise-layer-panel.s5ef1437'));
    } catch (error) { editor.report(error); }
  }
  async import(files, zipped, layerId) {
    const editor = this.editor;
    try {
      const source = zipped ? await readZip(await files[0].arrayBuffer()) : new Map(await Promise.all([...files].map(async file => [file.webkitRelativePath || file.name, new Uint8Array(await file.arrayBuffer())])));
      const roots = [...source.keys()].filter(name => /(^|\/)main\.glsl$/.test(name));
      if (!roots.length) throw new Error(t('noise-layer-panel.s538e9e6'));
      const collected = new Map(); const packages = [];
      for (const main of roots) {
        const prefix = main.slice(0, -'main.glsl'.length); const name = prefix.split('/').filter(Boolean).at(-1) ?? files[0].name.replace(/\.zip$/i, '');
        const root = skinPath('shader/' + name); const relative = new Map([...source].filter(([path]) => path.startsWith(prefix) && !path.endsWith('/')).map(([path, bytes]) => [skinPath(path.slice(prefix.length)), bytes]));
        parseNoiseSkin(relative);
        if ([...relative].some(([path]) => editor.getAssets().has(root + '/' + path)) && !confirm(t('noise-layer-panel.sa69c673') + name + t('noise-layer-panel.sd475c0c'))) continue;
        for (const [path, bytes] of relative) collected.set(root + '/' + path, bytes);
        packages.push(root);
      }
      if (!packages.length) return;
      const layer = noiseLayers(editor.chart).find(entry => entry.id === layerId);
      if (!layer) throw new Error(t('noise-layer-panel.sf7e51b0'));
      editor.onAssets(collected); this.expanded.set(layer.id, true);
      this.change(layer, current => switchNoiseSkin(current, packages[0]), t('noise-layer-panel.s311a6dd'));
      editor.notify(t('noise-layer-panel.sb3099af') + packages.length + t('noise-layer-panel.s78b1dd7'), 'success');
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
    actions.append(action(t('noise-layer-panel.s30b97ef'), () => {
      editor.flush(); const id = crypto.randomUUID(); this.expanded.set(id, true);
      editor.commit(t('noise-layer-panel.s30b97ef'), withNoiseLayers(editor.context.session.chart, [...noiseLayers(editor.context.session.chart), { id, name: t('noise-layer-panel.s61cedf2') + (layers.length + 1), skin: '', parameters: {} }]));
      editor.render(); editor.invalidate();
    }));
    this.element.append(actions);
    if (this.builtinState === 'failed') {
      const hint = document.createElement('p'); hint.className = 'hint'; hint.textContent = this.builtinError;
      actions.append(action(t('noise-layer-panel.saa0049a'), () => { this.loadBuiltins(); this.signature = null; this.render(); })); this.element.append(hint);
    }
    for (const layer of layers) this.renderLayer(layer, layers);
    this.element.scrollTop = scrollTop;
  }
  renderLayer(layer, layers) {
    const editor = this.editor; const card = document.createElement('details'); card.className = 'noise-layer-card'; card.dataset.noiseLayer = layer.id;
    card.open = this.expanded.get(layer.id) ?? layers.length === 1;
    const summary = document.createElement('summary'); summary.textContent = layer.name;
    const hidden = document.createElement('input'); hidden.type = 'checkbox'; hidden.checked = editor.hiddenLayers.has(layer.id); hidden.setAttribute('aria-label', t('noise-layer-panel.s88ff68f') + layer.name);
    const visibility = document.createElement('label'); visibility.className = 'noise-layer-visibility'; visibility.title = t('noise-layer-panel.s40bdbc5'); visibility.append(hidden, t('noise-layer-panel.sbb0e7e0'));
    visibility.onclick = event => event.stopPropagation();
    hidden.onchange = () => { if (hidden.checked) editor.hiddenLayers.add(layer.id); else editor.hiddenLayers.delete(layer.id); this.signature = null; editor.invalidate(); };
    const simple = document.createElement('input'); simple.type = 'checkbox'; simple.checked = Boolean(layer.skin) && editor.simpleLayers.has(layer.id); simple.disabled = !layer.skin; simple.setAttribute('aria-label', t('noise-layer-panel.s71170f9') + layer.name);
    const simpleLabel = document.createElement('label'); simpleLabel.className = 'noise-layer-visibility'; simpleLabel.title = layer.skin ? t('noise-layer-panel.s822c6f7') : t('noise-layer-panel.s7d259d0'); simpleLabel.append(simple, t('noise-layer-panel.sf56b561'));
    simpleLabel.onclick = event => event.stopPropagation();
    simple.onchange = () => { if (!layer.skin) return; if (simple.checked) editor.simpleLayers.add(layer.id); else editor.simpleLayers.delete(layer.id); this.signature = null; editor.invalidate(); };
    const toggles = document.createElement('span'); toggles.className = 'noise-layer-toggles'; toggles.append(simpleLabel, visibility); summary.append(toggles);
    card.append(summary); this.element.append(card);
    const name = document.createElement('input'); name.type = 'text'; name.value = layer.name; name.setAttribute('aria-label', t('noise-layer-panel.sfef6e5e'));
    name.onchange = () => this.change(layer, { name: name.value.trim() || layer.name }, t('noise-layer-panel.s7aecbb6')); this.field(card, t('noise-layer-panel.sba2b475'), name);
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
    const skin = document.createElement('select'); skin.setAttribute('aria-label', t('noise-layer-panel.s1d4d6ea')); skin.append(new Option(t('noise-layer-panel.s4dfe60e'), ''));
    for (const [root, entry] of choices) {
      skin.append(new Option(entry.label, root));
      if (presets[root] && noiseSkinModified(presets[root], entry.definition)) skin.append(new Option(entry.label + t('noise-layer-panel.s83e8b23'), 'modified:' + root));
    }
    skin.value = layer.skin && noiseSkinModified(layer, choices.get(layer.skin)?.definition) ? 'modified:' + layer.skin : layer.skin ?? '';
    skin.title = skin.selectedOptions[0]?.textContent ?? '';
    skin.onchange = () => {
      if (skin.value.startsWith('modified:')) this.change(layer, current => switchNoiseSkin(current, skin.value.slice(9), true), t('noise-layer-panel.s38325bd'));
      else if (choices.get(skin.value)?.builtin) this.useBuiltin(choices.get(skin.value).builtin.name, layer);
      else this.change(layer, current => switchNoiseSkin(current, skin.value), t('noise-layer-panel.s5ef1437'));
    }; this.field(card, t('noise-layer-panel.scd5778a'), skin);
    const imports = document.createElement('div'); imports.className = 'noise-layer-actions';
    for (const [title, directory] of [[t('noise-layer-panel.s4d2d93e'), true], [t('noise-layer-panel.sb460361'), false]]) {
      const input = document.createElement('input'); input.type = 'file'; input.hidden = true;
      if (directory) { input.webkitdirectory = true; input.multiple = true; } else input.accept = '.zip';
      input.onchange = () => { if (input.files.length) this.import(input.files, !directory, layer.id); };
      imports.append(action(title, () => input.click()), input);
    }
    imports.append(action(t('noise-layer-panel.s906743d'), () => {
      const available = noiseLayers(editor.context.session.chart);
      if (available.length < 2) { editor.notify(t('noise-layer-panel.saa4b600'), 'warning'); return; }
      const target = available.find(entry => entry.id !== layer.id); const count = editor.areas().filter(area => noiseLayerId(area) === layer.id).length;
      if (!confirm(t('noise-layer-panel.sba8260e') + layer.name + '”？' + (count ? t('noise-layer-panel.s8152364') + count + t('noise-layer-panel.s5863b63') + target.name + '”。' : ''))) return;
      editor.flush();
      editor.commit(t('noise-layer-panel.s9e9f1e8'), withNoiseLayers(editor.context.session.chart, available.filter(entry => entry.id !== layer.id), editor.areas().map(area => noiseLayerId(area) === layer.id ? { ...area, layerId: target.id } : area)));
      editor.render(); editor.invalidate();
    })); card.append(imports);
    if (!layer.skin) return;
    try {
      const prefix = layer.skin + '/'; const definition = parseNoiseSkin(new Map([...editor.getAssets()].filter(([path]) => path.startsWith(prefix)).map(([path, bytes]) => [path.slice(prefix.length), bytes])));
      if (definition.low) {
        const channel = document.createElement('select'); channel.setAttribute('aria-label', t('noise-layer-panel.s663f880')); channel.append(new Option(t('noise-layer-panel.s7cda072'), 'normal'), new Option(t('noise-layer-panel.s9d5b2d9'), 'low')); channel.value = layer.channel ?? 'normal';
        channel.onchange = () => this.change(layer, current => updateNoiseSkinSettings(current, { channel: channel.value }, definition), t('noise-layer-panel.sd1db003')); this.field(card, t('noise-layer-panel.se3db8cd'), channel);
      }
      const details = document.createElement('details'); details.className = 'noise-skin-parameters';
      details.open = this.parametersExpanded.get(layer.id) ?? false;
      const heading = document.createElement('summary'); heading.textContent = t('noise-layer-panel.s4f8857c'); details.append(heading); card.append(details);
      for (const parameter of definition.parameters) {
        const label = document.createElement('label'); label.className = 'noise-skin-parameter'; label.append(parameter.name);
        const controls = document.createElement('span'); const value = layer.parameters?.[parameter.name] ?? parameter.value; const values = Array.isArray(value) ? value : [value];
        const inputs = values.map((component, index) => {
          const input = document.createElement('input'); input.type = 'number'; input.step = 'any'; input.value = component; input.setAttribute('aria-label', parameter.name + (values.length > 1 ? ' ' + index : ''));
          if (parameter.min !== undefined) input.min = parameter.min; if (parameter.max !== undefined) input.max = parameter.max; controls.append(input); return input;
        });
        for (const input of inputs) input.onchange = () => {
          const next = inputs.map(entry => Number(entry.value));
          if (inputs.some(entry => !entry.value.trim() || !entry.checkValidity()) || next.some(value => !Number.isFinite(value)) || parameter.name === 'touchReleaseDuration' && next[0] < 0) { editor.notify(t('noise-layer-panel.s0e829dd'), 'error'); return; }
          this.change(layer, current => updateNoiseSkinSettings(current, { parameters: { ...current.parameters, [parameter.name]: values.length === 1 ? next[0] : next } }, definition), t('noise-layer-panel.s86d5970'));
        };
        label.append(controls); details.append(label);
      }
      details.append(action(t('noise-layer-panel.s6e5edd3'), () => this.change(layer, current => switchNoiseSkin(current, current.skin), t('noise-layer-panel.s6e5edd3'))));
    } catch (error) { const hint = document.createElement('p'); hint.className = 'hint'; hint.textContent = error.message; card.append(hint); }
  }
}
