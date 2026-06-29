/* =====================================================================
   ATLAS — Editor de texto rico (WYSIWYG), reutilizável
   ---------------------------------------------------------------------
   Cria uma barra de ferramentas + área contenteditable dentro de um
   container já existente no HTML. Usado tanto no editor de anotações
   quanto no editor de respostas de tarefas.

   Uso:
     var editor = AtlasEditor.create(containerEl, { placeholder: '...' });
     editor.setHTML('<p>conteúdo inicial</p>');
     editor.getHTML(); // -> string HTML atual, já pronta para salvar
     editor.focus();
     editor.clear();
     editor.destroy();

   O HTML produzido é sempre passado por AtlasData.sanitizeHtml antes
   de ser persistido (a chamada de saveNote/saveTask já faz isso),
   então o editor pode ser “generoso” ao formatar — a limpeza final
   acontece de forma centralizada.
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
    { cmd: 'insertImage', label: '🖼', title: 'Inserir imagem (link/URL)', needsPrompt: 'img' },
    { type: 'sep' },
    { cmd: 'removeFormat', label: '⌫', title: 'Limpar formatação' }
  ];

  function buildToolbar(editorApi) {
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
        if (btn.needsPrompt === 'img') {
          var imgUrl = global.prompt('Cole o link da imagem (URL):', 'https://');
          if (imgUrl) document.execCommand('insertImage', false, imgUrl);
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

    var toolbar = buildToolbar(api);

    container.appendChild(toolbar);
    container.appendChild(area);

    // Atalhos de teclado básicos (além dos nativos do navegador para bold/italic/underline)
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

  /**
   * Converte HTML (já sanitizado) em uma versão de leitura, idêntica
   * visualmente ao editor, mas sem contenteditable — usada nas telas
   * de leitura (modo aluno) e no excerto/preview dos cards.
   */
  function renderReadOnly(container, html) {
    container.classList.add('atlas-editor-readonly');
    container.innerHTML = html || '<p class="atlas-editor-empty">Sem conteúdo.</p>';
  }

  global.AtlasEditor = {
    create: create,
    renderReadOnly: renderReadOnly
  };

})(window);
