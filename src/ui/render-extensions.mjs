// Renderers created for export inherit the same extension stages as the editor.
// Nothing is sampled while no export renderer exists.
const extensions = new Set(), renderers = new Set();
export function registerRenderExtension(attach) {
  extensions.add(attach);
  for (const state of renderers) state.releases.set(attach, attach(state.renderer, state.purpose));
  return () => { extensions.delete(attach); for (const state of renderers) { state.releases.get(attach)?.(); state.releases.delete(attach); } };
}
export function attachRenderExtensions(renderer, purpose = 'export') {
  const state = { renderer, purpose, releases: new Map() }; renderers.add(state);
  try { for (const attach of extensions) state.releases.set(attach, attach(renderer, purpose)); }
  catch (error) { for (const release of state.releases.values()) release?.(); renderers.delete(state); throw error; }
  return () => { renderers.delete(state); for (const release of [...state.releases.values()].reverse()) release?.(); state.releases.clear(); };
}
