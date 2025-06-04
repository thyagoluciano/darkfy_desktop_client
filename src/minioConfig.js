const MINIO_CONFIG = {
  endpoint: process.env.MINIO_ENDPOINT,
  accessKey: process.env.MINIO_ACCESS_KEY,
  secretKey: process.env.MINIO_SECRET_KEY,
  bucketName: process.env.MINIO_BUCKET_NAME,
  useSSL: process.env.MINIO_USE_SSL === 'true', // Converte string 'true' para boolean
  port: process.env.MINIO_PORT ? parseInt(process.env.MINIO_PORT, 10) : undefined,
};

if (!MINIO_CONFIG.endpoint || !MINIO_CONFIG.accessKey || !MINIO_CONFIG.secretKey || !MINIO_CONFIG.bucketName) {
  console.error(
    "MINIO_CONFIG: Erro Crítico! Variáveis de ambiente essenciais para Minio não estão definidas." +
    " Verifique seu arquivo .env ou as variáveis de ambiente do sistema." +
    " Endpoint:", MINIO_CONFIG.endpoint,
    " AccessKey definida:", !!MINIO_CONFIG.accessKey, // !! converte para boolean (true se a string não for vazia)
    " SecretKey definida:", !!MINIO_CONFIG.secretKey,
    " BucketName:", MINIO_CONFIG.bucketName
  );
}

module.exports = MINIO_CONFIG;