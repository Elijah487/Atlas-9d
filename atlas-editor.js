/* =====================================================================
   ATLAS — Editor de texto rico (WYSIWYG) - Suporte Local & IA
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

  /* Função para desenhar a imagem de forma segura no editor */
  function renderImageInEditor(area, srcUrl) {
    area.focus();
    var img = document.createElement('img');
    img.src = srcUrl;
    img.style.maxWidth = '100%';
    img.style.height = 'auto';
    img.style.display = 'block';
    img.style.margin = '10px 0';
    img.style.borderRadius = '8px';

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

  /* Converte arquivo do PC/IA e redimensiona para não pesar no banco */
  function processAndInsertFile(file, area) {
    if (!file || !file.type.startsWith('image/')) {
      alert('Por favor, selecione um arquivo de imagem válido.');
      return;
    }

    var reader = new FileReader();
    reader.onload = function (e) {
      var tempImg = new Image();
      tempImg.onload = function () {
        var canvas = document.createElement('canvas');
        var maxWidth = 800; // Redimensiona para ser leve
        var width = tempImg.width;
        var height = tempImg.height;

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }

        canvas.width = width;
        canvas.height = height;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(tempImg, 0, 0, width, height);

        // Gera a imagem comprimida
        var compressedDataUrl = canvas.toDataURL('image/jpeg', 0.7);
        renderImageInEditor(area, compressedDataUrl);
      };
      tempImg.src = e.target.result;
    };
    reader.readAsDataURL(file);
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
          var escolha = global.confirm('Clique em "OK" para escolher uma imagem salva no seu computador/celular.\nOu clique em "Cancelar" para colar um Link (URL) da internet.');
          if (escolha) {
            setTimeout(function () {
              fileInput.click();
            }, 100);
          } else {
            var imgUrl = global.prompt('Cole o link (URL) da imagem:');
            if (imgUrl && imgUrl.trim() !== '') {
              renderImageInEditor(area, imgUrl.trim());
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
      if (file) {
        processAndInsertFile(file, area);
        fileInput.value = '';
      }
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
