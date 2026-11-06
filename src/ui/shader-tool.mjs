let context = () => null, workspace, generation = 0;
// Both previews share one reporter. A resource refresh may retry a failed load,
// but it must not repeatedly notify while the same chart session stays open.
export function createShaderProblemReporter(getScope, notify) {
  let scope, messages = new Set();
  return message => {
    const current = getScope();
    if (current !== scope) { scope = current; messages.clear(); }
    if (messages.has(message)) return;
    messages.add(message); notify(message);
  };
}
export function configureShaderWorkspace(getContext) { context = getContext; }
export const shaderWorkspaceContext = () => context();
export async function openShaderWorkspace(options = {}) {
  const token = ++generation;
  const { openShaderEditor } = await import('./shader-editor.mjs');
  if (token !== generation) return;
  workspace?.dispose(); const next = await openShaderEditor(context, { ...options, onDispose: root => { if (workspace?.root === root) workspace = null; } });
  if (token !== generation) { next?.dispose(); return; }
  workspace = next; return workspace;
}
export function closeShaderWorkspace() { generation++; workspace?.dispose(); workspace = null; }
