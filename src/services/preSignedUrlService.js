// src/services/preSignedUrlService.js
import https from 'https';
import http from 'http'; // Adicionado import para http
import { URL } from 'url';

class PreSignedUrlService {
    constructor(apiBaseUrl, onLog = console.log) {
        this.onLog = onLog; // Definir onLog primeiro para usá-lo em mensagens de erro do construtor

        if (!apiBaseUrl) {
            this.onLog("[PreSignedUrlService] Erro Crítico: API Base URL não fornecida na instanciação.");
            throw new Error("API Base URL é necessária para PreSignedUrlService.");
        }
        
        if (!apiBaseUrl.startsWith('http://') && !apiBaseUrl.startsWith('https://')) {
            this.onLog(`[PreSignedUrlService] AVISO: API Base URL "${apiBaseUrl}" não parece incluir um protocolo (http:// ou https://). Isso provavelmente causará erros de "Invalid URL" ou de protocolo.`);
            // Considerar lançar um erro aqui ou tentar prefixar, mas é melhor que a config seja explícita.
            // throw new Error(`API Base URL inválida: "${apiBaseUrl}". Deve começar com http:// ou https://`);
        }

        this.apiBaseUrl = apiBaseUrl;
        this.endpoint = "/projects/presigned-url"; // Seu endpoint da API
        this.onLog(`[PreSignedUrlService] Inicializado com API Base URL: ${this.apiBaseUrl}`);
    }

    async getPreSignedUrl(firebaseIdToken, shortId, filename, contentType) {
        this.onLog(`[PreSignedUrlService] Solicitando URL pré-assinada para: short_id=${shortId}, filename=${filename}, contentType=${contentType}`);

        if (!firebaseIdToken) {
            this.onLog("[PreSignedUrlService] Erro: Firebase ID Token não fornecido.");
            throw new Error("Firebase ID Token é obrigatório.");
        }
        if (!shortId || !filename || !contentType) {
            this.onLog("[PreSignedUrlService] Erro: shortId, filename ou contentType ausente.");
            throw new Error("shortId, filename e contentType são obrigatórios.");
        }

        const payload = JSON.stringify({
            short_id: shortId,
            filename: filename,
            content_type: contentType,
        });

        let fullUrl;
        try {
            fullUrl = new URL(this.endpoint, this.apiBaseUrl); // Cria a URL completa
        } catch (urlError) {
            this.onLog(`[PreSignedUrlService] Erro ao construir a URL completa a partir de base "${this.apiBaseUrl}" e endpoint "${this.endpoint}": ${urlError.message}`);
            throw new Error(`URL da API inválida: ${urlError.message}`);
        }
        
        const requestModule = fullUrl.protocol === 'https:' ? https : http; // Escolhe o módulo http/https correto

        const options = {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${firebaseIdToken}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
                // Adicione quaisquer outros cabeçalhos necessários pela sua API aqui
                // 'X-Custom-Header': 'valor'
            },
            timeout: 15000, // 15 segundos de timeout
        };

        this.onLog(`[PreSignedUrlService] Fazendo requisição ${options.method} para ${fullUrl.toString()}`);

        return new Promise((resolve, reject) => {
            const req = requestModule.request(fullUrl.toString(), options, (res) => {
                let responseBody = '';
                res.setEncoding('utf8');

                res.on('data', (chunk) => {
                    responseBody += chunk;
                });

                res.on('end', () => {
                    this.onLog(`[PreSignedUrlService] Resposta da API (${res.statusCode}) para ${fullUrl.toString()}: ${responseBody.substring(0, 200)}...`);
                    try {
                        if (res.statusCode >= 200 && res.statusCode < 300) {
                            const parsedResponse = JSON.parse(responseBody);
                            // Ajuste 'upload_url' e 'object_key' conforme a resposta real da sua API
                            if (!parsedResponse.upload_url) { 
                                this.onLog("[PreSignedUrlService] Erro: 'upload_url' não encontrada na resposta da API.");
                                reject(new Error("Resposta da API inválida: 'upload_url' ausente."));
                                return;
                            }
                            // Opcional: verificar por object_key se sua API o retorna e ele é crucial
                            // if (!parsedResponse.object_key) {
                            //     this.onLog("[PreSignedUrlService] AVISO: 'object_key' não encontrada na resposta da API. Usaremos um fallback.");
                            // }
                            resolve(parsedResponse); // Retorna o objeto JSON inteiro da resposta
                        } else {
                            this.onLog(`[PreSignedUrlService] Erro na API: Status ${res.statusCode}. Corpo: ${responseBody}`);
                            reject(new Error(`Falha na solicitação da URL pré-assinada (HTTP ${res.statusCode}): ${responseBody || 'Sem corpo de resposta'}`));
                        }
                    } catch (parseError) {
                        this.onLog(`[PreSignedUrlService] Erro ao parsear resposta JSON da API: ${parseError.message}. Corpo recebido: ${responseBody}`);
                        reject(new Error(`Erro ao processar resposta da API: ${parseError.message}`));
                    }
                });
            });

            req.on('error', (error) => {
                this.onLog(`[PreSignedUrlService] Erro na requisição HTTP(S) para ${fullUrl.toString()}: ${error.message}`);
                reject(new Error(`Erro de rede ao solicitar URL pré-assinada: ${error.message}`));
            });

            req.on('timeout', () => {
                this.onLog(`[PreSignedUrlService] Timeout na requisição HTTP(S) para ${fullUrl.toString()}.`);
                req.destroy(); // ou req.abort()
                reject(new Error('Timeout ao solicitar URL pré-assinada.'));
            });

            req.write(payload);
            req.end();
        });
    }
}

export default PreSignedUrlService;