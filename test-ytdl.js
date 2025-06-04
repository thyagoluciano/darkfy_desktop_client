// test-ytdl.js
const ytdl = require('ytdl-core');
const fs = require('fs');

const videoUrl = 'https://www.youtube.com/watch?v=D6pJEva-dDE'; // Use a URL convertida do seu Short
// Ou a original do short: 'https://www.youtube.com/shorts/D6pJEva-dDE'

async function testDownload() {
  console.log(`Tentando baixar: ${videoUrl}`);
  try {
    // Tenta obter informações primeiro
    console.log('Obtendo informações do vídeo...');
    const info = await ytdl.getInfo(videoUrl);
    console.log('Título:', info.videoDetails.title);
    
    // Logar alguns formatos para ver o que está disponível
    // console.log('Formatos disponíveis:', info.formats.map(f => ({itag: f.itag, qualityLabel: f.qualityLabel, container: f.container, hasAudio: f.hasAudio, hasVideo: f.hasVideo })));

    const videoStream = ytdl(videoUrl, {
      quality: 'highest',
      // filter: 'audioandvideo', // Tente com e sem esse filtro
    });

    const filePath = 'test_video.mp4';
    const fileStream = fs.createWriteStream(filePath);

    videoStream.on('progress', (chunkLength, downloaded, total) => {
      const percent = total ? (downloaded / total) * 100 : 0;
      process.stdout.write(`Progresso: ${percent.toFixed(2)}% \r`);
    });

    videoStream.on('error', (err) => {
      console.error('\nErro no stream do ytdl:', err);
    });

    fileStream.on('finish', () => {
      console.log(`\nDownload concluído: ${filePath}`);
    });

    videoStream.pipe(fileStream);

  } catch (error) {
    console.error('Erro ao processar com ytdl-core:', error);
    if (error.message.includes('private video')) {
        console.log('O vídeo pode ser privado ou requerer login.');
    }
    if (error.message.includes('age-restricted')) {
        console.log('O vídeo pode ter restrição de idade.');
    }
  }
}

testDownload();