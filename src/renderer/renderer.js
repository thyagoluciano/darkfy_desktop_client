// src/renderer/renderer.js
// Este script é carregado com <script type="module"> no index.html

import FirebaseService from '../services/firebaseService.js'; // Caminho para o serviço

let firebaseServiceInstance;
let appHeader, headerEmpresaNome, headerUserEmail, headerLogoutButton;
let userInfoDebug, monitoringStatusDisplay, queueCountSpan;
let videoQueueListDisplay, currentVideoProcessingDisplay;
let yearSpanMain, versionSpanMain;

let currentUID = null;
let empresaAtivaId = null;
let nomeEmpresaAtiva = 'N/A';
let unsubscribeFirestoreListener = null; // Armazena a função de cancelamento do listener
let cleanupVideoProcessingResultListener = null;
let cleanupMonitoringStatusListener = null;

let videoProcessingQueue = [];
let isCurrentlyProcessingVideo = false;

console.log('RENDERER (Dashboard) (ESM): renderer.js carregado.');

document.addEventListener('DOMContentLoaded', () => {
    appHeader = document.getElementById('app-header');
    headerEmpresaNome = document.getElementById('header-empresa-nome');
    headerUserEmail = document.getElementById('header-user-email');
    headerLogoutButton = document.getElementById('header-logout-button');
    userInfoDebug = document.getElementById('user-info');
    monitoringStatusDisplay = document.getElementById('monitoring-status');
    queueCountSpan = document.getElementById('queue-count');
    videoQueueListDisplay = document.getElementById('video-queue-list');
    currentVideoProcessingDisplay = document.getElementById('current-video-processing');
    yearSpanMain = document.getElementById('current-year-main');
    versionSpanMain = document.getElementById('app-version-main');

    // Adicionar folha de estilo para animações (se não estiver em um CSS global)
    // Esta parte pode ser removida se a CSP for ajustada e a classe .animate-fadeIn já estiver no output.css
    const styleSheet = document.createElement("style");
    styleSheet.type = "text/css";
    styleSheet.innerText = `@keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } } .animate-fadeIn { animation: fadeIn 0.3s ease-out forwards; }`;
    document.head.appendChild(styleSheet);
    
    initializeApp();
});

async function initializeApp() {
    if (!monitoringStatusDisplay) { 
        console.error("RENDERER (ESM): monitoringStatusDisplay é nulo ANTES de inicializar. DOM não pronto?");
        return;
    }

    if (yearSpanMain) yearSpanMain.textContent = new Date().getFullYear();
    
    if (window.electronAPI && window.electronAPI.getAppVersion) {
        try {
            const version = await window.electronAPI.getAppVersion();
            if (versionSpanMain) versionSpanMain.textContent = version;
        } catch (err) {
            console.error("RENDERER (ESM): Erro ao obter versão do app", err);
            if (versionSpanMain) versionSpanMain.textContent = "N/A";
        }
    } else {
        if (versionSpanMain) versionSpanMain.textContent = "N/A"; // Evitar undefined na UI
        console.warn("RENDERER (ESM): electronAPI.getAppVersion não disponível no preload.");
    }

    if (window.electronAPI && window.electronAPI.getFirebaseConfig) {
        try {
            // console.log("RENDERER (ESM): Solicitando configuração do Firebase do main process..."); // Verboso
            const firebaseConfigFromMain = await window.electronAPI.getFirebaseConfig();
            if (firebaseConfigFromMain && firebaseConfigFromMain.apiKey) {
                // console.log('RENDERER (ESM): Configuração do Firebase recebida.'); // Verboso
                firebaseServiceInstance = new FirebaseService(firebaseConfigFromMain);
                console.log('RENDERER (ESM): FirebaseService inicializado.');
                setupAuthListenerAndUI(); 
            } else {
                console.error('RENDERER (ESM): Configuração do Firebase NÃO recebida ou inválida do main process.', firebaseConfigFromMain);
                if (monitoringStatusDisplay) monitoringStatusDisplay.textContent = 'Erro crítico: Falha ao carregar configurações do servidor.';
            }
        } catch (error) {
            console.error('RENDERER (ESM): Erro ao obter config ou inicializar FirebaseService:', error);
            if (monitoringStatusDisplay) monitoringStatusDisplay.textContent = `Erro crítico: ${error.message || 'Falha nas configurações.'}`;
        }
    } else {
        console.error('RENDERER (ESM): electronAPI.getFirebaseConfig não está disponível.');
        if (monitoringStatusDisplay) monitoringStatusDisplay.textContent = 'Erro crítico: API de comunicação falhou.';
    }
}

function setupAuthListenerAndUI() {
    if (!firebaseServiceInstance) {
        console.error("RENDERER (ESM): FirebaseService não instanciado antes de setupAuthListenerAndUI.");
        if (monitoringStatusDisplay) monitoringStatusDisplay.textContent = 'Erro: Serviço de autenticação indisponível.';
        return;
    }

    if (!appHeader || !headerUserEmail || !headerEmpresaNome || !monitoringStatusDisplay || !headerLogoutButton) {
        console.error("RENDERER (ESM): Um ou mais elementos essenciais do DOM não foram encontrados em setupAuthListenerAndUI.");
        if(monitoringStatusDisplay) monitoringStatusDisplay.textContent = 'Erro: Falha ao carregar interface.';
        return;
    }

    firebaseServiceInstance.onAuthStateChanged(async (user) => {
      if (user) {
        currentUID = user.uid;
        // console.log(`RENDERER (ESM): Usuário logado: ${user.email} (UID: ${currentUID})`); // Verboso
        await setupUserSession(currentUID, user.email); 
      } else {
        console.log('RENDERER (ESM): Usuário deslogado.');
        currentUID = null;
        empresaAtivaId = null;
        nomeEmpresaAtiva = 'N/A';

        if (appHeader) appHeader.classList.add('hidden');
        
        if (unsubscribeFirestoreListener) {
          console.log('RENDERER (ESM): Cancelando listener do Firestore.');
          unsubscribeFirestoreListener(); // Chama a função de cleanup retornada pelo onSnapshot
          unsubscribeFirestoreListener = null;
        }
        if (cleanupVideoProcessingResultListener) {
            cleanupVideoProcessingResultListener(); // Chama a função de cleanup do preload
            cleanupVideoProcessingResultListener = null;
        }
        if (cleanupMonitoringStatusListener) {
            cleanupMonitoringStatusListener(); // Chama a função de cleanup do preload
            cleanupMonitoringStatusListener = null;
        }

        videoProcessingQueue = [];
        isCurrentlyProcessingVideo = false; // Resetar estado
        updateVideoQueueUI(); 
        updateCurrentProcessingUI(null);
        if (monitoringStatusDisplay) monitoringStatusDisplay.textContent = 'Deslogado. Redirecionando para login...';

        if (window.electronAPI && window.electronAPI.requestLogoutNavigation) {
            window.electronAPI.requestLogoutNavigation();
        } else {
            console.error('RENDERER (ESM): electronAPI.requestLogoutNavigation não está disponível.');
        }
      }
    });

    if (headerLogoutButton) {
      headerLogoutButton.addEventListener('click', async () => {
        try {
          if (monitoringStatusDisplay) monitoringStatusDisplay.textContent = "Saindo...";
          await firebaseServiceInstance.logout();
        } catch (error) {
          console.error('RENDERER (ESM): Erro no logout:', error);
          if (monitoringStatusDisplay) monitoringStatusDisplay.textContent = `Erro no logout: ${error.message}`;
        }
      });
    } else {
        console.warn("RENDERER (ESM): headerLogoutButton não encontrado no DOM.");
    }
}

async function setupUserSession(uid, userEmail) {
    if (!firebaseServiceInstance) {
        console.error("RENDERER (ESM): FirebaseService não instanciado antes de setupUserSession.");
        return;
    }

    // Configura UI básica do usuário
    if (appHeader) appHeader.classList.remove('hidden');
    if (headerUserEmail) headerUserEmail.textContent = userEmail;
    if (userInfoDebug) userInfoDebug.innerHTML = `UID: ${uid}<br>Email: ${userEmail}`;
    if (monitoringStatusDisplay) monitoringStatusDisplay.textContent = 'Obtendo informações da empresa...';
    if (headerEmpresaNome) headerEmpresaNome.textContent = 'Carregando...';

    // Configura listeners de IPC do preload
    if (window.electronAPI) {
        if (window.electronAPI.onVideoProcessingResult && !cleanupVideoProcessingResultListener) {
            cleanupVideoProcessingResultListener = window.electronAPI.onVideoProcessingResult(handleVideoProcessingResult);
        }
        if (window.electronAPI.onMonitoringStatusUpdate && !cleanupMonitoringStatusListener) {
            cleanupMonitoringStatusListener = window.electronAPI.onMonitoringStatusUpdate(handleMonitoringStatusUpdate);
        }
    } else {
        console.error("RENDERER (ESM): electronAPI não está disponível para registrar listeners IPC.");
        if (monitoringStatusDisplay) monitoringStatusDisplay.textContent = "Erro crítico: API de comunicação indisponível.";
        return; // Não prosseguir sem API
    }
    await setupFirestoreMonitoring(uid);
}

async function setupFirestoreMonitoring(uid) {
  if (!firebaseServiceInstance) {
    console.error("RENDERER_FIRESTORE (ESM): FirebaseService não instanciado.");
    if (monitoringStatusDisplay) monitoringStatusDisplay.textContent = `Erro: Serviço de banco de dados não pronto.`;
    return;
  }

  if (unsubscribeFirestoreListener) {
    console.log('RENDERER_FIRESTORE (ESM): Cancelando listener anterior do Firestore.');
    unsubscribeFirestoreListener();
    unsubscribeFirestoreListener = null;
  }

  try {
    const userDocSnap = await firebaseServiceInstance.getUserDocument(uid);

    if (!userDocSnap.exists) { // No SDK compat, é userDocSnap.exists (propriedade)
      console.error(`RENDERER_FIRESTORE (ESM): Documento do usuário ${uid} não encontrado.`);
      if (monitoringStatusDisplay) monitoringStatusDisplay.textContent = `Erro: Documento do usuário não encontrado.`;
      if (headerEmpresaNome) headerEmpresaNome.textContent = 'Empresa: Inválida';
      return;
    }
    const userData = userDocSnap.data();

    empresaAtivaId = userData.empresaAtivaId;
    if (!empresaAtivaId) {
      console.error(`RENDERER_FIRESTORE (ESM): empresaAtivaId não encontrada para usuário ${uid}.`);
      if (monitoringStatusDisplay) monitoringStatusDisplay.textContent = `Erro: Empresa ativa não configurada.`;
      if (headerEmpresaNome) headerEmpresaNome.textContent = 'Empresa: Não Config.';
      return;
    }

    const empresaDocSnap = await firebaseServiceInstance.getCompanyDocument(empresaAtivaId);
    if (empresaDocSnap.exists) { // Propriedade no SDK compat
        nomeEmpresaAtiva = empresaDocSnap.data().nome || empresaAtivaId;
    } else {
        nomeEmpresaAtiva = empresaAtivaId; 
        console.warn(`RENDERER_FIRESTORE (ESM): Documento da empresa ${empresaAtivaId} não encontrado, usando ID como nome.`);
    }
    if (headerEmpresaNome) headerEmpresaNome.textContent = `${nomeEmpresaAtiva}`;
    if (monitoringStatusDisplay) monitoringStatusDisplay.textContent = `Monitorando projetos para ${nomeEmpresaAtiva}.`;

    // O retorno de listenToDownloadingProjects é a função de unsubscribe
    unsubscribeFirestoreListener = firebaseServiceInstance.listenToDownloadingProjects(
        empresaAtivaId,
        (querySnapshot) => { // Success callback
            // console.log(`RENDERER_FIRESTORE_SNAPSHOT (ESM): ${querySnapshot.docs.length} projetos 'downloading'.`); // Verboso
            let newItemsAddedToQueue = false;
            querySnapshot.forEach((docSnapshot) => {
                const projetoData = docSnapshot.data();
                const projetoId = docSnapshot.id;

                const isAlreadyQueued = videoProcessingQueue.some(p => p.projetoId === projetoId);
                // currentVideoProcessingDisplay é global e atualizado por updateCurrentProcessingUI
                const currentProcessingProjectId = currentVideoProcessingDisplay ? currentVideoProcessingDisplay.dataset.projetoId : null;
                const isCurrentlyBeingProcessed = currentProcessingProjectId === projetoId;

                if (!isAlreadyQueued && !isCurrentlyBeingProcessed) {
                    console.log(`RENDERER_FIRESTORE (ESM): Adicionando projeto ${projetoId} à fila.`);
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
        }, 
        (error) => { // Error callback for the listener
            console.error(`RENDERER_FIRESTORE_SNAPSHOT (ESM): Erro no listener:`, error);
            if (monitoringStatusDisplay) monitoringStatusDisplay.textContent = `Erro ao monitorar Firestore: ${error.message}`;
        }
    );

  } catch (error) {
    console.error(`RENDERER_FIRESTORE (ESM): Erro crítico ao configurar monitoramento:`, error);
    if (monitoringStatusDisplay) monitoringStatusDisplay.textContent = `Erro crítico no monitoramento: ${error.message}`;
    if (headerEmpresaNome) headerEmpresaNome.textContent = 'Empresa: Erro';
  }
}

function processNextVideoInQueue() {
    if (isCurrentlyProcessingVideo || videoProcessingQueue.length === 0) {
        if (videoProcessingQueue.length === 0 && !isCurrentlyProcessingVideo && monitoringStatusDisplay) {
            // Apenas atualiza se não houver mensagem mais específica
            // if (!monitoringStatusDisplay.textContent.startsWith("Projeto")) {
            //     monitoringStatusDisplay.textContent = `Aguardando projetos (${nomeEmpresaAtiva}).`;
            // }
        }
        return;
    }

    isCurrentlyProcessingVideo = true;
    const projeto = videoProcessingQueue.shift(); 

    updateCurrentProcessingUI(projeto);
    updateVideoQueueUI(); // Atualiza a contagem da fila
    // if (monitoringStatusDisplay) monitoringStatusDisplay.textContent = `Iniciando processamento: ${projeto.projetoId}...`; // Mensagem do main é melhor

    if (window.electronAPI && window.electronAPI.requestVideoProcessing) {
        window.electronAPI.requestVideoProcessing(projeto);
    } else {
        console.error("RENDERER (ESM): electronAPI.requestVideoProcessing não disponível!");
        if (monitoringStatusDisplay) monitoringStatusDisplay.textContent = `Falha ao iniciar ${projeto.projetoId}: API indisponível.`;
        videoProcessingQueue.unshift(projeto); // Devolve para a fila
        isCurrentlyProcessingVideo = false;
        updateCurrentProcessingUI(null);
        updateVideoQueueUI();
    }
}

function handleVideoProcessingResult(result) {
    // console.log('RENDERER (ESM): Resultado do processamento de vídeo recebido:', result); // Verboso
    if (!firebaseServiceInstance) {
        console.error("RENDERER (ESM) (handleVideoProcessingResult): FirebaseService não instanciado.");
        isCurrentlyProcessingVideo = false;
        updateCurrentProcessingUI(null);
        if (monitoringStatusDisplay && result.projetoId) monitoringStatusDisplay.textContent = `Projeto ${result.projetoId}: Falha crítica - serviço DB indisponível.`;
        processNextVideoInQueue(); // Tenta o próximo, mas o atual não será atualizado no DB
        return;
    }

    isCurrentlyProcessingVideo = false;
    const { empresaId, projetoId, success, error: processError, minioPath } = result;

    updateCurrentProcessingUI(null); // Limpa a UI do item em processamento

    const statusUpdate = success ? 
        { status: "downloaded", minioPath: minioPath, errorMessage: null } : // Passa null para que seja deletado
        { status: "falha_processamento", errorMessage: processError || 'Erro desconhecido no processamento' };
    
    const logAction = success ? "'downloaded'" : "'falha_processamento'";
    const friendlyStatusMsg = success ? "Sucesso!" : `Falha - ${String(statusUpdate.errorMessage || '').substring(0, 50)}...`;

    if (monitoringStatusDisplay) monitoringStatusDisplay.textContent = `Projeto ${projetoId}: ${friendlyStatusMsg} Atualizando Firestore...`;

    firebaseServiceInstance.updateProjectShortStatus(empresaId, projetoId, statusUpdate)
    .then(() => {
        console.log(`RENDERER (ESM): Projeto ${projetoId} atualizado para ${logAction}.`);
        if (monitoringStatusDisplay) monitoringStatusDisplay.textContent = `Projeto ${projetoId}: ${friendlyStatusMsg}`;
    }).catch(dbError => {
        console.error(`RENDERER (ESM): Erro ao atualizar projeto ${projetoId} para ${logAction}:`, dbError);
        if (monitoringStatusDisplay) monitoringStatusDisplay.textContent = `Projeto ${projetoId}: Erro ao atualizar status no DB (${friendlyStatusMsg}).`;
    }).finally(() => {
        processNextVideoInQueue(); // Chama o próximo independentemente do resultado do update no DB
    });
}

function handleMonitoringStatusUpdate(statusMsg) {
    const currentProcessingItemDiv = document.getElementById('current-video-processing');
    if (!currentProcessingItemDiv) return;

    const projetoIdMatch = statusMsg.match(/\[PROJETO (.*?)\]/);
    // Se a mensagem não for de um projeto específico, atualiza o status geral se nada estiver processando
    if (!projetoIdMatch) {
        if (!isCurrentlyProcessingVideo && monitoringStatusDisplay) {
            // Evita sobrescrever mensagens de erro ou sucesso de processamento de vídeo
            if (!monitoringStatusDisplay.textContent.includes("Sucesso!") && !monitoringStatusDisplay.textContent.includes("Falha -")) {
                 monitoringStatusDisplay.textContent = statusMsg;
            }
        }
        return;
    }
    const projetoIdFromMsg = projetoIdMatch[1];
    const currentProcessedProjectId = currentProcessingItemDiv.dataset.projetoId;

    if (projetoIdFromMsg === currentProcessedProjectId) { // A mensagem é para o vídeo atual
        const progressBar = currentProcessingItemDiv.querySelector(`#progress-bar-${projetoIdFromMsg}`);
        const progressText = currentProcessingItemDiv.querySelector(`#progress-text-${projetoIdFromMsg}`);

        if (progressBar && progressText) {
            const percentMatch = statusMsg.match(/Download: (\d+\.?\d*)%/);
            const downloadedMatch = statusMsg.match(/\(([\d.]+)MB \/ ([\d.]+)MB\)/);
            const downloadedOnlyMatch = statusMsg.match(/\(([\d.]+)MB baixados\)/);

            if (percentMatch && downloadedMatch) {
                const percent = parseFloat(percentMatch[1]);
                progressBar.style.width = `${percent}%`;
                progressText.textContent = `${percent.toFixed(0)}% (${downloadedMatch[1]}MB / ${downloadedMatch[2]}MB)`;
            } else if (downloadedOnlyMatch) { // Progresso sem total
                progressText.textContent = `(${downloadedOnlyMatch[1]}MB baixados)`;
                 progressBar.style.width = `100%`; // Ou um estilo diferente para progresso indeterminado
                 progressBar.classList.add('bg-blue-500'); // Exemplo: cor diferente
                 progressBar.classList.remove('bg-green-500');
            } else if (statusMsg.includes("Iniciando download...")) {
                 progressBar.style.width = `0%`;
                 progressText.textContent = "Iniciando download...";
                 progressBar.classList.add('bg-green-500');
                 progressBar.classList.remove('bg-blue-500');
            } else if (statusMsg.includes("Download concluído. Upload para Minio...")) {
                 progressBar.style.width = `100%`; 
                 progressText.textContent = "Upload para Minio...";
                 progressBar.classList.add('bg-green-500');
                 progressBar.classList.remove('bg-blue-500');
            }
        }
    } else if (isCurrentlyProcessingVideo && monitoringStatusDisplay) {
        // A mensagem é de um projeto, mas não o que está "em processamento"
        // Pode ser útil logar isso, mas não necessariamente mudar o status principal da UI
        // console.log(`RENDERER (ESM): Status recebido para ${projetoIdFromMsg}, mas ${currentProcessedProjectId} está processando.`);
    } else if (!isCurrentlyProcessingVideo && monitoringStatusDisplay) {
        // Mensagem de projeto, mas nada processando (pode ser uma mensagem de erro do main não relacionada a um item específico)
         monitoringStatusDisplay.textContent = statusMsg;
    }
}

function updateVideoQueueUI() {
    if (!videoQueueListDisplay) return;
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
                    ${video.youtubeUrl.substring(0,60)}${video.youtubeUrl.length > 60 ? '...' : ''}
                </p>
            `;
            videoQueueListDisplay.appendChild(itemDiv);
        });
    }
}

function updateCurrentProcessingUI(projeto) {
    if (!currentVideoProcessingDisplay) return;
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
            <p class="text-xs text-green-500 truncate mb-2" title="${projeto.youtubeUrl}">${projeto.youtubeUrl.substring(0,60)}${projeto.youtubeUrl.length > 60 ? '...' : ''}</p>
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