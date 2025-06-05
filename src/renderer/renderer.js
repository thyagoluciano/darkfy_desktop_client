// src/renderer/renderer.js
// Firebase Global (será inicializado após obter a config)
let fbApp;
let fbAuth;
let fbDb;

// DECLARE as variáveis dos elementos da UI aqui, mas NÃO as atribua ainda.
let appHeader, headerEmpresaNome, headerUserEmail, headerLogoutButton;
let userInfoDebug, monitoringStatusDisplay, queueCountSpan;
let videoQueueListDisplay, currentVideoProcessingDisplay;
let yearSpanMain, versionSpanMain;

// O restante das variáveis globais (currentUID, etc.) permanece como está
let currentUID = null;
let empresaAtivaId = null;
let nomeEmpresaAtiva = 'N/A';
let unsubscribeFirestoreListener = null;
let cleanupVideoProcessingResultListener = null;
let cleanupMonitoringStatusListener = null;

let videoProcessingQueue = [];
let isCurrentlyProcessingVideo = false;

console.log('RENDERER (Dashboard): renderer.js carregado.');

// --- Listener para quando o DOM estiver pronto ---
document.addEventListener('DOMContentLoaded', () => {
    // AGORA que o DOM está pronto, podemos buscar os elementos
    appHeader = document.getElementById('app-header');
    headerEmpresaNome = document.getElementById('header-empresa-nome');
    headerUserEmail = document.getElementById('header-user-email');
    headerLogoutButton = document.getElementById('header-logout-button');

    userInfoDebug = document.getElementById('user-info'); // Para debug
    monitoringStatusDisplay = document.getElementById('monitoring-status');
    queueCountSpan = document.getElementById('queue-count');

    videoQueueListDisplay = document.getElementById('video-queue-list');
    currentVideoProcessingDisplay = document.getElementById('current-video-processing');

    yearSpanMain = document.getElementById('current-year-main');
    versionSpanMain = document.getElementById('app-version-main');

    // Adicionar folha de estilo para animações
    const styleSheet = document.createElement("style");
    styleSheet.type = "text/css";
    styleSheet.innerText = `
      @keyframes fadeIn {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .animate-fadeIn { animation: fadeIn 0.3s ease-out forwards; }
    `;
    document.head.appendChild(styleSheet);
    
    // Iniciar a aplicação APÓS o DOM estar pronto e elementos referenciados
    initializeApp();
});


// Função para inicializar Firebase e configurar a UI e listeners
async function initializeApp() {
    if (!monitoringStatusDisplay) { 
        console.error("RENDERER: monitoringStatusDisplay é nulo ANTES de inicializar. DOM não pronto?");
        return;
    }

    if (yearSpanMain) {
        yearSpanMain.textContent = new Date().getFullYear();
    }
    
    if (window.electronAPI && window.electronAPI.getAppVersion) {
        try {
            const version = await window.electronAPI.getAppVersion();
            if (versionSpanMain) versionSpanMain.textContent = version;
        } catch (err) {
            console.error("RENDERER: Erro ao obter versão do app", err);
            if (versionSpanMain) versionSpanMain.textContent = "N/A";
        }
    } else {
        console.warn("RENDERER: electronAPI.getAppVersion não disponível no preload.");
        if (versionSpanMain) versionSpanMain.textContent = "N/A";
    }

    // Obter configuração do Firebase e inicializar
    if (window.electronAPI && window.electronAPI.getFirebaseConfig) {
        try {
            const firebaseConfigFromMain = await window.electronAPI.getFirebaseConfig();
            if (firebaseConfigFromMain) {
                fbApp = firebase.initializeApp(firebaseConfigFromMain);
                fbAuth = firebase.auth();
                fbDb = firebase.firestore(); 
                console.log('RENDERER: Firebase inicializado com configuração do main process.');
                setupAuthListenerAndUI(); 
            } else {
                console.error('RENDERER: Configuração do Firebase não recebida do main process.');
                if (monitoringStatusDisplay) monitoringStatusDisplay.textContent = 'Erro crítico: Falha ao carregar configurações.';
            }
        } catch (error) {
            console.error('RENDERER: Erro ao obter ou inicializar Firebase:', error);
            if (monitoringStatusDisplay) monitoringStatusDisplay.textContent = 'Erro crítico: Falha nas configurações.';
        }
    } else {
        console.error('RENDERER: electronAPI.getFirebaseConfig não está disponível.');
        if (monitoringStatusDisplay) monitoringStatusDisplay.textContent = 'Erro crítico: API de comunicação falhou.';
    }
}

// Função para configurar o listener de autenticação e a lógica da UI principal
function setupAuthListenerAndUI() {
    if (!fbAuth) {
        console.error("RENDERER: fbAuth não inicializado antes de setupAuthListenerAndUI.");
        if (monitoringStatusDisplay) monitoringStatusDisplay.textContent = 'Erro: Firebase Auth não está pronto.';
        return;
    }

    if (!appHeader || !headerUserEmail || !headerEmpresaNome || !monitoringStatusDisplay || !headerLogoutButton) {
        console.error("RENDERER: Um ou mais elementos essenciais do DOM não foram encontrados em setupAuthListenerAndUI.");
        if(monitoringStatusDisplay) monitoringStatusDisplay.textContent = 'Erro: Falha ao carregar interface.';
        return;
    }

    fbAuth.onAuthStateChanged(async (user) => {
      if (user) {
        currentUID = user.uid;
        console.log(`RENDERER: Usuário logado: ${user.email} (UID: ${currentUID})`);
        
        appHeader.classList.remove('hidden');
        headerUserEmail.textContent = user.email;
        if (userInfoDebug) userInfoDebug.innerHTML = `UID: ${currentUID}<br>Email: ${user.email}`;

        monitoringStatusDisplay.textContent = 'Obtendo informações da empresa...';
        headerEmpresaNome.textContent = 'Carregando...';

        await setupUserSession(currentUID); 
      } else {
        console.log('RENDERER: Usuário deslogado.');
        currentUID = null;
        empresaAtivaId = null;
        nomeEmpresaAtiva = 'N/A';

        if (appHeader) appHeader.classList.add('hidden');
        
        if (unsubscribeFirestoreListener) {
          console.log('RENDERER: Cancelando listener do Firestore.');
          unsubscribeFirestoreListener();
          unsubscribeFirestoreListener = null;
        }
        if (cleanupVideoProcessingResultListener) {
            cleanupVideoProcessingResultListener();
            cleanupVideoProcessingResultListener = null;
        }
        if (cleanupMonitoringStatusListener) {
            cleanupMonitoringStatusListener();
            cleanupMonitoringStatusListener = null;
        }

        videoProcessingQueue = [];
        updateVideoQueueUI(); 
        updateCurrentProcessingUI(null);
        if (monitoringStatusDisplay) monitoringStatusDisplay.textContent = 'Deslogado. Redirecionando para login...';

        if (window.electronAPI && window.electronAPI.requestLogoutNavigation) {
            window.electronAPI.requestLogoutNavigation();
        } else {
            console.error('RENDERER: electronAPI.requestLogoutNavigation não está disponível.');
        }
      }
    });

    if (headerLogoutButton) {
      headerLogoutButton.addEventListener('click', async () => {
        try {
          if (monitoringStatusDisplay) monitoringStatusDisplay.textContent = "Saindo...";
          await fbAuth.signOut();
        } catch (error) {
          console.error('RENDERER: Erro no logout:', error);
          if (monitoringStatusDisplay) monitoringStatusDisplay.textContent = `Erro no logout: ${error.message}`;
        }
      });
    } else {
        console.warn("RENDERER: headerLogoutButton não encontrado no DOM.");
    }
}

async function setupUserSession(uid) {
    if (window.electronAPI) {
        if (window.electronAPI.onVideoProcessingResult && !cleanupVideoProcessingResultListener) {
            cleanupVideoProcessingResultListener = window.electronAPI.onVideoProcessingResult(handleVideoProcessingResult);
        }
        if (window.electronAPI.onMonitoringStatusUpdate && !cleanupMonitoringStatusListener) {
            cleanupMonitoringStatusListener = window.electronAPI.onMonitoringStatusUpdate(handleMonitoringStatusUpdate);
        }
    } else {
        console.error("RENDERER: electronAPI não está disponível para registrar listeners IPC.");
        if (monitoringStatusDisplay) monitoringStatusDisplay.textContent = "Erro crítico: API de comunicação indisponível.";
        return;
    }
    await setupFirestoreMonitoring(uid);
}

async function setupFirestoreMonitoring(uid) {
  if (unsubscribeFirestoreListener) {
    console.log('RENDERER_FIRESTORE: Cancelando listener anterior do Firestore.');
    unsubscribeFirestoreListener();
    unsubscribeFirestoreListener = null;
  }

  try {
    if (!fbDb) {
        console.error("RENDERER_FIRESTORE: fbDb não está inicializado.");
        if (monitoringStatusDisplay) monitoringStatusDisplay.textContent = `Erro: Serviço de banco de dados não pronto.`;
        return;
    }
    const userDocRef = fbDb.collection('usuarios').doc(uid);
    const userDocSnap = await userDocRef.get();

    if (!userDocSnap.exists) {
      console.error(`RENDERER_FIRESTORE: Documento do usuário ${uid} não encontrado.`);
      if (monitoringStatusDisplay) monitoringStatusDisplay.textContent = `Erro: Documento do usuário não encontrado.`;
      if (headerEmpresaNome) headerEmpresaNome.textContent = 'Empresa: Inválida';
      return;
    }

    empresaAtivaId = userDocSnap.data().empresaAtivaId;
    if (!empresaAtivaId) {
      console.error(`RENDERER_FIRESTORE: empresaAtivaId não encontrada para usuário ${uid}.`);
      if (monitoringStatusDisplay) monitoringStatusDisplay.textContent = `Erro: Empresa ativa não configurada.`;
      if (headerEmpresaNome) headerEmpresaNome.textContent = 'Empresa: Não Config.';
      return;
    }

    const empresaDocRef = fbDb.collection('empresas').doc(empresaAtivaId);
    const empresaDocSnap = await empresaDocRef.get();
    if (empresaDocSnap.exists) {
        nomeEmpresaAtiva = empresaDocSnap.data().nome || empresaAtivaId;
    } else {
        nomeEmpresaAtiva = empresaAtivaId; 
        console.warn(`RENDERER_FIRESTORE: Documento da empresa ${empresaAtivaId} não encontrado, usando ID como nome.`);
    }
    if (headerEmpresaNome) headerEmpresaNome.textContent = `${nomeEmpresaAtiva}`;
    if (monitoringStatusDisplay) monitoringStatusDisplay.textContent = `Monitorando projetos para ${nomeEmpresaAtiva}.`;

    const projetosShortsRef = fbDb.collection('empresas').doc(empresaAtivaId).collection('projetos_shorts');
    const q = projetosShortsRef.where("status", "==", "downloading");

    unsubscribeFirestoreListener = q.onSnapshot((querySnapshot) => {
        console.log(`RENDERER_FIRESTORE_SNAPSHOT: ${querySnapshot.docs.length} projetos com status 'downloading'.`);
        let newItemsAddedToQueue = false;
        querySnapshot.forEach((docSnapshot) => {
            const projetoData = docSnapshot.data();
            const projetoId = docSnapshot.id;

            const isAlreadyQueued = videoProcessingQueue.some(p => p.projetoId === projetoId);
            const currentProcessingItem = currentVideoProcessingDisplay.dataset.projetoId;
            const isCurrentlyBeingProcessed = currentProcessingItem === projetoId;

            if (!isAlreadyQueued && !isCurrentlyBeingProcessed) {
                console.log(`RENDERER_FIRESTORE: Adicionando projeto ${projetoId} à fila.`);
                videoProcessingQueue.push({
                    youtubeUrl: projetoData.youtubeUrl,
                    empresaId: empresaAtivaId,
                    projetoId: projetoId,
                    originalStatus: projetoData.status 
                });
                newItemsAddedToQueue = true;
            }
        });

        if (newItemsAddedToQueue) {
            updateVideoQueueUI();
        }
        processNextVideoInQueue(); 
        
        if (videoProcessingQueue.length === 0 && !isCurrentlyProcessingVideo) {
             if (monitoringStatusDisplay) monitoringStatusDisplay.textContent = `Aguardando projetos (${nomeEmpresaAtiva}).`;
        }

    }, (error) => {
      console.error(`RENDERER_FIRESTORE_SNAPSHOT: Erro no listener:`, error);
      if (monitoringStatusDisplay) monitoringStatusDisplay.textContent = `Erro ao monitorar Firestore: ${error.message}`;
    });

  } catch (error) {
    console.error(`RENDERER_FIRESTORE: Erro crítico ao configurar monitoramento:`, error);
    if (monitoringStatusDisplay) monitoringStatusDisplay.textContent = `Erro crítico no monitoramento: ${error.message}`;
    if (headerEmpresaNome) headerEmpresaNome.textContent = 'Empresa: Erro';
  }
}

function processNextVideoInQueue() {
    if (isCurrentlyProcessingVideo || videoProcessingQueue.length === 0) {
        if (videoProcessingQueue.length === 0 && !isCurrentlyProcessingVideo) {
            updateVideoQueueUI(); 
        }
        return;
    }

    isCurrentlyProcessingVideo = true;
    const projeto = videoProcessingQueue.shift(); 

    updateCurrentProcessingUI(projeto);
    updateVideoQueueUI();
    if (monitoringStatusDisplay) monitoringStatusDisplay.textContent = `Iniciando processamento: ${projeto.projetoId}...`;

    if (window.electronAPI && window.electronAPI.requestVideoProcessing) {
        window.electronAPI.requestVideoProcessing(projeto);
    } else {
        console.error("RENDERER: electronAPI.requestVideoProcessing não disponível!");
        if (monitoringStatusDisplay) monitoringStatusDisplay.textContent = `Falha ao iniciar ${projeto.projetoId}: API indisponível.`;
        videoProcessingQueue.unshift(projeto);
        isCurrentlyProcessingVideo = false;
        updateCurrentProcessingUI(null);
        updateVideoQueueUI();
    }
}

function handleVideoProcessingResult(result) {
    console.log('RENDERER: Resultado do processamento de vídeo recebido:', result);
    isCurrentlyProcessingVideo = false;
    const { empresaId, projetoId, success, error, minioPath } = result;

    updateCurrentProcessingUI(null); 

    if (success) {
      if (monitoringStatusDisplay) monitoringStatusDisplay.textContent = `Projeto ${projetoId} processado! Atualizando Firestore...`;
      try {
        if (!fbDb) {
            console.error("RENDERER: fbDb não inicializado ao tentar atualizar Firestore.");
            if (monitoringStatusDisplay) monitoringStatusDisplay.textContent = `Projeto ${projetoId}: Erro crítico - DB não pronto.`;
            return;
        }
        const projetoDocRef = fbDb.collection('empresas').doc(empresaId).collection('projetos_shorts').doc(projetoId);
        projetoDocRef.update({
          status: "downloaded", 
          minioPath: minioPath,
          processedAt: firebase.firestore.FieldValue.serverTimestamp(),
          errorMessage: firebase.firestore.FieldValue.delete() 
        }).then(() => {
            console.log(`RENDERER: Projeto ${projetoId} atualizado para 'downloaded'.`);
            if (monitoringStatusDisplay) monitoringStatusDisplay.textContent = `Projeto ${projetoId}: Sucesso!`;
        }).catch(dbError => {
            console.error(`RENDERER: Erro ao atualizar projeto ${projetoId} para 'downloaded':`, dbError);
            if (monitoringStatusDisplay) monitoringStatusDisplay.textContent = `Projeto ${projetoId}: Erro ao atualizar status pós-sucesso.`;
        });
      } catch (dbErrorOuter) { 
        console.error(`RENDERER: Erro síncrono ao tentar atualizar projeto ${projetoId}:`, dbErrorOuter);
      }
    } else {
      console.error(`RENDERER: Falha no processamento do projeto ${projetoId}:`, error);
      if (monitoringStatusDisplay) monitoringStatusDisplay.textContent = `Projeto ${projetoId}: Falha - ${error}. Atualizando Firestore...`;
      try {
        if (!fbDb) {
            console.error("RENDERER: fbDb não inicializado ao tentar atualizar Firestore.");
            if (monitoringStatusDisplay) monitoringStatusDisplay.textContent = `Projeto ${projetoId}: Erro crítico - DB não pronto.`;
            return;
        }
        const projetoDocRef = fbDb.collection('empresas').doc(empresaId).collection('projetos_shorts').doc(projetoId);
        projetoDocRef.update({
          status: "falha_processamento",
          errorMessage: String(error || 'Erro desconhecido'), 
          processedAt: firebase.firestore.FieldValue.serverTimestamp(),
        }).then(() => {
            console.log(`RENDERER: Projeto ${projetoId} atualizado para 'falha_processamento'.`);
        }).catch(dbError => {
            console.error(`RENDERER: Erro ao atualizar projeto ${projetoId} para 'falha_processamento':`, dbError);
        });
      } catch (dbErrorOuter) {
        console.error(`RENDERER: Erro síncrono ao tentar atualizar projeto ${projetoId} para falha:`, dbErrorOuter);
      }
    }
    processNextVideoInQueue(); 
}

function handleMonitoringStatusUpdate(statusMsg) {
    const currentProcessingItemDiv = document.getElementById('current-video-processing'); // pode ser currentVideoProcessingDisplay
    if (!currentProcessingItemDiv) return;

    const projetoIdMatch = statusMsg.match(/\[PROJETO (.*?)\]/);
    if (!projetoIdMatch) {
        if (!isCurrentlyProcessingVideo) {
            // if (monitoringStatusDisplay) monitoringStatusDisplay.textContent = statusMsg; 
        }
        return;
    }
    const projetoIdFromMsg = projetoIdMatch[1];
    const currentProcessedProjectId = currentVideoProcessingDisplay.dataset.projetoId;

    if (projetoIdFromMsg === currentProcessedProjectId) {
        const progressBar = currentVideoProcessingDisplay.querySelector(`#progress-bar-${projetoIdFromMsg}`);
        const progressText = currentVideoProcessingDisplay.querySelector(`#progress-text-${projetoIdFromMsg}`);

        if (progressBar && progressText) {
            const percentMatch = statusMsg.match(/Download: (\d+\.?\d*)%/);
            const downloadedMatch = statusMsg.match(/\(([\d.]+)MB \/ ([\d.]+)MB\)/);
            const downloadedOnlyMatch = statusMsg.match(/\(([\d.]+)MB baixados\)/);

            if (percentMatch && downloadedMatch) {
                const percent = parseFloat(percentMatch[1]);
                progressBar.style.width = `${percent}%`;
                progressText.textContent = `${percent.toFixed(0)}% (${downloadedMatch[1]}MB / ${downloadedMatch[2]}MB)`;
            } else if (downloadedOnlyMatch) {
                progressText.textContent = `(${downloadedOnlyMatch[1]}MB baixados)`;
            } else if (statusMsg.includes("Iniciando download...")) {
                 progressBar.style.width = `0%`;
                 progressText.textContent = "Iniciando download...";
            } else if (statusMsg.includes("Download concluído. Upload para Minio...")) { // Corrigido aqui (era "Iniciando upload para o Minio")
                 progressBar.style.width = `100%`; 
                 progressText.textContent = "Upload para Minio...";
            }
        }
    }
}

function updateVideoQueueUI() {
    if (!videoQueueListDisplay) return; // Checa se o elemento existe
    videoQueueListDisplay.innerHTML = ''; 
    if (queueCountSpan) queueCountSpan.textContent = videoProcessingQueue.length;

    if (videoProcessingQueue.length === 0) {
        videoQueueListDisplay.innerHTML = '<p class="text-slate-500 italic p-4 text-center">Nenhum vídeo na fila.</p>';
    } else {
        videoProcessingQueue.forEach(video => {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'p-3 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md shadow-sm transition-colors duration-150 animate-fadeIn';
            itemDiv.innerHTML = `
                <div class="flex justify-between items-center">
                    <span class="font-medium text-indigo-700 text-sm truncate pr-2" title="${video.projetoId}">ID: ${video.projetoId}</span>
                    <span class="text-xs text-slate-400 whitespace-nowrap">Aguardando</span>
                </div>
                <p class="text-xs text-slate-500 mt-1 truncate" title="${video.youtubeUrl}">
                    ${video.youtubeUrl}
                </p>
            `;
            videoQueueListDisplay.appendChild(itemDiv);
        });
    }
}

function updateCurrentProcessingUI(projeto) {
    if (!currentVideoProcessingDisplay) return; // Checa se o elemento existe
    currentVideoProcessingDisplay.innerHTML = ''; 
    if (projeto) {
        currentVideoProcessingDisplay.dataset.projetoId = projeto.projetoId; 
        const itemDiv = document.createElement('div');
        itemDiv.className = 'w-full p-3 bg-green-50 border border-green-200 rounded-lg shadow-sm animate-fadeIn';
        itemDiv.innerHTML = `
            <div class="flex items-center mb-2">
                <svg class="animate-spin h-5 w-5 text-green-600 mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span class="font-semibold text-green-700 text-sm truncate" title="${projeto.projetoId}">Processando ID: ${projeto.projetoId}</span>
            </div>
            <p class="text-xs text-green-500 truncate mb-2" title="${projeto.youtubeUrl}">${projeto.youtubeUrl}</p>
            <div class="w-full bg-slate-200 rounded-full h-2.5 dark:bg-slate-700">
                <div id="progress-bar-${projeto.projetoId}" class="bg-green-500 h-2.5 rounded-full transition-all duration-300 ease-linear" style="width: 0%"></div>
            </div>
            <p id="progress-text-${projeto.projetoId}" class="text-xs text-right text-green-600 mt-1">0%</p>
        `;
        currentVideoProcessingDisplay.appendChild(itemDiv);
    } else {
        currentVideoProcessingDisplay.removeAttribute('data-projeto-id');
        currentVideoProcessingDisplay.innerHTML = '<p class="text-slate-500 italic text-center">Nenhum vídeo sendo processado.</p>';
    }
}