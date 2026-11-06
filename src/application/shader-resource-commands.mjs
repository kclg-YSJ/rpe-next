import { shaderAssetPath, chartShaderEvents } from '../core/shader-assets.mjs';
import { shaderAssetLabel } from '../core/shader-source-info.mjs';
import { t } from '../i18n.mjs';

export function shaderReferenceCount(chart, assets, path, chartName) {
  return chartShaderEvents(chart).reduce((count, event) => count + (shaderAssetPath(assets, event.shader, chartName) === path ? 1 : 0), 0);
}
export function replaceShaderResource(editor, path, bytes, expected) {
  const assets = editor.assets, session = editor.session;
  if (!assets.has(path) || assets.get(path) !== expected) throw Error(t('shader-editor.fileConflict'));
  if (bytes.length === expected.length && bytes.every((value, index) => value === expected[index])) return expected;
  const label = t('shader-editor.savedChart', { name: shaderAssetLabel(path, assets, session.chart, editor.chartName) });
  const replace = value => { assets.set(path, value); editor.shaderAssetsChanged(); };
  // Follow the asset rules of the current workspace. Ordinary local sessions
  // can additionally restore source bytes with the chart's normal undo stack.
  if (!session.largeDocument && !session.collaboration) session.history.commitAuxiliary(label, { undo: () => replace(expected), redo: () => replace(bytes) });
  replace(bytes); session.notify(); return bytes;
}
