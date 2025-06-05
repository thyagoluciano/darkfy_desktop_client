// src/services/bucketService.js
import fs from 'fs';
// import path from 'path'; // Não é mais usado diretamente aqui
import https from 'https'; // Para o upload PUT via HTTPS
import http from 'http';  // Para o upload PUT via HTTP (se a URL pré-assinada for HTTP)
import { PassThrough } from 'stream'; // Para monitorar progresso do upload
import { URL } from 'url'; // Para determinar o módulo http ou https

class BucketService {
  constructor(onLogCallback) { // Construtor simplificado
    this.onLog = onLogCallback || console.log;
    this.onLog('[BucketService (ESM)] Inicializado (foco em upload para URL pré-assinada).');
  }

  // Método principal de upload do serviço, agora para URL pré-assinada
  async uploadFile(preSignedUrl, filePath, contentType, fileSize, onProgressCallback) {
    this.onLog(`[BucketService (ESM)] Iniciando upload para URL pré-assinada: ${preSignedUrl.substring(0, 70)}...`);
    
    if (!preSignedUrl || typeof preSignedUrl !== 'string') {
        const errorMsg = "[BucketService (ESM)] URL pré-assinada inválida ou não fornecida.";
        this.onLog(errorMsg);
        throw new Error(errorMsg);
    }
    
    const fileStream = fs.createReadStream(filePath);

    let uploadedBytes = 0;
    const progressStream = new PassThrough();
    progressStream.on('data', (chunk) => {
        uploadedBytes += chunk.length;
        if (onProgressCallback && fileSize > 0) {
            const percent = (uploadedBytes / fileSize) * 100;
            onProgressCallback(percent, uploadedBytes, fileSize);
        } else if (onProgressCallback) {
            onProgressCallback(-1, uploadedBytes, fileSize); 
        }
    });

    const pipedStream = fileStream.pipe(progressStream);

    const parsedUrl = new URL(preSignedUrl);
    const requestModule = parsedUrl.protocol === 'https:' ? https : http;

    const options = {
        method: 'PUT', // Assumindo PUT; ajuste se sua API gerar URLs para POST
        headers: {
            'Content-Type': contentType,
            'Content-Length': fileSize.toString(),
        },
        // Algumas URLs pré-assinadas (especialmente S3) podem já incluir todos os headers necessários
        // como parte da assinatura na query string. Outras podem exigir que você os defina.
        // Verifique a documentação do seu provedor de storage ou da sua API.
        // Se a URL já tiver query params para autenticação, não precisa adicionar 'Authorization' aqui.
    };

    return new Promise((resolve, reject) => {
        const req = requestModule.request(preSignedUrl, options, (res) => {
            let responseBody = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => responseBody += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    this.onLog(`[BucketService (ESM)] Upload para URL pré-assinada concluído com sucesso (Status: ${res.statusCode}). ETag: ${res.headers.etag || 'N/A'}`);
                    resolve({ success: true, etag: res.headers.etag, fullResponseHeaders: res.headers });
                } else {
                    this.onLog(`[BucketService (ESM)] Falha no upload para URL pré-assinada. Status: ${res.statusCode}. Corpo: ${responseBody}`);
                    reject(new Error(`Falha no upload (HTTP ${res.statusCode}): ${responseBody || 'Sem corpo de resposta'}`));
                }
            });
        });

        req.on('error', (error) => {
            this.onLog(`[BucketService (ESM)] Erro na requisição de upload para URL pré-assinada: ${error.message}`);
            fileStream.destroy();
            reject(new Error(`Erro de rede durante o upload: ${error.message}`));
        });
        
        req.on('timeout', () => {
            this.onLog('[BucketService (ESM)] Timeout durante o upload para URL pré-assinada.');
            req.destroy();
            fileStream.destroy();
            reject(new Error('Timeout durante o upload.'));
        });

        pipedStream.pipe(req);

        fileStream.on('error', (err) => { 
           this.onLog(`[BucketService (ESM)] Erro ao ler arquivo para upload: ${err.message}`);
           req.destroy(); // Aborta a requisição HTTP se houver erro ao ler o arquivo
           reject(new Error(`Erro ao ler arquivo para upload: ${err.message}`));
        });

        // Handle o caso de o pipedStream terminar antes que a requisição 'req' termine,
        // o que pode acontecer se o servidor fechar a conexão prematuramente.
        pipedStream.on('end', () => {
            // req.end() é implicitamente chamado pelo pipe, mas este log pode ser útil.
            // this.onLog('[BucketService (ESM)] Stream do arquivo finalizado para upload.');
        });
         pipedStream.on('error', (err) => { // Erro no stream de progresso
            this.onLog(`[BucketService (ESM)] Erro no stream de progresso: ${err.message}`);
            req.destroy();
            reject(err);
        });
    });
  }
}

export default BucketService;