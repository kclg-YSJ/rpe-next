import { parseEditorSkin } from '../../src/core/editor-skin.ts';

// Minimal synthetic data for protocol tests; not a distributable editor theme.
export function editorSkinFixture() {
  const encode = (value: unknown) => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));
  const skin = {
    protocol: 'rpen-editor-skin', version: 1, id: 'test-skin', name: 'Protocol test fixture', colorScheme: 'dark',
    assets: { mark: { type: 'image', path: 'images/mark.svg' } },
    parameters: {
      'panel-width': { type: 'number', label: '测试侧栏宽度', default: 350, min: 260, max: 520, step: 10, unit: 'px' },
      accent: { type: 'color', label: '测试强调色', default: '#2469d9' },
    },
    tokens: { background: '#26282b', surface: '#292c30', 'inspector-width': 'parameter(panel-width)', accent: 'parameter(accent)', 'font-family': 'system-ui, sans-serif', input: '#383838' },
    styles: [
      { selector: '@save::before', set: { filter: 'none' } },
      { selector: '[data-skin-group=project]', set: { 'flex-shrink': '0', 'flex-wrap': 'nowrap', 'min-width': 'max-content' } },
      { selector: '@file-actions', set: { 'min-width': '0', 'overflow-x': 'auto', 'flex-wrap': 'nowrap' } },
    ],
    organize: [{ slot: 'file-actions', id: 'project', items: ['new', 'open', 'save', 'export'], direction: 'row' }],
    texts: [{ selector: '@save', text: '保存谱面 ' }],
    icons: { save: 'mark' },
    decorations: [],
    canvas: { palette: { '#20252d': '#27313a' } },
  };
  return parseEditorSkin(new Map([
    ['skin.json', encode(skin)],
    ['images/mark.svg', encode('<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12"><path fill="#888" d="M1 1h10v10H1z"/></svg>')],
  ]));
}
