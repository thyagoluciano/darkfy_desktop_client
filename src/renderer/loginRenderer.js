// src/renderer/loginRenderer.js
// Firebase Global (será inicializado após obter a config)
let fbApp;
let fbAuth;

// DECLARE as variáveis dos elementos da UI aqui, mas NÃO as atribua ainda.
let loginForm, emailInput, passwordInput, loginButton, loginStatus, yearSpan, versionSpan;

console.log('LOGIN_RENDERER: loginRenderer.js carregado.');

// --- Listener para quando o DOM estiver pronto ---
document.addEventListener('DOMContentLoaded', () => {
    // AGORA que o DOM está pronto, podemos buscar os elementos
    loginForm = document.getElementById('login-form');
    emailInput = document.getElementById('email');
    passwordInput = document.getElementById('password');
    loginButton = document.getElementById('login-button');
    loginStatus = document.getElementById('login-status');
    yearSpan = document.getElementById('current-year');
    versionSpan = document.getElementById('app-version');

    // Iniciar a aplicação APÓS o DOM estar pronto e elementos referenciados
    initializeApp();
});

// Função para inicializar Firebase e configurar listeners
async function initializeApp() {
    if (!loginStatus || !loginButton || !loginForm || !emailInput || !passwordInput ) { 
        console.error("LOGIN_RENDERER: Elementos do DOM essenciais não encontrados. DOM não pronto?");
        if(loginStatus) loginStatus.textContent = "Erro ao carregar a página. Tente recarregar.";
        return;
    }

    if (yearSpan) {
        yearSpan.textContent = new Date().getFullYear();
    }

    if (window.electronAPI && window.electronAPI.getAppVersion) {
        try {
            const version = await window.electronAPI.getAppVersion();
            if (versionSpan) versionSpan.textContent = version;
        } catch (err) {
            console.error("LOGIN_RENDERER: Erro ao obter versão do app", err);
            if (versionSpan) versionSpan.textContent = "N/A";
        }
    } else {
        console.warn("LOGIN_RENDERER: electronAPI.getAppVersion não disponível no preload.");
        if (versionSpan) versionSpan.textContent = "N/A";
    }

    if (window.electronAPI && window.electronAPI.getFirebaseConfig) {
        try {
            const firebaseConfigFromMain = await window.electronAPI.getFirebaseConfig();
            if (firebaseConfigFromMain) {
                fbApp = firebase.initializeApp(firebaseConfigFromMain);
                fbAuth = firebase.auth();
                console.log('LOGIN_RENDERER: Firebase inicializado com configuração do main process.');
                setupEventListeners(); 
            } else {
                console.error('LOGIN_RENDERER: Configuração do Firebase não recebida do main process.');
                if (loginStatus) loginStatus.textContent = 'Erro crítico: Falha ao carregar configurações.';
                if (loginButton) loginButton.disabled = true;
            }
        } catch (error) {
            console.error('LOGIN_RENDERER: Erro ao obter ou inicializar Firebase:', error);
            if (loginStatus) loginStatus.textContent = 'Erro crítico: Falha nas configurações.';
            if (loginButton) loginButton.disabled = true;
        }
    } else {
        console.error('LOGIN_RENDERER: electronAPI.getFirebaseConfig não está disponível.');
        if (loginStatus) loginStatus.textContent = 'Erro crítico: API de comunicação falhou.';
        if (loginButton) loginButton.disabled = true;
    }
}

// Função para configurar os listeners de eventos
function setupEventListeners() {
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!fbAuth) { 
                if (loginStatus) loginStatus.textContent = 'Firebase não inicializado. Tente recarregar.';
                return;
            }
            if (loginStatus) loginStatus.textContent = 'Autenticando...';
            if (loginButton) loginButton.disabled = true;

            try {
                await fbAuth.signInWithEmailAndPassword(emailInput.value, passwordInput.value);
                console.log('LOGIN_RENDERER: Login bem-sucedido.');
                if (loginStatus) loginStatus.textContent = 'Login bem-sucedido! Redirecionando...';
                
                if (window.electronAPI && window.electronAPI.notifyLoginSuccess) {
                    window.electronAPI.notifyLoginSuccess();
                } else {
                    if (loginStatus) loginStatus.textContent = 'Erro: API de comunicação não encontrada.';
                    console.error('LOGIN_RENDERER: electronAPI.notifyLoginSuccess não está disponível.');
                    if (loginButton) loginButton.disabled = false;
                }
            } catch (error) {
                let friendlyErrorMessage = "Ocorreu um erro no login.";
                if (error.code === 'auth/invalid-credential' || error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
                    friendlyErrorMessage = "Email ou senha inválidos. Verifique suas credenciais.";
                } else if (error.code === 'auth/invalid-email') {
                    friendlyErrorMessage = "O formato do email é inválido.";
                } else if (error.code === 'auth/network-request-failed') {
                    friendlyErrorMessage = "Erro de rede. Verifique sua conexão com a internet.";
                }
                if (loginStatus) loginStatus.textContent = friendlyErrorMessage;
                console.error('LOGIN_RENDERER: Erro no login:', error.code, error.message);
                if (loginButton) loginButton.disabled = false;
            }
        });
    } else {
        console.error("LOGIN_RENDERER: Formulário de login não encontrado no DOM.");
    }

    if (fbAuth) {
        fbAuth.onAuthStateChanged(user => {
            if (user) {
                console.log('LOGIN_RENDERER: Usuário já está logado (sessão persistida), notificando main process.');
                if (loginStatus) loginStatus.textContent = 'Sessão ativa encontrada. Redirecionando...';
                if (loginForm) loginForm.style.display = 'none'; 

                setTimeout(() => {
                    if (window.electronAPI && window.electronAPI.notifyLoginSuccess) {
                        window.electronAPI.notifyLoginSuccess();
                    } else {
                         console.error('LOGIN_RENDERER (onAuthStateChanged): electronAPI.notifyLoginSuccess não está disponível.');
                         if(loginStatus) loginStatus.textContent = "Erro ao redirecionar automaticamente."
                    }
                }, 1000); 
            } else {
                console.log('LOGIN_RENDERER: Nenhum usuário logado, aguardando credenciais.');
            }
        });
    }
}