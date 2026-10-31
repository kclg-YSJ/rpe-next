import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { EDITOR_SKIN_COMPONENTS, EDITOR_SKIN_SLOTS, EDITOR_SKIN_MOVABLE, EDITOR_SKIN_LIMITS, EDITOR_SKIN_API, EDITOR_SKIN_CANVASES, EDITOR_SKIN_BUILTINS } from '../src/core/editor-skin.mjs';
import { EDITOR_SKIN_DEFAULT_TOKENS } from '../src/ui/editor-skin-base.mjs';

// Generate the machine-readable companion files from the runtime's public contract.
const identifier = { type: 'string', pattern: '^[a-z][a-z0-9-]{0,63}$' };
const css = { type: 'string', minLength: 1, maxLength: 3000, description: 'CSS declaration value; runtime validates the restricted syntax and asset/font/motion references.' };
const selector = { type: 'string', minLength: 1, maxLength: 500, description: 'CSS selector, optionally using @component aliases. Must pass editorSkinSelector and browser selector validation.' };
const assetRef = { ...identifier, description: 'A key in assets; image/font type checked at import.' };
const map = (additionalProperties, maxProperties) => ({ type: 'object', additionalProperties, ...(maxProperties ? { maxProperties } : {}) });
const localized = value => ({ oneOf: [value, { type: 'object', minProperties: 1, additionalProperties: value, propertyNames: { pattern: '^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$' } }] });
const declarations = { ...map(css, 100), propertyNames: { pattern: '^(--(skin|rpen)-[a-z0-9-]+|-?[a-z][a-z0-9-]*)$' } };
const schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'RPEN editor skin v1', type: 'object', required: ['protocol', 'version', 'id', 'name'],
  description: 'Structural validation only. Package paths, resources, references, selectors and security require the RPEN importer. Unknown fields are ignored; use x- for metadata extensions.',
  properties: {
    protocol: { const: 'rpen-editor-skin' }, version: { const: 1 },
    id: { ...identifier, not: { const: 'default' } }, name: { type: 'string', minLength: 1, maxLength: 80 },
    author: { type: 'string', minLength: 1, maxLength: 100 }, description: { type: 'string', minLength: 1, maxLength: 2000 },
    colorScheme: { enum: ['light', 'dark'], default: 'dark' },
    assets: { ...map({ type: 'object', required: ['type', 'path'], properties: { type: { enum: ['image', 'font'] }, path: { type: 'string', minLength: 1, maxLength: 240 } } }, 256), propertyNames: identifier },
    tokens: { ...map(css), propertyNames: identifier },
    styles: { $ref: '#/$defs/rules' },
    hide: { type: 'array', maxItems: 300, items: selector, description: 'Hide matching UI elements without deleting their functional nodes; no layout space or keyboard focus. Automatically restored on skin switch.' },
    motions: { ...map({ ...map(declarations, 40), propertyNames: { pattern: '^(from|to|100%|[0-9]{1,2}(\\.[0-9]+)?%)$' } }, 64), propertyNames: identifier },
    organize: { type: 'array', maxItems: 40, items: { type: 'object', required: ['slot', 'items'], properties: {
      slot: { enum: EDITOR_SKIN_SLOTS }, id: identifier, items: { type: 'array', uniqueItems: true, items: { enum: EDITOR_SKIN_MOVABLE } },
      direction: { enum: ['row', 'column'], default: 'row' }, label: { type: 'string', minLength: 1, maxLength: 60 }, collapsible: { type: 'boolean', default: false },
    }, allOf: [
      { if: { properties: { collapsible: { const: true } }, required: ['collapsible'] }, then: { required: ['label'] } },
      { if: { anyOf: ['label', 'direction', 'collapsible'].map(key => ({ required: [key] })) }, then: { required: ['id'] } },
    ] } },
    texts: { type: 'array', maxItems: 300, items: { type: 'object', required: ['selector'], properties: {
      selector, ...Object.fromEntries(['text', 'title', 'ariaLabel', 'placeholder'].map(key => [key, { type: 'string', maxLength: 1000 }])),
    } } },
    icons: { ...map(assetRef), propertyNames: { enum: Object.keys(EDITOR_SKIN_COMPONENTS) } },
    decorations: { type: 'array', maxItems: 24, items: { type: 'object', required: ['id', 'target', 'asset'], properties: { id: identifier, target: { enum: Object.keys(EDITOR_SKIN_COMPONENTS) }, asset: assetRef } } },
    canvas: { type: 'object', properties: {
      palette: { ...map({ type: 'string', pattern: '^(#[0-9a-fA-F]{6}|parameter\\([a-z][a-z0-9-]{0,63}\\))$', description: '#rrggbb, or parameter(id) referencing a color parameter (API 3).' }), propertyNames: { pattern: '^#[0-9a-fA-F]{6}$' } },
      fontScale: { type: 'number', minimum: 0.7, maximum: 1.8, default: 1 }, font: assetRef,
    } },
  },
  $defs: { rules: { type: 'array', maxItems: 1000, items: { oneOf: [
    { type: 'object', required: ['selector', 'set'], not: { required: ['media'] }, properties: { selector, set: declarations } },
    { type: 'object', required: ['media', 'rules'], properties: { media: { type: 'string', maxLength: 200, pattern: '^[a-zA-Z0-9 ():.\\-]+$' }, rules: { $ref: '#/$defs/rules' } } },
  ] } } },
};
const conditionKeys = ['media', 'container', 'supports', 'startingStyle'];
schema.$defs.rules.items.oneOf = [
  { type: 'object', required: ['selector', 'set'], not: { anyOf: conditionKeys.map(key => ({ required: [key] })) }, properties: { selector, set: declarations, important: { type: 'array', items: { type: 'string' } } } },
  ...conditionKeys.map(key => ({ type: 'object', required: [key, 'rules'], not: { anyOf: conditionKeys.filter(other => other !== key).map(other => ({ required: [other] })) }, properties: { [key]: key === 'startingStyle' ? { const: true } : { type: 'string', minLength: 1, maxLength: 500 }, rules: { $ref: '#/$defs/rules' } } })),
];
Object.assign(schema.properties, {
  skinVersion: { type: 'string', maxLength: 40 }, license: { type: 'string', maxLength: 4000 }, preview: assetRef,
  compatibility: { type: 'object', properties: { minApi: { type: 'integer', minimum: 1 }, maxApi: { type: 'integer', minimum: 1 } } },
  systemVariants: { type: 'object', required: ['light', 'dark'], properties: { light: identifier, dark: identifier } },
  parameters: { ...map({ type: 'object', required: ['type', 'label', 'default'], properties: {
    type: { enum: ['number', 'color', 'select', 'boolean'] }, label: { type: 'string', maxLength: 80 }, default: {},
    min: { type: 'number' }, max: { type: 'number' }, step: { type: 'number', exclusiveMinimum: 0 }, unit: { enum: ['', 'px', 'em', 'rem', '%', 'ms', 's', 'deg'] }, options: map({ type: 'string' }, 30),
  } }, 40), propertyNames: identifier },
  properties: { ...map({ type: 'object', required: ['syntax', 'inherits', 'initialValue'], properties: { syntax: { enum: ['*', '<number>', '<length>', '<angle>', '<color>', '<percentage>', '<time>'] }, inherits: { type: 'boolean' }, initialValue: css } }, 40), propertyNames: { pattern: '^--skin-[a-z0-9-]+$' } },
});
schema.properties.assets.additionalProperties = { type: 'object', required: ['type'], oneOf: [{ required: ['path'], not: { required: ['builtin'] } }, { required: ['builtin'], not: { anyOf: [{ required: ['path'] }, { required: ['sources'] }] } }], properties: {
  type: { enum: ['image', 'font'] }, path: { type: 'string', minLength: 1, maxLength: 240 }, builtin: { enum: Object.keys(EDITOR_SKIN_BUILTINS) },
  sources: { type: 'array', maxItems: 4, items: { type: 'object', required: ['path', 'scale'], properties: { path: { type: 'string' }, scale: { type: 'number', exclusiveMinimum: 1, maximum: 4 } } } },
} };
const canvas = structuredClone(schema.properties.canvas);
Object.assign(canvas.properties, { opacity: { type: 'number', minimum: 0, maximum: 1 }, lineWidthScale: { type: 'number', minimum: .25, maximum: 4 }, lineDash: { type: 'array', maxItems: 16, items: { type: 'number', minimum: 0, maximum: 100 } } });
schema.properties.canvas = { ...canvas, properties: { ...canvas.properties, targets: { ...map(canvas), propertyNames: { enum: Object.keys(EDITOR_SKIN_CANVASES) } } } };
schema.properties.variants = { ...map({ type: 'object', required: ['name'], properties: { name: { type: 'string', maxLength: 80 }, colorScheme: { enum: ['light', 'dark'] }, tokens: schema.properties.tokens, styles: { $ref: '#/$defs/rules' }, canvas: schema.properties.canvas } }, 12), propertyNames: identifier };
schema.properties.icons = { oneOf: [schema.properties.icons, { type: 'array', maxItems: 300, items: { type: 'object', required: ['selector', 'asset'], properties: { selector, asset: assetRef } } }] };
schema.properties.decorations.items.required = ['id', 'asset'];
schema.properties.decorations.items.anyOf = [{ required: ['target'] }, { required: ['selector'] }];
Object.assign(schema.properties.decorations.items.properties, { selector, placement: { enum: ['prepend', 'append', 'before', 'after'] } });
for (const key of ['name', 'description', 'license']) schema.properties[key] = localized(schema.properties[key]);
schema.properties.organize.items.properties.label = localized(schema.properties.organize.items.properties.label);
for (const key of ['text', 'title', 'ariaLabel', 'placeholder']) schema.properties.texts.items.properties[key] = localized(schema.properties.texts.items.properties[key]);
schema.properties.parameters.additionalProperties.properties.label = localized(schema.properties.parameters.additionalProperties.properties.label);
schema.properties.parameters.additionalProperties.properties.options.additionalProperties = localized(schema.properties.parameters.additionalProperties.properties.options.additionalProperties);
schema.properties.variants.additionalProperties.properties.name = localized(schema.properties.variants.additionalProperties.properties.name);
declarations.additionalProperties = localized(css);
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const catalogue = {
  protocol: 'rpen-editor-skin', version: 1, api: EDITOR_SKIN_API, aliases: EDITOR_SKIN_COMPONENTS, slots: EDITOR_SKIN_SLOTS, movableCommands: EDITOR_SKIN_MOVABLE,
  canvases: EDITOR_SKIN_CANVASES, builtinAssets: EDITOR_SKIN_BUILTINS,
  stateAttributes: ['data-rpen-playing', 'data-rpen-dirty', 'data-rpen-pane', 'data-rpen-mode', 'data-rpen-location', 'data-rpen-collaboration', 'data-rpen-beat'],
  signals: ['beat', 'save-started', 'save-succeeded', 'save-failed', 'error', 'warning', 'collaboration-changed'],
  tokens: EDITOR_SKIN_DEFAULT_TOKENS, limits: EDITOR_SKIN_LIMITS,
  hide: { maxSelectors: 300, selectors: 'CSS selectors and @component aliases', behavior: 'Presentation only; preserves functional nodes, values, application visibility state and hotkeys.' },
  panels: [...html.matchAll(/<section data-panel="([^"]+)"/g)].map(match => match[1]),
  staticIds: [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]),
  runtimeRoots: ['#performance-monitor', '#settings-modal', '#language-settings', '#ui-language', '#about-settings', '#app-update-badge', '#update-dialog', '#update-release-dialog', '#dictation-settings', '.dictation-indicator', '.dictation-candidate', '.dictation-permission-dialog', '#editor-skin-settings', '#note-skin-settings', '#note-skin-modal', '#mod-manager', '#mod-import-warning', '.line-switcher', '.batch-controls', '.collaboration-chat', '.event-sample-panel', '.noise-sample-bar', '.skin-control-group', '[data-skin-decoration]'],
  notes: ['Aliases, slots, tokens, canvas roles and listed state attributes are the API 3 contract; existing entries retain their meaning. Static IDs and unlisted classes are implementation details.', 'Do not use generated input order or translated label text to identify controls.'],
};
const root = new URL('../schemas/', import.meta.url); await mkdir(root, { recursive: true });
await writeFile(new URL('editor-skin-v1.schema.json', root), JSON.stringify(schema, null, 2) + '\n');
await writeFile(new URL('editor-skin-components.v1.json', root), JSON.stringify(catalogue, null, 2) + '\n');
console.log('Editor skin schema and component catalogue generated.');
