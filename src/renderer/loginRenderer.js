// src/renderer/loginRenderer.js
import firebaseConfig from '../firebaseConfig.js'; // Certifique-se que o caminho está correto

// Firebase Global (dos scripts -compat.js no HTML)
const fbApp = firebase.initializeApp(firebaseConfig);
const fbAuth = firebase.auth();

// Elementos da UI
const loginForm = document.getElementById('login-form');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const loginButton = document.getElementById('login-button');
const loginStatus = document.getElementById('login-status');
const yearSpan = document.getElementById('current-year');
const versionSpan = document.getElementById('app-version');

console.log('LOGIN_RENDERER: loginRenderer.js carregado.');

if (yearSpan) {
    yearSpan.textContent = new Date().getFullYear();
}

// Solicitar versão do app ao processo principal
if (window.electronAPI && window.electronAPI.getAppVersion) {
    window.electronAPI.getAppVersion().then(version => {
        if (versionSpan) versionSpan.textContent = version;
    }).catch(err => {
        console.error("LOGIN_RENDERER: Erro ao obter versão do app", err);
        if (versionSpan) versionSpan.textContent = "N/A";
    });
} else {
    console.warn("LOGIN_RENDERER: electronAPI.getAppVersion não disponível no preload.");
    if (versionSpan) versionSpan.textContent = "N/A";
}


if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        loginStatus.textContent = 'Autenticando...';
        loginButton.disabled = true; // A estilização do disabled vem do Tailwind

        try {
            await fbAuth.signInWithEmailAndPassword(emailInput.value, passwordInput.value);
            console.log('LOGIN_RENDERER: Login bem-sucedido.');
            loginStatus.textContent = 'Login bem-sucedido! Redirecionando...';
            
            if (window.electronAPI && window.electronAPI.notifyLoginSuccess) {
                window.electronAPI.notifyLoginSuccess();
            } else {
                loginStatus.textContent = 'Erro: API de comunicação não encontrada.';
                console.error('LOGIN_RENDERER: electronAPI.notifyLoginSuccess não está disponível.');
                loginButton.disabled = false;
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
            loginStatus.textContent = friendlyErrorMessage;
            console.error('LOGIN_RENDERER: Erro no login:', error.code, error.message);
            loginButton.disabled = false;
        }
    });
} else {
    console.error("LOGIN_RENDERER: Formulário de login não encontrado no DOM.");
}

// Opcional: Verificar se já existe um usuário logado ao carregar a página de login
// Isso pode acontecer se o app foi fechado e reaberto e a sessão do Firebase persistiu.
fbAuth.onAuthStateChanged(user => {
    if (user) {
        console.log('LOGIN_RENDERER: Usuário já está logado (sessão persistida), notificando main process.');
        if (loginStatus) loginStatus.textContent = 'Sessão ativa encontrada. Redirecionando...';
        if (loginForm) loginForm.style.display = 'none'; // Esconde o formulário para evitar interação

        // Adiciona um pequeno delay para que a mensagem seja visível antes do redirecionamento
        setTimeout(() => {
            if (window.electronAPI && window.electronAPI.notifyLoginSuccess) {
                window.electronAPI.notifyLoginSuccess();
            } else {
                 console.error('LOGIN_RENDERER (onAuthStateChanged): electronAPI.notifyLoginSuccess não está disponível.');
                 if(loginStatus) loginStatus.textContent = "Erro ao redirecionar automaticamente."
            }
        }, 1000); // 1 segundo de delay
    } else {
        console.log('LOGIN_RENDERER: Nenhum usuário logado, aguardando credenciais.');
    }
});