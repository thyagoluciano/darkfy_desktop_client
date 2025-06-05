// src/preload.js
// Este script agora é um ES Module devido ao "type": "module" no package.json.

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // Renderer para Main
  requestVideoProcessing: (data) => ipcRenderer.send('request-video-processing', data),
  notifyLoginSuccess: () => ipcRenderer.send('login-successful'),
  requestLogoutNavigation: () => ipcRenderer.send('logout-request'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getFirebaseConfig: () => ipcRenderer.invoke('get-firebase-config'),

  // Main para Renderer (para receber atualizações do processo de vídeo)
  onVideoProcessingResult: (callback) => {
    const subscription = (event, result) => callback(result);
    ipcRenderer.on('video-processing-result', subscription);
    // Retorna uma função para remover o listener (cleanup)
    return () => ipcRenderer.removeListener('video-processing-result', subscription);
  },

  // Main para Renderer (para status gerais/progresso)
  onMonitoringStatusUpdate: (callback) => {
    const subscription = (event, status) => callback(status);
    ipcRenderer.on('monitoring-status-update', subscription);
    // Retorna uma função para remover o listener (cleanup)
    return () => ipcRenderer.removeListener('monitoring-status-update', subscription);
  }
});

console.log('Preload script (ESM) carregado e electronAPI (v2.1 - com getFirebaseConfig) exposta!');