import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('rpenDesktopStorage', {
  version: 1,
  call: (method: string, ...args: unknown[]) => ipcRenderer.invoke('rpen-native-storage', { method, args }),
});
