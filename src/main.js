// src/main.js
require('dotenv').config(); // CARREGA .env PARA process.env NO TOPO DO ARQUIVO

const { app, BrowserWindow, ipcMain, Menu, shell } = require('electron'); // Adicionado Menu e shell
const path = require('path');

// Importa a configuração do Minio que lê de process.env
// Certifique-se que este arquivo existe e está configurado como discutido
const MINIO_CFG_FROM_FILE = require('./minioConfig.js');

const DownloadService = require('./services/downloadService');
const MinioService = require('./services/minioService');

console.log('MAIN: Processo principal iniciado.');
let mainWindow;
let minioService; // Instância do MinioService

// Configuração do Minio com a função onLog e usando MINIO_CFG_FROM_FILE
const minioServiceConfig = {
    ...MINIO_CFG_FROM_FILE, // Espalha as propriedades de minioConfig.js
    onLog: (message) => console.log(`MAIN (MinioService): ${message}`)
};

function initializeServices() {
    try {
        // Validação movida para dentro de minioConfig.js, mas podemos checar aqui também
        if (!minioServiceConfig.endpoint || !minioServiceConfig.accessKey || !minioServiceConfig.secretKey || !minioServiceConfig.bucketName) {
            console.error("MAIN: Configuração essencial do Minio ausente APÓS importação. Verifique minioConfig.js e .env.");
            // Não instanciar minioService se a config estiver incompleta
            // Notificar o renderer ou tratar de outra forma
            if (mainWindow && mainWindow.webContents && !mainWindow.isDestroyed()) {
                 // Atraso para garantir que o renderer possa receber a mensagem
                setTimeout(() => sendToRenderer('monitoring-status-update', 'ERRO FATAL: Falha na configuração do Storage. Funcionalidades de upload desabilitadas.'), 1000);
            }
            return; // Impede a instanciação se a config estiver ruim
        }
        minioService = new MinioService(minioServiceConfig);
        console.log('MAIN: MinioService inicializado com sucesso.');
      } catch (error) {
        console.error("MAIN: FALHA AO INICIALIZAR MINIOSERVICE!", error);
        if (mainWindow && mainWindow.webContents && !mainWindow.isDestroyed()) {
            setTimeout(() => sendToRenderer('monitoring-status-update', `ERRO FATAL: Falha ao conectar com o Storage (${error.message}). Uploads desabilitados.`), 1000);
        }
      }
}

function createMainWindow() {
  console.log('MAIN: Criando janela principal.');
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
    show: false,
    icon: path.join(__dirname, '../build/icon.png') // Ajuste o caminho se o ícone estiver em outro lugar
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer/login.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    // mainWindow.webContents.openDevTools();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  initializeServices(); // Inicializa o MinioService aqui
}

function sendToRenderer(channel, data) {
    if (mainWindow && mainWindow.webContents && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, data);
    } else {
        console.warn(`MAIN: Tentativa de enviar para renderer no canal ${channel}, mas mainWindow não está disponível.`);
    }
}

// --- Handlers IPC ---
ipcMain.handle('get-firebase-config', () => {
  console.log("MAIN: Fornecendo Firebase config para o renderer via IPC.");
  const firebaseConfigForRenderer = {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID,
    // measurementId: process.env.FIREBASE_MEASUREMENT_ID, // Se você usar Analytics
  };

  if (
    !firebaseConfigForRenderer.apiKey ||
    !firebaseConfigForRenderer.authDomain ||
    !firebaseConfigForRenderer.projectId
  ) {
    console.error(
      "FIREBASE_CONFIG: Erro Crítico! Variáveis de ambiente essenciais para Firebase não estão definidas." +
      " Verifique seu arquivo .env ou as variáveis de ambiente do sistema."
    );
    return null; // Renderer deve tratar config nula
  }
  return firebaseConfigForRenderer;
});

ipcMain.on('login-successful', () => {
  console.log('MAIN: Login bem-sucedido. Carregando página principal (index.html).');
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'))
      .then(() => console.log("MAIN: index.html carregado."))
      .catch(err => console.error("MAIN: Erro ao carregar index.html", err));
  }
});

ipcMain.on('logout-request', () => {
  console.log('MAIN: Solicitação de logout. Carregando página de login (login.html).');
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadFile(path.join(__dirname, 'renderer/login.html'))
      .then(() => console.log("MAIN: login.html carregado após logout."))
      .catch(err => console.error("MAIN: Erro ao carregar login.html após logout", err));
  }
});

ipcMain.handle('get-app-version', () => {
    return app.getVersion();
});

ipcMain.on('request-video-processing', async (event, data) => {
  const { youtubeUrl, empresaId, projetoId } = data;
  const logPrefix = `[PROJETO ${projetoId}][EMPRESA ${empresaId}]`;
  let tempFilePath = null;

  if (!minioService) { // minioService é instanciado em initializeServices
    console.error(`MAIN: ${logPrefix} MinioService não está inicializado. Abortando processamento.`);
    sendToRenderer('video-processing-result', {
      success: false,
      empresaId,
      projetoId,
      error: 'Serviço de Storage (Minio) não está disponível. Verifique as configurações ou reinicie.'
    });
    return;
  }

  console.log(`MAIN: ${logPrefix} Processando vídeo. URL: ${youtubeUrl}`);
  sendToRenderer('monitoring-status-update', `${logPrefix} Iniciando download...`);

  const downloadService = new DownloadService({
    onProgress: (percent, downloaded, total) => {
      let progressMsg;
      if (total && total > 0) {
        progressMsg = `${logPrefix} Download: ${percent.toFixed(0)}% (${(downloaded / (1024*1024)).toFixed(2)}MB / ${(total / (1024*1024)).toFixed(2)}MB)`;
      } else {
        progressMsg = `${logPrefix} Download: (${(downloaded / (1024*1024)).toFixed(2)}MB baixados)`;
      }
      sendToRenderer('monitoring-status-update', progressMsg);
    },
    onLog: (message) => console.log(`MAIN (DownloadService): ${message}`)
  });

  try {
    tempFilePath = await downloadService.downloadVideo(youtubeUrl, projetoId);
    const validation = downloadService.validateDownloadedFile(tempFilePath);
    if (!validation.valid) {
        console.error(`MAIN: ${logPrefix} Arquivo baixado inválido: ${validation.reason}. URL: ${youtubeUrl}`);
        throw new Error(`Arquivo baixado inválido: ${validation.reason}`);
    }
    console.log(`MAIN: ${logPrefix} Arquivo validado. Tamanho: ${(validation.size / (1024*1024)).toFixed(2)}MB`);

    sendToRenderer('monitoring-status-update', `${logPrefix} Download concluído. Upload para Minio...`);

    const videoFileName = path.basename(tempFilePath);
    const minioObjectName = `shorts/${projetoId}/${videoFileName}`;

    console.log(`MAIN: ${logPrefix} Upload para Minio: ${minioServiceConfig.bucketName}/${minioObjectName}`);
    await minioService.uploadFile(minioObjectName, tempFilePath);
    console.log(`MAIN: ${logPrefix} Upload para Minio concluído.`);
    
    sendToRenderer('video-processing-result', {
      success: true,
      empresaId,
      projetoId,
      minioPath: minioObjectName
    });

  } catch (error) {
    console.error(`MAIN: ${logPrefix} Erro no processamento do vídeo:`, error.message, error.stack ? error.stack : '');
    sendToRenderer('video-processing-result', {
      success: false,
      empresaId,
      projetoId,
      error: error.message || 'Erro desconhecido no processamento'
    });
  } finally {
    if (tempFilePath) {
      downloadService.cleanupTempFile(tempFilePath);
    }
  }
});

// --- Ciclo de Vida do App ---
app.whenReady().then(() => {
  createMainWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
  console.log('MAIN: App pronto.');
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('quit', () => {
    console.log('MAIN: Aplicação encerrando.');
});

// --- Menu da Aplicação ---
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
      { role: 'toggleDevTools', label: 'Alternar Ferramentas do Desenvolvedor' },
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
          await shell.openExternal('https://electronjs.org');
        }
      }
    ]
  }
];

const menu = Menu.buildFromTemplate(menuTemplate);
Menu.setApplicationMenu(menu);