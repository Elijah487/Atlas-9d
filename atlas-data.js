/* =====================================================================
   ATLAS — Camada central de dados e sessão (v6 — autenticação segura)
   ---------------------------------------------------------------------
   Este arquivo é incluído em TODAS as páginas do Atlas, como módulo ES
   (<script type="module" src="atlas-data.js">). Ele:

   1. Conecta ao Firebase Realtime Database usando o SDK MODULAR.

   2. Mantém um CACHE LOCAL em memória + sessionStorage, permitindo
      leitura síncrona por todas as páginas sem re-download de dados.

   3. [v5] Cache persistente em sessionStorage — dados aparecem
      instantaneamente ao trocar de página.

   4. [v5] Quatro listeners separados por coleção (notes, tasks,
      events, notices) em vez de um listener no nó raiz.

   5. [v5] Notificações via debounce — evita múltiplos re-renders.

   6. [v6] AUTENTICAÇÃO DE DESENVOLVEDOR COMPLETAMENTE SEGURA:
      A senha de desenvolvedor NÃO existe mais neste arquivo.
      O frontend envia a senha para uma Firebase Cloud Function
      (verifyDevPassword) via HTTPS. A função compara com a variável
      de ambiente DEV_PASSWORD no servidor e, se correta, grava
      dev_sessions/{uid} = true no banco com privilégios de Admin SDK.
      Nenhuma inspeção de DevTools, Sources ou Network consegue
      descobrir a senha — ela nunca chega ao navegador.

   7. PROTEGE as operações de escrita em duas camadas:
      a) Cliente: saveX/deleteX só executam se isDev() = true.
      b) Servidor: regras do Realtime Database só aceitam escrita
         se o uid estiver em dev_sessions (verificado pelo Firebase).

   IMPORTANTE — módulo ES:
     <script type="module" src="atlas-data.js"></script>
   Qualquer script que dependa de AtlasData deve escutar:
     document.addEventListener('atlas-data-ready', callback)
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

  /* [v5] Chave do sessionStorage para o cache entre páginas. */
  var CACHE_KEY = 'atlas_cache';

  /* [v6] URL da Cloud Function que verifica a senha de desenvolvedor.
     A senha em si NUNCA aparece aqui — fica só no servidor.
     Troque pela URL real após o deploy:
       firebase deploy --only functions
     A URL aparece no terminal após o deploy, no formato:
       https://southamerica-east1-atlas-9d.cloudfunctions.net/verifyDevPassword */
  var CLOUD_FUNCTION_URL = 'https://atlas-9d.vercel.app/api/dev-login';

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

  /* [v5] Verifica disponibilidade do sessionStorage. */
  function hasSessionStorage() {
    try {
      return !!global.sessionStorage;
    } catch (e) {
      return false;
    }
  }

  /* ---------------------------------------------------------------
     [v5] Cache persistente em sessionStorage
     Gravar/ler o objeto 'cache' inteiro a cada atualização de
     coleção. Isso permite que a próxima página restaure os dados
     instantaneamente, sem esperar o Firebase responder.
  --------------------------------------------------------------- */

  /**
   * Grava o estado atual de 'cache' no sessionStorage.
   * Chamado sempre que qualquer coleção é atualizada pelo Firebase.
   */
  function saveToSessionStorage() {
    if (!hasSessionStorage()) return;
    try {
      global.sessionStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch (e) {
      /* sessionStorage pode estar cheio (QuotaExceededError) — ignorar silenciosamente */
    }
  }

  /**
   * Tenta restaurar o cache do sessionStorage.
   * Retorna true se havia dados válidos e false caso contrário.
   */
  function loadFromSessionStorage() {
    if (!hasSessionStorage()) return false;
    try {
      var raw = global.sessionStorage.getItem(CACHE_KEY);
      if (!raw) return false;
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        cache = {
          notes:   Array.isArray(parsed.notes)   ? parsed.notes   : [],
          tasks:   Array.isArray(parsed.tasks)   ? parsed.tasks   : [],
          events:  Array.isArray(parsed.events)  ? parsed.events  : [],
          notices: Array.isArray(parsed.notices) ? parsed.notices : []
        };
        return true;
      }
    } catch (e) {
      /* JSON inválido ou sessionStorage inacessível — ignorar */
    }
    return false;
  }

  /* ---------------------------------------------------------------
     [v5] Notificação via debounce
     Evita múltiplas re-renderizações consecutivas quando vários
     listeners do Firebase respondem em sequência (ex.: na primeira
     conexão, todos os quatro listeners podem disparar quase ao mesmo
     tempo). Com debounce de 0 ms, todas as atualizações síncronas do
     mesmo "tick" JS são agrupadas em uma única chamada a notifyChange.
  --------------------------------------------------------------- */

  var notifyTimer = null;

  /**
   * Agenda um notifyChange para o próximo tick do event loop.
   * Se chamado várias vezes antes desse tick, só dispara uma vez.
   * Os listeners do Firebase devem chamar esta função, nunca
   * notifyChange() diretamente.
   */
  function scheduleNotify() {
    clearTimeout(notifyTimer);
    notifyTimer = setTimeout(function () {
      notifyChange();
    }, 0);
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
    /* [v5] Tenta restaurar o cache do sessionStorage ANTES de qualquer
       chamada ao Firebase. Se tiver dados, notifica as páginas
       imediatamente — o conteúdo aparece instantaneamente. O Firebase
       sincronizará em segundo plano e atualizará quando necessário. */
    if (loadFromSessionStorage()) {
      scheduleNotify();
    }

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
          if (user) attachDataListeners();
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
  /**
   * Reconecta silenciosamente quando já existe sessão local mas o
   * Firebase Auth perdeu o estado (ex.: usuário abriu uma página
   * interna direto, sem passar pelo index.html).
   *
   * Nota [v6]: para sessão 'dev', NÃO regravamos dev_sessions aqui —
   * isso exigiria a senha novamente. A sessão 'dev' no localStorage é
   * suficiente para a UI. As regras do Firebase protegem a escrita real.
   * Se o uid não estiver mais em dev_sessions (ex.: limpeza manual do
   * banco), as tentativas de escrita falharão no Firebase com erro de
   * permissão — que é o comportamento correto e seguro.
   */
  function reauthenticate(role) {
    if (!firebaseAuthInstance) return;
    signInAnonymously(firebaseAuthInstance).catch(function (error) {
      console.error('Atlas: falha ao reconectar sessão existente ao Firebase.', error);
    });
  }

  var dataListenerAttached = false;

  /* ---------------------------------------------------------------
     [v5] Listeners por coleção
     Em vez de escutar o nó 'atlas_data' inteiro (que baixa notes +
     tasks + events + notices de uma vez), registramos quatro listeners
     independentes. Cada um baixa apenas os dados da sua coleção,
     reduzindo o volume trafegado por evento e tornando as atualizações
     mais granulares.
     Após atualizar a coleção no cache em memória:
       1. Sincroniza o sessionStorage.
       2. Agenda o notifyChange via debounce.
  --------------------------------------------------------------- */

  /**
   * Fábrica de listener para uma coleção específica.
   * @param {string} collectionName  'notes' | 'tasks' | 'events' | 'notices'
   */
  function makeCollectionListener(collectionName) {
    onValue(
      ref(firebaseDbInstance, DATA_PATH + '/' + collectionName),
      function (snapshot) {
        var remoteValue = snapshot.val();
        cache[collectionName] = objectToArray(remoteValue);
        saveToSessionStorage();   // persiste o cache atualizado
        scheduleNotify();         // notifica via debounce
      },
      function (error) {
        console.error(
          'Atlas: erro ao escutar coleção "' + collectionName +
          '" do Firebase (confira as regras de segurança).',
          error
        );
      }
    );
  }

  /**
   * Registra os quatro listeners de coleção separados.
   * Substitui o único onValue(atlas_data) da v4.
   */
  function attachDataListeners() {
    if (dataListenerAttached || !firebaseDbInstance) return;
    dataListenerAttached = true;

    makeCollectionListener('notes');
    makeCollectionListener('tasks');
    makeCollectionListener('events');
    makeCollectionListener('notices');
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
   * [v5] Atualiza também o cache em memória e o sessionStorage
   * imediatamente, antes mesmo de o Firebase confirmar, para que a
   * próxima leitura local já reflita a mudança.
   */
  function persistCollection(collectionName, list) {
    if (!firebaseDbInstance) {
      console.error('Atlas: Firebase não está conectado, não foi possível salvar.');
      return false;
    }
    // Atualização otimista: reflete no cache local e no sessionStorage agora,
    // sem esperar o round-trip do Firebase.
    cache[collectionName] = list;
    saveToSessionStorage();

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

  /**
   * [v6] Login de aluno — sem senha, sem servidor.
   * Apenas faz o login anônimo e grava a sessão local como 'student'.
   *
   * @param {function(boolean)} callback  true = sucesso, false = falha
   */
  function loginAsStudent(callback) {
    setSessionLocal('student');

    onFirebaseReady(function () {
      if (!firebaseAuthInstance) {
        /* Sem Firebase — funciona apenas localmente (modo offline). */
        callback(true);
        return;
      }
      signInAnonymously(firebaseAuthInstance)
        .then(function () { callback(true); })
        .catch(function (err) {
          console.error('Atlas: falha no login anônimo.', err);
          callback(false);
        });
    });
  }

  /**
   * [v6] Login de desenvolvedor — senha verificada no SERVIDOR.
   *
   * Fluxo:
   *   1. Login anônimo no Firebase para obter um uid autenticado.
   *   2. Obtém o ID Token desse usuário (JWT assinado pelo Firebase).
   *   3. Envia { password, idToken } para a Cloud Function via HTTPS POST.
   *   4. A Cloud Function verifica a senha no servidor e, se correta,
   *      grava dev_sessions/{uid} = true com Admin SDK.
   *   5. Se ok: grava 'dev' no localStorage e chama callback(true).
   *   6. Se senha errada: callback(false, 'wrong_password').
   *   7. Se erro de rede: callback(false, 'network_error').
   *
   * A senha NUNCA é comparada no cliente. Nenhuma inspeção de DevTools
   * consegue descobri-la — ela só existe na variável de ambiente do
   * servidor (Firebase Functions Environment).
   *
   * @param {string}   password              Senha digitada pelo usuário
   * @param {function(boolean, string)} callback
   *   Chamado com (true, null) no sucesso ou (false, motivo) no erro.
   *   Motivos possíveis: 'wrong_password' | 'network_error' | 'auth_error'
   */
  function loginAsDev(password, callback) {
    onFirebaseReady(function () {
      if (!firebaseAuthInstance) {
        console.warn('Atlas: Firebase não inicializado.');
        callback(false, 'auth_error');
        return;
      }

      /* Passo 1: garantir que há um usuário anônimo autenticado. */
      var authPromise = firebaseAuthInstance.currentUser
        ? Promise.resolve(firebaseAuthInstance.currentUser)
        : signInAnonymously(firebaseAuthInstance).then(function (c) { return c.user; });

      authPromise
        .then(function (user) {
          /* Passo 2: obter o ID Token JWT para enviar ao servidor. */
          return user.getIdToken(/* forceRefresh */ false);
        })
        .then(function (idToken) {
          /* Passo 3: chamar a Cloud Function via HTTPS POST.
             A senha vai no body, criptografada pelo TLS (HTTPS).
             Ela nunca aparece em logs de console ou no código-fonte. */
          return fetch(CLOUD_FUNCTION_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: password, idToken: idToken })
          });
        })
        .then(function (response) {
          return response.json().then(function (data) {
            return { status: response.status, data: data };
          });
        })
        .then(function (result) {
          if (result.data && result.data.ok === true) {
            /* Servidor confirmou: senha correta e dev_sessions gravado. */
            setSessionLocal('dev');
            callback(true, null);
          } else if (result.status === 403) {
            /* Senha errada — servidor respondeu explicitamente. */
            callback(false, 'wrong_password');
          } else {
            console.error('Atlas: resposta inesperada da Cloud Function.', result);
            callback(false, 'network_error');
          }
        })
        .catch(function (err) {
          console.error('Atlas: erro ao chamar Cloud Function.', err);
          callback(false, 'network_error');
        });
    });
  }

  /**
   * [v6] Mantido por compatibilidade com as outras páginas que chamam
   * AtlasData.loginWithRole('student', callback).
   * Para dev, use AtlasData.loginAsDev(password, callback) diretamente
   * a partir do modal — o index.html já foi atualizado para isso.
   *
   * @param {string} role 'student' (único valor suportado aqui)
   * @param {function(boolean)} callback
   */
  function loginWithRole(role, callback) {
    if (role === 'student') {
      loginAsStudent(callback);
    } else {
      /* Tentativa de usar loginWithRole('dev') diretamente sem senha —
         bloqueada. Use loginAsDev(password, callback) em vez disso. */
      console.error('Atlas: use AtlasData.loginAsDev(password, callback) para acesso dev.');
      callback(false);
    }
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
      enunciado: sanitizeHtml(task.enunciado || ''),
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
    loginWithRole: loginWithRole,    // compatibilidade — para role 'student'
    loginAsDev: loginAsDev,          // [v6] login de dev via Cloud Function
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
