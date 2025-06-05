// src/services/downloadService.js
import fs from 'fs';
import path from 'path';
import os from 'os';
import https from 'https';
import http from 'http';
import { pipeline } from 'stream/promises'; // stream/promises é ESM-friendly
import { URL } from 'url'; // URL é um global, mas importar pode ser mais explícito

// Para ytdl-core e youtube-dl-exec, precisamos verificar como eles são melhor importados em ESM.
// Muitas libs modernas suportam 'import NomeDaLib from "nome-da-lib";'
// Se não, usaremos createRequire como fallback.

// Tentativa de importação direta (verifique a documentação das libs se isso falhar)
import ytdl from 'ytdl-core';
// youtube-dl-exec pode ser mais complicado se for um wrapper CLI.
// Se a importação direta falhar, use createRequire.
let youtubeDl;
try {
  const youtubeDlModule = await import('youtube-dl-exec');
  youtubeDl = youtubeDlModule.default || youtubeDlModule; // Tenta pegar o default ou o módulo inteiro
} catch (e) {
  console.warn('Falha ao importar youtube-dl-exec como ESM nativo, tentando com createRequire...');
  try {
    const { createRequire } = await import('module');
    const require = createRequire(import.meta.url);
    youtubeDl = require('youtube-dl-exec');
  } catch (e2) {
    console.error('Falha crítica ao importar youtube-dl-exec. Verifique a instalação e o suporte ESM.', e2);
    // Defina youtubeDl como uma função no-op ou lance um erro para que a aplicação não quebre inesperadamente
    youtubeDl = () => Promise.reject(new Error('youtube-dl-exec não pôde ser carregado'));
  }
}


class DownloadService {
  constructor(callbacks = {}) {
    this.onProgress = callbacks.onProgress || (() => {});
    this.onLog = callbacks.onLog || console.log;
    this.maxRetries = callbacks.maxRetries || 3;
    this.retryDelay = callbacks.retryDelay || 2000; // ms
    this.timeout = callbacks.timeout || 120000; // 2 minutos
    
    this.ytDlpPath = callbacks.ytDlpPath || null;
  }

  _getTempFilePath(originalUrl, uniqueId) {
    const tempDir = os.tmpdir();
    const fileExtension = '.mp4';
    let videoId = '';
    
    if (originalUrl.includes('youtube.com/watch?v=')) {
      videoId = originalUrl.split('watch?v=')[1].split('&')[0];
    } else if (originalUrl.includes('youtu.be/')) {
      videoId = originalUrl.split('youtu.be/')[1].split('?')[0];
    } else if (originalUrl.includes('youtube.com/shorts/')) {
      videoId = originalUrl.split('/shorts/')[1].split('?')[0];
    } else {
      videoId = uniqueId;
    }
    
    // this.onLog(`[DownloadService (ESM)] Nome do arquivo será: ${videoId}${fileExtension}`); // Removido para diminuir verbosidade
    return path.join(tempDir, `${videoId}${fileExtension}`);
  }


  _processYouTubeUrl(videoUrl) {
    let processedUrl = videoUrl;
    if (videoUrl.includes('/shorts/')) {
      // this.onLog(`[DownloadService (ESM)] URL é um YouTube Short. Convertendo.`);
      processedUrl = videoUrl.replace('/shorts/', '/watch?v=');
    }
    if (videoUrl.includes('youtu.be/')) {
      const videoId = videoUrl.split('youtu.be/')[1].split('?')[0];
      processedUrl = `https://www.youtube.com/watch?v=${videoId}`;
      // this.onLog(`[DownloadService (ESM)] URL de compartilhamento convertida.`);
    }
    return processedUrl;
  }

  async _downloadWithYtDlp(videoUrl, tempFilePath, retryCount = 0) {
    try {
      this.onLog(`[DownloadService (ESM)] Iniciando download com youtube-dl-exec: ${videoUrl.substring(0, 50)}...`);
      
      const options = {
        output: tempFilePath,
        format: 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best', // Formato mais robusto
        noCheckCertificates: true,
        noWarnings: true,
        preferFreeFormats: true,
        addHeader: [
          'referer:youtube.com',
          'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        ],
        // Parâmetros para tentar evitar erros de "throttling" ou geoblocking, se aplicável
        // geoBypass: true, // Pode requerer configuração adicional ou não ser suportado por todas as versões
        // retries: 10, // Retries internos do yt-dlp
        // fragmentRetries: 10,
      };
      
      let ytDlpInstance = youtubeDl;
      if (this.ytDlpPath && typeof youtubeDl.create === 'function') { // Verifica se create existe
        ytDlpInstance = youtubeDl.create(this.ytDlpPath);
      } else if (this.ytDlpPath) {
        this.onLog(`[DownloadService (ESM)] ytDlpPath fornecido, mas youtubeDl.create não é uma função. Usando instância padrão de youtubeDl.`);
      }
      
      // O rastreamento de progresso com youtube-dl-exec pode ser instável ou não implementado uniformemente.
      // É mais seguro confiar no log de progresso do próprio yt-dlp se ele o emitir para stdout/stderr,
      // ou simplesmente não ter um progresso granular aqui e focar no ytdl-core para isso.
      // Por ora, vamos remover a tentativa de criarProgressTracker para simplificar.
      // Se quiser progresso, ytdl-core é melhor para isso via stream.

      // Executar o download
      // A chamada a youtubeDl pode precisar ser ajustada dependendo de como a lib foi importada.
      // Se youtubeDl for o default export, é só chamar youtubeDl(...).
      // Se for um objeto com métodos, pode ser youtubeDl.exec(...) ou similar.
      // A importação padrão 'import youtubeDl from ...' geralmente dá o objeto/função principal.
      await ytDlpInstance(videoUrl, options); // Assumindo que ytDlpInstance é uma função executável
      
      this.onLog(`[DownloadService (ESM)] Download (youtube-dl-exec) concluído: ${tempFilePath}`);
      return tempFilePath;
      
    } catch (error) {
      this.onLog(`[DownloadService (ESM)] Erro no download youtube-dl-exec (tentativa ${retryCount + 1}): ${error.message}`);
      if (fs.existsSync(tempFilePath)) {
        try { fs.unlinkSync(tempFilePath); } catch (e) { /* ignore */ }
      }
      if (retryCount < this.maxRetries) {
        this.onLog(`[DownloadService (ESM)] Tentando novamente em ${this.retryDelay * Math.pow(2, retryCount)}ms...`);
        await new Promise(resolve => setTimeout(resolve, this.retryDelay * Math.pow(2, retryCount)));
        return this._downloadWithYtDlp(videoUrl, tempFilePath, retryCount + 1);
      }
      throw error;
    }
  }

  async _downloadWithYtdl(videoUrl, tempFilePath, retryCount = 0) {
    try {
      this.onLog(`[DownloadService (ESM)] Iniciando download com ytdl-core: ${videoUrl.substring(0, 50)}...`);
      
      const options = {
        quality: 'highest', // Tenta pegar áudio e vídeo combinados se possível
        // filter: format => format.hasAudio && format.hasVideo, // Pode ser muito restritivo, ytdl-core tenta o melhor
        requestOptions: { /* ... headers ... */ }
      };
      
      // ytdl.getInfo pode ser demorado ou falhar para alguns vídeos.
      const info = await ytdl.getInfo(videoUrl, options.requestOptions); // Passar requestOptions para getInfo também
      this.onLog(`[DownloadService (ESM)] Título (ytdl): ${info.videoDetails.title.substring(0,30)}...`);
      
      // Escolher o formato. ytdl.chooseFormat é útil.
      // Tentar um formato que tenha áudio e vídeo e seja mp4.
      let format = ytdl.chooseFormat(info.formats, { quality: 'highest', filter: 'audioandvideo', container: 'mp4' });
      if (!format) {
        this.onLog('[DownloadService (ESM)] Não encontrou formato mp4 com áudio e vídeo, tentando melhor vídeo mp4...');
        format = ytdl.chooseFormat(info.formats, { quality: 'highestvideo', filter: format => format.container === 'mp4' });
      }
      if (!format) {
        this.onLog('[DownloadService (ESM)] Não encontrou vídeo mp4, tentando melhor áudio e vídeo...');
        format = ytdl.chooseFormat(info.formats, { quality: 'highest', filter: 'audioandvideo' });
      }
      if (!format) {
          this.onLog('[DownloadService (ESM)] Não encontrou formato com áudio e vídeo, selecionando melhor vídeo disponível');
          format = ytdl.chooseFormat(info.formats, { quality: 'highestvideo' });
      }
      if (!format) {
        throw new Error('Não foi possível encontrar um formato de vídeo adequado com ytdl-core.');
      }
      
      this.onLog(`[DownloadService (ESM)] Formato ytdl: ${format.qualityLabel || 'N/A'} (${format.container || 'N/A'})`);
      
      const videoStream = ytdl.downloadFromInfo(info, { format });
      const fileStream = fs.createWriteStream(tempFilePath);
      
      const totalBytes = parseInt(format.contentLength || (info.videoDetails && info.videoDetails.lengthSeconds ? parseInt(info.videoDetails.lengthSeconds) * 150000 : 0), 10); // Estimativa grosseira se contentLength faltar
      let downloadedBytes = 0;
      
      videoStream.on('progress', (chunkLength, downloaded, total) => {
        // O 'total' de ytdl-core é mais confiável que o format.contentLength às vezes.
        const currentTotal = total || totalBytes;
        downloadedBytes = downloaded;
        if (currentTotal > 0) {
          const percent = (downloadedBytes / currentTotal) * 100;
          this.onProgress(percent, downloadedBytes, currentTotal);
        } else {
          this.onProgress(-1, downloadedBytes, 0); // Progresso indeterminado
        }
      });
      
      await pipeline(videoStream, fileStream);
      
      this.onLog(`[DownloadService (ESM)] Download (ytdl) concluído: ${tempFilePath}`);
      return tempFilePath;
      
    } catch (error) {
      this.onLog(`[DownloadService (ESM)] Erro no download ytdl (tentativa ${retryCount + 1}): ${error.message}`);
      if (fs.existsSync(tempFilePath)) {
        try { fs.unlinkSync(tempFilePath); } catch (e) { /* ignore */ }
      }
      if (retryCount < this.maxRetries) {
        this.onLog(`[DownloadService (ESM)] Tentando novamente em ${this.retryDelay * Math.pow(2, retryCount)}ms...`);
        await new Promise(resolve => setTimeout(resolve, this.retryDelay * Math.pow(2, retryCount)));
        return this._downloadWithYtdl(videoUrl, tempFilePath, retryCount + 1);
      }
      // Se ytdl falhar, não relançar o erro imediatamente, permitir que a próxima estratégia seja tentada.
      throw error; // Ou retorne null/undefined para indicar falha e deixar o método principal decidir
    }
  }

  async _downloadWithHttp(videoUrl, tempFilePath, retryCount = 0) {
    // ... (lógica de _downloadWithHttp como antes, mas usando this.onLog com (ESM)) ...
    // A lógica interna de http.get e streams permanece a mesma.
    try {
      this.onLog(`[DownloadService (ESM)] Iniciando download HTTP/S: ${videoUrl.substring(0, 50)}...`);
      const url = new URL(videoUrl);
      const requestModule = url.protocol === 'https:' ? https : http;
      
      return new Promise((resolve, reject) => {
        const request = requestModule.get(videoUrl, {
          timeout: this.timeout,
          headers: { /* ... */ }
        }, (response) => {
          if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
            this.onLog(`[DownloadService (ESM)] Redirecionamento para: ${response.headers.location.substring(0,50)}...`);
            if (fs.existsSync(tempFilePath)) { try { fs.unlinkSync(tempFilePath); } catch(e) {/*ignore*/} }
            this._downloadWithHttp(response.headers.location, tempFilePath, retryCount).then(resolve).catch(reject);
            return;
          }
          if (response.statusCode !== 200) {
            const errorMsg = `Falha HTTP/S, status: ${response.statusCode} para ${videoUrl.substring(0,50)}`;
            if (fs.existsSync(tempFilePath)) { try { fs.unlinkSync(tempFilePath); } catch(e) {/*ignore*/} }
            reject(new Error(errorMsg));
            return;
          }
          const totalBytes = parseInt(response.headers['content-length'], 10) || 0;
          let downloadedBytes = 0;
          const fileStream = fs.createWriteStream(tempFilePath);
          response.on('data', (chunk) => {
            downloadedBytes += chunk.length;
            this.onProgress(totalBytes > 0 ? (downloadedBytes / totalBytes) * 100 : -1, downloadedBytes, totalBytes);
          });
          pipeline(response, fileStream)
            .then(() => {
              this.onLog(`[DownloadService (ESM)] Download (HTTP/S) concluído: ${tempFilePath}`);
              resolve(tempFilePath);
            })
            .catch(err => {
              this.onLog(`[DownloadService (ESM)] Erro ao escrever/pipe (HTTP/S): ${err.message}`);
              if (fs.existsSync(tempFilePath)) { try { fs.unlinkSync(tempFilePath); } catch(e) {/*ignore*/} }
              reject(err);
            });
        });
        request.on('error', (err) => { /* ... */ reject(err); });
        request.on('timeout', () => { /* ... */ reject(new Error('Timeout HTTP/S')); });
      });
    } catch (error) {
      this.onLog(`[DownloadService (ESM)] Erro download HTTP/S (tentativa ${retryCount+1}): ${error.message}`);
      if (fs.existsSync(tempFilePath)) { try { fs.unlinkSync(tempFilePath); } catch(e) {/*ignore*/} }
      if (retryCount < this.maxRetries) {
        await new Promise(resolve => setTimeout(resolve, this.retryDelay * Math.pow(2, retryCount)));
        return this._downloadWithHttp(videoUrl, tempFilePath, retryCount + 1);
      }
      throw error;
    }
  }

  async downloadVideo(originalUrl, uniqueId) {
    this.onLog(`[DownloadService (ESM)] Iniciando download para: ${originalUrl.substring(0,70)}...`);
    const processedUrl = this._processYouTubeUrl(originalUrl);
    const tempFilePath = this._getTempFilePath(originalUrl, uniqueId); // Usar URL original para nome do arquivo

    // Estratégia 1: youtube-dl-exec (mais robusto para vários sites e formatos)
    try {
      this.onLog(`[DownloadService (ESM)] Tentando com youtube-dl-exec...`);
      const filePath = await this._downloadWithYtDlp(processedUrl, tempFilePath);
      if (this.validateDownloadedFile(filePath).valid) return filePath;
      this.onLog(`[DownloadService (ESM)] youtube-dl-exec baixou arquivo inválido.`);
      // Não jogue erro aqui, apenas deixe cair para a próxima estratégia
    } catch (ytDlpError) {
      this.onLog(`[DownloadService (ESM)] Falha no youtube-dl-exec: ${ytDlpError.message.substring(0,100)}`);
    }

    // Estratégia 2: ytdl-core (bom para YouTube, bom progresso)
    if (ytdl.validateURL(processedUrl)) {
      try {
        this.onLog(`[DownloadService (ESM)] Tentando com ytdl-core...`);
        const filePath = await this._downloadWithYtdl(processedUrl, tempFilePath);
        if (this.validateDownloadedFile(filePath).valid) return filePath;
        this.onLog(`[DownloadService (ESM)] ytdl-core baixou arquivo inválido.`);
      } catch (ytdlError) {
        this.onLog(`[DownloadService (ESM)] Falha no ytdl-core: ${ytdlError.message.substring(0,100)}`);
      }
    }

    // Estratégia 3: HTTP/S direto (fallback genérico)
    // Só tentar HTTP se as outras falharem, pois pode não pegar o vídeo corretamente
    // para sites como YouTube sem as libs especializadas.
    try {
        this.onLog(`[DownloadService (ESM)] Tentando com HTTP/S direto...`);
        // Para URLs que não são do YouTube, ou como último recurso para YouTube
        const filePath = await this._downloadWithHttp(originalUrl, tempFilePath); // Usar URL original para HTTP direto
        if (this.validateDownloadedFile(filePath).valid) return filePath;
        this.onLog(`[DownloadService (ESM)] HTTP/S direto baixou arquivo inválido.`);
        throw new Error('Download HTTP/S resultou em arquivo inválido.'); // Força erro se esta estratégia falhar
    } catch (httpError) {
        this.onLog(`[DownloadService (ESM)] Falha no HTTP/S direto: ${httpError.message.substring(0,100)}`);
        throw new Error(`Todos os métodos de download falharam. Último erro (HTTP): ${httpError.message}`);
    }
  }

  cleanupTempFile(filePath) {
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        // this.onLog(`[DownloadService (ESM)] Arquivo temp ${path.basename(filePath)} deletado.`);
      } catch (err) {
        this.onLog(`[DownloadService (ESM)] Erro ao deletar temp ${path.basename(filePath)}: ${err.message}`);
      }
    }
  }

  validateDownloadedFile(filePath) {
    try {
      if (!fs.existsSync(filePath)) {
        return { valid: false, reason: 'Arquivo não existe' };
      }
      const stats = fs.statSync(filePath);
      if (stats.size === 0) {
        return { valid: false, reason: 'Arquivo vazio (0 bytes)' };
      }
      // Uma validação mais robusta poderia tentar abrir o arquivo com ffprobe,
      // mas isso adiciona uma dependência. Para agora, tamanho > 0 é o básico.
      // Mínimo de 1KB para ser considerado algo além de um arquivo de erro.
      if (stats.size < 1024) { 
        const content = fs.readFileSync(filePath, {encoding: 'utf-8', flag: 'r' });
        if (content.toLowerCase().includes("<html") || content.toLowerCase().includes("error")) {
            return { valid: false, reason: 'Arquivo pequeno e parece ser HTML/Erro.' };
        }
      }
      return { valid: true, size: stats.size };
    } catch (error) {
      return { valid: false, reason: `Exceção ao validar: ${error.message}` };
    }
  }
}

export default DownloadService;