// src/services/minioService.js
import fs from 'fs'; // Não é usado diretamente aqui, mas poderia ser para ler stream
import path from 'path'; // Usado para basename
import mime from 'mime-types'; // Geralmente funciona bem com import ESM

// Para a biblioteca 'minio':
// Verifique a documentação da versão que você está usando para a melhor forma de importação ESM.
// Muitas bibliotecas oferecem um export default ou nomeado.
// Tentativa 1: Importação nomeada (comum para classes de SDKs)
// import { Client as MinioClient } from 'minio';
// Tentativa 2: Importação default
// import Minio from 'minio';
// Tentativa 3: Fallback para createRequire se as acima falharem
let MinioClient; // Variável para armazenar a classe Client
try {
  // Tentar importar como se fosse um módulo ES com exportações nomeadas ou default
  const minioModule = await import('minio');
  if (minioModule.Client) {
    MinioClient = minioModule.Client;
  } else if (minioModule.default && minioModule.default.Client) {
    MinioClient = minioModule.default.Client;
  } else if (minioModule.default) { // Se o default for a própria classe Client
     MinioClient = minioModule.default;
  } else {
    // Se nenhuma das opções acima funcionar, tentar createRequire
    throw new Error('Exportação Minio.Client não encontrada diretamente.');
  }
} catch (e) {
  console.warn('[MinioService (ESM)] Falha ao importar "minio" como ESM nativo, tentando com createRequire...');
  try {
    const { createRequire } = await import('module');
    const require = createRequire(import.meta.url);
    const MinioLib = require('minio'); // Isso deve retornar o objeto que tem Client
    MinioClient = MinioLib.Client;
    if (!MinioClient) throw new Error('Minio.Client não encontrado via createRequire.');
  } catch (e2) {
    console.error('[MinioService (ESM)] Falha crítica ao importar a lib "minio". Verifique a instalação.', e2);
    // Lançar erro ou definir MinioClient como algo que falhará graciosamente
    throw new Error('Minio SDK não pôde ser carregado.');
  }
}


class MinioService {
  constructor(config) {
    this.config = config;
    this.onLog = config.onLog || console.log; // Garante que onLog exista

    if (!MinioClient) {
      const errorMessage = "[MinioService (ESM)] Classe Minio.Client não foi carregada. O serviço não pode operar.";
      this.onLog(errorMessage);
      throw new Error(errorMessage);
    }

    try {
      this.client = new MinioClient({ // Usa a variável MinioClient
        endPoint: config.endpoint,
        port: config.port || (config.useSSL ? 443 : 80),
        useSSL: config.useSSL || false,
        accessKey: config.accessKey,
        secretKey: config.secretKey,
      });
      this.bucketName = config.bucketName;
      this.onLog('[MinioService (ESM)] Cliente Minio inicializado.');
    } catch (error) {
      this.onLog(`[MinioService (ESM)] Erro ao inicializar cliente Minio: ${error.message}`);
      throw error;
    }
  }

  async uploadFile(objectName, filePath) {
    this.onLog(`[MinioService (ESM)] Upload de ${path.basename(filePath)} para ${this.bucketName}/${objectName}`);

    try {
      const contentType = mime.lookup(filePath) || 'application/octet-stream';
      const metaData = {
        'Content-Type': contentType,
      };

      // this.onLog(`[MinioService (ESM)] Metadados: ${JSON.stringify(metaData)}`); // Verboso

      // Não é estritamente necessário verificar bucketExists em cada upload em produção
      // (assume-se que o bucket existe), mas pode ser útil para debug.
      // const bucketExists = await this.client.bucketExists(this.bucketName);
      // if (!bucketExists) {
      //   this.onLog(`[MinioService (ESM)] Bucket ${this.bucketName} não existe!`);
      //   throw new Error(`Bucket ${this.bucketName} não existe.`);
      // }

      // fPutObject é o método correto para upload de arquivos
      const result = await this.client.fPutObject(this.bucketName, objectName, filePath, metaData);
      this.onLog(`[MinioService (ESM)] Upload de ${path.basename(filePath)} concluído. Etag: ${result.etag}`);
      return objectName;

    } catch (error) {
      this.onLog(`[MinioService (ESM)] Erro durante o upload para Minio: ${error.message}`);
      // this.onLog(`[MinioService (ESM)] Detalhes do erro: ${JSON.stringify(error)}`); // Pode ser muito grande
      throw error;
    }
  }
}

export default MinioService;