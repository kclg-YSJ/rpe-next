// Mutable payloads intentionally allow mods to change editor semantics and custom formats.
type ModHookCallback = { bivariant(payload: unknown): void }['bivariant'];
interface ModHookEntry {
  callback: ModHookCallback;
  priority: number;
  onError: (error: unknown) => void;
}
const hooks = new Map<string, ModHookEntry[]>();
export function registerModHook(name: string, callback: ModHookCallback, priority = 0, onError: (error: unknown) => void = console.error): () => void {
  const entry: ModHookEntry = { callback, priority, onError };
  let list = hooks.get(name);
  if (!list) { list = []; hooks.set(name, list); }
  list.push(entry); list.sort((a, b) => b.priority - a.priority);
  return () => { const current = hooks.get(name); const index = current?.indexOf(entry) ?? -1; if (current && index >= 0) current.splice(index, 1); };
}
export function emitModHook<T>(name: string, payload: T): T { for (const entry of [...(hooks.get(name) ?? [])]) try { entry.callback(payload); } catch (error) { entry.onError(error); } return payload; }
