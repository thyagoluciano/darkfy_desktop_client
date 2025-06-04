// src/services/minioService.js
const Minio = require('minio');
const fs = require('fs');
const path = require('path'); // Para pegar a extensão e nome do arquivo
const mime = require('mime-types'); // Para detectar o Content-Type

class MinioService {
  constructor(config) {
    this.config = config;
    try {
      this.client = new Minio.Client({
        endPoint: config.endpoint,
        port: config.port || (config.useSSL ? 443 : 80), // Porta padrão baseada em SSL
        useSSL: config.useSSL || false,
        accessKey: config.accessKey,
        secretKey: config.secretKey,
      });
      this.bucketName = config.bucketName;
      this.onLog = config.onLog || console.log;
      this.onLog('[MinioService] Cliente Minio inicializado.');
    } catch (error) {
      this.onLog(`[MinioService] Erro ao inicializar cliente Minio: ${error.message}`);
      throw error; // Re-throw para que o chamador saiba que falhou
    }
  }

  /**
   * Faz upload de um arquivo para o Minio.
   * @param {string} objectName - O nome completo do objeto no bucket (ex: 'shorts/projeto123/video.mp4').
   * @param {string} filePath - O caminho local para o arquivo a ser enviado.
   * @returns {Promise<string>} - Promessa que resolve com o objectName em caso de sucesso.
   */
  async uploadFile(objectName, filePath) {
    this.onLog(`[MinioService] Iniciando upload de ${filePath} para ${this.bucketName}/${objectName}`);

    try {
      // Detectar o Content-Type baseado na extensão do arquivo
      const contentType = mime.lookup(filePath) || 'application/octet-stream';
      const metaData = {
        'Content-Type': contentType,
        // Você pode adicionar mais metadados aqui se precisar
        // 'X-Amz-Meta-Testing': 1234,
      };

      this.onLog(`[MinioService] Metadados para upload: ${JSON.stringify(metaData)}`);

      // Verifica se o bucket existe (opcional, mas bom para depuração)
      // Em produção, você geralmente garante que o bucket já existe.
      const bucketExists = await this.client.bucketExists(this.bucketName);
      if (!bucketExists) {
        this.onLog(`[MinioService] Bucket ${this.bucketName} não existe! Criando bucket...`);
        // await this.client.makeBucket(this.bucketName, 'us-east-1'); // Região é opcional para Minio standalone
        // Para este caso, vamos assumir que o bucket já existe, pois criar buckets dinamicamente pode não ser o desejado.
        // Se precisar criar, descomente a linha acima, mas com cuidado.
        // Por agora, vamos lançar um erro se não existir.
        throw new Error(`Bucket ${this.bucketName} não existe.`);
      } else {
          this.onLog(`[MinioService] Bucket ${this.bucketName} existe.`);
      }


      // Faz o upload do arquivo
      // O SDK do Minio `fPutObject` retorna uma Promise com informações do upload (etag, versionId)
      const result = await this.client.fPutObject(this.bucketName, objectName, filePath, metaData);
      this.onLog(`[MinioService] Upload de ${filePath} para ${this.bucketName}/${objectName} concluído. Etag: ${result.etag}`);
      return objectName; // Retorna o nome do objeto para ser usado como minioPath

    } catch (error) {
      this.onLog(`[MinioService] Erro durante o upload para Minio: ${error.message}`);
      this.onLog(`[MinioService] Detalhes do erro: ${JSON.stringify(error)}`);
      throw error; // Re-throw para que o chamador saiba que falhou
    }
  }
}

module.exports = MinioService;