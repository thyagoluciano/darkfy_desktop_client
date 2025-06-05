// src/main.js
// Este arquivo agora é um ES Module devido ao "type": "module" no package.json.

import 'dotenv/config'; // Para carregar variáveis de .env - use 'dotenv/config' para efeito imediato

import path from 'path';
import { fileURLToPath } from 'url'; // Necessário para __dirname e __filename em ESM

// Importações de módulos Electron
import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron';

// Importações de seus módulos locais (agora ESM)
import FIREBASE_APP_CONFIG from './config/firebaseConfig.js';
import MINIO_CFG_FROM_ENV from './config/minioConfig.js';
import DownloadService from './services/downloadService.js';
import MinioService from './services/minioService.js';

// Obter __dirname e __filename em ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('MAIN (ESM): Processo principal iniciado.');
// Checagem inicial se as configs foram carregadas
if (FIREBASE_APP_CONFIG && FIREBASE_APP_CONFIG.apiKey) {
    console.log('MAIN (ESM): Firebase Config (from firebaseConfig.js) carregada.');
} else {
    console.error('MAIN (ESM): FALHA ao carregar Firebase Config. Verifique o módulo e as env vars.');
}
if (MINIO_CFG_FROM_ENV && MINIO_CFG_FROM_ENV.endpoint) {
    console.log('MAIN (ESM): Minio Config (from minioConfig.js) carregada.');
} else {
    console.error('MAIN (ESM): FALHA ao carregar Minio Config. Verifique o módulo e as env vars.');
}

let mainWindow;
let minioService;

const minioServiceConfig = {
    ...MINIO_CFG_FROM_ENV,
    onLog: (message) => console.log(`MAIN (ESM) (MinioService): ${message}`)
};

function initializeServices() {
    try {
        if (!minioServiceConfig.endpoint || !minioServiceConfig.accessKey || !minioServiceConfig.secretKey || !minioServiceConfig.bucketName) {
            console.error("MAIN (ESM): Configuração essencial do Minio ausente. Verifique minioConfig.js e .env.");
            if (mainWindow && mainWindow.webContents && !mainWindow.isDestroyed()) {
                setTimeout(() => sendToRenderer('monitoring-status-update', 'ERRO FATAL: Falha na configuração do Storage. Uploads desabilitados.'), 1000);
            }
            return;
        }
        minioService = new MinioService(minioServiceConfig);
        console.log('MAIN (ESM): MinioService inicializado com sucesso.');
      } catch (error) {
        console.error("MAIN (ESM): FALHA AO INICIALIZAR MINIOSERVICE!", error);
        if (mainWindow && mainWindow.webContents && !mainWindow.isDestroyed()) {
            setTimeout(() => sendToRenderer('monitoring-status-update', `ERRO FATAL: Falha ao conectar com o Storage (${error.message}). Uploads desabilitados.`), 1000);
        }
      }
}

function createMainWindow() {
  console.log('MAIN (ESM): Criando janela principal.');
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, '../dist/preload-bundle.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
    show: false,
    icon: path.join(__dirname, '../build/icon.png')
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer/login.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    // Descomente para abrir DevTools automaticamente ao iniciar (para depuração)
    // mainWindow.webContents.openDevTools(); 
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  initializeServices();
}

function sendToRenderer(channel, data) {
    if (mainWindow && mainWindow.webContents && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, data);
    } else {
        // console.warn(`MAIN (ESM): Tentativa de enviar para renderer no canal ${channel}, mas mainWindow não está disponível.`);
    }
}

// --- Handlers IPC ---
ipcMain.handle('get-firebase-config', () => {
  if (
    !FIREBASE_APP_CONFIG ||
    !FIREBASE_APP_CONFIG.apiKey ||
    !FIREBASE_APP_CONFIG.authDomain ||
    !FIREBASE_APP_CONFIG.projectId
  ) {
    console.error(
      "MAIN (ESM) (get-firebase-config): Configuração do Firebase capturada está incompleta ou ausente."
    );
    return null;
  }
  return FIREBASE_APP_CONFIG;
});

ipcMain.on('login-successful', () => {
  console.log('MAIN (ESM): Login bem-sucedido. Carregando index.html.');
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'))
      .then(() => console.log("MAIN (ESM): index.html carregado."))
      .catch(err => console.error("MAIN (ESM): Erro ao carregar index.html", err));
  }
});

ipcMain.on('logout-request', () => {
  console.log('MAIN (ESM): Solicitação de logout. Carregando login.html.');
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadFile(path.join(__dirname, 'renderer/login.html'))
      .then(() => console.log("MAIN (ESM): login.html carregado após logout."))
      .catch(err => console.error("MAIN (ESM): Erro ao carregar login.html após logout", err));
  }
});

ipcMain.handle('get-app-version', () => {
    return app.getVersion();
});

ipcMain.on('request-video-processing', async (event, data) => {
  const { youtubeUrl, empresaId, projetoId } = data;
  const logPrefix = `[PROJETO ${projetoId}][EMPRESA ${empresaId}]`;
  let tempFilePath = null;

  if (!minioService) {
    console.error(`MAIN (ESM): ${logPrefix} MinioService não inicializado. Abortando.`);
    sendToRenderer('video-processing-result', {
        success: false, empresaId, projetoId,
        error: 'Serviço de Storage (Minio) não está disponível.'
    });
    return;
  }

  console.log(`MAIN (ESM): ${logPrefix} Processando vídeo. URL: ${youtubeUrl.substring(0,70)}...`);
  sendToRenderer('monitoring-status-update', `${logPrefix} Iniciando download...`);

  const downloadService = new DownloadService({
    onProgress: (percent, downloaded, total) => {
      let progressMsg = `${logPrefix} Download: ${percent >= 0 ? percent.toFixed(0) + '%' : ''} (${(downloaded / (1024*1024)).toFixed(2)}MB${total > 0 ? ' / '+(total / (1024*1024)).toFixed(2)+'MB' : ' baixados'})`;
      sendToRenderer('monitoring-status-update', progressMsg);
    },
    onLog: (message) => console.log(`MAIN (ESM) (DownloadService): ${message}`)
  });

  try {
    tempFilePath = await downloadService.downloadVideo(youtubeUrl, projetoId);
    const validation = downloadService.validateDownloadedFile(tempFilePath);
    if (!validation.valid) {
        console.error(`MAIN (ESM): ${logPrefix} Arquivo baixado inválido: ${validation.reason}.`);
        throw new Error(`Arquivo baixado inválido: ${validation.reason}`);
    }
    console.log(`MAIN (ESM): ${logPrefix} Arquivo validado. Tamanho: ${(validation.size / (1024*1024)).toFixed(2)}MB`);

    sendToRenderer('monitoring-status-update', `${logPrefix} Download concluído. Upload para Minio...`);

    const videoFileName = path.basename(tempFilePath);
    const minioObjectName = `shorts/${projetoId}/${videoFileName}`;

    await minioService.uploadFile(minioObjectName, tempFilePath);
    console.log(`MAIN (ESM): ${logPrefix} Upload para Minio concluído.`);
    
    sendToRenderer('video-processing-result', {
      success: true, empresaId, projetoId, minioPath: minioObjectName
    });

  } catch (error) {
    console.error(`MAIN (ESM): ${logPrefix} Erro no processamento do vídeo:`, error.message);
    sendToRenderer('video-processing-result', {
      success: false, empresaId, projetoId, error: error.message || 'Erro desconhecido'
    });
  } finally {
    if (tempFilePath) {
      downloadService.cleanupTempFile(tempFilePath);
    }
  }
});

// --- Ciclo de Vida do App ---
app.whenReady().then(() => {
  createMainWindow(); // Cria a janela principal

  // ---- INÍCIO DA SEÇÃO DO MENU RESTAURADA ----
  const isMac = process.platform === 'darwin';
  const menuTemplate = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about', label: `Sobre ${app.name}` },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide', label: `Ocultar ${app.name}` },
        { role: 'hideOthers', label: 'Ocultar Outros' },
        { role: 'unhide', label: 'Mostrar Todos' },
        { type: 'separator' },
        { role: 'quit', label: `Sair de ${app.name}` }
      ]
    }] : []),
    {
      label: 'Arquivo',
      submenu: [
        isMac ? { role: 'close', label: 'Fechar Janela' } : { role: 'quit', label: 'Sair' }
      ]
    },
    {
      label: 'Editar',
      submenu: [
        { role: 'undo', label: 'Desfazer' },
        { role: 'redo', label: 'Refazer' },
        { type: 'separator' },
        { role: 'cut', label: 'Recortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Colar' },
        ...(isMac ? [
          { role: 'pasteAndMatchStyle', label: 'Colar com Mesmo Estilo' },
          { role: 'delete', label: 'Deletar' },
          { role: 'selectAll', label: 'Selecionar Tudo' },
        ] : [
          { role: 'delete', label: 'Deletar' },
          { type: 'separator' },
          { role: 'selectAll', label: 'Selecionar Tudo' }
        ])
      ]
    },
    {
      label: 'Visualizar',
      submenu: [
        { role: 'reload', label: 'Recarregar' },
        { role: 'forceReload', label: 'Forçar Recarregamento' },
        { role: 'toggleDevTools', label: 'Alternar Ferramentas do Desenvolvedor' }, // <--- AQUI
        { type: 'separator' },
        { role: 'resetZoom', label: 'Restaurar Zoom' },
        { role: 'zoomIn', label: 'Aumentar Zoom' },
        { role: 'zoomOut', label: 'Diminuir Zoom' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Tela Cheia' }
      ]
    },
    {
      label: 'Janela',
      submenu: [
        { role: 'minimize', label: 'Minimizar' },
        { role: 'zoom', label: 'Zoom' },
        ...(isMac ? [
          { type: 'separator' },
          { role: 'front', label: 'Trazer Tudo para Frente' },
        ] : [
          { role: 'close', label: 'Fechar' }
        ])
      ]
    },
    {
      role: 'help',
      label: 'Ajuda',
      submenu: [
        {
          label: 'Saber Mais sobre Electron',
          click: async () => {
            // shell já foi importado no topo
            await shell.openExternal('https://electronjs.org');
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);
  // ---- FIM DA SEÇÃO DO MENU RESTAURADA ----


  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
  console.log('MAIN (ESM): App pronto e menu configurado.');
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('quit', () => {
    console.log('MAIN (ESM): Aplicação encerrando.');
});