// generate-config.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

console.log('[generate-config] Variáveis de ambiente disponíveis:');
const envVars = [
  'FIREBASE_API_KEY', 'FIREBASE_AUTH_DOMAIN', 'FIREBASE_PROJECT_ID', 
  'FIREBASE_STORAGE_BUCKET', 'FIREBASE_MESSAGING_SENDER_ID', 'FIREBASE_APP_ID',
  'MINIO_ENDPOINT', 'MINIO_ACCESS_KEY', 'MINIO_SECRET_KEY', 
  'MINIO_BUCKET_NAME', 'MINIO_USE_SSL'
];

envVars.forEach(key => {
  console.log(`[generate-config] ${key}: ${process.env[key] ? 'DEFINIDA' : 'NÃO DEFINIDA'}`);
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename); // __dirname aqui é a raiz do projeto

// Carregar o .env INCONDICIONALMENTE se o arquivo existir.
// As variáveis do .env irão popular process.env.
// Se houver variáveis já existentes em process.env com o mesmo nome,
// o dotenv por padrão NÃO as sobrescreverá. Para sobrescrever, usar { override: true }
// Mas para desenvolvimento, geralmente queremos que .env seja a fonte primária.
const dotEnvPath = path.join(__dirname, '.env');
if (fs.existsSync(dotEnvPath)) {
    console.log(`[generate-config] Arquivo .env encontrado em ${dotEnvPath}. Carregando...`);
    dotenv.config({ path: dotEnvPath, override: true }); // Adicionado override: true
} else {
    console.log(`[generate-config] Arquivo .env não encontrado em ${dotEnvPath}. Usando variáveis de ambiente existentes (se houver).`);
}

// Agora, process.env deve conter as variáveis do .env (se carregado)
// ou do ambiente externo (se .env não carregado ou chaves não presentes nele).

console.log('[generate-config] Verificando process.env APÓS tentativa de carregar .env:');
console.log('[generate-config] process.env.FIREBASE_API_KEY:', process.env.FIREBASE_API_KEY ? 'DEFINIDA' : 'NÃO DEFINIDA');
console.log('[generate-config] process.env.MINIO_ENDPOINT:', process.env.MINIO_ENDPOINT ? 'DEFINIDA' : 'NÃO DEFINIDA');


const config = {
    firebase: {
        apiKey: process.env.FIREBASE_API_KEY,
        authDomain: process.env.FIREBASE_AUTH_DOMAIN,
        projectId: process.env.FIREBASE_PROJECT_ID,
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
        messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
        appId: process.env.FIREBASE_APP_ID,
    },
    minio: {
        endpoint: process.env.MINIO_ENDPOINT,
        accessKey: process.env.MINIO_ACCESS_KEY,
        secretKey: process.env.MINIO_SECRET_KEY,
        bucketName: process.env.MINIO_BUCKET_NAME,
        useSSL: process.env.MINIO_USE_SSL === 'true',
        port: process.env.MINIO_PORT ? parseInt(process.env.MINIO_PORT, 10) : (process.env.MINIO_USE_SSL === 'true' ? 443 : 80),
    }
};

// Validação básica
if (!config.firebase.apiKey || !config.minio.endpoint) {
    console.error('[generate-config] ERRO: Variáveis de ambiente essenciais não estão definidas APÓS CARREGAR CONFIG!');
    console.error(`[generate-config] Detalhes Firebase API Key: ${config.firebase.apiKey}`);
    console.error(`[generate-config] Detalhes Minio Endpoint: ${config.minio.endpoint}`);
    // Não sair com process.exit(1) durante o 'npm run start' para permitir que o Electron tente iniciar
    // e mostre erros na janela, se for o caso.
    // Apenas logar o erro aqui. O main.js terá suas próprias checagens.
    // process.exit(1); // Removido para 'npm run start', mas mantenha para builds de CI/dist se preferir falhar rápido.
}

const outputPath = path.join(__dirname, 'dist', 'app-config.json');
try {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(config, null, 2));
    console.log(`[generate-config] Configuração gerada/atualizada em: ${outputPath}`);
} catch (error) {
    console.error(`[generate-config] ERRO ao escrever o arquivo de configuração: ${error}`);
    // process.exit(1); // Pode ser útil sair aqui se a escrita falhar
}