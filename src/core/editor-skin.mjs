import { isLocalizedMap, localizedValue, t } from '../i18n.mjs';
export const EDITOR_SKIN_VERSION = 1;
export const EDITOR_SKIN_API = 3;
export const EDITOR_SKIN_LIMITS = Object.freeze({ files: 512, bytes: 32 * 1024 * 1024, fileBytes: 12 * 1024 * 1024 });
export const EDITOR_SKIN_COMPONENTS = Object.freeze({
  root: ':root', app: 'body', header: 'header', brand: '.brand', 'document-name': '#document-name', 'file-actions': 'header nav',
  transport: '.transport', 'transport-actions': '.transport-group', workspace: '.workspace', editor: '.editor', toolbar: '.editor-toolbar',
  tools: '.tools', 'view-controls': '.view-controls-inline', 'timeline-header': '.timeline-head', stage: '.stage',
  'direct-placement-toggle': '#direct-placement-enabled', 'direct-placement-close': '#close-direct-placement',
  'direct-placement': '.direct-placement', 'direct-placement-surface': '.direct-placement-surface', 'preview-line-picker': '.preview-line-picker',
  'note-tracking-tool': '#note-tracking-tool', 'note-tracking-panel': '#note-tracking-editor', 'agent-images': '.agent-image-list',
  'placement-defaults': '#placement-defaults-panel', 'placement-defaults-menu': '#timeline-placement-defaults',
  'diagnostics-panel': '[data-panel="diagnose"]', 'diagnose-deep': '#diagnose-deep', 'diagnose-target': '#diagnose-target',
  'editor-actions': '.editor-footer', inspector: '.inspector', 'inspector-tabs': '.inspector-tabs', 'chart-tools': '[data-panel="chart"] .action-grid',
  'project-home': '#home', 'project-list': '#project-cards', footer: 'body > footer', status: '#status', notifications: '#notifications',
  dialog: '#modal', settings: '#settings-modal', 'settings-body': '.settings-body', 'theme-settings': '#editor-skin-settings',
  'settings-header': '.settings-header', 'settings-navigation': '.settings-nav', 'settings-navigation-item': '.settings-nav-item', 'settings-search': '#settings-search', 'settings-category': '.settings-category', 'settings-card': '.settings-card',
  'language-settings': '#language-settings', 'language-select': '#ui-language',
  'about-settings': '#about-settings', 'app-version': '#app-version', 'update-progress': '#update-progress', 'update-notes': '#update-notes', 'update-dialog': '#update-dialog',
  'app-update-badge': '#app-update-badge', 'update-release-dialog': '#update-release-dialog', 'update-release-content': '.update-release-content',
  'dictation-settings': '#dictation-settings', 'dictation-indicator': '.dictation-indicator', 'dictation-candidate': '.dictation-candidate', 'dictation-permission': '.dictation-permission-dialog',
  'performance-monitor': '#performance-monitor',
  'note-skin-settings': '#note-skin-settings', 'note-skins-open': '#note-skins-open', 'note-skin-manager': '#note-skin-modal', 'note-skin-gallery': '.note-skin-gallery',
  'mod-manager': '#mod-manager', 'mod-list': '.mod-manager-list', 'mod-details': '.mod-manager-details', 'mod-status': '#mods-status', 'mod-warning': '#mod-import-warning',
  'context-menu': '.timeline-context-menu', 'line-overview': '.line-switcher', 'clipboard-history': '#clipboard-results',
  ...Object.fromEntries(['new', 'open', 'save', 'export', 'library', 'migrate', 'recover', 'mods-open', 'preferences', 'help', 'play', 'rewind', 'view-toggle',
    'seek', 'undo', 'redo', 'copy', 'cut', 'paste', 'mirror', 'delete', 'notes-only', 'game-ui', 'reset-camera', 'mute-current-line',
    'metadata', 'bpm', 'assets', 'audio-analysis-tool', 'noise-areas-tool', 'curve-notes', 'curve-trajectory', 'text-lines-tool',
    'noise-fit-tool', 'noise-tracking-tool', 'multi-line-tool', 'diagnose', 'history-panel', 'collaboration-tool', 'version-control-tool'].map(id => [id, '#' + id])),
  'version-control-panel': '#version-control-panel', 'ai-tool': '#ai-tool', 'ai-panel': '#ai-panel', 'tab-ai': '#ai-tab',
  'line-controls': '.line-select-group', 'beat-controls': '.beat-seek', 'view-buttons': '.view-buttons', 'multi-line-controls': '.multi-line-head-controls',
  'offset-control': 'label:has(#offset)', 'rate-control': 'label:has(#rate)', 'pitch-control': '.preserve-pitch',
  'time-progress': '.scrubber-wrap', 'time-readouts': '.time-readouts', clock: '#clock', 'beat-display': '#beat-display', 'bpm-display': '#bpm-display',
  'note-properties': '#properties', 'event-properties': '#event-properties', 'line-properties': '.line-properties-form',
  'noise-properties': '#noise-properties', 'noise-layers': '.noise-layer-panel', 'noise-list': '.noise-list',
  'global-events-panel': '#global-events-panel', 'global-event-properties': '#global-event-properties', 'global-event-inspector': '#global-event-inspector', 'global-event-types': '.global-events-types', 'global-event-density': '.global-event-density',
  'global-events-tool': '#global-events-tool', 'close-global-events': '#close-global-events',
  'line-list': '#line-list', 'multi-line-list': '.multi-line-list', 'asset-tree': '.asset-tree', 'asset-details': '.asset-details',
  'sample-bar': '.noise-sample-bar', 'sample-panel': '.event-sample-panel', field: ':is(.field,.noise-field)', hint: '.hint',
  'panel-title': '.panel-title', 'panel-actions': ':is(.batch-panel-actions,.trajectory-footer,.text-lines-footer,.noise-fit-footer,.noise-tracking-footer)',
  'batch-controls': '.batch-controls', 'batch-ball': '.batch-ball', chat: '.collaboration-chat', 'peer-markers': '.collaboration-markers',
  ...Object.fromEntries(['notes', 'events', 'lines', 'chart', 'noise'].map(pane => [`tab-${pane}`, `[data-pane="${pane}"]`])),
  ...Object.fromEntries([['select', 0], ['tap', 1], ['hold', 2], ['flick', 3], ['drag', 4]].map(([name, type]) => [`tool-${name}`, `[data-tool="${type}"]`])),
});
export const EDITOR_SKIN_SLOTS = ['file-actions', 'transport-actions', 'editor-actions', 'chart-tools', 'toolbar', 'inspector-tabs', 'timeline-header', 'footer'];
export const EDITOR_SKIN_MOVABLE = ['new', 'open', 'save', 'export', 'library', 'migrate', 'recover', 'mods-open', 'preferences', 'help', 'play', 'rewind', 'view-toggle',
  'undo', 'redo', 'copy', 'cut', 'paste', 'mirror', 'delete', 'metadata', 'bpm', 'assets', 'audio-analysis-tool', 'noise-areas-tool',
  'curve-notes', 'curve-trajectory', 'text-lines-tool', 'noise-fit-tool', 'noise-tracking-tool', 'multi-line-tool', 'diagnose', 'history-panel', 'collaboration-tool', 'version-control-tool',
  'seek', 'notes-only', 'game-ui', 'reset-camera', 'mute-current-line', 'tools', 'view-controls', 'view-buttons', 'line-controls', 'beat-controls',
  'offset-control', 'rate-control', 'pitch-control', 'time-readouts', 'multi-line-controls', 'tab-notes', 'tab-events', 'tab-lines', 'tab-chart', 'tab-noise',
  'tool-select', 'tool-tap', 'tool-hold', 'tool-flick', 'tool-drag', 'global-events-tool', 'ai-tool', 'note-tracking-tool'];
export const EDITOR_SKIN_CANVASES = Object.freeze({ notes: '#notes', events: '#events', 'global-events': '#global-events-canvas', 'global-density': '.global-event-density', noise: '#noise-editor-canvas', density: '#note-density', history: '#history-strip', audio: '#audio-analysis-overlay', selection: '.selection-overlay', 'batch-preview': '', easing: '.easing-preview', bezier: '.bezier-editor', curve: '.curve-preview', 'text-lines': '.text-lines-preview', trajectory: '.trajectory-preview,.trajectory-preset-thumbnail', 'noise-fit': '.noise-fit-source', 'line-thumbnail': '.line-switcher-card canvas', 'clipboard-thumbnail': '.clipboard-thumbnail' });
export const EDITOR_SKIN_BUILTINS = Object.freeze(Object.fromEntries(['folder', 'save', 'setting', 'help', 'play', 'replay', 'showback', 'jump', 'copy', 'shear', 'paste', 'delete0', 'switch', 'layout', 'return', 'info', 'waves', 'bezier', 'addline', 'mute'].map(name => [name, `rpe/Texture/icon/${name}.png`])));
export const EDITOR_SKIN_IMPORTANT = /^(?:--(?:rpen|skin)-[a-z0-9-]+|color|background(?:-[a-z-]+)?|border(?:-[a-z-]+)?|outline(?:-[a-z-]+)?|font(?:-[a-z-]+)?|line-height|letter-spacing|text-[a-z-]+|width|height|min-width|max-width|min-height|max-height|padding(?:-[a-z-]+)?|margin(?:-[a-z-]+)?|gap|row-gap|column-gap|flex(?:-[a-z-]+)?|grid(?:-[a-z-]+)?|order|box-shadow|filter)$/;
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const fail = message => { throw new Error(t('editor-skin.sd6e9020') + message); };
const string = (value, name, max = 500) => { if (typeof value !== 'string' || !value.trim() || value.length > max) fail(name + t('editor-skin.s994ff2b')); return value; };
const identifier = /^[a-z][a-z0-9-]{0,63}$/;
const assetTypes = { image: /\.(?:png|jpe?g|webp|gif|avif|apng|svg)$/i, font: /\.(?:woff2?|ttf|otf)$/i };
export function editorSkinPath(path) {
  string(path, t('editor-skin.s0fd3a9b'), 240);
  if (/[\\:\x00-\x1f?#]/.test(path) || path.startsWith('/') || path.split('/').some(part => !part || part === '.' || part === '..')) fail(t('editor-skin.sd73458d') + path);
  return path;
}
function cssValue(value) {
  string(value, t('editor-skin.sfd918a6'), 3000);
  if (/[{};<>\\]|\/\*|\*\/|url\s*\(|(?:https?|data|javascript|file|blob):|@|expression\s*\(|!\s*important|(?:attr|env|image-set|paint|src)\s*\(/i.test(value)) fail(t('editor-skin.s831f831'));
  return value;
}
export function editorSkinSelector(selector) {
  string(selector, t('editor-skin.s5da56ab'), 500);
  if (/[{};<\\]|\/\*|\*\/|:visited|:host|::slotted|\biframe\b|\brpen-skin-recovery\b/i.test(selector)) fail(t('editor-skin.s9753257'));
  return selector.replace(/@([a-z][a-z0-9-]*)/g, (match, key) => Object.hasOwn(EDITOR_SKIN_COMPONENTS, key) ? EDITOR_SKIN_COMPONENTS[key] : fail(t('editor-skin.s3304b34') + key));
}
function declarations(value, path) {
  if (!plain(value) || Object.keys(value).length > 100) fail(path + t('editor-skin.sb7a7763'));
  for (const [key, item] of Object.entries(value)) {
    if (!/^(?:--(?:skin|rpen)-[a-z0-9-]+|-?[a-z][a-z0-9-]*)$/.test(key) || /^(?:behavior|-moz-binding|all)$/.test(key)) fail(t('editor-skin.s57f9af3') + key);
    // `content` and friends may be a per-locale map; every entry must be safe.
    if (isLocalizedMap(item)) for (const entry of Object.values(item)) cssValue(entry);
    else cssValue(item);
  }
}
function rules(items = [], depth = 0) {
  if (!Array.isArray(items) || items.length > 1000 || depth > 4) fail(t('editor-skin.s492db49'));
  for (const rule of items) {
    if (!plain(rule)) fail(t('editor-skin.s4d21160'));
    const conditions = ['media', 'container', 'supports', 'startingStyle'].filter(key => rule[key] !== undefined);
    if (conditions.length > 1) fail(t('editor-skin.sc13793c'));
    if (conditions.length) {
      const kind = conditions[0];
      if (kind === 'startingStyle') { if (rule.startingStyle !== true) fail(t('editor-skin.se8d89c9')); }
      else {
        string(rule[kind], kind + t('editor-skin.sef02404'), 500);
        if (/[{};@\\]|\/\*|\*\/|url\s*\(|(?:https?|data|javascript|file):/i.test(rule[kind]) || !/^[a-z0-9_ ():.\-,\/<>="'%#+*]+$/i.test(rule[kind])) fail(kind + t('editor-skin.sc48c110'));
      }
      rules(rule.rules, depth + 1);
    } else {
      editorSkinSelector(rule.selector); declarations(rule.set, rule.selector);
      if (rule.important !== undefined && (!Array.isArray(rule.important) || rule.important.some(key => !Object.hasOwn(rule.set, key) || !EDITOR_SKIN_IMPORTANT.test(key)))) fail(t('editor-skin.sfc6991c'));
    }
  }
}
const paletteParameter = /^parameter\(([a-z][a-z0-9-]{0,63})\)$/;
function canvasConfig(config, parameters = {}) {
  if (!plain(config) || !plain(config.palette ?? {})) fail(t('editor-skin.s9d79bdc'));
  for (const [from, to] of Object.entries(config.palette ?? {})) {
    if (!/^#[0-9a-f]{6}$/i.test(from) || typeof to !== 'string') fail(t('editor-skin.s2369a48'));
    const reference = to.match(paletteParameter);
    if (reference ? parameters[reference[1]]?.type !== 'color' : !/^#[0-9a-f]{6}$/i.test(to)) fail(reference ? t('editor-skin.s20cdebc') + reference[1] : t('editor-skin.s633f769'));
  }
  for (const [key, minimum, maximum] of [['fontScale', .7, 1.8], ['opacity', 0, 1], ['lineWidthScale', .25, 4]]) if (config[key] !== undefined && (!Number.isFinite(config[key]) || config[key] < minimum || config[key] > maximum)) fail('Canvas ' + key + t('editor-skin.seda91d3'));
  if (config.lineDash !== undefined && (!Array.isArray(config.lineDash) || config.lineDash.length > 16 || config.lineDash.some(value => !Number.isFinite(value) || value < 0 || value > 100))) fail(t('editor-skin.s8c89a26'));
  if (!plain(config.targets ?? {})) fail(t('editor-skin.s9dbeb5d'));
  for (const [key, target] of Object.entries(config.targets ?? {})) { if (!Object.hasOwn(EDITOR_SKIN_CANVASES, key) || target?.targets !== undefined) fail(t('editor-skin.s46d75b4') + key); canvasConfig(target, parameters); }
}
export function resolveEditorSkin(skin, { variant = 'base', parameters = {} } = {}) {
  const selected = variant === 'base' ? {} : skin.variants?.[variant];
  if (!selected) fail(t('editor-skin.se7e1a45') + variant);
  const values = Object.fromEntries(Object.entries(skin.parameters ?? {}).map(([id, definition]) => {
    let value = Object.hasOwn(parameters, id) ? parameters[id] : definition.default;
    if (definition.type === 'number') { value = Number(value); if (!Number.isFinite(value)) value = definition.default; value = Math.max(definition.min, Math.min(definition.max, value)); value = `${value}${definition.unit ?? ''}`; }
    else if (definition.type === 'boolean') value = value === true ? '1' : '0';
    else if (definition.type === 'color' && !/^#[0-9a-f]{6}$/i.test(value)) value = definition.default;
    else if (definition.type === 'select' && !Object.hasOwn(definition.options, value)) value = definition.default;
    return [`param-${id}`, value];
  }));
  // Canvas colours are plain strings at draw time, so palette parameter references resolve here.
  const palette = entries => entries && Object.fromEntries(Object.entries(entries).map(([from, to]) => { const reference = String(to).match(paletteParameter); return [from, reference ? values['param-' + reference[1]] ?? to : to]; }));
  const targets = { ...skin.canvas?.targets, ...selected.canvas?.targets };
  return { ...skin, colorScheme: selected.colorScheme ?? skin.colorScheme, tokens: { ...skin.tokens, ...selected.tokens, ...values }, styles: [...(skin.styles ?? []), ...(selected.styles ?? [])], canvas: { ...skin.canvas, ...selected.canvas, palette: palette({ ...skin.canvas?.palette, ...selected.canvas?.palette }), targets: Object.fromEntries(Object.entries(targets).map(([role, target]) => [role, { ...target, palette: palette(target.palette) }])) } };
}
export function parseEditorSkin(files) {
  if (!(files instanceof Map) || files.size > EDITOR_SKIN_LIMITS.files) fail(t('editor-skin.sd828666'));
  let total = 0; const paths = new Set();
  for (const [path, bytes] of files) {
    editorSkinPath(path); if (!(bytes instanceof Uint8Array) || bytes.byteLength > EDITOR_SKIN_LIMITS.fileBytes) fail(t('editor-skin.s14a14ef') + path);
    if (paths.has(path.toLowerCase())) fail(t('editor-skin.s7ff962f') + path);
    paths.add(path.toLowerCase()); total += bytes.byteLength;
  }
  if (total > EDITOR_SKIN_LIMITS.bytes) fail(t('editor-skin.sdeb1cf2'));
  const source = files.get('skin.json'); if (!source) fail('根目录缺少 skin.json');
  let skin; try { skin = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(source)); } catch { fail(t('editor-skin.s6899307')); }
  if (!plain(skin) || skin.protocol !== 'rpen-editor-skin' || skin.version !== 1) fail(t('editor-skin.s2d7b838'));
  if (typeof skin.id !== 'string' || !identifier.test(skin.id) || skin.id === 'default') fail(t('editor-skin.s48be567'));
  // Metadata and interface strings accept a per-locale map as well as a plain
  // string, so one skin package can ship several languages.
  const localizedString = (value, label, limit) => {
    if (isLocalizedMap(value)) { if (!Object.keys(value).length) fail(label); for (const entry of Object.values(value)) string(entry, label, limit); return; }
    string(value, label, limit);
  };
  localizedString(skin.name, t('editor-skin.sbc74380'), 80); if (skin.author !== undefined) string(skin.author, t('editor-skin.s698bea5'), 100);
  if (skin.description !== undefined) localizedString(skin.description, t('editor-skin.s26670dd'), 2000);
  if (skin.skinVersion !== undefined) string(skin.skinVersion, t('editor-skin.sc8da38c'), 40);
  if (skin.license !== undefined) localizedString(skin.license, t('editor-skin.sca5894d'), 4000);
  if (skin.compatibility !== undefined) {
    if (!plain(skin.compatibility)) fail(t('editor-skin.s9cf4787'));
    for (const key of ['minApi', 'maxApi']) if (skin.compatibility[key] !== undefined && (!Number.isInteger(skin.compatibility[key]) || skin.compatibility[key] < 1)) fail(t('editor-skin.s2b5c5be'));
    if ((skin.compatibility.minApi ?? 1) > EDITOR_SKIN_API || (skin.compatibility.maxApi ?? Infinity) < EDITOR_SKIN_API) fail(t('editor-skin.sb0b99d7') + EDITOR_SKIN_API);
  }
  if (skin.colorScheme !== undefined && !['light', 'dark'].includes(skin.colorScheme)) fail(t('editor-skin.s8409f11'));
  const assets = skin.assets ?? {}; if (!plain(assets) || Object.keys(assets).length > 256) fail(t('editor-skin.s3c5323b'));
  const referenced = new Set(['skin.json']);
  for (const [id, asset] of Object.entries(assets)) {
    if (!identifier.test(id) || !plain(asset) || !Object.hasOwn(assetTypes, asset.type)) fail(t('editor-skin.s69d806a') + id);
    if (asset.builtin !== undefined) {
      if (asset.type !== 'image' || typeof asset.builtin !== 'string' || !Object.hasOwn(EDITOR_SKIN_BUILTINS, asset.builtin) || asset.path !== undefined || asset.sources !== undefined) fail(t('editor-skin.sfa09cf6') + id);
    } else {
      editorSkinPath(asset.path); if (!files.has(asset.path) || !assetTypes[asset.type].test(asset.path)) fail(t('editor-skin.s8c33464') + id);
      referenced.add(asset.path);
      if (asset.sources !== undefined) {
        if (asset.type !== 'image' || !Array.isArray(asset.sources) || asset.sources.length > 4) fail(t('editor-skin.s318d510'));
        const scales = new Set([1]);
        for (const source of asset.sources) {
          if (!plain(source) || !Number.isFinite(source.scale) || source.scale <= 1 || source.scale > 4 || scales.has(source.scale)) fail(t('editor-skin.sa9bd4e6')); scales.add(source.scale);
          editorSkinPath(source.path); if (!files.has(source.path) || !assetTypes.image.test(source.path)) fail(t('editor-skin.s2a2dc9a')); referenced.add(source.path);
        }
      }
    }
  }
  if ([...files.keys()].some(path => !referenced.has(path))) fail(t('editor-skin.s990ffed'));
  if (!plain(skin.tokens ?? {})) fail(t('editor-skin.s68377cf'));
  for (const [key, value] of Object.entries(skin.tokens ?? {})) { if (!identifier.test(key)) fail(t('editor-skin.s387329b') + key); cssValue(value); }
  rules(skin.styles);
  if (!plain(skin.properties ?? {}) || Object.keys(skin.properties ?? {}).length > 40) fail(t('editor-skin.s64b0d86'));
  for (const [name, definition] of Object.entries(skin.properties ?? {})) {
    if (!/^--skin-[a-z0-9-]+$/.test(name) || !plain(definition) || !['*', '<number>', '<length>', '<angle>', '<color>', '<percentage>', '<time>'].includes(definition.syntax) || typeof definition.inherits !== 'boolean') fail(t('editor-skin.sa3fca94'));
    cssValue(definition.initialValue);
  }
  if (skin.preview !== undefined && (typeof skin.preview !== 'string' || assets[skin.preview]?.type !== 'image')) fail(t('editor-skin.sb14178e'));
  if (!plain(skin.parameters ?? {}) || Object.keys(skin.parameters ?? {}).length > 40) fail(t('editor-skin.sce9f0f1'));
  for (const [id, definition] of Object.entries(skin.parameters ?? {})) {
    if (!identifier.test(id) || !plain(definition)) fail(t('editor-skin.s951bbee') + id); localizedString(definition.label, t('editor-skin.s480d10d'), 80);
    if (definition.type === 'number') {
      if (![definition.min, definition.max, definition.default, definition.step ?? 1].every(Number.isFinite) || definition.max < definition.min || definition.default < definition.min || definition.default > definition.max || (definition.step ?? 1) <= 0 || !/^(?:px|em|rem|%|ms|s|deg)?$/.test(definition.unit ?? '')) fail(t('editor-skin.s688a8ab'));
    } else if (definition.type === 'boolean') { if (typeof definition.default !== 'boolean') fail(t('editor-skin.sbd9521e')); }
    else if (definition.type === 'color') { if (typeof definition.default !== 'string' || !/^#[0-9a-f]{6}$/i.test(definition.default)) fail(t('editor-skin.sb99880c')); }
    else if (definition.type === 'select') {
      if (!plain(definition.options) || typeof definition.default !== 'string' || !Object.hasOwn(definition.options, definition.default) || Object.keys(definition.options).length > 30) fail(t('editor-skin.s3b0a741'));
      for (const [value, label] of Object.entries(definition.options)) { cssValue(value); localizedString(label, t('editor-skin.s69bbb4b'), 80); }
    } else fail(t('editor-skin.s0e3aa28'));
  }
  if (!plain(skin.variants ?? {}) || Object.keys(skin.variants ?? {}).length > 12) fail(t('editor-skin.s7487061'));
  for (const [id, variant] of Object.entries(skin.variants ?? {})) {
    if (!identifier.test(id) || ['auto', 'base'].includes(id) || !plain(variant)) fail(t('editor-skin.sb7305ad')); string(variant.name, t('editor-skin.s0c41910'), 80);
    if (variant.colorScheme !== undefined && !['light', 'dark'].includes(variant.colorScheme)) fail(t('editor-skin.s86e9ee3'));
    if (!plain(variant.tokens ?? {})) fail(t('editor-skin.s230027e'));
    for (const [key, value] of Object.entries(variant.tokens ?? {})) { if (!identifier.test(key)) fail(t('editor-skin.s607b1ba')); cssValue(value); }
    rules(variant.styles); if (variant.canvas) canvasConfig(variant.canvas, skin.parameters);
  }
  if (skin.systemVariants !== undefined) for (const scheme of ['light', 'dark']) if (!plain(skin.systemVariants) || !Object.hasOwn(skin.variants ?? {}, skin.systemVariants[scheme])) fail(t('editor-skin.s897c9fa'));
  if (!Array.isArray(skin.hide ?? []) || (skin.hide?.length ?? 0) > 300) fail(t('editor-skin.s8d92551'));
  for (const selector of skin.hide ?? []) editorSkinSelector(selector);
  const motions = skin.motions ?? {}; if (!plain(motions) || Object.keys(motions).length > 64) fail(t('editor-skin.s125b556'));
  for (const [id, frames] of Object.entries(motions)) {
    if (!identifier.test(id) || !plain(frames) || Object.keys(frames).length > 40) fail(t('editor-skin.s097114a') + id);
    for (const [at, set] of Object.entries(frames)) { if (!/^(?:from|to|100%|\d{1,2}(?:\.\d+)?%)$/.test(at)) fail(t('editor-skin.sae2b64e') + at); declarations(set, id); }
  }
  if (!Array.isArray(skin.organize ?? []) || (skin.organize?.length ?? 0) > 40) fail(t('editor-skin.s142fc35'));
  const organized = new Set(); const groups = new Set();
  for (const group of skin.organize ?? []) {
    if (!plain(group) || !EDITOR_SKIN_SLOTS.includes(group.slot) || !Array.isArray(group.items)) fail(t('editor-skin.sf969b3c'));
    if (group.id !== undefined && (typeof group.id !== 'string' || !identifier.test(group.id) || groups.has(group.id))) fail(t('editor-skin.sd84a5c3'));
    if (group.id) groups.add(group.id);
    if (!group.id && ['label', 'direction', 'collapsible'].some(key => group[key] !== undefined)) fail(t('editor-skin.s20b449c'));
    if (group.collapsible !== undefined && (typeof group.collapsible !== 'boolean' || group.collapsible && !group.label)) fail(t('editor-skin.s7f31460'));
    if (group.label !== undefined) localizedString(group.label, t('editor-skin.s35aeafd'), 60);
    if (group.direction !== undefined && !['row', 'column'].includes(group.direction)) fail(t('editor-skin.sd6fcea7'));
    for (const item of group.items) { if (!EDITOR_SKIN_MOVABLE.includes(item) || organized.has(item)) fail(t('editor-skin.sbc5496a') + item); organized.add(item); }
  }
  if (!Array.isArray(skin.texts ?? []) || (skin.texts?.length ?? 0) > 300) fail(t('editor-skin.sdfbb296'));
  for (const entry of skin.texts ?? []) {
    if (!plain(entry)) fail(t('editor-skin.sc2bb92f')); editorSkinSelector(entry.selector);
    for (const key of ['text', 'title', 'ariaLabel', 'placeholder']) {
      if (entry[key] === undefined) continue;
      const values = isLocalizedMap(entry[key]) ? Object.values(entry[key]) : [entry[key]];
      if (!values.length || values.some(value => typeof value !== 'string' || value.length > 1000)) fail(t('editor-skin.s1df9a6d'));
    }
  }
  if (Array.isArray(skin.icons)) {
    if (skin.icons.length > 300) fail(t('editor-skin.s40e7e3e'));
    for (const icon of skin.icons) { if (!plain(icon) || assets[icon.asset]?.type !== 'image') fail(t('editor-skin.s86d8bca')); editorSkinSelector(icon.selector); }
  } else {
    if (!plain(skin.icons ?? {})) fail(t('editor-skin.s2f00dc0'));
    for (const [id, asset] of Object.entries(skin.icons ?? {})) if (!Object.hasOwn(EDITOR_SKIN_COMPONENTS, id) || typeof asset !== 'string' || assets[asset]?.type !== 'image') fail(t('editor-skin.s9df6945') + id);
  }
  if (!Array.isArray(skin.decorations ?? []) || (skin.decorations?.length ?? 0) > 24) fail(t('editor-skin.sc31b745'));
  const decorations = new Set();
  for (const entry of skin.decorations ?? []) {
    if (!plain(entry) || typeof entry.id !== 'string' || !identifier.test(entry.id) || decorations.has(entry.id) || typeof entry.asset !== 'string' || assets[entry.asset]?.type !== 'image') fail(t('editor-skin.sc5bb531')); decorations.add(entry.id);
    if (entry.selector !== undefined) editorSkinSelector(entry.selector);
    else if (!Object.hasOwn(EDITOR_SKIN_COMPONENTS, entry.target)) fail(t('editor-skin.s80f0cd5'));
    if (entry.placement !== undefined && !['prepend', 'append', 'before', 'after'].includes(entry.placement)) fail(t('editor-skin.s5c5990f'));
  }
  canvasConfig(skin.canvas ?? {}, skin.parameters);
  if (!plain(skin.canvas?.targets ?? {})) fail(t('editor-skin.s9dbeb5d'));
  for (const [key, config] of Object.entries(skin.canvas?.targets ?? {})) { if (!Object.hasOwn(EDITOR_SKIN_CANVASES, key)) fail(t('editor-skin.s5b4e0ee') + key); canvasConfig(config, skin.parameters); }
  for (const canvas of [skin.canvas, ...Object.values(skin.variants ?? {}).map(variant => variant.canvas)]) for (const config of [canvas, ...Object.values(canvas?.targets ?? {})]) if (config?.font !== undefined && (typeof config.font !== 'string' || assets[config.font]?.type !== 'font')) fail(t('editor-skin.s2909d98'));
  const allValues = JSON.stringify([skin.tokens, skin.styles, skin.motions, skin.variants]);
  for (const match of allValues.matchAll(/\b(asset|font|motion|parameter)\(([a-z][a-z0-9-]*)\)/g)) {
    const [, kind, id] = match;
    if (kind === 'parameter' ? !Object.hasOwn(skin.parameters ?? {}, id) : kind === 'motion' ? !Object.hasOwn(motions, id) : kind === 'font' ? assets[id]?.type !== 'font' : assets[id]?.type !== 'image') fail(t('editor-skin.s9bbb36e') + id);
  }
  return { skin, files, bytes: total };
}

export function compileEditorSkin(skin, { images = new Map(), fonts = new Map(), imageSets = new Map() } = {}) {
  const prefix = `:root[data-editor-skin="${skin.id}"]`;
  const value = text => text.replace(/\b(asset|font|motion|parameter)\(([a-z][a-z0-9-]*)\)/g, (match, kind, id) => {
    if (kind === 'motion') return `rpen-${skin.id}-${id}`;
    if (kind === 'parameter') return `var(--rpen-param-${id})`;
    const entry = (kind === 'font' ? fonts : images).get(id); if (!entry) fail(t('editor-skin.sdc0f111') + id);
    return kind === 'font' ? `"${entry}"` : imageSets.get(id) ?? `url("${entry}")`;
  });
  const declarations = (set, important = []) => Object.entries(set).map(([key, item]) => `${key}:${value(isLocalizedMap(item) ? localizedValue(item) : item)}${important.includes(key) ? '!important' : ''}`).join(';');
  // Split only top-level commas; pseudo-elements must remain outside :is().
  const selector = text => {
    const source = editorSkinSelector(text); const parts = []; let start = 0; let depth = 0; let quote = '';
    for (let i = 0; i < source.length; i++) {
      const char = source[i];
      if (quote) { if (char === quote) quote = ''; continue; }
      if (char === '"' || char === "'") quote = char;
      else if (char === '(' || char === '[') depth++;
      else if (char === ')' || char === ']') depth--;
      else if (char === ',' && depth === 0) { parts.push(source.slice(start, i).trim()); start = i + 1; }
    }
    parts.push(source.slice(start).trim());
    return parts.map(part => part.startsWith(':root') ? `${prefix}${part.slice(5)}` : /^html(?=[\s.#[(:]|$)/.test(part) ? `${prefix}${part.slice(4)}` : `${prefix} ${part}`).join(',');
  };
  const rules = entries => (entries ?? []).map(rule => {
    const kind = ['media', 'container', 'supports', 'startingStyle'].find(key => rule[key] !== undefined);
    return kind ? `@${kind === 'startingStyle' ? 'starting-style' : kind}${kind === 'startingStyle' ? '' : ' ' + rule[kind]}{${rules(rule.rules)}}` : `${selector(rule.selector)}{${declarations(rule.set, rule.important)}}`;
  }).join('\n');
  const tokens = Object.entries(skin.tokens ?? {}).map(([key, text]) => `--rpen-${key}:${value(text)}`).join(';');
  const frames = Object.entries(skin.motions ?? {}).map(([id, frames]) => `@keyframes rpen-${skin.id}-${id}{${Object.entries(frames).map(([at, set]) => `${at}{${declarations(set)}}`).join('')}}`).join('\n');
  const properties = Object.entries(skin.properties ?? {}).map(([name, definition]) => `@property ${name}{syntax:"${definition.syntax}";inherits:${definition.inherits};initial-value:${value(definition.initialValue)}}`).join('\n');
  const iconEntries = Array.isArray(skin.icons) ? skin.icons : Object.entries(skin.icons ?? {}).map(([id, asset]) => ({ selector: '@' + id, asset }));
  const icons = iconEntries.map(icon => `${selector(`:is(${editorSkinSelector(icon.selector)})::before`)}{content:"";display:inline-block;width:18px;height:18px;vertical-align:middle;background-image:${imageSets.get(icon.asset) ?? `url("${images.get(icon.asset)}")`};background-size:contain;background-repeat:no-repeat;background-position:center;margin-right:6px}`).join('\n');
  const hidden = (skin.hide ?? []).map(text => `${selector(text)}{display:none!important;transition:none!important;animation:none!important}`).join('\n');
  return `${prefix}{color-scheme:${skin.colorScheme ?? 'dark'};${tokens}}\n${properties}\n${frames}\n${icons}\n${rules(skin.styles)}\n${hidden}\n@media(prefers-reduced-motion:reduce){${prefix} *,${prefix} *::before,${prefix} *::after{animation-duration:0.001ms!important;animation-iteration-count:1!important;transition-duration:0.001ms!important}}`;
}
