/* =====================================================================
   ATLAS — Editor de texto rico (WYSIWYG) - Suporte Local & IA
   Upload de imagens via AtlasData.uploadImageToStorage (Firebase Storage,
   SDK modular v10 — o mesmo usado no atlas-data.js). Nada de Base64
   gigante indo pro Realtime Database.
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
      if (area.contains(range.commonAncestorContainer)) {
        return range.cloneRange();
      }
    }
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

  function insertNodeAtRange(area, savedRange, node) {
    area.focus();
    try {
      restoreSelection(savedRange);
      var sel = global.getSelection();
      var range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(node);
      range.setStartAfter(node);
      range.setEndAfter(node);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (err) {
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

  /* Placeholder visual enquanto o upload roda (com % de progresso) */
  function buildPlaceholderEl() {
    var span = document.createElement('span');
    span.className = 'atlas-editor-uploading';
    span.setAttribute('contenteditable', 'false');
    span.textContent = '⏳ Enviando imagem... 0%';
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
     Espera o AtlasData (atlas-data.js, módulo Firebase v10) estar pronto.
     atlas-data.js é carregado como <script type="module">, então pode
     ainda não existir no momento em que o editor é criado.
     --------------------------------------------------------------------- */
  function whenAtlasDataReady(callback) {
    if (global.AtlasData && typeof global.AtlasData.uploadImageToStorage === 'function') {
      if (typeof global.AtlasData.onFirebaseReady === 'function') {
        global.AtlasData.onFirebaseReady(callback);
      } else {
        callback();
      }
      return;
    }
    document.addEventListener('atlas-data-ready', function handler() {
      document.removeEventListener('atlas-data-ready', handler);
      whenAtlasDataReady(callback);
    });
  }

  /* Faz upload de um File/Blob usando o pipeline já existente do
     atlas-data.js (compressão + retry + getDownloadURL). Cada imagem do
     editor recebe um ID próprio (não reaproveita o id da nota/tarefa),
     senão duas imagens na mesma nota se sobrescreveriam no Storage. */
  function uploadViaAtlasData(fileOrBlob, onProgress) {
    return new Promise(function (resolve, reject) {
      whenAtlasDataReady(function () {
        var uniqueId = global.AtlasData.uid ? global.AtlasData.uid() : (Date.now() + '-' + Math.random().toString(36).slice(2, 9));
        global.AtlasData
          .uploadImageToStorage(fileOrBlob, 'editor-conteudo', uniqueId, onProgress)
          .then(resolve)
          .catch(reject);
      });
    });
  }

  /* Processa o arquivo escolhido do dispositivo */
  function processAndInsertFile(file, area, savedRange) {
    if (!file || !file.type || !file.type.startsWith('image/')) {
      alert('Por favor, selecione um arquivo de imagem válido.');
      return;
    }

    var placeholder = buildPlaceholderEl();
    insertNodeAtRange(area, savedRange, placeholder);

    uploadViaAtlasData(file, function (percent) {
      if (placeholder.parentNode) {
        placeholder.textContent = '⏳ Enviando imagem... ' + percent + '%';
      }
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
        alert('Não foi possível enviar a imagem. Verifique sua conexão ou tente novamente em instantes.');
      });
  }

  /* Trata uma URL colada pelo usuário.
     - http(s)://... -> já é pública, insere direto.
     - data:...        -> Base64 embutido (comum em respostas de IA),
                          precisa virar Blob e subir pro Storage.
     - blob:...        -> URL temporária de sessão do navegador (também
                          comum em IAs tipo ChatGPT/Gemini), idem. */
  function processPastedUrl(url, area, savedRange) {
    if (/^https?:\/\//i.test(url)) {
      renderImageInEditor(area, url, savedRange);
      return;
    }

    if (/^data:image\//i.test(url) || /^blob:/i.test(url)) {
      var placeholder = buildPlaceholderEl();
      placeholder.textContent = '⏳ Importando imagem...';
      insertNodeAtRange(area, savedRange, placeholder);

      fetch(url)
        .then(function (res) {
          if (!res.ok) throw new Error('Não foi possível ler a imagem da URL fornecida.');
          return res.blob();
        })
        .then(function (blob) {
          return uploadViaAtlasData(blob, function (percent) {
            if (placeholder.parentNode) {
              placeholder.textContent = '⏳ Importando imagem... ' + percent + '%';
            }
          });
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

    // Esquema desconhecido: tenta inserir direto mesmo assim.
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

        if (btn.cmd === 'uploadImageBtn') {
          var savedRange = saveSelection(area);

          var escolha = global.confirm(
            'Clique em "OK" para escolher uma imagem salva no seu computador/celular.\n' +
            'Ou clique em "Cancelar" para colar um Link (URL) da internet.'
          );

          if (escolha) {
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
