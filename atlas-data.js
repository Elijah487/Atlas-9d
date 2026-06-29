/* =====================================================================
   ATLAS — Camada central de dados e sessão (v4 — Firebase SDK modular)
   ---------------------------------------------------------------------
   Este arquivo é incluído em TODAS as páginas do Atlas, como módulo ES
   (<script type="module" src="atlas-data.js">). Ele:

   1. Conecta ao Firebase Realtime Database usando o SDK MODULAR (mais
      leve que o SDK "compat" usado antes — só importa exatamente as
      funções usadas, reduzindo bastante o que cada página baixa e,
      por consequência, o tempo de carregamento/conexão a cada troca
      de página).

   2. Mantém um CACHE LOCAL em memória, sincronizado em tempo real com
      o Firebase. Isso é o que permite que o resto do código do Atlas
      (dashboard.html, materia.html, etc.) continue chamando funções
      como AtlasData.getNotes() de forma SÍNCRONA (sem 'await', sem
      Promises) — nenhuma outra página precisa mudar por causa disto.

   3. Gerencia a SESSÃO do usuário (aluno normal ou desenvolvedor).
      A sessão em si (qual papel a pessoa tem NESTE navegador) continua
      em localStorage — isso é só uma preferência local de UI, não um
      dado compartilhado. O que importa para a segurança real é a
      autenticação no Firebase (login anônimo) e a marcação
      'dev_sessions/{uid}' no banco, que é o que as REGRAS do Firebase
      checam de verdade antes de permitir qualquer escrita.

   4. PROTEGE as operações de escrita em duas camadas:
      a) Aqui no cliente: saveX/deleteX só tentam escrever se isDev().
      b) No servidor (regras do Firebase): a escrita só é aceita se o
         uid autenticado estiver marcado em 'dev_sessions'.

   IMPORTANTE — este arquivo agora é um MÓDULO ES:
   A tag no HTML deve ser:
     <script type="module" src="atlas-data.js"></script>
   (sem mais os 3 scripts separados do SDK "compat" antes dele — o
   próprio módulo já importa o que precisa, direto de um CDN que
   suporta ES Modules).

   Como módulos carregam de forma assíncrona (deferred), qualquer script
   no HTML que dependa de window.AtlasData deve esperar pelo evento
   'atlas-data-ready', disparado no documento assim que tudo estiver
   pronto:

     <script type="module" src="atlas-data.js"></script>
     <script type="module" src="atlas-editor.js"></script>
     <script>
       document.addEventListener('atlas-data-ready', function () {
         if (window.AtlasData) { AtlasData.requireSession('index.html'); }
       });
     </script>
   ===================================================================== */

import {
  initializeApp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  onAuthStateChanged,
  signInAnonymously,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  getDatabase,
  ref,
  onValue,
  set
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

(function (global) {
  'use strict';

  /* ---------------------------------------------------------------
     CONFIGURAÇÃO DO FIREBASE — dados do projeto "atlas-9d"
  --------------------------------------------------------------- */
  var FIREBASE_CONFIG = {
    apiKey: "AIzaSyBnt7aI16nXLXTSEg9ncITDI1KWS1wv650",
    authDomain: "atlas-9d.firebaseapp.com",
    databaseURL: "https://atlas-9d-default-rtdb.firebaseio.com",
    projectId: "atlas-9d",
    storageBucket: "atlas-9d.firebasestorage.app",
    messagingSenderId: "967138045816",
    appId: "1:967138045816:web:c90ba328cc71bf6dcf628d"
  };

  var ATLAS_SESSION_KEY = 'atlas_session';   // 'student' | 'dev' (preferência local de UI)
  var DATA_PATH = 'atlas_data';              // nó no Firebase: { notes, tasks, events, notices }
  var DEV_SESSIONS_PATH = 'dev_sessions';    // nó no Firebase: { [uid]: true }

  var STUDENT_CODE = 'atlas9d';
  var DEV_CODE = 'Elijah044'; // comparação sensível a maiúsculas/minúsculas, como uma senha real

  var SUBJECTS = [
    'Matemática', 'Português', 'História', 'Geografia',
    'Ciências', 'Inglês', 'Arte',
    'O.E Matemática', 'O.E Português', 'Multidisciplinar'
  ];

  var BIMESTRES = ['1º Bimestre', '2º Bimestre', '3º Bimestre', '4º Bimestre'];

  var NOTICE_PRIORITIES = ['Normal', 'Importante', 'Urgente'];

  /* ---------------------------------------------------------------
     Estado interno: cache local + status da conexão
  --------------------------------------------------------------- */

  var cache = emptyData();
  var changeCallbacks = [];
  var firebaseAuthInstance = null;
  var firebaseDbInstance = null;
  var firebaseReady = false;
  var firebaseReadyCallbacks = [];

  /* ---------------------------------------------------------------
     Utilitários
  --------------------------------------------------------------- */

  function uid() {
    return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
  }

  function slugify(text) {
    return String(text)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, '-');
  }

  function emptyData() {
    return { notes: [], tasks: [], events: [], notices: [] };
  }

  function hasLocalStorage() {
    try {
      return !!global.localStorage;
    } catch (e) {
      return false;
    }
  }

  function notifyChange() {
    changeCallbacks.forEach(function (cb) {
      try { cb(); } catch (e) { console.error('Atlas: erro em callback onDataChange.', e); }
    });
  }

  /**
   * Sanitiza HTML vindo do editor rico, removendo tags perigosas
   * (script, iframe, etc.) e atributos de evento (onclick, onerror...).
   * Mantém apenas formatação básica: b, strong, i, em, u, h1-h3, ul, ol,
   * li, blockquote, hr, a, img, br, p, span, div.
   */
  function sanitizeHtml(html) {
    if (!html) return '';
    if (typeof document === 'undefined') return String(html);

    var ALLOWED_TAGS = {
      B: 1, STRONG: 1, I: 1, EM: 1, U: 1,
      H1: 1, H2: 1, H3: 1,
      UL: 1, OL: 1, LI: 1,
      BLOCKQUOTE: 1, HR: 1,
      A: 1, IMG: 1, BR: 1, P: 1, SPAN: 1, DIV: 1
    };
    var ALLOWED_ATTRS = {
      A: ['href', 'target', 'rel'],
      IMG: ['src', 'alt']
    };

    var template = document.createElement('template');
    template.innerHTML = html;

    function clean(node) {
      var children = Array.prototype.slice.call(node.childNodes);
      children.forEach(function (child) {
        if (child.nodeType === 1) { // ELEMENT_NODE
          var tag = child.tagName;
          if (!ALLOWED_TAGS[tag]) {
            while (child.firstChild) node.insertBefore(child.firstChild, child);
            node.removeChild(child);
            return;
          }
          var allowedAttrs = ALLOWED_ATTRS[tag] || [];
          Array.prototype.slice.call(child.attributes).forEach(function (attr) {
            var name = attr.name.toLowerCase();
            var isEventAttr = name.indexOf('on') === 0;
            var isAllowed = allowedAttrs.indexOf(name) !== -1;
            if (isEventAttr || !isAllowed) {
              child.removeAttribute(attr.name);
            }
          });
          if (tag === 'A') {
            var href = child.getAttribute('href') || '';
            if (href.indexOf('javascript:') === 0) {
              child.removeAttribute('href');
            } else {
              child.setAttribute('target', '_blank');
              child.setAttribute('rel', 'noopener noreferrer');
            }
          }
          if (tag === 'IMG') {
            var src = child.getAttribute('src') || '';
            if (src.indexOf('javascript:') === 0) {
              child.removeAttribute('src');
            }
          }
          clean(child);
        } else if (child.nodeType === 8) { // COMMENT_NODE
          node.removeChild(child);
        }
      });
    }

    clean(template.content);
    return template.innerHTML;
  }

  /* ---------------------------------------------------------------
     Conexão com o Firebase (SDK modular)
  --------------------------------------------------------------- */

  function onFirebaseReady(callback) {
    if (firebaseReady) {
      callback();
    } else {
      firebaseReadyCallbacks.push(callback);
    }
  }

  var atlasDataReadyEventDispatched = false;

  function markFirebaseReady() {
    var wasAlreadyReady = firebaseReady;
    firebaseReady = true;
    var callbacks = firebaseReadyCallbacks;
    firebaseReadyCallbacks = [];
    callbacks.forEach(function (cb) {
      try { cb(); } catch (e) { console.error('Atlas: erro em callback de inicialização.', e); }
    });

    // IMPORTANTE: onAuthStateChanged (chamado por initFirebase) é um listener
    // CONTÍNUO do Firebase — ele dispara de novo sempre que o estado de login
    // muda (por exemplo: primeiro com user=null, depois de novo quando o
    // login anônimo automático terminar). Sem esta proteção, o evento
    // 'atlas-data-ready' disparava mais de uma vez, fazendo os scripts que
    // o escutam (ex.: o cadastro do listener de submit de formulários)
    // rodarem em duplicidade — o que causava registros de evento repetidos
    // e, por consequência, dados de formulário sendo salvos de forma
    // inconsistente entre duas submissões "fantasmas". Disparamos o evento
    // DOM apenas na primeira vez; quem precisar saber de atualizações
    // posteriores de sessão deve usar AtlasData.onDataChange, não este evento.
    if (!atlasDataReadyEventDispatched) {
      atlasDataReadyEventDispatched = true;
      try {
        document.dispatchEvent(new Event('atlas-data-ready'));
      } catch (e) { /* ambientes sem 'document' (ex.: testes em Node) */ }
    }
  }

  function initFirebase() {
    var app;
    try {
      app = initializeApp(FIREBASE_CONFIG);
      firebaseAuthInstance = getAuth(app);
      firebaseDbInstance = getDatabase(app);
    } catch (e) {
      console.error('Atlas: falha ao inicializar o Firebase. Confira o FIREBASE_CONFIG.', e);
      markFirebaseReady();
      return;
    }

    // CAUSA REAL DO ATRASO DE ~3s EM TODA NAVEGAÇÃO (corrigida aqui):
    //
    // setPersistence() retorna uma Promise, e ela só resolve quando o
    // Firebase termina de configurar o IndexedDB como mecanismo de
    // persistência da sessão. A documentação oficial do Firebase é
    // explícita sobre isso: qualquer login feito antes dessa Promise
    // resolver "vai esperar essa mudança de persistência terminar antes
    // de aplicar o novo estado de Auth" — ou seja, ela PRECISA terminar
    // primeiro.
    //
    // O código anterior chamava setPersistence(...) sem aguardar essa
    // Promise, e registrava onAuthStateChanged / checava authStateReady()
    // imediatamente em seguida, em paralelo. Isso cria uma corrida real:
    // se o IndexedDB ainda não tivesse terminado de ser configurado como
    // mecanismo de persistência no exato instante em que a checagem
    // rodava, o Firebase podia reportar "nenhum usuário encontrado" mesmo
    // quando UMA SESSÃO VÁLIDA JÁ EXISTIA persistida de visitas anteriores
    // — fazendo o app concluir, errado, que precisava criar um usuário
    // anônimo novo. É exatamente esse falso negativo, repetido a cada
    // carregamento de página, que mantinha o app sempre criando um
    // usuário novo via rede (o signInAnonymously que aparecia crescendo
    // no painel de Usuários do Firebase) e pagando o tempo de rede inteiro
    // de novo, toda vez — em vez de aproveitar a sessão já existente.
    //
    // A correção: só registramos onAuthStateChanged e só checamos
    // authStateReady() DEPOIS que a Promise de setPersistence resolver de
    // fato. Isso garante que, quando checarmos se há usuário persistido,
    // o mecanismo de persistência já esteja totalmente configurado —
    // eliminando o falso negativo, sem usar nenhum timeout artificial
    // (a espera é pela Promise real do próprio SDK, não por um tempo fixo).
    setPersistence(firebaseAuthInstance, browserLocalPersistence)
      .catch(function (e) {
        console.warn('Atlas: não foi possível definir persistência LOCAL do Firebase Auth.', e);
      })
      .then(function () {
        onAuthStateChanged(firebaseAuthInstance, function (user) {
          if (user) attachDataListener();
          markFirebaseReady();
        });

        firebaseAuthInstance.authStateReady().then(function () {
          if (firebaseAuthInstance.currentUser) {
            // DIAGNÓSTICO TEMPORÁRIO — pode remover esta linha depois de
            // confirmar que a sessão está sendo restaurada corretamente.
            console.log('%c[ATLAS-DIAGNÓSTICO] Sessão JÁ EXISTIA e foi restaurada sem precisar de internet. uid: ' + firebaseAuthInstance.currentUser.uid, 'color:#2ecc71;font-weight:bold;');
          } else {
            var existingRole = getSession();
            if (existingRole) {
              // DIAGNÓSTICO TEMPORÁRIO — se esta linha aparecer toda vez que
              // você troca de página, é sinal de que a sessão NÃO está
              // sendo restaurada, e o app está criando um usuário novo.
              console.log('%c[ATLAS-DIAGNÓSTICO] Nenhuma sessão encontrada — criando usuário novo agora (isso deveria acontecer só na primeira vez, não em toda página).', 'color:#e74c3c;font-weight:bold;');
              reauthenticate(existingRole);
            }
          }
        });
      });
  }

  /**
   * Reconecta ao Firebase silenciosamente quando já existe uma sessão
   * local válida, mas o Firebase Auth ainda não tem um usuário (por
   * exemplo, ao abrir uma página interna direto, sem passar pelo modal).
   * Se a sessão local for 'dev', garante que a marcação em dev_sessions
   * também seja recriada para esse uid.
   */
  function reauthenticate(role) {
    if (!firebaseAuthInstance) return;
    signInAnonymously(firebaseAuthInstance).then(function (credential) {
      if (role === 'dev' && firebaseDbInstance && credential.user) {
        set(ref(firebaseDbInstance, DEV_SESSIONS_PATH + '/' + credential.user.uid), true);
      }
    }).catch(function (error) {
      console.error('Atlas: falha ao reconectar sessão existente ao Firebase.', error);
    });
  }

  var dataListenerAttached = false;

  /**
   * Escuta o nó 'atlas_data' do Firebase em tempo real. Toda vez que algo
   * mudar — em QUALQUER dispositivo, de qualquer aluno ou do desenvolvedor —
   * este listener dispara, atualiza o cache local e notifica as páginas
   * (via onDataChange).
   */
  function attachDataListener() {
    if (dataListenerAttached || !firebaseDbInstance) return;
    dataListenerAttached = true;

    onValue(ref(firebaseDbInstance, DATA_PATH), function (snapshot) {
      var remote = snapshot.val() || {};
      cache = {
        notes: objectToArray(remote.notes),
        tasks: objectToArray(remote.tasks),
        events: objectToArray(remote.events),
        notices: objectToArray(remote.notices)
      };
      notifyChange();
    }, function (error) {
      console.error('Atlas: erro ao escutar dados do Firebase (confira as regras de segurança).', error);
    });
  }

  /**
   * O Firebase, ao salvar um array com 'set', pode devolvê-lo como objeto
   * (chaves "0", "1", "2"...) dependendo do estado dos dados. Esta função
   * normaliza para sempre trabalharmos com arrays JavaScript de verdade.
   */
  function objectToArray(value) {
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== 'object') return [];
    return Object.keys(value).map(function (k) { return value[k]; });
  }

  /**
   * Grava a lista completa de uma coleção (notes/tasks/events/notices)
   * no Firebase. Como o volume de dados de uma turma é pequeno, gravar
   * a lista inteira a cada alteração é simples e suficiente.
   */
  function persistCollection(collectionName, list) {
    if (!firebaseDbInstance) {
      console.error('Atlas: Firebase não está conectado, não foi possível salvar.');
      return false;
    }
    set(ref(firebaseDbInstance, DATA_PATH + '/' + collectionName), list).catch(function (error) {
      console.error('Atlas: falha ao salvar no Firebase. Confira as regras de segurança e a conexão.', error);
    });
    return true;
  }

  /* ---------------------------------------------------------------
     Sessão (aluno normal / desenvolvedor)
     A "sessão" é uma preferência de UI local a este navegador. A
     segurança real de quem pode escrever é garantida pelo Firebase
     (login anônimo + marcação em dev_sessions), não por isto aqui.
  --------------------------------------------------------------- */

  function getSession() {
    if (!hasLocalStorage()) return null;
    try {
      var v = global.localStorage.getItem(ATLAS_SESSION_KEY);
      return v === 'dev' || v === 'student' ? v : null;
    } catch (e) {
      return null;
    }
  }

  function setSessionLocal(role) {
    if (!hasLocalStorage()) return false;
    try {
      global.localStorage.setItem(ATLAS_SESSION_KEY, role);
      return true;
    } catch (e) {
      return false;
    }
  }

  function clearSession() {
    if (!hasLocalStorage()) return;
    try {
      global.localStorage.removeItem(ATLAS_SESSION_KEY);
    } catch (e) { /* noop */ }
    if (firebaseAuthInstance) {
      try { signOut(firebaseAuthInstance); } catch (e) { /* noop */ }
    }
  }

  function isDev() {
    return getSession() === 'dev';
  }

  function isLoggedIn() {
    var s = getSession();
    return s === 'dev' || s === 'student';
  }

  function checkAccessCode(typedRaw) {
    var typed = String(typedRaw || '').trim();
    if (typed.toLowerCase() === STUDENT_CODE.toLowerCase()) return 'student';
    if (typed === DEV_CODE) return 'dev';
    return null;
  }

  /**
   * Faz o login anônimo no Firebase e, se o papel for 'dev', marca esse
   * uid em dev_sessions/{uid} = true — é essa marcação que as regras do
   * Firebase usam para decidir quem pode escrever de verdade.
   * Chamar a partir do modal de acesso (index.html) após checkAccessCode.
   *
   * @param {string} role 'student' ou 'dev'
   * @param {function(boolean)} callback chamado com true (sucesso) ou false (falha)
   */
  function loginWithRole(role, callback) {
    setSessionLocal(role);

    onFirebaseReady(function () {
      if (!firebaseAuthInstance) {
        console.warn('Atlas: Firebase não inicializado — funcionando apenas localmente.');
        callback(true);
        return;
      }

      signInAnonymously(firebaseAuthInstance).then(function (credential) {
        var theUid = credential.user.uid;
        if (role === 'dev') {
          set(ref(firebaseDbInstance, DEV_SESSIONS_PATH + '/' + theUid), true).then(function () {
            callback(true);
          }).catch(function (error) {
            console.error('Atlas: falha ao registrar sessão de desenvolvedor.', error);
            callback(false);
          });
        } else {
          callback(true);
        }
      }).catch(function (error) {
        console.error('Atlas: falha no login anônimo do Firebase.', error);
        callback(false);
      });
    });
  }

  function requireSession(redirectTo) {
    if (!isLoggedIn()) {
      safeRedirect(redirectTo || 'index.html');
      return false;
    }
    return true;
  }

  function safeRedirect(path) {
    try {
      global.location.href = path;
    } catch (e) {
      try {
        global.location.assign(path);
      } catch (e2) {
        console.error('Atlas: falha ao redirecionar para', path, e2);
      }
    }
  }

  /* ---------------------------------------------------------------
     CRUD — Anotações
  --------------------------------------------------------------- */

  function getNotes() {
    return cache.notes;
  }

  function getNotesBy(materia, bimestre) {
    return getNotes().filter(function (n) {
      return n.materia === materia && (!bimestre || n.bimestre === bimestre);
    });
  }

  function saveNote(note) {
    if (!isDev()) {
      console.warn('Atlas: tentativa de salvar anotação fora do Modo Desenvolvedor foi bloqueada.');
      return null;
    }
    var list = cache.notes.slice();
    var clean = {
      titulo: String(note.titulo || '').trim(),
      materia: note.materia,
      bimestre: note.bimestre,
      conteudo: sanitizeHtml(note.conteudo || '')
    };
    if (note.id) {
      var idx = list.findIndex(function (n) { return n.id === note.id; });
      if (idx !== -1) {
        clean = Object.assign({}, list[idx], clean, { id: note.id, atualizadoEm: Date.now() });
        list[idx] = clean;
      }
    } else {
      clean.id = uid();
      clean.criadoEm = Date.now();
      clean.atualizadoEm = Date.now();
      list.push(clean);
    }
    persistCollection('notes', list);
    return clean;
  }

  function deleteNote(id) {
    if (!isDev()) {
      console.warn('Atlas: tentativa de excluir anotação fora do Modo Desenvolvedor foi bloqueada.');
      return false;
    }
    var list = cache.notes.filter(function (n) { return n.id !== id; });
    persistCollection('notes', list);
    return true;
  }

  /* ---------------------------------------------------------------
     CRUD — Tarefas
  --------------------------------------------------------------- */

  function getTasks() {
    return cache.tasks;
  }

  function getTasksBy(materia, bimestre) {
    return getTasks().filter(function (t) {
      return t.materia === materia && (!bimestre || t.bimestre === bimestre);
    });
  }

  function saveTask(task) {
    if (!isDev()) {
      console.warn('Atlas: tentativa de salvar tarefa fora do Modo Desenvolvedor foi bloqueada.');
      return null;
    }
    var list = cache.tasks.slice();
    var clean = {
      titulo: String(task.titulo || '').trim(),
      materia: task.materia,
      bimestre: task.bimestre,
      dataEntrega: task.dataEntrega,
      resposta: sanitizeHtml(task.resposta || '')
    };
    if (task.id) {
      var idx = list.findIndex(function (t) { return t.id === task.id; });
      if (idx !== -1) {
        clean = Object.assign({}, list[idx], clean, { id: task.id, atualizadoEm: Date.now() });
        list[idx] = clean;
      }
    } else {
      clean.id = uid();
      clean.criadoEm = Date.now();
      clean.atualizadoEm = Date.now();
      list.push(clean);
    }
    persistCollection('tasks', list);
    return clean;
  }

  function deleteTask(id) {
    if (!isDev()) {
      console.warn('Atlas: tentativa de excluir tarefa fora do Modo Desenvolvedor foi bloqueada.');
      return false;
    }
    var list = cache.tasks.filter(function (t) { return t.id !== id; });
    persistCollection('tasks', list);
    return true;
  }

  /* ---------------------------------------------------------------
     CRUD — Eventos do calendário
  --------------------------------------------------------------- */

  function getEvents() {
    return cache.events;
  }

  function saveEvent(evt) {
    if (!isDev()) {
      console.warn('Atlas: tentativa de salvar evento fora do Modo Desenvolvedor foi bloqueada.');
      return null;
    }
    var list = cache.events.slice();
    var clean = {
      titulo: String(evt.titulo || '').trim(),
      descricao: String(evt.descricao || ''),
      data: evt.data
    };
    if (evt.id) {
      var idx = list.findIndex(function (e) { return e.id === evt.id; });
      if (idx !== -1) {
        clean = Object.assign({}, list[idx], clean, { id: evt.id, atualizadoEm: Date.now() });
        list[idx] = clean;
      }
    } else {
      clean.id = uid();
      clean.criadoEm = Date.now();
      clean.atualizadoEm = Date.now();
      list.push(clean);
    }
    persistCollection('events', list);
    return clean;
  }

  function deleteEvent(id) {
    if (!isDev()) {
      console.warn('Atlas: tentativa de excluir evento fora do Modo Desenvolvedor foi bloqueada.');
      return false;
    }
    var list = cache.events.filter(function (e) { return e.id !== id; });
    persistCollection('events', list);
    return true;
  }

  /* ---------------------------------------------------------------
     CRUD — Avisos da turma
  --------------------------------------------------------------- */

  function getNotices() {
    return cache.notices;
  }

  function saveNotice(notice) {
    if (!isDev()) {
      console.warn('Atlas: tentativa de salvar aviso fora do Modo Desenvolvedor foi bloqueada.');
      return null;
    }
    var list = cache.notices.slice();
    var prioridade = NOTICE_PRIORITIES.indexOf(notice.prioridade) !== -1 ? notice.prioridade : 'Normal';
    var clean = {
      titulo: String(notice.titulo || '').trim(),
      descricao: String(notice.descricao || '').trim(),
      data: notice.data || '',
      prioridade: prioridade
    };
    if (notice.id) {
      var idx = list.findIndex(function (n) { return n.id === notice.id; });
      if (idx !== -1) {
        clean = Object.assign({}, list[idx], clean, { id: notice.id, atualizadoEm: Date.now() });
        list[idx] = clean;
      }
    } else {
      clean.id = uid();
      clean.criadoEm = Date.now();
      clean.atualizadoEm = Date.now();
      list.push(clean);
    }
    persistCollection('notices', list);
    return clean;
  }

  function deleteNotice(id) {
    if (!isDev()) {
      console.warn('Atlas: tentativa de excluir aviso fora do Modo Desenvolvedor foi bloqueada.');
      return false;
    }
    var list = cache.notices.filter(function (n) { return n.id !== id; });
    persistCollection('notices', list);
    return true;
  }

  /* ---------------------------------------------------------------
     Sincronização entre páginas/dispositivos
  --------------------------------------------------------------- */

  function onDataChange(callback) {
    changeCallbacks.push(callback);
  }

  /* ---------------------------------------------------------------
     Banner "Modo Desenvolvedor ativo"
  --------------------------------------------------------------- */

  function injectDevBanner() {
    if (!isDev()) return;
    if (document.getElementById('atlasDevBanner')) return;

    var style = document.createElement('style');
    style.textContent =
      '#atlasDevBanner{position:fixed;top:0;left:0;right:0;z-index:500;' +
      'display:flex;align-items:center;justify-content:center;gap:14px;' +
      'padding:9px 16px;background:linear-gradient(90deg,#7c3aed,#a855f7);' +
      'color:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Arial,sans-serif;' +
      'font-size:13px;font-weight:600;letter-spacing:.02em;' +
      'box-shadow:0 2px 14px rgba(0,0,0,.35);' +
      'min-height:38px;box-sizing:border-box;}' +
      '#atlasDevBanner .dot{width:7px;height:7px;border-radius:50%;background:#fff;' +
      'box-shadow:0 0 0 3px rgba(255,255,255,.25);flex-shrink:0;}' +
      '#atlasDevBanner button{background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.35);' +
      'color:#fff;font-size:12.5px;font-weight:600;padding:5px 12px;border-radius:100px;cursor:pointer;' +
      'font-family:inherit;transition:background .2s ease;flex-shrink:0;}' +
      '#atlasDevBanner button:hover{background:rgba(255,255,255,.32);}' +
      'body.atlas-dev-active{padding-top:38px;}' +
      'body.atlas-dev-active .app{min-height:calc(100vh - 38px);}' +
      'body.atlas-dev-active header#siteHeader{top:38px;}' +
      '@media (max-width:720px){' +
        '#atlasDevBanner{font-size:11.5px;padding:7px 10px;text-align:center;}' +
        '#atlasDevBanner span:not(.dot){overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60vw;}' +
        'body.atlas-dev-active{padding-top:34px;}' +
        'body.atlas-dev-active .sidebar{top:94px;}' +
      '}';
    document.head.appendChild(style);

    var banner = document.createElement('div');
    banner.id = 'atlasDevBanner';
    banner.innerHTML =
      '<span class="dot"></span>' +
      '<span>MODO DESENVOLVEDOR ATIVO — alterações feitas aqui aparecem para todos os alunos</span>' +
      '<button id="atlasDevExitBtn" type="button">Sair do modo</button>';
    document.body.prepend(banner);
    document.body.classList.add('atlas-dev-active');

    var exitBtn = document.getElementById('atlasDevExitBtn');
    if (exitBtn) {
      exitBtn.addEventListener('click', function () {
        clearSession();
        safeRedirect('index.html');
      });
    }
  }

  function logout() {
    clearSession();
    safeRedirect('index.html');
  }

  /* ---------------------------------------------------------------
     Exposição pública
  --------------------------------------------------------------- */

  global.AtlasData = {
    SUBJECTS: SUBJECTS,
    BIMESTRES: BIMESTRES,
    NOTICE_PRIORITIES: NOTICE_PRIORITIES,

    slugify: slugify,
    uid: uid,
    sanitizeHtml: sanitizeHtml,

    getSession: getSession,
    clearSession: clearSession,
    isDev: isDev,
    isLoggedIn: isLoggedIn,
    checkAccessCode: checkAccessCode,
    loginWithRole: loginWithRole,
    requireSession: requireSession,
    logout: logout,
    onFirebaseReady: onFirebaseReady,

    getNotes: getNotes,
    getNotesBy: getNotesBy,
    saveNote: saveNote,
    deleteNote: deleteNote,

    getTasks: getTasks,
    getTasksBy: getTasksBy,
    saveTask: saveTask,
    deleteTask: deleteTask,

    getEvents: getEvents,
    saveEvent: saveEvent,
    deleteEvent: deleteEvent,

    getNotices: getNotices,
    saveNotice: saveNotice,
    deleteNotice: deleteNotice,

    onDataChange: onDataChange,
    injectDevBanner: injectDevBanner
  };

  initFirebase();

})(window);