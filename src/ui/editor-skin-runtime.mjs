import { compileEditorSkin, editorSkinSelector, EDITOR_SKIN_COMPONENTS, EDITOR_SKIN_BUILTINS } from '../core/editor-skin.mjs';
import { assetUrl } from '../core/asset-url.mjs';
import { baseEditorSkinCss } from './editor-skin-base.mjs';
import { setEditorCanvasSkin } from './editor-skin-canvas.mjs';
import { emitModHook } from '../core/mod-hooks.mjs';
import { isLocalizedMap, localizedValue, t } from '../i18n.mjs';

function safeSvg(bytes) {
  const source = new TextDecoder().decode(bytes); if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error(t('editor-skin-runtime.s7933796'));
  const svg = new DOMParser().parseFromString(source, 'image/svg+xml');
  if (svg.querySelector('parsererror') || svg.documentElement.localName !== 'svg') throw new Error(t('editor-skin-runtime.sf54de02'));
  for (const node of svg.querySelectorAll('*')) {
    if (['script', 'foreignobject', 'style', 'image', 'iframe', 'animate', 'animatetransform', 'animatemotion', 'set', 'a'].includes(node.localName.toLowerCase())) throw new Error(t('editor-skin-runtime.s6cf2d1b'));
    for (const attribute of node.attributes) {
      if (/^on/i.test(attribute.name) || /href$/i.test(attribute.name) && !attribute.value.startsWith('#')) throw new Error(t('editor-skin-runtime.s5b29d24'));
      if (!/^xmlns/.test(attribute.name) && /url\s*\(\s*["']?(?!#)|(?:https?|data|javascript|file|blob):|\\/i.test(attribute.value)) throw new Error('SVG 属性含外部资源');
    }
  }
  return new TextEncoder().encode(new XMLSerializer().serializeToString(svg));
}

export class EditorSkinRuntime {
  constructor(invalidate) {
    this.invalidate = invalidate; this.urls = []; this.faces = []; this.moves = new Map(); this.patches = new Map(); this.aliases = new Map(); this.groups = []; this.decorations = [];
    this.observer = new MutationObserver(mutations => {
      if (mutations.some(mutation => mutation.type === 'attributes' ? mutation.oldValue !== mutation.target.getAttribute(mutation.attributeName) : this.patches.has(mutation.target) || this.patches.has(mutation.target.parentElement) || [...mutation.addedNodes].some(node => node.nodeType === 1))) this.schedule();
    });
  }
  async prepare(record) {
    const images = new Map(); const imageSets = new Map(); const sources = new Map(); const fonts = new Map(); const urls = []; const faces = [];
    try {
      for (const [id, asset] of Object.entries(record.skin.assets ?? {})) {
        const path = asset.builtin ? EDITOR_SKIN_BUILTINS[asset.builtin] : asset.path;
        let bytes = record.files.get(path);
        if (asset.builtin) { const response = await fetch(assetUrl(path)); if (!response.ok) throw new Error(t('editor-skin-runtime.sf43ee5e') + asset.builtin); bytes = new Uint8Array(await response.arrayBuffer()); }
        const extension = path.split('.').at(-1).toLowerCase();
        const mime = asset.type === 'font' ? 'font/' + extension : extension === 'svg' ? 'image/svg+xml' : 'image/' + extension.replace('jpg', 'jpeg');
        if (extension === 'svg') bytes = safeSvg(bytes);
        const url = URL.createObjectURL(new Blob([bytes], { type: mime })); urls.push(url);
        if (asset.type === 'font') {
          const family = `rpen-skin-${record.skin.id}-${id}`; const face = new FontFace(family, `url("${url}")`); await face.load(); faces.push(face); fonts.set(id, family);
        } else {
          const picture = new Image(); picture.src = url; await picture.decode();
          if (picture.naturalWidth * picture.naturalHeight > 16000000) throw new Error(t('editor-skin-runtime.sc544c16') + asset.path);
          images.set(id, url);
          const variants = [{ url, scale: 1 }];
          for (const source of asset.sources ?? []) {
            let content = record.files.get(source.path); const ext = source.path.split('.').at(-1).toLowerCase(); if (ext === 'svg') content = safeSvg(content);
            const variantUrl = URL.createObjectURL(new Blob([content], { type: ext === 'svg' ? 'image/svg+xml' : 'image/' + ext.replace('jpg', 'jpeg') })); urls.push(variantUrl);
            const variant = new Image(); variant.src = variantUrl; await variant.decode(); if (variant.naturalWidth * variant.naturalHeight > 16000000) throw new Error(t('editor-skin-runtime.s0771206'));
            variants.push({ url: variantUrl, scale: source.scale });
          }
          sources.set(id, variants);
          if (variants.length > 1) imageSets.set(id, `image-set(${variants.map(source => `url("${source.url}") ${source.scale}x`).join(',')})`);
        }
      }
      const css = baseEditorSkinCss(record.skin) + compileEditorSkin(record.skin, { images, fonts, imageSets });
      const sheet = new CSSStyleSheet(); sheet.replaceSync(css);
      const selectors = [...(record.skin.styles ?? []), ...Object.values(record.skin.variants ?? {}).flatMap(variant => variant.styles ?? [])].flatMap(function flatten(rule) { return rule.rules ? rule.rules.flatMap(flatten) : [rule.selector]; });
      for (const selector of [...selectors, ...(record.skin.texts ?? []).map(entry => entry.selector), ...(record.skin.hide ?? []), ...(Array.isArray(record.skin.icons) ? record.skin.icons.map(icon => icon.selector) : []), ...(record.skin.decorations ?? []).flatMap(entry => entry.selector ? [entry.selector] : [])]) document.querySelectorAll(editorSkinSelector(selector));
      return { record, images, imageSets, sources, fonts, urls, faces, sheet };
    } catch (error) { urls.forEach(url => URL.revokeObjectURL(url)); throw error; }
  }
  apply(prepared) {
    this.clear(); this.prepared = prepared;
    if (!prepared) { this.invalidate(); return; }
    this.urls = prepared.urls; this.faces = prepared.faces; this.sheet = prepared.sheet;
    for (const face of this.faces) document.fonts.add(face);
    document.documentElement.dataset.editorSkin = prepared.record.skin.id;
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, this.sheet];
    const canvas = prepared.record.skin.canvas;
    setEditorCanvasSkin(canvas, prepared.fonts.get(canvas?.font) ?? '', prepared.fonts);
    this.sync(); this.observe(); this.invalidate();
  }
  observe() {
    this.observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeOldValue: true, attributeFilter: ['class', 'hidden', 'data-playing', 'aria-expanded', 'aria-pressed', 'disabled'] });
    if ((this.prepared?.record.skin.texts ?? []).some(entry => /data-rpen-/.test(entry.selector))) this.observer.observe(document.documentElement, { attributes: true, attributeOldValue: true, attributeFilter: ['data-rpen-playing', 'data-rpen-dirty', 'data-rpen-pane', 'data-rpen-mode', 'data-rpen-location', 'data-rpen-collaboration', 'data-rpen-beat'] });
  }
  schedule() {
    if (this.frame) return;
    // DOM text/group updates already repaint naturally. A global invalidation here
    // would rebuild inspectors, whose mutations would schedule another sync.
    this.frame = requestAnimationFrame(() => { this.frame = null; if (this.prepared) { this.observer.disconnect(); this.sync(); this.observe(); } });
  }
  sync() {
    const { record, images, sources } = this.prepared;
    for (const map of [this.moves, this.patches, this.aliases]) for (const element of map.keys()) if (!element.isConnected) map.delete(element);
    this.groups = this.groups.filter(element => element.isConnected); this.decorations = this.decorations.filter(element => element.isConnected);
    for (const input of document.querySelectorAll('[data-key]')) if (input.matches('input,select,textarea')) { input.dataset.rpenField = input.dataset.key; const row = input.closest('.field,.noise-field'); if (row) row.dataset.rpenField = input.dataset.key; }
    for (const [id, selector] of Object.entries(EDITOR_SKIN_COMPONENTS)) for (const element of document.querySelectorAll(selector)) {
      if (!this.aliases.has(element)) this.aliases.set(element, element.getAttribute('data-ui')); element.dataset.ui = id;
    }
    for (const [index, group] of (record.skin.organize ?? []).entries()) {
      const slot = document.querySelector(EDITOR_SKIN_COMPONENTS[group.slot]); if (!slot) continue;
      let destination = slot;
      if (group.id) {
        destination = this.groups.find(element => element.dataset.skinGroup === group.id);
        if (!destination) {
          destination = document.createElement(group.collapsible ? 'details' : 'div'); destination.className = 'skin-control-group'; destination.dataset.skinGroup = group.id;
          destination.dataset.direction = group.direction ?? 'row';
          if (group.label) { const label = document.createElement(group.collapsible ? 'summary' : 'span'); label.className = 'skin-group-label'; label.textContent = localizedValue(group.label); destination.append(label); }
          if (group.collapsible) destination.open = true;
          slot.append(destination); this.groups.push(destination);
        }
      }
      for (const id of group.items) {
        const item = document.querySelector(EDITOR_SKIN_COMPONENTS[id]); if (!item || item === destination || item.parentElement === destination && item.dataset.skinOrganized === String(index)) continue;
        if (item.contains(destination)) continue;
        if(emitModHook('ui:before-relocate',{node:item,parent:destination,anchor:null,reason:'skin-organize',cancel:false}).cancel)continue;
        if (!this.moves.has(item)) { const anchor = document.createComment('editor skin original position'); item.before(anchor); this.moves.set(item, anchor); }
        destination.append(item); item.dataset.skinOrganized = String(index);
      }
    }
    const matched = new Map();
    for (const entry of record.skin.texts ?? []) {
      const selector = entry.selector.replace(/@([a-z][a-z0-9-]*)/g, (_, id) => EDITOR_SKIN_COMPONENTS[id]);
      for (const element of document.querySelectorAll(selector)) {
        let patches = this.patches.get(element); if (!patches) { patches = new Map(); this.patches.set(element, patches); }
        for (const [key, raw] of Object.entries(entry)) {
          if (key === 'selector') continue;
          // Skin text may be a per-locale map; resolve it for the active language.
          const value = isLocalizedMap(raw) ? localizedValue(raw) : raw;
          if (value === undefined) continue;
          if (key === 'text') {
            if (element.matches('input,textarea,select,canvas') || element.closest('#editor-skin-settings')) continue;
            let node = [...element.childNodes].find(node => node.nodeType === 3 && node.textContent.trim());
            if (!node) continue;
            const previous = patches.get(key);
            patches.set(key, { node, original: previous?.node === node && node.textContent === previous.applied ? previous.original : node.textContent, applied: value });
            if (!matched.has(element)) matched.set(element, new Set()); matched.get(element).add(key);
            if (node.textContent !== value) node.textContent = value;
          } else {
            const attribute = key === 'ariaLabel' ? 'aria-label' : key;
            if (!['title', 'aria-label', 'placeholder'].includes(attribute)) continue;
            const previous = patches.get(attribute);
            patches.set(attribute, { original: previous && element.getAttribute(attribute) === previous.applied ? previous.original : element.getAttribute(attribute), applied: value });
            if (!matched.has(element)) matched.set(element, new Set()); matched.get(element).add(attribute);
            if (element.getAttribute(attribute) !== value) element.setAttribute(attribute, value);
          }
        }
      }
    }
    for (const [element, patches] of this.patches) for (const [key, patch] of patches) if (!matched.get(element)?.has(key)) {
      if (key === 'text') { if (patch.node.textContent === patch.applied) patch.node.textContent = patch.original; }
      else if (element.getAttribute(key) === patch.applied) { if (patch.original === null) element.removeAttribute(key); else element.setAttribute(key, patch.original); }
      patches.delete(key);
    }
    for (const entry of record.skin.decorations ?? []) {
      if (this.decorations.some(node => node.dataset.skinDecoration === entry.id)) continue;
      const target = document.querySelector(entry.selector ? editorSkinSelector(entry.selector) : EDITOR_SKIN_COMPONENTS[entry.target]); if (!target) continue;
      if (['prepend', 'append'].includes(entry.placement ?? 'prepend') && target.matches('input,img,canvas,textarea,select')) continue;
      const picture = document.createElement('img'); picture.alt = ''; picture.setAttribute('aria-hidden', 'true'); picture.dataset.skinDecoration = entry.id; picture.src = images.get(entry.asset);
      picture.className = 'skin-decoration'; picture.style.setProperty('pointer-events', 'none', 'important');
      picture.srcset = (sources.get(entry.asset) ?? []).map(source => `${source.url} ${source.scale}x`).join(',');
      target[entry.placement ?? 'prepend'](picture); this.decorations.push(picture);
    }
  }
  clear() {
    this.observer.disconnect(); if (this.frame) cancelAnimationFrame(this.frame); this.frame = null;
    if (this.sheet) document.adoptedStyleSheets = document.adoptedStyleSheets.filter(sheet => sheet !== this.sheet);
    for (const [element, anchor] of this.moves) { if (anchor.parentNode&&!emitModHook('ui:before-relocate',{node:element,parent:anchor.parentNode,anchor,reason:'skin-restore',cancel:false}).cancel) anchor.replaceWith(element); delete element.dataset.skinOrganized; }
    for (const element of [...this.groups, ...this.decorations]) element.remove();
    for (const [element, patches] of this.patches) for (const [key, patch] of patches) {
      if (key === 'text') { if (patch.node.textContent === patch.applied) patch.node.textContent = patch.original; }
      else if (element.getAttribute(key) === patch.applied) { if (patch.original === null) element.removeAttribute(key); else element.setAttribute(key, patch.original); }
    }
    for (const face of this.faces) document.fonts.delete(face);
    for (const [element, original] of this.aliases) { if (original === null) element.removeAttribute('data-ui'); else element.setAttribute('data-ui', original); }
    this.urls.forEach(url => URL.revokeObjectURL(url));
    this.prepared = null; this.sheet = null; this.urls = []; this.faces = []; this.moves.clear(); this.patches.clear(); this.aliases.clear(); this.groups = []; this.decorations = [];
    delete document.documentElement.dataset.editorSkin; setEditorCanvasSkin(null);
  }
}
