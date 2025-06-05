// src/main.js
import path from 'path';
import { fileURLToPath } from 'url';
import { app, BrowserWindow, ipcMain, Menu, shell, dialog } from 'electron'; // Adicionado dialog
import fs from 'fs';
import mime from 'mime-types';

// Importe APENAS os objetos de configuração (eles serão preenchidos)
import FIREBASE_APP_CFG_OBJ from './config/firebaseConfig.js';
import BUCKET_CFG_OBJ from './config/bucketConfig.js';

// Importe os serviços
import DownloadService from './services/downloadService.js';
import BucketService from './services/bucketService.js';
import PreSignedUrlService from './services/preSignedUrlService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let APP_CONFIG_FROM_JSON;
let API_CFG_OBJ = {};
// BUCKET_CFG_OBJ já está declarado acima

console.log('[main.js] SCRIPT INICIADO');
console.log(`[main.js] INÍCIO DO ARQUIVO. app.isPackaged: ${app.isPackaged}`);
console.log(`[main.js] __dirname (inicial, onde main.js reside): ${__dirname}`);

try {
    let configPath;
    if (app.isPackaged) {
        // configPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'dist', 'app-config.json');
        configPath = path.join(__dirname, '..', 'dist', 'app-config.json');
    } else {
        configPath = path.join(__dirname, '..', 'dist', 'app-config.json');
    }

    console.log(`[main.js] Tentando carregar config de: ${configPath}`);
    if (!fs.existsSync(configPath)) {
        console.error(`[main.js] ERRO FATAL: app-config.json NÃO ENCONTRADO em ${configPath}`);
        dialog.showErrorBox('Erro Crítico de Configuração', `Arquivo de configuração app-config.json não encontrado em ${configPath}. A aplicação não pode iniciar.`);
        app.quit();
        throw new Error("app-config.json não encontrado"); // Lança erro para parar a execução se o throw não for pego
    }
    const configFile = fs.readFileSync(configPath, 'utf-8');
    APP_CONFIG_FROM_JSON = JSON.parse(configFile);
    console.log('[main.js] app-config.json PARSEADO:', JSON.stringify(APP_CONFIG_FROM_JSON, null, 2));

    if (APP_CONFIG_FROM_JSON.firebase) {
        Object.assign(FIREBASE_APP_CFG_OBJ, APP_CONFIG_FROM_JSON.firebase);
    } else {
        console.error('[main.js] Chave "firebase" não encontrada em app-config.json');
    }

    if (APP_CONFIG_FROM_JSON.bucket) {
        Object.assign(BUCKET_CFG_OBJ, APP_CONFIG_FROM_JSON.bucket);
    } else {
        console.warn('[main.js] Chave "bucket" não encontrada em app-config.json.');
    }
    if (APP_CONFIG_FROM_JSON.api) {
        Object.assign(API_CFG_OBJ, APP_CONFIG_FROM_JSON.api);
    } else {
        console.error('[main.js] Chave "api" não encontrada em app-config.json');
    }

    console.log('[main.js] Configuração carregada de app-config.json.');

} catch (error) {
    console.error('[main.js] ERRO FATAL durante o carregamento ou parse do app-config.json!', error);
    if (!app.isReady()) { // Se app não está pronto, não podemos mostrar dialog ainda
        app.on('ready', () => {
            dialog.showErrorBox('Erro Crítico de Configuração', `Falha ao carregar ou processar app-config.json: ${error.message}. A aplicação será encerrada.`);
            app.quit();
        });
    } else if(!BrowserWindow.getAllWindows().length) { // Se app está pronto, mas nenhuma janela existe
         dialog.showErrorBox('Erro Crítico de Configuração', `Falha ao carregar ou processar app-config.json: ${error.message}. A aplicação será encerrada.`);
         app.quit();
    }
    // Se já houver janelas, a aplicação pode tentar continuar, mas provavelmente quebrará.
    // No nosso caso, se a config falha, é melhor encerrar.
    // O throw acima pode já ter encerrado o processo se não for pego no escopo global do módulo.
    // Para garantir, podemos forçar a saída, mas isso é abrupto.
    // process.exit(1);
    Object.assign(FIREBASE_APP_CFG_OBJ, {});
    Object.assign(BUCKET_CFG_OBJ, {});
    Object.assign(API_CFG_OBJ, {});
}

const FIREBASE_APP_CONFIG = FIREBASE_APP_CFG_OBJ;
const API_APP_CONFIG = API_CFG_OBJ;

console.log('MAIN (ESM): Processo principal iniciado (após tentativa de carregar config).');
console.log('[main.js] FIREBASE_APP_CONFIG:', JSON.stringify(FIREBASE_APP_CONFIG, null, 2));
console.log('[main.js] BUCKET_CFG_OBJ (para BucketService):', JSON.stringify(BUCKET_CFG_OBJ, null, 2));
console.log('[main.js] API_APP_CONFIG:', JSON.stringify(API_APP_CONFIG, null, 2));


if (!FIREBASE_APP_CONFIG || !FIREBASE_APP_CONFIG.apiKey) {
    console.error('MAIN (ESM): FALHA ao validar Firebase Config.');
} else {
    console.log('MAIN (ESM): Firebase Config OK.');
}

if (!API_APP_CONFIG || !API_APP_CONFIG.baseUrl) {
    console.error('MAIN (ESM): FALHA ao validar API Config (baseUrl ausente). Obtenção de URLs pré-assinadas PODE FALHAR.');
} else {
    console.log('MAIN (ESM): API Config OK.');
}

if (BUCKET_CFG_OBJ && BUCKET_CFG_OBJ.name) {
    console.log(`MAIN (ESM): Nome do Bucket (BUCKET_CFG_OBJ.name): ${BUCKET_CFG_OBJ.name}`);
} else {
    console.warn('MAIN (ESM): Nome do Bucket (BUCKET_CFG_OBJ.name) não definido em app-config.json. Isso pode ser um problema para a API de URL pré-assinada.');
}

let mainWindow;
let bucketService;
let preSignedUrlService;

function initializeServices() {
    console.log('[main.js] --- initializeServices: INÍCIO ---');
    try {
        console.log('[main.js] initializeServices: Tentando BucketService...');
        bucketService = new BucketService(
            (message) => console.log(`MAIN (ESM) (BucketService): ${message}`)
        );
        console.log('MAIN (ESM): BucketService (refatorado) inicializado.');
    } catch (error) {
        console.error("MAIN (ESM): FALHA AO INICIALIZAR BUCKETSERVICE!", error);
        if (mainWindow && mainWindow.webContents && !mainWindow.isDestroyed()) {
            setTimeout(() => sendToRenderer('monitoring-status-update', `ERRO FATAL: Falha ao inicializar Serviço de Upload (${error.message}).`), 1000);
        }
    }

    try {
        console.log('[main.js] initializeServices: Tentando PreSignedUrlService...');
        if (!API_APP_CONFIG.baseUrl) {
            console.error("MAIN (ESM) (initializeServices): Configuração da API (baseUrl) ausente. Obtenção de URLs pré-assinadas desabilitada.");
            if (mainWindow && mainWindow.webContents && !mainWindow.isDestroyed()) {
                 setTimeout(() => sendToRenderer('monitoring-status-update', 'ERRO: Falha na configuração da API de Uploads. Uploads podem falhar.'), 1000);
            }
        } else {
            preSignedUrlService = new PreSignedUrlService(
                API_APP_CONFIG.baseUrl,
                (message) => console.log(`MAIN (ESM) (PreSignedUrlService): ${message}`)
            );
            console.log('MAIN (ESM): PreSignedUrlService inicializado com sucesso.');
        }
    } catch (error) {
        console.error("MAIN (ESM): FALHA AO INICIALIZAR PRESIGNEDURLSERVICE!", error);
        if (mainWindow && mainWindow.webContents && !mainWindow.isDestroyed()) {
            setTimeout(() => sendToRenderer('monitoring-status-update', `ERRO: Falha ao configurar serviço de URLs Pré-assinadas (${error.message}). Uploads podem falhar.`), 1000);
        }
    }
    console.log('[main.js] --- initializeServices: FIM ---');
}

function createMainWindow() {
  console.log('[main.js] ---- createMainWindow: INÍCIO ----');

  let preloadPath;
  let loginHtmlPath;

  if (app.isPackaged) {
    // Se o main.js está em app.asar/src/main.js e os bundles/htmls estão em app.asar/dist/ e app.asar/src/renderer
    preloadPath = path.join(__dirname, '..', 'dist', 'preload-bundle.js'); //  app.asar/dist/preload-bundle.js
    loginHtmlPath = path.join(__dirname, 'renderer', 'login.html'); // app.asar/src/renderer/login.html
  } else {
    // Em desenvolvimento: __dirname é a pasta 'src'
    preloadPath = path.join(__dirname, '..', 'dist', 'preload-bundle.js'); // projeto/dist/preload-bundle.js
    loginHtmlPath = path.join(__dirname, 'renderer', 'login.html');    // projeto/src/renderer/login.html
  }

  console.log(`[main.js] createMainWindow: Usando preload path para BrowserWindow: ${preloadPath}`);
  console.log(`[main.js] createMainWindow: Caminho para login HTML: ${loginHtmlPath}`);

  if (!fs.existsSync(preloadPath)) {
      console.error(`[main.js] createMainWindow: ERRO - Arquivo de preload NÃO ENCONTRADO em: ${preloadPath}`);
      dialog.showErrorBox('Erro Crítico de Aplicação', `Arquivo de preload não encontrado. A aplicação não pode iniciar.`);
      app.quit();
      return;
  }
  if (!fs.existsSync(loginHtmlPath)) {
      console.error(`[main.js] createMainWindow: ERRO - Arquivo login.html NÃO ENCONTRADO em: ${loginHtmlPath}`);
      dialog.showErrorBox('Erro Crítico de Aplicação', `Arquivo de interface principal (login.html) não encontrado. A aplicação não pode iniciar.`);
      app.quit();
      return;
  }

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
  });
  console.log('[main.js] createMainWindow: BrowserWindow instanciada.');

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error(`[main.js] createMainWindow: WebContents 'did-fail-load': URL ${validatedURL} falhou ao carregar. Código: ${errorCode}, Descrição: ${errorDescription}`);
    dialog.showErrorBox('Erro de Carregamento', `Falha ao carregar a página: ${validatedURL}\n${errorDescription}`);
  });

  mainWindow.webContents.on('crashed', (event, killed) => {
    console.error(`[main.js] createMainWindow: WebContents 'crashed'. Foi morta? ${killed}`);
    dialog.showErrorBox('Erro Crítico', 'O processo da interface gráfica travou. A aplicação será encerrada.');
    app.quit();
  });

  mainWindow.on('unresponsive', () => {
    console.warn('[main.js] createMainWindow: Janela principal "unresponsive".');
    dialog.showErrorBox('Aplicação Não Respondendo', 'A janela principal parou de responder.');
  });

  console.log(`[main.js] createMainWindow: Tentando carregar ${loginHtmlPath}`);
  mainWindow.loadFile(loginHtmlPath)
    .then(() => {
      console.log(`[main.js] createMainWindow: SUCESSO ao carregar ${loginHtmlPath}`);
    })
    .catch(err => {
      console.error(`[main.js] createMainWindow: FALHA AO CARREGAR ${loginHtmlPath} usando mainWindow.loadFile:`, err);
      dialog.showErrorBox('Erro Crítico', `Não foi possível carregar a interface do usuário (login.html): ${err.message}`);
      app.quit();
    });

  mainWindow.once('ready-to-show', () => {
    console.log('[main.js] createMainWindow: Evento "ready-to-show" disparado. Mostrando a janela.');
    mainWindow.show();
    if (!app.isPackaged) {
        mainWindow.webContents.openDevTools(); // ABRIR DEVTOOLS EM DESENVOLVIMENTO
    }
  });

  mainWindow.on('closed', () => {
    console.log('[main.js] createMainWindow: Evento "closed" da janela principal.');
    mainWindow = null;
  });
  console.log('[main.js] ---- createMainWindow: FIM ----');
}

function sendToRenderer(channel, data) {
    if (mainWindow && mainWindow.webContents && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, data);
    } else {
        console.warn(`[main.js] sendToRenderer: Tentativa de enviar para o renderer no canal '${channel}', mas a janela não está pronta ou foi destruída.`);
    }
}

// --- Handlers IPC ---
ipcMain.handle('get-firebase-config', () => {
  console.log('[main.js] Handler get-firebase-config chamado.');
  if (
    !FIREBASE_APP_CONFIG ||
    !FIREBASE_APP_CONFIG.apiKey ||
    !FIREBASE_APP_CONFIG.authDomain ||
    !FIREBASE_APP_CONFIG.projectId
  ) {
    console.error("[main.js] Handler get-firebase-config: Objeto FIREBASE_APP_CONFIG está incompleto ou ausente.");
    return null; // Retornar null para o renderer tratar
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

    if (!fs.existsSync(indexHtmlPath)) {
        console.error(`[main.js] login-successful: ERRO - Arquivo index.html NÃO ENCONTRADO em: ${indexHtmlPath}`);
        dialog.showErrorBox('Erro Crítico', `Arquivo de dashboard (index.html) não encontrado.`);
        return; // Não tentar carregar
    }
    console.log(`[main.js] Carregando index HTML de: ${indexHtmlPath}`);
    mainWindow.loadFile(indexHtmlPath)
      .then(() => console.log("MAIN (ESM): index.html carregado."))
      .catch(err => {
          console.error("MAIN (ESM): Erro ao carregar index.html", err);
          dialog.showErrorBox('Erro ao Carregar Dashboard', `Falha ao carregar a página principal: ${err.message}`);
      });
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
    if (!fs.existsSync(loginHtmlPath)) {
        console.error(`[main.js] logout-request: ERRO - Arquivo login.html NÃO ENCONTRADO em: ${loginHtmlPath}`);
        dialog.showErrorBox('Erro Crítico', `Arquivo de login (login.html) não encontrado.`);
        return;
    }
    console.log(`[main.js] Carregando login HTML (logout) de: ${loginHtmlPath}`);
    mainWindow.loadFile(loginHtmlPath)
      .then(() => console.log("MAIN (ESM): login.html carregado após logout."))
      .catch(err => {
          console.error("MAIN (ESM): Erro ao carregar login.html após logout", err);
          dialog.showErrorBox('Erro ao Fazer Logout', `Falha ao carregar a página de login: ${err.message}`);
      });
  }
});

ipcMain.handle('get-app-version', () => {
    return app.getVersion();
});

ipcMain.on('request-video-processing', async (event, dataWithToken) => {
  const { youtubeUrl, empresaId, projetoId, firebaseIdToken } = dataWithToken;
  const logPrefix = `[PROJETO ${projetoId}][EMPRESA ${empresaId}]`;
  let tempFilePath = null;
  let fileSize = 0;

  if (!firebaseIdToken) {
    console.error(`MAIN (ESM): ${logPrefix} Firebase ID Token não fornecido na requisição. Abortando.`);
    sendToRenderer('video-processing-result', {
        success: false, empresaId, projetoId,
        error: 'Autenticação do usuário falhou (token não fornecido).'
    });
    return;
  }

  if (!preSignedUrlService) {
    console.error(`MAIN (ESM): ${logPrefix} PreSignedUrlService não inicializado. Abortando.`);
    sendToRenderer('video-processing-result', {
        success: false, empresaId, projetoId,
        error: 'Serviço de obtenção de URL para upload não está disponível.'
    });
    return;
  }
  
  if (!bucketService) {
    console.error(`MAIN (ESM): ${logPrefix} BucketService (para upload) não inicializado. Abortando.`);
    sendToRenderer('video-processing-result', {
        success: false, empresaId, projetoId,
        error: 'Serviço de upload de arquivo não está disponível.'
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
        throw new Error(`Arquivo baixado inválido: ${validation.reason}`);
    }
    fileSize = validation.size;
    console.log(`MAIN (ESM): ${logPrefix} Arquivo validado. Tamanho: ${(fileSize / (1024*1024)).toFixed(2)}MB`);

    sendToRenderer('monitoring-status-update', `${logPrefix} Download concluído. Solicitando URL de upload...`);

    const videoFileName = path.basename(tempFilePath);
    const contentType = mime.lookup(tempFilePath) || 'application/octet-stream';
    let preSignedApiResponse;
    let objectKeyForFirestore;

    try {
        preSignedApiResponse = await preSignedUrlService.getPreSignedUrl(
            firebaseIdToken,
            projetoId,
            videoFileName,
            contentType
        );
        console.log(`MAIN (ESM): ${logPrefix} URL pré-assinada obtida: ${preSignedApiResponse.upload_url.substring(0, 70)}...`);
        
        objectKeyForFirestore = preSignedApiResponse.object_key || `shorts/${projetoId}/${videoFileName}`; 
        
        if (preSignedApiResponse.object_key) {
            console.log(`MAIN (ESM): ${logPrefix} Chave do objeto retornada pela API: ${objectKeyForFirestore}`);
        } else {
            console.warn(`MAIN (ESM): ${logPrefix} Chave do objeto ('object_key') não retornada pela API. Usando construída: ${objectKeyForFirestore}`);
        }

    } catch (urlError) {
        console.error(`MAIN (ESM): ${logPrefix} Erro ao obter URL pré-assinada:`, urlError.message);
        throw new Error(`Falha ao obter URL de upload: ${urlError.message}`);
    }

    try {
        sendToRenderer('monitoring-status-update', `${logPrefix} Fazendo upload para URL pré-assinada...`);
        await bucketService.uploadFile(
            preSignedApiResponse.upload_url,
            tempFilePath,
            contentType,
            fileSize,
            (percent, uploaded, total) => {
                let progressMsg = `${logPrefix} Upload: ${percent >= 0 ? percent.toFixed(0) + '%' : ''} (${(uploaded / (1024*1024)).toFixed(2)}MB${total > 0 ? ' / '+(total / (1024*1024)).toFixed(2)+'MB' : ' enviados'})`;
                sendToRenderer('monitoring-status-update', progressMsg);
            }
        );
        console.log(`MAIN (ESM): ${logPrefix} Upload para URL pré-assinada concluído.`);
        sendToRenderer('video-processing-result', {
          success: true, empresaId, projetoId, storagePath: objectKeyForFirestore
        });
    } catch (uploadError) {
        console.error(`MAIN (ESM): ${logPrefix} Erro durante o upload para URL pré-assinada:`, uploadError.message);
        throw new Error(`Falha no upload: ${uploadError.message}`);
    }

  } catch (error) {
    console.error(`MAIN (ESM): ${logPrefix} Erro no processamento do vídeo (global):`, error.message);
    sendToRenderer('video-processing-result', {
      success: false, empresaId, projetoId, error: error.message || 'Erro desconhecido no processamento global'
    });
  } finally {
    if (tempFilePath) {
      downloadService.cleanupTempFile(tempFilePath);
    }
  }
});

// --- Ciclo de Vida do App ---
app.whenReady().then(() => {
  console.log('[main.js] app.whenReady: INÍCIO');
  createMainWindow();
  initializeServices(); // Inicializa os serviços após a janela principal ser criada (ou em paralelo)

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
    if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
        // Se a janela for recriada no 'activate', os serviços já devem ter sido inicializados
        // Se initializeServices depende de mainWindow, então chame-o aqui também ou repense a dependência.
        // No nosso caso, initializeServices não depende de mainWindow para ser instanciado.
    }
  });
  console.log('[main.js] app.whenReady: FIM - App pronto e menu configurado.');
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('quit', () => {
    console.log('MAIN (ESM): Aplicação encerrando.');
});