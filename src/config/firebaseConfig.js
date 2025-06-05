// src/config/firebaseConfig.js
// Este arquivo agora é um ES Module.
// dotenv.config() é chamado no topo do main.js (que também será ESM).
// Ou, se você preferir, pode chamar import 'dotenv/config'; aqui também,
// mas uma chamada no ponto de entrada (main.js) é geralmente suficiente.

const FIREBASE_CONFIG = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID,
  // measurementId: process.env.FIREBASE_MEASUREMENT_ID, // Se você usar Analytics
};

// Validação para garantir que as configurações essenciais foram carregadas
if (
  !FIREBASE_CONFIG.apiKey ||
  !FIREBASE_CONFIG.authDomain ||
  !FIREBASE_CONFIG.projectId
) {
  console.error(
    "FIREBASE_CONFIG_MODULE (ESM): Erro Crítico! Variáveis de ambiente essenciais para Firebase não estão definidas." +
    " Verifique seu arquivo .env (local) ou os secrets (CI) e se main.js importou dotenv/config." +
    "\n  API Key definida:", !!FIREBASE_CONFIG.apiKey,
    "\n  Auth Domain definida:", !!FIREBASE_CONFIG.authDomain,
    "\n  Project ID definida:", !!FIREBASE_CONFIG.projectId
  );
} else {
  // console.log("FIREBASE_CONFIG_MODULE (ESM): Objeto de configuração Firebase montado.");
}

export default FIREBASE_CONFIG; // Mudança para exportação padrão ESM