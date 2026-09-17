/* =====================================================================
   NEXOS — Upload de imagens via ImgBB (gratuito, sem cartão de crédito)
   Substitui o Firebase Storage (que agora exige plano pago Blaze).
   Comprime a imagem no navegador antes de enviar, pra manter os
   uploads rápidos e leves.
   ===================================================================== */
(function (global) {
  'use strict';

  /* Sua chave da API do ImgBB (https://api.imgbb.com/) */
  var IMGBB_API_KEY = '3ae5e8c5d5420f3b6e3e17e47bb9bf46';
  var IMGBB_ENDPOINT = 'https://api.imgbb.com/1/upload';

  /* Redimensiona e comprime a imagem no navegador antes de enviar,
     pra não gastar banda subindo fotos de 8-12MB de câmera de celular. */
  function compressImage(file, maxWidth) {
    maxWidth = maxWidth || 1200;
    return new Promise(function (resolve, reject) {
      if (!file || !file.type || !file.type.match(/^image\//)) {
        reject(new Error('O arquivo selecionado não é uma imagem válida.'));
        return;
      }
      if (file.size > 15 * 1024 * 1024) {
        reject(new Error('A imagem excede o tamanho máximo permitido de 15 MB.'));
        return;
      }

      var reader = new FileReader();
      reader.onload = function (e) {
        var img = new Image();
        img.onload = function () {
          var width = img.width;
          var height = img.height;
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
          var canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          var ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          canvas.toBlob(
            function (blob) {
              if (blob) resolve(blob);
              else reject(new Error('Falha ao processar a imagem.'));
            },
            'image/jpeg',
            0.85
          );
        };
        img.onerror = function () { reject(new Error('Erro ao carregar a imagem.')); };
        img.src = e.target.result;
      };
      reader.onerror = function () { reject(new Error('Erro ao ler o arquivo.')); };
      reader.readAsDataURL(file);
    });
  }

  /* Faz o upload em si via XMLHttpRequest (pra ter progresso real, %
     do envio — fetch() não expõe progresso de upload facilmente). */
  function sendToImgBB(blob, onProgress) {
    return new Promise(function (resolve, reject) {
      var formData = new FormData();
      formData.append('image', blob, 'imagem.jpg');

      var xhr = new XMLHttpRequest();
      xhr.open('POST', IMGBB_ENDPOINT + '?key=' + IMGBB_API_KEY, true);

      xhr.upload.onprogress = function (evt) {
        if (typeof onProgress === 'function' && evt.lengthComputable) {
          var percent = Math.round((evt.loaded / evt.total) * 100);
          onProgress(percent);
        }
      };

      xhr.onload = function () {
        var response;
        try {
          response = JSON.parse(xhr.responseText);
        } catch (e) {
          reject(new Error('Resposta inválida do ImgBB.'));
          return;
        }
        if (xhr.status >= 200 && xhr.status < 300 && response && response.success && response.data) {
          resolve(response.data.url || response.data.display_url);
        } else {
          var msg = (response && response.error && response.error.message) || ('Erro HTTP ' + xhr.status);
          reject(new Error('Falha no upload para o ImgBB: ' + msg));
        }
      };

      xhr.onerror = function () {
        reject(new Error('Erro de rede ao enviar a imagem para o ImgBB.'));
      };

      xhr.send(formData);
    });
  }

  /* API pública: recebe um File ou Blob, devolve Promise<url> */
  function upload(fileOrBlob, onProgress) {
    if (!fileOrBlob) return Promise.resolve('');
    return compressImage(fileOrBlob).then(function (compressedBlob) {
      return sendToImgBB(compressedBlob, onProgress);
    });
  }

  global.NexosImgBB = {
    upload: upload
  };

})(window);
