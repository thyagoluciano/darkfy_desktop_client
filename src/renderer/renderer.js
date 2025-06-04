// src/renderer/renderer.js
import firebaseConfig from '../firebaseConfig.js'; // Certifique-se que o caminho está correto

// Firebase Global (dos scripts -compat.js no HTML)
const fbApp = firebase.initializeApp(firebaseConfig);
const fbAuth = firebase.auth();
const fbDb = firebase.firestore();

// Elementos da UI
const appHeader = document.getElementById('app-header');
const headerEmpresaNome = document.getElementById('header-empresa-nome');
const headerUserEmail = document.getElementById('header-user-email');
const headerLogoutButton = document.getElementById('header-logout-button');

const userInfoDebug = document.getElementById('user-info'); // Para debug
const monitoringStatusDisplay = document.getElementById('monitoring-status');
const queueCountSpan = document.getElementById('queue-count');

// const dashboardSection = document.getElementById('dashboard-section'); // Pode não ser mais necessário se os filhos são referenciados diretamente
const videoQueueListDisplay = document.getElementById('video-queue-list');
const currentVideoProcessingDisplay = document.getElementById('current-video-processing');

const yearSpanMain = document.getElementById('current-year-main');
const versionSpanMain = document.getElementById('app-version-main');

let currentUID = null;
let empresaAtivaId = null;
let nomeEmpresaAtiva = 'N/A';
let unsubscribeFirestoreListener = null;
let cleanupVideoProcessingResultListener = null; // Para limpar o listener IPC
let cleanupMonitoringStatusListener = null;    // Para limpar o listener IPC

// Fila de Processamento
let videoProcessingQueue = [];
let isCurrentlyProcessingVideo = false;

console.log('RENDERER (Dashboard): renderer.js carregado.');

// --- Inicialização da UI (Footer, etc.) ---
if (yearSpanMain) {
    yearSpanMain.textContent = new Date().getFullYear();
}
if (window.electronAPI && window.electronAPI.getAppVersion) {
    window.electronAPI.getAppVersion().then(version => {
        if (versionSpanMain) versionSpanMain.textContent = version;
    }).catch(err => {
        console.error("RENDERER: Erro ao obter versão do app", err);
        if (versionSpanMain) versionSpanMain.textContent = "N/A";
    });
} else {
    console.warn("RENDERER: electronAPI.getAppVersion não disponível no preload.");
    if (versionSpanMain) versionSpanMain.textContent = "N/A";
}

// --- Lógica de Autenticação e Controle da UI ---
fbAuth.onAuthStateChanged(async (user) => {
  if (user) {
    currentUID = user.uid;
    console.log(`RENDERER: Usuário logado: ${user.email} (UID: ${currentUID})`);
    
    appHeader.classList.remove('hidden'); // Mostrar header
    // appHeader.classList.add('flex'); // Tailwind 'flex' já deve estar no HTML ou não ser necessário dependendo do CSS
    
    headerUserEmail.textContent = user.email;
    if (userInfoDebug) userInfoDebug.innerHTML = `UID: ${currentUID}<br>Email: ${user.email}`;

    monitoringStatusDisplay.textContent = 'Obtendo informações da empresa...';
    headerEmpresaNome.textContent = 'Carregando...';

    await setupUserSession(currentUID); // Configura Firestore e listeners IPC
  } else {
    console.log('RENDERER: Usuário deslogado.');
    currentUID = null;
    empresaAtivaId = null;
    nomeEmpresaAtiva = 'N/A';

    appHeader.classList.add('hidden');
    
    // Limpar listeners
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

    // Limpar UI da dashboard
    videoProcessingQueue = []; // Limpa a fila de processamento interno
    updateVideoQueueUI();
    updateCurrentProcessingUI(null);
    monitoringStatusDisplay.textContent = 'Deslogado. Redirecionando para login...';

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
      monitoringStatusDisplay.textContent = "Saindo...";
      await fbAuth.signOut();
      // onAuthStateChanged cuidará do resto
    } catch (error) {
      console.error('RENDERER: Erro no logout:', error);
      monitoringStatusDisplay.textContent = `Erro no logout: ${error.message}`;
    }
  });
}

async function setupUserSession(uid) {
    // Configurar listeners IPC primeiro
    if (window.electronAPI) {
        if (window.electronAPI.onVideoProcessingResult && !cleanupVideoProcessingResultListener) {
            cleanupVideoProcessingResultListener = window.electronAPI.onVideoProcessingResult(handleVideoProcessingResult);
        }
        if (window.electronAPI.onMonitoringStatusUpdate && !cleanupMonitoringStatusListener) {
            cleanupMonitoringStatusListener = window.electronAPI.onMonitoringStatusUpdate(handleMonitoringStatusUpdate);
        }
    } else {
        console.error("RENDERER: electronAPI não está disponível para registrar listeners IPC.");
        monitoringStatusDisplay.textContent = "Erro crítico: API de comunicação indisponível.";
        return;
    }

    // Configurar monitoramento do Firestore
    await setupFirestoreMonitoring(uid);
}


// --- Funções do Firestore ---
async function setupFirestoreMonitoring(uid) {
  if (unsubscribeFirestoreListener) {
    console.log('RENDERER_FIRESTORE: Cancelando listener anterior do Firestore.');
    unsubscribeFirestoreListener();
    unsubscribeFirestoreListener = null;
  }

  try {
    const userDocRef = fbDb.collection('usuarios').doc(uid);
    const userDocSnap = await userDocRef.get();

    if (!userDocSnap.exists) {
      console.error(`RENDERER_FIRESTORE: Documento do usuário ${uid} não encontrado.`);
      monitoringStatusDisplay.textContent = `Erro: Documento do usuário não encontrado.`;
      headerEmpresaNome.textContent = 'Empresa: Inválida';
      return;
    }

    empresaAtivaId = userDocSnap.data().empresaAtivaId;
    if (!empresaAtivaId) {
      console.error(`RENDERER_FIRESTORE: empresaAtivaId não encontrada para usuário ${uid}.`);
      monitoringStatusDisplay.textContent = `Erro: Empresa ativa não configurada.`;
      headerEmpresaNome.textContent = 'Empresa: Não Config.';
      return;
    }

    const empresaDocRef = fbDb.collection('empresas').doc(empresaAtivaId);
    const empresaDocSnap = await empresaDocRef.get();
    if (empresaDocSnap.exists) {
        nomeEmpresaAtiva = empresaDocSnap.data().nome || empresaAtivaId; // Usa o nome, ou o ID se o nome não existir
    } else {
        nomeEmpresaAtiva = empresaAtivaId; // Fallback para ID se doc não existir
        console.warn(`RENDERER_FIRESTORE: Documento da empresa ${empresaAtivaId} não encontrado, usando ID como nome.`);
    }
    headerEmpresaNome.textContent = `${nomeEmpresaAtiva}`; // Simplificado
    monitoringStatusDisplay.textContent = `Monitorando projetos para ${nomeEmpresaAtiva}.`;

    const projetosShortsRef = fbDb.collection('empresas').doc(empresaAtivaId).collection('projetos_shorts');
    const q = projetosShortsRef.where("status", "==", "download");

    unsubscribeFirestoreListener = q.onSnapshot((querySnapshot) => {
        console.log(`RENDERER_FIRESTORE_SNAPSHOT: ${querySnapshot.docs.length} projetos com status 'download'.`);
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
                    originalStatus: projetoData.status // Pode ser útil para o main saber
                });
                newItemsAddedToQueue = true;
            }
        });

        if (newItemsAddedToQueue) {
            updateVideoQueueUI();
        }
        processNextVideoInQueue(); // Tenta processar o próximo
        
        if (videoProcessingQueue.length === 0 && !isCurrentlyProcessingVideo) {
             monitoringStatusDisplay.textContent = `Aguardando projetos (${nomeEmpresaAtiva}).`;
        }

    }, (error) => {
      console.error(`RENDERER_FIRESTORE_SNAPSHOT: Erro no listener:`, error);
      monitoringStatusDisplay.textContent = `Erro ao monitorar Firestore: ${error.message}`;
    });

  } catch (error) {
    console.error(`RENDERER_FIRESTORE: Erro crítico ao configurar monitoramento:`, error);
    monitoringStatusDisplay.textContent = `Erro crítico no monitoramento: ${error.message}`;
    headerEmpresaNome.textContent = 'Empresa: Erro';
  }
}

// --- Lógica da Fila e Processamento ---
function processNextVideoInQueue() {
    if (isCurrentlyProcessingVideo || videoProcessingQueue.length === 0) {
        if (videoProcessingQueue.length === 0 && !isCurrentlyProcessingVideo) {
            updateVideoQueueUI(); // Garante que a UI da fila seja atualizada (ex: mostra "nenhum item")
        }
        return;
    }

    isCurrentlyProcessingVideo = true;
    const projeto = videoProcessingQueue.shift(); // Pega o primeiro da fila

    updateCurrentProcessingUI(projeto);
    updateVideoQueueUI();
    monitoringStatusDisplay.textContent = `Iniciando processamento: ${projeto.projetoId}...`;

    if (window.electronAPI && window.electronAPI.requestVideoProcessing) {
        window.electronAPI.requestVideoProcessing(projeto);
    } else {
        console.error("RENDERER: electronAPI.requestVideoProcessing não disponível!");
        monitoringStatusDisplay.textContent = `Falha ao iniciar ${projeto.projetoId}: API indisponível.`;
        // Devolver o item para a fila em caso de falha de comunicação com o main
        videoProcessingQueue.unshift(projeto);
        isCurrentlyProcessingVideo = false;
        updateCurrentProcessingUI(null);
        updateVideoQueueUI();
    }
}

// --- Manipulação de Resultados e Status do Main Process ---
function handleVideoProcessingResult(result) {
    console.log('RENDERER: Resultado do processamento de vídeo recebido:', result);
    isCurrentlyProcessingVideo = false;
    const { empresaId, projetoId, success, error, minioPath } = result;

    updateCurrentProcessingUI(null); // Limpa o display de "em processamento"

    if (success) {
      monitoringStatusDisplay.textContent = `Projeto ${projetoId} processado! Atualizando Firestore...`;
      try {
        const projetoDocRef = fbDb.collection('empresas').doc(empresaId).collection('projetos_shorts').doc(projetoId);
        projetoDocRef.update({
          status: "downloaded", // Ou o status final desejado
          minioPath: minioPath,
          processedAt: firebase.firestore.FieldValue.serverTimestamp(),
          errorMessage: firebase.firestore.FieldValue.delete() // Limpa erro anterior
        }).then(() => {
            console.log(`RENDERER: Projeto ${projetoId} atualizado para 'downloaded'.`);
            monitoringStatusDisplay.textContent = `Projeto ${projetoId}: Sucesso!`;
        }).catch(dbError => {
            console.error(`RENDERER: Erro ao atualizar projeto ${projetoId} para 'downloaded':`, dbError);
            monitoringStatusDisplay.textContent = `Projeto ${projetoId}: Erro ao atualizar status pós-sucesso.`;
        });
      } catch (dbErrorOuter) { // catch para erro síncrono se houver
        console.error(`RENDERER: Erro síncrono ao tentar atualizar projeto ${projetoId}:`, dbErrorOuter);
      }
    } else {
      console.error(`RENDERER: Falha no processamento do projeto ${projetoId}:`, error);
      monitoringStatusDisplay.textContent = `Projeto ${projetoId}: Falha - ${error}. Atualizando Firestore...`;
      try {
        const projetoDocRef = fbDb.collection('empresas').doc(empresaId).collection('projetos_shorts').doc(projetoId);
        projetoDocRef.update({
          status: "falha_processamento",
          errorMessage: String(error || 'Erro desconhecido'), // Garante que é uma string
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
    processNextVideoInQueue(); // Tenta processar o próximo da fila
}

function handleMonitoringStatusUpdate(statusMsg) {
    // console.log('RENDERER (Status Update):', statusMsg);
    const currentProcessingItemDiv = document.getElementById('current-video-processing');
    if (!currentProcessingItemDiv) return;

    const projetoIdMatch = statusMsg.match(/\[PROJETO (.*?)\]/);
    if (!projetoIdMatch) {
        // Se não for uma mensagem de projeto e nada estiver processando, pode atualizar status geral
        if (!isCurrentlyProcessingVideo) {
            // monitoringStatusDisplay.textContent = statusMsg; // Cuidado com verbosidade
        }
        return;
    }
    const projetoIdFromMsg = projetoIdMatch[1];
    const currentProcessedProjectId = currentVideoProcessingDisplay.dataset.projetoId;

    // Só atualiza progresso se for do vídeo atualmente em processamento
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
            } else if (statusMsg.includes("Download concluído. Iniciando upload para o Minio...")) {
                 progressBar.style.width = `100%`; // Assume 100% do download
                 progressText.textContent = "Upload para Minio...";
            }
        }
    }
}


// --- Funções de Atualização da UI da Fila e Processamento ---
function updateVideoQueueUI() {
    videoQueueListDisplay.innerHTML = ''; // Limpa a lista atual
    if (queueCountSpan) queueCountSpan.textContent = videoProcessingQueue.length;

    if (videoProcessingQueue.length === 0) {
        videoQueueListDisplay.innerHTML = '<p class="text-slate-500 italic p-4 text-center">Nenhum vídeo na fila.</p>';
    } else {
        videoProcessingQueue.forEach(video => {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'p-3 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md shadow-sm transition-colors duration-150 animate-fadeIn'; // Efeito de fade-in
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
    currentVideoProcessingDisplay.innerHTML = ''; // Limpa
    if (projeto) {
        currentVideoProcessingDisplay.dataset.projetoId = projeto.projetoId; // Guarda o ID para referência
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

// Adicionar uma folha de estilo para animações simples se Tailwind não cobrir diretamente
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