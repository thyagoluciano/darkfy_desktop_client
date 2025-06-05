// src/main.js
import path from 'path';
import { fileURLToPath } from 'url';
import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron';
import fs from 'fs'; // Para ler o arquivo de config

// Importe APENAS os objetos de configuração (eles serão preenchidos)
import FIREBASE_APP_CFG_OBJ from './config/firebaseConfig.js';
import MINIO_CFG_OBJ from './config/minioConfig.js';

// Importe os serviços
import DownloadService from './services/downloadService.js';
import MinioService from './services/minioService.js';

// Obter __dirname e __filename em ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename); // Em dev: aponta para src. Em prod (asar): aponta para a raiz do asar onde main.js está.

let APP_CONFIG_FROM_JSON;

console.log(`[main.js] INÍCIO DO ARQUIVO. app.isPackaged: ${app.isPackaged}`);
console.log(`[main.js] __dirname (inicial, onde main.js reside): ${__dirname}`);

try {
    let configPath;
    if (app.isPackaged) {
        // Quando empacotado, __dirname do main.js (que está em app.asar/src/main.js se "src" foi mantido na estrutura)
        // O app-config.json foi colocado na raiz do asar por "dist/app-config.json" nos files.
        // Se main.js está em app.asar/src/main.js, precisamos voltar um nível de 'src'.
        // Se main.js está em app.asar/main.js, então é path.join(__dirname, 'app-config.json').
        // Assumindo que a estrutura "src" é mantida dentro do asar para o main.js:
        // configPath = path.join(__dirname, '..', 'app-config.json');
        configPath = path.join(__dirname, '..', 'dist', 'app-config.json');
    } else {
        // Em dev, __dirname é src. O config.json é gerado em ../dist/app-config.json
        configPath = path.join(__dirname, '..', 'dist', 'app-config.json');
    }

    console.log(`[main.js] Tentando carregar config de: ${configPath}`);
    const configFile = fs.readFileSync(configPath, 'utf-8');
    APP_CONFIG_FROM_JSON = JSON.parse(configFile);

    // Preencher os objetos de configuração importados
    if (APP_CONFIG_FROM_JSON.firebase) {
        Object.assign(FIREBASE_APP_CFG_OBJ, APP_CONFIG_FROM_JSON.firebase);
    } else {
        console.error('[main.js] Chave "firebase" não encontrada em app-config.json');
    }

    if (APP_CONFIG_FROM_JSON.minio) {
        Object.assign(MINIO_CFG_OBJ, APP_CONFIG_FROM_JSON.minio);
    } else {
        console.error('[main.js] Chave "minio" não encontrada em app-config.json');
    }

    console.log('[main.js] Configuração carregada de app-config.json.');
    // console.log('[main.js] FIREBASE_APP_CFG_OBJ após carregar JSON:', JSON.stringify(FIREBASE_APP_CFG_OBJ));
    // console.log('[main.js] MINIO_CFG_OBJ após carregar JSON:', JSON.stringify(MINIO_CFG_OBJ));

} catch (error) {
    console.error('[main.js] ERRO FATAL: Não foi possível carregar ou parsear app-config.json!', error);
    // Deixa os objetos de config vazios ou com padrões, as checagens posteriores devem falhar.
    Object.assign(FIREBASE_APP_CFG_OBJ, {}); // Garante que seja um objeto para evitar erros de undefined
    Object.assign(MINIO_CFG_OBJ, {});     // Garante que seja um objeto
}

// Renomeia para manter consistência com o código anterior
const FIREBASE_APP_CONFIG = FIREBASE_APP_CFG_OBJ;
const MINIO_CFG_FROM_ENV = MINIO_CFG_OBJ; // Pode ser renomeado para MINIO_APP_CONFIG

console.log('MAIN (ESM): Processo principal iniciado (após tentativa de carregar config).');

// Checagem inicial se as configs foram carregadas
if (FIREBASE_APP_CONFIG && FIREBASE_APP_CONFIG.apiKey) {
    console.log('MAIN (ESM): Firebase Config carregada e parece válida.');
} else {
    console.error('MAIN (ESM): FALHA ao validar Firebase Config após carregar JSON.');
    console.log('MAIN (ESM): Conteúdo de FIREBASE_APP_CONFIG:', JSON.stringify(FIREBASE_APP_CONFIG));
}
if (MINIO_CFG_FROM_ENV && MINIO_CFG_FROM_ENV.endpoint) {
    console.log('MAIN (ESM): Minio Config carregada e parece válida.');
} else {
    console.error('MAIN (ESM): FALHA ao validar Minio Config após carregar JSON.');
    console.log('MAIN (ESM): Conteúdo de MINIO_CFG_FROM_ENV:', JSON.stringify(MINIO_CFG_FROM_ENV));
}

let mainWindow;
let minioService;

// Configuração para o MinioService que será passada ao construtor
const minioServiceConfigForConstructor = {
    ...MINIO_CFG_FROM_ENV, // Spread do objeto de configuração já preenchido
    onLog: (message) => console.log(`MAIN (ESM) (MinioService): ${message}`)
};

function initializeServices() {
    try {
        if (!MINIO_CFG_FROM_ENV.endpoint || !MINIO_CFG_FROM_ENV.accessKey || !MINIO_CFG_FROM_ENV.secretKey || !MINIO_CFG_FROM_ENV.bucketName) {
            console.error("MAIN (ESM) (initializeServices): Configuração essencial do Minio ausente. Uploads desabilitados.");
            if (mainWindow && mainWindow.webContents && !mainWindow.isDestroyed()) {
                setTimeout(() => sendToRenderer('monitoring-status-update', 'ERRO FATAL: Falha na configuração do Storage. Uploads desabilitados.'), 1000);
            }
            return;
        }
        minioService = new MinioService(minioServiceConfigForConstructor);
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

  let preloadPath;
  let loginHtmlPath;
  // A estrutura de arquivos dentro do ASAR depende da configuração 'files' do electron-builder.
  // Se "src/main.js" -> asarRoot/src/main.js, então __dirname = asarRoot/src
  // Se "dist/preload-bundle.js" -> asarRoot/preload-bundle.js
  // Se "src/renderer/login.html" -> asarRoot/src/renderer/login.html

  if (app.isPackaged) {
    // Assumindo que main.js está em asarRoot/src/main.js devido a "src/**/*" e "main": "src/main.js"
    // preloadPath = path.join(__dirname, '..', 'preload-bundle.js'); // Volta de 'src' para a raiz do asar
    preloadPath = path.join(__dirname, '..', 'dist', 'preload-bundle.js');
    loginHtmlPath = path.join(__dirname, 'renderer', 'login.html'); // Dentro de 'src/renderer' no asar
  } else {
    // Em desenvolvimento: __dirname é a pasta 'src'
    preloadPath = path.join(__dirname, '..', 'dist', 'preload-bundle.js');
    loginHtmlPath = path.join(__dirname, 'renderer', 'login.html');
  }

  console.log(`[main.js] Usando preload path para BrowserWindow: ${preloadPath}`);
  console.log(`[main.js] Carregando login HTML de: ${loginHtmlPath}`);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
    show: false,
    // O ícone do aplicativo é definido pela configuração do electron-builder no package.json.
    // Não é necessário definir 'icon' aqui para a janela principal, a menos que queira um ícone de janela diferente.
  });

  mainWindow.loadFile(loginHtmlPath);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (!app.isPackaged) { // Abrir DevTools apenas em desenvolvimento
        // mainWindow.webContents.openDevTools();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  initializeServices();
}

function sendToRenderer(channel, data) {
    if (mainWindow && mainWindow.webContents && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, data);
    }
}

// --- Handlers IPC ---
ipcMain.handle('get-firebase-config', () => {
  console.log('[main.js] Handler get-firebase-config chamado.');
  // console.log('[main.js] Handler - Conteúdo de FIREBASE_APP_CONFIG:', JSON.stringify(FIREBASE_APP_CONFIG));
  if (
    !FIREBASE_APP_CONFIG ||
    !FIREBASE_APP_CONFIG.apiKey ||
    !FIREBASE_APP_CONFIG.authDomain ||
    !FIREBASE_APP_CONFIG.projectId
  ) {
    console.error(
      "[main.js] Handler get-firebase-config: Objeto FIREBASE_APP_CONFIG está incompleto."
    );
    return null;
  }
  return FIREBASE_APP_CONFIG;
});

ipcMain.on('login-successful', () => {
  console.log('MAIN (ESM): Login bem-sucedido. Carregando index.html.');
  if (mainWindow && !mainWindow.isDestroyed()) {
    let indexHtmlPath;
    if (app.isPackaged) {
        indexHtmlPath = path.join(__dirname, 'renderer', 'index.html');
    } else {
        indexHtmlPath = path.join(__dirname, 'renderer', 'index.html');
    }
    console.log(`[main.js] Carregando index HTML de: ${indexHtmlPath}`);
    mainWindow.loadFile(indexHtmlPath)
      .then(() => console.log("MAIN (ESM): index.html carregado."))
      .catch(err => console.error("MAIN (ESM): Erro ao carregar index.html", err));
  }
});

ipcMain.on('logout-request', () => {
  console.log('MAIN (ESM): Solicitação de logout. Carregando login.html.');
  if (mainWindow && !mainWindow.isDestroyed()) {
    let loginHtmlPath;
     if (app.isPackaged) {
        loginHtmlPath = path.join(__dirname, 'renderer', 'login.html');
    } else {
        loginHtmlPath = path.join(__dirname, 'renderer', 'login.html');
    }
    console.log(`[main.js] Carregando login HTML (logout) de: ${loginHtmlPath}`);
    mainWindow.loadFile(loginHtmlPath)
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
  createMainWindow(); // Usa a função createMainWindow ajustada

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