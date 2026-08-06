/* =====================================================================
   ATLAS — Editor de texto rico (WYSIWYG) - Suporte Local & IA
   Upload de imagens via AtlasImgBB (ImgBB, gratuito) — nada de Base64
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
  function buildPlaceholderEl(initialText) {
    var span = document.createElement('span');
    span.className = 'atlas-editor-uploading';
    span.setAttribute('contenteditable', 'false');
    span.textContent = initialText || '⏳ Enviando imagem... 0%';
    span.style.display = 'inline-block';
    span.style.padding = '6px 10px';
    span.style.margin = '4px 0';
    span.style.borderRadius = '6px';
    span.style.background = 'rgba(0,0,0,0.06)';
    span.style.fontStyle = 'italic';
    span.style.fontSize = '0.9em';
    return span;
  }

  function checkImgBBAvailable() {
    if (!global.AtlasImgBB || typeof global.AtlasImgBB.upload !== 'function') {
      throw new Error(
        'O sistema de upload de imagens (atlas-imgbb.js) não foi carregado nesta página. ' +
        'Adicione <script src="atlas-imgbb.js"></script> antes do atlas-editor.js.'
      );
    }
  }

  /* Contador de uploads em andamento por área de edição, pra impedir que
     o formulário seja salvo ANTES de uma imagem colada/enviada terminar
     de subir (o que faria a nota salvar sem a imagem, silenciosamente). */
  function markUploadStart(area) {
    area._atlasPendingUploads = (area._atlasPendingUploads || 0) + 1;
  }
  function markUploadEnd(area) {
    area._atlasPendingUploads = Math.max(0, (area._atlasPendingUploads || 0) - 1);
  }

  /* Processa o arquivo escolhido do dispositivo */
  function processAndInsertFile(file, area, savedRange) {
    if (!file || !file.type || !file.type.startsWith('image/')) {
      alert('Por favor, selecione um arquivo de imagem válido.');
      return;
    }

    var placeholder = buildPlaceholderEl();
    insertNodeAtRange(area, savedRange, placeholder);

    try {
      checkImgBBAvailable();
    } catch (err) {
      console.error('[AtlasEditor]', err.message);
      placeholder.textContent = '⚠️ ' + err.message;
      placeholder.style.background = 'rgba(220,53,69,0.12)';
      placeholder.style.color = '#b02a37';
      return;
    }

    markUploadStart(area);
    global.AtlasImgBB.upload(file, function (percent) {
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
        console.error('[AtlasEditor] Erro ao enviar imagem:', err);
        if (placeholder.parentNode) {
          placeholder.textContent = '⚠️ Falha ao enviar imagem. Tente novamente.';
          placeholder.style.background = 'rgba(220,53,69,0.12)';
          placeholder.style.color = '#b02a37';
        }
        alert((err && err.message) || 'Não foi possível enviar a imagem. Verifique sua conexão.');
      })
      .finally(function () {
        markUploadEnd(area);
      });
  }

  /* Trata uma URL colada pelo usuário — SEMPRE tenta baixar a imagem e
     re-hospedar no ImgBB, mesmo que já seja http(s)://. Isso é essencial
     porque links de imagem de IAs (ChatGPT, Gemini, etc.) costumam ser
     temporários/assinados: parecem uma URL pública normal, mas expiram
     depois de um tempo e quebram a imagem salva. Só usamos o link original
     como último recurso, se o download falhar (ex: CORS bloqueado). */
  function processPastedUrl(url, area, savedRange) {
    var placeholder = buildPlaceholderEl('⏳ Importando imagem...');
    insertNodeAtRange(area, savedRange, placeholder);

    try {
      checkImgBBAvailable();
    } catch (err) {
      console.error('[AtlasEditor]', err.message);
      // Sem ImgBB disponível: melhor esforço, insere o link cru.
      if (/^https?:\/\//i.test(url)) {
        if (placeholder.parentNode) {
          placeholder.parentNode.replaceChild(buildImageEl(url), placeholder);
        }
      } else {
        placeholder.textContent = '⚠️ ' + err.message;
        placeholder.style.background = 'rgba(220,53,69,0.12)';
        placeholder.style.color = '#b02a37';
      }
      return;
    }

    markUploadStart(area);
    fetch(url, { mode: 'cors' })
      .then(function (res) {
        if (!res.ok) throw new Error('Não foi possível ler a imagem da URL fornecida (HTTP ' + res.status + ').');
        return res.blob();
      })
      .then(function (blob) {
        return global.AtlasImgBB.upload(blob, function (percent) {
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
        console.error('[AtlasEditor] Erro ao importar/re-hospedar URL colada:', err);
        // Fallback: se for http(s), tenta inserir o link original mesmo
        // assim (pode funcionar por um tempo, mas não é garantido).
        if (/^https?:\/\//i.test(url)) {
          if (placeholder.parentNode) {
            placeholder.parentNode.replaceChild(buildImageEl(url), placeholder);
          }
          console.warn('[AtlasEditor] Usando o link original sem re-hospedar. ' +
            'Se for um link temporário de IA, a imagem pode quebrar depois de um tempo.');
        } else if (placeholder.parentNode) {
          placeholder.textContent = '⚠️ Não foi possível importar essa imagem. Baixe-a no seu computador e envie pelo botão de upload.';
          placeholder.style.background = 'rgba(220,53,69,0.12)';
          placeholder.style.color = '#b02a37';
        }
      })
      .finally(function () {
        markUploadEnd(area);
      });
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
          var savedRangeLink = saveSelection(area);
          var selectedText = savedRangeLink.toString();

          var url = global.prompt('Cole o link (URL):', 'https://');
          if (!url || !url.trim()) return;
          url = url.trim();
          if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

          var linkText = selectedText;
          if (!linkText) {
            linkText = global.prompt('Texto do link (opcional):', url);
            if (linkText === null) return; // usuário cancelou
            linkText = linkText.trim() || url;
          }

          var linkEl = document.createElement('a');
          linkEl.href = url;
          linkEl.target = '_blank';
          linkEl.rel = 'noopener noreferrer';
          linkEl.textContent = linkText;

          insertNodeAtRange(area, savedRangeLink, linkEl);
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

    /* Suporte a colar imagem diretamente (Ctrl+V) — muito comum ao copiar
       um print, uma imagem do ChatGPT/Gemini, ou de outro site. */
    area.addEventListener('paste', function (e) {
      var items = e.clipboardData && e.clipboardData.items;
      if (!items) return;

      var imageItem = null;
      for (var i = 0; i < items.length; i++) {
        if (items[i].type && items[i].type.indexOf('image/') === 0) {
          imageItem = items[i];
          break;
        }
      }

      if (imageItem) {
        // Existe uma imagem na área de transferência: bloqueia o comportamento
        // padrão (que colaria a imagem como Base64 gigante) e faz upload.
        e.preventDefault();
        var file = imageItem.getAsFile();
        var savedRange = saveSelection(area);
        if (file) processAndInsertFile(file, area, savedRange);
        return;
      }

      // Se o texto colado for só uma URL (ex: link de YouTube, artigo, etc.),
      // transforma automaticamente em link clicável em vez de texto puro.
      var pastedText = e.clipboardData && e.clipboardData.getData('text/plain');
      if (pastedText && /^https?:\/\/\S+$/i.test(pastedText.trim())) {
        e.preventDefault();
        var urlTrimmed = pastedText.trim();
        var savedRangeUrl = saveSelection(area);
        var autoLink = document.createElement('a');
        autoLink.href = urlTrimmed;
        autoLink.target = '_blank';
        autoLink.rel = 'noopener noreferrer';
        autoLink.textContent = urlTrimmed;
        insertNodeAtRange(area, savedRangeUrl, autoLink);
      }
      // Caso contrário, deixa o paste padrão de texto acontecer normalmente.
    });

    var api = {
      focus: function () { area.focus(); },
      getHTML: function () { return area.innerHTML; },
      setHTML: function (html) { area.innerHTML = html || ''; },
      clear: function () { area.innerHTML = ''; },
      destroy: function () { container.innerHTML = ''; },
      hasPendingUploads: function () { return (area._atlasPendingUploads || 0) > 0; }
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
