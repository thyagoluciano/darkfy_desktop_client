// src/config/minioConfig.js
// Este arquivo agora é um ES Module.

const MINIO_CONFIG = {
  endpoint: process.env.MINIO_ENDPOINT,
  accessKey: process.env.MINIO_ACCESS_KEY,
  secretKey: process.env.MINIO_SECRET_KEY,
  bucketName: process.env.MINIO_BUCKET_NAME,
  useSSL: process.env.MINIO_USE_SSL === 'true',
  port: process.env.MINIO_PORT ? parseInt(process.env.MINIO_PORT, 10) : undefined,
};

// Validação
if (
  !MINIO_CONFIG.endpoint ||
  !MINIO_CONFIG.accessKey ||
  !MINIO_CONFIG.secretKey ||
  !MINIO_CONFIG.bucketName
) {
  console.error(
    "MINIO_CONFIG_MODULE (ESM): Erro Crítico! Variáveis de ambiente essenciais para Minio não estão definidas." +
    " Verifique seu arquivo .env ou as variáveis de ambiente do sistema." +
    "\n  Endpoint definido:", !!MINIO_CONFIG.endpoint,
    "\n  AccessKey definida:", !!MINIO_CONFIG.accessKey,
    "\n  SecretKey definida:", !!MINIO_CONFIG.secretKey,
    "\n  BucketName definido:", !!MINIO_CONFIG.bucketName
  );
}

export default MINIO_CONFIG; // Mudança para exportação padrão ESM