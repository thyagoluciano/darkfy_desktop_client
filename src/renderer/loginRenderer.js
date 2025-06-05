// src/renderer/loginRenderer.js
// Este script é carregado com <script type="module"> no login.html

import FirebaseService from '../services/firebaseService.js'; // Caminho para o serviço

let firebaseServiceInstance;
let loginForm, emailInput, passwordInput, loginButton, loginStatus, yearSpan, versionSpan;

console.log('LOGIN_RENDERER (ESM): loginRenderer.js carregado.');

document.addEventListener('DOMContentLoaded', () => {
    loginForm = document.getElementById('login-form');
    emailInput = document.getElementById('email');
    passwordInput = document.getElementById('password');
    loginButton = document.getElementById('login-button');
    loginStatus = document.getElementById('login-status');
    yearSpan = document.getElementById('current-year');
    versionSpan = document.getElementById('app-version');

    initializeApp();
});

async function initializeApp() {
    if (!loginStatus || !loginButton || !loginForm || !emailInput || !passwordInput ) { 
        console.error("LOGIN_RENDERER (ESM): Elementos do DOM essenciais não encontrados.");
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
            console.error("LOGIN_RENDERER (ESM): Erro ao obter versão do app", err);
            if (versionSpan) versionSpan.textContent = "N/A";
        }
    } else {
        console.warn("LOGIN_RENDERER (ESM): electronAPI.getAppVersion não disponível no preload.");
        if (versionSpan) versionSpan.textContent = "N/A";
    }

    if (window.electronAPI && window.electronAPI.getFirebaseConfig) {
        try {
            // console.log("LOGIN_RENDERER (ESM): Solicitando configuração do Firebase do main process..."); // Verboso
            const firebaseConfigFromMain = await window.electronAPI.getFirebaseConfig();
            
            if (firebaseConfigFromMain && firebaseConfigFromMain.apiKey) {
                // console.log('LOGIN_RENDERER (ESM): Configuração do Firebase recebida.'); // Verboso
                firebaseServiceInstance = new FirebaseService(firebaseConfigFromMain);
                console.log('LOGIN_RENDERER (ESM): FirebaseService inicializado.');
                setupEventListeners(); 
            } else {
                console.error('LOGIN_RENDERER (ESM): Configuração do Firebase NÃO recebida ou inválida do main process.', firebaseConfigFromMain);
                if (loginStatus) loginStatus.textContent = 'Erro crítico: Falha nas configurações do servidor.';
                if (loginButton) loginButton.disabled = true;
            }
        } catch (error) {
            console.error('LOGIN_RENDERER (ESM): Erro ao obter config ou inicializar FirebaseService:', error);
            if (loginStatus) loginStatus.textContent = `Erro crítico: ${error.message || 'Falha nas configurações.'}`;
            if (loginButton) loginButton.disabled = true;
        }
    } else {
        console.error('LOGIN_RENDERER (ESM): electronAPI.getFirebaseConfig não está disponível.');
        if (loginStatus) loginStatus.textContent = 'Erro crítico: API de comunicação falhou.';
        if (loginButton) loginButton.disabled = true;
    }
}

function setupEventListeners() {
    if (!firebaseServiceInstance) {
        console.error("LOGIN_RENDERER (ESM): FirebaseService não instanciado antes de setupEventListeners.");
        if (loginStatus) loginStatus.textContent = 'Serviço de autenticação indisponível.';
        if (loginButton) loginButton.disabled = true;
        return;
    }

    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (loginStatus) loginStatus.textContent = 'Autenticando...';
            if (loginButton) loginButton.disabled = true;

            try {
                await firebaseServiceInstance.login(emailInput.value, passwordInput.value);
                // console.log('LOGIN_RENDERER (ESM): Login bem-sucedido via FirebaseService.'); // Verboso
                if (loginStatus) loginStatus.textContent = 'Login bem-sucedido! Redirecionando...';
                
                if (window.electronAPI && window.electronAPI.notifyLoginSuccess) {
                    window.electronAPI.notifyLoginSuccess();
                } else {
                    if (loginStatus) loginStatus.textContent = 'Erro: API de comunicação não encontrada.';
                    console.error('LOGIN_RENDERER (ESM): electronAPI.notifyLoginSuccess não está disponível.');
                    if (loginButton) loginButton.disabled = false;
                }
            } catch (error) {
                let friendlyErrorMessage = "Ocorreu um erro no login.";
                if (error.code) { // Firebase geralmente retorna error.code
                    if (error.code === 'auth/invalid-credential' || error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password' || error.code === 'auth/invalid-login-credentials') {
                        friendlyErrorMessage = "Email ou senha inválidos.";
                    } else if (error.code === 'auth/invalid-email') {
                        friendlyErrorMessage = "O formato do email é inválido.";
                    } else if (error.code === 'auth/network-request-failed') {
                        friendlyErrorMessage = "Erro de rede. Verifique sua conexão.";
                    }  else if (error.code === 'auth/too-many-requests') {
                        friendlyErrorMessage = "Muitas tentativas de login. Tente novamente mais tarde.";
                    } else {
                        // Para outros códigos de erro do Firebase Auth, use a mensagem padrão ou mapeie mais.
                        friendlyErrorMessage = `Erro: ${error.message}`;
                    }
                } else {
                     friendlyErrorMessage = `Erro desconhecido: ${error.message || error}`; // Se não houver error.code
                }
                if (loginStatus) loginStatus.textContent = friendlyErrorMessage;
                console.error('LOGIN_RENDERER (ESM): Erro no login:', error.code || '', error.message, error);
                if (loginButton) loginButton.disabled = false;
            }
        });
    } else {
        console.error("LOGIN_RENDERER (ESM): Formulário de login não encontrado no DOM.");
    }

    firebaseServiceInstance.onAuthStateChanged(user => {
        if (user) {
            // console.log('LOGIN_RENDERER (ESM): Usuário já está logado (sessão persistida).'); // Verboso
            if (loginStatus) loginStatus.textContent = 'Sessão ativa encontrada. Redirecionando...';
            if (loginForm && loginForm.style.display !== 'none') {
                 loginForm.style.display = 'none';
            }

            setTimeout(() => { // Pequeno delay para o usuário ver a mensagem
                if (window.electronAPI && window.electronAPI.notifyLoginSuccess) {
                    window.electronAPI.notifyLoginSuccess();
                } else {
                     console.error('LOGIN_RENDERER (ESM) (onAuthStateChanged): electronAPI.notifyLoginSuccess não está disponível.');
                     if(loginStatus) loginStatus.textContent = "Erro ao redirecionar automaticamente."
                }
            }, 1000); 
        } else {
            console.log('LOGIN_RENDERER (ESM): Nenhum usuário logado, aguardando credenciais.');
             if (loginForm && loginForm.style.display === 'none') { // Mostrar formulário se estava escondido
                 loginForm.style.display = 'block';
            }
             // Limpar campos pode ser útil se o usuário deslogar e voltar para esta tela
             if (emailInput) emailInput.value = '';
             if (passwordInput) passwordInput.value = '';
             if (loginButton) loginButton.disabled = false; // Garantir que o botão está habilitado
             if (loginStatus) loginStatus.textContent = ''; // Limpar mensagem de status
        }
    });
}