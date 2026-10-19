const stateKeys = new Set(['playing', 'dirty', 'pane', 'mode', 'location', 'collaboration', 'beat']);
const signals = new Set(['beat', 'save-started', 'save-succeeded', 'save-failed', 'error', 'warning', 'collaboration-changed']);
const timers = new Map<string, ReturnType<typeof setTimeout>>();
export function editorSkinState(values: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(values)) if (stateKeys.has(key)) {
    const next = String(value); const name = 'data-rpen-' + key;
    if (document.documentElement.getAttribute(name) !== next) document.documentElement.setAttribute(name, next);
  }
}
export function editorSkinSignal(name: string): void {
  if (!signals.has(name)) return;
  const root = document.documentElement; const attribute = 'data-rpen-event-' + name;
  clearTimeout(timers.get(name)); root.removeAttribute(attribute);
  requestAnimationFrame(() => { root.setAttribute(attribute, 'true'); timers.set(name, setTimeout(() => root.removeAttribute(attribute), 180)); });
}
