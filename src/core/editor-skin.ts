export const EDITOR_SKIN_VERSION = 1;
export const EDITOR_SKIN_API = 3;
export const EDITOR_SKIN_LIMITS = Object.freeze({ files: 512, bytes: 32 * 1024 * 1024, fileBytes: 12 * 1024 * 1024 });
export const EDITOR_SKIN_COMPONENTS: Readonly<Record<string, string>> = Object.freeze({
  root: ':root', app: 'body', header: 'header', brand: '.brand', 'document-name': '#document-name', 'file-actions': 'header nav',
  transport: '.transport', 'transport-actions': '.transport-group', workspace: '.workspace', editor: '.editor', toolbar: '.editor-toolbar',
  tools: '.tools', 'view-controls': '.view-controls-inline', 'timeline-header': '.timeline-head', stage: '.stage',
  'editor-actions': '.editor-footer', inspector: '.inspector', 'inspector-tabs': '.inspector-tabs', 'chart-tools': '[data-panel="chart"] .action-grid',
  'project-home': '#home', 'project-list': '#project-cards', footer: 'body > footer', status: '#status', notifications: '#notifications',
  dialog: '#modal', settings: '#settings-modal', 'settings-body': '.settings-body', 'theme-settings': '#editor-skin-settings',
  'note-skin-settings': '#note-skin-settings', 'note-skins-open': '#note-skins-open', 'note-skin-manager': '#note-skin-modal', 'note-skin-gallery': '.note-skin-gallery',
  'mod-manager': '#mod-manager', 'mod-list': '.mod-manager-list', 'mod-details': '.mod-manager-details', 'mod-status': '#mods-status', 'mod-warning': '#mod-import-warning',
  'context-menu': '.timeline-context-menu', 'line-overview': '.line-switcher', 'clipboard-history': '#clipboard-results',
  ...Object.fromEntries(['new', 'open', 'save', 'export', 'library', 'migrate', 'recover', 'mods-open', 'preferences', 'help', 'play', 'rewind', 'view-toggle',
    'seek', 'undo', 'redo', 'copy', 'cut', 'paste', 'mirror', 'delete', 'notes-only', 'game-ui', 'reset-camera', 'mute-current-line',
    'metadata', 'bpm', 'assets', 'audio-analysis-tool', 'noise-areas-tool', 'curve-notes', 'curve-trajectory', 'text-lines-tool',
    'noise-fit-tool', 'noise-tracking-tool', 'multi-line-tool', 'diagnose', 'history-panel', 'collaboration-tool'].map(id => [id, '#' + id])),
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
export const EDITOR_SKIN_MOVABLE = ['new', 'open', 'save', 'export', 'library', 'migrate', 'recover', 'preferences', 'help', 'play', 'rewind', 'view-toggle',
  'undo', 'redo', 'copy', 'cut', 'paste', 'mirror', 'delete', 'metadata', 'bpm', 'assets', 'audio-analysis-tool', 'noise-areas-tool',
  'curve-notes', 'curve-trajectory', 'text-lines-tool', 'noise-fit-tool', 'noise-tracking-tool', 'multi-line-tool', 'diagnose', 'history-panel', 'collaboration-tool',
  'seek', 'notes-only', 'game-ui', 'reset-camera', 'mute-current-line', 'tools', 'view-controls', 'view-buttons', 'line-controls', 'beat-controls',
  'offset-control', 'rate-control', 'pitch-control', 'time-readouts', 'multi-line-controls', 'tab-notes', 'tab-events', 'tab-lines', 'tab-chart', 'tab-noise',
  'tool-select', 'tool-tap', 'tool-hold', 'tool-flick', 'tool-drag', 'global-events-tool'];
export const EDITOR_SKIN_CANVASES: Readonly<Record<string, string>> = Object.freeze({ notes: '#notes', events: '#events', 'global-events': '#global-events-canvas', 'global-density': '.global-event-density', noise: '#noise-editor-canvas', density: '#note-density', history: '#history-strip', audio: '#audio-analysis-overlay', selection: '.selection-overlay', 'batch-preview': '', easing: '.easing-preview', bezier: '.bezier-editor', curve: '.curve-preview', 'text-lines': '.text-lines-preview', trajectory: '.trajectory-preview,.trajectory-preset-thumbnail', 'noise-fit': '.noise-fit-source', 'line-thumbnail': '.line-switcher-card canvas', 'clipboard-thumbnail': '.clipboard-thumbnail' });
export const EDITOR_SKIN_BUILTINS: Readonly<Record<string, string>> = Object.freeze(Object.fromEntries(['folder', 'save', 'setting', 'help', 'play', 'replay', 'showback', 'jump', 'copy', 'shear', 'paste', 'delete0', 'switch', 'layout', 'return', 'info', 'waves', 'bezier', 'addline', 'mute'].map(name => [name, `rpe/Texture/icon/${name}.png`])));
/** One asset a skin package declares. */
export interface EditorSkinAsset {
  type: 'image' | 'font';
  path?: string;
  builtin?: string;
  sources?: { path: string; scale: number }[];
}

/** One text override. */
export interface EditorSkinText {
  selector: string;
  text?: string;
  title?: string;
  ariaLabel?: string;
  placeholder?: string;
}

/** One icon override. */
export interface EditorSkinIcon { selector: string; asset: string }

/** One control group a skin declares in `organize`. */
export interface EditorSkinGroup {
  slot: string;
  id?: string;
  label?: string;
  direction?: 'row' | 'column';
  collapsible?: boolean;
  items: string[];
}

/** A parsed `skin.json` whose members are validated one by one, so it stays indexable. */
export interface SkinDocument {
  [key: string]: unknown;
  id?: string;
  name?: string;
  author?: string;
  description?: string;
  skinVersion?: string;
  license?: string;
  colorScheme?: 'light' | 'dark';
  assets?: Record<string, EditorSkinAsset>;
  styles?: EditorSkinRule[];
  variants?: Record<string, EditorSkinVariant>;
  systemVariants?: Record<string, string>;
  texts?: EditorSkinText[];
  hide?: string[];
  icons?: EditorSkinIcon[] | Record<string, string>;
  decorations?: EditorSkinDecoration[];
  organize?: EditorSkinGroup[];
  canvas?: EditorSkinCanvasConfig;
  tokens?: Record<string, string>;
  parameters?: Record<string, EditorSkinParameter>;
  preview?: string;
}

/** A validated skin package together with the files it was parsed from. */
export interface EditorSkinPackage {
  skin: SkinDocument;
  files: Map<string, Uint8Array>;
  bytes: number;
}

export const EDITOR_SKIN_IMPORTANT = /^(?:--(?:rpen|skin)-[a-z0-9-]+|color|background(?:-[a-z-]+)?|border(?:-[a-z-]+)?|outline(?:-[a-z-]+)?|font(?:-[a-z-]+)?|line-height|letter-spacing|text-[a-z-]+|width|height|min-width|max-width|min-height|max-height|padding(?:-[a-z-]+)?|margin(?:-[a-z-]+)?|gap|row-gap|column-gap|flex(?:-[a-z-]+)?|grid(?:-[a-z-]+)?|order|box-shadow|filter)$/;

/** Per-colour-channel palette overrides a canvas maps its source colours through. */
export interface EditorSkinCanvasConfig {
  palette?: Record<string, string>;
  font?: string;
  fontScale?: number;
  opacity?: number;
  lineWidthScale?: number;
  lineDash?: number[];
  targets?: Record<string, EditorSkinCanvasConfig>;
}

/** One nested style rule. */
export interface EditorSkinRule {
  selector?: string;
  set?: Record<string, string>;
  important?: string[];
  media?: string;
  container?: string;
  supports?: string;
  startingStyle?: true;
  rules?: EditorSkinRule[];
}

/** One parameter a skin exposes to the settings UI. */
export interface EditorSkinParameter {
  label: string;
  type: 'number' | 'boolean' | 'color' | 'select';
  default: number | boolean | string;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: Record<string, string>;
}

/** One named skin variant. */
export interface EditorSkinVariant {
  name: string;
  colorScheme?: 'light' | 'dark';
  tokens?: Record<string, string>;
  styles?: EditorSkinRule[];
  canvas?: EditorSkinCanvasConfig;
}

/** One `@property` registration. */
export interface EditorSkinProperty {
  syntax: '*' | '<number>' | '<length>' | '<angle>' | '<color>' | '<percentage>' | '<time>';
  inherits: boolean;
  initialValue: string;
}

/** One decorative image attached to a component. */
export interface EditorSkinDecoration {
  id: string;
  asset: string;
  selector?: string;
  target?: string;
  placement?: 'prepend' | 'append' | 'before' | 'after';
}

const plain = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};
const fail = (message: string): never => { throw new Error('编辑器皮肤：' + message); };
const string = (value: unknown, name: string, max = 500): string => { if (typeof value !== 'string' || !value.trim() || value.length > max) fail(name + ' 无效'); return value as string; };
const identifier = /^[a-z][a-z0-9-]{0,63}$/;
const assetTypes = { image: /\.(?:png|jpe?g|webp|gif|avif|apng|svg)$/i, font: /\.(?:woff2?|ttf|otf)$/i };
export function editorSkinPath(path: unknown): string {
  string(path, '文件路径', 240);
  const text = path as string;
  if (/[\\:\x00-\x1f?#]/.test(text) || text.startsWith('/') || text.split('/').some(part => !part || part === '.' || part === '..')) fail('不安全的文件路径：' + text);
  return text;
}
function cssValue(value: unknown): string {
  string(value, 'CSS 值', 3000);
  const text = value as string;
  if (/[{};<>\\]|\/\*|\*\/|url\s*\(|(?:https?|data|javascript|file|blob):|@|expression\s*\(|!\s*important|(?:attr|env|image-set|paint|src)\s*\(/i.test(text)) fail('CSS 值含不支持的内容');
  return text;
}
export function editorSkinSelector(selector: unknown): string {
  string(selector, '选择器', 500);
  const text = selector as string;
  if (/[{};<\\]|\/\*|\*\/|:visited|:host|::slotted|\biframe\b|\brpen-skin-recovery\b/i.test(text)) fail('选择器含不支持的内容');
  return text.replace(/@([a-z][a-z0-9-]*)/g, (match, key: string) => Object.hasOwn(EDITOR_SKIN_COMPONENTS, key) ? (EDITOR_SKIN_COMPONENTS as Record<string, string>)[key]! : fail('未知组件：' + key));
}
function declarations(value: unknown, path: string): void {
  if (!plain(value) || Object.keys(value).length > 100) fail(path + ' 必须为 CSS 属性对象');
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (!/^(?:--(?:skin|rpen)-[a-z0-9-]+|-?[a-z][a-z0-9-]*)$/.test(key) || /^(?:behavior|-moz-binding|all)$/.test(key)) fail('不支持的 CSS 属性：' + key);
    cssValue(item);
  }
}
function rules(items: unknown = [], depth = 0): void {
  if (!Array.isArray(items) || items.length > 1000 || depth > 4) fail('样式规则数量或嵌套超限');
  for (const item of items as unknown[]) {
    if (!plain(item)) fail('样式规则必须为对象');
    const rule = item as Record<string, unknown>;
    const conditions = (['media', 'container', 'supports', 'startingStyle'] as const).filter(key => rule[key] !== undefined);
    if (conditions.length > 1) fail('每个条件规则只能有一种条件，可用 rules 嵌套组合');
    if (conditions.length) {
      const kind = conditions[0]!;
      if (kind === 'startingStyle') { if (rule.startingStyle !== true) fail('startingStyle 必须为 true'); }
      else {
        string(rule[kind], kind + ' 条件', 500);
        const condition = rule[kind] as string;
        if (/[{};@\\]|\/\*|\*\/|url\s*\(|(?:https?|data|javascript|file):/i.test(condition) || !/^[a-z0-9_ ():.\-,\/<>="'%#+*]+$/i.test(condition)) fail(kind + ' 条件含非法字符');
      }
      rules(rule.rules, depth + 1);
    } else {
      editorSkinSelector(rule.selector); declarations(rule.set, String(rule.selector));
      if (rule.important !== undefined && (!Array.isArray(rule.important) || rule.important.some(key => !plain(rule.set) || !Object.hasOwn(rule.set, key as string) || !EDITOR_SKIN_IMPORTANT.test(String(key))))) fail('important 只允许覆盖本规则中的外观、尺寸及排列属性');
    }
  }
}
const paletteParameter = /^parameter\(([a-z][a-z0-9-]{0,63})\)$/;
function canvasConfig(config: unknown, parameters: Record<string, unknown> = {}): void {
  if (!plain(config) || !plain(config.palette ?? {})) fail('canvas 无效');
  const settings = config as Record<string, unknown>;
  const limits = { fontScale: [.7, 1.8], opacity: [0, 1], lineWidthScale: [.25, 4] } as const;
  for (const [from, to] of Object.entries((settings.palette ?? {}) as Record<string, unknown>)) {
    if (!/^#[0-9a-f]{6}$/i.test(from) || typeof to !== 'string') fail('Canvas 色板只支持 #rrggbb');
    const text = to as string;
    const reference = text.match(paletteParameter);
    const parameter = reference ? parameters[reference[1]!] : undefined;
    if (reference ? !plain(parameter) || parameter.type !== 'color' : !/^#[0-9a-f]{6}$/i.test(text)) fail(reference ? 'Canvas 色板只能引用颜色参数：' + reference[1] : 'Canvas 色板只支持 #rrggbb 或 parameter(颜色参数)');
  }
  for (const [key, [minimum, maximum]] of Object.entries(limits)) {
    const value = settings[key];
    if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum)) fail('Canvas ' + key + ' 超出范围');
  }
  const dash = settings.lineDash;
  if (dash !== undefined && (!Array.isArray(dash) || dash.length > 16 || dash.some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100))) fail('Canvas lineDash 无效');
  if (!plain(settings.targets ?? {})) fail('Canvas targets 无效');
  for (const [key, target] of Object.entries((settings.targets ?? {}) as Record<string, unknown>)) { if (!Object.hasOwn(EDITOR_SKIN_CANVASES, key) || (plain(target) && target.targets !== undefined)) fail('未知或嵌套画布：' + key); canvasConfig(target, parameters); }
}
export function resolveEditorSkin(skin: SkinDocument, { variant = 'base', parameters = {} }: { variant?: string; parameters?: Record<string, unknown> } = {}): SkinDocument {
  const variants = (skin.variants ?? {}) as unknown as Record<string, SkinDocument>;
  const selected = variant === 'base' ? {} : variants[variant];
  if (!selected) fail('变体不存在：' + variant);
  const definitions = (skin.parameters ?? {}) as Record<string, EditorSkinParameter>;
  const values = Object.fromEntries(Object.entries(definitions).map(([id, definition]) => {
    let value: unknown = Object.hasOwn(parameters, id) ? parameters[id] : definition.default;
    if (definition.type === 'number') { let number = Number(value); if (!Number.isFinite(number)) number = Number(definition.default); number = Math.max(definition.min ?? 0, Math.min(definition.max ?? 0, number)); value = `${number}${definition.unit ?? ''}`; }
    else if (definition.type === 'boolean') value = value === true ? '1' : '0';
    else if (definition.type === 'color' && !/^#[0-9a-f]{6}$/i.test(String(value))) value = definition.default;
    else if (definition.type === 'select' && !Object.hasOwn(definition.options ?? {}, String(value))) value = definition.default;
    return [`param-${id}`, value];
  }));
  // Canvas colours are plain strings at draw time, so palette parameter references resolve here.
  const palette = (entries: Record<string, string> | undefined): Record<string, string> | undefined => entries && Object.fromEntries(Object.entries(entries).map(([from, to]): [string, string] => { const reference = String(to).match(paletteParameter); return [from, reference ? String(values['param-' + reference[1]!] ?? to) : to]; }));
  const canvas = { ...(skin.canvas as EditorSkinCanvasConfig | undefined), ...(selected.canvas as EditorSkinCanvasConfig | undefined) };
  const targets = { ...(skin.canvas as EditorSkinCanvasConfig | undefined)?.targets, ...(selected.canvas as EditorSkinCanvasConfig | undefined)?.targets };
  return { ...skin, colorScheme: (selected.colorScheme as 'light' | 'dark' | undefined) ?? skin.colorScheme, tokens: { ...(skin.tokens as Record<string, string> | undefined), ...(selected.tokens as Record<string, string> | undefined), ...values as Record<string, string> }, styles: [...(skin.styles as EditorSkinRule[] | undefined ?? []), ...(selected.styles as EditorSkinRule[] | undefined ?? [])], canvas: { ...canvas, palette: palette({ ...(skin.canvas as EditorSkinCanvasConfig | undefined)?.palette, ...(selected.canvas as EditorSkinCanvasConfig | undefined)?.palette }) as Record<string, string> | undefined, targets: Object.fromEntries(Object.entries(targets).map(([role, target]) => [role, { ...target, palette: palette(target.palette) }])) } };
}
export function parseEditorSkin(files: Map<string, Uint8Array>): EditorSkinPackage {
  if (!(files instanceof Map) || files.size > EDITOR_SKIN_LIMITS.files) fail('皮肤文件数量超限');
  let total = 0; const paths = new Set<string>();
  for (const [path, bytes] of files) {
    editorSkinPath(path); if (!(bytes instanceof Uint8Array) || bytes.byteLength > EDITOR_SKIN_LIMITS.fileBytes) fail('文件过大或内容无效：' + path);
    if (paths.has(path.toLowerCase())) fail('文件路径大小写冲突：' + path);
    paths.add(path.toLowerCase()); total += bytes.byteLength;
  }
  if (total > EDITOR_SKIN_LIMITS.bytes) fail('皮肤总大小超过 32 MiB');
  const source = files.get('skin.json'); if (!source) fail('根目录缺少 skin.json');
  let parsed: unknown; try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(source)); } catch { fail('skin.json 不是有效 UTF-8 JSON'); }
  if (!plain(parsed) || parsed.protocol !== 'rpen-editor-skin' || parsed.version !== 1) fail('需要 rpen-editor-skin 协议 version=1');
  const skin: SkinDocument = { ...(parsed as SkinDocument) };
  if (typeof skin.id !== 'string' || !identifier.test(skin.id) || skin.id === 'default') fail('id 须为小写英文开头的字母、数字或连字符，且不能为 default');
  string(skin.name, '皮肤名称', 80); if (skin.author !== undefined) string(skin.author, '作者', 100);
  if (skin.description !== undefined) string(skin.description, '说明', 2000);
  if (skin.skinVersion !== undefined) string(skin.skinVersion, '皮肤版本', 40);
  if (skin.license !== undefined) string(skin.license, '许可', 4000);
  if (skin.compatibility !== undefined) {
    if (!plain(skin.compatibility)) fail('compatibility 无效');
    const compatibility = skin.compatibility as SkinDocument;
    for (const key of ['minApi', 'maxApi']) if (compatibility[key] !== undefined && (!Number.isInteger(compatibility[key]) || (compatibility[key] as number) < 1)) fail('兼容 API 版本无效');
    if (((compatibility.minApi as number | undefined) ?? 1) > EDITOR_SKIN_API || ((compatibility.maxApi as number | undefined) ?? Infinity) < EDITOR_SKIN_API) fail('皮肤不兼容当前编辑器皮肤 API ' + EDITOR_SKIN_API);
  }
  if (skin.colorScheme !== undefined && !['light', 'dark'].includes(skin.colorScheme as string)) fail('colorScheme 只支持 light/dark');
  const assets = (skin.assets ?? {}) as SkinDocument; if (!plain(assets) || Object.keys(assets).length > 256) fail('assets 无效');
  const referenced = new Set(['skin.json']);
  for (const [id, entry] of Object.entries(assets)) {
    if (!identifier.test(id) || !plain(entry) || !Object.hasOwn(assetTypes, entry.type as string)) fail('素材标识或类型无效：' + id);
    const asset = entry as SkinDocument;
    const type = asset.type as keyof typeof assetTypes;
    if (asset.builtin !== undefined) {
      if (asset.type !== 'image' || typeof asset.builtin !== 'string' || !Object.hasOwn(EDITOR_SKIN_BUILTINS, asset.builtin) || asset.path !== undefined || asset.sources !== undefined) fail('内置素材引用无效：' + id);
    } else {
      editorSkinPath(asset.path); if (!files.has(asset.path as string) || !assetTypes[type].test(asset.path as string)) fail('素材不存在或扩展名不匹配：' + id);
      referenced.add(asset.path as string);
      if (asset.sources !== undefined) {
        if (asset.type !== 'image' || !Array.isArray(asset.sources) || asset.sources.length > 4) fail('高 DPI 图片来源无效');
        const scales = new Set([1]);
        for (const item of asset.sources as unknown[]) {
          if (!plain(item)) fail('高 DPI 倍率无效');
          const source = item as SkinDocument;
          const scale = source.scale as number;
          if (!Number.isFinite(scale) || scale <= 1 || scale > 4 || scales.has(scale)) fail('高 DPI 倍率无效'); scales.add(scale);
          editorSkinPath(source.path); if (!files.has(source.path as string) || !assetTypes.image.test(source.path as string)) fail('高 DPI 图片缺失'); referenced.add(source.path as string);
        }
      }
    }
  }
  if ([...files.keys()].some(path => !referenced.has(path))) fail('包中包含未声明的文件，请仅保留 skin.json 和 assets 中列出的素材');
  if (!plain(skin.tokens ?? {})) fail('tokens 无效');
  for (const [key, value] of Object.entries((skin.tokens ?? {}) as SkinDocument)) { if (!identifier.test(key)) fail('变量名无效：' + key); cssValue(value); }
  rules(skin.styles);
  if (!plain(skin.properties ?? {}) || Object.keys((skin.properties ?? {}) as SkinDocument).length > 40) fail('properties 无效');
  for (const [name, entry] of Object.entries((skin.properties ?? {}) as SkinDocument)) {
    if (!/^--skin-[a-z0-9-]+$/.test(name) || !plain(entry)) fail('自定义属性注册无效');
    const definition = entry as SkinDocument;
    if (!['*', '<number>', '<length>', '<angle>', '<color>', '<percentage>', '<time>'].includes(definition.syntax as string) || typeof definition.inherits !== 'boolean') fail('自定义属性注册无效');
    cssValue(definition.initialValue);
  }
  if (skin.preview !== undefined && (typeof skin.preview !== 'string' || (assets[skin.preview] as SkinDocument | undefined)?.type !== 'image')) fail('preview 必须引用图片素材');
  if (!plain(skin.parameters ?? {}) || Object.keys((skin.parameters ?? {}) as SkinDocument).length > 40) fail('parameters 无效');
  for (const [id, entry] of Object.entries((skin.parameters ?? {}) as SkinDocument)) {
    if (!identifier.test(id) || !plain(entry)) fail('参数无效：' + id);
    const definition = entry as SkinDocument;
    string(definition.label, '参数名称', 80);
    if (definition.type === 'number') {
      if (![definition.min, definition.max, definition.default, definition.step ?? 1].every(Number.isFinite) || (definition.max as number) < (definition.min as number) || (definition.default as number) < (definition.min as number) || (definition.default as number) > (definition.max as number) || ((definition.step ?? 1) as number) <= 0 || !/^(?:px|em|rem|%|ms|s|deg)?$/.test((definition.unit ?? '') as string)) fail('数值参数范围无效');
    } else if (definition.type === 'boolean') { if (typeof definition.default !== 'boolean') fail('布尔参数默认值无效'); }
    else if (definition.type === 'color') { if (typeof definition.default !== 'string' || !/^#[0-9a-f]{6}$/i.test(definition.default)) fail('颜色参数默认值无效'); }
    else if (definition.type === 'select') {
      if (!plain(definition.options) || typeof definition.default !== 'string' || !Object.hasOwn(definition.options as SkinDocument, definition.default) || Object.keys(definition.options as SkinDocument).length > 30) fail('选择参数选项无效');
      for (const [value, label] of Object.entries(definition.options as SkinDocument)) { cssValue(value); string(label, '参数选项', 80); }
    } else fail('参数类型无效');
  }
  if (!plain(skin.variants ?? {}) || Object.keys((skin.variants ?? {}) as SkinDocument).length > 12) fail('variants 无效');
  for (const [id, entry] of Object.entries((skin.variants ?? {}) as SkinDocument)) {
    if (!identifier.test(id) || ['auto', 'base'].includes(id) || !plain(entry)) fail('变体 id 无效');
    const variant = entry as SkinDocument;
    string(variant.name, '变体名称', 80);
    if (variant.colorScheme !== undefined && !['light', 'dark'].includes(variant.colorScheme as string)) fail('变体 colorScheme 无效');
    if (!plain(variant.tokens ?? {})) fail('变体 tokens 无效');
    for (const [key, value] of Object.entries((variant.tokens ?? {}) as SkinDocument)) { if (!identifier.test(key)) fail('变体变量名无效'); cssValue(value); }
    rules(variant.styles); if (variant.canvas) canvasConfig(variant.canvas, skin.parameters as SkinDocument);
  }
  if (skin.systemVariants !== undefined) {
    if (!plain(skin.systemVariants)) fail('systemVariants 必须包含已有的 light/dark 变体');
    const system = skin.systemVariants as SkinDocument;
    for (const scheme of ['light', 'dark']) if (!Object.hasOwn((skin.variants ?? {}) as SkinDocument, String(system[scheme]))) fail('systemVariants 必须包含已有的 light/dark 变体');
  }
  const hide = (skin.hide ?? []) as unknown[];
  if (!Array.isArray(hide) || hide.length > 300) fail('hide 须为最多 300 个选择器的数组');
  for (const selector of hide) editorSkinSelector(selector);
  const motions = (skin.motions ?? {}) as SkinDocument; if (!plain(motions) || Object.keys(motions).length > 64) fail('motions 无效');
  for (const [id, entry] of Object.entries(motions)) {
    if (!identifier.test(id) || !plain(entry) || Object.keys(entry as SkinDocument).length > 40) fail('动画无效：' + id);
    for (const [at, set] of Object.entries(entry as SkinDocument)) { if (!/^(?:from|to|100%|\d{1,2}(?:\.\d+)?%)$/.test(at)) fail('动画时间位置无效：' + at); declarations(set, id); }
  }
  const organize = (skin.organize ?? []) as unknown[];
  if (!Array.isArray(organize) || organize.length > 40) fail('organize 无效');
  const organized = new Set<string>(); const groups = new Set<string>();
  for (const entry of organize) {
    if (!plain(entry)) fail('organize 容器无效');
    const group = entry as SkinDocument;
    if (!EDITOR_SKIN_SLOTS.includes(group.slot as string) || !Array.isArray(group.items)) fail('organize 容器无效');
    if (group.id !== undefined && (typeof group.id !== 'string' || !identifier.test(group.id) || groups.has(group.id))) fail('组织分组 id 无效或重复');
    if (group.id) groups.add(group.id as string);
    if (!group.id && ['label', 'direction', 'collapsible'].some(key => group[key] !== undefined)) fail('分组方向、名称或折叠设置需要 id');
    if (group.collapsible !== undefined && (typeof group.collapsible !== 'boolean' || group.collapsible && !group.label)) fail('折叠分组需要布尔值及 label');
    if (group.label !== undefined) string(group.label, '分组文字', 60);
    if (group.direction !== undefined && !['row', 'column'].includes(group.direction as string)) fail('分组方向无效');
    for (const item of group.items as unknown[]) {
      if (typeof item !== 'string') fail('不可移动或重复的控件：' + String(item));
      if (!EDITOR_SKIN_MOVABLE.includes(String(item)) || organized.has(String(item))) fail('不可移动或重复的控件：' + item);
      organized.add(String(item));
    }
  }
  const texts = (skin.texts ?? []) as unknown[];
  if (!Array.isArray(texts) || texts.length > 300) fail('texts 无效');
  for (const entry of texts) {
    if (!plain(entry)) fail('文字项无效');
    const text = entry as SkinDocument;
    editorSkinSelector(text.selector);
    for (const key of ['text', 'title', 'ariaLabel', 'placeholder']) if (text[key] !== undefined && (typeof text[key] !== 'string' || (text[key] as string).length > 1000)) fail('文字内容无效');
  }
  if (Array.isArray(skin.icons)) {
    if (skin.icons.length > 300) fail('icons 超过 300 项');
    for (const entry of skin.icons as unknown[]) {
      if (!plain(entry)) fail('图标引用无效');
      const icon = entry as SkinDocument;
      if ((assets[icon.asset as string] as SkinDocument | undefined)?.type !== 'image') fail('图标引用无效'); editorSkinSelector(icon.selector);
    }
  } else {
    if (!plain(skin.icons ?? {})) fail('icons 无效');
    for (const [id, asset] of Object.entries((skin.icons ?? {}) as SkinDocument)) if (!Object.hasOwn(EDITOR_SKIN_COMPONENTS, id) || typeof asset !== 'string' || (assets[asset] as SkinDocument | undefined)?.type !== 'image') fail('图标引用无效：' + id);
  }
  const decorations = (skin.decorations ?? []) as unknown[];
  if (!Array.isArray(decorations) || decorations.length > 24) fail('decorations 无效');
  const decorationIds = new Set<string>();
  for (const entry of decorations) {
    if (!plain(entry)) fail('装饰引用无效');
    const decoration = entry as SkinDocument;
    if (typeof decoration.id !== 'string') fail('装饰引用无效');
    const decorationId = String(decoration.id); const decorationAsset: unknown = decoration.asset;
    if (!identifier.test(String(decorationId)) || decorationIds.has(String(decorationId)) || typeof decorationAsset !== 'string' || (assets[decorationAsset] as SkinDocument | undefined)?.type !== 'image') fail('装饰引用无效');
    decorationIds.add(String(decorationId));
    if (decoration.selector !== undefined) editorSkinSelector(decoration.selector);
    else if (!Object.hasOwn(EDITOR_SKIN_COMPONENTS, String(decoration.target))) fail('装饰目标无效');
    if (decoration.placement !== undefined && !['prepend', 'append', 'before', 'after'].includes(decoration.placement as string)) fail('装饰位置无效');
  }
  canvasConfig(skin.canvas ?? {}, skin.parameters as SkinDocument);
  if (!plain((skin.canvas as SkinDocument | undefined)?.targets ?? {})) fail('Canvas targets 无效');
  for (const [key, config] of Object.entries(((skin.canvas as SkinDocument | undefined)?.targets ?? {}) as SkinDocument)) { if (!Object.hasOwn(EDITOR_SKIN_CANVASES, key)) fail('未知画布：' + key); canvasConfig(config, skin.parameters as SkinDocument); }
  for (const canvas of [skin.canvas, ...Object.values((skin.variants ?? {}) as SkinDocument).map(variant => (variant as SkinDocument).canvas)]) for (const config of [canvas, ...Object.values(((canvas as SkinDocument | undefined)?.targets ?? {}) as Record<string, unknown>)]) if ((config as SkinDocument | undefined)?.font !== undefined && (typeof (config as SkinDocument).font !== 'string' || (assets[(config as SkinDocument).font as string] as SkinDocument | undefined)?.type !== 'font')) fail('Canvas 字体引用无效');
  const allValues = JSON.stringify([skin.tokens, skin.styles, skin.motions, skin.variants]);
  for (const match of allValues.matchAll(/\b(asset|font|motion|parameter)\(([a-z][a-z0-9-]*)\)/g)) {
    const [, kind, id] = match as unknown as [string, string, string];
    if (kind === 'parameter' ? !Object.hasOwn(skin.parameters ?? {}, id) : kind === 'motion' ? !Object.hasOwn(motions, id) : kind === 'font' ? (assets[id] as SkinDocument | undefined)?.type !== 'font' : (assets[id] as SkinDocument | undefined)?.type !== 'image') fail('样式素材或动画引用不存在：' + id);
  }
  return { skin, files, bytes: total };
}

export function compileEditorSkin(skin: SkinDocument, { images = new Map(), fonts = new Map(), imageSets = new Map() }: { images?: Map<string, string>; fonts?: Map<string, string>; imageSets?: Map<string, string> } = {}) {
  const prefix = `:root[data-editor-skin="${skin.id}"]`;
  const value = (text: string): string => text.replace(/\b(asset|font|motion|parameter)\(([a-z][a-z0-9-]*)\)/g, (match: string, kind: string, id: string) => {
    if (kind === 'motion') return `rpen-${skin.id}-${id}`;
    if (kind === 'parameter') return `var(--rpen-param-${id})`;
    const entry = (kind === 'font' ? fonts : images).get(id); if (!entry) fail('素材尚未载入：' + id);
    return kind === 'font' ? `"${entry}"` : imageSets.get(id) ?? `url("${entry}")`;
  });
  const declarations = (set: SkinDocument, important: string[] = []): string => Object.entries(set).map(([key, item]) => `${key}:${value(item as string)}${important.includes(key) ? '!important' : ''}`).join(';');
  // Split only top-level commas; pseudo-elements must remain outside :is().
  const selector = (text: string): string => {
    const source = editorSkinSelector(text); const parts: string[] = []; let start = 0; let depth = 0; let quote = '';
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
  const rules = (entries: unknown): string => ((entries ?? []) as SkinDocument[]).map(rule => {
    const kind = ['media', 'container', 'supports', 'startingStyle'].find(key => rule[key] !== undefined);
    return kind ? `@${kind === 'startingStyle' ? 'starting-style' : kind}${kind === 'startingStyle' ? '' : ' ' + String(rule[kind])}{${rules(rule.rules)}}` : `${selector(rule.selector as string)}{${declarations(rule.set as SkinDocument, rule.important as string[] | undefined)}}`;
  }).join('\n');
  const tokens = Object.entries((skin.tokens ?? {}) as SkinDocument).map(([key, text]) => `--rpen-${key}:${value(text as string)}`).join(';');
  const frames = Object.entries((skin.motions ?? {}) as SkinDocument).map(([id, frames]) => `@keyframes rpen-${skin.id}-${id}{${Object.entries(frames as SkinDocument).map(([at, set]) => `${at}{${declarations(set as SkinDocument)}}`).join('')}}`).join('\n');
  const properties = Object.entries((skin.properties ?? {}) as SkinDocument).map(([name, definition]) => { const property = definition as SkinDocument; return `@property ${name}{syntax:"${String(property.syntax)}";inherits:${String(property.inherits)};initial-value:${value(property.initialValue as string)}}`; }).join('\n');
  const iconEntries: { selector: string; asset: string }[] = Array.isArray(skin.icons) ? skin.icons as { selector: string; asset: string }[] : Object.entries((skin.icons ?? {}) as Record<string, string>).map(([id, asset]) => ({ selector: '@' + id, asset }));
  const icons = iconEntries.map(icon => `${selector(`:is(${editorSkinSelector(icon.selector)})::before`)}{content:"";display:inline-block;width:18px;height:18px;vertical-align:middle;background-image:${imageSets.get(icon.asset) ?? `url("${images.get(icon.asset)}")`};background-size:contain;background-repeat:no-repeat;background-position:center;margin-right:6px}`).join('\n');
  const hidden = ((skin.hide ?? []) as string[]).map(text => `${selector(text)}{display:none!important;transition:none!important;animation:none!important}`).join('\n');
  return `${prefix}{color-scheme:${skin.colorScheme ?? 'dark'};${tokens}}\n${properties}\n${frames}\n${icons}\n${rules(skin.styles)}\n${hidden}\n@media(prefers-reduced-motion:reduce){${prefix} *,${prefix} *::before,${prefix} *::after{animation-duration:0.001ms!important;animation-iteration-count:1!important;transition-duration:0.001ms!important}}`;
}
