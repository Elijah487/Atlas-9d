/* =====================================================================
   NEXOS — Editor de texto rico (WYSIWYG) - Suporte Local & IA
   Upload de imagens via NexosImgBB (ImgBB, gratuito) — nada de Base64
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

  /* ---------------------------------------------------------------------
     Regex de URL usada tanto no auto-link ao colar quanto no link manual.
     Aceita URLs "soltas" dentro de um texto maior (não só quando o texto
     colado é 100% a URL), e não engole pontuação de fechamento de frase
     colada logo depois do link (. , ) ] etc.).
     --------------------------------------------------------------------- */
  var URL_REGEX = /https?:\/\/[^\s<>"']+/gi;

  function stripTrailingPunctuation(url) {
    var trail = '';
    while (url.length && /[.,;:!?)\]}'"]$/.test(url)) {
      trail = url.slice(-1) + trail;
      url = url.slice(0, -1);
    }
    return { url: url, trail: trail };
  }

  /* Converte um bloco de texto puro em um fragmento com <a> nos trechos
     que são URLs e nós de texto no restante, preservando quebras de
     linha como <br>. Usado no paste (ver evento 'paste' abaixo). */
  function linkifyTextToFragment(text) {
    var frag = document.createDocumentFragment();
    var lines = text.split(/\r\n|\r|\n/);

    lines.forEach(function (line, lineIdx) {
      var lastIndex = 0;
      var match;
      URL_REGEX.lastIndex = 0;
      while ((match = URL_REGEX.exec(line)) !== null) {
        if (match.index > lastIndex) {
          frag.appendChild(document.createTextNode(line.slice(lastIndex, match.index)));
        }
        var cleaned = stripTrailingPunctuation(match[0]);
        var a = document.createElement('a');
        a.href = cleaned.url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = cleaned.url;
        frag.appendChild(a);
        if (cleaned.trail) frag.appendChild(document.createTextNode(cleaned.trail));
        lastIndex = match.index + match[0].length;
      }
      if (lastIndex < line.length) {
        frag.appendChild(document.createTextNode(line.slice(lastIndex)));
      }
      if (lineIdx < lines.length - 1) {
        frag.appendChild(document.createElement('br'));
      }
    });

    return frag;
  }

  /* ---------------------------------------------------------------------
     Modal próprio para inserir link, substituindo window.prompt().
     window.prompt()/confirm() são bloqueados (retornam null sem exibir
     nada) em vários WebViews de app/PWA no celular — o que fazia o botão
     de link parecer "não funcionar". Este modal funciona em qualquer
     navegador ou WebView.
     --------------------------------------------------------------------- */
  function openLinkModal(defaultText, onConfirm) {
    var overlay = document.createElement('div');
    overlay.className = 'nexos-editor-modal-overlay';

    var modal = document.createElement('div');
    modal.className = 'nexos-editor-modal';

    modal.innerHTML =
      '<h3 class="nexos-editor-modal-title">Inserir link</h3>' +
      '<label class="nexos-editor-modal-label">URL</label>' +
      '<input type="text" class="nexos-editor-modal-input" data-role="url" placeholder="https://exemplo.com" autocomplete="off">' +
      '<label class="nexos-editor-modal-label">Texto do link</label>' +
      '<input type="text" class="nexos-editor-modal-input" data-role="text" placeholder="Texto que vai aparecer" autocomplete="off">' +
      '<div class="nexos-editor-modal-actions">' +
        '<button type="button" class="nexos-editor-modal-btn nexos-editor-modal-btn-cancel" data-role="cancel">Cancelar</button>' +
        '<button type="button" class="nexos-editor-modal-btn nexos-editor-modal-btn-ok" data-role="ok">Inserir</button>' +
      '</div>';

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    var urlInput = modal.querySelector('[data-role="url"]');
    var textInput = modal.querySelector('[data-role="text"]');
    var okBtn = modal.querySelector('[data-role="ok"]');
    var cancelBtn = modal.querySelector('[data-role="cancel"]');

    textInput.value = defaultText || '';

    function close() {
      document.removeEventListener('keydown', onKeydown);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }

    function confirm() {
      var url = urlInput.value.trim();
      if (!url) {
        urlInput.focus();
        return;
      }
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
      var linkText = textInput.value.trim() || url;
      close();
      onConfirm(url, linkText);
    }

    function onKeydown(e) {
      if (e.key === 'Escape') close();
      if (e.key === 'Enter') { e.preventDefault(); confirm(); }
    }

    okBtn.addEventListener('click', confirm);
    cancelBtn.addEventListener('click', close);
    overlay.addEventListener('mousedown', function (e) {
      if (e.target === overlay) close();
    });
    document.addEventListener('keydown', onKeydown);

    setTimeout(function () { urlInput.focus(); }, 30);
  }

  function insertNodeAtRange(area, savedRange, node) {
    area.focus();
    try {
      restoreSelection(savedRange);
      var sel = global.getSelection();
      var range = sel.getRangeAt(0);
      range.deleteContents();

      // DocumentFragment vira "vazio" depois de inserido (os filhos são
      // movidos para o range) — precisamos guardar uma referência ao
      // último filho ANTES de inserir para posicionar o cursor depois.
      var isFragment = node.nodeType === 11; // DOCUMENT_FRAGMENT_NODE
      var refNode = isFragment ? node.lastChild : node;

      range.insertNode(node);

      if (refNode) {
        range.setStartAfter(refNode);
        range.setEndAfter(refNode);
        sel.removeAllRanges();
        sel.addRange(range);
      }
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
    span.className = 'nexos-editor-uploading';
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
    if (!global.NexosImgBB || typeof global.NexosImgBB.upload !== 'function') {
      throw new Error(
        'O sistema de upload de imagens (nexos-imgbb.js) não foi carregado nesta página. ' +
        'Adicione <script src="nexos-imgbb.js"></script> antes do nexos-editor.js.'
      );
    }
  }

  /* Contador de uploads em andamento por área de edição, pra impedir que
     o formulário seja salvo ANTES de uma imagem colada/enviada terminar
     de subir (o que faria a nota salvar sem a imagem, silenciosamente). */
  function markUploadStart(area) {
    area._nexosPendingUploads = (area._nexosPendingUploads || 0) + 1;
  }
  function markUploadEnd(area) {
    area._nexosPendingUploads = Math.max(0, (area._nexosPendingUploads || 0) - 1);
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
      console.error('[NexosEditor]', err.message);
      placeholder.textContent = '⚠️ ' + err.message;
      placeholder.style.background = 'rgba(220,53,69,0.12)';
      placeholder.style.color = '#b02a37';
      return;
    }

    markUploadStart(area);
    global.NexosImgBB.upload(file, function (percent) {
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
        console.error('[NexosEditor] Erro ao enviar imagem:', err);
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
      console.error('[NexosEditor]', err.message);
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
        return global.NexosImgBB.upload(blob, function (percent) {
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
        console.error('[NexosEditor] Erro ao importar/re-hospedar URL colada:', err);
        // Fallback: se for http(s), tenta inserir o link original mesmo
        // assim (pode funcionar por um tempo, mas não é garantido).
        if (/^https?:\/\//i.test(url)) {
          if (placeholder.parentNode) {
            placeholder.parentNode.replaceChild(buildImageEl(url), placeholder);
          }
          console.warn('[NexosEditor] Usando o link original sem re-hospedar. ' +
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
    bar.className = 'nexos-editor-toolbar';

    TOOLBAR_BUTTONS.forEach(function (btn) {
      if (btn.type === 'sep') {
        var sep = document.createElement('span');
        sep.className = 'nexos-editor-sep';
        bar.appendChild(sep);
        return;
      }

      var el = document.createElement('button');
      el.type = 'button';
      el.className = 'nexos-editor-btn';
      el.title = btn.title;
      el.textContent = btn.label;

      /* CRÍTICO: sem isto, o mousedown no botão tira o foco (e a seleção
         de texto) da área de edição ANTES do 'click' disparar — fazendo o
         botão de link "não funcionar" (a seleção já tinha sumido quando
         o código ia lê-la). preventDefault aqui mantém o editor focado. */
      el.addEventListener('mousedown', function (e) {
        e.preventDefault();
      });

      el.addEventListener('click', function (e) {
        e.preventDefault();

        if (btn.cmd === 'createLink') {
          var savedRangeLink = saveSelection(area);
          var selectedText = savedRangeLink.toString();

          openLinkModal(selectedText, function (url, linkText) {
            var linkEl = document.createElement('a');
            linkEl.href = url;
            linkEl.target = '_blank';
            linkEl.rel = 'noopener noreferrer';
            linkEl.textContent = linkText;
            insertNodeAtRange(area, savedRangeLink, linkEl);
          });
          return;
        }

        area.focus();

        if (btn.cmd === 'uploadImageBtn') {
          var savedRange = saveSelection(area);

          var escolha = global.confirm(
            'Clique em "OK" para escolher uma imagem salva no seu computador/celular.\n' +
            'Ou clique em "Cancelar" para colar um Link (URL) da internet.'
          );

          if (escolha) {
            fileInput._nexosSavedRange = savedRange;
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
    container.classList.add('nexos-editor');

    var area = document.createElement('div');
    area.className = 'nexos-editor-area';
    area.setAttribute('contenteditable', 'true');
    area.setAttribute('data-placeholder', options.placeholder || 'Escreva aqui...');
    if (options.minHeight) area.style.minHeight = options.minHeight;

    var fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      var savedRange = fileInput._nexosSavedRange || saveSelection(area);
      if (file) {
        processAndInsertFile(file, area, savedRange);
      }
      fileInput._nexosSavedRange = null;
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

      // Se o texto colado contém alguma URL (seja ele só a URL, seja um
      // trecho maior de texto com uma URL no meio/fim), transforma essa
      // parte automaticamente em link clicável, mantendo o resto como
      // texto normal. Antes isso só funcionava quando o texto colado era
      // 100% a URL — o que fazia links colados junto de outro conteúdo
      // (ex.: um título em cima do link) virarem texto puro.
      var pastedText = e.clipboardData && e.clipboardData.getData('text/plain');
      if (pastedText && /https?:\/\//i.test(pastedText)) {
        e.preventDefault();
        var savedRangeUrl = saveSelection(area);
        var fragment = linkifyTextToFragment(pastedText);
        insertNodeAtRange(area, savedRangeUrl, fragment);
      }
      // Caso contrário, deixa o paste padrão de texto acontecer normalmente.
    });

    var api = {
      focus: function () { area.focus(); },
      getHTML: function () { return area.innerHTML; },
      setHTML: function (html) { area.innerHTML = html || ''; },
      clear: function () { area.innerHTML = ''; },
      destroy: function () { container.innerHTML = ''; },
      hasPendingUploads: function () { return (area._nexosPendingUploads || 0) > 0; }
    };

    var toolbar = buildToolbar(api, fileInput, area);
    container.appendChild(toolbar);
    container.appendChild(area);
    container.appendChild(fileInput);

    return api;
  }

  function renderReadOnly(container, html) {
    container.classList.add('nexos-editor-readonly');
    container.innerHTML = html || '<p class="nexos-editor-empty">Sem conteúdo.</p>';
  }

  global.NexosEditor = {
    create: create,
    renderReadOnly: renderReadOnly
  };

})(window);
