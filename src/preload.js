const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cube', {
  on: (channel, cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  send: (channel, data) => ipcRenderer.send(channel, data),
  invoke: (channel, data) => ipcRenderer.invoke(channel, data),
});
