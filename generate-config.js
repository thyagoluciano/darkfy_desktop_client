// generate-config.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

console.log('[generate-config] Variáveis de ambiente disponíveis:');
const envVars = [
  'FIREBASE_API_KEY', 
  'FIREBASE_AUTH_DOMAIN', 
  'FIREBASE_PROJECT_ID', 
  'FIREBASE_STORAGE_BUCKET', 
  'FIREBASE_MESSAGING_SENDER_ID', 
  'FIREBASE_APP_ID',
  'BUCKET_NAME', // Mantido se a API de URL pré-assinada precisar do nome do bucket no payload
  'API_BASE_URL'
];

envVars.forEach(key => {
  console.log(`[generate-config] ${key}: ${process.env[key] ? 'DEFINIDA' : 'NÃO DEFINIDA'}`);
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dotEnvPath = path.join(__dirname, '.env');
if (fs.existsSync(dotEnvPath)) {
    console.log(`[generate-config] Arquivo .env encontrado em ${dotEnvPath}. Carregando...`);
    dotenv.config({ path: dotEnvPath, override: true });
} else {
    console.log(`[generate-config] Arquivo .env não encontrado em ${dotEnvPath}. Usando variáveis de ambiente existentes.`);
}

console.log('[generate-config] Verificando process.env APÓS tentativa de carregar .env:');
console.log('[generate-config] process.env.FIREBASE_API_KEY:', process.env.FIREBASE_API_KEY ? 'DEFINIDA' : 'NÃO DEFINIDA');
console.log('[generate-config] process.env.API_BASE_URL:', process.env.API_BASE_URL ? 'DEFINIDA' : 'NÃO DEFINIDA');
console.log('[generate-config] process.env.BUCKET_NAME:', process.env.BUCKET_NAME ? 'DEFINIDA' : 'NÃO DEFINIDA');

const config = {
    firebase: {
        apiKey: process.env.FIREBASE_API_KEY,
        authDomain: process.env.FIREBASE_AUTH_DOMAIN,
        projectId: process.env.FIREBASE_PROJECT_ID,
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
        messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
        appId: process.env.FIREBASE_APP_ID,
    },
    bucket: { // Apenas o nome, se necessário
        name: process.env.BUCKET_NAME,
    },
    api: {
        baseUrl: process.env.API_BASE_URL,
    }
};

// Validação básica ajustada
if (!config.firebase.apiKey || !config.api.baseUrl /* || !config.bucket.name */ ) { // bucket.name opcional na validação
    console.error('[generate-config] ERRO: Variáveis de ambiente essenciais (Firebase, API) não estão definidas APÓS CARREGAR CONFIG!');
    console.error(`[generate-config] Detalhes Firebase API Key: ${config.firebase.apiKey}`);
    console.error(`[generate-config] Detalhes API Base URL: ${config.api.baseUrl}`);
    if (!config.bucket.name) {
        console.warn('[generate-config] AVISO: BUCKET_NAME não está definido. Isso pode ser OK se sua API de URL pré-assinada não precisar dele.');
    }
}

const outputPath = path.join(__dirname, 'dist', 'app-config.json');
try {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(config, null, 2));
    console.log(`[generate-config] Configuração gerada/atualizada em: ${outputPath}`);
} catch (error) {
    console.error(`[generate-config] ERRO ao escrever o arquivo de configuração: ${error}`);
}