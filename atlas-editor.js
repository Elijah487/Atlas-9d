/* =====================================================================
   ATLAS — Editor de texto rico (WYSIWYG) - Suporte Local & IA
   Upload de imagens via Firebase Storage (sem Base64 gigante no Realtime DB)
   ===================================================================== */
(function (global) {
  'use strict';

  var TOOLBAR_BUTTONS = [
    { cmd: 'bold', label: 'B', title: 'Negrito' },
    { cmd: 'italic', label: 'I', title: 'Itálico' },
    { cmd: 'underline', label: 'S', title: 'Sublinhado' },
    { type: 'sep' },
    { cmd: 'formatBlock', value: 'H1', label: 'H1', title: 'Título 1' },
    { cmd: 'formatBlock', value: 'H2', label: 'H2', title: 'Título 2' },
    { cmd: 'formatBlock', value: 'H3', label: 'H3', title: 'Título 3' },
    { type: 'sep' },
    { cmd: 'insertUnorderedList', label: '•—', title: 'Lista com marcadores' },
    { cmd: 'insertOrderedList', label: '1.', title: 'Lista numerada' },
    { cmd: 'formatBlock', value: 'BLOCKQUOTE', label: '"', title: 'Citação' },
    { type: 'sep' },
    { cmd: 'insertHorizontalRule', label: '—', title: 'Separador' },
    { cmd: 'createLink', label: '🔗', title: 'Inserir link' },
    { cmd: 'uploadImageBtn', label: '📷 Imagem', title: 'Inserir imagem do PC, IA ou Link' },
    { type: 'sep' },
    { cmd: 'removeFormat', label: '⌫', title: 'Limpar formatação' }
  ];

  /* ---------------------------------------------------------------------
     Seleção / Cursor: precisamos guardar onde o usuário estava digitando
     ANTES de disparar o upload assíncrono, porque o foco se perde durante
     o diálogo de escolha de arquivo / requisição de rede.
     --------------------------------------------------------------------- */
  function saveSelection(area) {
    var sel = global.getSelection();
    if (sel && sel.rangeCount > 0) {
      var range = sel.getRangeAt(0);
      // Garante que a seleção pertence à área do editor
      if (area.contains(range.commonAncestorContainer)) {
        return range.cloneRange();
      }
    }
    // Fallback: cursor no fim do conteúdo
    var fallback = document.createRange();
    fallback.selectNodeContents(area);
    fallback.collapse(false);
    return fallback;
  }

  function restoreSelection(savedRange) {
    var sel = global.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRange);
  }

  /* Insere um nó (imagem ou placeholder) na posição de um Range salvo */
  function insertNodeAtRange(area, savedRange, node) {
    area.focus();
    try {
      restoreSelection(savedRange);
      var sel = global.getSelection();
      var range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(node);
      // move o cursor para depois do nó inserido
      range.setStartAfter(node);
      range.setEndAfter(node);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (err) {
      // Se o range salvo não for mais válido (DOM mudou), insere no fim
      area.appendChild(node);
    }
  }

  function buildImageEl(srcUrl) {
    var img = document.createElement('img');
    img.src = srcUrl;
    img.style.maxWidth = '100%';
    img.style.height = 'auto';
    img.style.display = 'block';
    img.style.margin = '10px 0';
    img.style.borderRadius = '8px';
    return img;
  }

  function renderImageInEditor(area, srcUrl, savedRange) {
    var img = buildImageEl(srcUrl);
    if (savedRange) {
      insertNodeAtRange(area, savedRange, img);
    } else {
      area.focus();
      var sel = global.getSelection();
      if (sel && sel.rangeCount > 0) {
        var range = sel.getRangeAt(0);
        range.deleteContents();
        range.insertNode(img);
        range.collapse(false);
      } else {
        area.appendChild(img);
      }
    }
  }

  /* Placeholder visual enquanto o upload roda */
  function buildPlaceholderEl() {
    var span = document.createElement('span');
    span.className = 'atlas-editor-uploading';
    span.setAttribute('contenteditable', 'false');
    span.textContent = '⏳ Enviando imagem...';
    span.style.display = 'inline-block';
    span.style.padding = '6px 10px';
    span.style.margin = '4px 0';
    span.style.borderRadius = '6px';
    span.style.background = 'rgba(0,0,0,0.06)';
    span.style.fontStyle = 'italic';
    span.style.fontSize = '0.9em';
    return span;
  }

  /* ---------------------------------------------------------------------
     Upload para o Firebase Storage.
     Requer que 'firebase' (compat SDK) já esteja inicializado na página,
     com firebase.storage() disponível.
     --------------------------------------------------------------------- */
  function uploadToFirebaseStorage(file, options) {
    options = options || {};
    if (!global.firebase || !global.firebase.storage) {
      return Promise.reject(new Error(
        'Firebase Storage não está disponível. Verifique se o SDK do Firebase ' +
        '(app + storage) foi carregado e inicializado antes do atlas-editor.js.'
      ));
    }

    var folder = options.folder || 'atlas-editor-images';
    var safeName = (file.name || 'imagem')
      .toLowerCase()
      .replace(/[^a-z0-9.\-_]/g, '-');
    var fileName = Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '-' + safeName;
    var path = folder + '/' + fileName;

    var storageRef = global.firebase.storage().ref().child(path);
    var uploadTask = storageRef.put(file);

    return new Promise(function (resolve, reject) {
      uploadTask.on(
        'state_changed',
        null,
        function (error) {
          reject(error);
        },
        function () {
          uploadTask.snapshot.ref.getDownloadURL().then(function (url) {
            resolve(url);
          }).catch(reject);
        }
      );
    });
  }

  /* Redimensiona a imagem no client antes do upload, pra não mandar arquivos
     gigantes pro Storage (mantém qualidade boa, mas controla o tamanho). */
  function resizeImageFile(file, maxWidth) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function (e) {
        var tempImg = new Image();
        tempImg.onload = function () {
          var width = tempImg.width;
          var height = tempImg.height;
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
          var canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          var ctx = canvas.getContext('2d');
          ctx.drawImage(tempImg, 0, 0, width, height);
          canvas.toBlob(function (blob) {
            if (!blob) {
              reject(new Error('Falha ao converter imagem.'));
              return;
            }
            resolve(blob);
          }, 'image/jpeg', 0.82);
        };
        tempImg.onerror = reject;
        tempImg.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  /* Processa o arquivo escolhido: redimensiona -> sobe pro Storage -> insere URL */
  function processAndInsertFile(file, area, savedRange) {
    if (!file || !file.type.startsWith('image/')) {
      alert('Por favor, selecione um arquivo de imagem válido.');
      return;
    }

    var placeholder = buildPlaceholderEl();
    insertNodeAtRange(area, savedRange, placeholder);

    resizeImageFile(file, 1600)
      .then(function (blob) {
        return uploadToFirebaseStorage(blob, { folder: 'atlas-editor-images' });
      })
      .then(function (downloadUrl) {
        var img = buildImageEl(downloadUrl);
        if (placeholder.parentNode) {
          placeholder.parentNode.replaceChild(img, placeholder);
        } else {
          area.appendChild(img);
        }
      })
      .catch(function (err) {
        console.error('[AtlasEditor] Erro ao enviar imagem para o Firebase Storage:', err);
        if (placeholder.parentNode) {
          placeholder.textContent = '⚠️ Falha ao enviar imagem. Tente novamente.';
          placeholder.style.background = 'rgba(220,53,69,0.12)';
          placeholder.style.color = '#b02a37';
        }
        alert('Não foi possível enviar a imagem. Verifique sua conexão ou as regras do Firebase Storage.');
      });
  }

  /* Trata uma URL colada pelo usuário.
     - http(s)://... -> imagem já está hospedada publicamente, insere direto.
     - data:...       -> Base64 embutido (comum em respostas de IA), precisa
                          virar Blob e subir pro Storage, senão o link some.
     - blob:...        -> URL temporária de sessão do navegador (também comum
                          em IAs tipo ChatGPT/Gemini), também precisa subir
                          pro Storage porque deixa de existir depois. */
  function processPastedUrl(url, area, savedRange) {
    if (/^https?:\/\//i.test(url)) {
      renderImageInEditor(area, url, savedRange);
      return;
    }

    if (/^data:image\//i.test(url) || /^blob:/i.test(url)) {
      var placeholder = buildPlaceholderEl();
      insertNodeAtRange(area, savedRange, placeholder);

      fetch(url)
        .then(function (res) {
          if (!res.ok) throw new Error('Não foi possível ler a imagem da URL fornecida.');
          return res.blob();
        })
        .then(function (blob) {
          return uploadToFirebaseStorage(blob, { folder: 'atlas-editor-images' });
        })
        .then(function (downloadUrl) {
          var img = buildImageEl(downloadUrl);
          if (placeholder.parentNode) {
            placeholder.parentNode.replaceChild(img, placeholder);
          } else {
            area.appendChild(img);
          }
        })
        .catch(function (err) {
          console.error('[AtlasEditor] Erro ao processar URL colada (data:/blob:):', err);
          if (placeholder.parentNode) {
            placeholder.textContent = '⚠️ Não foi possível importar essa imagem. Baixe-a e faça upload pelo computador.';
            placeholder.style.background = 'rgba(220,53,69,0.12)';
            placeholder.style.color = '#b02a37';
          }
        });
      return;
    }

    // Qualquer outro esquema desconhecido: tenta inserir direto mesmo assim.
    renderImageInEditor(area, url, savedRange);
  }

  function buildToolbar(editorApi, fileInput, area) {
    var bar = document.createElement('div');
    bar.className = 'atlas-editor-toolbar';

    TOOLBAR_BUTTONS.forEach(function (btn) {
      if (btn.type === 'sep') {
        var sep = document.createElement('span');
        sep.className = 'atlas-editor-sep';
        bar.appendChild(sep);
        return;
      }

      var el = document.createElement('button');
      el.type = 'button';
      el.className = 'atlas-editor-btn';
      el.title = btn.title;
      el.textContent = btn.label;

      el.addEventListener('click', function (e) {
        e.preventDefault();
        area.focus();

        if (btn.cmd === 'createLink') {
          var url = global.prompt('Cole o link (URL):', 'https://');
          if (url) document.execCommand('createLink', false, url);
          return;
        }

        /* Botão de Imagem */
        if (btn.cmd === 'uploadImageBtn') {
          // Salva a posição do cursor ANTES de abrir qualquer diálogo,
          // pois o foco muda assim que o <input type="file"> ou o prompt() abre.
          var savedRange = saveSelection(area);

          var escolha = global.confirm(
            'Clique em "OK" para escolher uma imagem salva no seu computador/celular.\n' +
            'Ou clique em "Cancelar" para colar um Link (URL) da internet.'
          );

          if (escolha) {
            // guarda o range no próprio input, pro listener de 'change' usar depois
            fileInput._atlasSavedRange = savedRange;
            setTimeout(function () {
              fileInput.click();
            }, 100);
          } else {
            var imgUrl = global.prompt('Cole o link (URL) da imagem:');
            if (imgUrl && imgUrl.trim() !== '') {
              processPastedUrl(imgUrl.trim(), area, savedRange);
            }
          }
          return;
        }

        if (btn.cmd === 'formatBlock') {
          document.execCommand('formatBlock', false, btn.value);
          return;
        }

        document.execCommand(btn.cmd, false, null);
      });

      bar.appendChild(el);
    });

    return bar;
  }

  function create(container, options) {
    options = options || {};
    container.innerHTML = '';
    container.classList.add('atlas-editor');

    var area = document.createElement('div');
    area.className = 'atlas-editor-area';
    area.setAttribute('contenteditable', 'true');
    area.setAttribute('data-placeholder', options.placeholder || 'Escreva aqui...');
    if (options.minHeight) area.style.minHeight = options.minHeight;

    /* Input de arquivo para o PC / IA */
    var fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      var savedRange = fileInput._atlasSavedRange || saveSelection(area);
      if (file) {
        processAndInsertFile(file, area, savedRange);
      }
      fileInput._atlasSavedRange = null;
      fileInput.value = '';
    });

    var api = {
      focus: function () { area.focus(); },
      getHTML: function () { return area.innerHTML; },
      setHTML: function (html) { area.innerHTML = html || ''; },
      clear: function () { area.innerHTML = ''; },
      destroy: function () { container.innerHTML = ''; }
    };

    var toolbar = buildToolbar(api, fileInput, area);
    container.appendChild(toolbar);
    container.appendChild(area);
    container.appendChild(fileInput);

    return api;
  }

  function renderReadOnly(container, html) {
    container.classList.add('atlas-editor-readonly');
    container.innerHTML = html || '<p class="atlas-editor-empty">Sem conteúdo.</p>';
  }

  global.AtlasEditor = {
    create: create,
    renderReadOnly: renderReadOnly
  };

})(window);
