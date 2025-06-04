// src/services/downloadService.js
const fs = require('fs');
const path = require('path');
const os = require('os');
const ytdl = require('ytdl-core');
const https = require('https');
const http = require('http');
const { pipeline } = require('stream/promises');
const { URL } = require('url');
const youtubeDl = require('youtube-dl-exec');

class DownloadService {
  constructor(callbacks = {}) {
    this.onProgress = callbacks.onProgress || (() => {});
    this.onLog = callbacks.onLog || console.log;
    this.maxRetries = callbacks.maxRetries || 3;
    this.retryDelay = callbacks.retryDelay || 2000; // ms
    this.timeout = callbacks.timeout || 120000; // 2 minutos
    
    // Configurações para youtube-dl-exec
    this.ytDlpPath = callbacks.ytDlpPath || null; // Caminho para o binário yt-dlp (opcional)
  }

  _getTempFilePath(originalUrl, uniqueId) {
    const tempDir = os.tmpdir();
    const fileExtension = '.mp4'; // Sempre usar .mp4 como extensão
    let videoId = '';
    
    // Extrair ID do vídeo da URL
    if (originalUrl.includes('youtube.com/watch?v=')) {
      videoId = originalUrl.split('watch?v=')[1].split('&')[0];
    } else if (originalUrl.includes('youtu.be/')) {
      videoId = originalUrl.split('youtu.be/')[1].split('?')[0];
    } else if (originalUrl.includes('youtube.com/shorts/')) {
      videoId = originalUrl.split('/shorts/')[1].split('?')[0];
    } else {
      // Para URLs não-YouTube, usar uniqueId
      videoId = uniqueId;
    }
    
    this.onLog(`[DownloadService] Nome do arquivo será: ${videoId}${fileExtension}`);
    
    // Criar nome do arquivo usando apenas o ID do vídeo
    return path.join(tempDir, `${videoId}${fileExtension}`);
  }


  _processYouTubeUrl(videoUrl) {
    let processedUrl = videoUrl;
    
    // Converter YouTube Shorts para URL padrão
    if (videoUrl.includes('/shorts/')) {
      this.onLog(`[DownloadService] URL é um YouTube Short: ${videoUrl}. Convertendo para URL de vídeo padrão.`);
      processedUrl = videoUrl.replace('/shorts/', '/watch?v=');
      this.onLog(`[DownloadService] URL convertida para: ${processedUrl}`);
    }
    
    // Converter URLs de compartilhamento (youtu.be)
    if (videoUrl.includes('youtu.be/')) {
      const videoId = videoUrl.split('youtu.be/')[1].split('?')[0];
      processedUrl = `https://www.youtube.com/watch?v=${videoId}`;
      this.onLog(`[DownloadService] URL de compartilhamento convertida para: ${processedUrl}`);
    }
    
    return processedUrl;
  }

  async _downloadWithYtDlp(videoUrl, tempFilePath, retryCount = 0) {
    try {
      this.onLog(`[DownloadService] Iniciando download com youtube-dl-exec: ${videoUrl}`);
      
      // Configurar opções para youtube-dl-exec
      const options = {
        output: tempFilePath,
        format: 'best[ext=mp4]/best', // Preferir MP4, mas pegar o melhor formato disponível
        noCheckCertificates: true,
        noWarnings: true,
        preferFreeFormats: true,
        addHeader: [
          'referer:youtube.com',
          'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        ]
      };
      
      // Usar yt-dlp se disponível (mais atualizado e rápido)
      let ytDlpInstance = youtubeDl;
      if (this.ytDlpPath) {
        ytDlpInstance = youtubeDl.create(this.ytDlpPath);
      }
      
      // Configurar listener de progresso (se disponível)
      let progressTracker;
      try {
        // Alguns ambientes podem não suportar o progresso
        progressTracker = ytDlpInstance.createProgressTracker({
          onProgress: (progress) => {
            if (progress && progress.percent) {
              this.onProgress(
                progress.percent,
                progress.downloadedBytes || 0,
                progress.totalBytes || 0
              );
            }
          }
        });
        options.progress = true;
      } catch (e) {
        this.onLog(`[DownloadService] Não foi possível configurar rastreamento de progresso: ${e.message}`);
      }
      
      // Executar o download
      const result = await ytDlpInstance(videoUrl, options);
      
      this.onLog(`[DownloadService] Download (youtube-dl-exec) concluído: ${tempFilePath}`);
      return tempFilePath;
      
    } catch (error) {
      this.onLog(`[DownloadService] Erro no download youtube-dl-exec: ${error.message}`);
      
      // Limpar arquivo parcial
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
      
      // Tentar novamente se não excedeu o número máximo de tentativas
      if (retryCount < this.maxRetries) {
        this.onLog(`[DownloadService] Tentando novamente (${retryCount + 1}/${this.maxRetries})...`);
        // Atraso exponencial entre tentativas
        const delay = this.retryDelay * Math.pow(2, retryCount);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this._downloadWithYtDlp(videoUrl, tempFilePath, retryCount + 1);
      }
      
      throw error;
    }
  }

  async _downloadWithYtdl(videoUrl, tempFilePath, retryCount = 0) {
    try {
      this.onLog(`[DownloadService] Iniciando download com ytdl-core: ${videoUrl}`);
      
      // Usar opções mais robustas
      const options = {
        quality: 'highest',
        requestOptions: {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1'
          }
        }
      };
      
      const info = await ytdl.getInfo(videoUrl, options);
      this.onLog(`[DownloadService] Informações do vídeo obtidas: ${info.videoDetails.title}`);
      
      // Selecionar o formato com melhor qualidade que contenha áudio e vídeo
      let format = ytdl.chooseFormat(info.formats, { 
        quality: 'highest',
        filter: format => format.hasAudio && format.hasVideo
      });
      
      // Se não encontrar formato com áudio e vídeo, pegar o melhor vídeo
      if (!format) {
        this.onLog(`[DownloadService] Não encontrou formato com áudio e vídeo, selecionando melhor vídeo disponível`);
        format = ytdl.chooseFormat(info.formats, { quality: 'highestvideo' });
      }
      
      this.onLog(`[DownloadService] Formato selecionado: ${format.qualityLabel || 'N/A'} (${format.container})`);
      
      const videoStream = ytdl.downloadFromInfo(info, { format });
      const fileStream = fs.createWriteStream(tempFilePath);
      
      let totalBytes = parseInt(format.contentLength, 10) || 0;
      let downloadedBytes = 0;
      
      videoStream.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        if (totalBytes > 0) {
          const percent = (downloadedBytes / totalBytes) * 100;
          this.onProgress(percent, downloadedBytes, totalBytes);
        } else {
          this.onProgress(-1, downloadedBytes, 0);
        }
      });
      
      await pipeline(videoStream, fileStream);
      
      this.onLog(`[DownloadService] Download (ytdl) concluído: ${tempFilePath}`);
      return tempFilePath;
      
    } catch (error) {
      this.onLog(`[DownloadService] Erro no download ytdl: ${error.message}`);
      
      // Limpar arquivo parcial
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
      
      // Tentar novamente se não excedeu o número máximo de tentativas
      if (retryCount < this.maxRetries) {
        this.onLog(`[DownloadService] Tentando novamente (${retryCount + 1}/${this.maxRetries})...`);
        // Atraso exponencial entre tentativas
        const delay = this.retryDelay * Math.pow(2, retryCount);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this._downloadWithYtdl(videoUrl, tempFilePath, retryCount + 1);
      }
      
      throw error;
    }
  }

  async _downloadWithHttp(videoUrl, tempFilePath, retryCount = 0) {
    try {
      this.onLog(`[DownloadService] Iniciando download HTTP/S: ${videoUrl}`);
      
      const url = new URL(videoUrl);
      const requestModule = url.protocol === 'https:' ? https : http;
      
      return new Promise((resolve, reject) => {
        const request = requestModule.get(videoUrl, {
          timeout: this.timeout,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Connection': 'keep-alive'
          }
        }, (response) => {
          // Seguir redirecionamentos
          if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
            this.onLog(`[DownloadService] Redirecionamento detectado para: ${response.headers.location}`);
            
            // Limpar arquivo parcial e reiniciar com nova URL
            if (fs.existsSync(tempFilePath)) {
              fs.unlinkSync(tempFilePath);
            }
            
            this._downloadWithHttp(response.headers.location, tempFilePath, retryCount)
              .then(resolve)
              .catch(reject);
            
            return;
          }
          
          if (response.statusCode !== 200) {
            const errorMsg = `Falha ao obter vídeo (HTTP/S), status: ${response.statusCode} para ${videoUrl}`;
            this.onLog(`[DownloadService] ${errorMsg}`);
            
            if (fs.existsSync(tempFilePath)) {
              fs.unlinkSync(tempFilePath);
            }
            
            reject(new Error(errorMsg));
            return;
          }
          
          const totalBytes = parseInt(response.headers['content-length'], 10) || 0;
          let downloadedBytes = 0;
          const fileStream = fs.createWriteStream(tempFilePath);
          
          response.on('data', (chunk) => {
            downloadedBytes += chunk.length;
            if (totalBytes > 0) {
              const percent = (downloadedBytes / totalBytes) * 100;
              this.onProgress(percent, downloadedBytes, totalBytes);
            } else {
              this.onProgress(-1, downloadedBytes, 0);
            }
          });
          
          response.pipe(fileStream);
          
          fileStream.on('finish', () => {
            fileStream.close(() => {
              this.onLog(`[DownloadService] Download (HTTP/S) concluído: ${tempFilePath}`);
              resolve(tempFilePath);
            });
          });
          
          fileStream.on('error', (err) => {
            this.onLog(`[DownloadService] Erro ao escrever arquivo (HTTP/S): ${err.message}`);
            
            if (fs.existsSync(tempFilePath)) {
              fs.unlinkSync(tempFilePath);
            }
            
            reject(err);
          });
        });
        
        request.on('error', (err) => {
          this.onLog(`[DownloadService] Erro na requisição HTTP/S: ${err.message}`);
          
          if (fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
          }
          
          reject(err);
        });
        
        request.on('timeout', () => {
          request.destroy();
          this.onLog(`[DownloadService] Timeout durante o download HTTP/S.`);
          
          if (fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
          }
          
          reject(new Error('Timeout durante o download HTTP/S.'));
        });
      });
      
    } catch (error) {
      this.onLog(`[DownloadService] Erro no download HTTP/S: ${error.message}`);
      
      // Limpar arquivo parcial
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
      
      // Tentar novamente se não excedeu o número máximo de tentativas
      if (retryCount < this.maxRetries) {
        this.onLog(`[DownloadService] Tentando novamente (${retryCount + 1}/${this.maxRetries})...`);
        // Atraso exponencial entre tentativas
        const delay = this.retryDelay * Math.pow(2, retryCount);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this._downloadWithHttp(videoUrl, tempFilePath, retryCount + 1);
      }
      
      throw error;
    }
  }

  async downloadVideo(videoUrl, uniqueId) {
    this.onLog(`[DownloadService] Iniciando processo de download para: ${videoUrl}`);
    
    // Processar URL (especialmente para YouTube)
    let processedUrl = this._processYouTubeUrl(videoUrl);
    
    // Criar caminho para arquivo temporário
    const tempFilePath = this._getTempFilePath(videoUrl, uniqueId);
    
    // Estratégia de download com fallbacks
    try {
      // Primeiro, tentar com youtube-dl-exec (mais robusto e atualizado)
      try {
        return await this._downloadWithYtDlp(processedUrl, tempFilePath);
      } catch (ytDlpError) {
        this.onLog(`[DownloadService] Falha no download com youtube-dl-exec: ${ytDlpError.message}`);
        this.onLog(`[DownloadService] Tentando método alternativo...`);
        
        // Se falhar, tentar com ytdl-core
        if (ytdl.validateURL(processedUrl)) {
          try {
            return await this._downloadWithYtdl(processedUrl, tempFilePath);
          } catch (ytdlError) {
            this.onLog(`[DownloadService] Falha no download com ytdl-core: ${ytdlError.message}`);
            this.onLog(`[DownloadService] Tentando método HTTP direto...`);
            
            // Se ambos falharem, tentar HTTP direto
            return await this._downloadWithHttp(processedUrl, tempFilePath);
          }
        } else {
          // Se não for URL do YouTube, ir direto para HTTP
          return await this._downloadWithHttp(processedUrl, tempFilePath);
        }
      }
    } catch (error) {
      this.onLog(`[DownloadService] Todos os métodos de download falharam: ${error.message}`);
      throw error;
    }
  }

  cleanupTempFile(filePath) {
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        this.onLog(`[DownloadService] Arquivo temporário ${filePath} deletado.`);
      } catch (err) {
        this.onLog(`[DownloadService] Erro ao deletar arquivo temporário ${filePath}: ${err.message}`);
      }
    } else {
      this.onLog(`[DownloadService] Arquivo temporário ${filePath} não encontrado para deleção.`);
    }
  }

  // Método utilitário para verificar se o download foi bem-sucedido
  validateDownloadedFile(filePath) {
    try {
      if (!fs.existsSync(filePath)) {
        return { valid: false, reason: 'Arquivo não existe' };
      }
      
      const stats = fs.statSync(filePath);
      
      if (stats.size === 0) {
        return { valid: false, reason: 'Arquivo está vazio (0 bytes)' };
      }
      
      if (stats.size < 1024) { // Menos de 1KB
        // Verificar se não é um arquivo de erro HTML/texto
        const fileContent = fs.readFileSync(filePath, { encoding: 'utf8', flag: 'r' });
        if (fileContent.includes('<html') || fileContent.includes('error') || fileContent.includes('Error')) {
          return { valid: false, reason: 'Arquivo parece ser uma página de erro HTML' };
        }
      }
      
      return { valid: true, size: stats.size };
    } catch (error) {
      return { valid: false, reason: `Erro ao validar arquivo: ${error.message}` };
    }
  }
}

module.exports = DownloadService;