// A sandboxed preload is loaded as CommonJS without type stripping, unlike every other TypeScript
// entry point in this repository: Electron hands the file straight to the sandboxed loader. The
// manager therefore strips this file once at startup and points `webPreferences.preload` at the
// stripped copy, which lets the source itself stay fully typed.
const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');

contextBridge.exposeInMainWorld('serverManager', {
  action: (action: string, values: Record<string, unknown>): Promise<unknown> => ipcRenderer.invoke('server-action', action, values),
  subscribe: (callback: (state: unknown) => void): void => { ipcRenderer.on('server-state', (_event, state: unknown) => callback(state)); },
});
