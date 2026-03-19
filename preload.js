const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  convertToPdf: (htmlFilePath) => ipcRenderer.invoke('convert-to-pdf', htmlFilePath),
});
