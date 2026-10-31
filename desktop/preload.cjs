const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('rpenPerformance', { version: 1, call: action => ipcRenderer.invoke('rpen-performance', action) });
contextBridge.exposeInMainWorld('rpenAppUpdates', {
  version: 1,
  call: (action, value) => ipcRenderer.invoke('rpen-app-update', { action, value }),
  onProgress: callback => { const handler = (event, value) => callback(value); ipcRenderer.on('rpen-app-update-progress', handler); return () => ipcRenderer.removeListener('rpen-app-update-progress', handler); },
});
contextBridge.exposeInMainWorld('rpenDictation', {
  version: 1,
  call: (action, ...args) => ipcRenderer.invoke('rpen-dictation', { action, args }),
  onProgress: callback => { const handler = (event, value) => callback(value); ipcRenderer.on('rpen-dictation-progress', handler); return () => ipcRenderer.removeListener('rpen-dictation-progress', handler); },
});
contextBridge.exposeInMainWorld('rpenAgentCapture', { version: 1, capture: rect => ipcRenderer.invoke('rpen-agent-capture', rect) });
contextBridge.exposeInMainWorld('rpenAudioStorage', {
  version: 1,
  call: (action, options = {}) => ipcRenderer.invoke('rpen-audio-storage', { ...options, action }),
  onProgress: callback => { const handler = (event, value) => callback(value); ipcRenderer.on('rpen-audio-storage-progress', handler); return () => ipcRenderer.removeListener('rpen-audio-storage-progress', handler); }
});
contextBridge.exposeInMainWorld('rpenAgentWorkspace', {
  version: 1,
  call: (id, workspace, action, args) => ipcRenderer.invoke('rpen-agent-workspace', { id, workspace, action, args }),
  cancel: id => ipcRenderer.send('rpen-agent-workspace-cancel', id),
});
contextBridge.exposeInMainWorld('rpenAudioMapper', {
  version: 1,
  call: (action, ...args) => ipcRenderer.invoke('rpen-audio-mapper', { action, args }),
  onProgress: callback => { const handler = (event, value) => callback(value); ipcRenderer.on('rpen-audio-mapper-progress', handler); return () => ipcRenderer.removeListener('rpen-audio-mapper-progress', handler); },
});
contextBridge.exposeInMainWorld('rpenAudioOnsets', {
  version: 1,
  call: (action, ...args) => ipcRenderer.invoke('rpen-audio-onsets', { action, args }),
  onProgress: callback => { const handler = (event, value) => callback(value); ipcRenderer.on('rpen-audio-onsets-progress', handler); return () => ipcRenderer.removeListener('rpen-audio-onsets-progress', handler); },
});
contextBridge.exposeInMainWorld('rpenAudioSeparation', {
  version: 1,
  call: (action, ...args) => ipcRenderer.invoke('rpen-audio-separation', { action, args }),
  onProgress: callback => { const handler = (event, value) => callback(value); ipcRenderer.on('rpen-audio-separation-progress', handler); return () => ipcRenderer.removeListener('rpen-audio-separation-progress', handler); },
});
contextBridge.exposeInMainWorld('rpenAgentCredentials', {
  version: 1,
  read: provider => ipcRenderer.invoke('rpen-agent-credentials', { action: 'read', provider }),
  write: (provider, key) => ipcRenderer.invoke('rpen-agent-credentials', { action: 'write', provider, key }),
});
contextBridge.exposeInMainWorld('rpenAgentNetwork', {
  request: (id, path, key, body, options) => ipcRenderer.invoke('rpen-agent-request', { id, path, key, body, baseUrl: options?.baseUrl }),
  cancel: id => ipcRenderer.send('rpen-agent-cancel', id),
  onChunk: (id, callback) => {
    const handler = (event, value) => { if (value.id === id) callback(value.chunk); };
    ipcRenderer.on('rpen-agent-chunk', handler); return () => ipcRenderer.removeListener('rpen-agent-chunk', handler);
  },
});

contextBridge.exposeInMainWorld('rpenDesktopStorage', {
  version: 1,
  call: (method, ...args) => ipcRenderer.invoke('rpen-native-storage', { method, args }),
});
