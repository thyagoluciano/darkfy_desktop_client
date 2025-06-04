// src/preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Renderer para Main
  requestVideoProcessing: (data) => ipcRenderer.send('request-video-processing', data),
  notifyLoginSuccess: () => ipcRenderer.send('login-successful'),       // Usado por loginRenderer.js
  requestLogoutNavigation: () => ipcRenderer.send('logout-request'),   // Usado por renderer.js (dashboard)
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),          // Usado por ambos os renderers

  // Main para Renderer (para receber atualizações do processo de vídeo)
  onVideoProcessingResult: (callback) => {
    const subscription = (event, result) => callback(result);
    ipcRenderer.on('video-processing-result', subscription);
    return () => ipcRenderer.removeListener('video-processing-result', subscription); // Função de cleanup
  },

  // Main para Renderer (para status gerais/progresso)
  onMonitoringStatusUpdate: (callback) => {
    const subscription = (event, status) => callback(status);
    ipcRenderer.on('monitoring-status-update', subscription);
    return () => ipcRenderer.removeListener('monitoring-status-update', subscription); // Função de cleanup
  }
});

console.log('Preload script carregado e electronAPI (v2) exposta!');