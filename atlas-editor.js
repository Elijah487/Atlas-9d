/* =====================================================================
   ATLAS — Editor de texto rico (WYSIWYG) - Versão Direta
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
    { cmd: 'insertImageCustom', label: '📷 Imagem', title: 'Inserir imagem' },
    { type: 'sep' },
    { cmd: 'removeFormat', label: '⌫', title: 'Limpar formatação' }
  ];

  function buildToolbar(editorApi, area) {
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

        /* Inserção direta de imagem */
        if (btn.cmd === 'insertImageCustom') {
          var imgUrl = global.prompt('Cole o link/URL da imagem (ex: imagem de IA ou do web):');
          if (imgUrl && imgUrl.trim() !== '') {
            var imgHtml = '<br><img src="' + imgUrl.trim() + '" alt="Imagem" style="max-width:100%; height:auto; display:block; margin:10px 0; border-radius:8px;"><br>';
            document.execCommand('insertHTML', false, imgHtml);
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

    var api = {
      focus: function () { area.focus(); },
      getHTML: function () { return area.innerHTML; },
      setHTML: function (html) { area.innerHTML = html || ''; },
      clear: function () { area.innerHTML = ''; },
      destroy: function () { container.innerHTML = ''; }
    };

    var toolbar = buildToolbar(api, area);

    container.appendChild(toolbar);
    container.appendChild(area);

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

})(window);/* =====================================================================
   ATLAS — Editor de texto rico (WYSIWYG), reutilizável
   ---------------------------------------------------------------------
   Cria uma barra de ferramentas + área contenteditable dentro de um
   container já existente no HTML. Usado tanto no editor de anotações
   quanto no editor de respostas de tarefas.
   ===================================================================== */

(function (global) {
  'use strict';

  var TOOLBAR_BUTTONS = [
    { cmd: 'bold', label: 'B', title: 'Negrito (Ctrl+B)', style: 'font-weight:700;' },
    { cmd: 'italic', label: 'I', title: 'Itálico (Ctrl+I)', style: 'font-style:italic;' },
    { cmd: 'underline', label: 'S', title: 'Sublinhado (Ctrl+U)', style: 'text-decoration:underline;' },
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
    { cmd: 'createLink', label: '🔗', title: 'Inserir link', needsPrompt: 'url' },
    { cmd: 'uploadImage', label: '📷 Imagem', title: 'Inserir imagem do dispositivo ou URL' },
    { type: 'sep' },
    { cmd: 'removeFormat', label: '⌫', title: 'Limpar formatação' }
  ];

  /* Função auxiliar para inserir imagem via URL direta */
  function insertImageUrl(area, url) {
    if (!url) return;
    area.focus();
    var img = document.createElement('img');
    img.src = url;
    img.alt = 'Imagem anexada';

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
      el.setAttribute('data-cmd', btn.cmd);
      if (btn.style) el.setAttribute('style', btn.style);
      el.textContent = btn.label;

      el.addEventListener('click', function (e) {
        e.preventDefault();
        editorApi.focus();

        if (btn.needsPrompt === 'url') {
          var url = global.prompt('Cole o link (URL):', 'https://');
          if (url) document.execCommand('createLink', false, url);
          return;
        }

        /* Botão de Imagem */
        if (btn.cmd === 'uploadImage') {
          var opcao = global.confirm('Clique em "OK" para carregar do seu dispositivo ou "Cancelar" para colar um link (URL).');
          if (opcao) {
            setTimeout(function () {
              fileInput.click();
            }, 100);
          } else {
            var imgUrl = global.prompt('Cole a URL da imagem:', 'https://');
            if (imgUrl) insertImageUrl(area, imgUrl);
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

    /* Input oculto de ficheiros */
    var fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';

    fileInput.addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;

      var atlasData = global.AtlasData;
      if (!atlasData || typeof atlasData.uploadImageToStorage !== 'function') {
        alert('Aguarde o carregamento do sistema e tente novamente.');
        fileInput.value = '';
        return;
      }

      fileInput.disabled = true;

      /* Faz o envio ao Firebase Storage */
      atlasData.uploadImageToStorage(file, 'editor', atlasData.uid())
        .then(function (downloadUrl) {
          insertImageUrl(area, downloadUrl);
          fileInput.value = '';
          fileInput.disabled = false;
        })
        .catch(function (err) {
          console.error('AtlasEditor: erro no envio', err);
          alert((err && err.message) || 'Erro ao enviar a imagem. Tente novamente.');
          fileInput.value = '';
          fileInput.disabled = false;
        });
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

    area.addEventListener('keydown', function (e) {
      var isMod = e.ctrlKey || e.metaKey;
      if (isMod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        var url = global.prompt('Cole o link (URL):', 'https://');
        if (url) document.execCommand('createLink', false, url);
      }
    });

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
